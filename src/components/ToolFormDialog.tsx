"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  LIMITS,
  type Category,
  type Condition,
} from "@/lib/constants";
import { Button, ErrorText, Field, inputClass, Modal, useAction } from "./ui";

export type EditableTool = {
  _id: Id<"tools">;
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

/** Create (tool = "new") or edit (tool = existing) a listing. */
export function ToolFormDialog({ tool, onClose }: { tool: EditableTool | "new" | null; onClose: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const existing = tool !== null && tool !== "new" ? tool : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<Category>(existing?.category ?? "power_tools");
  const [condition, setCondition] = useState<Condition>(existing?.condition ?? "good");
  const [description, setDescription] = useState(existing?.description ?? "");
  const { pending, error, run } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fields = { name, category, condition, description };
    const ok = await run(() => (existing ? update({ toolId: existing._id, ...fields }) : create(fields)));
    if (ok) onClose();
  }

  return (
    <Modal open={tool !== null} onClose={onClose} title={existing ? "Edit listing" : "List a tool"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input
            required
            minLength={LIMITS.toolName.min}
            maxLength={LIMITS.toolName.max}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="Cordless drill"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={inputClass}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Condition">
            <select value={condition} onChange={(e) => setCondition(e.target.value as Condition)} className={inputClass}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Short description" hint={`Up to ${LIMITS.toolDescription.max} characters.`}>
          <textarea
            rows={3}
            maxLength={LIMITS.toolDescription.max}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
            placeholder="18V, two batteries, comes with a bit set."
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : existing ? "Save changes" : "Publish listing"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
