"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/../convex/_generated/api";
import { errorMessage } from "@/lib/format";
import { ErrorText, Spinner } from "./ui";

type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;
const CurrentUserContext = createContext<Me | null>(null);

/**
 * Waits for the Clerk token to reach Convex, makes sure a Convex user record
 * exists, then exposes the profile (incl. role, for showing admin UI only).
 */
export function CurrentUserGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    ensureCurrent()
      .then(() => !cancelled && setSynced(true))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, ensureCurrent]);

  const me = useQuery(api.users.me, synced ? {} : "skip");

  if (error) return <div className="mx-auto max-w-md py-16"><ErrorText>{error}</ErrorText></div>;
  if (isLoading || !isAuthenticated || !synced || me === undefined || me === null) {
    return <Spinner label="Signing you in…" />;
  }
  return <CurrentUserContext.Provider value={me}>{children}</CurrentUserContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(CurrentUserContext);
  if (me === null) throw new Error("useMe must be used inside <CurrentUserGate>");
  return me;
}
