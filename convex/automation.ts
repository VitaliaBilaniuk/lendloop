import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysBetween, isValidIsoDate, todayUtc } from "./lib/dates";
import { automationKindValidator } from "./schema";

const MAX_OVERDUE_BATCH = 100;

export function overdueReminderKey(loanId: string, date: string) {
  return `overdue:${loanId}:${date}`;
}

/**
 * Overdue loans that have not had a successful reminder today. Returns only
 * what the reminder workflow needs: who to email and about which tool.
 */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_and_end_date", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(MAX_OVERDUE_BATCH * 2);

    const result = [];
    for (const loan of loans) {
      if (result.length >= MAX_OVERDUE_BATCH) break;
      const reminderKey = overdueReminderKey(loan._id, today);
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", reminderKey))
        .unique();
      if (already?.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      if (borrower === null) continue;
      result.push({
        loanId: loan._id,
        reminderKey,
        borrower: { email: borrower.email, firstName: borrower.firstName },
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return { asOf: today, loans: result };
  },
});

// Exactly one format per kind: notify:<outboxId> | overdue:<loanId>:<YYYY-MM-DD>
const NOTIFY_KEY_RE = /^notify:([a-z0-9]{1,64})$/;
const OVERDUE_KEY_RE = /^overdue:([a-z0-9]{1,64}):(\d{4}-\d{2}-\d{2})$/;

/**
 * Idempotent write-back from n8n. The idempotency key identifies one logical
 * notification; repeated calls with the same key never create a second row.
 * A "failed" result can be upgraded to "sent" by a later successful retry,
 * but a "sent" result is never downgraded.
 */
export const recordEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.string(),
    kind: automationKindValidator,
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const match =
      args.kind === "overdue_reminder"
        ? OVERDUE_KEY_RE.exec(args.idempotencyKey)
        : NOTIFY_KEY_RE.exec(args.idempotencyKey);
    if (!match) return { ok: false as const, error: "invalid_key" };
    if (args.kind === "overdue_reminder" && !isValidIsoDate(match[2])) {
      return { ok: false as const, error: "invalid_key" };
    }
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (loanId === null) return { ok: false as const, error: "unknown_loan" };
    const loan = await ctx.db.get(loanId);
    if (loan === null) return { ok: false as const, error: "unknown_loan" };

    // The key must belong to this loan.
    const ref = match[1];
    if (args.kind === "overdue_reminder") {
      if (ref !== loan._id) return { ok: false as const, error: "key_mismatch" };
    } else {
      const outboxId = ctx.db.normalizeId("outbox", ref);
      const outbox = outboxId ? await ctx.db.get(outboxId) : null;
      if (outbox?.loanId !== loan._id) return { ok: false as const, error: "key_mismatch" };
    }

    const now = Date.now();
    const fields = {
      status: args.status,
      channel: args.channel?.slice(0, 40),
      detail: args.detail?.slice(0, 300),
      occurredAt: now,
    };
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();

    if (existing !== null) {
      if (existing.status === "sent" || args.status === "failed") {
        return { ok: true as const, duplicate: true };
      }
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("automationEvents", {
        idempotencyKey: args.idempotencyKey,
        loanId: loan._id,
        kind: args.kind,
        ...fields,
      });
    }

    // Reaching here means this call newly recorded a result (insert, or a
    // failed -> sent upgrade), so the counter cannot double-increment.
    if (args.status === "sent" && args.kind === "overdue_reminder") {
      await ctx.db.patch(loan._id, {
        lastReminderAt: now,
        reminderCount: (loan.reminderCount ?? 0) + 1,
      });
    }
    return { ok: true as const, duplicate: false };
  },
});

/** Records a failed n8n execution (from the n8n error workflow), idempotently. */
export const recordFailure = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    lastNode: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationFailures")
      .withIndex("by_execution", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing !== null) return { ok: true, duplicate: true };
    await ctx.db.insert("automationFailures", {
      executionId: args.executionId.slice(0, 64),
      workflowName: args.workflowName.slice(0, 120),
      lastNode: args.lastNode?.slice(0, 120),
      message: args.message.slice(0, 500),
      occurredAt: Date.now(),
    });
    console.error("n8n workflow failed", { executionId: args.executionId, workflow: args.workflowName });
    return { ok: true, duplicate: false };
  },
});
