import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { apiFetch } from "../api";
import { useSavedToast } from "../saved-toast";
import { Card, Err, Tabs, type TabDef } from "../ui";
import PricingSettingsPanel from "./PricingSettingsPanel";
import BasicSettingsPanel from "./BasicSettingsPanel";
import TillSettingsPanel from "./TillSettingsPanel";
import OnlineBookingSettingsPanel from "./OnlineBookingSettingsPanel";
import { filterSubTabsForMe } from "../lib/staff-menu-client";

const JP_PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
];

type CompanyDto = {
  tenantName: string;
  tenantSlug: string;
  legalTradeName: string | null;
  legalRepresentativeName: string | null;
  legalPostalCode: string | null;
  legalPrefecture: string | null;
  legalStreetAddress: string | null;
  legalPhone: string | null;
  legalPublicSafetyCommission: string | null;
  legalCertificationNumber: string | null;
  legalCertificationDate: string | null;
};

type EmployeeRow = {
  id: string;
  familyName: string;
  givenName: string;
  furigana: string | null;
  address: string | null;
  status: string;
  retiredAt: string | null;
  registerExtension: unknown;
  loginEmail: string | null;
  userId: string | null;
  adminMaster: boolean;
  safetyDrivingManager: boolean;
};

type EmployeeCompCompensationType = "HOURLY_ONLY" | "COMMISSION_ONLY" | "HOURLY_AND_COMMISSION";

type EmployeeCompRowDraft = {
  employeeId: string;
  familyName: string;
  givenName: string;
  status: string;
  compensationType: EmployeeCompCompensationType;
  mainHourlyYen: string;
  partnerHourlyYen: string;
  phoneHourlyYen: string;
  mainCommissionPct: string;
  partnerCommissionPct: string;
};

type VehicleRow = {
  id: string;
  label: string;
  plate: string | null;
  detailJson: unknown;
  legalCoverageStartOn: string | null;
  active: boolean;
  currentOdometer: number | null;
};

function formatOdoLogSource(source: string): string {
  if (source === "DAILY_REPORT") return "日報";
  if (source === "SETTINGS") return "設定";
  return source;
}

function extStr(ext: unknown, k: string): string {
  if (!ext || typeof ext !== "object") return "";
  const v = (ext as Record<string, unknown>)[k];
  return typeof v === "string" ? v : "";
}

function extLicenseConditions(ext: unknown): string[] {
  if (!ext || typeof ext !== "object") return [];
  const v = (ext as Record<string, unknown>).licenseConditions;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function asDetail(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function insOf(detail: unknown): Record<string, unknown> {
  const d = asDetail(detail).voluntaryInsurance;
  return asDetail(d);
}

/** 郵便番号APIの市区町村・町域で既存入力を上書きしない（番地以降を消さない） */
function mergeStreetFromZipLookup(current: string | null | undefined, zipTownBlock: string | null | undefined): string {
  const base = (zipTownBlock ?? "").trim();
  const cur = (current ?? "").trim();
  if (!base) return cur;
  if (!cur) return base;
  if (cur.startsWith(base)) return cur;
  return cur;
}

export default function SettingsMenuPage(): JSX.Element {
  const { me } = useAuth();
  const { flashSaved } = useSavedToast();
  const [tab, setTab] = useState("company");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [licenseClasses, setLicenseClasses] = useState<string[]>([]);
  const [plateRegions, setPlateRegions] = useState<string[]>([]);
  const [licenseConditionOptions, setLicenseConditionOptions] = useState<string[]>([]);
  const [licenseConditionOptionsByKind, setLicenseConditionOptionsByKind] = useState<Record<string, string[]>>({});
  const lastFetchedZipRef = useRef("");

  const [company, setCompany] = useState<CompanyDto | null>(null);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [compRows, setCompRows] = useState<EmployeeCompRowDraft[]>([]);
  const [compBusy, setCompBusy] = useState(false);
  const [empSel, setEmpSel] = useState<string | "new" | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteHiredOn, setInviteHiredOn] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [empForm, setEmpForm] = useState({
    linkedUserId: null as string | null,
    loginEmail: "",
    password: "",
    familyName: "",
    givenName: "",
    furigana: "",
    birthDate: "",
    address: "",
    phone: "",
    mobile: "",
    hiredOn: "",
    retiredOn: "",
    usualWorkDays: "",
    emergencyName: "",
    emergencyTel: "",
    licenseKind: "",
    licenseNumber: "",
    licenseExpiresOn: "",
    licenseConditions: [] as string[],
    licensePhotoFrontDataUrl: "",
    licensePhotoBackDataUrl: "",
    adminMaster: false,
    safetyDrivingManager: false,
  });

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [vehSel, setVehSel] = useState<string | "new" | null>(null);
  const [vehForm, setVehForm] = useState({
    label: "",
    plateOffice: "",
    plateCategory: "",
    plateHiragana: "",
    plateSerial: "",
    inspectionValidTo: "",
    insuranceCompany: "",
    insurancePeriodFrom: "",
    insurancePeriodTo: "",
    currentOdometer: "",
  });

  const [odoHistoryOpen, setOdoHistoryOpen] = useState(false);
  const [odoHistoryLoading, setOdoHistoryLoading] = useState(false);
  const [odoHistoryErr, setOdoHistoryErr] = useState<string | null>(null);
  const [odoHistoryRows, setOdoHistoryRows] = useState<
    { id: string; value: number; source: string; businessDate: string | null; dailyReportId: string | null; createdAt: string }[]
  >([]);

  const loadMeta = useCallback(async () => {
    const r = await apiFetch<{
      licenseClasses: string[];
      plateRegions: string[];
      licenseConditionOptions: string[];
      licenseConditionOptionsByKind?: Record<string, string[]>;
    }>("/settings/meta");
    if (r.ok) {
      setLicenseClasses(r.data.licenseClasses);
      setPlateRegions(r.data.plateRegions);
      setLicenseConditionOptions(r.data.licenseConditionOptions ?? []);
      setLicenseConditionOptionsByKind(r.data.licenseConditionOptionsByKind ?? {});
    }
  }, []);

  const loadCompany = useCallback(async () => {
    const r = await apiFetch<CompanyDto>("/settings/company");
    if (r.ok) setCompany(r.data);
    else setErr(r.error);
  }, []);

  const loadEmployees = useCallback(async () => {
    const r = await apiFetch<{ employees: EmployeeRow[] }>("/settings/employees");
    if (r.ok) setEmployees(r.data.employees);
    else setErr(r.error);
  }, []);

  const loadEmployeeCompensation = useCallback(async () => {
    const r = await apiFetch<{
      rows: Array<{
        employeeId: string;
        familyName: string;
        givenName: string;
        status: string;
        period: {
          id: string;
          compensationType: string;
          mainHourlyYen: number;
          partnerHourlyYen: number;
          phoneHourlyYen: number;
          mainCommissionPct: string;
          partnerCommissionPct: string;
        } | null;
      }>;
    }>("/settings/employee-compensation");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    const allowed: EmployeeCompCompensationType[] = ["HOURLY_ONLY", "COMMISSION_ONLY", "HOURLY_AND_COMMISSION"];
    setCompRows(
      (r.data.rows ?? []).map((row) => {
        const ct = row.period?.compensationType;
        const compensationType: EmployeeCompCompensationType =
          ct && allowed.includes(ct as EmployeeCompCompensationType) ? (ct as EmployeeCompCompensationType) : "HOURLY_ONLY";
        return {
          employeeId: row.employeeId,
          familyName: row.familyName,
          givenName: row.givenName,
          status: row.status,
          compensationType,
          mainHourlyYen: row.period != null ? String(row.period.mainHourlyYen) : "",
          partnerHourlyYen: row.period != null ? String(row.period.partnerHourlyYen) : "",
          phoneHourlyYen: row.period != null ? String(row.period.phoneHourlyYen) : "",
          mainCommissionPct: row.period?.mainCommissionPct ?? "",
          partnerCommissionPct: row.period?.partnerCommissionPct ?? "",
        };
      }),
    );
  }, []);

  const loadVehicles = useCallback(async () => {
    const r = await apiFetch<{ vehicles: VehicleRow[] }>("/settings/vehicles");
    if (r.ok) setVehicles(r.data.vehicles);
    else setErr(r.error);
  }, []);

  const loadOdoHistory = useCallback(async () => {
    if (!vehSel || vehSel === "new") return;
    setOdoHistoryLoading(true);
    setOdoHistoryErr(null);
    const r = await apiFetch<{
      logs: { id: string; value: number; source: string; businessDate: string | null; dailyReportId: string | null; createdAt: string }[];
    }>(`/settings/vehicles/${vehSel}/odometer-logs?limit=100`);
    setOdoHistoryLoading(false);
    if (!r.ok) {
      setOdoHistoryErr(r.error);
      setOdoHistoryRows([]);
      return;
    }
    setOdoHistoryRows(r.data.logs);
  }, [vehSel]);

  useEffect(() => {
    if (odoHistoryOpen && vehSel && vehSel !== "new") void loadOdoHistory();
  }, [odoHistoryOpen, vehSel, loadOdoHistory]);

  useEffect(() => {
    void loadMeta();
    void loadCompany();
    void loadEmployees();
    void loadEmployeeCompensation();
    void loadVehicles();
  }, [loadMeta, loadCompany, loadEmployees, loadEmployeeCompensation, loadVehicles]);

  useEffect(() => {
    if (!company) return;
    const d = (company.legalPostalCode ?? "").replace(/\D/g, "");
    if (d.length < 7) {
      lastFetchedZipRef.current = "";
      return;
    }
    if (lastFetchedZipRef.current === d) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        const r = await apiFetch<{
          ok?: boolean;
          prefecture?: string;
          addressStart?: string;
          message?: string;
        }>(`/settings/zip-lookup?zip=${encodeURIComponent(d)}`);
        if (cancelled) return;
        if (!r.ok) {
          setErr(r.error);
          return;
        }
        const payload = r.data as {
          ok?: boolean;
          prefecture?: string;
          addressStart?: string;
          message?: string;
        };
        if (payload && payload.ok === false) {
          setErr(payload.message || "郵便番号が見つかりません");
          return;
        }
        lastFetchedZipRef.current = d;
        setErr(null);
        setCompany((c) =>
          c
            ? {
                ...c,
                legalPrefecture: payload.prefecture || c.legalPrefecture,
                legalStreetAddress: mergeStreetFromZipLookup(c.legalStreetAddress, payload.addressStart),
              }
            : null,
        );
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [company?.legalPostalCode]);

  const fillEmpForm = (e: EmployeeRow | null): void => {
    if (!e) {
      setEmpSel("new");
      setEmpForm({
        linkedUserId: null,
        loginEmail: "",
        password: "",
        familyName: "",
        givenName: "",
        furigana: "",
        birthDate: "",
        address: "",
        phone: "",
        mobile: "",
        hiredOn: "",
        retiredOn: "",
        usualWorkDays: "",
        emergencyName: "",
        emergencyTel: "",
        licenseKind: "",
        licenseNumber: "",
        licenseExpiresOn: "",
        licenseConditions: [],
        licensePhotoFrontDataUrl: "",
        licensePhotoBackDataUrl: "",
        adminMaster: false,
        safetyDrivingManager: false,
      });
      return;
    }
    const ex = e.registerExtension;
    setEmpSel(e.id);
    const rawLc = extLicenseConditions(ex);
    const lk = extStr(ex, "licenseKind");
    let licenseConditions = rawLc;
    if (licenseClasses.length > 0 && licenseConditionOptions.length > 0) {
      const allowedForLoad = licenseClasses.includes(lk)
        ? (licenseConditionOptionsByKind[lk] ?? [])
        : licenseConditionOptions;
      licenseConditions = rawLc.filter((c) => allowedForLoad.includes(c));
    }
    setEmpForm({
      linkedUserId: e.userId ?? null,
      loginEmail: e.loginEmail ?? "",
      password: "",
      familyName: e.familyName,
      givenName: e.givenName,
      furigana: e.furigana ?? "",
      birthDate: extStr(ex, "birthDate"),
      address: e.address ?? "",
      phone: extStr(ex, "phone"),
      mobile: extStr(ex, "mobile"),
      hiredOn: extStr(ex, "hiredOn"),
      retiredOn: extStr(ex, "retiredOn"),
      usualWorkDays: extStr(ex, "usualWorkDays"),
      emergencyName: extStr(ex, "emergencyName"),
      emergencyTel: extStr(ex, "emergencyTel"),
      licenseKind: extStr(ex, "licenseKind"),
      licenseNumber: extStr(ex, "licenseNumber"),
      licenseExpiresOn: extStr(ex, "licenseExpiresOn"),
      licenseConditions,
      licensePhotoFrontDataUrl: extStr(ex, "licensePhotoFrontDataUrl") || extStr(ex, "licensePhotoDataUrl"),
      licensePhotoBackDataUrl: extStr(ex, "licensePhotoBackDataUrl"),
      adminMaster: Boolean(e.adminMaster),
      safetyDrivingManager: Boolean(e.safetyDrivingManager),
    });
  };

  const fillVehForm = (v: VehicleRow | null): void => {
    if (!v) {
      setVehSel("new");
      setVehForm({
        label: "",
        plateOffice: "",
        plateCategory: "",
        plateHiragana: "",
        plateSerial: "",
        inspectionValidTo: "",
        insuranceCompany: "",
        insurancePeriodFrom: "",
        insurancePeriodTo: "",
        currentOdometer: "",
      });
      return;
    }
    const d = asDetail(v.detailJson);
    const ins = insOf(v.detailJson);
    setVehSel(v.id);
    setVehForm({
      label: v.label,
      plateOffice: String(d.plateOffice ?? ""),
      plateCategory: String(d.plateCategory ?? ""),
      plateHiragana: String(d.plateHiragana ?? ""),
      plateSerial: String(d.plateSerial ?? ""),
      inspectionValidTo: String(d.inspectionValidTo ?? ""),
      insuranceCompany: String(ins.companyName ?? ""),
      insurancePeriodFrom: String(ins.periodFrom ?? ""),
      insurancePeriodTo: String(ins.periodTo ?? ""),
      currentOdometer: v.currentOdometer != null ? String(v.currentOdometer) : "",
    });
  };

  async function saveCompany(): Promise<void> {
    if (!company) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const r = await apiFetch("/settings/company", {
      method: "PUT",
      json: {
        legalTradeName: company.legalTradeName,
        legalRepresentativeName: company.legalRepresentativeName,
        legalPostalCode: company.legalPostalCode,
        legalPrefecture: company.legalPrefecture,
        legalStreetAddress: company.legalStreetAddress,
        legalPhone: company.legalPhone,
        legalPublicSafetyCommission: company.legalPublicSafetyCommission,
        legalCertificationNumber: company.legalCertificationNumber,
        legalCertificationDate: company.legalCertificationDate || null,
      },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else flashSaved();
  }

  async function saveEmployee(): Promise<void> {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const body = {
      ...empForm,
      password: empForm.password || undefined,
    };
    if (empSel === "new") {
      const r = await apiFetch<{ id: string }>("/settings/employees", { method: "POST", json: body });
      setBusy(false);
      if (!r.ok) setErr(r.error);
      else {
        flashSaved();
        await loadEmployees();
        await loadEmployeeCompensation();
        fillEmpForm(null);
      }
      return;
    }
    if (empSel) {
      const r = await apiFetch(`/settings/employees/${empSel}`, { method: "PATCH", json: body });
      setBusy(false);
      if (!r.ok) setErr(r.error);
      else {
        flashSaved();
        await loadEmployees();
        await loadEmployeeCompensation();
      }
    }
  }

  async function deleteEmployee(): Promise<void> {
    if (!empSel || empSel === "new") return;
    if (!window.confirm("この従業員を削除しますか？（日報に紐づく場合は削除できません）")) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch(`/settings/employees/${empSel}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      setMsg("削除しました。");
      setEmpSel(null);
      fillEmpForm(null);
      await loadEmployees();
      await loadEmployeeCompensation();
    }
  }

  async function saveEmployeeCompensation(): Promise<void> {
    setCompBusy(true);
    setErr(null);
    setMsg(null);
    const r = await apiFetch("/settings/employee-compensation", {
      method: "PUT",
      json: {
        rows: compRows.map((c) => ({
          employeeId: c.employeeId,
          compensationType: c.compensationType,
          mainHourlyYen: c.mainHourlyYen,
          partnerHourlyYen: c.partnerHourlyYen,
          phoneHourlyYen: c.phoneHourlyYen,
          mainCommissionPct: c.mainCommissionPct,
          partnerCommissionPct: c.partnerCommissionPct,
        })),
      },
    });
    setCompBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      await loadEmployeeCompensation();
    }
  }

  async function saveVehicle(): Promise<void> {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const { currentOdometer: _odoStr, ...vehRest } = vehForm;
    const body: Record<string, unknown> = {
      ...vehRest,
      inspectionValidTo: vehForm.inspectionValidTo || "",
      insuranceCompany: vehForm.insuranceCompany,
      insurancePeriodFrom: vehForm.insurancePeriodFrom || "",
      insurancePeriodTo: vehForm.insurancePeriodTo || "",
    };
    const odoTrim = vehForm.currentOdometer.trim();
    if (odoTrim !== "") {
      body.currentOdometer = Math.max(0, Math.floor(Number(odoTrim) || 0));
    } else if (vehSel !== "new") {
      body.currentOdometer = null;
    }
    if (vehSel === "new") {
      const r = await apiFetch<{ id: string }>("/settings/vehicles", { method: "POST", json: body });
      setBusy(false);
      if (!r.ok) setErr(r.error);
      else {
        flashSaved();
        await loadVehicles();
        fillVehForm(null);
      }
      return;
    }
    if (vehSel) {
      const r = await apiFetch(`/settings/vehicles/${vehSel}`, { method: "PATCH", json: body });
      setBusy(false);
      if (!r.ok) setErr(r.error);
      else {
        flashSaved();
        await loadVehicles();
      }
    }
  }

  async function deleteVehicle(): Promise<void> {
    if (!vehSel || vehSel === "new") return;
    if (!window.confirm("この車両を削除しますか？")) return;
    setBusy(true);
    const r = await apiFetch(`/settings/vehicles/${vehSel}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      setMsg("削除しました。");
      setVehSel(null);
      fillVehForm(null);
      await loadVehicles();
    }
  }

  function onLicensePhotoSide(side: "front" | "back", f: File | null): void {
    if (!f) return;
    if (f.size > 900_000) {
      setErr("画像が大きすぎます（900KB 以下にしてください）");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const s = typeof reader.result === "string" ? reader.result : "";
      if (side === "front") setEmpForm((p) => ({ ...p, licensePhotoFrontDataUrl: s }));
      else setEmpForm((p) => ({ ...p, licensePhotoBackDataUrl: s }));
    };
    reader.readAsDataURL(f);
  }

  function toggleLicenseCondition(label: string): void {
    setEmpForm((p) => ({
      ...p,
      licenseConditions: p.licenseConditions.includes(label)
        ? p.licenseConditions.filter((x) => x !== label)
        : [...p.licenseConditions, label],
    }));
  }

  const licenseConditionChoices = useMemo(() => {
    const lk = empForm.licenseKind.trim();
    if (!lk) return [];
    if (licenseClasses.length > 0 && licenseClasses.includes(empForm.licenseKind)) {
      return licenseConditionOptionsByKind[empForm.licenseKind] ?? [];
    }
    if (licenseConditionOptions.length > 0) return licenseConditionOptions;
    return [];
  }, [empForm.licenseKind, licenseClasses, licenseConditionOptionsByKind, licenseConditionOptions]);

  const companyPanel = company ? (() => {
    const zipDigits = (company.legalPostalCode ?? "").replace(/\D/g, "").slice(0, 7);
    const zip3 = zipDigits.slice(0, 3);
    const zip4 = zipDigits.slice(3);
    return (
    <div className="settings-form">
      <p className="settings-hint">
        テナント: {company.tenantName}（{company.tenantSlug}） / ログイン: {me?.email}
      </p>
      <label>屋号</label>
      <input
        value={company.legalTradeName ?? ""}
        onChange={(e) => setCompany({ ...company, legalTradeName: e.target.value })}
      />
      <label>代表者</label>
      <input
        value={company.legalRepresentativeName ?? ""}
        onChange={(e) => setCompany({ ...company, legalRepresentativeName: e.target.value })}
      />
      <label>郵便番号（例: 526-0842）</label>
      <div className="settings-postal-row">
        <input
          className="settings-postal-part"
          inputMode="numeric"
          maxLength={3}
          autoComplete="postal-code"
          value={zip3}
          onChange={(e) => {
            const n = e.target.value.replace(/\D/g, "").slice(0, 3);
            const rest = zipDigits.slice(3);
            setCompany({ ...company, legalPostalCode: (n + rest).slice(0, 7) || null });
          }}
          placeholder="526"
          aria-label="郵便番号 前3桁"
        />
        <span className="settings-postal-sep" aria-hidden>
          ー
        </span>
        <input
          className="settings-postal-part settings-postal-part--wide"
          inputMode="numeric"
          maxLength={4}
          value={zip4}
          onChange={(e) => {
            const n = e.target.value.replace(/\D/g, "").slice(0, 4);
            const head = zipDigits.slice(0, 3);
            setCompany({ ...company, legalPostalCode: (head + n).slice(0, 7) || null });
          }}
          placeholder="0842"
          aria-label="郵便番号 後4桁"
        />
      </div>
      <p className="settings-hint">7桁そろうと、都道府県と市区町村・町域まで自動入力します。</p>
      <label>都道府県</label>
      <select
        value={company.legalPrefecture ?? ""}
        onChange={(e) => setCompany({ ...company, legalPrefecture: e.target.value || null })}
      >
        <option value="">選択</option>
        {JP_PREFECTURES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <label>住所（番地以降）</label>
      <input
        value={company.legalStreetAddress ?? ""}
        onChange={(e) => setCompany({ ...company, legalStreetAddress: e.target.value })}
      />
      <label>電話番号</label>
      <input
        value={company.legalPhone ?? ""}
        onChange={(e) => setCompany({ ...company, legalPhone: e.target.value })}
      />
      <label>認定をした公安委員会</label>
      <input
        value={company.legalPublicSafetyCommission ?? ""}
        onChange={(e) => setCompany({ ...company, legalPublicSafetyCommission: e.target.value || null })}
        placeholder="例: 兵庫県公安委員会"
      />
      <label>認定番号</label>
      <div className="settings-inline-cert">
        <span aria-hidden>第</span>
        <input
          className="settings-cert-core"
          value={company.legalCertificationNumber ?? ""}
          onChange={(e) => setCompany({ ...company, legalCertificationNumber: e.target.value })}
          placeholder="1234"
        />
        <span aria-hidden>号</span>
      </div>
      <label>認定年月日</label>
      <input
        type="date"
        value={company.legalCertificationDate ?? ""}
        onChange={(e) => setCompany({ ...company, legalCertificationDate: e.target.value || null })}
      />
      <button type="button" className="settings-primary" disabled={busy} onClick={() => void saveCompany()}>
        保存
      </button>
    </div>
    );
  })() : (
    <p className="settings-hint">読み込み中…</p>
  );

  async function generateInviteUrl(): Promise<void> {
    if (!inviteHiredOn) return;
    setInviteBusy(true);
    setInviteErr(null);
    setInviteToken(null);
    setInviteCopied(false);
    const r = await apiFetch<{ token: string }>("/settings/employee-invite", {
      method: "POST",
      json: { hiredOn: inviteHiredOn },
    });
    setInviteBusy(false);
    if (!r.ok) {
      setInviteErr(r.error);
      return;
    }
    setInviteToken(r.data.token);
  }

  function inviteUrl(): string {
    if (!inviteToken) return "";
    return `${window.location.origin}/app/invite/${encodeURIComponent(inviteToken)}`;
  }

  async function copyInviteUrl(): Promise<void> {
    await navigator.clipboard.writeText(inviteUrl());
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  const employeesRosterPanel = (
    <>
    {inviteOpen ? (
      <div
        className="pricing-modal-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) { setInviteOpen(false); setInviteToken(null); setInviteErr(null); }
        }}
      >
        <div
          className="pricing-modal attend-shift-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-dialog-title"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ maxWidth: "30rem" }}
        >
          <h2 id="invite-dialog-title" className="pricing-modal-title">従業員が入力するURL</h2>
          <div className="settings-form" style={{ padding: "0 0.25rem" }}>
            <label>採用年月日</label>
            <input
              type="date"
              value={inviteHiredOn}
              onChange={(e) => { setInviteHiredOn(e.target.value); setInviteToken(null); }}
              autoFocus
            />
            {inviteErr ? <p style={{ color: "var(--color-danger)", fontSize: "0.85rem" }}>{inviteErr}</p> : null}
            {!inviteToken ? (
              <div className="settings-actions">
                <button
                  type="button"
                  className="settings-primary"
                  disabled={!inviteHiredOn || inviteBusy}
                  onClick={() => void generateInviteUrl()}
                >
                  {inviteBusy ? "生成中…" : "登録URLを生成"}
                </button>
                <button type="button" onClick={() => setInviteOpen(false)}>閉じる</button>
              </div>
            ) : (
              <>
                <label style={{ marginTop: "0.75rem" }}>登録URL（30日間有効・1回使い切り）</label>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    readOnly
                    value={inviteUrl()}
                    style={{ flex: 1, fontSize: "0.78rem", background: "var(--color-border)" }}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="settings-secondary"
                    onClick={() => void copyInviteUrl()}
                    style={{ flexShrink: 0 }}
                  >
                    {inviteCopied ? "コピー済" : "コピー"}
                  </button>
                </div>
                <div className="settings-actions" style={{ marginTop: "1rem" }}>
                  <button type="button" onClick={() => { setInviteOpen(false); setInviteToken(null); }}>閉じる</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    ) : null}
    <div className="settings-two-col">
      <div>
        <div className="settings-toolbar">
          <button type="button" onClick={() => fillEmpForm(null)}>
            新規
          </button>
          <button
            type="button"
            className="settings-secondary"
            onClick={() => { setInviteOpen(true); setInviteToken(null); setInviteErr(null); setInviteCopied(false); }}
          >
            従業員が入力
          </button>
        </div>
        <ul className="settings-list">
          {employees.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`settings-list-btn${empSel === e.id ? " active" : ""}`}
                onClick={() => fillEmpForm(e)}
              >
                {e.familyName} {e.givenName}
                <span className="settings-list-meta">{e.loginEmail ?? "ログインなし"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="settings-form">
        <h3 className="settings-subtitle">{empSel === "new" ? "新規従業員" : empSel ? "編集" : "一覧から選択または新規"}</h3>
        {(empSel === "new" || empSel) && (
          <>
            <label>ログインID（メール）</label>
            <input
              type="email"
              value={empForm.loginEmail}
              onChange={(e) => setEmpForm({ ...empForm, loginEmail: e.target.value })}
              disabled={empSel === "new" ? false : !empForm.linkedUserId}
              title={
                empSel !== "new" && !empForm.linkedUserId
                  ? "ログインユーザーが未作成のため、ここでは変更できません"
                  : undefined
              }
            />
            <label>パスワード{empSel !== "new" ? "（変更する場合のみ）" : ""}</label>
            <input
              type="password"
              value={empForm.password}
              onChange={(e) => setEmpForm({ ...empForm, password: e.target.value })}
              autoComplete="new-password"
            />
            <label>氏名（姓）</label>
            <input value={empForm.familyName} onChange={(e) => setEmpForm({ ...empForm, familyName: e.target.value })} />
            <label>氏名（名）</label>
            <input value={empForm.givenName} onChange={(e) => setEmpForm({ ...empForm, givenName: e.target.value })} />
            <label>ふりがな（カタカナ推奨）</label>
            <input
              value={empForm.furigana}
              onChange={(e) => setEmpForm({ ...empForm, furigana: e.target.value })}
              placeholder="例: ヤギ ユウセイ"
              autoComplete="off"
            />
            <label>生年月日</label>
            <input type="date" value={empForm.birthDate} onChange={(e) => setEmpForm({ ...empForm, birthDate: e.target.value })} />
            <label>住所</label>
            <input value={empForm.address} onChange={(e) => setEmpForm({ ...empForm, address: e.target.value })} />
            <div className="settings-checkbox-row">
              <label className="settings-inline-check">
                <input
                  type="checkbox"
                  checked={empForm.adminMaster}
                  onChange={(e) => setEmpForm({ ...empForm, adminMaster: e.target.checked })}
                />
                管理者
              </label>
              <label className="settings-inline-check">
                <input
                  type="checkbox"
                  checked={empForm.safetyDrivingManager}
                  onChange={(e) => setEmpForm({ ...empForm, safetyDrivingManager: e.target.checked })}
                />
                安全運転管理者
              </label>
            </div>
            <label>電話番号</label>
            <input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} />
            <label>携帯電話</label>
            <input value={empForm.mobile} onChange={(e) => setEmpForm({ ...empForm, mobile: e.target.value })} />
            <label>採用年月日</label>
            <input type="date" value={empForm.hiredOn} onChange={(e) => setEmpForm({ ...empForm, hiredOn: e.target.value })} />
            <label>退社年月日</label>
            <input type="date" value={empForm.retiredOn} onChange={(e) => setEmpForm({ ...empForm, retiredOn: e.target.value })} />
            <label>主な出勤日</label>
            <input
              value={empForm.usualWorkDays}
              onChange={(e) => setEmpForm({ ...empForm, usualWorkDays: e.target.value })}
              placeholder="例: 月〜金"
            />
            <label>緊急連絡先 氏名</label>
            <input value={empForm.emergencyName} onChange={(e) => setEmpForm({ ...empForm, emergencyName: e.target.value })} />
            <label>緊急連絡先 TEL</label>
            <input value={empForm.emergencyTel} onChange={(e) => setEmpForm({ ...empForm, emergencyTel: e.target.value })} />
            <label>免許種別（一番上位の種別を選択）</label>
            <select
              value={empForm.licenseKind}
              onChange={(e) => {
                const next = e.target.value;
                setEmpForm((f) => {
                  let allowed: string[] = [];
                  if (next.trim()) {
                    if (licenseClasses.length > 0 && licenseClasses.includes(next)) {
                      allowed = licenseConditionOptionsByKind[next] ?? [];
                    } else {
                      allowed = licenseConditionOptions;
                    }
                  }
                  return {
                    ...f,
                    licenseKind: next,
                    licenseConditions:
                      allowed.length > 0 ? f.licenseConditions.filter((c) => allowed.includes(c)) : f.licenseConditions,
                  };
                });
              }}
            >
              <option value="">選択</option>
              {empForm.licenseKind && licenseClasses.length > 0 && !licenseClasses.includes(empForm.licenseKind) ? (
                <option value={empForm.licenseKind}>
                  {empForm.licenseKind}（登録済・種別は下の一覧から更新してください）
                </option>
              ) : null}
              {licenseClasses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label>免許番号</label>
            <div className="settings-inline-cert">
              <span aria-hidden>第</span>
              <input
                className="settings-cert-core"
                value={empForm.licenseNumber}
                onChange={(e) => setEmpForm({ ...empForm, licenseNumber: e.target.value })}
                placeholder="番号"
              />
              <span aria-hidden>号</span>
            </div>
            <label>有効期限</label>
            <input
              type="date"
              value={empForm.licenseExpiresOn}
              onChange={(e) => setEmpForm({ ...empForm, licenseExpiresOn: e.target.value })}
            />
            <label>免許の条件・限定等（複数選択）</label>
            {!empForm.licenseKind.trim() ? (
              <p className="settings-hint">先に免許種別を選ぶと、この免許であり得る条件・限定の候補だけが表示されます。</p>
            ) : null}
            <div className="settings-license-conditions">
              {licenseConditionChoices.map((opt) => (
                <label key={opt} className="settings-check settings-check--block">
                  <input
                    type="checkbox"
                    checked={empForm.licenseConditions.includes(opt)}
                    onChange={() => toggleLicenseCondition(opt)}
                  />{" "}
                  {opt}
                </label>
              ))}
            </div>
            <label>免許証の写真（表面）</label>
            <input type="file" accept="image/*" onChange={(e) => onLicensePhotoSide("front", e.target.files?.[0] ?? null)} />
            {empForm.licensePhotoFrontDataUrl ? (
              <img className="settings-photo-preview" src={empForm.licensePhotoFrontDataUrl} alt="免許証表面" />
            ) : null}
            <label>免許証の写真（裏面）</label>
            <input type="file" accept="image/*" onChange={(e) => onLicensePhotoSide("back", e.target.files?.[0] ?? null)} />
            {empForm.licensePhotoBackDataUrl ? (
              <img className="settings-photo-preview" src={empForm.licensePhotoBackDataUrl} alt="免許証裏面" />
            ) : null}
            <div className="settings-actions">
              <button type="button" className="settings-primary" disabled={busy} onClick={() => void saveEmployee()}>
                保存
              </button>
              {empSel && empSel !== "new" ? (
                <button type="button" className="settings-danger" disabled={busy} onClick={() => void deleteEmployee()}>
                  削除
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
    </>
  );

  const employeesCompPanel = (
    <div className="settings-comp-col">
      <p className="settings-hint" style={{ marginTop: 0 }}>
        現在有効な報酬です。「賃金を保存」で一覧の全員分をまとめて保存します（未登録の従業員は今日付の報酬期間が作成されます）。歩合率は百分率（5.5% は 5.5 と入力）。
      </p>
      <div className="settings-comp-table-wrap">
        <table className="settings-comp-table">
          <thead>
            <tr>
              <th>氏名</th>
              <th>賃金体系</th>
              <th>客車時給（円）</th>
              <th>随伴車時給（円）</th>
              <th>電話時給（円）</th>
              <th>客車歩合（%）</th>
              <th>随伴車歩合（%）</th>
            </tr>
          </thead>
          <tbody>
            {compRows.map((row) => (
              <tr key={row.employeeId} className={row.status === "RETIRED" ? "settings-comp-row--retired" : undefined}>
                <td>
                  {row.familyName} {row.givenName}
                </td>
                <td>
                  <select
                    className="settings-comp-select"
                    value={row.compensationType}
                    aria-label={`${row.familyName} 賃金体系`}
                    onChange={(e) =>
                      setCompRows((xs) =>
                        xs.map((x) =>
                          x.employeeId === row.employeeId
                            ? { ...x, compensationType: e.target.value as EmployeeCompCompensationType }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="HOURLY_ONLY">時給</option>
                    <option value="COMMISSION_ONLY">歩合</option>
                    <option value="HOURLY_AND_COMMISSION">時給+歩合</option>
                  </select>
                </td>
                <td>
                  <input
                    className="settings-comp-num"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={`${row.familyName} 客車時給`}
                    value={row.mainHourlyYen}
                    onChange={(e) =>
                      setCompRows((xs) =>
                        xs.map((x) => (x.employeeId === row.employeeId ? { ...x, mainHourlyYen: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="settings-comp-num"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={`${row.familyName} 随伴車時給`}
                    value={row.partnerHourlyYen}
                    onChange={(e) =>
                      setCompRows((xs) =>
                        xs.map((x) => (x.employeeId === row.employeeId ? { ...x, partnerHourlyYen: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="settings-comp-num"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={`${row.familyName} 電話時給`}
                    value={row.phoneHourlyYen}
                    onChange={(e) =>
                      setCompRows((xs) =>
                        xs.map((x) => (x.employeeId === row.employeeId ? { ...x, phoneHourlyYen: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="settings-comp-num"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    inputMode="decimal"
                    aria-label={`${row.familyName} 客車歩合`}
                    value={row.mainCommissionPct}
                    onChange={(e) =>
                      setCompRows((xs) =>
                        xs.map((x) => (x.employeeId === row.employeeId ? { ...x, mainCommissionPct: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="settings-comp-num"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    inputMode="decimal"
                    aria-label={`${row.familyName} 随伴車歩合`}
                    value={row.partnerCommissionPct}
                    onChange={(e) =>
                      setCompRows((xs) =>
                        xs.map((x) =>
                          x.employeeId === row.employeeId ? { ...x, partnerCommissionPct: e.target.value } : x,
                        )
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="settings-primary"
        disabled={compBusy || busy || compRows.length === 0}
        onClick={() => void saveEmployeeCompensation()}
      >
        賃金を保存
      </button>
    </div>
  );

  const vehiclesPanel = (
    <div className="settings-two-col">
      <div>
        <div className="settings-toolbar">
          <button type="button" onClick={() => fillVehForm(null)}>
            新規
          </button>
        </div>
        <ul className="settings-list">
          {vehicles.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className={`settings-list-btn${vehSel === v.id ? " active" : ""}`}
                onClick={() => fillVehForm(v)}
              >
                {v.label}
                <span className="settings-list-meta">{v.plate ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="settings-form">
        <h3 className="settings-subtitle">{vehSel === "new" ? "新規随伴車" : vehSel ? "編集" : "一覧から選択または新規"}</h3>
        {(vehSel === "new" || vehSel) && (
          <>
            <label>名称</label>
            <input value={vehForm.label} onChange={(e) => setVehForm({ ...vehForm, label: e.target.value })} />
            <label>地域名（運輸支局）</label>
            <select value={vehForm.plateOffice} onChange={(e) => setVehForm({ ...vehForm, plateOffice: e.target.value })}>
              <option value="">選択</option>
              {plateRegions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <label>分類番号</label>
            <input value={vehForm.plateCategory} onChange={(e) => setVehForm({ ...vehForm, plateCategory: e.target.value })} />
            <label>ひらがな</label>
            <input value={vehForm.plateHiragana} onChange={(e) => setVehForm({ ...vehForm, plateHiragana: e.target.value })} />
            <label>ナンバー</label>
            <input value={vehForm.plateSerial} onChange={(e) => setVehForm({ ...vehForm, plateSerial: e.target.value })} />
            <label>車検有効期満了日</label>
            <input
              type="date"
              value={vehForm.inspectionValidTo}
              onChange={(e) => setVehForm({ ...vehForm, inspectionValidTo: e.target.value })}
            />
            <label>任意保険・保険会社名</label>
            <input
              value={vehForm.insuranceCompany}
              onChange={(e) => setVehForm({ ...vehForm, insuranceCompany: e.target.value })}
            />
            <label>任意保険・期間（開始）</label>
            <input
              type="date"
              value={vehForm.insurancePeriodFrom}
              onChange={(e) => setVehForm({ ...vehForm, insurancePeriodFrom: e.target.value })}
            />
            <label>任意保険・期間（終了）</label>
            <input
              type="date"
              value={vehForm.insurancePeriodTo}
              onChange={(e) => setVehForm({ ...vehForm, insurancePeriodTo: e.target.value })}
            />
            <label>メーター（現在ODO）</label>
            <p className="settings-hint" style={{ marginTop: 0 }}>
              日報で随伴車・客車メーターを保存するたびに上書きされます。ここから直接直す場合も履歴に残ります。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="number"
                min={0}
                style={{ flex: "1 1 10rem", minWidth: 0 }}
                value={vehForm.currentOdometer}
                onChange={(e) => setVehForm({ ...vehForm, currentOdometer: e.target.value })}
                placeholder="未設定"
              />
              {vehSel && vehSel !== "new" ? (
                <button type="button" className="settings-secondary" onClick={() => setOdoHistoryOpen(true)}>
                  履歴
                </button>
              ) : null}
            </div>
            <div className="settings-actions">
              <button type="button" className="settings-primary" disabled={busy} onClick={() => void saveVehicle()}>
                保存
              </button>
              {vehSel && vehSel !== "new" ? (
                <button type="button" className="settings-danger" disabled={busy} onClick={() => void deleteVehicle()}>
                  削除
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );

  const pricingPanel = <PricingSettingsPanel setErr={setErr} busy={busy} setBusy={setBusy} />;

  const basicsPanel = <BasicSettingsPanel setErr={setErr} busy={busy} setBusy={setBusy} />;

  const tillPanel = <TillSettingsPanel setErr={setErr} busy={busy} setBusy={setBusy} />;

  const onlineBookingPanel = <OnlineBookingSettingsPanel setErr={setErr} busy={busy} setBusy={setBusy} />;

  const tabItems: TabDef[] = [
    { id: "company", label: "会社情報", children: companyPanel },
    { id: "basics", label: "基本", children: basicsPanel },
    { id: "employees-roster", label: "名簿", children: employeesRosterPanel },
    { id: "employees-compensation", label: "賃金", children: employeesCompPanel },
    { id: "vehicles", label: "随伴車", children: vehiclesPanel },
    { id: "till", label: "レジ", children: tillPanel },
    { id: "pricing", label: "料金", children: pricingPanel },
    { id: "online-booking", label: "ネット予約", children: onlineBookingPanel },
  ];

  const visTabs = me ? filterSubTabsForMe("settings", tabItems, me) : tabItems;
  const visTabKey = visTabs.map((t) => t.id).join(",");

  useEffect(() => {
    if (!visTabs.some((t) => t.id === tab)) {
      setTab(visTabs[0]?.id ?? "company");
    }
  }, [tab, visTabKey]);

  return (
    <Card title="設定">
      <Err msg={err} />
      {msg ? (
        <p className="settings-msg" role="status">
          {msg}
        </p>
      ) : null}
      <Tabs items={visTabs} activeId={tab} onActiveChange={setTab} aria-label="設定の種類" />
      {odoHistoryOpen && vehSel && vehSel !== "new" ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOdoHistoryOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="odo-hist-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="odo-hist-title" className="pricing-modal-title">
              ODO 更新履歴（{vehicles.find((x) => x.id === vehSel)?.label ?? ""}）
            </h2>
            <Err msg={odoHistoryErr} />
            <div className="attend-shift-dialog-scroll">
              {odoHistoryLoading ? <p className="settings-hint">読み込み中…</p> : null}
              {!odoHistoryLoading && odoHistoryRows.length === 0 ? <p className="settings-hint">履歴はまだありません。</p> : null}
              {!odoHistoryLoading && odoHistoryRows.length > 0 ? (
                <table className="trip-history-table" style={{ minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th>記録日時</th>
                      <th>ODO</th>
                      <th>区分</th>
                      <th>事業日</th>
                      <th>日報</th>
                    </tr>
                  </thead>
                  <tbody>
                    {odoHistoryRows.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.createdAt).toLocaleString("ja-JP")}</td>
                        <td>{row.value.toLocaleString("ja-JP")}</td>
                        <td>{formatOdoLogSource(row.source)}</td>
                        <td>{row.businessDate ?? "—"}</td>
                        <td>
                          {row.dailyReportId ? (
                            <Link to={`/daily-reports/${row.dailyReportId}`} onClick={() => setOdoHistoryOpen(false)}>
                              開く
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
            <div className="pricing-modal-actions">
              <button type="button" onClick={() => setOdoHistoryOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
