import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const postSchema = z
  .object({
    name: z.string().min(1).max(200),
    memo: z.string().max(2000).nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    memo: z.string().max(2000).nullable().optional(),
    archivedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export async function registerReferralSourceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/referral-sources", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const referralSources = await prisma.referralSource.findMany({
      where: { tenantId: tid, archivedAt: null },
      orderBy: { name: "asc" },
      take: 300,
    });
    return { referralSources };
  });

  app.post<{ Body: z.infer<typeof postSchema> }>("/referral-sources", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    const b = parsed.data;
    return prisma.referralSource.create({
      data: { tenantId: tid, name: b.name.trim(), memo: b.memo?.trim() || null },
    });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof patchSchema> }>(
    "/referral-sources/:id",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const row = await prisma.referralSource.findFirst({ where: { id: req.params.id, tenantId: tid } });
      if (!row) return reply.code(404).send({ error: "not found" });
      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
      const b = parsed.data;
      const data: Record<string, unknown> = {};
      if (b.name !== undefined) data.name = b.name.trim();
      if (b.memo !== undefined) data.memo = b.memo?.trim() || null;
      if (b.archivedAt !== undefined) data.archivedAt = b.archivedAt ? new Date(b.archivedAt) : null;
      return prisma.referralSource.update({ where: { id: row.id }, data: data as object });
    },
  );
}
