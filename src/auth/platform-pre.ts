import type { FastifyReply, FastifyRequest } from "fastify";
import { isPlatformAdminEmail } from "../lib/platform-admin.js";
import { authenticate, jwtUser } from "./pre.js";

export async function requirePlatformAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(req, reply);
  if (reply.sent) return;

  const u = jwtUser(req);
  if (!isPlatformAdminEmail(u.email)) {
    reply.code(403).send({ error: "プラットフォーム管理者権限が必要です" });
  }
}
