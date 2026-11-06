"use client";

import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import type { api } from "@/../convex/_generated/api";
import { formatRange, timeAgo } from "@/lib/format";
import { Badge, Card, TrustedBadge, type Tone } from "./ui";

export type Loan = FunctionReturnType<typeof api.loans.myRequests>[number];

const STATUS: Record<Loan["status"], { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "gray" },
  cancelled: { label: "Cancelled", tone: "gray" },
  returned: { label: "Returned", tone: "blue" },
};

export function LoanStatusBadge({ status, overdue }: { status: Loan["status"]; overdue?: boolean }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>;
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function describeActivity(a: Loan["activity"][number]): string {
  const what = a.kind === "overdue_reminder" ? "Reminder" : "Notification";
  return a.status === "sent"
    ? `${what} sent ${timeAgo(a.occurredAt)}`
    : `${what} failed ${timeAgo(a.occurredAt)}`;
}

export function LoanCard({
  loan,
  counterpartyLabel,
  actions,
}: {
  loan: Loan;
  counterpartyLabel: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-stone-900">{loan.toolName}</h3>
            <LoanStatusBadge status={loan.status} overdue={loan.isOverdue} />
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {formatRange(loan.startDate, loan.endDate)} · {counterpartyLabel}{" "}
            <span className="font-medium text-stone-800">{loan.counterparty.firstName}</span>{" "}
            {loan.counterparty.trustedLender && <TrustedBadge />}
          </p>
          {loan.message && (
            <p className="mt-2 whitespace-pre-line rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
              “{loan.message}”
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {loan.activity.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-xs text-stone-500">
          {loan.activity.map((a, i) => (
            <li key={i} className={a.status === "failed" ? "text-red-600" : undefined}>
              {a.status === "sent" ? "✉︎ " : "⚠︎ "}
              {describeActivity(a)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
