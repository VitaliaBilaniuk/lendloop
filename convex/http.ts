import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { inboundMessage, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/signing";

// Endpoints called by n8n. Every request must carry a valid HMAC signature
// made with N8N_CALLBACK_SIGNING_SECRET (distinct from the outbound secret).

const MAX_BODY_BYTES = 8 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type Handler = (ctx: ActionCtx, body: unknown) => Promise<Response>;

/**
 * Reads the body but stops as soon as it exceeds `limit` bytes, so a
 * chunked request without Content-Length cannot make us buffer it all.
 */
async function readBodyCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Wraps a handler with size limits, signature verification and safe errors. */
function signed(handler: Handler) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.N8N_CALLBACK_SIGNING_SECRET;
    if (!secret) {
      console.error("N8N_CALLBACK_SIGNING_SECRET is not set; rejecting n8n callback");
      return json(503, { error: "not_configured" });
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) return json(413, { error: "payload_too_large" });
    const raw = await readBodyCapped(request, MAX_BODY_BYTES);
    if (raw === null) return json(413, { error: "payload_too_large" });

    const path = new URL(request.url).pathname;
    const valid = await verify({
      secret,
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
      message: (ts) => inboundMessage(ts, request.method, path, raw),
    });
    // Deliberately vague: do not tell callers which check failed.
    if (!valid) return json(401, { error: "invalid_signature" });

    let body: unknown = null;
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { error: "invalid_json" });
      }
    }
    try {
      return await handler(ctx, body);
    } catch (e) {
      console.error("n8n callback failed", e);
      return json(500, { error: "internal_error" }); // no internals leaked
    }
  });
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
const str = (x: unknown, max: number) => (typeof x === "string" && x.length > 0 && x.length <= max ? x : null);
const optStr = (x: unknown, max: number) => (x === undefined || x === null ? undefined : str(x, max) ?? undefined);

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: signed(async (ctx) => json(200, await ctx.runQuery(internal.automation.overdueLoans, {}))),
});

http.route({
  path: "/n8n/automation-events",
  method: "POST",
  handler: signed(async (ctx, body) => {
    if (!isObject(body)) return json(400, { error: "invalid_body" });
    const idempotencyKey = str(body.idempotencyKey, 100);
    const loanId = str(body.loanId, 64);
    const kind = body.kind;
    const status = body.status;
    if (
      !idempotencyKey ||
      !loanId ||
      (kind !== "request_notification" && kind !== "overdue_reminder") ||
      (status !== "sent" && status !== "failed")
    ) {
      return json(400, { error: "invalid_body" });
    }
    const result = await ctx.runMutation(internal.automation.recordEvent, {
      idempotencyKey,
      loanId,
      kind,
      status,
      channel: optStr(body.channel, 40),
      detail: optStr(body.detail, 300),
    });
    if (!result.ok) return json(422, { error: result.error });
    return json(200, result);
  }),
});

http.route({
  path: "/n8n/workflow-failures",
  method: "POST",
  handler: signed(async (ctx, body) => {
    if (!isObject(body)) return json(400, { error: "invalid_body" });
    const executionId = str(String(body.executionId ?? ""), 64);
    const workflowName = str(body.workflowName, 120);
    const message = typeof body.message === "string" ? body.message.slice(0, 500) : "Unknown error";
    if (!executionId || !workflowName) return json(400, { error: "invalid_body" });
    const result = await ctx.runMutation(internal.automation.recordFailure, {
      executionId,
      workflowName,
      lastNode: optStr(body.lastNode, 120),
      message: message || "Unknown error",
    });
    return json(200, result);
  }),
});

export default http;
