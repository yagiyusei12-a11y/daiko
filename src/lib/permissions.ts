import { prisma } from "../db.js";

export async function userHasWildcard(userId: string, tenantId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) return false;
  for (const ur of user.roles) {
    const arr = ur.role.permissions as unknown;
    if (Array.isArray(arr) && arr.some((p) => p === "*")) return true;
  }
  return false;
}

export async function userHasPermission(
  userId: string,
  tenantId: string,
  permission: string,
): Promise<boolean> {
  if (await userHasWildcard(userId, tenantId)) return true;
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) return false;
  const set = new Set<string>();
  for (const ur of user.roles) {
    const arr = ur.role.permissions as unknown;
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (typeof p === "string") set.add(p);
    }
  }
  return set.has(permission);
}

/** ワイルドカードでない場合の個別権限一覧（UI 用）。`*` なら `["*"]` のみ返す。 */
export async function userEffectivePermissionList(userId: string, tenantId: string): Promise<string[]> {
  if (await userHasWildcard(userId, tenantId)) return ["*"];
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) return [];
  const set = new Set<string>();
  for (const ur of user.roles) {
    const arr = ur.role.permissions as unknown;
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (typeof p === "string") set.add(p);
    }
  }
  return [...set];
}

/** 全メニュー利用（オーナー・管理者） */
export function isFullNavUser(permissions: string[]): boolean {
  return permissions.includes("*") || permissions.includes("nav.full");
}

/**
 * 従業員マスタの「管理者」に合わせて、紐づくログインユーザーのロールを同期する。
 * adminMaster=true → owner（*） / false → staff（staff.shift）
 * テナント内に * 権限ユーザーが0人になる降格は拒否する。
 */
export async function syncLinkedUserRoleForAdminMaster(
  tenantId: string,
  userId: string,
  adminMaster: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ownerRole = await prisma.role.findFirst({ where: { tenantId, name: "owner" } });
  const staffRole = await prisma.role.findFirst({ where: { tenantId, name: "staff" } });
  if (!ownerRole || !staffRole) {
    return { ok: false, error: "テナントの権限ロールが見つかりません" };
  }

  if (!adminMaster) {
    const stillAdmin = await userHasWildcard(userId, tenantId);
    if (stillAdmin) {
      const users = await prisma.user.findMany({
        where: { tenantId },
        select: { id: true },
      });
      let wildcardCount = 0;
      for (const u of users) {
        if (await userHasWildcard(u.id, tenantId)) wildcardCount += 1;
      }
      if (wildcardCount <= 1) {
        return {
          ok: false,
          error: "最後の管理者の権限は外せません。先に別の従業員を管理者にしてください。",
        };
      }
    }
  }

  const targetRoleId = adminMaster ? ownerRole.id : staffRole.id;
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.create({ data: { userId, roleId: targetRoleId } });
  });
  return { ok: true };
}

/** 勤務ウィザード中心のスタッフ（フルでない） */
export function isStaffShiftOnly(permissions: string[]): boolean {
  return permissions.includes("staff.shift") && !isFullNavUser(permissions);
}

export type UserAccessContext = {
  employeeId: string | null;
  permissions: string[];
  isFullNav: boolean;
  isStaffShiftOnly: boolean;
};

export async function loadUserAccess(userId: string, tenantId: string): Promise<UserAccessContext> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { employeeId: true },
  });
  const permissions = await userEffectivePermissionList(userId, tenantId);
  const isFullNav = isFullNavUser(permissions);
  return {
    employeeId: user?.employeeId ?? null,
    permissions,
    isFullNav,
    isStaffShiftOnly: permissions.includes("staff.shift") && !isFullNav,
  };
}
