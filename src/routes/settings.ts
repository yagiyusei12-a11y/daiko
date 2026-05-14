import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { authenticate, jwtUser } from "../auth/pre.js";
import { JP_DRIVER_LICENSE_CLASSES_EMPLOYEE, JP_PLATE_REGION_NAMES } from "../lib/jp-constants.js";
import { JP_LICENSE_CONDITION_OPTIONS, licenseConditionOptionsForKind } from "../lib/jp-license-conditions.js";
import {
  coerceBusinessBasicsFromCustomJson,
  mergeBusinessBasicsIntoCustomJson,
  parseBusinessBasicsPut,
  resolveBusinessHoursForYmd,
} from "../lib/business-basics.js";
import { coerceTillFromCustomJson, mergeTillIntoCustomJson, parseTillPut } from "../lib/till-settings.js";
import { coercePricingPrefs, mergePricingPrefsUpdate } from "../lib/pricing-prefs.js";
import {
  coerceOnlineBookingFromCustomJson,
  mergeOnlineBookingIntoCustomJson,
  parseOnlineBookingPut,
} from "../lib/online-booking-settings.js";
import {
  coerceReservationTimingFromCustomJson,
  mergeReservationTimingIntoCustomJson,
  parseReservationTimingPut,
} from "../lib/reservation-timing-settings.js";
import {
  coerceStaffMenuVisibilityFromCustomJson,
  mergeStaffMenuVisibilityIntoCustomJson,
  parseStaffMenuVisibilityPut,
} from "../lib/staff-menu-visibility-settings.js";
import { prisma } from "../db.js";
import { reverseGeocodeTownJaCached } from "../lib/reverse-geocode-cache.js";
import { appendVehicleOdometerAndSetCurrent } from "../lib/vehicle-odometer.js";
import { hasSecondClassDriverLicense } from "../lib/employee-license.js";

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

function parseYmd(s: string | undefined): Date | null | undefined {
  if (s === undefined) return undefined;
  if (s === "" || s === null) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(d: Date | null | undefined): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mergeVehicleDetail(existing: unknown, patch: JsonObj): JsonObj {
  const cur = asObj(existing);
  const next = { ...cur, ...patch };
  const ins = asObj(patch.voluntaryInsurance);
  if (Object.keys(ins).length > 0) {
    next.voluntaryInsurance = { ...asObj(cur.voluntaryInsurance), ...ins };
  }
  return next;
}

function buildRegisterExtension(
  base: unknown,
  body: {
    birthDate?: string;
    phone?: string;
    mobile?: string;
    hiredOn?: string;
    retiredOn?: string;
    usualWorkDays?: string;
    emergencyName?: string;
    emergencyTel?: string;
    licenseKind?: string;
    licenseNumber?: string;
    licenseExpiresOn?: string;
    /** 複数選択（文字列配列） */
    licenseConditions?: string[] | string;
    licensePhotoFrontDataUrl?: string;
    licensePhotoBackDataUrl?: string;
  },
): JsonObj {
  const cur = asObj(base);
  const ext: JsonObj = { ...cur };
  const keys = [
    "birthDate",
    "phone",
    "mobile",
    "hiredOn",
    "retiredOn",
    "usualWorkDays",
    "emergencyName",
    "emergencyTel",
    "licenseKind",
    "licenseNumber",
    "licenseExpiresOn",
    "licensePhotoFrontDataUrl",
    "licensePhotoBackDataUrl",
  ] as const;
  for (const k of keys) {
    if (body[k] !== undefined) ext[k] = body[k] as string;
  }
  if (body.licenseConditions !== undefined) {
    if (Array.isArray(body.licenseConditions)) {
      ext.licenseConditions = body.licenseConditions.filter((x): x is string => typeof x === "string");
    } else if (typeof body.licenseConditions === "string") {
      const t = body.licenseConditions.trim();
      ext.licenseConditions = t ? [t] : [];
    }
  }
  if (body.licensePhotoFrontDataUrl !== undefined || body.licensePhotoBackDataUrl !== undefined) {
    delete ext.licensePhotoDataUrl;
  }
  return ext;
}

type ZipCloudResponse = {
  status: number;
  message: string | null;
  results: { address1: string; address2: string; address3: string }[] | null;
};

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get<{ Querystring: { zip?: string } }>("/zip-lookup", async (req, reply) => {
    const zip = String(req.query?.zip ?? "").replace(/\D/g, "");
    if (zip.length !== 7) return reply.code(400).send({ error: "郵便番号は7桁で指定してください" });
    let res: Response;
    try {
      res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${encodeURIComponent(zip)}`, {
        headers: { Accept: "application/json" },
      });
    } catch {
      return reply.code(502).send({ error: "郵便番号検索サービスに接続できませんでした" });
    }
    if (!res.ok) return reply.code(502).send({ error: "郵便番号検索に失敗しました" });
    const j = (await res.json()) as ZipCloudResponse;
    if (j.status !== 200 || !j.results?.length) {
      return { ok: false as const, message: j.message || "該当する住所がありません" };
    }
    const r = j.results[0];
    const addressStart = `${r.address2 ?? ""}${r.address3 ?? ""}`.trim();
    return {
      ok: true as const,
      prefecture: r.address1 ?? "",
      addressStart,
    };
  });

  /** ブラウザから Nominatim を直接叩かず、サーバー経由＋キャッシュで逆ジオコーディング */
  app.get<{ Querystring: { lat?: string; lon?: string } }>("/reverse-geocode", async (req, reply) => {
    const lat = Number(req.query?.lat);
    const lon = Number(req.query?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return reply.code(400).send({ error: "lat と lon を数値で指定してください" });
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return reply.code(400).send({ error: "緯度経度の範囲が不正です" });
    }
    try {
      const town = await reverseGeocodeTownJaCached(lat, lon);
      return { town };
    } catch {
      return reply.code(502).send({ error: "逆ジオコーディングに失敗しました" });
    }
  });

  app.get("/company", async (req) => {
    const { tenantId } = jwtUser(req);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { settings: true },
    });
    const s = tenant.settings;
    return {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      legalTradeName: s?.legalTradeName ?? null,
      legalRepresentativeName: s?.legalRepresentativeName ?? null,
      legalPostalCode: s?.legalPostalCode ?? null,
      legalPrefecture: s?.legalPrefecture ?? null,
      legalStreetAddress: s?.legalStreetAddress ?? null,
      legalPhone: s?.legalPhone ?? null,
      legalCertificationNumber: s?.legalCertificationNumber ?? null,
      legalCertificationDate: s?.legalCertificationDate ? ymd(s.legalCertificationDate) : null,
      legalPublicSafetyCommission: s?.legalPublicSafetyCommission ?? null,
      legalMainOfficeName: s?.legalMainOfficeName ?? null,
      legalMainOfficeAddress: s?.legalMainOfficeAddress ?? null,
      legalMutualAidContractFrom: s?.legalMutualAidContractFrom ? ymd(s.legalMutualAidContractFrom) : null,
      legalMutualAidContractTo: s?.legalMutualAidContractTo ? ymd(s.legalMutualAidContractTo) : null,
    };
  });

  app.put<{ Body: Record<string, unknown> }>("/company", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};
    const str = (k: string) => (b[k] !== undefined ? String(b[k]).trim() || null : undefined);

    const data: Record<string, string | Date | null | undefined> = {};
    const assign = (key: string, v: string | null | undefined) => {
      if (v !== undefined) data[key] = v;
    };
    assign("legalTradeName", str("legalTradeName"));
    assign("legalRepresentativeName", str("legalRepresentativeName"));
    assign("legalPostalCode", str("legalPostalCode"));
    assign("legalPrefecture", str("legalPrefecture"));
    assign("legalStreetAddress", str("legalStreetAddress"));
    assign("legalPhone", str("legalPhone"));
    assign("legalPublicSafetyCommission", str("legalPublicSafetyCommission"));
    assign("legalCertificationNumber", str("legalCertificationNumber"));
    if (b.legalCertificationDate !== undefined) {
      if (b.legalCertificationDate === null || b.legalCertificationDate === "") {
        data.legalCertificationDate = null;
      } else {
        data.legalCertificationDate = parseYmd(String(b.legalCertificationDate));
      }
    }

    const clean = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    ) as Record<string, string | Date | null>;
    clean.legalBusinessAddress = null;
    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        businessDayRollHour: 4,
        featureFlags: {},
        customJson: {},
        ...clean,
      },
      update: clean,
    });
    return reply.send({ ok: true });
  });

  app.get("/basics", async (req) => {
    const { tenantId } = jwtUser(req);
    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const basics = coerceBusinessBasicsFromCustomJson(s?.customJson);
    const staffMenuVisibility = coerceStaffMenuVisibilityFromCustomJson(s?.customJson);
    return { ...basics, staffMenuVisibility };
  });

  app.put<{ Body: Record<string, unknown> }>("/basics", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const parsed = parseBusinessBasicsPut((req.body || {}) as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const prevRoot = asObj(s?.customJson);
    let nextCustom = mergeBusinessBasicsIntoCustomJson(prevRoot, parsed.value);

    const smRaw = (req.body || {}) as Record<string, unknown>;
    if (smRaw.staffMenuVisibility !== undefined) {
      if (smRaw.staffMenuVisibility === null || typeof smRaw.staffMenuVisibility !== "object" || Array.isArray(smRaw.staffMenuVisibility)) {
        return reply.code(400).send({ error: "staffMenuVisibility はオブジェクトで指定してください" });
      }
      const smParsed = parseStaffMenuVisibilityPut(smRaw.staffMenuVisibility as Record<string, unknown>);
      if (!smParsed.ok) return reply.code(400).send({ error: smParsed.error });
      nextCustom = mergeStaffMenuVisibilityIntoCustomJson(nextCustom, smParsed.value);
    }

    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        businessDayRollHour: 4,
        featureFlags: {},
        customJson: nextCustom as Prisma.InputJsonValue,
      },
      update: { customJson: nextCustom as Prisma.InputJsonValue },
    });
    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { date?: string } }>("/basics/resolved-hours", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const date = String(req.query?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "date は yyyy-MM-dd で指定してください" });
    }
    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const basics = coerceBusinessBasicsFromCustomJson(s?.customJson);
    return {
      date,
      businessHours: resolveBusinessHoursForYmd(date, basics),
    };
  });

  app.get("/till", async (req) => {
    const { tenantId } = jwtUser(req);
    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    return coerceTillFromCustomJson(s?.customJson);
  });

  app.put<{ Body: Record<string, unknown> }>("/till", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const parsed = parseTillPut((req.body || {}) as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const prevRoot = asObj(s?.customJson);
    const nextCustom = mergeTillIntoCustomJson(prevRoot, parsed.value);

    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        businessDayRollHour: 4,
        featureFlags: {},
        customJson: nextCustom as Prisma.InputJsonValue,
      },
      update: { customJson: nextCustom as Prisma.InputJsonValue },
    });
    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { forPassengerDriver?: string } }>("/employees", async (req) => {
    const { tenantId } = jwtUser(req);
    const passengerOnly = String(req.query?.forPassengerDriver ?? "").trim() === "1";
    const rows = await prisma.employee.findMany({
      where: { tenantId, ...(passengerOnly ? { status: "ACTIVE" as const } : {}) },
      orderBy: { createdAt: "desc" },
      include: { linkedUsers: { select: { id: true, email: true } } },
    });
    const filtered = passengerOnly ? rows.filter((e) => hasSecondClassDriverLicense(e.registerExtension)) : rows;
    return {
      employees: filtered.map((e) => ({
        id: e.id,
        familyName: e.familyName,
        givenName: e.givenName,
        furigana: e.furigana,
        address: e.address,
        status: e.status,
        retiredAt: e.retiredAt ? e.retiredAt.toISOString() : null,
        registerExtension: e.registerExtension,
        loginEmail: e.linkedUsers[0]?.email ?? null,
        userId: e.linkedUsers[0]?.id ?? null,
        adminMaster: e.adminMaster,
        safetyDrivingManager: e.safetyDrivingManager,
      })),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/employees", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};
    const familyName = String(b.familyName || "").trim();
    const givenName = String(b.givenName || "").trim();
    if (!familyName || !givenName) return reply.code(400).send({ error: "familyName, givenName required" });

    const furigana = b.furigana !== undefined ? String(b.furigana).trim() || null : null;

    const loginEmail = String(b.loginEmail || "").trim().toLowerCase();
    const password = String(b.password || "");
    const address = b.address !== undefined ? String(b.address).trim() || null : null;
    const adminMaster = Boolean(b.adminMaster);
    const safetyDrivingManager = Boolean(b.safetyDrivingManager);

    const ext = buildRegisterExtension({}, b as Parameters<typeof buildRegisterExtension>[1]);

    const hiredOn = b.hiredOn ? String(b.hiredOn) : undefined;
    const retiredOn = b.retiredOn ? String(b.retiredOn) : undefined;
    if (hiredOn) ext.hiredOn = hiredOn;
    if (retiredOn) ext.retiredOn = retiredOn;

    const retiredAt = parseYmd(retiredOn);
    const status = retiredAt ? "RETIRED" : "ACTIVE";

    if (loginEmail) {
      if (password.length < 8) return reply.code(400).send({ error: "password min 8 chars when loginEmail set" });
      const exists = await prisma.user.findFirst({ where: { tenantId, email: loginEmail } });
      if (exists) return reply.code(409).send({ error: "login email already used" });
      const staffRole = await prisma.role.findFirst({ where: { tenantId, name: "staff" } });
      if (!staffRole) return reply.code(500).send({ error: "staff role missing" });

      const passwordHash = await bcrypt.hash(password, 10);
      const emp = await prisma.$transaction(async (tx) => {
        const e = await tx.employee.create({
          data: {
            tenantId,
            familyName,
            givenName,
            furigana,
            address,
            adminMaster,
            safetyDrivingManager,
            registerExtension: ext as Prisma.InputJsonValue,
            status,
            retiredAt: retiredAt ?? undefined,
          },
        });
        const u = await tx.user.create({
          data: { tenantId, email: loginEmail, passwordHash, displayName: `${familyName} ${givenName}`, employeeId: e.id },
        });
        await tx.userRole.create({ data: { userId: u.id, roleId: staffRole.id } });
        return e;
      });
      return { id: emp.id };
    }

    const emp = await prisma.employee.create({
      data: {
        tenantId,
        familyName,
        givenName,
        furigana,
        address,
        adminMaster,
        safetyDrivingManager,
        registerExtension: ext as Prisma.InputJsonValue,
        status,
        retiredAt: retiredAt ?? undefined,
      },
    });
    return { id: emp.id };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/employees/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const emp = await prisma.employee.findFirst({ where: { id, tenantId }, include: { linkedUsers: true } });
    if (!emp) return reply.code(404).send({ error: "not found" });

    const b = req.body || {};
    const familyName = b.familyName !== undefined ? String(b.familyName).trim() : undefined;
    const givenName = b.givenName !== undefined ? String(b.givenName).trim() : undefined;
    const furigana = b.furigana !== undefined ? String(b.furigana).trim() || null : undefined;
    const address = b.address !== undefined ? (String(b.address).trim() || null) : undefined;

    const ext = buildRegisterExtension(emp.registerExtension, b as Parameters<typeof buildRegisterExtension>[1]);

    let status = emp.status;
    let retiredAt = emp.retiredAt;
    if (b.retiredOn !== undefined) {
      const r = parseYmd(b.retiredOn === null ? "" : String(b.retiredOn));
      retiredAt = r ?? null;
      status = r ? "RETIRED" : "ACTIVE";
    }

    const password = String(b.password || "");
    if (password && emp.linkedUsers[0]) {
      if (password.length < 8) return reply.code(400).send({ error: "password min 8 chars" });
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.update({ where: { id: emp.linkedUsers[0].id }, data: { passwordHash } });
    }

    await prisma.employee.update({
      where: { id },
      data: {
        ...(familyName !== undefined ? { familyName } : {}),
        ...(givenName !== undefined ? { givenName } : {}),
        ...(furigana !== undefined ? { furigana } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(b.adminMaster !== undefined ? { adminMaster: Boolean(b.adminMaster) } : {}),
        ...(b.safetyDrivingManager !== undefined ? { safetyDrivingManager: Boolean(b.safetyDrivingManager) } : {}),
        registerExtension: ext as Prisma.InputJsonValue,
        status,
        retiredAt: retiredAt === undefined ? undefined : retiredAt,
      },
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/employees/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const emp = await prisma.employee.findFirst({ where: { id, tenantId } });
    if (!emp) return reply.code(404).send({ error: "not found" });

    const tripCount = await prisma.dailyReport.count({
      where: { tenantId, OR: [{ mainEmployeeId: id }, { partnerEmployeeId: id }] },
    });
    if (tripCount > 0) {
      return reply.code(409).send({ error: "employee has daily reports; retire instead of delete" });
    }

    await prisma.$transaction([
      prisma.user.deleteMany({ where: { tenantId, employeeId: id } }),
      prisma.employee.delete({ where: { id } }),
    ]);
    return { ok: true };
  });

  app.get("/vehicles", async (req) => {
    const { tenantId } = jwtUser(req);
    const rows = await prisma.vehicle.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    return {
      vehicles: rows.map((v) => ({
        id: v.id,
        label: v.label,
        plate: v.plate,
        detailJson: v.detailJson,
        legalCoverageStartOn: v.legalCoverageStartOn ? ymd(v.legalCoverageStartOn) : null,
        active: v.active,
        currentOdometer: v.currentOdometer,
      })),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/vehicles", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};
    const label = String(b.label || "").trim();
    if (!label) return reply.code(400).send({ error: "label required" });

    const detail: JsonObj = {};
    const set = (k: string) => {
      if (b[k] !== undefined) detail[k] = String(b[k]).trim();
    };
    set("plateOffice");
    set("plateCategory");
    set("plateHiragana");
    set("plateSerial");
    if (b.inspectionValidTo !== undefined) detail.inspectionValidTo = b.inspectionValidTo ? String(b.inspectionValidTo) : "";
    const ins: JsonObj = {};
    if (b.insuranceCompany !== undefined) ins.companyName = String(b.insuranceCompany).trim();
    if (b.insurancePeriodFrom !== undefined) ins.periodFrom = b.insurancePeriodFrom ? String(b.insurancePeriodFrom) : "";
    if (b.insurancePeriodTo !== undefined) ins.periodTo = b.insurancePeriodTo ? String(b.insurancePeriodTo) : "";
    if (Object.keys(ins).length) detail.voluntaryInsurance = ins;

    const plateParts = [detail.plateOffice, detail.plateCategory, detail.plateHiragana, detail.plateSerial]
      .filter(Boolean)
      .join(" ");
    const plate = plateParts || (b.plate !== undefined ? String(b.plate).trim() || null : null);

    const v = await prisma.vehicle.create({
      data: {
        tenantId,
        label,
        plate,
        detailJson: detail as Prisma.InputJsonValue,
      },
    });
    if (b.currentOdometer !== undefined && b.currentOdometer !== null && String(b.currentOdometer) !== "") {
      const val = Math.max(0, Math.floor(Number(b.currentOdometer) || 0));
      await appendVehicleOdometerAndSetCurrent(prisma, {
        tenantId,
        vehicleId: v.id,
        value: val,
        source: "SETTINGS",
      });
    }
    return { id: v.id };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/vehicles/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const row = await prisma.vehicle.findFirst({ where: { id, tenantId } });
    if (!row) return reply.code(404).send({ error: "not found" });

    const b = req.body || {};
    const detailPatch: JsonObj = {};
    const set = (k: string) => {
      if (b[k] !== undefined) detailPatch[k] = String(b[k]).trim();
    };
    set("plateOffice");
    set("plateCategory");
    set("plateHiragana");
    set("plateSerial");
    if (b.inspectionValidTo !== undefined) {
      detailPatch.inspectionValidTo = b.inspectionValidTo ? String(b.inspectionValidTo) : "";
    }
    if (b.insuranceCompany !== undefined || b.insurancePeriodFrom !== undefined || b.insurancePeriodTo !== undefined) {
      detailPatch.voluntaryInsurance = {
        companyName: b.insuranceCompany !== undefined ? String(b.insuranceCompany).trim() : asObj(asObj(row.detailJson).voluntaryInsurance).companyName,
        periodFrom:
          b.insurancePeriodFrom !== undefined
            ? b.insurancePeriodFrom
              ? String(b.insurancePeriodFrom)
              : ""
            : (asObj(asObj(row.detailJson).voluntaryInsurance).periodFrom as string) ?? "",
        periodTo:
          b.insurancePeriodTo !== undefined
            ? b.insurancePeriodTo
              ? String(b.insurancePeriodTo)
              : ""
            : (asObj(asObj(row.detailJson).voluntaryInsurance).periodTo as string) ?? "",
      };
    }

    const mergedDetail = mergeVehicleDetail(row.detailJson, detailPatch);
    const d = asObj(mergedDetail);
    const plateParts = [d.plateOffice, d.plateCategory, d.plateHiragana, d.plateSerial].filter(Boolean).join(" ");
    const plate =
      b.plate !== undefined
        ? String(b.plate).trim() || null
        : plateParts || row.plate;

    await prisma.vehicle.update({
      where: { id },
      data: {
        ...(b.label !== undefined ? { label: String(b.label).trim() } : {}),
        plate,
        detailJson: mergedDetail as Prisma.InputJsonValue,
        ...(b.active !== undefined ? { active: Boolean(b.active) } : {}),
      },
    });

    if (b.currentOdometer !== undefined) {
      if (b.currentOdometer === null || b.currentOdometer === "") {
        await prisma.vehicle.update({ where: { id }, data: { currentOdometer: null } });
      } else {
        const val = Math.max(0, Math.floor(Number(b.currentOdometer) || 0));
        if (row.currentOdometer !== val) {
          await appendVehicleOdometerAndSetCurrent(prisma, {
            tenantId,
            vehicleId: id,
            value: val,
            source: "SETTINGS",
          });
        }
      }
    }
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/vehicles/:id/odometer-logs", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const veh = await prisma.vehicle.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!veh) return reply.code(404).send({ error: "not found" });
    const lim = Math.min(200, Math.max(1, Math.floor(Number(req.query?.limit) || 80)));
    const rows = await prisma.vehicleOdometerLog.findMany({
      where: { tenantId, vehicleId: id },
      orderBy: { createdAt: "desc" },
      take: lim,
      select: {
        id: true,
        value: true,
        source: true,
        businessDate: true,
        dailyReportId: true,
        createdAt: true,
      },
    });
    return {
      logs: rows.map((r) => ({
        id: r.id,
        value: r.value,
        source: r.source,
        businessDate: r.businessDate,
        dailyReportId: r.dailyReportId,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.delete<{ Params: { id: string } }>("/vehicles/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const row = await prisma.vehicle.findFirst({ where: { id, tenantId } });
    if (!row) return reply.code(404).send({ error: "not found" });
    const n = await prisma.dailyReport.count({
      where: { tenantId, OR: [{ vehicleId: id }, { escortVehicleId: id }] },
    });
    if (n > 0) return reply.code(409).send({ error: "vehicle has daily reports" });
    await prisma.vehicle.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/pricing", async (req) => {
    const { tenantId } = jwtUser(req);
    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const cj = asObj(s?.customJson);
    const prefs = coercePricingPrefs(cj.pricingPrefs);
    return {
      regime: prefs.regime,
      features: prefs.features,
      pricingPrefs: prefs,
    };
  });

  app.put<{ Body: Record<string, unknown> }>("/pricing", async (req) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};

    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const prevRoot = asObj(s?.customJson);
    const prevPrefs = coercePricingPrefs(prevRoot.pricingPrefs);
    const nextPrefs = mergePricingPrefsUpdate(prevPrefs, b);

    const nextCustom = { ...prevRoot, pricingPrefs: nextPrefs as unknown as Record<string, unknown> };

    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        businessDayRollHour: 4,
        featureFlags: {},
        customJson: nextCustom as Prisma.InputJsonValue,
      },
      update: { customJson: nextCustom as Prisma.InputJsonValue },
    });
    return { ok: true };
  });

  app.get("/online-booking", async (req) => {
    const { tenantId } = jwtUser(req);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const settings = coerceOnlineBookingFromCustomJson(s?.customJson);
    const reservationTiming = coerceReservationTimingFromCustomJson(s?.customJson);
    return { ...settings, tenantSlug: tenant.slug, reservationTiming };
  });

  app.put<{ Body: Record<string, unknown> }>("/online-booking", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const parsed = parseOnlineBookingPut(body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const prevRoot = asObj(s?.customJson);
    let nextCustom = mergeOnlineBookingIntoCustomJson(prevRoot, parsed.value);

    const rtNested =
      body.reservationTiming !== undefined && typeof body.reservationTiming === "object" && body.reservationTiming !== null && !Array.isArray(body.reservationTiming)
        ? (body.reservationTiming as Record<string, unknown>)
        : null;
    if (rtNested) {
      const rtParsed = parseReservationTimingPut(rtNested);
      if (!rtParsed.ok) return reply.code(400).send({ error: rtParsed.error });
      nextCustom = mergeReservationTimingIntoCustomJson(nextCustom, rtParsed.value);
    }

    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        businessDayRollHour: 4,
        featureFlags: {},
        customJson: nextCustom as Prisma.InputJsonValue,
      },
      update: { customJson: nextCustom as Prisma.InputJsonValue },
    });
    return { ok: true };
  });

  app.get("/meta", async () => {
    const licenseClasses = JP_DRIVER_LICENSE_CLASSES_EMPLOYEE;
    const licenseConditionOptionsByKind: Record<string, string[]> = {};
    for (const c of licenseClasses) {
      licenseConditionOptionsByKind[c] = licenseConditionOptionsForKind(c);
    }
    return {
      licenseClasses,
      plateRegions: JP_PLATE_REGION_NAMES,
      /** 旧データの免許種別が一覧外のときのフォールバック用（全候補） */
      licenseConditionOptions: JP_LICENSE_CONDITION_OPTIONS,
      licenseConditionOptionsByKind,
    };
  });
}
