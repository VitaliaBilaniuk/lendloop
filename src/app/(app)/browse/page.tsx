"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@/../convex/_generated/api";
import { AvailabilityBadge } from "@/components/AvailabilityBadge";
import { useMe } from "@/components/CurrentUser";
import { RemoveListingDialog } from "@/components/RemoveListingDialog";
import { RequestDialog } from "@/components/RequestDialog";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, TrustedBadge } from "@/components/ui";
import { CATEGORIES, CATEGORY_LABELS, CONDITION_LABELS, type Category } from "@/lib/constants";

type Tool = FunctionReturnType<typeof api.tools.list>[number];

export default function BrowsePage() {
  const me = useMe();
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const tools = useQuery(api.tools.list, { category });
  const [requesting, setRequesting] = useState<Tool | null>(null);
  const [removing, setRemoving] = useState<Tool | null>(null);

  return (
    <>
      <PageHeader title="Browse tools" subtitle="Everything your neighbors are happy to lend." />

      <div role="group" aria-label="Filter by category" className="mb-6 flex flex-wrap gap-2">
        {[undefined, ...CATEGORIES].map((c) => {
          const active = c === category;
          return (
            <button
              key={c ?? "all"}
              onClick={() => setCategory(c)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              {c ? CATEGORY_LABELS[c] : "All"}
            </button>
          );
        })}
      </div>

      {tools === undefined ? (
        <Spinner />
      ) : tools.length === 0 ? (
        <EmptyState title="Nothing here yet">Try another category, or list one of your own tools.</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <li key={tool._id}>
              <Card className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-stone-900">{tool.name}</h3>
                  <AvailabilityBadge availability={tool.availability} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>{CATEGORY_LABELS[tool.category]}</Badge>
                  <Badge>{CONDITION_LABELS[tool.condition]}</Badge>
                </div>
                {tool.description && <p className="mt-3 line-clamp-3 text-sm text-stone-600">{tool.description}</p>}
                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-stone-600">
                    {tool.isMine ? "Your listing" : <>Lent by <span className="font-medium text-stone-800">{tool.owner.firstName}</span></>}
                    {tool.owner.trustedLender && <TrustedBadge />}
                  </p>
                  <div className="flex gap-2">
                    {me.role === "admin" && (
                      <Button variant="ghost" onClick={() => setRemoving(tool)}>
                        Remove
                      </Button>
                    )}
                    {!tool.isMine &&
                      (tool.hasPendingRequest ? (
                        <Badge tone="amber">Requested</Badge>
                      ) : (
                        <Button onClick={() => setRequesting(tool)}>Request</Button>
                      ))}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <RequestDialog key={requesting?._id ?? "none"} tool={requesting} onClose={() => setRequesting(null)} />
      <RemoveListingDialog tool={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
