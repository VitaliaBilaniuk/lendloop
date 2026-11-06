import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, requireUser } from "./lib/auth";
import { approvedLoansForTool } from "./lib/availability";
import { LIMITS } from "./lib/constants";
import { addDays, daysBetween, isValidIsoDate, rangesOverlap, todayUtc } from "./lib/dates";
import { enqueueNotification } from "./lib/outbox";
import { cleanText } from "./lib/text";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Shapes a loan for one of its participants, exposing only first names. */
async function presentLoan(ctx: QueryCtx, loan: Doc<"loans">, viewerId: Id<"users">) {
  const otherId = loan.ownerId === viewerId ? loan.borrowerId : loan.ownerId;
  const other = await ctx.db.get(otherId);
  const activity = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
    .order("desc")
    .take(5);
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    message: loan.message,
    status: loan.status,
    decidedAt: loan.decidedAt,
    returnedAt: loan.returnedAt,
    isOverdue: loan.status === "approved" && loan.endDate < todayUtc(),
    counterparty: {
      firstName: other?.firstName ?? "Neighbor",
      trustedLender: other?.trustedLender ?? false,
    },
    activity: activity.map((e) => ({
      kind: e.kind,
      status: e.status,
      occurredAt: e.occurredAt,
    })),
  };
}

const LIST_LIMIT = 100;

/** Requests the current user made as a borrower. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(LIST_LIMIT);
    return await Promise.all(loans.map((l) => presentLoan(ctx, l, me._id)));
  },
});

/** Requests other users made for the current user's tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(LIST_LIMIT);
    return await Promise.all(loans.map((l) => presentLoan(ctx, l, me._id)));
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function validateDates(startDate: string, endDate: string, today: string) {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) fail("Please pick valid dates.");
  if (startDate < today) fail("The start date cannot be in the past.");
  if (endDate < startDate) fail("The end date must be on or after the start date.");
  if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
    fail(`Loans can last at most ${LIMITS.maxLoanDays} days.`);
  }
  if (startDate > addDays(today, LIMITS.maxDaysAhead)) {
    fail(`You can request at most ${LIMITS.maxDaysAhead} days ahead.`);
  }
}

async function assertNoApprovedOverlap(
  ctx: MutationCtx,
  toolId: Id<"tools">,
  startDate: string,
  endDate: string,
  ignoreLoanId?: Id<"loans">,
) {
  const approved = await approvedLoansForTool(ctx, toolId);
  const clash = approved.find(
    (l) => l._id !== ignoreLoanId && rangesOverlap(startDate, endDate, l.startDate, l.endDate),
  );
  if (clash) fail("Those dates overlap an existing loan for this tool.");
}

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (tool === null || tool.status !== "active") fail("Listing not found.");
    if (tool.ownerId === me._id) fail("You cannot borrow your own tool.");

    validateDates(args.startDate, args.endDate, todayUtc());
    const message = args.message
      ? cleanText(args.message, "Message", LIMITS.requestMessage) || undefined
      : undefined;

    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_borrower_and_status", (q) => q.eq("borrowerId", me._id).eq("status", "pending"))
      .take(LIMITS.maxPendingRequestsPerUser);
    if (myPending.length >= LIMITS.maxPendingRequestsPerUser) {
      fail(`You can have at most ${LIMITS.maxPendingRequestsPerUser} pending requests.`);
    }
    if (myPending.some((l) => l.toolId === tool._id)) {
      fail("You already have a pending request for this tool.");
    }
    await assertNoApprovedOverlap(ctx, tool._id, args.startDate, args.endDate);

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      toolName: tool.name,
      startDate: args.startDate,
      endDate: args.endDate,
      message,
      status: "pending",
    });
    const loan = (await ctx.db.get(loanId))!;
    await enqueueNotification(ctx, loan, "request_created", loan.ownerId, loan.borrowerId);
    return loanId;
  },
});

/**
 * Loads a loan and checks the caller's relationship to it. Non-participants
 * get the same "not found" error as a missing id, so ids cannot be probed.
 */
async function loadLoanFor(ctx: MutationCtx, loanId: Id<"loans">, as: "owner" | "borrower" | "either") {
  const me = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  const allowed =
    loan !== null &&
    ((as !== "borrower" && loan.ownerId === me._id) ||
      (as !== "owner" && loan.borrowerId === me._id));
  if (!allowed) fail("Request not found.");
  return { me, loan: loan! };
}

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadLoanFor(ctx, loanId, "owner");
    if (loan.status !== "pending") fail("Only pending requests can be approved.");
    const tool = await ctx.db.get(loan.toolId);
    if (tool === null || tool.status !== "active") fail("This listing is no longer active.");
    if (loan.endDate < todayUtc()) fail("The requested dates have already passed.");
    await assertNoApprovedOverlap(ctx, loan.toolId, loan.startDate, loan.endDate, loan._id);

    await ctx.db.patch(loan._id, { status: "approved", decidedAt: Date.now() });
    await enqueueNotification(ctx, loan, "request_approved", loan.borrowerId, loan.ownerId);
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadLoanFor(ctx, loanId, "owner");
    if (loan.status !== "pending") fail("Only pending requests can be declined.");
    await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
    await enqueueNotification(ctx, loan, "request_declined", loan.borrowerId, loan.ownerId);
  },
});

/**
 * Borrowers can withdraw a pending request; either side can call off an
 * approved loan before it starts. The other party is notified.
 */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { me, loan } = await loadLoanFor(ctx, loanId, "either");
    const isBorrower = loan.borrowerId === me._id;
    const cancellable =
      (loan.status === "pending" && isBorrower) ||
      (loan.status === "approved" && loan.startDate > todayUtc());
    if (!cancellable) fail("This request can no longer be cancelled.");

    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
    const [recipient, counterparty] = isBorrower
      ? [loan.ownerId, loan.borrowerId]
      : [loan.borrowerId, loan.ownerId];
    await enqueueNotification(ctx, loan, "request_cancelled", recipient, counterparty);
  },
});

/** The lender confirms the tool came back. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadLoanFor(ctx, loanId, "owner");
    if (loan.status !== "approved") fail("Only approved loans can be marked returned.");
    if (loan.startDate > todayUtc()) fail("This loan has not started yet. Cancel it instead.");
    await ctx.db.patch(loan._id, { status: "returned", returnedAt: Date.now() });
    await enqueueNotification(ctx, loan, "loan_returned", loan.borrowerId, loan.ownerId);
  },
});
