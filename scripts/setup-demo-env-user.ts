/**
 * 本番 VPS 用: デモ専用 User（nav.full のみ、owner の * なし）を用意し、
 * DAIKO_DEMO_* 用の slug / email を stdout に出す。
 * 実行: cd ~/daiko && npx tsx scripts/setup-demo-env-user.ts
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const DEMO_EMAIL = "daiko-demo@demo.local";
const DEMO_ROLE_NAME = "demo";
const DEMO_PERMISSIONS = ["nav.full", "staff.shift"] as const;
/** サンプルデータがあるテナント（本番では nagahama） */
const PREFERRED_SLUG = process.env.DAIKO_DEMO_TENANT_SLUG?.trim() || "nagahama";

const p = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await p.tenant.findUnique({
    where: { slug: PREFERRED_SLUG },
    include: {
      roles: true,
      employees: { where: { status: "ACTIVE" }, take: 1, orderBy: { createdAt: "asc" } },
    },
  });
  if (!tenant) {
    console.error(`tenant not found: ${PREFERRED_SLUG}`);
    process.exit(1);
  }

  let role = tenant.roles.find((r) => r.name === DEMO_ROLE_NAME);
  if (!role) {
    role = await p.role.create({
      data: {
        tenantId: tenant.id,
        name: DEMO_ROLE_NAME,
        permissions: [...DEMO_PERMISSIONS],
      },
    });
    console.error(`created role ${DEMO_ROLE_NAME} with permissions ${DEMO_PERMISSIONS.join(", ")}`);
  } else {
    const perms = role.permissions as unknown;
    const hasStar = Array.isArray(perms) && perms.includes("*");
    if (hasStar) {
      console.error(`role ${DEMO_ROLE_NAME} has wildcard; aborting`);
      process.exit(1);
    }
    await p.role.update({
      where: { id: role.id },
      data: { permissions: [...DEMO_PERMISSIONS] },
    });
    console.error(`updated role ${DEMO_ROLE_NAME} permissions`);
  }

  const employeeId = tenant.employees[0]?.id ?? null;
  const passwordHash = await bcrypt.hash(`demo-unused-${Date.now()}`, 10);

  let user = await p.user.findFirst({
    where: { tenantId: tenant.id, email: DEMO_EMAIL },
    include: { roles: true },
  });

  if (!user) {
    user = await p.user.create({
      data: {
        tenantId: tenant.id,
        email: DEMO_EMAIL,
        passwordHash,
        displayName: "デモ閲覧",
        employeeId,
      },
      include: { roles: true },
    });
    console.error(`created user ${DEMO_EMAIL}`);
  } else {
    await p.user.update({
      where: { id: user.id },
      data: { employeeId: user.employeeId ?? employeeId },
    });
    console.error(`user ${DEMO_EMAIL} already exists`);
  }

  const linked = await p.userRole.findUnique({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
  });
  if (!linked) {
    await p.userRole.create({ data: { userId: user.id, roleId: role.id } });
    console.error(`linked user to role ${DEMO_ROLE_NAME}`);
  }

  const ownerRoles = await p.userRole.findMany({
    where: { userId: user.id },
    include: { role: true },
  });
  for (const ur of ownerRoles) {
    if (ur.role.name === "owner") {
      console.error("WARNING: demo user also has owner role — remove manually");
    }
    const perms = ur.role.permissions as unknown;
    if (Array.isArray(perms) && perms.includes("*")) {
      console.error("WARNING: demo user has wildcard role — remove manually");
    }
  }

  console.log(JSON.stringify({ slug: tenant.slug, email: DEMO_EMAIL, role: DEMO_ROLE_NAME, permissions: DEMO_PERMISSIONS }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
