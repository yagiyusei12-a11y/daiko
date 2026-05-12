import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { authenticate, jwtUser } from "../auth/pre.js";
import { JP_DRIVER_LICENSE_CLASSES, JP_PLATE_REGION_NAMES } from "../lib/jp-constants.js";
import { prisma } from "../db.js";

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
    licenseConditions?: string;
    licensePhotoDataUrl?: string;
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
    "licenseConditions",
    "licensePhotoDataUrl",
  ] as const;
  for (const k of keys) {
    if (body[k] !== undefined) ext[k] = body[k] as string;
  }
  return ext;
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

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
      legalBusinessAddress: s?.legalBusinessAddress ?? null,
      legalPhone: s?.legalPhone ?? null,
      legalCertificationNumber: s?.legalCertificationNumber ?? null,
      legalCertificationDate: s?.legalCertificationDate ? ymd(s.legalCertificationDate) : null,
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
    assign("legalBusinessAddress", str("legalBusinessAddress"));
    assign("legalPhone", str("legalPhone"));
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

  app.get("/employees", async (req) => {
    const { tenantId } = jwtUser(req);
    const rows = await prisma.employee.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { linkedUsers: { select: { id: true, email: true } } },
    });
    return {
      employees: rows.map((e) => ({
        id: e.id,
        familyName: e.familyName,
        givenName: e.givenName,
        address: e.address,
        status: e.status,
        retiredAt: e.retiredAt ? e.retiredAt.toISOString() : null,
        registerExtension: e.registerExtension,
        loginEmail: e.linkedUsers[0]?.email ?? null,
        userId: e.linkedUsers[0]?.id ?? null,
      })),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/employees", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};
    const familyName = String(b.familyName || "").trim();
    const givenName = String(b.givenName || "").trim();
    if (!familyName || !givenName) return reply.code(400).send({ error: "familyName, givenName required" });

    const loginEmail = String(b.loginEmail || "").trim().toLowerCase();
    const password = String(b.password || "");
    const address = b.address !== undefined ? String(b.address).trim() || null : null;

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
            address,
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
        address,
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
        ...(address !== undefined ? { address } : {}),
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
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/vehicles/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const row = await prisma.vehicle.findFirst({ where: { id, tenantId } });
    if (!row) return reply.code(404).send({ error: "not found" });
    const n = await prisma.dailyReport.count({ where: { tenantId, vehicleId: id } });
    if (n > 0) return reply.code(409).send({ error: "vehicle has daily reports" });
    await prisma.vehicle.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/pricing", async (req) => {
    const { tenantId } = jwtUser(req);
    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const cj = asObj(s?.customJson);
    const pp = asObj(cj.pricingPrefs);
    return {
      regime: typeof pp.regime === "string" ? pp.regime : "",
      features: Array.isArray(pp.features) ? pp.features.filter((x): x is string => typeof x === "string") : [],
    };
  });

  app.put<{ Body: Record<string, unknown> }>("/pricing", async (req) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};
    const regime = b.regime !== undefined ? String(b.regime) : "";
    const features = Array.isArray(b.features) ? b.features.map((x) => String(x)) : [];

    const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const prev = asObj(s?.customJson);
    const nextCustom = { ...prev, pricingPrefs: { regime, features } };

    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        businessDayRollHour: 4,
        featureFlags: {},
        customJson: nextCustom,
      },
      update: { customJson: nextCustom },
    });
    return { ok: true };
  });

  app.get("/meta", async () => {
    return { licenseClasses: JP_DRIVER_LICENSE_CLASSES, plateRegions: JP_PLATE_REGION_NAMES };
  });
}
