# LendLoop

**Borrow what you need. Lend what you don't.**

LendLoop is a neighborhood tool-lending board. Neighbors list tools they're happy to lend, request to borrow each other's tools for a date range, and get automated notifications and overdue reminders through n8n.

| Layer | Tech |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript |
| Auth | Clerk (Core 3 / `@clerk/nextjs` 7) |
| Data + backend logic | Convex (queries, mutations, scheduled actions, HTTP actions, crons) |
| Automation | n8n 2.x (self-hosted via Docker Compose) |

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Local setup](#local-setup)
4. [Environment variables](#environment-variables)
5. [Roles and access control](#roles-and-access-control)
6. [n8n integration](#n8n-integration)
7. [Security decisions](#security-decisions)
8. [Data minimisation](#data-minimisation)
9. [Testing](#testing)
10. [Running in production: what I would change](#running-in-production-what-i-would-change)

---

## Features

**Public page** (`/`)
- Tagline, plus a live, read-only list of available tools showing **name and category only**. No owner, description or loan data is sent.
- A "Sign in to lend or borrow" button that opens Clerk.

**Signed-in app**
- **Browse** (`/browse`): all tools with an availability badge (*Available*, *Reserved from …*, *On loan until …*), filterable by category, with a "Request" dialog that takes a date range and an optional message.
- **My listings** (`/listings`): create, edit and delete your own tools (name, category, condition, short description).
- **My requests** (`/requests`): what you've asked to borrow. You can withdraw or cancel.
- **Incoming requests** (`/incoming`): approve or decline requests for your tools, cancel an approved loan before it starts, and mark loans as returned.
- **Automation activity** on every loan card, e.g. "✉︎ Reminder sent 2 days ago" or "⚠︎ Notification failed 5 minutes ago".
- **Admin** (`/admin`): view all loans, manage the *Trusted Lender* badge, remove any listing (removal is audited), and an **Automation** tab that shows failed or skipped webhook deliveries (with a retry button) and failed n8n executions.

### Loan lifecycle

```
            approve (lender)          mark returned (lender, after start)
 pending ───────────────────▶ approved ─────────────────────────────▶ returned
   │ decline (lender)            │ cancel (either side, before start)
   ▼                             ▼
 declined                     cancelled ◀── withdraw (borrower, while pending)
```

Server-side rules:
- You can't borrow your own tool.
- Dates are calendar dates in UTC: no start in the past, the end on or after the start, at most 30 days per loan, and at most 180 days ahead.
- An approval is rejected if it overlaps another approved loan.
- A borrower can have at most one pending request per tool and 10 in total. A user can have at most 50 active listings.

---

## Architecture

```
┌──────────────┐  Clerk JWT   ┌──────────────────────────────────────────────┐
│  Next.js app │─────────────▶│ Convex                                       │
│  (browser)   │◀── realtime ─│  queries / mutations   (RBAC in every fn)    │
└──────────────┘   queries    │     │                                        │
       ▲                      │     │ same transaction                       │
       │ sign-in              │     ▼                                        │
┌──────┴──────┐               │  outbox row ──▶ scheduled action "deliver"   │
│    Clerk    │               │                  │  HMAC-signed POST          │
└─────────────┘               │                  │  retries w/ backoff        │
                              │  HTTP actions ◀──┼──── signed callbacks ──┐   │
                              │  /n8n/overdue-loans        (GET)          │   │
                              │  /n8n/automation-events    (POST)         │   │
                              │  /n8n/workflow-failures    (POST)         │   │
                              └──────────────────┼────────────────────────┼───┘
                                                 ▼                        │
                              ┌──────────────────────────────────────────┴───┐
                              │ n8n                                          │
                              │  1. Loan event notifications (webhook)       │
                              │  2. Overdue reminders (daily schedule)       │
                              │  3. Error handler (error workflow)           │
                              └──────────────────────────────────────────────┘
```

### Repository layout

```
convex/
  schema.ts            tables, indexes, shared validators
  auth.config.ts       Clerk as the JWT issuer
  users.ts             user sync from the verified JWT, `me`
  tools.ts             listings (public + authenticated queries, CRUD)
  loans.ts             borrow requests and the loan state machine
  admin.ts             admin-only functions + internal `setRole`
  notifications.ts     outbox delivery to n8n (signing, retries, sweeper)
  automation.ts        internal functions behind the n8n HTTP endpoints
  http.ts              signed HTTP endpoints for n8n
  crons.ts             outbox safety-net cron
  lib/                 auth guards, signing, dates, text cleaning, constants
src/
  proxy.ts             Clerk middleware: route guard + nonce-based CSP
  app/page.tsx         public landing page
  app/(app)/…          signed-in pages: browse, listings, requests, incoming, admin
  components/          UI building blocks
n8n/workflows/         exported n8n workflows (no secrets)
tests/                 Vitest + convex-test suites
docker-compose.yml     local n8n
```

---

## Local setup

### Prerequisites

- Node.js ≥ 20.9 and npm
- Docker with Compose v2, for n8n (needs a reasonably recent Docker Engine; see the troubleshooting note below)
- A free [Clerk](https://clerk.com) account
- A [Convex](https://convex.dev) account (optional for local development: `npx convex dev` can run a local backend without one)

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Clerk

1. Create an application in the Clerk dashboard and put its keys in `.env.local`:
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
2. Under **Integrations**, enable **Convex**. With the integration on, Convex receives Clerk's **session token**, which doesn't include email or name by default. Go to **Configure → Sessions → Customize session token** and add:
   ```json
   {
     "email": "{{user.primary_email_address}}",
     "email_verified": "{{user.email_verified}}",
     "given_name": "{{user.first_name}}"
   }
   ```
   Without this, sign-in stops at *"Your account needs an email address."* (Alternative: skip the integration and create a JWT template named `convex` with the same claims.)
3. Copy the **Frontend API URL** (e.g. `https://your-app.clerk.accounts.dev`). You'll need it in the next step.

### 3. Convex

```bash
npx convex dev        # choose a cloud dev deployment, or a local one
```

The first run writes `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` to `.env.local`. Then set the backend variables on the deployment. They live in Convex, not in any file:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
npx convex env set APP_URL http://localhost:3000
npx convex env set N8N_LOAN_EVENTS_WEBHOOK_URL http://localhost:5678/webhook/lendloop/loan-events
npx convex env set N8N_WEBHOOK_SIGNING_SECRET  "$(openssl rand -hex 32)"
npx convex env set N8N_CALLBACK_SIGNING_SECRET "$(openssl rand -hex 32)"
```

> **Local or cloud Convex?** A *local* Convex deployment runs on your machine, so it can reach n8n at `localhost:5678` and n8n can reach it at `host.docker.internal:3211`. With a *cloud* deployment, Convex can't reach your laptop. Expose n8n with a tunnel (e.g. `cloudflared tunnel --url http://localhost:5678`), use that HTTPS URL for `N8N_LOAN_EVENTS_WEBHOOK_URL`, and set n8n's `CONVEX_SITE_URL` to `https://<deployment>.convex.site`.

Keep `npx convex dev` running in its own terminal (or use `npm run dev:convex`).

### 4. Next.js

```bash
npm run dev           # http://localhost:3000
```

### 5. n8n

```bash
cp n8n/.env.example n8n/.env
```

Fill in `n8n/.env`:
- `N8N_ENCRYPTION_KEY`: `openssl rand -hex 32`
- `LENDLOOP_WEBHOOK_SECRET`: the same value as Convex's `N8N_WEBHOOK_SIGNING_SECRET`
- `LENDLOOP_CALLBACK_SECRET`: the same value as Convex's `N8N_CALLBACK_SIGNING_SECRET`
- `CONVEX_SITE_URL`: `http://host.docker.internal:3211` for local Convex, or `https://<deployment>.convex.site` for cloud

To read the values you set in Convex: `npx convex env get N8N_WEBHOOK_SIGNING_SECRET`.

```bash
npm run n8n:up        # docker compose up -d
# open http://localhost:5678 once and create the owner account, then:
npm run n8n:import    # imports the 3 workflows, publishes them, restarts n8n
```

Note that **all three** workflows must be published, including the error handler. n8n 2.x refuses to run an unpublished error workflow.

#### Running n8n without Docker

Current Docker Desktop doesn't support older macOS versions (e.g. 13 Ventura). In that case, run the same pinned n8n with Node 24 through nvm. Your default Node version isn't changed.

```bash
nvm install 24              # once
npm run n8n:local:import    # first run installs n8n@2.46.6 into n8n/.runtime, then imports + publishes the workflows
npm run n8n:local           # starts n8n on http://localhost:5678 (create the owner account on first visit)
```

`n8n/run-local.sh` reads the same `n8n/.env`, applies the same settings as `docker-compose.yml`, listens on `127.0.0.1` only, keeps its data in `n8n/.data/` (git-ignored), and rewrites `host.docker.internal` to `127.0.0.1`. Run other n8n CLI commands through it, e.g. `bash n8n/run-local.sh execute --id=LendLoopOverdue1`. Import and publish while n8n is stopped, or restart it afterwards.

### 6. Make yourself an admin

Sign in once in the app so your user record exists, then:

```bash
npx convex run admin:setRole '{"email":"you@example.com","role":"admin"}'
```

Roles can only be changed this way (CLI or Convex dashboard). No public API changes them.

### Trying the automation

- **Request notification**: sign in as two users (e.g. one in a private window). User B requests a tool from user A. The n8n container logs `[LendLoop] request_notification -> a***@example.com: "New request for your …"` (`docker compose logs -f n8n`), and the loan card shows "✉︎ Notification sent just now".
- **Overdue reminders**: run the workflow on demand instead of waiting for 09:00 UTC:
  `docker compose exec n8n n8n execute --id=LendLoopOverdue1`. You can also open the workflow and click *Execute workflow*. A loan is overdue when it's approved, not returned, and its end date is before today (UTC).
- **Failure visibility**: change `LENDLOOP_CALLBACK_SECRET` in `n8n/.env`, restart n8n and trigger a request. The Convex side keeps working, and the failures appear under **Admin › Automation**.

### Troubleshooting

- `failed to register layer … invalid tar header` when pulling n8n means your Docker Engine is too old for the image's layer format. Update Docker Desktop, or [run n8n without Docker](#running-n8n-without-docker).
- Webhooks return 404 for a few seconds after n8n starts. The Convex outbox retries automatically.

---

## Environment variables

### Next.js (`.env.local`)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Convex client URL (also added to the CSP `connect-src`) |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex HTTP actions URL (informational) |
| `CONVEX_DEPLOYMENT` | Used by the Convex CLI |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key (server only) |

### Convex deployment (`npx convex env set …`)

| Variable | Purpose |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk Frontend API URL. Convex validates JWTs against its JWKS, and the audience must be `convex`. |
| `APP_URL` | Base URL used for links in notifications |
| `N8N_LOAN_EVENTS_WEBHOOK_URL` | n8n webhook URL. Must be HTTPS, except `localhost` / `127.0.0.1` / `host.docker.internal` in development. |
| `N8N_WEBHOOK_SIGNING_SECRET` | Signs Convex → n8n webhooks (≥ 32 chars) |
| `N8N_CALLBACK_SIGNING_SECRET` | Verifies n8n → Convex calls (≥ 32 chars, different from the above) |

### n8n (`n8n/.env`, git-ignored)

| Variable | Purpose |
| --- | --- |
| `N8N_ENCRYPTION_KEY` | Encrypts n8n's credential store |
| `LENDLOOP_WEBHOOK_SECRET` | The same value as `N8N_WEBHOOK_SIGNING_SECRET` |
| `LENDLOOP_CALLBACK_SECRET` | The same value as `N8N_CALLBACK_SIGNING_SECRET` |
| `CONVEX_SITE_URL` | Convex HTTP actions base URL as seen from n8n |

Non-secret n8n settings (timezone, execution pruning, Code node permissions) are in `docker-compose.yml`.

---

## Roles and access control

There are two roles, stored on the Convex `users` document: `user` (the default) and `admin`.

| Action | user | admin |
| --- | --- | --- |
| See the public list | ✓ (also anonymous) | ✓ |
| Browse tools with availability | ✓ | ✓ |
| Create a listing | ✓ (owner = self) | ✓ |
| Edit / delete a listing | own only | own only |
| Remove *any* listing (with an audited reason) | ✗ | ✓ |
| Request to borrow | others' tools only | others' tools only |
| Approve / decline / mark returned | requests on own tools | requests on own tools |
| Withdraw / cancel | own requests; approved loans before start | same |
| View all loans | ✗ | ✓ |
| Grant / revoke Trusted Lender | ✗ | ✓ |
| Change roles | ✗ | ✗ (CLI / dashboard only) |

How it's enforced:
- **Every public Convex function** resolves the caller from the verified Clerk JWT (`ctx.auth.getUserIdentity()` → `users.by_token`) using the helpers in `convex/lib/auth.ts` (`requireUser`, `requireAdmin`). The frontend never sends a user ID.
- **Ownership comes from the server.** A listing's `ownerId` is set from the session. Loan actions check `loan.ownerId` or `loan.borrowerId` against the caller, *and* that the caller has the right side of the loan for that action (a borrower can't approve their own request).
- **The "not found" message is the same** for missing records and records you don't own, so IDs can't be probed.
- **Roles can't be self-assigned.** `users.ensureCurrent` only copies the email and first name from the JWT. The role changes only through the internal mutation `admin:setRole`, which the browser can't call.
- The UI hides the admin tab and buttons for convenience only. `tests/rbac.test.ts` calls the functions directly as non-admins and as outsiders to check that the server rejects them.
- `src/proxy.ts` redirects signed-out visitors away from app pages. This is a UX guard, not the authorisation layer.

---

## n8n integration

### Workflows (`n8n/workflows/`)

1. **LendLoop: loan event notifications** (`lendloop-loan-event-notifications.json`)
   `Webhook (raw body)` → `Verify signature` → `Signature valid?` → `Respond 202` / `Respond 401` → `Skip already-handled deliveries` (dedupes on `deliveryId` across executions) → `Compose message` → `Send notification (mock)` (3 tries) → `Sign write-back` → `Report result to Convex` (3 tries) → if the send failed, `Fail execution`.

2. **LendLoop: overdue reminders** (`lendloop-overdue-reminders.json`)
   `Every day at 09:00` (or `Run on demand`) → `Sign request` → `Fetch overdue loans` (signed GET, 3 tries) → `One item per loan` → `Compose reminder` → `Send reminder (mock)` (3 tries, error output) → `Mark failed` on that path → `Sign write-back` → `Write reminder status to Convex` (3 tries) → if any reminder failed, `Fail execution`.

3. **LendLoop: error handler** (`lendloop-error-handler.json`)
   `Error Trigger` → `Summarise and sign` → `Report failure to Convex`. Workflows 1 and 2 use it as their *Error Workflow* (`settings.errorWorkflow`).

The notification channel is a **mock**: a Code node logs a masked address and the subject. To send real email, replace `Send … (mock)` with a *Send Email* node that uses an SMTP credential stored in n8n.

### Signing (both directions)

| Direction | Secret | Signed string | Headers |
| --- | --- | --- | --- |
| Convex → n8n | `N8N_WEBHOOK_SIGNING_SECRET` | `${timestamp}.${rawBody}` | `X-LendLoop-Timestamp`, `X-LendLoop-Signature: v1=<hex HMAC-SHA256>` |
| n8n → Convex | `N8N_CALLBACK_SIGNING_SECRET` | `${timestamp}.${METHOD}.${path}.${rawBody}` | same |

- Each direction has its **own secret**, so leaking one doesn't let an attacker forge traffic the other way.
- Verifiers reject timestamps more than **±5 minutes** away (replay window), malformed signatures and bad JSON. Comparison is **constant-time**: `crypto.subtle.verify` in Convex, `crypto.timingSafeEqual` in n8n.
- n8n → Convex also signs the **method and path**, so a valid signature for one endpoint can't be replayed against another (there's a test for this).
- n8n verifies the **raw body bytes** (Webhook "Raw Body" option), not re-serialised JSON. On the way back it sends the body as a raw string, so the signed bytes are exactly the bytes that arrive.
- Invalid calls get a generic `401` with no detail about which check failed.

### Reliability and idempotency

**Convex → n8n uses a transactional outbox.**
- The mutation that changes a loan inserts an `outbox` row and schedules the `deliver` action *in the same transaction*. If the mutation fails, no notification is sent. If it commits, delivery is guaranteed to be attempted.
- `deliver` uses a 10 s timeout and doesn't follow redirects. Non-2xx responses and network errors are retried with **exponential backoff and jitter** (30 s → … → 30 min, 6 attempts).
- After the last attempt the row becomes `failed`, a *failed* activity entry appears on the loan, and admins can retry it from **Admin › Automation**.
- If n8n isn't configured, the row is marked `skipped`, which is also visible to admins. Nothing fails silently.
- A cron runs every 15 minutes and re-queues pending rows whose scheduled job should have run long ago, in case of platform-level action failures.

**Write-backs are idempotent.**
- Every notification has an idempotency key: `notify:<outboxId>` for request events and `overdue:<loanId>:<YYYY-MM-DD>` for reminders. `automationEvents` is unique on that key.
- A retried write-back returns `{duplicate: true}` and changes nothing. A `failed` result can be upgraded to `sent` by a later successful retry, but `sent` is never downgraded.
- `reminderCount` is incremented only when a key first becomes `sent`.
- Convex also checks that the key belongs to the loan being written and to the declared kind (otherwise `422`).

**Duplicates on the n8n side**
- Delivery is at-least-once. If Convex retries a webhook that n8n had already accepted, the *Remove Duplicates* node (keyed on `deliveryId`, persisted across executions) drops it.
- The overdue endpoint leaves out loans that already have a `sent` reminder today, so re-running the workflow the same day sends nothing new.

**Failures are always visible**
- n8n nodes that call out retry 3 times.
- Failed sends are written back as `failed` (shown on the loan), and the run is then deliberately failed.
- Any failed execution triggers the error workflow, which reports `{executionId, workflowName, lastNode, message}` to Convex (idempotent per execution). It appears under **Admin › Automation** and is also logged to stdout.

All of the above was tested end to end against n8n 2.46.6 and a local Convex backend: happy paths, invalid signatures, duplicate deliveries, a failing send node, n8n being down during delivery, and re-runs.

---

## Security decisions

- **AuthN**: Clerk issues short-lived JWTs. Convex validates their signature, issuer and audience (`convex/auth.config.ts`). User records are created from verified claims only, and unverified emails are rejected.
- **AuthZ**: done in Convex functions, never only in the UI (see [Roles and access control](#roles-and-access-control)).
- **Input validation**: Convex argument validators check types and enums. Server-side helpers also trim text, strip control characters, enforce lengths, check that dates are real calendar dates, and apply business limits (loan length, how far ahead, overlaps, per-user caps on listings and pending requests).
- **Output encoding**: React escapes everything rendered. There's no `dangerouslySetInnerHTML`.
- **Content Security Policy**: a strict per-request **nonce** CSP with `'strict-dynamic'` (Clerk middleware, `src/proxy.ts`). `connect-src` is limited to Clerk and the configured Convex origin, and it sets `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'`.
- **Other headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict `Referrer-Policy`, a locked-down `Permissions-Policy`, HSTS in production, and no `X-Powered-By`.
- **Errors**: only `ConvexError` messages, written for users, reach the client. HTTP endpoints return generic error codes and log details server-side.
- **Abuse limits**: per-user caps on listings and pending requests, bounded list sizes, and an 8 KB request body limit on HTTP endpoints.
- **Audit trail**: admin actions and listing deletions go to `auditLog`. Listings are soft-deleted, so loan history stays intact.
- **Outbound requests** from Convex require HTTPS (except known dev hosts), use timeouts, and don't follow redirects.
- **n8n hardening (compose)**: bound to `127.0.0.1`, pinned image version, telemetry off, execution data pruned after 7 days, and successful executions not stored.
- **Secrets**: none in code or in the workflow JSON (`grep` the exports: they only reference `$env.*`). Convex secrets live in the Convex deployment's environment, n8n secrets in `n8n/.env` (git-ignored), and Clerk keys in `.env.local` (git-ignored).

### Secrets in n8n: the trade-off

The HMAC secrets are read in Code nodes through `$env`. That requires `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and `NODE_FUNCTION_ALLOW_BUILTIN=crypto`. n8n credentials can't currently be read from a Code node to compute an HMAC, so environment variables are the supported option. The cost is that anyone who can *edit* workflows on this n8n instance can read its environment variables. For production, see below.

---

## Data minimisation

- **Public page**: tool name and category only.
- **Other users** see only the counterparty's *first name* and Trusted Lender badge, never their email. Booked date ranges are shown without saying who booked them.
- **Admins** see emails (needed for moderation) in the Users tab only.
- **Webhook payload to n8n**: event type, the *recipient's* email and first name, the counterparty's first name, the tool name, dates, status and a link. No user IDs, descriptions or messages between neighbors.
- **Overdue endpoint**: loan ID, the borrower's email and first name, tool name, end date and days overdue. Nothing about the lender.
- **Write-backs** carry only the key, loan ID, status, channel and a short error. The error handler redacts email addresses from error messages before sending them to Convex.
- **n8n** drops request headers after verification, logs masked addresses (`a***@example.com`), doesn't store successful executions, and prunes the rest after 7 days.
- **Request messages** come with an in-app hint not to share phone numbers or addresses.

---

## Testing

```bash
npm test          # Vitest + convex-test (RBAC, loan rules, signing, HTTP endpoints, idempotency)
npm run typecheck
npm run lint
npm run build
```

- `tests/rbac.test.ts`: anonymous vs signed-in access, ownership checks, borrower vs lender actions, admin-only functions, input validation, overlap rules, and the outbox being written.
- `tests/http.test.ts`: signature checks (missing, wrong secret, cross-endpoint replay), minimal overdue payload, idempotent write-backs, key/loan mismatch, and failure recording.
- `tests/signing.test.ts`: HMAC round trip, tampering, timestamp window, short secrets, and date helpers.

---

## Running in production: what I would change

1. **Secrets management**: move the n8n signing secrets out of `$env` and into n8n's *External Secrets* (Vault, AWS Secrets Manager, …), restrict who can edit workflows, and rotate secrets with a dual-secret grace period (accept `v1` signatures from the old and new secret for a while).
2. **Run n8n properly**: Postgres instead of SQLite, queue mode with Redis plus workers, **external task runners** (internal mode is deprecated in n8n 2.x), served over HTTPS behind a reverse proxy, with the webhook path exposed and the editor kept behind SSO or a VPN.
3. **A real notification channel**: an email provider (SES, Postmark, Resend) using n8n credentials, with SPF/DKIM, bounce handling, and an unsubscribe / notification-preferences setting per user.
4. **Clerk → Convex user sync via signed Clerk webhooks** (`user.created`, `user.updated`, `user.deleted`), instead of syncing only on sign-in. This handles email changes and account deletion (GDPR erasure) even when the user never comes back.
5. **Rate limiting**: per-user and per-IP limits on mutations (e.g. `@convex-dev/rate-limiter`) and on the public HTTP endpoints, and possibly an IP allowlist or mTLS for the n8n → Convex endpoints.
6. **Pagination** (`.paginate()`) for browse and the admin lists instead of fixed caps, plus Convex search indexes for free-text search.
7. **Timezones**: store each user's timezone, and run reminders in local mornings rather than at 09:00 UTC.
8. **Observability**: log streaming from Convex and n8n to a central system (Datadog, Axiom, …), alerts when outbox failures or n8n error reports go above zero, and a CSP `report-to` endpoint.
9. **Data retention**: TTL cleanup crons for delivered outbox rows and old automation events, plus a documented retention policy and data export / deletion on request.
10. **Delivery pipeline**: separate Convex dev/prod deployments, preview deployments per PR, CI running lint, typecheck, tests and a build, and versioned n8n workflows promoted through environments via the n8n CLI or source control.
