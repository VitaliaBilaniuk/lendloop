"use client";

import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { CATEGORY_LABELS } from "@/lib/constants";
import { EmptyState, Spinner } from "./ui";

/** Read-only, anonymous list: name and category only, no owner details. */
export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);
  if (tools === undefined) return <Spinner label="Loading tools…" />;
  if (tools.length === 0) {
    return <EmptyState title="No tools listed yet">Be the first neighbor to lend something.</EmptyState>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool) => (
        <li key={tool._id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
          <span className="truncate font-medium text-stone-900">{tool.name}</span>
          <span className="shrink-0 text-xs text-stone-500">{CATEGORY_LABELS[tool.category]}</span>
        </li>
      ))}
    </ul>
  );
}
