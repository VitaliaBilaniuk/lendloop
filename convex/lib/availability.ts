import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { todayUtc } from "./dates";

export type Availability =
  | { state: "available" }
  | { state: "on_loan"; until: string }
  | { state: "reserved"; from: string };

export async function approvedLoansForTool(ctx: QueryCtx, toolId: Id<"tools">) {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_and_status", (q) =>
      q.eq("toolId", toolId).eq("status", "approved"),
    )
    .collect();
}

/** Derives availability from approved (not yet returned) loans. */
export function availabilityFrom(
  approved: Doc<"loans">[],
  today: string = todayUtc(),
): Availability {
  // An approved loan that has started stays "on loan" until marked returned,
  // even if it is overdue.
  const current = approved.find((l) => l.startDate <= today);
  if (current) return { state: "on_loan", until: current.endDate };
  const upcoming = approved
    .map((l) => l.startDate)
    .sort()
    .at(0);
  if (upcoming) return { state: "reserved", from: upcoming };
  return { state: "available" };
}
