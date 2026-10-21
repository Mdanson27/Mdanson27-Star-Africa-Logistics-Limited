const CACHE_PREFIX = "starafrica.section-cache.v1";

interface CacheEnvelope<T> {
  version: 1;
  savedAt: string;
  data: T;
}

const keyFor = (userId: string, section: string) =>
  `${CACHE_PREFIX}:${userId}:${section}`;

export function readSectionCache<T>(
  userId: string | undefined,
  section: string,
): { data: T; savedAt: string } | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId, section));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.version !== 1 || !parsed.savedAt) return null;
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function writeSectionCache<T>(
  userId: string | undefined,
  section: string,
  data: T,
): string {
  const savedAt = new Date().toISOString();
  if (!userId) return savedAt;
  try {
    const envelope: CacheEnvelope<T> = { version: 1, savedAt, data };
    localStorage.setItem(keyFor(userId, section), JSON.stringify(envelope));
  } catch {
    // Star Africa Logistics still works when browser storage is unavailable or full.
  }
  return savedAt;
}

export function clearSectionCaches(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${CACHE_PREFIX}:`)) localStorage.removeItem(key);
    }
  } catch {
    // Session cleanup must not fail because browser storage is unavailable.
  }
}
