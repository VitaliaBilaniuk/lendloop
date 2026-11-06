import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { audit, fail, requireUser } from "./lib/auth";
import { approvedLoansForTool, availabilityFrom } from "./lib/availability";
import { LIMITS } from "./lib/constants";
import { todayUtc } from "./lib/dates";
import { enqueueNotification } from "./lib/outbox";
import { cleanText } from "./lib/text";
import { categoryValidator, conditionValidator } from "./schema";

const MAX_RESULTS = 200;

/**
 * Public, unauthenticated listing. Returns ONLY name and category of tools
 * that are currently available: no owner, description or loan data.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_and_category", (q) => q.eq("status", "active"))
      .order("desc")
      .take(MAX_RESULTS);
    const today = todayUtc();
    const result: { _id: Id<"tools">; name: string; category: Doc<"tools">["category"] }[] = [];
    for (const tool of tools) {
      const availability = availabilityFrom(await approvedLoansForTool(ctx, tool._id), today);
      if (availability.state !== "on_loan") {
        result.push({ _id: tool._id, name: tool.name, category: tool.category });
      }
    }
    return result;
  },
});

/** Authenticated browse view with availability, optionally by category. */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_and_category", (q) =>
        category === undefined
          ? q.eq("status", "active")
          : q.eq("status", "active").eq("category", category),
      )
      .order("desc")
      .take(MAX_RESULTS);

    const today = todayUtc();
    const owners = new Map<Id<"users">, Doc<"users"> | null>();
    return await Promise.all(
      tools.map(async (tool) => {
        if (!owners.has(tool.ownerId)) owners.set(tool.ownerId, await ctx.db.get(tool.ownerId));
        const owner = owners.get(tool.ownerId);
        const approved = await approvedLoansForTool(ctx, tool._id);
        const myOpenRequest = await ctx.db
          .query("loans")
          .withIndex("by_tool_and_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
          .filter((q) => q.eq(q.field("borrowerId"), me._id))
          .first();
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          isMine: tool.ownerId === me._id,
          // Only a first name and the trust badge are shared with other users.
          owner: {
            firstName: owner?.firstName ?? "Neighbor",
            trustedLender: owner?.trustedLender ?? false,
          },
          availability: availabilityFrom(approved, today),
          // Booked ranges help borrowers pick free dates without exposing who booked.
          bookedRanges: approved
            .filter((l) => l.endDate >= today)
            .map((l) => ({ startDate: l.startDate, endDate: l.endDate })),
          hasPendingRequest: myOpenRequest !== null,
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner_and_status", (q) => q.eq("ownerId", me._id).eq("status", "active"))
      .order("desc")
      .collect();
    const today = todayUtc();
    return await Promise.all(
      tools.map(async (tool) => {
        const pending = await ctx.db
          .query("loans")
          .withIndex("by_tool_and_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
          .collect();
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          availability: availabilityFrom(await approvedLoansForTool(ctx, tool._id), today),
          pendingRequests: pending.length,
        };
      }),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

function cleanToolInput(input: { name: string; description: string }) {
  return {
    name: cleanText(input.name, "Name", LIMITS.toolName),
    description: cleanText(input.description, "Description", LIMITS.toolDescription),
  };
}

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const existing = await ctx.db
      .query("tools")
      .withIndex("by_owner_and_status", (q) => q.eq("ownerId", me._id).eq("status", "active"))
      .take(LIMITS.maxActiveListingsPerUser);
    if (existing.length >= LIMITS.maxActiveListingsPerUser) {
      fail(`You can have at most ${LIMITS.maxActiveListingsPerUser} active listings.`);
    }
    return await ctx.db.insert("tools", {
      ...cleanToolInput(args),
      category: args.category,
      condition: args.condition,
      ownerId: me._id, // owner always comes from the session, never the client
      status: "active",
    });
  },
});

/** Loads an active tool and asserts the caller owns it. */
async function requireOwnedTool(ctx: MutationCtx, toolId: Id<"tools">) {
  const me = await requireUser(ctx);
  const tool = await ctx.db.get(toolId);
  // Same message for "missing" and "not yours" so ids cannot be probed.
  if (tool === null || tool.status !== "active" || tool.ownerId !== me._id) {
    fail("Listing not found.");
  }
  return { me, tool };
}

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const { tool } = await requireOwnedTool(ctx, toolId);
    const cleaned = cleanToolInput(args);
    await ctx.db.patch(tool._id, {
      ...cleaned,
      category: args.category,
      condition: args.condition,
    });
  },
});

/**
 * Withdraws a listing and cancels its open requests. Shared by the owner's
 * delete and the admin's remove so both follow the same rules.
 */
export async function withdrawTool(
  ctx: MutationCtx,
  tool: Doc<"tools">,
  actorId: Id<"users">,
) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_and_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
    .collect();
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
    await enqueueNotification(ctx, loan, "request_cancelled", loan.borrowerId, loan.ownerId);
  }
  await ctx.db.patch(tool._id, { status: "removed", removedAt: Date.now(), removedBy: actorId });
}

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const { me, tool } = await requireOwnedTool(ctx, toolId);
    const approved = await approvedLoansForTool(ctx, tool._id);
    if (approved.length > 0) {
      fail("This tool has an approved loan. Mark it returned or cancel the loan first.");
    }
    await withdrawTool(ctx, tool, me._id);
    await audit(ctx, me._id, "tool.delete", "tools", tool._id);
  },
});
