/** VPS 上で一度だけ実行: npx tsx scripts/inspect-demo-tenant.ts */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main(): Promise<void> {
  const tenants = await p.tenant.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      _count: { select: { demoSeedBatches: true, users: true } },
    },
  });

  const batchTenantIds = new Set(
    (await p.demoSeedBatch.findMany({ select: { tenantId: true } })).map((b) => b.tenantId),
  );

  const demoRelated = tenants.filter(
    (t) =>
      t.slug.toLowerCase().includes("demo") ||
      t.name.includes("デモ") ||
      t.name.toLowerCase().includes("demo") ||
      t._count.demoSeedBatches > 0 ||
      batchTenantIds.has(t.id),
  );

  console.log("=== demo-related tenants ===");
  console.log(JSON.stringify(demoRelated, null, 2));

  for (const t of demoRelated) {
    const users = await p.user.findMany({
      where: { tenantId: t.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: { include: { role: { select: { name: true, permissions: true } } } },
      },
    });
    console.log(`=== users for tenant ${t.slug} ===`);
    console.log(JSON.stringify(users, null, 2));
  }

  console.log("=== all tenants (summary) ===");
  console.log(
    JSON.stringify(
      tenants.map((t) => ({
        slug: t.slug,
        name: t.name,
        demoBatches: t._count.demoSeedBatches,
        users: t._count.users,
      })),
      null,
      2,
    ),
  );

  for (const slug of tenants.map((t) => t.slug)) {
    const detail = await p.tenant.findUnique({
      where: { slug },
      include: {
        users: { include: { roles: { include: { role: { select: { name: true, permissions: true } } } } } },
        _count: {
          select: {
            dailyReports: true,
            timeCardPunches: true,
            employees: true,
            demoSeedBatches: true,
            vehicles: true,
          },
        },
      },
    });
    console.log(`=== tenant detail: ${slug} ===`);
    console.log(JSON.stringify(detail, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
