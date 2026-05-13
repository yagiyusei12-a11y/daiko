/** 緯度経度から町名寄りの文字列（日本向け）を返す。失敗時は空文字。 */
export async function reverseGeocodeTownJa(lat: number, lon: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&accept-language=ja`;
  const res = await fetch(url, { headers: { "Accept-Language": "ja" } });
  if (!res.ok) return "";
  const j = (await res.json()) as { address?: Record<string, string> };
  const a = j.address ?? {};
  const parts = [a.city, a.town, a.village, a.suburb, a.city_district, a.quarter].filter((x): x is string => Boolean(x && String(x).trim()));
  return parts.join("") || a.state || "";
}
