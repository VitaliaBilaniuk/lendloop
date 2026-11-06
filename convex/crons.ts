import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Safety net for the notification outbox; see notifications.requeueStuck.
crons.interval("requeue stuck n8n deliveries", { minutes: 15 }, internal.notifications.requeueStuck, {});

export default crons;
