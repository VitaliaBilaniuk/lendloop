import type { Availability } from "@/../convex/lib/availability";
import { formatDate } from "@/lib/format";
import { Badge } from "./ui";

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  switch (availability.state) {
    case "available":
      return <Badge tone="green">Available</Badge>;
    case "reserved":
      return <Badge tone="amber">Reserved from {formatDate(availability.from)}</Badge>;
    case "on_loan":
      return <Badge tone="gray">On loan until {formatDate(availability.until)}</Badge>;
  }
}
