import { fail } from "./auth";

/**
 * Normalises user-supplied text: trims, collapses control characters and
 * enforces length bounds. React escapes output, so we do not HTML-encode;
 * we just keep the data clean and bounded.
 */
export function cleanText(
  value: string,
  field: string,
  { min = 0, max }: { min?: number; max: number },
): string {
  // Strip ASCII control chars except newline/tab, then trim.
  const cleaned = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (cleaned.length < min) {
    fail(min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`);
  }
  if (cleaned.length > max) fail(`${field} must be at most ${max} characters.`);
  return cleaned;
}

/** Keeps only the first name for display to other users (data minimisation). */
export function firstNameOf(name: string | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  // Never fall back to the email local part: it would leak contact details.
  return first ? first.slice(0, 40) : "Neighbor";
}
