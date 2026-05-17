import type { FastifyReply, FastifyRequest } from "fastify";
import { requireTenantBilling } from "./billing-pre.js";
import { authenticate } from "./pre.js";

/** JWT 認証のあと、テナント課金状態を検証（主要 API 用） */
export async function authenticateAndBilling(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(req, reply);
  if (reply.sent) return;
  await requireTenantBilling(req, reply);
}
