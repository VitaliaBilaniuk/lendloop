import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { audit, fail, requireAdmin } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { todayUtc } from "./lib/dates";
import { cleanText } from "./lib/text";
import { roleValidator } from "./schema";
import { withdrawTool } from "./tools";

// Every function here calls requireAdmin first: the UI hides admin screens
// from regular users, but authorisation is decided only on the server.

export const listLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    const today = todayUtc();
    return await Promise.all(
      loans.map(async (loan) => {
        const [owner, borrower] = await Promise.all([ctx.db.get(loan.ownerId), ctx.db.get(loan.borrowerId)]);
        return {
          _id: loan._id,
          _creationTime: loan._creationTime,
          toolName: loan.toolName,
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
          isOverdue: loan.status === "approved" && loan.endDate < today,
          lastReminderAt: loan.lastReminderAt,
          reminderCount: loan.reminderCount ?? 0,
          owner: { firstName: owner?.firstName ?? "—", email: owner?.email ?? "" },
          borrower: { firstName: borrower?.firstName ?? "—", email: borrower?.email ?? "" },
        };
      }),
    );
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(500);
    return users.map((u) => ({
      _id: u._id,
      firstName: u.firstName,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const admin = await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (user === null) fail("User not found.");
    if (user.trustedLender === trusted) return;
    await ctx.db.patch(userId, { trustedLender: trusted });
    await audit(ctx, admin._id, trusted ? "user.trust" : "user.untrust", "users", userId);
  },
});

export const removeListing = mutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  handler: async (ctx, { toolId, reason }) => {
    const admin = await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (tool === null || tool.status !== "active") fail("Listing not found.");
    const why = cleanText(reason, "Reason", { min: 3, max: LIMITS.adminReason.max });
    // Approved loans are left intact: the item may physically be with the
    // borrower, and the owner still needs to mark it returned.
    await withdrawTool(ctx, tool, admin._id);
    await audit(ctx, admin._id, "tool.remove", "tools", toolId, why);
  },
});

/** Delivery and workflow failures, so broken automation is never silent. */
export const automationHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [failed, skipped, pending, failures] = await Promise.all([
      ctx.db.query("outbox").withIndex("by_status_and_next_attempt", (q) => q.eq("status", "failed")).order("desc").take(50),
      ctx.db.query("outbox").withIndex("by_status_and_next_attempt", (q) => q.eq("status", "skipped")).order("desc").take(20),
      ctx.db.query("outbox").withIndex("by_status_and_next_attempt", (q) => q.eq("status", "pending")).take(100),
      ctx.db.query("automationFailures").order("desc").take(50),
    ]);
    const shape = (r: (typeof failed)[number]) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      event: r.event,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
    });
    return {
      pendingCount: pending.length,
      failedDeliveries: failed.map(shape),
      skippedDeliveries: skipped.map(shape),
      workflowFailures: failures.map((f) => ({
        _id: f._id,
        executionId: f.executionId,
        workflowName: f.workflowName,
        lastNode: f.lastNode,
        message: f.message,
        occurredAt: f.occurredAt,
      })),
    };
  },
});

export const retryDelivery = mutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(outboxId);
    if (row === null || (row.status !== "failed" && row.status !== "skipped")) {
      fail("Only failed or skipped deliveries can be retried.");
    }
    await ctx.db.patch(outboxId, { status: "pending", attempts: 0, nextAttemptAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.notifications.deliver, { outboxId });
    await audit(ctx, admin._id, "outbox.retry", "outbox", outboxId);
  },
});

/**
 * Role management is deliberately NOT exposed to the client. Run from the CLI:
 *   npx convex run admin:setRole '{"email":"you@example.com","role":"admin"}'
 * The user must have signed in once so their record exists.
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    if (user === null) throw new Error("No user with that email. Sign in once first.");
    await ctx.db.patch(user._id, { role });
    console.log(`Role for ${user._id} set to ${role}`);
  },
});
