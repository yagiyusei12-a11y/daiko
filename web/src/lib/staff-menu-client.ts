import type { MeUser } from "../auth";
import { isFullNavMe } from "../auth";

/** ヘッダー（`Shell`）と同じ並び・パス。`id` はサーバの `staff-menu-visibility-settings.ts` と一致させる */
export const STAFF_HEADER_NAV_META = [
  { id: "dashboard", to: "/dashboard", label: "ダッシュボード", match: "prefix" as const },
  { id: "daily-reports", to: "/daily-reports", label: "日報", match: "prefix" as const },
  { id: "complaints", to: "/complaints", label: "苦情", match: "prefix" as const },
  { id: "schedule", to: "/schedule", label: "スケジュール", match: "schedule" as const },
  { id: "attendance", to: "/attendance", label: "勤怠", match: "prefix" as const },
  { id: "documents", to: "/documents", label: "書類", match: "prefix" as const },
  { id: "instruction-records", to: "/instruction-records", label: "指導", match: "prefix" as const },
  { id: "settings", to: "/settings", label: "設定", match: "prefix" as const },
] as const;

export type StaffHeaderNavMeta = (typeof STAFF_HEADER_NAV_META)[number];

/** サブタブ id は各ページの `Tabs` の id と一致（サーバの STAFF_SUB_TAB_IDS と同じ） */
export const STAFF_SUB_TAB_LABELS: Record<string, { id: string; label: string }[]> = {
  settings: [
    { id: "company", label: "会社情報" },
    { id: "basics", label: "基本" },
    { id: "employees", label: "従業員" },
    { id: "vehicles", label: "随伴車" },
    { id: "till", label: "レジ" },
    { id: "pricing", label: "料金" },
    { id: "online-booking", label: "ネット予約" },
  ],
  documents: [
    { id: "nippo", label: "日報" },
    { id: "meibo", label: "従業員名簿" },
    { id: "seiyaku", label: "誓約書" },
    { id: "nintei", label: "認定証" },
    { id: "yakkan", label: "約款" },
    { id: "shido", label: "指導記録簿" },
    { id: "kujo", label: "苦情処理簿" },
    { id: "henko", label: "変更届出書" },
  ],
  attendance: [
    { id: "shift", label: "シフト" },
    { id: "adjust", label: "シフト調整" },
    { id: "timecard", label: "タイムカード" },
  ],
};

export type StaffMenuVisApi = {
  allowedHeaderNavIds: string[] | null;
  allowedSubTabIdsByNav: Partial<Record<string, string[]>>;
};

export type StaffVisDraft = {
  nav: Record<string, boolean>;
  tabs: Record<string, Record<string, boolean>>;
};

export function staffVisDraftFromApi(v: StaffMenuVisApi | undefined | null): StaffVisDraft {
  const allowed = v?.allowedHeaderNavIds;
  const nav: Record<string, boolean> = {};
  for (const m of STAFF_HEADER_NAV_META) {
    nav[m.id] = !allowed || allowed.length === 0 ? true : allowed.includes(m.id);
  }
  const tabs: Record<string, Record<string, boolean>> = {};
  for (const [navId, defs] of Object.entries(STAFF_SUB_TAB_LABELS)) {
    const restrict = v?.allowedSubTabIdsByNav?.[navId];
    tabs[navId] = {};
    for (const { id } of defs) {
      tabs[navId][id] = !restrict || restrict.length === 0 ? true : restrict.includes(id);
    }
  }
  return { nav, tabs };
}

export function buildStaffMenuVisibilityPut(d: StaffVisDraft): StaffMenuVisApi {
  const allNavOn = STAFF_HEADER_NAV_META.every((m) => d.nav[m.id]);
  if (allNavOn) {
    return { allowedHeaderNavIds: null, allowedSubTabIdsByNav: {} };
  }
  const allowedHeaderNavIds = STAFF_HEADER_NAV_META.filter((m) => d.nav[m.id]).map((m) => m.id);

  const allowedSubTabIdsByNav: Partial<Record<string, string[]>> = {};
  for (const [navId, defs] of Object.entries(STAFF_SUB_TAB_LABELS)) {
    if (!d.nav[navId]) continue;
    const row = d.tabs[navId];
    if (!row) continue;
    const tabIds = defs.map((x) => x.id);
    const allTabOn = tabIds.every((tid) => row[tid]);
    if (allTabOn) continue;
    const picked = tabIds.filter((tid) => row[tid]);
    if (picked.length > 0) allowedSubTabIdsByNav[navId] = picked;
  }

  return { allowedHeaderNavIds, allowedSubTabIdsByNav };
}

export function isHeaderNavIdAllowed(me: MeUser, navId: string): boolean {
  if (isFullNavMe(me.permissions)) return true;
  const ids = me.staffMenuVisibility?.allowedHeaderNavIds;
  if (!ids || ids.length === 0) return true;
  return ids.includes(navId);
}

export function pathnameToHeaderNavId(pathname: string): string {
  const p = pathname || "/";
  if (p === "/" || p.startsWith("/schedule")) return "schedule";
  for (const m of STAFF_HEADER_NAV_META) {
    if (m.id === "schedule") continue;
    if (p === m.to || p.startsWith(`${m.to}/`)) return m.id;
  }
  return "schedule";
}

export function firstAllowedNavTo(me: MeUser): string {
  if (isFullNavMe(me.permissions)) return "/schedule";
  const ids = me.staffMenuVisibility?.allowedHeaderNavIds;
  if (!ids || ids.length === 0) return "/schedule";
  const order = STAFF_HEADER_NAV_META.map((m) => m.id);
  const sorted = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const first = sorted[0];
  const meta = STAFF_HEADER_NAV_META.find((m) => m.id === first);
  return meta?.to ?? "/schedule";
}

export function filterHeaderNavMetaForMe(me: MeUser): typeof STAFF_HEADER_NAV_META {
  if (isFullNavMe(me.permissions)) return [...STAFF_HEADER_NAV_META];
  const ids = me.staffMenuVisibility?.allowedHeaderNavIds;
  if (!ids || ids.length === 0) return [...STAFF_HEADER_NAV_META];
  const set = new Set(ids);
  return STAFF_HEADER_NAV_META.filter((m) => set.has(m.id));
}

export function filterSubTabsForMe<T extends { id: string }>(navId: string, items: T[], me: MeUser): T[] {
  if (isFullNavMe(me.permissions)) return items;
  const restrict = me.staffMenuVisibility?.allowedSubTabIdsByNav?.[navId];
  if (!restrict || restrict.length === 0) return items;
  const set = new Set(restrict);
  return items.filter((t) => set.has(t.id));
}

export function navClassForMeta(pathname: string, item: StaffHeaderNavMeta): string {
  if (item.match === "schedule") {
    return pathname === "/" || pathname.startsWith("/schedule") ? "active" : "";
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`) ? "active" : "";
}
