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
  createDispatchReservationVirtualConcurrent,
  DispatchReservationSlotTakenError,
  YMD_RE,
} from "../lib/dispatch-reservation.js";
import { businessSlotsToMinuteIntervals, clipIntervalsForOnlineLatestClose, computeLiffAvailabilitySlots, bookingMatchesIntervals } from "../lib/liff-availability.js";
import { coerceOnlineBookingFromCustomJson } from "../lib/online-booking-settings.js";
import { resolveLineUserForTenant } from "../lib/line-tenant-auth.js";
import {
  coerceReservationTimingFromCustomJson,
  computeBlockedMinutes,
  parseTripEstimateMinutesFromBody,
  parseTripEstimateMinutesFromQuery,
  resolveVirtualConcurrentSlotsForDate,
} from "../lib/reservation-timing-settings.js";
import { parseTokyoLocalDateTimeToUtc, businessDateYmdFromTokyoLocalDatetime } from "../lib/tokyo-datetime.js";

function bearerIdToken(req: FastifyRequest): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

export async function registerLiffBookingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      tenantId?: string;
      company_id?: string;
      date?: string;
      durationMinutes?: string;
      tripEstimateMinutes?: string;
    };
  }>("/availability", async (req, reply) => {
    const idToken = bearerIdToken(req);
    if (!idToken) {
      return reply.code(401).send({ error: "Authorization: Bearer に LINE の id_token を付与してください" });
    }

    const tenantId = String(req.query.tenantId ?? req.query.company_id ?? "").trim();
    const date = String(req.query.date ?? "").trim();
    const tripRaw = req.query.tripEstimateMinutes;
    const durRaw = req.query.durationMinutes;

    if (!tenantId) {
      return reply.code(400).send({ error: "tenantId（または company_id）を指定してください" });
    }
    if (!YMD_RE.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd で指定してください" });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: "テナントが見つかりません" });

    if (!(await resolveLineUserForTenant(tenantId, idToken))) {
      return reply.code(401).send({ error: "id_token が無効か、このテナント用の LINE チャネルと一致しません" });
    }

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const timing = coerceReservationTimingFromCustomJson(settings?.customJson);

    const estParsed =
      tripRaw !== undefined || (durRaw !== undefined && String(durRaw).trim() !== "")
        ? parseTripEstimateMinutesFromQuery(tripRaw, durRaw)
        : ({ ok: true as const, estimateMinutes: timing.defaultTripEstimateMinutes });
    if (!estParsed.ok) return reply.code(400).send({ error: estParsed.error });

    const blockedMinutes = computeBlockedMinutes(estParsed.estimateMinutes, timing);

    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
    const obSettings = coerceOnlineBookingFromCustomJson(settings?.customJson);
    const businessHours = resolveBusinessHoursForYmd(date, basics);
    if (basics.temporaryClosureDates.includes(date) || businessHours.length === 0) {
      return {
        tenantId,
        date,
        timeZone: "Asia/Tokyo",
        tripEstimateMinutes: estParsed.estimateMinutes,
        blockedMinutes,
        slots: [],
        availabilityMode: timing.availabilityMode,
      };
    }
    const rawIntervals = businessSlotsToMinuteIntervals(businessHours);
    const businessIntervalsMin = clipIntervalsForOnlineLatestClose(rawIntervals, obSettings.onlineLatestCloseHm);
    if (businessIntervalsMin.length === 0) {
      return {
        tenantId,
        date,
        timeZone: "Asia/Tokyo",
        tripEstimateMinutes: estParsed.estimateMinutes,
        blockedMinutes,
        slots: [],
        availabilityMode: timing.availabilityMode,
      };
    }

    const rollHour = settings?.businessDayRollHour ?? 4;
    const slots = await computeLiffAvailabilitySlots({
      tenantId,
      dateYmd: date,
      durationMinutes: blockedMinutes,
      businessIntervalsMin,
      availabilityMode: timing.availabilityMode,
      virtualConcurrentSlots: resolveVirtualConcurrentSlotsForDate(date, timing),
      businessDayRollHour: rollHour,
    });

    return {
      tenantId,
      date,
      timeZone: "Asia/Tokyo",
      tripEstimateMinutes: estParsed.estimateMinutes,
      blockedMinutes,
      slots,
      availabilityMode: timing.availabilityMode,
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

    const scheduleDate = String(b.date ?? "").trim() || startLocal.slice(0, 10);
    if (!YMD_RE.test(scheduleDate)) {
      return reply.code(400).send({ error: "date（予約画面の日付）が不正です" });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: "テナントが見つかりません" });

    if (!(await resolveLineUserForTenant(tenantId, idToken))) {
      return reply.code(401).send({ error: "id_token が無効か、このテナント用の LINE チャネルと一致しません" });
    }

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const timing = coerceReservationTimingFromCustomJson(settings?.customJson);
    const estParsed = parseTripEstimateMinutesFromBody(b as Record<string, unknown>);
    if (!estParsed.ok) return reply.code(400).send({ error: estParsed.error });
    const blockedMinutes = computeBlockedMinutes(estParsed.estimateMinutes, timing);

    const startsAt = parseTokyoLocalDateTimeToUtc(startLocal);
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      return reply.code(400).send({ error: "日時の形式が不正です" });
    }
    const endsAt = new Date(startsAt.getTime() + blockedMinutes * 60 * 1000);

    const rollHour = settings?.businessDayRollHour ?? 4;
    const businessDateTokyo = businessDateYmdFromTokyoLocalDatetime(startLocal, rollHour);
    if (!businessDateTokyo || !YMD_RE.test(businessDateTokyo)) {
      return reply.code(400).send({ error: "日時に日付が含まれていません" });
    }

    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
    const obSettings = coerceOnlineBookingFromCustomJson(settings?.customJson);
    if (basics.temporaryClosureDates.includes(scheduleDate)) {
      return reply.code(400).send({ error: "ご指定の日は休業のため受付できません" });
    }
    const businessHours = resolveBusinessHoursForYmd(scheduleDate, basics);
    if (businessHours.length === 0) {
      return reply.code(400).send({ error: "ご指定の日は休業のため受付できません" });
    }
    const rawIntervals = businessSlotsToMinuteIntervals(businessHours);
    const bookableIntervals = clipIntervalsForOnlineLatestClose(rawIntervals, obSettings.onlineLatestCloseHm);
    if (
      bookableIntervals.length === 0 ||
      !bookingMatchesIntervals(scheduleDate, startsAt, blockedMinutes, bookableIntervals)
    ) {
      return reply.code(400).send({ error: "ご指定のお時間はネット予約を受け付けていません" });
    }

    try {
      if (timing.availabilityMode === "virtual_concurrent") {
        const created = await createDispatchReservationVirtualConcurrent({
          tenantId,
          businessDateTokyo,
          startsAt,
          endsAt,
          detail,
          virtualConcurrentSlots: resolveVirtualConcurrentSlotsForDate(businessDateTokyo, timing),
        });
        return { id: created.id, driverEmployeeId: created.driverEmployeeId };
      }
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
