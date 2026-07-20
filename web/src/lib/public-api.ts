/**
 * 公開ゲスト予約ページ用の認証なし fetch ラッパ。
 * 401 リフレッシュなし、Authorization なしの点だけが apiFetch との違い。
 */
const API = "/api/v1";

function errorFromBody(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const o = body as { error?: unknown; message?: unknown; code?: unknown };
    if (o.code === "FST_ERR_CTP_BODY_TOO_LARGE" || (typeof o.message === "string" && /too large/i.test(o.message))) {
      return "送信データが大きすぎます。免許証写真は小さめの画像にして再度お試しください。";
    }
    if (typeof o.error === "string" && o.error.trim()) return o.error;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
  }
  return fallback;
}

export async function publicFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const { json, headers: hdr, ...rest } = init;
  const headers = new Headers(hdr);
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    rest.body = JSON.stringify(json);
  }

  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers });
  } catch {
    return { ok: false, status: 0, error: "通信に失敗しました。通信環境を確認して再度お試しください。" };
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: errorFromBody(body, res.statusText || "リクエストに失敗しました"),
    };
  }
  return { ok: true, data: body as T };
}
