import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Category, Condition, LoanStatus, Role } from "./lib/constants";

export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("ladders"),
  v.literal("sports"),
  v.literal("other"),
);
export const conditionValidator = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);
export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);
export const roleValidator = v.union(v.literal("user"), v.literal("admin"));

// Compile-time guard: validators and shared constants must stay in sync.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _inSync: [
  Same<Infer<typeof categoryValidator>, Category>,
  Same<Infer<typeof conditionValidator>, Condition>,
  Same<Infer<typeof loanStatusValidator>, LoanStatus>,
  Same<Infer<typeof roleValidator>, Role>,
] = [true, true, true, true];
void _inSync;

export const notificationEventValidator = v.union(
  v.literal("request_created"),
  v.literal("request_approved"),
  v.literal("request_declined"),
  v.literal("request_cancelled"),
  v.literal("loan_returned"),
);

export const automationKindValidator = v.union(
  v.literal("request_notification"),
  v.literal("overdue_reminder"),
);

export default defineSchema({
  users: defineTable({
    // Stable identifier from the Clerk JWT ("issuer|subject"). Never trust a
    // user id coming from the client; always resolve it from this.
    tokenIdentifier: v.string(),
    email: v.string(),
    firstName: v.string(),
    // Role is only ever changed by an internal mutation (CLI / dashboard),
    // never through a public function, so it cannot be self-assigned.
    role: roleValidator,
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    // Soft delete keeps loan history intact and gives admins an audit trail.
    status: v.union(v.literal("active"), v.literal("removed")),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_status_and_category", ["status", "category"])
    .index("by_owner_and_status", ["ownerId", "status"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // Snapshot so history stays readable if the listing is renamed/removed.
    toolName: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    lastReminderAt: v.optional(v.number()),
    reminderCount: v.optional(v.number()),
  })
    .index("by_tool_and_status", ["toolId", "status"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_borrower_and_status", ["borrowerId", "status"])
    .index("by_status_and_end_date", ["status", "endDate"]),

  // Transactional outbox: rows are written in the same mutation as the state
  // change, then delivered to n8n by a scheduled action with retries.
  outbox: defineTable({
    loanId: v.id("loans"),
    event: notificationEventValidator,
    recipientId: v.id("users"),
    counterpartyId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_status_and_next_attempt", ["status", "nextAttemptAt"])
    .index("by_loan", ["loanId"]),

  // Results reported back by n8n. `idempotencyKey` is unique per logical
  // notification so retried write-backs never create duplicates.
  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    kind: automationKindValidator,
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  // Failed n8n executions reported by the n8n error workflow.
  automationFailures: defineTable({
    executionId: v.string(),
    workflowName: v.string(),
    lastNode: v.optional(v.string()),
    message: v.string(),
    occurredAt: v.number(),
  }).index("by_execution", ["executionId"]),

  auditLog: defineTable({
    actorId: v.id("users"),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    detail: v.optional(v.string()),
  }),
});
