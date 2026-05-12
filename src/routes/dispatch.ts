import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import {
  coerceBusinessBasicsFromCustomJson,
  resolveBusinessHoursForYmd,
} from "../lib/business-basics.js";
import { loadUserAccess, type UserAccessContext } from "../lib/permissions.js";
import { parseTokyoLocalDateTimeToUtc, tokyoDayRangeUtc } from "../lib/tokyo-datetime.js";
import { prisma } from "../db.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUTY_WHITELIST = new Set(["客車", "随伴車", "電話", "スケジュール"]);

function parseDutiesJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && DUTY_WHITELIST.has(x)) out.push(x);
  }
  return [...new Set(out)];
}

type DispatchDetail = {
  customerName: string;
  phone: string;
  pickup: string;
  viaStops: string[];
  dropoff: string;
  vehicleNumber: string;
  parking: string;
};

function coerceDetail(raw: unknown): DispatchDetail {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      customerName: "",
      phone: "",
      pickup: "",
      viaStops: [],
      dropoff: "",
      vehicleNumber: "",
      parking: "",
    };
  }
  const o = raw as Record<string, unknown>;
  const via: string[] = [];
  if (Array.isArray(o.viaStops)) {
    for (const x of o.viaStops) {
      if (typeof x === "string" && x.trim()) via.push(x.trim());
    }
  }
  return {
    customerName: typeof o.customerName === "string" ? o.customerName.trim() : "",
    phone: typeof o.phone === "string" ? o.phone.trim() : "",
    pickup: typeof o.pickup === "string" ? o.pickup.trim() : "",
    viaStops: via,
    dropoff: typeof o.dropoff === "string" ? o.dropoff.trim() : "",
    vehicleNumber: typeof o.vehicleNumber === "string" ? o.vehicleNumber.trim() : "",
    parking: typeof o.parking === "string" ? o.parking.trim() : "",
  };
}

async function loadDriverRows(
  tenantId: string,
  date: string,
  access: UserAccessContext,
): Promise<Array<{ employeeId: string; name: string; startTime: string; endTime: string }>> {
  const where: Prisma.ConfirmedShiftDayWhereInput = { tenantId, businessDate: date };
  if (access.isStaffShiftOnly && access.employeeId) {
    where.employeeId = access.employeeId;
  }
  const rows = await prisma.confirmedShiftDay.findMany({
    where,
    include: { employee: { select: { familyName: true, givenName: true } } },
    orderBy: [{ employee: { familyName: "asc" } }, { employee: { givenName: "asc" } }],
  });
  return rows
    .filter((r) => parseDutiesJson(r.dutiesJson).includes("客車"))
    .map((r) => ({
      employeeId: r.employeeId,
      name: `${r.employee.familyName} ${r.employee.givenName}`,
      startTime: r.startTime,
      endTime: r.endTime,
    }));
}

export async function registerDispatchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get<{ Querystring: { date?: string } }>("/schedule", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const date = String(req.query?.date ?? "").trim();
    if (!YMD_RE.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd で指定してください" });
    }

    const range = tokyoDayRangeUtc(date);
    if (!range) return reply.code(400).send({ error: "日付が不正です" });

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);
    const businessHours = resolveBusinessHoursForYmd(date, basics);

    const drivers = await loadDriverRows(tenantId, date, access);

    const resWhere: Prisma.DispatchReservationWhereInput = {
      tenantId,
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
    };
    if (access.isStaffShiftOnly && access.employeeId) {
      resWhere.driverEmployeeId = access.employeeId;
    }

    const reservations = await prisma.dispatchReservation.findMany({
      where: resWhere,
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        driverEmployeeId: true,
        vehicleId: true,
        detailJson: true,
      },
    });

    return {
      date,
      businessHours,
      drivers,
      reservations: reservations.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        driverEmployeeId: r.driverEmployeeId,
        vehicleId: r.vehicleId,
        detail: coerceDetail(r.detailJson),
      })),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/reservations", async (req, reply) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const b = req.body || {};

    const startLocal = String(b.startLocal ?? "").trim();
    const durationMinutes = typeof b.durationMinutes === "number" ? b.durationMinutes : Number(b.durationMinutes);
    const driverEmployeeId = String(b.driverEmployeeId ?? "").trim();
    const vehicleIdRaw = b.vehicleId !== undefined && b.vehicleId !== null ? String(b.vehicleId).trim() : "";
    const vehicleId = vehicleIdRaw || null;

    const detail = coerceDetail(b.detail);

    if (!detail.customerName) {
      return reply.code(400).send({ error: "客名を入力してください" });
    }
    if (!detail.pickup || !detail.dropoff) {
      return reply.code(400).send({ error: "迎え先と送り先を入力してください" });
    }
    if (!startLocal) {
      return reply.code(400).send({ error: "日時を入力してください" });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || durationMinutes % 15 !== 0) {
      return reply.code(400).send({ error: "予定実車時間は 15〜480 分で 15 分刻みにしてください" });
    }
    if (!driverEmployeeId) {
      return reply.code(400).send({ error: "客車担当者を選んでください" });
    }

    if (access.isStaffShiftOnly) {
      if (!access.employeeId || driverEmployeeId !== access.employeeId) {
        return reply.code(403).send({ error: "このアカウントでは選べる客車担当者はご自身のみです" });
      }
    }

    const startsAt = parseTokyoLocalDateTimeToUtc(startLocal);
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      return reply.code(400).send({ error: "日時の形式が不正です" });
    }
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

    const businessDate = startLocal.slice(0, 10);
    if (!YMD_RE.test(businessDate)) {
      return reply.code(400).send({ error: "日時に日付が含まれていません" });
    }

    const conf = await prisma.confirmedShiftDay.findFirst({
      where: { tenantId, businessDate, employeeId: driverEmployeeId },
      select: { dutiesJson: true },
    });
    if (!conf || !parseDutiesJson(conf.dutiesJson).includes("客車")) {
      return reply.code(400).send({ error: "その日の確定シフトで客車を担当している従業員を選んでください" });
    }

    const emp = await prisma.employee.findFirst({
      where: { id: driverEmployeeId, tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!emp) return reply.code(404).send({ error: "従業員が見つかりません" });

    if (vehicleId) {
      const v = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } });
      if (!v) return reply.code(404).send({ error: "車両が見つかりません" });
    }

    const title = `${detail.customerName}（${detail.pickup}→${detail.dropoff}）`.slice(0, 240);

    const row = await prisma.dispatchReservation.create({
      data: {
        tenantId,
        vehicleId,
        driverEmployeeId,
        title,
        detailJson: detail as unknown as Prisma.InputJsonValue,
        startsAt,
        endsAt,
      },
      select: { id: true },
    });

    return { id: row.id };
  });
}
