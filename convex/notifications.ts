import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { outboundMessage, sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/signing";

export const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const STUCK_AFTER_MS = 10 * 60_000;

export function backoffMs(attempt: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return Math.round(exp * (0.8 + Math.random() * 0.4)); // ±20% jitter
}

function appLink(path: string): string | undefined {
  const base = process.env.APP_URL;
  if (!base) return undefined;
  try {
    return new URL(path, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * Builds the webhook payload. Data minimisation: n8n receives only what it
 * needs to notify ONE recipient: their email + first name, the other party's
 * first name, the tool name and dates. No ids of users, no descriptions, no
 * messages between neighbours.
 */
export const loadDelivery = internalQuery({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = await ctx.db.get(outboxId);
    if (row === null || row.status !== "pending") return null;
    const [loan, recipient, counterparty] = await Promise.all([
      ctx.db.get(row.loanId),
      ctx.db.get(row.recipientId),
      ctx.db.get(row.counterpartyId),
    ]);
    if (loan === null || recipient === null) return null;
    const recipientIsOwner = loan.ownerId === recipient._id;
    return {
      version: 1,
      deliveryId: row._id,
      idempotencyKey: `notify:${row._id}`,
      event: row.event,
      occurredAt: new Date(row._creationTime).toISOString(),
      recipient: { email: recipient.email, firstName: recipient.firstName },
      counterparty: { firstName: counterparty?.firstName ?? "A neighbor" },
      loan: {
        id: loan._id,
        toolName: loan.toolName,
        startDate: loan.startDate,
        endDate: loan.endDate,
        status: loan.status,
      },
      actionUrl: appLink(recipientIsOwner ? "/incoming" : "/requests"),
    };
  },
});

function isAllowedWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return true;
    // Plain HTTP only for local development targets.
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export const deliver = internalAction({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const payload = await ctx.runQuery(internal.notifications.loadDelivery, { outboxId });
    if (payload === null) return; // already delivered, failed or skipped

    const url = process.env.N8N_LOAN_EVENTS_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SIGNING_SECRET;
    if (!url || !secret || !isAllowedWebhookUrl(url)) {
      console.warn("n8n webhook not configured (or URL not allowed); skipping", { outboxId });
      await ctx.runMutation(internal.notifications.markSkipped, {
        outboxId,
        reason: "n8n webhook is not configured",
      });
      return;
    }

    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    let error: string | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TIMESTAMP_HEADER]: ts,
          [SIGNATURE_HEADER]: await sign(secret, outboundMessage(ts, body)),
          "Idempotency-Key": payload.idempotencyKey,
        },
        body,
        redirect: "error", // never follow redirects to an unexpected host
        signal: controller.signal,
      });
      if (!res.ok) error = `n8n responded with HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error && e.name === "AbortError" ? "Request timed out" : "Network error";
    } finally {
      clearTimeout(timer);
    }
    if (error) console.error("n8n delivery failed", { outboxId, error });
    await ctx.runMutation(internal.notifications.recordAttempt, { outboxId, error });
  },
});

export const recordAttempt = internalMutation({
  args: { outboxId: v.id("outbox"), error: v.optional(v.string()) },
  handler: async (ctx, { outboxId, error }) => {
    const row = await ctx.db.get(outboxId);
    if (row === null || row.status !== "pending") return;
    const attempts = row.attempts + 1;
    const now = Date.now();

    if (error === undefined) {
      await ctx.db.patch(outboxId, { status: "delivered", attempts, deliveredAt: now, lastError: undefined });
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(outboxId, { status: "failed", attempts, lastError: error });
      await recordDeliveryFailure(ctx, outboxId, row.loanId, error);
      return;
    }
    const delay = backoffMs(attempts);
    await ctx.db.patch(outboxId, { attempts, lastError: error, nextAttemptAt: now + delay });
    await ctx.scheduler.runAfter(delay, internal.notifications.deliver, { outboxId });
  },
});

/** Makes a permanently failed delivery visible on the loan's activity feed. */
async function recordDeliveryFailure(
  ctx: MutationCtx,
  outboxId: Id<"outbox">,
  loanId: Id<"loans">,
  detail: string,
) {
  const idempotencyKey = `notify:${outboxId}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing !== null) return;
  await ctx.db.insert("automationEvents", {
    idempotencyKey,
    loanId,
    kind: "request_notification",
    status: "failed",
    detail,
    occurredAt: Date.now(),
  });
}

export const markSkipped = internalMutation({
  args: { outboxId: v.id("outbox"), reason: v.string() },
  handler: async (ctx, { outboxId, reason }) => {
    const row = await ctx.db.get(outboxId);
    if (row === null || row.status !== "pending") return;
    await ctx.db.patch(outboxId, { status: "skipped", lastError: reason });
  },
});

/**
 * Safety net (cron): re-schedules pending deliveries whose scheduled job
 * should have run long ago, e.g. after a platform-level action failure.
 */
export const requeueStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("outbox")
      .withIndex("by_status_and_next_attempt", (q) =>
        q.eq("status", "pending").lt("nextAttemptAt", now - STUCK_AFTER_MS),
      )
      .take(50);
    for (const row of stuck) {
      await ctx.db.patch(row._id, { nextAttemptAt: now });
      await ctx.scheduler.runAfter(0, internal.notifications.deliver, { outboxId: row._id });
    }
    if (stuck.length > 0) console.warn(`Re-queued ${stuck.length} stuck deliveries`);
  },
});
