import { mutation, query } from "./_generated/server";
import { fail, getCurrentUser } from "./lib/auth";
import { firstNameOf } from "./lib/text";

/**
 * Creates or refreshes the Convex user record for the signed-in Clerk user.
 * Called by the client right after sign-in. Profile fields come from the
 * verified JWT, never from client arguments, and role is never touched here.
 */
export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) fail("You must be signed in.");
    const email = identity.email?.toLowerCase();
    if (!email) fail("Your account needs an email address.");
    // Custom Clerk claims may arrive as strings, so check both forms.
    const verified: unknown = identity.emailVerified;
    if (verified === false || verified === "false") fail("Please verify your email address first.");

    const firstName = firstNameOf(identity.givenName ?? identity.name);
    const existing = await getCurrentUser(ctx);
    if (existing !== null) {
      if (existing.email !== email || existing.firstName !== firstName) {
        await ctx.db.patch(existing._id, { email, firstName });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      firstName,
      role: "user",
      trustedLender: false,
    });
  },
});

/** The signed-in user's own profile (role is needed to render admin UI). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    return {
      _id: user._id,
      firstName: user.firstName,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});
