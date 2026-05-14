/**
 * 公開ゲスト予約ページ用の認証なし fetch ラッパ。
 * 401 リフレッシュなし、Authorization なしの点だけが apiFetch との違い。
 */
const API = "/api/v1";

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
  const res = await fetch(url, { ...rest, headers });

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
    const err =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    return { ok: false, status: res.status, error: err };
  }
  return { ok: true, data: body as T };
}
