"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";
import { useMe } from "@/components/CurrentUser";
import { LoanAction } from "@/components/LoanAction";
import { LoanStatusBadge } from "@/components/LoanCard";
import { Badge, Card, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { formatRange, timeAgo } from "@/lib/format";

const TABS = ["Loans", "Users", "Automation"] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("Loans");

  // Cosmetic guard only. Every admin query/mutation re-checks the role.
  if (me.role !== "admin") {
    return <EmptyState title="Admins only">You don&apos;t have access to this page.</EmptyState>;
  }

  return (
    <>
      <PageHeader title="Admin" subtitle="Moderate listings, review loans and watch automation health." />
      <div role="tablist" className="mb-6 inline-flex rounded-lg border border-stone-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Loans" && <LoansTab />}
      {tab === "Users" && <UsersTab />}
      {tab === "Automation" && <AutomationTab />}
    </>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
    </div>
  );
}

function LoansTab() {
  const loans = useQuery(api.admin.listLoans);
  if (loans === undefined) return <Spinner />;
  if (loans.length === 0) return <EmptyState title="No loans yet" />;
  return (
    <Table head={["Tool", "Dates", "Lender", "Borrower", "Status", "Reminders"]}>
      {loans.map((l) => (
        <tr key={l._id}>
          <td className="px-4 py-2.5 font-medium text-stone-900">{l.toolName}</td>
          <td className="px-4 py-2.5 whitespace-nowrap">{formatRange(l.startDate, l.endDate)}</td>
          <td className="px-4 py-2.5" title={l.owner.email}>{l.owner.firstName}</td>
          <td className="px-4 py-2.5" title={l.borrower.email}>{l.borrower.firstName}</td>
          <td className="px-4 py-2.5"><LoanStatusBadge status={l.status} overdue={l.isOverdue} /></td>
          <td className="px-4 py-2.5 text-stone-600">
            {l.reminderCount > 0 && l.lastReminderAt
              ? `${l.reminderCount} · last ${timeAgo(l.lastReminderAt)}`
              : "—"}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function UsersTab() {
  const users = useQuery(api.admin.listUsers);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  if (users === undefined) return <Spinner />;
  return (
    <Table head={["Name", "Email", "Role", "Trusted Lender", ""]}>
      {users.map((u) => (
        <tr key={u._id}>
          <td className="px-4 py-2.5 font-medium text-stone-900">{u.firstName}</td>
          <td className="px-4 py-2.5 text-stone-600">{u.email}</td>
          <td className="px-4 py-2.5">{u.role === "admin" ? <Badge tone="blue">Admin</Badge> : "User"}</td>
          <td className="px-4 py-2.5">{u.trustedLender ? <Badge tone="green">Trusted</Badge> : "—"}</td>
          <td className="px-4 py-2.5 text-right">
            <LoanAction
              label={u.trustedLender ? "Remove badge" : "Mark trusted"}
              variant={u.trustedLender ? "secondary" : "primary"}
              run={() => setTrusted({ userId: u._id, trusted: !u.trustedLender })}
            />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function AutomationTab() {
  const health = useQuery(api.admin.automationHealth);
  const retry = useMutation(api.admin.retryDelivery);
  if (health === undefined) return <Spinner />;
  const deliveries = [...health.failedDeliveries, ...health.skippedDeliveries];
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Deliveries in flight" value={health.pendingCount} />
        <Stat label="Failed / skipped deliveries" value={deliveries.length} alert={deliveries.length > 0} />
        <Stat label="Failed n8n executions" value={health.workflowFailures.length} alert={health.workflowFailures.length > 0} />
      </div>

      <section>
        <h2 className="mb-3 font-semibold text-stone-900">Webhook deliveries to n8n</h2>
        {deliveries.length === 0 ? (
          <p className="text-sm text-stone-500">No failed deliveries. 🎉</p>
        ) : (
          <Table head={["Event", "Status", "Attempts", "Last error", "Created", ""]}>
            {deliveries.map((d) => (
              <tr key={d._id}>
                <td className="px-4 py-2.5 font-mono text-xs">{d.event}</td>
                <td className="px-4 py-2.5"><Badge tone={d.status === "failed" ? "red" : "amber"}>{d.status}</Badge></td>
                <td className="px-4 py-2.5">{d.attempts}</td>
                <td className="px-4 py-2.5 text-stone-600">{d.lastError ?? "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-stone-500">{timeAgo(d._creationTime)}</td>
                <td className="px-4 py-2.5 text-right">
                  <LoanAction label="Retry" run={() => retry({ outboxId: d._id })} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-stone-900">Failed n8n executions</h2>
        {health.workflowFailures.length === 0 ? (
          <p className="text-sm text-stone-500">No failed executions reported.</p>
        ) : (
          <Table head={["Workflow", "Node", "Message", "Execution", "When"]}>
            {health.workflowFailures.map((f) => (
              <tr key={f._id}>
                <td className="px-4 py-2.5 font-medium">{f.workflowName}</td>
                <td className="px-4 py-2.5 text-stone-600">{f.lastNode ?? "—"}</td>
                <td className="px-4 py-2.5 text-stone-600">{f.message}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{f.executionId}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-stone-500">{timeAgo(f.occurredAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${alert ? "text-red-700" : "text-stone-900"}`}>{value}</p>
    </Card>
  );
}
