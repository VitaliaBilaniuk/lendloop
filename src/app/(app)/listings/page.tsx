"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { AvailabilityBadge } from "@/components/AvailabilityBadge";
import { ToolFormDialog, type EditableTool } from "@/components/ToolFormDialog";
import { Badge, Button, Card, EmptyState, ErrorText, PageHeader, Spinner, useAction } from "@/components/ui";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/constants";

export default function MyListingsPage() {
  const tools = useQuery(api.tools.mine);
  const removeTool = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<EditableTool | "new" | null>(null);
  const { error, run } = useAction();
  const [busyId, setBusyId] = useState<Id<"tools"> | null>(null);

  async function onDelete(tool: EditableTool) {
    if (!window.confirm(`Delete “${tool.name}”? Pending requests will be cancelled.`)) return;
    setBusyId(tool._id);
    await run(() => removeTool({ toolId: tool._id }));
    setBusyId(null);
  }

  return (
    <>
      <PageHeader
        title="My listings"
        subtitle="Tools you're offering to neighbors."
        action={<Button onClick={() => setEditing("new")}>+ List a tool</Button>}
      />
      <div className="mb-4">
        <ErrorText>{error}</ErrorText>
      </div>
      {tools === undefined ? (
        <Spinner />
      ) : tools.length === 0 ? (
        <EmptyState title="You haven't listed anything yet">
          Got a ladder gathering dust? <button className="font-medium text-emerald-700 underline" onClick={() => setEditing("new")}>List it</button>.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {tools.map((tool) => (
            <li key={tool._id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-stone-900">{tool.name}</h3>
                    <AvailabilityBadge availability={tool.availability} />
                    {tool.pendingRequests > 0 && (
                      <Badge tone="amber">
                        {tool.pendingRequests} pending request{tool.pendingRequests > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-stone-600">
                    {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
                    {tool.description && <> · {tool.description}</>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(tool)}>
                    Edit
                  </Button>
                  <Button variant="danger" disabled={busyId === tool._id} onClick={() => onDelete(tool)}>
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ToolFormDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing._id}
        tool={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
