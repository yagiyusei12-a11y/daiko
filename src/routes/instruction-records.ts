import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { isChromiumConfiguredForPdf, renderHtmlToPdf } from "../lib/html-to-pdf.js";
import { buildInstructionRecordsPdfHtml } from "../lib/instruction-record-print-html.js";
import { formatInstructionRecordsForApi, parseEmployeeIdArrayJson } from "../lib/instruction-records-format.js";
import { tokyoDayRangeUtc } from "../lib/tokyo-datetime.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 100_000;
const MAX_LIST = 500;
const MAX_RECIPIENTS = 80;
const MAX_INSTRUCTORS = 30;
const MAX_VENUE = 500;

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

  app.post<{ Body: Record<string, unknown> }>("/export-pdf", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};
    const from = String(b.from ?? "").trim();
    const to = String(b.to ?? "").trim();
    if (!YMD_RE.test(from) || !YMD_RE.test(to)) {
      return reply.code(400).send({ error: "from / to は yyyy-MM-dd の両方で指定してください" });
    }
    const rFrom = tokyoDayRangeUtc(from);
    const rTo = tokyoDayRangeUtc(to);
    if (!rFrom || !rTo) return reply.code(400).send({ error: "日付が不正です" });
    if (rFrom.start.getTime() > rTo.start.getTime()) {
      return reply.code(400).send({ error: "開始日は終了日以前にしてください" });
    }

    const rows = await prisma.instructionRecord.findMany({
      where: { tenantId, date: { gte: rFrom.start, lt: rTo.end } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: MAX_LIST,
    });
    const formatted = await formatInstructionRecordsForApi(tenantId, rows);
    if (formatted.length === 0) {
      return reply.code(400).send({ error: "該当期間に指導記録がありません" });
    }
    if (!isChromiumConfiguredForPdf()) {
      return reply.code(503).send({
        error:
          "PDF 出力はサーバーに Chromium のインストールと環境変数 CHROMIUM_EXECUTABLE の設定が必要です。管理者に連絡するか、ブラウザの印刷機能をお使いください。",
      });
    }
    const html = buildInstructionRecordsPdfHtml(formatted);
    try {
      const buf = await renderHtmlToPdf(html);
      return reply
        .type("application/pdf")
        .header("Content-Disposition", 'attachment; filename="instruction-records.pdf"')
        .send(buf);
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ error: "PDF の生成に失敗しました。時間をおいて再度お試しください。" });
    }
  });

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
