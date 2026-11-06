import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { addDays, todayUtc } from "../convex/lib/dates";
import { inboundMessage, sign } from "../convex/lib/signing";
import { CALLBACK_SECRET, setup, signIn, type T } from "./setup";

async function signedFetch(t: T, method: "GET" | "POST", path: string, body = "", secret = CALLBACK_SECRET) {
  const ts = String(Math.floor(Date.now() / 1000));
  return t.fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": ts,
      "X-LendLoop-Signature": await sign(secret, inboundMessage(ts, method, path, body)),
    },
    body: method === "POST" ? body : undefined,
  });
}

/** An approved loan that ended three days ago. */
async function overdueWorld() {
  const t = setup();
  const alice = await signIn(t, "Alice");
  const bob = await signIn(t, "Bob");
  const today = todayUtc();
  const loanId = await t.run(async (ctx) => {
    const toolId = await ctx.db.insert("tools", {
      ownerId: alice.userId, name: "Ladder", category: "ladders", condition: "good", description: "", status: "active",
    });
    return await ctx.db.insert("loans", {
      toolId, ownerId: alice.userId, borrowerId: bob.userId, toolName: "Ladder",
      startDate: addDays(today, -10), endDate: addDays(today, -3), status: "approved",
    });
  });
  return { t, loanId, bob, today };
}

describe("n8n HTTP endpoints", () => {
  test("reject unsigned, wrongly signed and replayed-to-other-path requests", async () => {
    const { t } = await overdueWorld();
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);
    expect((await signedFetch(t, "GET", "/n8n/overdue-loans", "", "w".repeat(40))).status).toBe(401);

    // A valid signature for one path must not work on another.
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await sign(CALLBACK_SECRET, inboundMessage(ts, "GET", "/n8n/overdue-loans", ""));
    const res = await t.fetch("/n8n/workflow-failures", {
      method: "POST",
      headers: { "X-LendLoop-Timestamp": ts, "X-LendLoop-Signature": sig },
      body: "",
    });
    expect(res.status).toBe(401);
  });

  test("overdue endpoint returns only the minimal fields", async () => {
    const { t, loanId, today } = await overdueWorld();
    const res = await signedFetch(t, "GET", "/n8n/overdue-loans");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.loans).toEqual([
      {
        loanId,
        reminderKey: `overdue:${loanId}:${today}`,
        borrower: { email: "bob@example.com", firstName: "Bob" },
        toolName: "Ladder",
        endDate: addDays(today, -3),
        daysOverdue: 3,
      },
    ]);
  });

  test("reminder write-back is idempotent and removes the loan from today's batch", async () => {
    const { t, loanId, today, bob } = await overdueWorld();
    const body = JSON.stringify({
      idempotencyKey: `overdue:${loanId}:${today}`, loanId, kind: "overdue_reminder", status: "sent", channel: "email",
    });
    const first = await signedFetch(t, "POST", "/n8n/automation-events", body);
    const second = await signedFetch(t, "POST", "/n8n/automation-events", body);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
    const loan = await t.run((ctx) => ctx.db.get(loanId as Id<"loans">));
    expect(loan?.reminderCount).toBe(1);

    const again = await (await signedFetch(t, "GET", "/n8n/overdue-loans")).json();
    expect(again.loans).toHaveLength(0);

    // The borrower sees the activity on their loan.
    const [mine] = await bob.as.query(api.loans.myRequests, {});
    expect(mine.activity[0]).toMatchObject({ kind: "overdue_reminder", status: "sent" });
  });

  test("write-back rejects keys that do not belong to the loan", async () => {
    const { t, loanId, today } = await overdueWorld();
    const body = JSON.stringify({
      idempotencyKey: `overdue:someotherloan:${today}`, loanId, kind: "overdue_reminder", status: "sent",
    });
    expect((await signedFetch(t, "POST", "/n8n/automation-events", body)).status).toBe(422);
  });

  test("rejects keys in the wrong format for their kind", async () => {
    const { t, loanId, today } = await overdueWorld();
    for (const idempotencyKey of [`overdue:${loanId}`, `overdue:${loanId}:2026-13-45`, `notify:${loanId}:${today}`]) {
      const kind = idempotencyKey.startsWith("overdue") ? "overdue_reminder" : "request_notification";
      const body = JSON.stringify({ idempotencyKey, loanId, kind, status: "sent" });
      const res = await signedFetch(t, "POST", "/n8n/automation-events", body);
      expect(await res.json()).toEqual({ error: "invalid_key" });
    }
  });

  test("rejects oversized bodies even without Content-Length", async () => {
    const { t } = await overdueWorld();
    const chunk = new TextEncoder().encode("x".repeat(4096));
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(chunk); // 16 KB > 8 KB cap
        controller.close();
      },
    });
    const res = await t.fetch("/n8n/automation-events", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(res.status).toBe(413);
  });

  test("workflow failures are recorded once per execution", async () => {
    const { t } = await overdueWorld();
    const body = JSON.stringify({ executionId: "42", workflowName: "Overdue reminders", message: "boom" });
    await signedFetch(t, "POST", "/n8n/workflow-failures", body);
    await signedFetch(t, "POST", "/n8n/workflow-failures", body);
    expect(await t.run((ctx) => ctx.db.query("automationFailures").collect())).toHaveLength(1);
  });
});
