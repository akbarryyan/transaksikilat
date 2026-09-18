/**
 * Constants for the admin transactions listing. They live outside the route
 * file because Next.js route modules may only export request handlers and
 * route config.
 */

/**
 * Callers that omit ?page get the most recent orders up to this many rows.
 * Without it the handler pulls the entire orders table, joins included.
 */
export const UNPAGINATED_ROW_LIMIT = 500;

export const PENDING_STATUSES = [
  "CREATED",
  "WAITING_PAYMENT",
  "PAID",
  "PROCESSING_PROVIDER",
];
