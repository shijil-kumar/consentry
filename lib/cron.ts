// Cron auth: accept our own `x-cron-secret` (internal kicks) OR Vercel Cron's
// `Authorization: Bearer <CRON_SECRET>`. A user-JWT bearer (not the secret)
// falls through to the caller's org-scoped path.
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
