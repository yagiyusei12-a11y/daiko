/**
 * 管理者以外（`nav.full` / `*` を持たないユーザー）向けのメニュー表示制御。
 * `customJson.staffMenuVisibility` に保存。未設定時は制限なし（従来どおり全表示）。
 *
 * 将来、日ごとの仮想枠のように `virtualSlotsByDate` を足す余地がある場合と同様、
 * ここにもロール別の上書きを足せる余地を残す（現状はテナント単位の1セットのみ）。
 */

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

export const STAFF_HEADER_NAV_IDS = [
  "dashboard",
  "daily-reports",
  "complaints",
  "schedule",
  "attendance",
  "documents",
  "instruction-records",
  "settings",
] as const;

export type StaffHeaderNavId = (typeof STAFF_HEADER_NAV_IDS)[number];

/** ヘッダー直下の各画面のタブ id（Tabs の id と一致） */
export const STAFF_SUB_TAB_IDS: Record<string, readonly string[]> = {
  settings: ["company", "basics", "employees-roster", "employees-compensation", "vehicles", "till", "pricing", "online-booking"],
  documents: ["nippo", "meibo", "seiyaku", "nintei", "yakkan", "shido", "kujo", "henko"],
  attendance: ["shift", "adjust", "timecard"],
};

export type StaffMenuVisibilityV1 = {
  version: 1;
  /**
   * null = 制限なし（非フルナビユーザーにも全ヘッダーを表示）
   * 配列 = 表示してよいヘッダー id のみ（このリストに無いヘッダーは非表示）
   */
  allowedHeaderNavIds: string[] | null;
  /**
   * ヘッダー id ごとに、表示してよいサブタブ id。
   * キーが無い = その画面では全タブ表示（ヘッダー自体が許可されている場合）
   */
  allowedSubTabIdsByNav: Partial<Record<string, string[]>>;
};

const DEFAULT_V1: StaffMenuVisibilityV1 = {
  version: 1,
  allowedHeaderNavIds: null,
  allowedSubTabIdsByNav: {},
};

function isKnownNavId(id: string): id is StaffHeaderNavId {
  return (STAFF_HEADER_NAV_IDS as readonly string[]).includes(id);
}

function filterKnownTabIds(navId: string, ids: string[]): string[] {
  const allowed = STAFF_SUB_TAB_IDS[navId];
  if (!allowed) return [];
  const set = new Set(allowed);
  return ids.filter((x) => set.has(x));
}

export function coerceStaffMenuVisibilityFromCustomJson(customJson: unknown): StaffMenuVisibilityV1 {
  const root = asObj(customJson);
  const raw = root.staffMenuVisibility;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_V1 };
  }
  const o = raw as JsonObj;

  let allowedHeaderNavIds: string[] | null = null;
  if (o.allowedHeaderNavIds === null) {
    allowedHeaderNavIds = null;
  } else if (Array.isArray(o.allowedHeaderNavIds)) {
    const xs = o.allowedHeaderNavIds.map((x) => String(x).trim()).filter(Boolean);
    const uniq = [...new Set(xs)].filter(isKnownNavId);
    allowedHeaderNavIds = uniq.length === 0 ? null : uniq;
  }

  if (allowedHeaderNavIds === null) {
    return { version: 1, allowedHeaderNavIds: null, allowedSubTabIdsByNav: {} };
  }

  const allowedSubTabIdsByNav: Partial<Record<string, string[]>> = {};
  const st = o.allowedSubTabIdsByNav;
  if (st && typeof st === "object" && !Array.isArray(st)) {
    for (const [navId, v] of Object.entries(st as Record<string, unknown>)) {
      if (!isKnownNavId(navId)) continue;
      if (!STAFF_SUB_TAB_IDS[navId]) continue;
      if (!Array.isArray(v)) continue;
      const tabs = filterKnownTabIds(
        navId,
        v.map((x) => String(x).trim()).filter(Boolean),
      );
      if (tabs.length > 0) allowedSubTabIdsByNav[navId] = tabs;
    }
  }

  return {
    version: 1,
    allowedHeaderNavIds,
    allowedSubTabIdsByNav,
  };
}

export function mergeStaffMenuVisibilityIntoCustomJson(prevCustomJson: unknown, vis: StaffMenuVisibilityV1): JsonObj {
  const prev = asObj(prevCustomJson);
  return { ...prev, staffMenuVisibility: vis as unknown as JsonObj };
}

export function parseStaffMenuVisibilityPut(body: Record<string, unknown>): { ok: true; value: StaffMenuVisibilityV1 } | { ok: false; error: string } {
  let allowedHeaderNavIds: string[] | null = null;
  if (body.allowedHeaderNavIds === null) {
    allowedHeaderNavIds = null;
  } else if (body.allowedHeaderNavIds === undefined) {
    allowedHeaderNavIds = null;
  } else if (!Array.isArray(body.allowedHeaderNavIds)) {
    return { ok: false, error: "allowedHeaderNavIds は null または文字列の配列で指定してください" };
  } else {
    const xs = body.allowedHeaderNavIds.map((x) => String(x).trim()).filter(Boolean);
    const uniq = [...new Set(xs)];
    for (const id of uniq) {
      if (!isKnownNavId(id)) return { ok: false, error: `不明なヘッダー id: ${id}` };
    }
    allowedHeaderNavIds = uniq.length === 0 ? null : uniq;
  }

  if (allowedHeaderNavIds === null) {
    return { ok: true, value: { version: 1, allowedHeaderNavIds: null, allowedSubTabIdsByNav: {} } };
  }

  const allowedSubTabIdsByNav: Partial<Record<string, string[]>> = {};
  const st = body.allowedSubTabIdsByNav;
  if (st !== undefined && st !== null) {
    if (typeof st !== "object" || Array.isArray(st)) {
      return { ok: false, error: "allowedSubTabIdsByNav はオブジェクトで指定してください" };
    }
    for (const [navId, v] of Object.entries(st as Record<string, unknown>)) {
      if (!isKnownNavId(navId)) return { ok: false, error: `allowedSubTabIdsByNav の不明なキー: ${navId}` };
      const catalog = STAFF_SUB_TAB_IDS[navId];
      if (!catalog) continue;
      if (!Array.isArray(v)) {
        return { ok: false, error: `allowedSubTabIdsByNav.${navId} は文字列の配列で指定してください` };
      }
      const tabs = filterKnownTabIds(
        navId,
        v.map((x) => String(x).trim()).filter(Boolean),
      );
      if (tabs.length === 0) {
        return { ok: false, error: `allowedSubTabIdsByNav.${navId} には1つ以上のタブ id を指定してください` };
      }
      const catSet = new Set(catalog);
      for (const t of tabs) {
        if (!catSet.has(t)) return { ok: false, error: `allowedSubTabIdsByNav.${navId} に不正なタブ id: ${t}` };
      }
      allowedSubTabIdsByNav[navId] = tabs;
    }
  }

  if (allowedHeaderNavIds !== null) {
    for (const navId of Object.keys(allowedSubTabIdsByNav)) {
      if (!allowedHeaderNavIds.includes(navId)) {
        return { ok: false, error: `サブタブを制限している ${navId} は allowedHeaderNavIds に含めてください` };
      }
    }
  }

  return {
    ok: true,
    value: {
      version: 1,
      allowedHeaderNavIds,
      allowedSubTabIdsByNav,
    },
  };
}
