import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { addDays, todayUtc } from "../convex/lib/dates";
import { setup, signIn, type T } from "./setup";

const tool = { name: "Cordless drill", category: "power_tools", condition: "good", description: "18V" } as const;
const today = todayUtc();

async function world() {
  const t = setup();
  const alice = await signIn(t, "Alice"); // lender
  const bob = await signIn(t, "Bob"); // borrower
  const mallory = await signIn(t, "Mallory"); // unrelated user
  const toolId = await alice.as.mutation(api.tools.create, tool);
  return { t, alice, bob, mallory, toolId };
}

async function makeAdmin(t: T, email: string) {
  await t.mutation(internal.admin.setRole, { email, role: "admin" });
}

describe("authentication", () => {
  test("anonymous users only get the public list, without owner details", async () => {
    const { t } = await world();
    const list = await t.query(api.tools.listPublic, {});
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(["_id", "category", "name"]);
    await expect(t.query(api.tools.list, {})).rejects.toThrow(/signed in/);
    await expect(t.mutation(api.tools.create, tool)).rejects.toThrow(/signed in/);
  });

  test("unverified emails are rejected, including string-typed claims", async () => {
    const t = setup();
    for (const emailVerified of [false, "false"]) {
      const as = t.withIdentity({
        subject: "eve",
        tokenIdentifier: "https://clerk.test|eve",
        email: "eve@example.com",
        emailVerified: emailVerified as boolean,
      });
      await expect(as.mutation(api.users.ensureCurrent, {})).rejects.toThrow(/verify/);
    }
  });

  test("role cannot be self-assigned through ensureCurrent", async () => {
    const { bob } = await world();
    await bob.as.mutation(api.users.ensureCurrent, {});
    expect((await bob.as.query(api.users.me, {}))?.role).toBe("user");
  });
});

describe("listings", () => {
  test("only the owner can edit or delete a listing", async () => {
    const { alice, mallory, toolId } = await world();
    await expect(mallory.as.mutation(api.tools.update, { toolId, ...tool, name: "Mine now" })).rejects.toThrow(
      /not found/,
    );
    await expect(mallory.as.mutation(api.tools.remove, { toolId })).rejects.toThrow(/not found/);
    await alice.as.mutation(api.tools.update, { toolId, ...tool, name: "Hammer drill" });
    await alice.as.mutation(api.tools.remove, { toolId });
    expect(await alice.as.query(api.tools.mine, {})).toHaveLength(0);
  });

  test("input is validated server-side", async () => {
    const { alice } = await world();
    await expect(alice.as.mutation(api.tools.create, { ...tool, name: " " })).rejects.toThrow(/at least/);
    await expect(alice.as.mutation(api.tools.create, { ...tool, description: "x".repeat(501) })).rejects.toThrow(
      /at most/,
    );
  });
});

describe("loan workflow", () => {
  test("happy path: request, approve, return", async () => {
    const { alice, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: today, endDate: addDays(today, 2) });
    await alice.as.mutation(api.loans.approve, { loanId });
    const [listed] = await bob.as.query(api.tools.list, {});
    expect(listed.availability.state).toBe("on_loan");
    await alice.as.mutation(api.loans.markReturned, { loanId });
    expect((await bob.as.query(api.loans.myRequests, {}))[0].status).toBe("returned");
  });

  test("users can only act on loans involving them, in their role", async () => {
    const { alice, bob, mallory, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: today, endDate: today });
    // Borrower cannot approve their own request; outsiders cannot touch it.
    await expect(bob.as.mutation(api.loans.approve, { loanId })).rejects.toThrow(/not found/);
    await expect(mallory.as.mutation(api.loans.approve, { loanId })).rejects.toThrow(/not found/);
    await expect(mallory.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/not found/);
    // Lender cannot withdraw the borrower's pending request (they decline instead).
    await expect(alice.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/no longer/);
    expect(await mallory.as.query(api.loans.incoming, {})).toHaveLength(0);
  });

  test("rejects own tool, bad dates and overlapping approvals", async () => {
    const { t, alice, bob, toolId } = await world();
    await expect(alice.as.mutation(api.loans.request, { toolId, startDate: today, endDate: today })).rejects.toThrow(
      /own tool/,
    );
    await expect(
      bob.as.mutation(api.loans.request, { toolId, startDate: addDays(today, -1), endDate: today }),
    ).rejects.toThrow(/past/);
    await expect(
      bob.as.mutation(api.loans.request, { toolId, startDate: today, endDate: addDays(today, 40) }),
    ).rejects.toThrow(/at most/);

    const carol = await signIn(t, "Carol");
    const a = await bob.as.mutation(api.loans.request, { toolId, startDate: today, endDate: addDays(today, 3) });
    const b = await carol.as.mutation(api.loans.request, { toolId, startDate: addDays(today, 2), endDate: addDays(today, 4) });
    await alice.as.mutation(api.loans.approve, { loanId: a });
    await expect(alice.as.mutation(api.loans.approve, { loanId: b })).rejects.toThrow(/overlap/);
  });

  test("state changes enqueue a notification; unconfigured n8n is recorded as skipped", async () => {
    const { t, bob, toolId } = await world();
    await bob.as.mutation(api.loans.request, { toolId, startDate: today, endDate: today });
    await t.finishAllScheduledFunctions(() => {});
    const rows = await t.run((ctx) => ctx.db.query("outbox").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "request_created", status: "skipped" });
  });
});

describe("admin", () => {
  test("admin-only functions reject regular users", async () => {
    const { bob, toolId } = await world();
    await expect(bob.as.query(api.admin.listLoans, {})).rejects.toThrow(/permission/);
    await expect(bob.as.query(api.admin.listUsers, {})).rejects.toThrow(/permission/);
    await expect(bob.as.mutation(api.admin.removeListing, { toolId, reason: "spam" })).rejects.toThrow(/permission/);
    await expect(bob.as.mutation(api.admin.setTrustedLender, { userId: bob.userId, trusted: true })).rejects.toThrow(
      /permission/,
    );
  });

  test("admins can remove any listing, mark trusted lenders and see all loans", async () => {
    const { t, alice, bob, mallory, toolId } = await world();
    await makeAdmin(t, "mallory@example.com");
    await bob.as.mutation(api.loans.request, { toolId, startDate: today, endDate: today });

    expect(await mallory.as.query(api.admin.listLoans, {})).toHaveLength(1);
    await mallory.as.mutation(api.admin.setTrustedLender, { userId: alice.userId, trusted: true });
    expect((await alice.as.query(api.users.me, {}))?.trustedLender).toBe(true);

    await mallory.as.mutation(api.admin.removeListing, { toolId, reason: "Unsafe item" });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
    // Pending requests on the removed listing are cancelled.
    expect((await bob.as.query(api.loans.myRequests, {}))[0].status).toBe("cancelled");
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toEqual(["user.trust", "tool.remove"]);
  });
});
