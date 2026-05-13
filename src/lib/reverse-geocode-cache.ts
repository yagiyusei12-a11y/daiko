/** 同一座標の逆ジオコーディング結果を短時間キャッシュ（Nominatim 負荷軽減） */

type Entry = { town: string; exp: number };

const cache = new Map<string, Entry>();
const TTL_MS = 86_400_000; // 24h
const MAX_ENTRIES = 600;

function pruneIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.exp <= now) cache.delete(k);
    if (cache.size <= MAX_ENTRIES * 0.7) break;
  }
  if (cache.size > MAX_ENTRIES) {
    let n = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      n += 1;
      if (n >= 120 || cache.size <= MAX_ENTRIES * 0.5) break;
    }
  }
}

function townFromNominatimAddress(addr: Record<string, string> | undefined): string {
  if (!addr) return "";
  const parts = [addr.city, addr.town, addr.village, addr.suburb, addr.city_district, addr.quarter].filter(
    (x): x is string => Boolean(x && String(x).trim()),
  );
  return parts.join("") || addr.state || "";
}

export async function reverseGeocodeTownJaCached(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.town;

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&accept-language=ja`;
  const res = await fetch(url, {
    headers: {
      "Accept-Language": "ja",
      "User-Agent": "Daiko/1.0 (+https://daiko.harunoyukoto.jp) tenant reverse proxy",
    },
  });
  if (!res.ok) return "";
  const j = (await res.json()) as { address?: Record<string, string> };
  const town = townFromNominatimAddress(j.address);
  pruneIfNeeded();
  cache.set(key, { town, exp: now + TTL_MS });
  return town;
}
