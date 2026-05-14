import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, clearTokens, getAccessToken, setTokens } from "./api";

/** `/me` が返す `staffMenuVisibility`（テナント設定のコピー） */
export type StaffMenuVisibilityClient = {
  allowedHeaderNavIds: string[] | null;
  allowedSubTabIdsByNav: Partial<Record<string, string[]>>;
};

export type MeUser = {
  id: string;
  email: string;
  displayName: string | null;
  employeeId: string | null;
  tradeName: string;
  employeeDisplayName: string;
  tenant: { id: string; name: string; slug: string };
  roles: string[];
  permissions: string[];
  staffMenuVisibility?: StaffMenuVisibilityClient;
  /** 日付変更時間（28時間表記）。rollHour = dayChangeHour - 24 */
  dayChangeHour: number;
};

/**
 * dayChangeHour（28時間表記）を考慮した現在の事業日（Tokyo, yyyy-MM-dd）を返す。
 * dayChangeHour=28 → 04:00 未満は前日の事業日。
 */
export function currentBusinessYmd(dayChangeHour: number): string {
  const rollHour = dayChangeHour - 24;
  const tokyoParts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => tokyoParts.find((p) => p.type === t)?.value ?? "00";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour"));
  if (rollHour > 0 && hour < rollHour) {
    const prev = new Date(`${ymd}T12:00:00+09:00`);
    prev.setDate(prev.getDate() - 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
  }
  return ymd;
}

type AuthCtx = {
  me: MeUser | null;
  loading: boolean;
  refreshMe: () => Promise<void>;
  login: (slug: string, email: string, password: string) => Promise<string | undefined>;
  register: (p: {
    tenantName: string;
    slug: string;
    email: string;
    password: string;
    familyName: string;
    givenName: string;
    representativeAdmin: boolean;
  }) => Promise<string | undefined>;
  logout: () => void;
  can: (perm: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(Boolean(getAccessToken()));

  const refreshMe = useCallback(async () => {
    if (!getAccessToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await apiFetch<{ user: MeUser | null }>("/me");
    setLoading(false);
    if (r.ok) setMe(r.data.user);
    else {
      clearTokens();
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (slug: string, email: string, password: string) => {
    const r = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/login", {
      method: "POST",
      json: { slug, email, password },
    });
    if (!r.ok) return r.error;
    setTokens(r.data.accessToken, r.data.refreshToken);
    await refreshMe();
    return undefined;
  }, [refreshMe]);

  const register = useCallback(
    async (p: {
      tenantName: string;
      slug: string;
      email: string;
      password: string;
      familyName: string;
      givenName: string;
      representativeAdmin: boolean;
    }) => {
      const r = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/register", {
        method: "POST",
        json: p,
      });
      if (!r.ok) return r.error;
      setTokens(r.data.accessToken, r.data.refreshToken);
      await refreshMe();
      return undefined;
    },
    [refreshMe],
  );

  const logout = useCallback(() => {
    clearTokens();
    setMe(null);
  }, []);

  const can = useCallback(
    (perm: string) => {
      const p = me?.permissions ?? [];
      return p.includes("*") || p.includes(perm);
    },
    [me],
  );

  const value = useMemo(
    () => ({ me, loading, refreshMe, login, register, logout, can }),
    [me, loading, refreshMe, login, register, logout, can],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** 全メニュー（`*` または `nav.full`） */
export function isFullNavMe(permissions: string[]): boolean {
  return permissions.includes("*") || permissions.includes("nav.full");
}

/** 勤務ウィザード中心のスタッフ */
export function isStaffShiftOnlyMe(permissions: string[]): boolean {
  return permissions.includes("staff.shift") && !isFullNavMe(permissions);
}
