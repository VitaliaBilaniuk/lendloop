/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

export const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js"]);

export const CALLBACK_SECRET = "test-callback-secret-0123456789abcdef0123";

export function setup() {
  process.env.N8N_CALLBACK_SIGNING_SECRET = CALLBACK_SECRET;
  delete process.env.N8N_LOAN_EVENTS_WEBHOOK_URL;
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof setup>;

/** Signs in as a user and creates their Convex record. */
export async function signIn(t: T, name: string) {
  const as = t.withIdentity({
    subject: name,
    issuer: "https://clerk.test",
    tokenIdentifier: `https://clerk.test|${name}`,
    email: `${name.toLowerCase()}@example.com`,
    emailVerified: true,
    givenName: name,
  });
  const userId = await as.mutation(api.users.ensureCurrent, {});
  return { as, userId };
}
