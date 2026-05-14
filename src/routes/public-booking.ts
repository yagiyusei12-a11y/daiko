/**
 * 公開ゲスト予約 API（JWT 認証なし）
 *
 * - URL は `/api/v1/public/book/:slug` 配下。`:slug` は `Tenant.slug`（@unique）。
 * - LIFF 予約 ([`liff-booking.ts`](./liff-booking.ts)) と同じ予約プール割当ロジックを再利用するが、
 *   LINE id_token を要求しない代わりに、最低限のスパム対策（ハニーポット・IP レート制限・同日同電話の重複ガード）を持つ。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { coerceBusinessBasicsFromCustomJson, resolveBusinessHoursForYmd } from "../lib/business-basics.js";
import { coerceOnlineBookingFromCustomJson } from "../lib/online-booking-settings.js";
import {
  coerceReservationTimingFromCustomJson,
  computeBlockedMinutes,
  parseTripEstimateMinutesFromBody,
  parseTripEstimateMinutesFromQuery,
  resolveVirtualConcurrentSlotsForDate,
} from "../lib/reservation-timing-settings.js";
import {
  coerceDetail,
  createDispatchReservationPoolAssign,
  createDispatchReservationVirtualConcurrent,
  DispatchReservationSlotTakenError,
  YMD_RE,
} from "../lib/dispatch-reservation.js";
import { businessSlotsToMinuteIntervals, clipIntervalsForOnlineLatestClose, computeLiffAvailabilitySlots, bookingMatchesIntervals } from "../lib/liff-availability.js";
import { businessDateYmdFromTokyoLocalDatetime, parseTokyoLocalDateTimeToUtc, tokyoBusinessDayRangeUtc } from "../lib/tokyo-datetime.js";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type RateBucket = { hits: number[] };
const ipBuckets = new Map<string, RateBucket>();
const IP_RATE_WINDOW_MS = 60 * 1000;
const IP_RATE_MAX_POST = 5;

function clientIp(req: FastifyRequest): string {
  return (req.ip || "unknown").toString();
}

/** メモリ内 IP レートリミッタ（多インスタンスでは厳密ではないが、最低限の濫用抑止） */
function checkIpRateLimit(ip: string, now: number): boolean {
  const bucket = ipBuckets.get(ip) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < IP_RATE_WINDOW_MS);
  if (bucket.hits.length >= IP_RATE_MAX_POST) {
    ipBuckets.set(ip, bucket);
    return false;
  }
  bucket.hits.push(now);
  ipBuckets.set(ip, bucket);
  return true;
}

async function findTenantBySlug(slug: string): Promise<{ id: string; name: string } | null> {
  if (!SLUG_RE.test(slug)) return null;
  return prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
}

function tokyoTodayYmd(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).slice(0, 10);
}

export async function registerPublicBookingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { date?: string } }>(
    "/book/:slug",
    async (req, reply) => {
      const tenant = await findTenantBySlug(String(req.params.slug ?? "").trim());
      if (!tenant) return reply.code(404).send({ error: "お店が見つかりません" });

      const date = String(req.query.date ?? "").trim() || tokyoTodayYmd();
      if (!YMD_RE.test(date)) {
        return reply.code(400).send({ error: "date は yyyy-MM-dd で指定してください" });
      }

      const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: tenant.id } });
      const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
      const obSettings = coerceOnlineBookingFromCustomJson(settings?.customJson);
      const reservationTiming = coerceReservationTimingFromCustomJson(settings?.customJson);
      const businessHours = resolveBusinessHoursForYmd(date, basics);
      const isClosed = basics.temporaryClosureDates.includes(date) || businessHours.length === 0;

      return {
        tenant: { name: tenant.name },
        date,
        timeZone: "Asia/Tokyo",
        businessHours,
        isClosed,
        onlineBooking: {
          enabled: obSettings.enabled,
          message: obSettings.message,
          durationOptions: obSettings.durationOptions,
          daysAhead: obSettings.daysAhead,
          onlineLatestCloseHm: obSettings.onlineLatestCloseHm,
        },
        reservationTiming,
      };
    },
  );

  app.get<{
    Params: { slug: string };
    Querystring: { date?: string; durationMinutes?: string; tripEstimateMinutes?: string };
  }>("/book/:slug/availability", async (req, reply) => {
    const tenant = await findTenantBySlug(String(req.params.slug ?? "").trim());
    if (!tenant) return reply.code(404).send({ error: "お店が見つかりません" });

    const date = String(req.query.date ?? "").trim();
    const tripRaw = req.query.tripEstimateMinutes;
    const durRaw = req.query.durationMinutes;

    if (!YMD_RE.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd で指定してください" });
    }

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: tenant.id } });
    const timing = coerceReservationTimingFromCustomJson(settings?.customJson);

    const estParsed = parseTripEstimateMinutesFromQuery(tripRaw, durRaw);
    if (!estParsed.ok) return reply.code(400).send({ error: estParsed.error });

    const blockedMinutes = computeBlockedMinutes(estParsed.estimateMinutes, timing);

    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
    const obSettings = coerceOnlineBookingFromCustomJson(settings?.customJson);
    const businessHours = resolveBusinessHoursForYmd(date, basics);
    if (basics.temporaryClosureDates.includes(date) || businessHours.length === 0) {
      return {
        tenantId: tenant.id,
        date,
        tripEstimateMinutes: estParsed.estimateMinutes,
        blockedMinutes,
        isClosed: true,
        slots: [],
        availabilityMode: timing.availabilityMode,
      };
    }
    const rawIntervals = businessSlotsToMinuteIntervals(businessHours);
    const businessIntervalsMin = clipIntervalsForOnlineLatestClose(rawIntervals, obSettings.onlineLatestCloseHm);
    if (businessIntervalsMin.length === 0) {
      return {
        tenantId: tenant.id,
        date,
        tripEstimateMinutes: estParsed.estimateMinutes,
        blockedMinutes,
        isClosed: true,
        slots: [],
        availabilityMode: timing.availabilityMode,
      };
    }

    const rollHour = settings?.businessDayRollHour ?? 4;
    const slots = await computeLiffAvailabilitySlots({
      tenantId: tenant.id,
      dateYmd: date,
      durationMinutes: blockedMinutes,
      businessIntervalsMin,
      availabilityMode: timing.availabilityMode,
      virtualConcurrentSlots: resolveVirtualConcurrentSlotsForDate(date, timing),
      businessDayRollHour: rollHour,
    });

    return {
      tenantId: tenant.id,
      date,
      tripEstimateMinutes: estParsed.estimateMinutes,
      blockedMinutes,
      isClosed: false,
      slots,
      availabilityMode: timing.availabilityMode,
    };
  });

  app.post<{ Params: { slug: string }; Body: Record<string, unknown> }>(
    "/book/:slug/reservations",
    async (req, reply) => {
      const ip = clientIp(req);
      if (!checkIpRateLimit(ip, Date.now())) {
        return reply.code(429).send({ error: "短時間に送信が集中しています。しばらくしてから再度お試しください" });
      }

      const tenant = await findTenantBySlug(String(req.params.slug ?? "").trim());
      if (!tenant) return reply.code(404).send({ error: "お店が見つかりません" });

      const b = req.body || {};

      // ハニーポット: ボット用の罠フィールドに値があれば、エラーは見せずに 200 で握り潰す
      const honeypot = typeof b.website === "string" ? b.website.trim() : "";
      if (honeypot.length > 0) {
        return { ok: true, accepted: true };
      }

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

      if (!detail.customerName) return reply.code(400).send({ error: "お名前を入力してください" });
      if (!detail.phone) return reply.code(400).send({ error: "電話番号を入力してください" });
      if (!detail.pickup || !detail.dropoff) {
        return reply.code(400).send({ error: "迎え先と送り先を入力してください" });
      }
      if (!startLocal) return reply.code(400).send({ error: "ご希望の日時を入力してください" });

      const scheduleDate = String(b.date ?? "").trim() || startLocal.slice(0, 10);
      if (!YMD_RE.test(scheduleDate)) {
        return reply.code(400).send({ error: "date（予約画面の日付）が不正です" });
      }

      const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: tenant.id } });
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
        return reply.code(409).send({ error: "ご指定の日は休業のため受付できません" });
      }
      const businessHours = resolveBusinessHoursForYmd(scheduleDate, basics);
      if (businessHours.length === 0) {
        return reply.code(409).send({ error: "ご指定の日は休業のため受付できません" });
      }
      const rawIntervals = businessSlotsToMinuteIntervals(businessHours);
      const bookableIntervals = clipIntervalsForOnlineLatestClose(rawIntervals, obSettings.onlineLatestCloseHm);
      if (
        bookableIntervals.length === 0 ||
        !bookingMatchesIntervals(scheduleDate, startsAt, blockedMinutes, bookableIntervals)
      ) {
        return reply.code(400).send({ error: "ご指定のお時間はネット予約を受け付けていません" });
      }

      // 同日重複ガード: 同じ電話番号で同一事業日内に既存予約があれば 409
      const range = tokyoBusinessDayRangeUtc(businessDateTokyo, rollHour);
      if (range) {
        const dup = await prisma.dispatchReservation.findFirst({
          where: {
            tenantId: tenant.id,
            startsAt: { lt: range.end },
            endsAt: { gt: range.start },
            detailJson: { path: ["phone"], equals: detail.phone } as Prisma.JsonFilter,
          },
          select: { id: true },
        });
        if (dup) {
          return reply.code(409).send({
            error: "同じ電話番号でこの日のご予約が既にあります。お電話で変更をご依頼ください",
            code: "DUPLICATE_SAME_DAY",
          });
        }
      }

      try {
        if (timing.availabilityMode === "virtual_concurrent") {
          const created = await createDispatchReservationVirtualConcurrent({
            tenantId: tenant.id,
            businessDateTokyo,
            startsAt,
            endsAt,
            detail,
            virtualConcurrentSlots: resolveVirtualConcurrentSlotsForDate(businessDateTokyo, timing),
          });
          return { id: created.id };
        }
        const created = await createDispatchReservationPoolAssign({
          tenantId: tenant.id,
          businessDateTokyo,
          startsAt,
          endsAt,
          detail,
        });
        return { id: created.id };
      } catch (e) {
        if (e instanceof DispatchReservationSlotTakenError) {
          return reply.code(409).send({
            error: "申し訳ありません。タッチの差で枠が埋まりました。別のお時間をお選びください",
            code: e.code,
          });
        }
        throw e;
      }
    },
  );
}
