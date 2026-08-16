/**
 * Cache in-memory sederhana (stale-while-revalidate) supaya pindah halaman
 * terasa instan: data lama langsung tampil, lalu diperbarui di belakang layar.
 */
const store = new Map<string, { value: unknown; at: number }>();

export function getCached<T>(key: string, maxAgeMs = Infinity): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > maxAgeMs) return undefined;
  return hit.value as T;
}

export function setCached<T>(key: string, value: T): T {
  store.set(key, { value, at: Date.now() });
  return value;
}

/** Ambil dari cache dulu (kalau ada), lalu revalidate di background. */
export async function swr<T>(
  key: string,
  fetcher: () => Promise<T>,
  onData: (data: T, fromCache: boolean) => void,
  maxAgeMs = 60_000,
): Promise<void> {
  const cached = getCached<T>(key);
  if (cached !== undefined) onData(cached, true);
  const fresh = getCached<T>(key, maxAgeMs);
  if (fresh !== undefined) return;
  const data = await fetcher();
  setCached(key, data);
  onData(data, false);
}
