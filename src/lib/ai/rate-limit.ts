const hits = new Map<string, number[]>();

export function aiRateLimit(
  userId: string,
  limit = 20,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const prev = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= limit) {
    hits.set(userId, prev);
    return false;
  }
  prev.push(now);
  hits.set(userId, prev);
  return true;
}
