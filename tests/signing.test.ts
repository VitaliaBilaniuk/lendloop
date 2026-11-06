import { describe, expect, test } from "vitest";
import { inboundMessage, outboundMessage, sign, verify } from "../convex/lib/signing";
import { addDays, isValidIsoDate, rangesOverlap } from "../convex/lib/dates";

const secret = "s".repeat(40);
const now = 1_800_000_000;

describe("HMAC signing", () => {
  test("round-trips and binds method, path and body", async () => {
    const ts = String(now);
    const sig = await sign(secret, inboundMessage(ts, "POST", "/n8n/x", "{}"));
    const check = (method: string, path: string, body: string, s = sig) =>
      verify({ secret, timestamp: ts, signature: s, message: (t) => inboundMessage(t, method, path, body), nowSeconds: now });

    expect(await check("POST", "/n8n/x", "{}")).toBe(true);
    expect(await check("GET", "/n8n/x", "{}")).toBe(false);
    expect(await check("POST", "/n8n/y", "{}")).toBe(false);
    expect(await check("POST", "/n8n/x", '{"a":1}')).toBe(false);
    const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(await check("POST", "/n8n/x", "{}", tampered)).toBe(false);
  });

  test("rejects stale, future, malformed and wrong-secret signatures", async () => {
    const body = "{}";
    const ts = String(now);
    const sig = await sign(secret, outboundMessage(ts, body));
    const v = (o: Partial<Parameters<typeof verify>[0]>) =>
      verify({ secret, timestamp: ts, signature: sig, message: (t) => outboundMessage(t, body), nowSeconds: now, ...o });

    expect(await v({})).toBe(true);
    expect(await v({ nowSeconds: now + 301 })).toBe(false);
    expect(await v({ nowSeconds: now - 301 })).toBe(false);
    expect(await v({ signature: "garbage" })).toBe(false);
    expect(await v({ signature: null })).toBe(false);
    expect(await v({ timestamp: "abc" })).toBe(false);
    expect(await v({ secret: "x".repeat(40) })).toBe(false);
  });

  test("refuses short secrets", async () => {
    await expect(sign("short", "msg")).rejects.toThrow();
  });
});

describe("dates", () => {
  test("validates calendar dates", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-2-3")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  test("detects inclusive overlaps", () => {
    expect(rangesOverlap("2026-01-01", "2026-01-05", "2026-01-05", "2026-01-07")).toBe(true);
    expect(rangesOverlap("2026-01-01", "2026-01-04", "2026-01-05", "2026-01-07")).toBe(false);
  });
});
