import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const tenants = await prisma.tenant.findMany({
  where: { stripeCustomerId: { not: null } },
  select: {
    id: true,
    slug: true,
    billingStatus: true,
    paidThroughAt: true,
    stripeCustomerId: true,
    billingUpdatedAt: true,
  },
  orderBy: { billingUpdatedAt: "desc" },
  take: 10,
});
console.log(JSON.stringify(tenants, null, 2));
const events = await prisma.stripeWebhookEvent.findMany({
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { id: true, type: true, processedAt: true, error: true },
});
console.log("webhooks:", JSON.stringify(events, null, 2));
await prisma.$disconnect();
