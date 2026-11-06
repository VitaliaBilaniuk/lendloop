"use client";

import { errorMessage } from "@/lib/format";
import { Button, ErrorText } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <ErrorText>{errorMessage(error)}</ErrorText>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
