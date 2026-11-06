"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { LIMITS } from "@/lib/constants";
import { Button, ErrorText, Field, inputClass, Modal, useAction } from "./ui";

/** Admin moderation: removes any listing with a recorded reason. */
export function RemoveListingDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string } | null;
  onClose: () => void;
}) {
  const removeListing = useMutation(api.admin.removeListing);
  const [reason, setReason] = useState("");
  const { pending, error, run } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tool) return;
    if (await run(() => removeListing({ toolId: tool._id, reason }))) {
      setReason("");
      onClose();
    }
  }

  return (
    <Modal open={tool !== null} onClose={onClose} title={`Remove “${tool?.name ?? ""}”`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-stone-600">
          The listing is hidden for everyone and open requests are cancelled. Approved loans stay
          active so the owner can still mark them returned.
        </p>
        <Field label="Reason" hint="Stored in the audit log.">
          <input
            required
            minLength={3}
            maxLength={LIMITS.adminReason.max}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? "Removing…" : "Remove listing"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
