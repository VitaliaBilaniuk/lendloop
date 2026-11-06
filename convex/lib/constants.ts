// Shared between the Convex backend and the Next.js frontend. Keep this file
// free of server-only imports.

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "ladders",
  "sports",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  ladders: "Ladders",
  sports: "Sports",
  other: "Other",
};

export const CONDITIONS = ["new", "like_new", "good", "fair", "worn"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Well used",
};

export const LOAN_STATUSES = [
  "pending",
  "approved",
  "declined",
  "cancelled",
  "returned",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const ROLES = ["user", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const LIMITS = {
  toolName: { min: 2, max: 80 },
  toolDescription: { max: 500 },
  requestMessage: { max: 300 },
  maxActiveListingsPerUser: 50,
  maxPendingRequestsPerUser: 10,
  maxLoanDays: 30,
  maxDaysAhead: 180,
  adminReason: { max: 200 },
} as const;
