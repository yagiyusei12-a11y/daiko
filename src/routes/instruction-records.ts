import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tokyoDayRangeUtc } from "../lib/tokyo-datetime.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 100_000;
const MAX_LIST = 500;
const MAX_RECIPIENTS = 80;
const MAX_INSTRUCTORS = 30;
const MAX_VENUE = 500;

function parseEmployeeIdArrayJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
}

function employeeName(e: { familyName: string; givenName: string }): string {
  return `${e.familyName} ${e.givenName}`.trim();
}

type InstructionRowDb = {
  id: string;
  date: Date;
  instructionVenue: string;
  recipientEmployeeIds: unknown;
  instructorEmployeeIds: unknown;
  instructionItems: string;
  specialNotes: string;
  remarks: string;
  createdAt: Date;
  updatedAt: Date;
};

async function formatInstructionRecordsForApi(
  tenantId: string,
  rows: InstructionRowDb[],
): Promise<
  Array<{
    id: string;
    date: string;
    instructionVenue: string;
    recipientEmployeeIds: string[];
    recipients: { id: string; familyName: string; givenName: string }[];
    recipientLabel: string;
    instructorEmployeeIds: string[];
    instructors: { id: string; familyName: string; givenName: string }[];
    instructorLabel: string;
    instructionItems: string;
    specialNotes: string;
    remarks: string;
    createdAt: string;
    updatedAt: string;
  }>
> {
  const all = new Set<string>();
  for (const r of rows) {
    for (const id of parseEmployeeIdArrayJson(r.recipientEmployeeIds)) all.add(id);
    for (const id of parseEmployeeIdArrayJson(r.instructorEmployeeIds)) all.add(id);
  }
  const emps =
    all.size > 0
      ? await prisma.employee.findMany({
          where: { tenantId, id: { in: [...all] } },
          select: { id: true, familyName: true, givenName: true },
        })
      : [];
  const map = new Map(emps.map((e) => [e.id, e]));

  return rows.map((r) => {
    const recipientIds = parseEmployeeIdArrayJson(r.recipientEmployeeIds);
    const instructorIds = parseEmployeeIdArrayJson(r.instructorEmployeeIds);
    const recipients = recipientIds
      .map((id) => map.get(id))
      .filter((e): e is (typeof emps)[0] => e != null)
      .map((e) => ({ id: e.id, familyName: e.familyName, givenName: e.givenName }));
    const instructors = instructorIds
      .map((id) => map.get(id))
      .filter((e): e is (typeof emps)[0] => e != null)
      .map((e) => ({ id: e.id, familyName: e.familyName, givenName: e.givenName }));
    return {
      id: r.id,
      date: r.date.toISOString(),
      instructionVenue: r.instructionVenue,
      recipientEmployeeIds: recipientIds,
      recipients,
      recipientLabel: recipients.map((e) => employeeName(e)).join("、"),
      instructorEmployeeIds: instructorIds,
      instructors,
      instructorLabel: instructors.map((e) => employeeName(e)).join("、"),
      instructionItems: r.instructionItems,
      specialNotes: r.specialNotes,
      remarks: r.remarks,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

async function validateRecipientAndInstructorIds(
  tenantId: string,
  recipientIds: string[],
  instructorIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (recipientIds.length === 0) {
    return { ok: false, error: "指導を受ける者を1名以上選択してください" };
  }
  if (recipientIds.length > MAX_RECIPIENTS) {
    return { ok: false, error: `指導を受ける者は ${MAX_RECIPIENTS} 名までです` };
  }
  if (instructorIds.length > MAX_INSTRUCTORS) {
    return { ok: false, error: `指導担当者は ${MAX_INSTRUCTORS} 名までです` };
  }
  const all = [...new Set([...recipientIds, ...instructorIds])];
  const emps = await prisma.employee.findMany({
    where: { tenantId, id: { in: all }, status: "ACTIVE" },
    select: { id: true },
  });
  if (emps.length !== all.length) {
    return { ok: false, error: "無効な従業員が含まれるか、在籍でない方が含まれています" };
  }
  return { ok: true };
}

export async function registerInstructionRecordsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params?.id ?? "").trim();
    if (!id) return reply.code(400).send({ error: "id が不正です" });

    const existing = await prisma.instructionRecord.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: "指導記録が見つかりません" });

    const b = req.body || {};
    const data: Prisma.InstructionRecordUpdateInput = {};

    if (b.recipientEmployeeIds !== undefined) {
      const recipientEmployeeIds = Array.isArray(b.recipientEmployeeIds)
        ? [...new Set(b.recipientEmployeeIds.map((x) => String(x).trim()).filter(Boolean))]
        : [];
      let instructorEmployeeIds: string[];
      if (b.instructorEmployeeIds !== undefined) {
        instructorEmployeeIds = Array.isArray(b.instructorEmployeeIds)
          ? [...new Set(b.instructorEmployeeIds.map((x) => String(x).trim()).filter(Boolean))]
          : parseEmployeeIdArrayJson(existing.instructorEmployeeIds);
      } else {
        instructorEmployeeIds = parseEmployeeIdArrayJson(existing.instructorEmployeeIds);
      }
      const v = await validateRecipientAndInstructorIds(tenantId, recipientEmployeeIds, instructorEmployeeIds);
      if (!v.ok) return reply.code(400).send({ error: v.error });
      data.recipientEmployeeIds = recipientEmployeeIds as unknown as Prisma.InputJsonValue;
      if (b.instructorEmployeeIds !== undefined) {
        data.instructorEmployeeIds = instructorEmployeeIds as unknown as Prisma.InputJsonValue;
      }
    } else if (b.instructorEmployeeIds !== undefined) {
      const instructorEmployeeIds = Array.isArray(b.instructorEmployeeIds)
        ? [...new Set(b.instructorEmployeeIds.map((x) => String(x).trim()).filter(Boolean))]
        : [];
      const recipientEmployeeIds = parseEmployeeIdArrayJson(existing.recipientEmployeeIds);
      const v = await validateRecipientAndInstructorIds(tenantId, recipientEmployeeIds, instructorEmployeeIds);
      if (!v.ok) return reply.code(400).send({ error: v.error });
      data.instructorEmployeeIds = instructorEmployeeIds as unknown as Prisma.InputJsonValue;
    }

    if (b.date !== undefined) {
      const dateRaw = String(b.date ?? "").trim();
      const date = new Date(dateRaw);
      if (!dateRaw || Number.isNaN(date.getTime())) {
        return reply.code(400).send({ error: "指導日時の形式が不正です" });
      }
      data.date = date;
    }

    if (b.instructionVenue !== undefined) {
      const instructionVenue = String(b.instructionVenue ?? "").trim();
      if (instructionVenue.length > MAX_VENUE) {
        return reply.code(400).send({ error: "指導実施場所が長すぎます" });
      }
      data.instructionVenue = instructionVenue;
    }

    if (b.instructionItems !== undefined) {
      const instructionItems = String(b.instructionItems ?? "");
      if (instructionItems.length > MAX_TEXT) return reply.code(400).send({ error: "指導事項が長すぎます" });
      data.instructionItems = instructionItems;
    }
    if (b.specialNotes !== undefined) {
      const specialNotes = String(b.specialNotes ?? "");
      if (specialNotes.length > MAX_TEXT) return reply.code(400).send({ error: "特記事項が長すぎます" });
      data.specialNotes = specialNotes;
    }
    if (b.remarks !== undefined) {
      const remarks = String(b.remarks ?? "");
      if (remarks.length > MAX_TEXT) return reply.code(400).send({ error: "備考が長すぎます" });
      data.remarks = remarks;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "更新する項目を指定してください" });
    }

    await prisma.instructionRecord.update({ where: { id }, data });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params?.id ?? "").trim();
    if (!id) return reply.code(400).send({ error: "id が不正です" });
    const result = await prisma.instructionRecord.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) return reply.code(404).send({ error: "指導記録が見つかりません" });
    return { ok: true };
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const from = String(req.query?.from ?? "").trim();
    const to = String(req.query?.to ?? "").trim();

    const where: { tenantId: string; date?: { gte: Date; lt: Date } } = { tenantId };

    if (from || to) {
      if (!YMD_RE.test(from) || !YMD_RE.test(to)) {
        return reply.code(400).send({ error: "from / to は yyyy-MM-dd の両方で指定してください" });
      }
      const rFrom = tokyoDayRangeUtc(from);
      const rTo = tokyoDayRangeUtc(to);
      if (!rFrom || !rTo) return reply.code(400).send({ error: "日付が不正です" });
      if (rFrom.start.getTime() > rTo.start.getTime()) {
        return reply.code(400).send({ error: "開始日は終了日以前にしてください" });
      }
      where.date = { gte: rFrom.start, lt: rTo.end };
    }

    const rows = await prisma.instructionRecord.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: MAX_LIST,
    });

    return { records: await formatInstructionRecordsForApi(tenantId, rows) };
  });

  app.post<{ Body: Record<string, unknown> }>("/", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};

    const dateRaw = String(b.date ?? "").trim();
    const instructionVenue = String(b.instructionVenue ?? "").trim();
    const instructionItems = String(b.instructionItems ?? "");
    const specialNotes = String(b.specialNotes ?? "");
    const remarks = String(b.remarks ?? "");

    const rawRecip = b.recipientEmployeeIds ?? b.employeeIds;
    const recipientEmployeeIds = Array.isArray(rawRecip)
      ? [...new Set(rawRecip.map((x) => String(x).trim()).filter(Boolean))]
      : [];

    const rawInst = b.instructorEmployeeIds;
    const instructorEmployeeIds = Array.isArray(rawInst)
      ? [...new Set(rawInst.map((x) => String(x).trim()).filter(Boolean))]
      : [];

    if (!dateRaw) return reply.code(400).send({ error: "指導日時を入力してください" });
    const date = new Date(dateRaw);
    if (Number.isNaN(date.getTime())) {
      return reply.code(400).send({ error: "指導日時の形式が不正です" });
    }

    if (instructionVenue.length > MAX_VENUE) {
      return reply.code(400).send({ error: "指導実施場所が長すぎます" });
    }
    if (instructionItems.length > MAX_TEXT || specialNotes.length > MAX_TEXT || remarks.length > MAX_TEXT) {
      return reply.code(400).send({ error: "入力が長すぎます" });
    }

    const v = await validateRecipientAndInstructorIds(tenantId, recipientEmployeeIds, instructorEmployeeIds);
    if (!v.ok) return reply.code(400).send({ error: v.error });

    const row = await prisma.instructionRecord.create({
      data: {
        tenantId,
        recipientEmployeeIds: recipientEmployeeIds as unknown as Prisma.InputJsonValue,
        instructorEmployeeIds: instructorEmployeeIds as unknown as Prisma.InputJsonValue,
        date,
        instructionVenue,
        instructionItems,
        specialNotes,
        remarks,
      },
      select: { id: true },
    });

    return { id: row.id };
  });
}
