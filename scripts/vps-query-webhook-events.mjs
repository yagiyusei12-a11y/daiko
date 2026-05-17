import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rows = await prisma.stripeWebhookEvent.findMany({
  orderBy: { createdAt: "desc" },
  take: 20,
  select: { id: true, type: true, processedAt: true, error: true, createdAt: true },
});
console.log(JSON.stringify(rows, null, 2));
console.log("count:", rows.length);
await prisma.$disconnect();
