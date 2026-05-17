import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import {
  billingRequiredMessage,
  evaluateTenantBillingAccess,
} from "../lib/tenant-billing.js";
import { jwtUser } from "./pre.js";

export const BILLING_REQUIRED_CODE = "BILLING_REQUIRED" as const;

export async function requireTenantBilling(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const u = jwtUser(req);
  const tenant = await prisma.tenant.findUnique({
    where: { id: u.tenantId },
    select: {
      slug: true,
      billingStatus: true,
      paidThroughAt: true,
      trialEndsAt: true,
    },
  });

  const access = evaluateTenantBillingAccess(
    tenant
      ? {
          billingStatus: tenant.billingStatus,
          paidThroughAt: tenant.paidThroughAt,
          trialEndsAt: tenant.trialEndsAt,
        }
      : null,
    { email: u.email, tenantSlug: tenant?.slug ?? "" },
  );

  if (access.allowed) return;

  void reply.code(402).send({
    error: billingRequiredMessage(access.billingStatus),
    code: BILLING_REQUIRED_CODE,
    billingStatus: access.billingStatus,
  });
}
