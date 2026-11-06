import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export function fail(message: string): never {
  // ConvexError messages are delivered to the client; plain Errors are
  // redacted in production. Only use this for user-safe messages.
  throw new ConvexError(message);
}

/** Resolves the signed-in user's record, or null when signed out / not synced. */
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (user === null) fail("You must be signed in to do that.");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") fail("You do not have permission to do that.");
  return user;
}

export function isParticipant(user: Doc<"users">, loan: Doc<"loans">) {
  return loan.ownerId === user._id || loan.borrowerId === user._id;
}

export async function audit(
  ctx: MutationCtx,
  actorId: Id<"users">,
  action: string,
  targetTable: string,
  targetId: string,
  detail?: string,
) {
  await ctx.db.insert("auditLog", {
    actorId,
    action,
    targetTable,
    targetId,
    detail,
  });
}
