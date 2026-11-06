import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { notificationEventValidator } from "../schema";

export type NotificationEvent = Infer<typeof notificationEventValidator>;

/**
 * Writes an outbox row in the caller's transaction and schedules delivery.
 * If the mutation rolls back, neither the row nor the scheduled job exist,
 * so notifications are never sent for state changes that did not happen.
 */
export async function enqueueNotification(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  event: NotificationEvent,
  recipientId: Id<"users">,
  counterpartyId: Id<"users">,
) {
  const now = Date.now();
  const outboxId = await ctx.db.insert("outbox", {
    loanId: loan._id,
    event,
    recipientId,
    counterpartyId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { outboxId });
  return outboxId;
}
