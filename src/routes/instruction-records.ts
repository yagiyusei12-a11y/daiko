import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tokyoDayRangeUtc } from "../lib/tokyo-datetime.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 100_000;
const MAX_LIST = 500;
const MAX_BATCH_CREATE = 80;

export async function registerInstructionRecordsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

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
      include: {
        employee: { select: { id: true, familyName: true, givenName: true } },
      },
    });

    return {
      records: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeFamilyName: r.employee.familyName,
        employeeGivenName: r.employee.givenName,
        date: r.date.toISOString(),
        instructionItems: r.instructionItems,
        specialNotes: r.specialNotes,
        remarks: r.remarks,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};

    const dateRaw = String(b.date ?? "").trim();
    const instructionItems = String(b.instructionItems ?? "");
    const specialNotes = String(b.specialNotes ?? "");
    const remarks = String(b.remarks ?? "");

    const rawIds = b.employeeIds;
    let employeeIds: string[] = [];
    if (Array.isArray(rawIds)) {
      employeeIds = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))];
    } else {
      const single = String(b.employeeId ?? "").trim();
      if (single) employeeIds = [single];
    }

    if (employeeIds.length === 0) {
      return reply.code(400).send({ error: "従業員を1名以上選択してください" });
    }
    if (employeeIds.length > MAX_BATCH_CREATE) {
      return reply.code(400).send({ error: `一度に登録できるのは ${MAX_BATCH_CREATE} 名までです` });
    }
    if (!dateRaw) return reply.code(400).send({ error: "指導日時を入力してください" });

    const date = new Date(dateRaw);
    if (Number.isNaN(date.getTime())) {
      return reply.code(400).send({ error: "指導日時の形式が不正です" });
    }

    if (instructionItems.length > MAX_TEXT || specialNotes.length > MAX_TEXT || remarks.length > MAX_TEXT) {
      return reply.code(400).send({ error: "入力が長すぎます" });
    }

    const emps = await prisma.employee.findMany({
      where: { tenantId, id: { in: employeeIds }, status: "ACTIVE" },
      select: { id: true },
    });
    if (emps.length !== employeeIds.length) {
      return reply.code(400).send({ error: "無効な従業員が含まれるか、在籍でない方が含まれています" });
    }

    const rows = await prisma.$transaction(
      employeeIds.map((employeeId) =>
        prisma.instructionRecord.create({
          data: {
            tenantId,
            employeeId,
            date,
            instructionItems,
            specialNotes,
            remarks,
          },
          select: { id: true },
        }),
      ),
    );

    return { ids: rows.map((r) => r.id), count: rows.length };
  });
}
