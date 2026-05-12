import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const postSchema = z
  .object({
    partyName: z.string().min(1).max(200),
    amountYen: z.number().int().positive(),
    referenceNote: z.string().max(2000).nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    partyName: z.string().min(1).max(200).optional(),
    amountYen: z.number().int().positive().optional(),
    status: z.string().max(32).optional(),
    collectedAt: z.string().datetime().nullable().optional(),
    referenceNote: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function registerAccountsReceivableRoutes(app: FastifyInstance): Promise<void> {
  app.get("/accounts-receivable", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const status = String((req.query as { status?: string }).status || "").trim();
    const where: { tenantId: string; status?: string } = { tenantId: tid };
    if (status) where.status = status;
    const entries = await prisma.accountsReceivableEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { entries };
  });

  app.post<{ Body: z.infer<typeof postSchema> }>("/accounts-receivable", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    const b = parsed.data;
    return prisma.accountsReceivableEntry.create({
      data: {
        tenantId: tid,
        partyName: b.partyName.trim(),
        amountYen: b.amountYen,
        referenceNote: b.referenceNote?.trim() || null,
      },
    });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof patchSchema> }>(
    "/accounts-receivable/:id",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const row = await prisma.accountsReceivableEntry.findFirst({ where: { id: req.params.id, tenantId: tid } });
      if (!row) return reply.code(404).send({ error: "not found" });
      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
      const b = parsed.data;
      const data: Record<string, unknown> = {};
      if (b.partyName !== undefined) data.partyName = b.partyName.trim();
      if (b.amountYen !== undefined) data.amountYen = b.amountYen;
      if (b.status !== undefined) data.status = b.status;
      if (b.collectedAt !== undefined) data.collectedAt = b.collectedAt ? new Date(b.collectedAt) : null;
      if (b.referenceNote !== undefined) data.referenceNote = b.referenceNote?.trim() || null;
      if (b.status === "COLLECTED" && data.collectedAt === undefined && !row.collectedAt) {
        data.collectedAt = new Date();
      }
      return prisma.accountsReceivableEntry.update({ where: { id: row.id }, data: data as object });
    },
  );
}
