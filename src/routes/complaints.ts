import type { FastifyInstance } from "fastify";
import type { ComplaintLedger, Employee, Prisma } from "@prisma/client";
import { authenticateAndBilling } from "../auth/protected-pre.js";
import { jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";

const MAX_LIST = 500;
const MAX_FIELD = 30_000;
const MAX_SHORT = 2000;

const empSelect = { familyName: true, givenName: true } as const;
type EmpMini = Pick<Employee, "familyName" | "givenName">;

function fullName(e: EmpMini | null | undefined): string {
  if (!e) return "";
  return `${e.familyName}　${e.givenName}`;
}

type RowWithEmps = ComplaintLedger & {
  driverEmployee: EmpMini | null;
  receivedByEmployee: EmpMini | null;
  handlerEmployee: EmpMini | null;
};

function toApiRow(row: RowWithEmps) {
  return {
    id: row.id,
    receivedAt: row.receivedAt.toISOString(),
    receivedByEmployeeId: row.receivedByEmployeeId,
    receivedByName: fullName(row.receivedByEmployee) || (row.receivedBy?.trim() ?? ""),
    driverEmployeeId: row.driverEmployeeId,
    driverName: fullName(row.driverEmployee),
    placeOrSection: row.placeOrSection ?? "",
    complainantName: row.complainantName ?? "",
    complainantAddress: row.complainantAddress ?? "",
    complainantContact: row.complainantContact ?? "",
    detail: row.detail ?? "",
    causeAnalysis: row.causeAnalysis ?? "",
    rebuttal: row.rebuttal ?? "",
    correctiveAction: row.correctiveAction ?? "",
    handlerEmployeeId: row.handlerEmployeeId,
    handlerName: fullName(row.handlerEmployee) || (row.handlerName?.trim() ?? ""),
    completedOn: row.completedOn ? row.completedOn.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertEmployeeIds(
  tenantId: string,
  ids: (string | null | undefined)[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const uniq = [...new Set(ids.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
  if (uniq.length === 0) return { ok: true };
  const found = await prisma.employee.findMany({
    where: { tenantId, id: { in: uniq }, status: "ACTIVE" },
    select: { id: true },
  });
  if (found.length !== uniq.length) {
    return { ok: false, error: "無効な従業員 id が含まれるか、退職済みの従業員が含まれています" };
  }
  return { ok: true };
}

function trimField(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > max ? t.slice(0, max) : t;
}

export async function registerComplaintsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticateAndBilling);

  const include = {
    driverEmployee: { select: empSelect },
    receivedByEmployee: { select: empSelect },
    handlerEmployee: { select: empSelect },
  } satisfies Prisma.ComplaintLedgerInclude;

  app.get("/", async (req) => {
    const { tenantId } = jwtUser(req);
    const rows = await prisma.complaintLedger.findMany({
      where: { tenantId },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: MAX_LIST,
      include,
    });
    return { complaints: rows.map((r) => toApiRow(r as RowWithEmps)) };
  });

  app.post<{ Body: Record<string, unknown> }>("/", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body ?? {};
    const receivedRaw = String(b.receivedAt ?? "").trim();
    if (!receivedRaw) return reply.code(400).send({ error: "苦情受付日時を入力してください" });
    const receivedAt = new Date(receivedRaw);
    if (Number.isNaN(receivedAt.getTime())) {
      return reply.code(400).send({ error: "苦情受付日時の形式が不正です" });
    }

    const receivedByEmployeeId = b.receivedByEmployeeId != null ? String(b.receivedByEmployeeId).trim() || null : null;
    const driverEmployeeId = b.driverEmployeeId != null ? String(b.driverEmployeeId).trim() || null : null;
    const handlerEmployeeId = b.handlerEmployeeId != null ? String(b.handlerEmployeeId).trim() || null : null;

    const v = await assertEmployeeIds(tenantId, [receivedByEmployeeId, driverEmployeeId, handlerEmployeeId]);
    if (!v.ok) return reply.code(400).send({ error: v.error });

    const placeOrSection = trimField(b.placeOrSection, MAX_SHORT);
    const complainantName = trimField(b.complainantName, MAX_SHORT);
    const complainantAddress = trimField(b.complainantAddress, MAX_SHORT);
    const complainantContact = trimField(b.complainantContact, MAX_SHORT);
    const detail = trimField(b.detail, MAX_FIELD);
    const causeAnalysis = trimField(b.causeAnalysis, MAX_FIELD);
    const rebuttal = trimField(b.rebuttal, MAX_FIELD);
    const correctiveAction = trimField(b.correctiveAction, MAX_FIELD);

    let completedOn: Date | null = null;
    if (b.completedOn != null && String(b.completedOn).trim() !== "") {
      const co = String(b.completedOn).trim();
      const d = new Date(`${co}T12:00:00+09:00`);
      if (Number.isNaN(d.getTime())) {
        return reply.code(400).send({ error: "苦情処理完了年月日の形式が不正です（YYYY-MM-DD）" });
      }
      completedOn = d;
    }

    const row = await prisma.complaintLedger.create({
      data: {
        tenantId,
        receivedAt,
        receivedByEmployeeId,
        driverEmployeeId,
        placeOrSection: placeOrSection || null,
        complainantName: complainantName || null,
        complainantAddress: complainantAddress || null,
        complainantContact: complainantContact || null,
        detail: detail || null,
        causeAnalysis: causeAnalysis || null,
        rebuttal: rebuttal || null,
        correctiveAction: correctiveAction || null,
        handlerEmployeeId,
        completedOn,
      },
      include,
    });
    return { id: row.id, complaint: toApiRow(row as RowWithEmps) };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params?.id ?? "").trim();
    if (!id) return reply.code(400).send({ error: "id が不正です" });

    const existing = await prisma.complaintLedger.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: "苦情記録が見つかりません" });

    const b = req.body ?? {};
    const data: Prisma.ComplaintLedgerUpdateInput = {};

    if (b.receivedAt !== undefined) {
      const receivedRaw = String(b.receivedAt ?? "").trim();
      if (!receivedRaw) return reply.code(400).send({ error: "苦情受付日時を入力してください" });
      const receivedAt = new Date(receivedRaw);
      if (Number.isNaN(receivedAt.getTime())) {
        return reply.code(400).send({ error: "苦情受付日時の形式が不正です" });
      }
      data.receivedAt = receivedAt;
    }

    if (b.receivedByEmployeeId !== undefined) {
      const rid = b.receivedByEmployeeId != null ? String(b.receivedByEmployeeId).trim() || null : null;
      const v = await assertEmployeeIds(tenantId, [rid]);
      if (!v.ok) return reply.code(400).send({ error: v.error });
      data.receivedByEmployee = rid ? { connect: { id: rid } } : { disconnect: true };
    }
    if (b.driverEmployeeId !== undefined) {
      const did = b.driverEmployeeId != null ? String(b.driverEmployeeId).trim() || null : null;
      const v = await assertEmployeeIds(tenantId, [did]);
      if (!v.ok) return reply.code(400).send({ error: v.error });
      data.driverEmployee = did ? { connect: { id: did } } : { disconnect: true };
    }
    if (b.handlerEmployeeId !== undefined) {
      const hid = b.handlerEmployeeId != null ? String(b.handlerEmployeeId).trim() || null : null;
      const v = await assertEmployeeIds(tenantId, [hid]);
      if (!v.ok) return reply.code(400).send({ error: v.error });
      data.handlerEmployee = hid ? { connect: { id: hid } } : { disconnect: true };
    }

    if (b.placeOrSection !== undefined) data.placeOrSection = trimField(b.placeOrSection, MAX_SHORT) || null;
    if (b.complainantName !== undefined) data.complainantName = trimField(b.complainantName, MAX_SHORT) || null;
    if (b.complainantAddress !== undefined) data.complainantAddress = trimField(b.complainantAddress, MAX_SHORT) || null;
    if (b.complainantContact !== undefined) data.complainantContact = trimField(b.complainantContact, MAX_SHORT) || null;
    if (b.detail !== undefined) data.detail = trimField(b.detail, MAX_FIELD) || null;
    if (b.causeAnalysis !== undefined) data.causeAnalysis = trimField(b.causeAnalysis, MAX_FIELD) || null;
    if (b.rebuttal !== undefined) data.rebuttal = trimField(b.rebuttal, MAX_FIELD) || null;
    if (b.correctiveAction !== undefined) data.correctiveAction = trimField(b.correctiveAction, MAX_FIELD) || null;

    if (b.completedOn !== undefined) {
      const raw = b.completedOn != null ? String(b.completedOn).trim() : "";
      if (!raw) {
        data.completedOn = null;
      } else {
        const d = new Date(`${raw}T12:00:00+09:00`);
        if (Number.isNaN(d.getTime())) {
          return reply.code(400).send({ error: "苦情処理完了年月日の形式が不正です（YYYY-MM-DD）" });
        }
        data.completedOn = d;
      }
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "更新する項目を指定してください" });
    }

    const row = await prisma.complaintLedger.update({
      where: { id },
      data,
      include,
    });
    return { ok: true, complaint: toApiRow(row as RowWithEmps) };
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params?.id ?? "").trim();
    if (!id) return reply.code(400).send({ error: "id が不正です" });
    const n = await prisma.complaintLedger.deleteMany({ where: { id, tenantId } });
    if (n.count === 0) return reply.code(404).send({ error: "苦情記録が見つかりません" });
    return { ok: true };
  });
}
