"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { LoanAction } from "@/components/LoanAction";
import { LoanCard } from "@/components/LoanCard";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import { todayIso } from "@/lib/format";

export default function MyRequestsPage() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);
  const today = todayIso();

  return (
    <>
      <PageHeader title="My requests" subtitle="Things you've asked to borrow." />
      {loans === undefined ? (
        <Spinner />
      ) : loans.length === 0 ? (
        <EmptyState title="No requests yet">Find something on the Browse tab.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {loans.map((loan) => {
            const canCancel =
              loan.status === "pending" || (loan.status === "approved" && loan.startDate > today);
            return (
              <li key={loan._id}>
                <LoanCard
                  loan={loan}
                  counterpartyLabel="from"
                  actions={
                    canCancel && (
                      <LoanAction
                        label={loan.status === "pending" ? "Withdraw" : "Cancel"}
                        variant="danger"
                        confirm="Cancel this request?"
                        run={() => cancel({ loanId: loan._id })}
                      />
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
