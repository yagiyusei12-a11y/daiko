import { apiFetch } from "../api";

/** 緯度経度から町名寄りの文字列（日本向け）。API プロキシ経由・失敗時は空文字。 */
export async function reverseGeocodeTownJa(lat: number, lon: number): Promise<string> {
  const r = await apiFetch<{ town?: string }>(
    `/settings/reverse-geocode?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`,
  );
  if (!r.ok) return "";
  const t = r.data?.town;
  return typeof t === "string" ? t.trim() : "";
}
