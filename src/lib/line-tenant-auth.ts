import { prisma } from "../db.js";
import { verifyLineIdToken } from "./line-id-token.js";

/** テナントに紐づく各 LINE チャネルで id_token を検証し、最初に通ったチャネルを返す */
export async function resolveLineUserForTenant(
  tenantId: string,
  idToken: string,
): Promise<{ lineUserId: string; lineChannelId: string } | null> {
  const channels = await prisma.tenantLineChannel.findMany({
    where: { tenantId },
    orderBy: { lineChannelId: "asc" },
    select: { lineChannelId: true },
  });
  for (const ch of channels) {
    const r = await verifyLineIdToken(idToken, ch.lineChannelId);
    if (r.ok) return { lineUserId: r.payload.sub, lineChannelId: r.payload.aud };
  }
  return null;
}
