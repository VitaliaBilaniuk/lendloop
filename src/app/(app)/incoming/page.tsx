"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { LoanAction } from "@/components/LoanAction";
import { LoanCard, type Loan } from "@/components/LoanCard";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import { todayIso } from "@/lib/format";

export default function IncomingRequestsPage() {
  const loans = useQuery(api.loans.incoming);
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const today = todayIso();

  if (loans === undefined) return <Spinner />;

  const pending = loans.filter((l) => l.status === "pending");
  const active = loans.filter((l) => l.status === "approved");
  const history = loans.filter((l) => l.status !== "pending" && l.status !== "approved");

  function actionsFor(loan: Loan) {
    if (loan.status === "pending") {
      return (
        <>
          <LoanAction label="Approve" variant="primary" run={() => approve({ loanId: loan._id })} />
          <LoanAction label="Decline" variant="secondary" run={() => decline({ loanId: loan._id })} />
        </>
      );
    }
    if (loan.status === "approved") {
      return loan.startDate > today ? (
        <LoanAction
          label="Cancel loan"
          variant="danger"
          confirm="Cancel this approved loan? The borrower will be notified."
          run={() => cancel({ loanId: loan._id })}
        />
      ) : (
        <LoanAction label="Mark returned" variant="primary" run={() => markReturned({ loanId: loan._id })} />
      );
    }
    return null;
  }

  const section = (title: string, items: Loan[], empty: string) => (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {title} <span className="text-stone-400">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((loan) => (
            <li key={loan._id}>
              <LoanCard loan={loan} counterpartyLabel="requested by" actions={actionsFor(loan)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <>
      <PageHeader title="Incoming requests" subtitle="Neighbors asking to borrow your tools." />
      {loans.length === 0 ? (
        <EmptyState title="No requests yet">When someone asks to borrow one of your tools, it shows up here.</EmptyState>
      ) : (
        <>
          {section("Needs your answer", pending, "You're all caught up.")}
          {section("Approved & on loan", active, "Nothing out on loan right now.")}
          {section("History", history, "No past requests.")}
        </>
      )}
    </>
  );
}
