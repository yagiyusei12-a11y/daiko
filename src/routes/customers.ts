import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const postSchema = z
  .object({
    displayName: z.string().min(1).max(200),
    phone: z.string().max(50).nullable().optional(),
    defaultOrigin: z.string().max(500).optional(),
    defaultDestination: z.string().max(500).optional(),
    defaultTariffVersionId: z.string().nullable().optional(),
    specialFareYen: z.number().int().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    phone: z.string().max(50).nullable().optional(),
    defaultOrigin: z.string().max(500).optional(),
    defaultDestination: z.string().max(500).optional(),
    defaultTariffVersionId: z.string().nullable().optional(),
    specialFareYen: z.number().int().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    archivedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/customers/render-print", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const rows = await prisma.customer.findMany({
      where: { tenantId: tid, archivedAt: null },
      orderBy: { displayName: "asc" },
      include: { defaultTariffVersion: { include: { plan: true } } },
    });
    const tr = rows
      .map(
        (c) =>
          `<tr><td>${esc(c.displayName)}</td><td>${esc(c.phone ?? "")}</td><td>${esc(c.defaultOrigin)}</td><td>${esc(
            c.defaultDestination,
          )}</td><td>${c.specialFareYen ?? "—"}</td><td>${esc(c.notes ?? "")}</td></tr>`,
      )
      .join("");
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>顧客名簿</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:6px;font-size:13px;}th{background:#f4f4f4;}</style></head><body>
<h1>顧客名簿</h1>
<table><thead><tr><th>表示名</th><th>電話</th><th>既定出発</th><th>既定到着</th><th>特別運賃(円)</th><th>備考</th></tr></thead><tbody>${tr}</tbody></table>
</body></html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/customers", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const q = String((req.query as { q?: string }).q || "").trim();
    const where: Prisma.CustomerWhereInput = { tenantId: tid, archivedAt: null };
    if (q) {
      where.OR = [
        { displayName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }
    const customers = await prisma.customer.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: 200,
      include: { defaultTariffVersion: { select: { id: true, version: true, planId: true } } },
    });
    return { customers };
  });

  app.post<{ Body: z.infer<typeof postSchema> }>("/customers", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    const b = parsed.data;
    let defaultTariffVersionId: string | null = b.defaultTariffVersionId ?? null;
    if (defaultTariffVersionId) {
      const ver = await prisma.tariffPlanVersion.findFirst({
        where: { id: defaultTariffVersionId, plan: { tenantId: tid } },
      });
      if (!ver) return reply.code(400).send({ error: "invalid defaultTariffVersionId" });
    }
    const row = await prisma.customer.create({
      data: {
        tenantId: tid,
        displayName: b.displayName.trim(),
        phone: b.phone?.trim() || null,
        defaultOrigin: b.defaultOrigin?.trim() ?? "",
        defaultDestination: b.defaultDestination?.trim() ?? "",
        defaultTariffVersionId,
        specialFareYen: b.specialFareYen ?? null,
        notes: b.notes?.trim() || null,
      },
    });
    return row;
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof patchSchema> }>(
    "/customers/:id",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const row = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: tid } });
      if (!row) return reply.code(404).send({ error: "not found" });
      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
      const b = parsed.data;
      if (b.defaultTariffVersionId !== undefined && b.defaultTariffVersionId) {
        const ver = await prisma.tariffPlanVersion.findFirst({
          where: { id: b.defaultTariffVersionId, plan: { tenantId: tid } },
        });
        if (!ver) return reply.code(400).send({ error: "invalid defaultTariffVersionId" });
      }
      const data: Record<string, unknown> = {};
      if (b.displayName !== undefined) data.displayName = b.displayName.trim();
      if (b.phone !== undefined) data.phone = b.phone?.trim() || null;
      if (b.defaultOrigin !== undefined) data.defaultOrigin = b.defaultOrigin.trim();
      if (b.defaultDestination !== undefined) data.defaultDestination = b.defaultDestination.trim();
      if (b.defaultTariffVersionId !== undefined) data.defaultTariffVersionId = b.defaultTariffVersionId;
      if (b.specialFareYen !== undefined) data.specialFareYen = b.specialFareYen;
      if (b.notes !== undefined) data.notes = b.notes?.trim() || null;
      if (b.archivedAt !== undefined) {
        data.archivedAt = b.archivedAt ? new Date(b.archivedAt) : null;
      }
      return prisma.customer.update({ where: { id: row.id }, data: data as object });
    },
  );
}
