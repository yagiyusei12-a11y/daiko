/**
 * LIFF 予約用の公開 API（JWT authenticate 外）。
 *
 * フロント（LIFF）向けメモ:
 * - id_token は短命のため、**予約 POST の直前**に `liff.getIDToken()` を再取得してから送る（長時間放置での exp 切れ対策）。
 * - GET の空き取得から POST まで間が空く場合も同様に再取得を検討。
 * - GET で id_token をクエリに載せない（ログに残る）。`Authorization: Bearer <id_token>` を推奨。
 * - 409 かつ `code === "SLOT_TAKEN"` のときは空き API を再フェッチして UI を更新できる。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { coerceBusinessBasicsFromCustomJson, resolveBusinessHoursForYmd } from "../lib/business-basics.js";
import {
  coerceDetail,
  createDispatchReservationPoolAssign,
  DispatchReservationSlotTakenError,
  YMD_RE,
} from "../lib/dispatch-reservation.js";
import { businessSlotsToMinuteIntervals, computeLiffAvailabilitySlots } from "../lib/liff-availability.js";
import { resolveLineUserForTenant } from "../lib/line-tenant-auth.js";
import { parseTokyoLocalDateTimeToUtc } from "../lib/tokyo-datetime.js";

function bearerIdToken(req: FastifyRequest): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

export async function registerLiffBookingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { tenantId?: string; company_id?: string; date?: string; durationMinutes?: string };
  }>("/availability", async (req, reply) => {
    const idToken = bearerIdToken(req);
    if (!idToken) {
      return reply.code(401).send({ error: "Authorization: Bearer に LINE の id_token を付与してください" });
    }

    const tenantId = String(req.query.tenantId ?? req.query.company_id ?? "").trim();
    const date = String(req.query.date ?? "").trim();
    const durationRaw = req.query.durationMinutes;
    const durationMinutes =
      durationRaw === undefined || durationRaw === "" ? 15 : Number(String(durationRaw).trim());

    if (!tenantId) {
      return reply.code(400).send({ error: "tenantId（または company_id）を指定してください" });
    }
    if (!YMD_RE.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd で指定してください" });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || durationMinutes % 15 !== 0) {
      return reply.code(400).send({ error: "durationMinutes は 15〜480 で 15 分刻みにしてください（省略時は 15）" });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: "テナントが見つかりません" });

    if (!(await resolveLineUserForTenant(tenantId, idToken))) {
      return reply.code(401).send({ error: "id_token が無効か、このテナント用の LINE チャネルと一致しません" });
    }

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
    const businessHours = resolveBusinessHoursForYmd(date, basics);
    const businessIntervalsMin = businessSlotsToMinuteIntervals(businessHours);

    const slots = await computeLiffAvailabilitySlots({
      tenantId,
      dateYmd: date,
      durationMinutes,
      businessIntervalsMin,
    });

    return {
      tenantId,
      date,
      timeZone: "Asia/Tokyo",
      durationMinutes,
      slots,
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/reservations", async (req, reply) => {
    const b = req.body || {};
    const idToken = bearerIdToken(req) || String(b.id_token ?? "").trim();
    if (!idToken) {
      return reply.code(401).send({ error: "id_token を Authorization: Bearer または JSON の id_token で送ってください" });
    }

    const tenantId = String(b.tenantId ?? b.company_id ?? "").trim();
    const startLocal = String(b.startLocal ?? "").trim();
    const durationMinutes = typeof b.durationMinutes === "number" ? b.durationMinutes : Number(b.durationMinutes);

    const detailRaw = {
      customerName: b.customerName,
      phone: b.phone,
      pickup: b.pickup,
      dropoff: b.dropoff,
      viaStops: b.viaStops,
      vehicleNumber: b.vehicleNumber,
      parking: b.parking,
      ...(typeof b.detail === "object" && b.detail !== null && !Array.isArray(b.detail) ? (b.detail as object) : {}),
    };
    const detail = coerceDetail(detailRaw);

    if (!tenantId) return reply.code(400).send({ error: "tenantId を指定してください" });
    if (!detail.customerName) return reply.code(400).send({ error: "お名前を入力してください" });
    if (!detail.pickup || !detail.dropoff) {
      return reply.code(400).send({ error: "迎え先と送り先を入力してください" });
    }
    if (!startLocal) return reply.code(400).send({ error: "日時を入力してください" });
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || durationMinutes % 15 !== 0) {
      return reply.code(400).send({ error: "予定実車時間は 15〜480 分で 15 分刻みにしてください" });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: "テナントが見つかりません" });

    if (!(await resolveLineUserForTenant(tenantId, idToken))) {
      return reply.code(401).send({ error: "id_token が無効か、このテナント用の LINE チャネルと一致しません" });
    }

    const startsAt = parseTokyoLocalDateTimeToUtc(startLocal);
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      return reply.code(400).send({ error: "日時の形式が不正です" });
    }
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

    const businessDateTokyo = startLocal.slice(0, 10);
    if (!YMD_RE.test(businessDateTokyo)) {
      return reply.code(400).send({ error: "日時に日付が含まれていません" });
    }

    try {
      const created = await createDispatchReservationPoolAssign({
        tenantId,
        businessDateTokyo,
        startsAt,
        endsAt,
        detail,
      });
      return { id: created.id, driverEmployeeId: created.driverEmployeeId };
    } catch (e) {
      if (e instanceof DispatchReservationSlotTakenError) {
        return reply.code(409).send({
          error: "申し訳ありません。タッチの差で枠が埋まりました。別のお時間をお選びください",
          code: e.code,
        });
      }
      throw e;
    }
  });
}
