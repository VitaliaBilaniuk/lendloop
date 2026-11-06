"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { formatRange, todayIso } from "@/lib/format";
import { LIMITS } from "@/lib/constants";
import { Button, ErrorText, Field, inputClass, Modal, useAction } from "./ui";

export function RequestDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string; bookedRanges: { startDate: string; endDate: string }[] } | null;
  onClose: () => void;
}) {
  const requestLoan = useMutation(api.loans.request);
  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [message, setMessage] = useState("");
  const { pending, error, run } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tool) return;
    const ok = await run(() =>
      requestLoan({ toolId: tool._id, startDate, endDate, message: message.trim() || undefined }),
    );
    if (ok) {
      setMessage("");
      onClose();
    }
  }

  return (
    <Modal open={tool !== null} onClose={onClose} title={tool ? `Borrow “${tool.name}”` : ""}>
      <form onSubmit={submit} className="space-y-4">
        {tool && tool.bookedRanges.length > 0 && (
          <p className="text-sm text-stone-600">
            Already booked: {tool.bookedRanges.map((r) => formatRange(r.startDate, r.endDate)).join(", ")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input
              type="date"
              required
              min={today}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Until">
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Message (optional)" hint={`Up to ${LIMITS.requestMessage.max} characters. Don't share phone numbers or addresses here.`}>
          <textarea
            rows={3}
            maxLength={LIMITS.requestMessage.max}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={inputClass}
            placeholder="What's it for? When can you pick it up?"
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
