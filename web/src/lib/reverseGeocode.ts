import { apiFetch } from "../api";

export async function reverseGeocodeToTown(
  lat: number,
  lng: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const r = await apiFetch<{ displayName: string }>(
    `/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: r.data.displayName };
}

/** ブラウザの位置情報から逆ジオコーディングし、テキスト欄に反映（HTTPS 推奨） */
export function geolocationFillInto(
  setText: (s: string) => void,
  onErr: (msg: string) => void,
): void {
  if (!navigator.geolocation) {
    onErr("このブラウザでは位置情報を利用できません（HTTPS での利用を推奨します）");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const res = await reverseGeocodeToTown(pos.coords.latitude, pos.coords.longitude);
      if (res.ok) setText(res.text);
      else onErr(res.error);
    },
    () => onErr("位置情報の取得に失敗しました。ブラウザの許可設定を確認してください。"),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
}
