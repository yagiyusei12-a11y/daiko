/** LINE Login: https://developers.line.biz/en/reference/line-login/#verify-id-token */

export type LineVerifySuccess = {
  sub: string;
  aud: string;
  exp: number;
};

export type LineVerifyFailure = { ok: false; error: string };

export type LineVerifyResult = { ok: true; payload: LineVerifySuccess } | LineVerifyFailure;

function parseVerifyJson(raw: unknown): LineVerifySuccess | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const sub = typeof o.sub === "string" ? o.sub : "";
  const aud = typeof o.aud === "string" ? o.aud : "";
  const exp = typeof o.exp === "number" ? o.exp : Number(o.exp);
  if (!sub || !aud || !Number.isFinite(exp)) return null;
  return { sub, aud, exp };
}

/**
 * id_token を LINE の verify エンドポイントで検証する。
 * `client_id` は当該 LIFF / チャネルの ID（トークンの aud と一致する必要がある）。
 */
export async function verifyLineIdToken(idToken: string, clientId: string): Promise<LineVerifyResult> {
  const trimmed = idToken.trim();
  if (!trimmed) return { ok: false, error: "id_token が空です" };
  const cid = clientId.trim();
  if (!cid) return { ok: false, error: "client_id が空です" };

  const body = new URLSearchParams();
  body.set("id_token", trimmed);
  body.set("client_id", cid);

  let res: Response;
  try {
    res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `LINE verify 通信エラー: ${msg}` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "LINE verify の応答が JSON ではありません" };
  }

  if (!res.ok) {
    const err = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>).error_description : null;
    const desc = typeof err === "string" ? err : `HTTP ${res.status}`;
    return { ok: false, error: desc };
  }

  const payload = parseVerifyJson(json);
  if (!payload) return { ok: false, error: "LINE verify の応答形式が不正です" };

  const nowSec = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (payload.exp <= nowSec - skew) {
    return { ok: false, error: "id_token の有効期限が切れています" };
  }
  if (payload.aud !== cid) {
    return { ok: false, error: "id_token の aud が client_id と一致しません" };
  }

  return { ok: true, payload };
}
