import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { tenantIdFromReq } from "./tenant-scope.js";

/** OpenStreetMap Nominatim（サーバ経由・利用規約上 User-Agent 明示） */
export async function registerGeocodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/geocode/reverse", { preHandler: [authenticate] }, async (req, reply) => {
    void tenantIdFromReq(req);
    const { lat, lng } = req.query as { lat?: string; lng?: string };
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      return reply.code(400).send({ error: "invalid lat/lng" });
    }
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(la))}&lon=${encodeURIComponent(String(ln))}&accept-language=ja`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Daiko/1.0 (https://github.com/yagiyusei12-a11y/daiko reverse geocode)" },
    });
    if (!res.ok) return reply.code(502).send({ error: "geocode upstream failed" });
    const data = (await res.json()) as { address?: Record<string, string>; display_name?: string };
    const a = data.address ?? {};
    const town =
      a.city || a.town || a.village || a.suburb || a.quarter || a.municipality || a.county || "";
    const prefecture = a.state || a.prefecture || "";
    const displayName =
      [prefecture, town].filter(Boolean).join(" ").trim() || String(data.display_name || "").trim() || "（地名を取得できませんでした）";
    return { displayName: displayName.slice(0, 500), town: town.slice(0, 200), prefecture: prefecture.slice(0, 100) };
  });
}
