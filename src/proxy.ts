import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Optimistic page guard only: it keeps signed-out visitors off app pages.
// Real authorisation happens in every Convex function.
const isProtectedRoute = createRouteMatcher([
  "/browse(.*)",
  "/listings(.*)",
  "/requests(.*)",
  "/incoming(.*)",
  "/admin(.*)",
]);

function convexOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!raw) return [];
  const url = new URL(raw);
  const ws = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
  return [url.origin, ws];
}

export default clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) await auth.protect();
  },
  {
    contentSecurityPolicy: {
      // strict: nonce + 'strict-dynamic' instead of allowing any https: script.
      strict: true,
      directives: {
        "connect-src": convexOrigins(),
        "img-src": ["data:"],
        "object-src": ["none"],
        "base-uri": ["self"],
        "frame-ancestors": ["none"],
      },
    },
  },
);

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
