import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const postSchema = z
  .object({
    title: z.string().min(1).max(300),
    note: z.string().max(2000).nullable().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    vehicleId: z.string().nullable().optional(),
    status: z.string().max(50).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    note: z.string().max(2000).nullable().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    vehicleId: z.string().nullable().optional(),
    status: z.string().max(50).optional(),
  })
  .strict();

export async function registerDispatchReservationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dispatch-reservations", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) return reply.code(400).send({ error: "from and to (ISO datetime) required" });
    const fromD = new Date(from);
    const toD = new Date(to);
    if (!Number.isFinite(fromD.getTime()) || !Number.isFinite(toD.getTime())) {
      return reply.code(400).send({ error: "invalid from/to" });
    }
    const reservations = await prisma.dispatchReservation.findMany({
      where: {
        tenantId: tid,
        startsAt: { lte: toD },
        endsAt: { gte: fromD },
      },
      orderBy: { startsAt: "asc" },
      include: { vehicle: true },
      take: 500,
    });
    return { reservations };
  });

  app.post<{ Body: z.infer<typeof postSchema> }>("/dispatch-reservations", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    const b = parsed.data;
    const startsAt = new Date(b.startsAt);
    const endsAt = new Date(b.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      return reply.code(400).send({ error: "invalid startsAt/endsAt" });
    }
    if (endsAt <= startsAt) return reply.code(400).send({ error: "endsAt must be after startsAt" });
    let vehicleId: string | null = b.vehicleId ?? null;
    if (vehicleId) {
      const v = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId: tid } });
      if (!v) return reply.code(400).send({ error: "invalid vehicleId" });
    }
    return prisma.dispatchReservation.create({
      data: {
        tenantId: tid,
        title: b.title.trim(),
        note: b.note?.trim() || null,
        startsAt,
        endsAt,
        vehicleId,
        status: b.status?.trim() || "CONFIRMED",
      },
      include: { vehicle: true },
    });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof patchSchema> }>(
    "/dispatch-reservations/:id",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const row = await prisma.dispatchReservation.findFirst({ where: { id: req.params.id, tenantId: tid } });
      if (!row) return reply.code(404).send({ error: "not found" });
      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
      const b = parsed.data;
      const data: Record<string, unknown> = {};
      if (b.title !== undefined) data.title = b.title.trim();
      if (b.note !== undefined) data.note = b.note?.trim() || null;
      if (b.startsAt !== undefined) {
        const d = new Date(b.startsAt);
        if (!Number.isFinite(d.getTime())) return reply.code(400).send({ error: "invalid startsAt" });
        data.startsAt = d;
      }
      if (b.endsAt !== undefined) {
        const d = new Date(b.endsAt);
        if (!Number.isFinite(d.getTime())) return reply.code(400).send({ error: "invalid endsAt" });
        data.endsAt = d;
      }
      if (b.vehicleId !== undefined) {
        if (b.vehicleId) {
          const v = await prisma.vehicle.findFirst({ where: { id: b.vehicleId, tenantId: tid } });
          if (!v) return reply.code(400).send({ error: "invalid vehicleId" });
        }
        data.vehicleId = b.vehicleId;
      }
      if (b.status !== undefined) data.status = b.status.trim();
      const starts = (data.startsAt as Date | undefined) ?? row.startsAt;
      const ends = (data.endsAt as Date | undefined) ?? row.endsAt;
      if (ends <= starts) return reply.code(400).send({ error: "endsAt must be after startsAt" });
      return prisma.dispatchReservation.update({
        where: { id: row.id },
        data: data as object,
        include: { vehicle: true },
      });
    },
  );
}
