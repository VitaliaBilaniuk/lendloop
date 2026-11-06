import type { AuthConfig } from "convex/server";

// Clerk issues the JWT (template / integration named "convex"); Convex
// verifies its signature against the issuer's JWKS and the audience below.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
