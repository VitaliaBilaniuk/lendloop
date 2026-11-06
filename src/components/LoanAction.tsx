"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/format";
import { Button } from "./ui";

/** A button that runs one loan mutation and shows its own pending/error state. */
export function LoanAction({
  label,
  run,
  variant = "secondary",
  confirm,
}: {
  label: string;
  run: () => Promise<unknown>;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  const [pending, setPending] = useState(false);
  async function onClick() {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    try {
      await run();
    } catch (e) {
      window.alert(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button variant={variant} disabled={pending} onClick={onClick}>
      {pending ? "…" : label}
    </Button>
  );
}
