/**
 * デモ専用テナントを作成しサンプルデータを投入する。
 * VPS: cd ~/daiko && npx tsx scripts/seed-demo-tenant.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  DEMO_TENANT_SLUG,
  DEMO_USER_EMAIL,
  removeDemoUserFromOtherTenants,
  seedDemoTenant,
} from "../src/lib/demo-tenant-seed.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.error("seeding demo tenant...");
  const payload = await seedDemoTenant(prisma);
  const removed = await removeDemoUserFromOtherTenants(prisma, payload.tenantId);
  if (removed > 0) console.error(`removed ${removed} demo user(s) from other tenants`);

  console.log(
    JSON.stringify({
      slug: DEMO_TENANT_SLUG,
      email: DEMO_USER_EMAIL,
      tenantId: payload.tenantId,
      counts: {
        employees: payload.employeeIds.length,
        dailyReports: payload.dailyReportIds.length,
        timeCardPunches: payload.timeCardPunchIds.length,
        complaints: payload.complaintIds.length,
      },
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
