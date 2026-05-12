import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import {
  fareYenForTrip,
  pickupFareYen,
  type TierPick,
  type VersionPricingInput,
} from "../lib/tariffPricing";
import { Card, Err, StepWizard, Tabs, type StepWizardStep } from "../ui";

const TARIFF_PLANS_QUERY = "?versionsLimit=30";

type Seg = { id: string; fromM: number; toM: number; fareYen: number; fareMemberYen?: number | null };
type Tier = {
  id: string;
  sortOrder: number;
  fromM: number;
  untilM: number | null;
  stepM: number;
  addYenPerStep: number;
};
type Ver = {
  id: string;
  version: number;
  initialDistanceM: number;
  initialFareYen: number;
  addUnitDistanceM: number;
  addFareYen: number;
  waitingFareYenPerMin: number;
  distanceMode: string;
  waitingRuleJson: unknown;
  perViaStopYen: number;
  cancellationFeeYen: number;
  nightSurchargeBps: number;
  leftHandSurchargeBps: number;
  leftHandSurchargeFlatYen?: number;
  nightSurchargeFlatYen?: number;
  lateNightFlatYen?: number;
  earlyMorningFlatYen?: number;
  earlyRushFlatYen?: number;
  pickupRuleJson?: unknown;
  distanceDiscountFromM?: number | null;
  distanceDiscountBps?: number;
  notes?: string | null;
  segments: Seg[];
  distanceTiers?: Tier[];
};
type Plan = { id: string; name: string; versions: Ver[] };

type TabId = "plans" | "distance" | "waiting" | "extras" | "simulator";

function friendlyError(msg: string): string {
  const m = msg.trim().toLowerCase();
  if (!msg.trim()) return "エラーが発生しました。";
  if (m.includes("invalid body") || m.includes("bad request") || m === "400") return "入力内容を確認してください。";
  if (m.includes("not found") || m === "404") return "データが見つかりません。";
  if (m.includes("unauthorized") || m === "401") return "ログインの有効期限が切れている可能性があります。再度ログインしてください。";
  if (m.includes("forbidden") || m === "403") return "この操作は許可されていません。";
  if (m.includes("conflict") || m === "409") return "他の変更とぶつかりました。画面を更新してからやり直してください。";
  return msg;
}

/** 画面上は「％」（10% なら 10）。API は bps（10000=100%） */
function percentStrFromBps(bps: number): string {
  if (!Number.isFinite(bps)) return "0";
  return String(Math.round(bps / 100));
}

function bpsFromPercentInput(s: string): number {
  const n = Number(String(s).trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function findPlanForVersion(plans: Plan[], verId: string | null): { plan: Plan; ver: Ver } | null {
  if (!verId) return null;
  for (const p of plans) {
    for (const v of p.versions) {
      if (v.id === verId) return { plan: p, ver: v };
    }
  }
  return null;
}

function findVerLabel(plans: Plan[], verId: string | null): string {
  const hit = findPlanForVersion(plans, verId);
  if (!hit) return "（未選択）";
  return `${hit.plan.name}／${hit.ver.version}番の内容`;
}

function findVersion(plans: Plan[], verId: string | null): Ver | null {
  if (!verId) return null;
  for (const p of plans) {
    for (const v of p.versions) {
      if (v.id === verId) return v;
    }
  }
  return null;
}

function versionToPricingInput(v: Ver): VersionPricingInput {
  return {
    distanceMode: v.distanceMode ?? "INITIAL_ADD",
    initialDistanceM: v.initialDistanceM,
    initialFareYen: v.initialFareYen,
    addUnitDistanceM: v.addUnitDistanceM,
    addFareYen: v.addFareYen,
    waitingFareYenPerMin: v.waitingFareYenPerMin,
    waitingRuleJson: v.waitingRuleJson,
    perViaStopYen: v.perViaStopYen ?? 0,
    nightSurchargeBps: v.nightSurchargeBps ?? 0,
    leftHandSurchargeBps: v.leftHandSurchargeBps ?? 0,
    pickupRuleJson: v.pickupRuleJson,
    distanceDiscountFromM: v.distanceDiscountFromM ?? null,
    distanceDiscountBps: v.distanceDiscountBps ?? 0,
    nightSurchargeFlatYen: v.nightSurchargeFlatYen ?? 0,
    leftHandSurchargeFlatYen: v.leftHandSurchargeFlatYen ?? 0,
    lateNightFlatYen: v.lateNightFlatYen ?? 0,
    earlyMorningFlatYen: v.earlyMorningFlatYen ?? 0,
    earlyRushFlatYen: v.earlyRushFlatYen ?? 0,
  };
}

function tiersToPick(ts: Tier[] | undefined): TierPick[] {
  return (ts ?? []).map((t) => ({
    sortOrder: t.sortOrder,
    fromM: t.fromM,
    untilM: t.untilM,
    stepM: t.stepM,
    addYenPerStep: t.addYenPerStep,
  }));
}

const WAITING_PRESETS: { id: string; label: string; json: unknown }[] = [
  { id: "linear0", label: "シンプル（待った分だけ円で増える）", json: { type: "linear", graceMin: 0, perMinYen: 0 } },
  { id: "block_kece", label: "10分までは無料、そのあと10分ごとに1000円", json: { type: "block", graceMin: 10, blockEveryMin: 10, blockYen: 1000 } },
  { id: "block_as", label: "10分までは無料、そのあと5分ごとに500円", json: { type: "block", graceMin: 10, blockEveryMin: 5, blockYen: 500 } },
  { id: "grace_plus", label: "3分までは無料、次に200円、そのあと1分あたり100円", json: { type: "grace_flat_then_linear", graceMin: 3, firstChargeYen: 200, perMinAfterFirstYen: 100 } },
  {
    id: "daruma_wait",
    label: "最初の15分で500円、そのあと5分ごとに500円",
    json: { type: "prefix_block_then_block", graceMin: 0, prefixMin: 15, prefixYen: 500, blockEveryMin: 5, blockYen: 500 },
  },
  {
    id: "hiyoko_wait",
    label: "最初の20分で1000円、そのあと10分ごとに1000円",
    json: { type: "prefix_block_then_block", graceMin: 0, prefixMin: 20, prefixYen: 1000, blockEveryMin: 10, blockYen: 1000 },
  },
];

const PICKUP_TEMPLATE = `[
  { "fromM": 0, "toM": 5000, "yen": 0 },
  { "fromM": 5001, "toM": 10000, "yen": 500 },
  { "fromM": 10001, "toM": null, "yen": 1000 }
]`;

const TAB_LABELS: { id: TabId; label: string }[] = [
  { id: "plans", label: "料金セット一覧" },
  { id: "distance", label: "走った距離の料金" },
  { id: "waiting", label: "待ち時間・途中の停車" },
  { id: "extras", label: "夜間などの割増・迎え車" },
  { id: "simulator", label: "試しに計算する" },
];

const DISTANCE_MODE_OPTIONS: { value: string; label: string; hint: string }[] = [
  {
    value: "INITIAL_ADD",
    label: "最初の区間と、そのあとの追加",
    hint: "「最初の◯メートルまで◯円、そのあと◯メートルごとに◯円加算」という一般的な形です。",
  },
  {
    value: "SEGMENTS_ONLY",
    label: "表（距離の幅ごと）だけで決める",
    hint: "距離の幅ごとに金額を並べます。一覧タブの「距離の幅を追加」で行を足します。",
  },
  {
    value: "TIERED_ADD",
    label: "最初の区間のあと、幅の違う加算を重ねる",
    hint: "途中から「◯メートルごとに◯円」を、距離に応じて切り替えられます（段階的な加算）。",
  },
];

export default function Tariffs(): JSX.Element {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("plans");

  const [name, setName] = useState("");
  const [planWizardOpen, setPlanWizardOpen] = useState(false);
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [nwDistanceMode, setNwDistanceMode] = useState("INITIAL_ADD");
  const [nwInitialDistanceM, setNwInitialDistanceM] = useState("2000");
  const [nwInitialFareYen, setNwInitialFareYen] = useState("800");
  const [nwAddUnitDistanceM, setNwAddUnitDistanceM] = useState("200");
  const [nwAddFareYen, setNwAddFareYen] = useState("100");
  const [nwWaitingFareYenPerMin, setNwWaitingFareYenPerMin] = useState("0");
  const [nwWaitingRuleJson, setNwWaitingRuleJson] = useState(JSON.stringify({ type: "linear", graceMin: 0, perMinYen: 0 }, null, 2));
  const [nwPerViaStopYen, setNwPerViaStopYen] = useState("0");
  const [nwCancellationFeeYen, setNwCancellationFeeYen] = useState("0");
  const [nwNightSurchargeBps, setNwNightSurchargeBps] = useState("0");
  const [nwLeftHandSurchargeBps, setNwLeftHandSurchargeBps] = useState("0");
  const [nwLeftHandSurchargeFlatYen, setNwLeftHandSurchargeFlatYen] = useState("0");
  const [nwNightSurchargeFlatYen, setNwNightSurchargeFlatYen] = useState("0");
  const [nwLateNightFlatYen, setNwLateNightFlatYen] = useState("0");
  const [nwEarlyMorningFlatYen, setNwEarlyMorningFlatYen] = useState("0");
  const [nwEarlyRushFlatYen, setNwEarlyRushFlatYen] = useState("0");
  const [nwDistanceDiscountFromM, setNwDistanceDiscountFromM] = useState("");
  const [nwDistanceDiscountBps, setNwDistanceDiscountBps] = useState("0");
  const [nwPickupRuleJson, setNwPickupRuleJson] = useState("[]");
  const [nwNotes, setNwNotes] = useState("");

  const [segWizardOpen, setSegWizardOpen] = useState(false);
  const [segSubmitting, setSegSubmitting] = useState(false);
  const [verSaveSubmitting, setVerSaveSubmitting] = useState(false);
  const [selVer, setSelVer] = useState<string | null>(null);
  const [fromM, setFromM] = useState("");
  const [toM, setToM] = useState("");
  const [fareYen, setFareYen] = useState("");
  const [fareMemberYen, setFareMemberYen] = useState("");

  const [editInitialDistanceM, setEditInitialDistanceM] = useState("");
  const [editInitialFareYen, setEditInitialFareYen] = useState("");
  const [editAddUnitDistanceM, setEditAddUnitDistanceM] = useState("");
  const [editAddFareYen, setEditAddFareYen] = useState("");
  const [editWaitingFareYenPerMin, setEditWaitingFareYenPerMin] = useState("");
  const [editDistanceMode, setEditDistanceMode] = useState<string>("INITIAL_ADD");
  const [editWaitingRuleJson, setEditWaitingRuleJson] = useState("{}");
  const [editPerViaStopYen, setEditPerViaStopYen] = useState("0");
  const [editCancellationFeeYen, setEditCancellationFeeYen] = useState("0");
  const [editNightSurchargeBps, setEditNightSurchargeBps] = useState("0");
  const [editLeftHandSurchargeBps, setEditLeftHandSurchargeBps] = useState("0");
  const [editLeftHandSurchargeFlatYen, setEditLeftHandSurchargeFlatYen] = useState("0");
  const [editNightSurchargeFlatYen, setEditNightSurchargeFlatYen] = useState("0");
  const [editLateNightFlatYen, setEditLateNightFlatYen] = useState("0");
  const [editEarlyMorningFlatYen, setEditEarlyMorningFlatYen] = useState("0");
  const [editEarlyRushFlatYen, setEditEarlyRushFlatYen] = useState("0");
  const [editPickupRuleJson, setEditPickupRuleJson] = useState("[]");
  const [editDistanceDiscountFromM, setEditDistanceDiscountFromM] = useState("");
  const [editDistanceDiscountBps, setEditDistanceDiscountBps] = useState("0");
  const [editNotes, setEditNotes] = useState("");

  const [simDistanceKm, setSimDistanceKm] = useState("");
  const [simWaitMin, setSimWaitMin] = useState("0");
  const [simMember, setSimMember] = useState(false);
  const [simViaStops, setSimViaStops] = useState("0");
  const [simNight, setSimNight] = useState(false);
  const [simLeftHand, setSimLeftHand] = useState(false);
  const [simLeftHandFlat, setSimLeftHandFlat] = useState(false);
  const [simPickupFromBaseM, setSimPickupFromBaseM] = useState("");
  const [simNightFlat, setSimNightFlat] = useState(false);
  const [simLateFlat, setSimLateFlat] = useState(false);
  const [simEarlyFlat, setSimEarlyFlat] = useState(false);
  const [simRushFlat, setSimRushFlat] = useState(false);

  const [tierFromM, setTierFromM] = useState("");
  const [tierUntilM, setTierUntilM] = useState("");
  const [tierStepM, setTierStepM] = useState("200");
  const [tierAddYen, setTierAddYen] = useState("100");
  const [tierSubmitting, setTierSubmitting] = useState(false);
  const [planDeletingId, setPlanDeletingId] = useState<string | null>(null);

  const selectedVersion = useMemo(() => findVersion(plans, selVer), [plans, selVer]);
  const selectionCtx = useMemo(() => findPlanForVersion(plans, selVer), [plans, selVer]);

  const simResultYen = useMemo(() => {
    if (!selectedVersion) return null;
    const km = Number(simDistanceKm);
    const wait = Number(simWaitMin);
    const via = Number(simViaStops);
    const pickupRaw = simPickupFromBaseM.trim();
    const pickupFromBaseM = pickupRaw === "" ? null : Math.floor(Number(pickupRaw));
    if (!Number.isFinite(km) || km < 0 || !Number.isFinite(wait) || wait < 0 || !Number.isFinite(via) || via < 0) return null;
    if (pickupRaw !== "" && !Number.isFinite(pickupFromBaseM as number)) return null;
    const distanceM = Math.round(km * 1000);
    const segs = selectedVersion.segments.map((s) => ({
      fromM: s.fromM,
      toM: s.toM,
      fareYen: s.fareYen,
      fareMemberYen: s.fareMemberYen,
    }));
    return fareYenForTrip(
      versionToPricingInput(selectedVersion),
      distanceM,
      wait,
      segs,
      tiersToPick(selectedVersion.distanceTiers),
      {
        isMember: simMember,
        viaStopCount: Math.floor(via),
        applyNightSurcharge: simNight,
        applyLeftHandSurcharge: simLeftHand,
        pickupFromBaseM,
        applyNightSurchargeFlat: simNightFlat,
        applyLateNightFlatYen: simLateFlat,
        applyEarlyMorningFlatYen: simEarlyFlat,
        applyEarlyRushFlatYen: simRushFlat,
        applyLeftHandSurchargeFlat: simLeftHandFlat,
      },
    );
  }, [
    selectedVersion,
    simDistanceKm,
    simWaitMin,
    simMember,
    simViaStops,
    simNight,
    simLeftHand,
    simPickupFromBaseM,
    simNightFlat,
    simLateFlat,
    simEarlyFlat,
    simRushFlat,
    simLeftHandFlat,
  ]);

  const simCancelHint = useMemo(() => {
    if (!selectedVersion) return null;
    const km = Number(simDistanceKm);
    const pickupRaw = simPickupFromBaseM.trim();
    const pickupFromBaseM = pickupRaw === "" ? null : Math.floor(Number(pickupRaw));
    if (!Number.isFinite(km) || km < 0) return null;
    if (pickupRaw !== "" && !Number.isFinite(pickupFromBaseM as number)) return null;
    const distanceM = Math.round(km * 1000);
    const v = selectedVersion;
    if (v.distanceMode !== "INITIAL_ADD" || v.segments.length) return null;
    const totalNoSurchargeWait = fareYenForTrip(versionToPricingInput(v), distanceM, 0, [], [], {
      pickupFromBaseM,
    });
    const pk = pickupFareYen(v.pickupRuleJson, pickupFromBaseM);
    return { totalNoSurchargeWait, pickup: pk, cancelMeta: v.cancellationFeeYen };
  }, [selectedVersion, simDistanceKm, simPickupFromBaseM]);

  async function load(): Promise<void> {
    const r = await apiFetch<{ plans: Plan[] }>(`/tariff-plans${TARIFF_PLANS_QUERY}`);
    if (r.ok) {
      const list = r.data.plans;
      setPlans(list);
      setSelVer((prev) => {
        if (prev && list.some((p) => p.versions.some((v) => v.id === prev))) return prev;
        return list[0]?.versions[0]?.id ?? null;
      });
    } else setErr(friendlyError(r.error));
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const v = findVersion(plans, selVer);
    if (!v) return;
    setEditInitialDistanceM(String(v.initialDistanceM));
    setEditInitialFareYen(String(v.initialFareYen));
    setEditAddUnitDistanceM(String(v.addUnitDistanceM));
    setEditAddFareYen(String(v.addFareYen));
    setEditWaitingFareYenPerMin(String(v.waitingFareYenPerMin));
    setEditDistanceMode(v.distanceMode ?? "INITIAL_ADD");
    try {
      setEditWaitingRuleJson(JSON.stringify(v.waitingRuleJson ?? {}, null, 2));
    } catch {
      setEditWaitingRuleJson("{}");
    }
    setEditPerViaStopYen(String(v.perViaStopYen ?? 0));
    setEditCancellationFeeYen(String(v.cancellationFeeYen ?? 0));
    setEditNightSurchargeBps(percentStrFromBps(v.nightSurchargeBps ?? 0));
    setEditLeftHandSurchargeBps(percentStrFromBps(v.leftHandSurchargeBps ?? 0));
    setEditLeftHandSurchargeFlatYen(String(v.leftHandSurchargeFlatYen ?? 0));
    setEditNightSurchargeFlatYen(String(v.nightSurchargeFlatYen ?? 0));
    setEditLateNightFlatYen(String(v.lateNightFlatYen ?? 0));
    setEditEarlyMorningFlatYen(String(v.earlyMorningFlatYen ?? 0));
    setEditEarlyRushFlatYen(String(v.earlyRushFlatYen ?? 0));
    try {
      setEditPickupRuleJson(JSON.stringify(v.pickupRuleJson ?? [], null, 2));
    } catch {
      setEditPickupRuleJson("[]");
    }
    setEditDistanceDiscountFromM(v.distanceDiscountFromM == null ? "" : String(v.distanceDiscountFromM));
    setEditDistanceDiscountBps(percentStrFromBps(v.distanceDiscountBps ?? 0));
    setEditNotes(v.notes ?? "");
  }, [selVer, plans]);

  function resetNewWizardDraft(): void {
    setNwDistanceMode("INITIAL_ADD");
    setNwInitialDistanceM("2000");
    setNwInitialFareYen("800");
    setNwAddUnitDistanceM("200");
    setNwAddFareYen("100");
    setNwWaitingFareYenPerMin("0");
    setNwWaitingRuleJson(JSON.stringify({ type: "linear", graceMin: 0, perMinYen: 0 }, null, 2));
    setNwPerViaStopYen("0");
    setNwCancellationFeeYen("0");
    setNwNightSurchargeBps("0");
    setNwLeftHandSurchargeBps("0");
    setNwLeftHandSurchargeFlatYen("0");
    setNwNightSurchargeFlatYen("0");
    setNwLateNightFlatYen("0");
    setNwEarlyMorningFlatYen("0");
    setNwEarlyRushFlatYen("0");
    setNwDistanceDiscountFromM("");
    setNwDistanceDiscountBps("0");
    setNwPickupRuleJson("[]");
    setNwNotes("");
  }

  async function submitNewPlanWizard(): Promise<void> {
    setErr(null);
    setPlanSubmitting(true);
    try {
      const r = await apiFetch<{ plan: Plan; version: Ver }>("/tariff-plans", { method: "POST", json: { name: name.trim() } });
      if (!r.ok) {
        setErr(friendlyError(r.error));
        return;
      }
      const vid = r.data.version.id;
      let waitingRuleJson: unknown;
      let pickupRuleJson: unknown;
      try {
        waitingRuleJson = JSON.parse(nwWaitingRuleJson || "{}");
      } catch {
        setErr("新規の料金セット: 待ち時間の詳しい設定（上級者向け）の形式が正しくありません。");
        return;
      }
      try {
        pickupRuleJson = JSON.parse(nwPickupRuleJson || "[]");
      } catch {
        setErr("新規の料金セット: 迎車の詳しい設定（上級者向け）の形式が正しくありません。");
        return;
      }
      const initialDistanceM = Math.floor(Number(nwInitialDistanceM));
      const initialFareYen = Math.floor(Number(nwInitialFareYen));
      const addUnitDistanceM = Math.floor(Number(nwAddUnitDistanceM));
      const addFareYen = Math.floor(Number(nwAddFareYen));
      const waitingFareYenPerMin = Math.floor(Number(nwWaitingFareYenPerMin));
      const patch = {
        initialDistanceM,
        initialFareYen,
        addUnitDistanceM,
        addFareYen,
        waitingFareYenPerMin,
        distanceMode: nwDistanceMode,
        waitingRuleJson,
        perViaStopYen: Math.floor(Number(nwPerViaStopYen)),
        cancellationFeeYen: Math.floor(Number(nwCancellationFeeYen)),
        nightSurchargeBps: bpsFromPercentInput(nwNightSurchargeBps),
        leftHandSurchargeBps: bpsFromPercentInput(nwLeftHandSurchargeBps),
        leftHandSurchargeFlatYen: Math.floor(Number(nwLeftHandSurchargeFlatYen)),
        nightSurchargeFlatYen: Math.floor(Number(nwNightSurchargeFlatYen)),
        lateNightFlatYen: Math.floor(Number(nwLateNightFlatYen)),
        earlyMorningFlatYen: Math.floor(Number(nwEarlyMorningFlatYen)),
        earlyRushFlatYen: Math.floor(Number(nwEarlyRushFlatYen)),
        pickupRuleJson,
        distanceDiscountFromM:
          nwDistanceDiscountFromM.trim() === "" ? null : Math.floor(Number(nwDistanceDiscountFromM)),
        distanceDiscountBps: bpsFromPercentInput(nwDistanceDiscountBps),
        notes: nwNotes.trim() || null,
      };
      if (
        !Number.isFinite(patch.initialDistanceM) ||
        !Number.isFinite(patch.initialFareYen) ||
        !Number.isFinite(patch.addUnitDistanceM) ||
        patch.addUnitDistanceM < 1 ||
        !Number.isFinite(patch.addFareYen) ||
        !Number.isFinite(patch.waitingFareYenPerMin)
      ) {
        setErr("新規の料金セット: 走行距離・待ち時間の数字を確認してください。");
        return;
      }
      if (patch.distanceDiscountFromM != null && !Number.isFinite(patch.distanceDiscountFromM)) {
        setErr("新規の料金セット: 距離の割引を始める位置（メートル）が正しくありません。");
        return;
      }
      const pr = await apiFetch<Ver>(`/tariff-versions/${vid}`, { method: "PATCH", json: patch });
      if (!pr.ok) {
        setErr(friendlyError(pr.error));
        return;
      }
      setName("");
      resetNewWizardDraft();
      setPlanWizardOpen(false);
      await load();
      setSelVer(vid);
      setActiveTab("distance");
    } finally {
      setPlanSubmitting(false);
    }
  }

  async function addVersion(planId: string): Promise<void> {
    setErr(null);
    const r = await apiFetch<Ver>(`/tariff-plans/${planId}/versions`, { method: "POST", json: {} });
    if (!r.ok) setErr(friendlyError(r.error));
    else {
      setSelVer(r.data.id);
      await load();
    }
  }

  async function saveVersionParams(): Promise<void> {
    if (!selVer) return;
    setErr(null);
    const initialDistanceM = Math.floor(Number(editInitialDistanceM));
    const initialFareYen = Math.floor(Number(editInitialFareYen));
    const addUnitDistanceM = Math.floor(Number(editAddUnitDistanceM));
    const addFareYen = Math.floor(Number(editAddFareYen));
    const waitingFareYenPerMin = Math.floor(Number(editWaitingFareYenPerMin));
    if (
      !Number.isFinite(initialDistanceM) ||
      !Number.isFinite(initialFareYen) ||
      !Number.isFinite(addUnitDistanceM) ||
      !Number.isFinite(addFareYen) ||
      !Number.isFinite(waitingFareYenPerMin)
    ) {
      setErr("走行距離・運賃・待ち時間の数字は、すべて整数で入力してください。");
      return;
    }
    if (initialDistanceM < 0 || initialFareYen < 0 || addUnitDistanceM < 1 || addFareYen < 0 || waitingFareYenPerMin < 0) {
      setErr("初乗り距離・運賃は0以上、加算距離単位は1以上にしてください。");
      return;
    }
    let waitingRuleJson: unknown;
    try {
      waitingRuleJson = JSON.parse(editWaitingRuleJson || "{}");
    } catch {
      setErr("待ち時間の詳しい設定（上級者向け）の形式が正しくありません。");
      return;
    }
    let pickupRuleJson: unknown;
    try {
      pickupRuleJson = JSON.parse(editPickupRuleJson || "[]");
    } catch {
      setErr("迎車の詳しい設定（上級者向け）の形式が正しくありません。");
      return;
    }
    const perViaStopYen = Math.floor(Number(editPerViaStopYen));
    const cancellationFeeYen = Math.floor(Number(editCancellationFeeYen));
    const nightSurchargeBps = bpsFromPercentInput(editNightSurchargeBps);
    const leftHandSurchargeBps = bpsFromPercentInput(editLeftHandSurchargeBps);
    const nightSurchargeFlatYen = Math.floor(Number(editNightSurchargeFlatYen));
    const leftHandSurchargeFlatYen = Math.floor(Number(editLeftHandSurchargeFlatYen));
    const lateNightFlatYen = Math.floor(Number(editLateNightFlatYen));
    const earlyMorningFlatYen = Math.floor(Number(editEarlyMorningFlatYen));
    const earlyRushFlatYen = Math.floor(Number(editEarlyRushFlatYen));
    const distanceDiscountBps = bpsFromPercentInput(editDistanceDiscountBps);
    const distanceDiscountFromM =
      editDistanceDiscountFromM.trim() === "" ? null : Math.floor(Number(editDistanceDiscountFromM));
    if (
      !Number.isFinite(perViaStopYen) ||
      perViaStopYen < 0 ||
      !Number.isFinite(cancellationFeeYen) ||
      cancellationFeeYen < 0 ||
      !Number.isFinite(nightSurchargeBps) ||
      !Number.isFinite(leftHandSurchargeBps) ||
      !Number.isFinite(nightSurchargeFlatYen) ||
      nightSurchargeFlatYen < 0 ||
      !Number.isFinite(leftHandSurchargeFlatYen) ||
      leftHandSurchargeFlatYen < 0 ||
      !Number.isFinite(lateNightFlatYen) ||
      lateNightFlatYen < 0 ||
      !Number.isFinite(earlyMorningFlatYen) ||
      earlyMorningFlatYen < 0 ||
      !Number.isFinite(earlyRushFlatYen) ||
      earlyRushFlatYen < 0 ||
      !Number.isFinite(distanceDiscountBps) ||
      (distanceDiscountFromM != null && !Number.isFinite(distanceDiscountFromM))
    ) {
      setErr("割増し・割引・定額の数字を確認してください。");
      return;
    }
    setVerSaveSubmitting(true);
    try {
      const r = await apiFetch<Ver>(`/tariff-versions/${selVer}`, {
        method: "PATCH",
        json: {
          initialDistanceM,
          initialFareYen,
          addUnitDistanceM,
          addFareYen,
          waitingFareYenPerMin,
          distanceMode: editDistanceMode,
          waitingRuleJson,
          perViaStopYen,
          cancellationFeeYen,
          nightSurchargeBps,
          leftHandSurchargeBps,
          leftHandSurchargeFlatYen,
          nightSurchargeFlatYen,
          lateNightFlatYen,
          earlyMorningFlatYen,
          earlyRushFlatYen,
          pickupRuleJson,
          distanceDiscountFromM,
          distanceDiscountBps,
          notes: editNotes.trim() || null,
        },
      });
      if (!r.ok) {
        setErr(friendlyError(r.error));
        return;
      }
      await load();
    } finally {
      setVerSaveSubmitting(false);
    }
  }

  function applyWaitingPreset(presetJson: unknown): void {
    const o = presetJson as Record<string, unknown>;
    if (o?.type === "linear") {
      const pm = Math.max(0, Math.floor(Number(o.perMinYen ?? 0)));
      setEditWaitingFareYenPerMin(String(pm));
    }
    setEditWaitingRuleJson(JSON.stringify(presetJson, null, 2));
  }

  function applyNwWaitingPreset(presetJson: unknown): void {
    const o = presetJson as Record<string, unknown>;
    if (o?.type === "linear") {
      const pm = Math.max(0, Math.floor(Number(o.perMinYen ?? 0)));
      setNwWaitingFareYenPerMin(String(pm));
    }
    setNwWaitingRuleJson(JSON.stringify(presetJson, null, 2));
  }

  function closeSegWizard(): void {
    setSegWizardOpen(false);
    setFromM("");
    setToM("");
    setFareYen("");
    setFareMemberYen("");
  }

  async function submitSegment(): Promise<void> {
    if (!selVer) return;
    setErr(null);
    setSegSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        fromM: Number(fromM),
        toM: Number(toM),
        fareYen: Number(fareYen),
      };
      if (fareMemberYen.trim() !== "") {
        const fm = Math.floor(Number(fareMemberYen));
        if (!Number.isFinite(fm) || fm < 0) {
          setErr("会員運賃は空欄（未使用）か0以上の整数にしてください。");
          return;
        }
        body.fareMemberYen = fm;
      }
      const r = await apiFetch<Seg>(`/tariff-versions/${selVer}/segments`, {
        method: "POST",
        json: body,
      });
      if (!r.ok) {
        setErr(friendlyError(r.error));
        return;
      }
      closeSegWizard();
      await load();
    } finally {
      setSegSubmitting(false);
    }
  }

  async function delSegment(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/tariff-segments/${id}`, { method: "DELETE" });
    if (!r.ok) setErr(friendlyError((r as { ok: false; error: string }).error));
    else await load();
  }

  async function addTier(): Promise<void> {
    if (!selVer) return;
    setErr(null);
    const fromM = Math.floor(Number(tierFromM));
    const stepM = Math.floor(Number(tierStepM));
    const addYenPerStep = Math.floor(Number(tierAddYen));
    const untilRaw = tierUntilM.trim();
    const untilM = untilRaw === "" ? null : Math.floor(Number(untilRaw));
    if (!Number.isFinite(fromM) || fromM < 0 || !Number.isFinite(stepM) || stepM < 1 || !Number.isFinite(addYenPerStep) || addYenPerStep < 0) {
      setErr("加算の区間: 始まりの距離・加算の単位・加算する円を正しく入力してください。");
      return;
    }
    if (untilRaw !== "" && (!Number.isFinite(untilM as number) || (untilM as number) <= fromM)) {
      setErr("加算の区間: 「ここまで（メートル）」は空欄（最後まで）か、始まりより大きい数にしてください。");
      return;
    }
    setTierSubmitting(true);
    try {
      const r = await apiFetch<Tier>(`/tariff-versions/${selVer}/distance-tiers`, {
        method: "POST",
        json: { fromM, untilM, stepM, addYenPerStep },
      });
      if (!r.ok) {
        setErr(friendlyError(r.error));
        return;
      }
      setTierFromM("");
      setTierUntilM("");
      await load();
    } finally {
      setTierSubmitting(false);
    }
  }

  async function delTier(id: string): Promise<void> {
    setErr(null);
    const r = await apiFetch(`/tariff-distance-tiers/${id}`, { method: "DELETE" });
    if (!r.ok) setErr(friendlyError((r as { ok: false; error: string }).error));
    else await load();
  }

  async function deletePlan(planId: string, planName: string): Promise<void> {
    const msg = [
      `「${planName}」の料金セットを削除しますか？`,
      "",
      "削除すると、この中に含まれる設定もまとめてなくなります。",
      "過去の運行に記録された金額そのものは消えませんが、「どの料金で計算したか」との結びつきは外れます。",
    ].join("\n");
    if (!window.confirm(msg)) return;
    setErr(null);
    setPlanDeletingId(planId);
    try {
      const r = await apiFetch<{ ok?: boolean }>(`/tariff-plans/${planId}`, { method: "DELETE" });
      if (!r.ok) {
        setErr(friendlyError((r as { ok: false; error: string }).error));
        return;
      }
      await load();
    } finally {
      setPlanDeletingId(null);
    }
  }

  const nameOk = name.trim().length > 0;
  const fromOk = fromM.trim() !== "" && !Number.isNaN(Number(fromM));
  const toOk = toM.trim() !== "" && !Number.isNaN(Number(toM));
  const fareOk = fareYen.trim() !== "" && !Number.isNaN(Number(fareYen));
  const segNumsOk = fromOk && toOk && fareOk && Number(fromM) < Number(toM);

  const newPlanSteps: StepWizardStep[] = [
    {
      id: "nw-name",
      title: "料金セットの名前",
      description: "一覧に出る名前です。作成後、最初の設定を一度に保存します。",
      canProceed: nameOk,
      children: (
        <>
          <label>新しい料金セットの名前</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </>
      ),
    },
    {
      id: "nw-distance",
      title: "走行の料金（距離）",
      canProceed: true,
      children: (
        <>
          <label>走行料金の決め方</label>
          <select value={nwDistanceMode} onChange={(e) => setNwDistanceMode(e.target.value)}>
            {DISTANCE_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p style={{ fontSize: "0.82rem", color: "#444", marginTop: 4 }}>
            {DISTANCE_MODE_OPTIONS.find((x) => x.value === nwDistanceMode)?.hint}
          </p>
          <label>最初までの距離（メートル）</label>
          <input value={nwInitialDistanceM} onChange={(e) => setNwInitialDistanceM(e.target.value)} inputMode="numeric" />
          <label>その距離までの運賃（円）</label>
          <input value={nwInitialFareYen} onChange={(e) => setNwInitialFareYen(e.target.value)} inputMode="numeric" />
          <label>そのあと、何メートルごとに運賃を足すか</label>
          <input value={nwAddUnitDistanceM} onChange={(e) => setNwAddUnitDistanceM(e.target.value)} inputMode="numeric" />
          <label>その「ごと」に足す運賃（円）</label>
          <input value={nwAddFareYen} onChange={(e) => setNwAddFareYen(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "nw-wait",
      title: "待ち時間・経由",
      canProceed: true,
      children: (
        <>
          <label>待ち時間（昔の互換用・1分あたりの円）</label>
          <input value={nwWaitingFareYenPerMin} onChange={(e) => setNwWaitingFareYenPerMin(e.target.value)} inputMode="numeric" />
          <p style={{ fontSize: "0.8rem" }}>よく使う形から選ぶ</p>
          <p>
            {WAITING_PRESETS.map((p) => (
              <button key={p.id} type="button" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => applyNwWaitingPreset(p.json)}>
                {p.label}
              </button>
            ))}
          </p>
          <details style={{ marginTop: 8 }}>
            <summary>待ち時間の詳しい設定（上級者向け）</summary>
            <textarea value={nwWaitingRuleJson} onChange={(e) => setNwWaitingRuleJson(e.target.value)} rows={5} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", marginTop: 6 }} />
          </details>
          <label>経由が1回あるごとに足す金額（円）</label>
          <input value={nwPerViaStopYen} onChange={(e) => setNwPerViaStopYen(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "nw-extra",
      title: "割増し・迎車・割引・キャンセル",
      canProceed: true,
      children: (
        <>
          <label>夜間に増やす割合（％・走行の運賃に乗算。便で「夜間」をオンにしたとき）</label>
          <input value={nwNightSurchargeBps} onChange={(e) => setNwNightSurchargeBps(e.target.value)} inputMode="decimal" placeholder="例: 10 で約10%増" />
          <label>左ハンドル車に増やす割合（％）</label>
          <input value={nwLeftHandSurchargeBps} onChange={(e) => setNwLeftHandSurchargeBps(e.target.value)} inputMode="decimal" placeholder="例: 10 で約10%増" />
          <label>左ハンドル車の定額を足す（円・便でオンにしたとき）</label>
          <input value={nwLeftHandSurchargeFlatYen} onChange={(e) => setNwLeftHandSurchargeFlatYen(e.target.value)} inputMode="numeric" />
          <label>深夜の定額を足す（円・便の設定でオンにしたとき）</label>
          <input value={nwNightSurchargeFlatYen} onChange={(e) => setNwNightSurchargeFlatYen(e.target.value)} inputMode="numeric" />
          <label>さらに遅い時間帯の定額（円）</label>
          <input value={nwLateNightFlatYen} onChange={(e) => setNwLateNightFlatYen(e.target.value)} inputMode="numeric" />
          <label>早朝の定額（その1）（円）</label>
          <input value={nwEarlyMorningFlatYen} onChange={(e) => setNwEarlyMorningFlatYen(e.target.value)} inputMode="numeric" />
          <label>早朝の定額（その2）（円）</label>
          <input value={nwEarlyRushFlatYen} onChange={(e) => setNwEarlyRushFlatYen(e.target.value)} inputMode="numeric" />
          <label>距離の割引を始める位置（メートル・空欄で使わない）</label>
          <input value={nwDistanceDiscountFromM} onChange={(e) => setNwDistanceDiscountFromM(e.target.value)} inputMode="numeric" placeholder="例: 11000" />
          <label>走行の運賃を割り引く割合（％・マイナスで割引。例: -10 で約10%引き）</label>
          <input value={nwDistanceDiscountBps} onChange={(e) => setNwDistanceDiscountBps(e.target.value)} inputMode="decimal" />
          <details style={{ marginTop: 8 }}>
            <summary>迎車の詳しい設定（上級者向け）</summary>
            <button type="button" style={{ marginBottom: 6, marginTop: 6 }} onClick={() => setNwPickupRuleJson(PICKUP_TEMPLATE)}>
              例（距離の幅ごとの金額）を入れる
            </button>
            <textarea value={nwPickupRuleJson} onChange={(e) => setNwPickupRuleJson(e.target.value)} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }} />
          </details>
          <label>キャンセル時の金額として控える（円・運賃の合計には含みません）</label>
          <input value={nwCancellationFeeYen} onChange={(e) => setNwCancellationFeeYen(e.target.value)} inputMode="numeric" />
          <label>社内向けメモ</label>
          <textarea value={nwNotes} onChange={(e) => setNwNotes(e.target.value)} rows={2} style={{ width: "100%" }} />
        </>
      ),
    },
    {
      id: "nw-confirm",
      title: "確認",
      canProceed: nameOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>料金セットの名前</dt>
          <dd>{name.trim()}</dd>
          <dt>走行料金の決め方</dt>
          <dd>{DISTANCE_MODE_OPTIONS.find((x) => x.value === nwDistanceMode)?.label ?? nwDistanceMode}</dd>
          <dt>最初の区間</dt>
          <dd>
            {nwInitialDistanceM} メートルまで {nwInitialFareYen} 円
          </dd>
          <dt>そのあとの加算</dt>
          <dd>
            {nwAddUnitDistanceM} メートルごとに {nwAddFareYen} 円
          </dd>
        </dl>
      ),
    },
  ];

  const segmentSteps: StepWizardStep[] = [
    {
      id: "from",
      title: "始まりの距離（メートル）",
      description: "この金額が適用される区間の、始まりの位置です。",
      canProceed: fromOk,
      children: (
        <>
          <label>始まり（メートル）</label>
          <input value={fromM} onChange={(e) => setFromM(e.target.value)} inputMode="numeric" autoFocus />
        </>
      ),
    },
    {
      id: "to",
      title: "終わりの距離（メートル）",
      description: "終わりは始まりより大きい必要があります。",
      canProceed: toOk && fromOk && Number(toM) > Number(fromM),
      children: (
        <>
          <label>終わり（メートル）</label>
          <input value={toM} onChange={(e) => setToM(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "fare",
      title: "運賃（円）",
      description: "この距離の幅に適用する金額です。",
      canProceed: fareOk,
      children: (
        <>
          <label>一般の運賃（円）</label>
          <input value={fareYen} onChange={(e) => setFareYen(e.target.value)} inputMode="numeric" />
          <label>会員の運賃（円・任意）</label>
          <input
            value={fareMemberYen}
            onChange={(e) => setFareMemberYen(e.target.value)}
            inputMode="numeric"
            placeholder="空欄で一般と同額"
          />
        </>
      ),
    },
    {
      id: "seg-confirm",
      title: "登録内容の確認",
      canProceed: Boolean(selVer) && segNumsOk,
      children: (
        <dl className="step-wizard-summary">
          <dt>いまの設定</dt>
          <dd>{findVerLabel(plans, selVer)}</dd>
          <dt>距離の幅</dt>
          <dd>
            {fromM} メートル ～ {toM} メートル
          </dd>
          <dt>一般の運賃</dt>
          <dd>{fareYen} 円</dd>
          {fareMemberYen.trim() !== "" ? (
            <>
              <dt>会員の運賃</dt>
              <dd>{fareMemberYen} 円</dd>
            </>
          ) : null}
        </dl>
      ),
    },
  ];

  return (
    <Card title="料金ルール（送迎の金額）">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        お客様の送迎で使う金額の「セット」を作ります。値上げするときは「新しい並びを追加」で、いまの内容をコピーした新しい版を作れます。一覧は直近30件までです。
      </p>
      {selectionCtx ? (
        <p style={{ fontSize: "1.05rem", fontWeight: 600, marginTop: "0.5rem", marginBottom: 0 }}>
          いま編集しているのは「{selectionCtx.plan.name}」の「{selectionCtx.ver.version}番目の内容」です。
        </p>
      ) : null}
      <p style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={() => { setPlanWizardOpen(true); resetNewWizardDraft(); }}>
          新しい料金セットを作る（ガイド付き）
        </button>{" "}
        <button type="button" onClick={() => setSegWizardOpen(true)} disabled={!selVer}>
          距離の幅ごとの金額を1行足す
        </button>
      </p>

      <Tabs
        aria-label="料金ルールの詳細"
        activeId={activeTab}
        onActiveChange={(id) => setActiveTab(id as TabId)}
        items={TAB_LABELS.map((t) => ({
          id: t.id,
          label: t.label,
          children: (
            <div style={{ marginTop: "0.5rem" }}>
              {t.id === "plans" ? (
                <section>
                  {plans.map((p) => (
                    <div key={p.id} style={{ marginTop: "1rem" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <strong>{p.name}</strong>
                        <button type="button" onClick={() => void addVersion(p.id)}>
                          新しい並びを追加（直前の内容をコピー）
                        </button>
                        <button
                          type="button"
                          disabled={planDeletingId === p.id}
                          onClick={() => void deletePlan(p.id, p.name)}
                          style={{ color: "#a30" }}
                        >
                          {planDeletingId === p.id ? "削除中…" : "この料金セットを削除"}
                        </button>
                      </div>
                      <ul>
                        {p.versions.map((v) => (
                          <li key={v.id}>
                            <label className="tariff-version-pick">
                              <input type="radio" name="ver" checked={selVer === v.id} onChange={() => setSelVer(v.id)} />
                              <span className="tariff-version-pick__text">
                                {v.version}番目 （
                                {DISTANCE_MODE_OPTIONS.find((x) => x.value === (v.distanceMode ?? "INITIAL_ADD"))?.label ?? "走行の料金"}） 最初の
                                {v.initialDistanceM}メートルまで{v.initialFareYen}円
                              </span>
                            </label>
                            <ul>
                              {[...v.segments]
                                .sort((a, b) => a.fromM - b.fromM)
                                .map((s) => (
                                  <li key={s.id}>
                                    {s.fromM}～{s.toM}メートル → 一般{s.fareYen}円
                                    {s.fareMemberYen != null ? ` / 会員${s.fareMemberYen}円` : ""}{" "}
                                    <button type="button" onClick={() => void delSegment(s.id)}>
                                      この行を削除
                                    </button>
                                  </li>
                                ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ) : null}
              {t.id === "distance" && selVer && selectedVersion ? (
                <section style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", maxWidth: 640 }}>
                  <h3 style={{ marginTop: 0, fontSize: "1rem" }}>走った距離の料金（{findVerLabel(plans, selVer)}）</h3>
                  <label>走行料金の決め方</label>
                  <select value={editDistanceMode} onChange={(e) => setEditDistanceMode(e.target.value)}>
                    {DISTANCE_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>{DISTANCE_MODE_OPTIONS.find((x) => x.value === editDistanceMode)?.hint}</p>
                  <label>最初までの距離（メートル）</label>
                  <input value={editInitialDistanceM} onChange={(e) => setEditInitialDistanceM(e.target.value)} inputMode="numeric" />
                  <label>その距離までの運賃（円）</label>
                  <input value={editInitialFareYen} onChange={(e) => setEditInitialFareYen(e.target.value)} inputMode="numeric" />
                  <label>そのあと、何メートルごとに運賃を足すか</label>
                  <input value={editAddUnitDistanceM} onChange={(e) => setEditAddUnitDistanceM(e.target.value)} inputMode="numeric" />
                  <label>その「ごと」に足す運賃（円）</label>
                  <input value={editAddFareYen} onChange={(e) => setEditAddFareYen(e.target.value)} inputMode="numeric" />
                  <p style={{ fontSize: "0.8rem" }}>
                    表だけで距離料金を決める場合は、上の一覧タブから「距離の幅ごとの金額を1行足す」を使います。段階的な加算に切り替えたあとは、一度「今の内容を保存」を押してください。
                  </p>
                  {(editDistanceMode === "TIERED_ADD" || (selectedVersion.distanceTiers?.length ?? 0) > 0) && (
                    <>
                      <h4 style={{ marginBottom: "0.25rem" }}>段階的な距離の加算</h4>
                      <ul>
                        {[...(selectedVersion.distanceTiers ?? [])]
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((tier) => (
                            <li key={tier.id}>
                              {tier.fromM}メートル～{tier.untilM == null ? "終わりまで" : `${tier.untilM}メートル`} / {tier.stepM}メートルごとに +{tier.addYenPerStep}円{" "}
                              <button type="button" onClick={() => void delTier(tier.id)}>
                                削除
                              </button>
                            </li>
                          ))}
                      </ul>
                      <label>始まりの距離（メートル）</label>
                      <input value={tierFromM} onChange={(e) => setTierFromM(e.target.value)} inputMode="numeric" />
                      <label>終わりの距離（メートル・空欄なら最後まで）</label>
                      <input value={tierUntilM} onChange={(e) => setTierUntilM(e.target.value)} inputMode="numeric" />
                      <label>何メートルごとに加算するか</label>
                      <input value={tierStepM} onChange={(e) => setTierStepM(e.target.value)} inputMode="numeric" />
                      <label>そのごとに足す金額（円）</label>
                      <input value={tierAddYen} onChange={(e) => setTierAddYen(e.target.value)} inputMode="numeric" />
                      <p>
                        <button type="button" disabled={tierSubmitting} onClick={() => void addTier()}>
                          {tierSubmitting ? "追加中…" : "この区間の加算ルールを追加"}
                        </button>
                      </p>
                    </>
                  )}
                </section>
              ) : t.id === "distance" ? (
                <p style={{ marginTop: "0.5rem" }}>先に「料金セット一覧」で、直したい内容（ラジオボタン）を選んでください。</p>
              ) : null}
              {t.id === "waiting" && selVer && selectedVersion ? (
                <section style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", maxWidth: 640 }}>
                  <h3 style={{ marginTop: 0, fontSize: "1rem" }}>待ち時間・途中の停車</h3>
                  <label>待ち時間（昔の互換用・1分あたりの円）</label>
                  <input value={editWaitingFareYenPerMin} onChange={(e) => setEditWaitingFareYenPerMin(e.target.value)} inputMode="numeric" />
                  <p style={{ fontSize: "0.8rem" }}>よく使う形から選ぶ</p>
                  <p>
                    {WAITING_PRESETS.map((p) => (
                      <button key={p.id} type="button" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => applyWaitingPreset(p.json)}>
                        {p.label}
                      </button>
                    ))}
                  </p>
                  <details style={{ marginTop: 8 }}>
                    <summary>待ち時間の詳しい設定（上級者向け）</summary>
                    <textarea value={editWaitingRuleJson} onChange={(e) => setEditWaitingRuleJson(e.target.value)} rows={8} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", marginTop: 6 }} />
                  </details>
                  <label>経由が1回あるごとに足す金額（円）</label>
                  <input value={editPerViaStopYen} onChange={(e) => setEditPerViaStopYen(e.target.value)} inputMode="numeric" />
                </section>
              ) : t.id === "waiting" ? (
                <p style={{ marginTop: "0.5rem" }}>先に「料金セット一覧」で、直したい内容を選んでください。</p>
              ) : null}
              {t.id === "extras" && selVer && selectedVersion ? (
                <section style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", maxWidth: 640 }}>
                  <h3 style={{ marginTop: 0, fontSize: "1rem" }}>夜間などの割増・迎え車・距離の割引・キャンセル・メモ</h3>
                  <label>夜間に増やす割合（％・走行の運賃に乗算。便で「夜間」をオンにしたとき）</label>
                  <input value={editNightSurchargeBps} onChange={(e) => setEditNightSurchargeBps(e.target.value)} inputMode="decimal" placeholder="例: 10 で約10%増" />
                  <label>左ハンドル車に増やす割合（％）</label>
                  <input value={editLeftHandSurchargeBps} onChange={(e) => setEditLeftHandSurchargeBps(e.target.value)} inputMode="decimal" placeholder="例: 10 で約10%増" />
                  <label>左ハンドル車の定額を足す（円・便の設定でオンにしたとき）</label>
                  <input value={editLeftHandSurchargeFlatYen} onChange={(e) => setEditLeftHandSurchargeFlatYen(e.target.value)} inputMode="numeric" />
                  <label>深夜の定額を足す（円・便の設定でオンにしたとき）</label>
                  <input value={editNightSurchargeFlatYen} onChange={(e) => setEditNightSurchargeFlatYen(e.target.value)} inputMode="numeric" />
                  <label>さらに遅い時間帯の定額（円）</label>
                  <input value={editLateNightFlatYen} onChange={(e) => setEditLateNightFlatYen(e.target.value)} inputMode="numeric" />
                  <label>早朝の定額（その1）（円）</label>
                  <input value={editEarlyMorningFlatYen} onChange={(e) => setEditEarlyMorningFlatYen(e.target.value)} inputMode="numeric" />
                  <label>早朝の定額（その2）（円）</label>
                  <input value={editEarlyRushFlatYen} onChange={(e) => setEditEarlyRushFlatYen(e.target.value)} inputMode="numeric" />
                  <label>距離の割引を始める位置（メートル・空欄で使わない）</label>
                  <input value={editDistanceDiscountFromM} onChange={(e) => setEditDistanceDiscountFromM(e.target.value)} inputMode="numeric" />
                  <label>走行の運賃を割り引く割合（％・マイナスで割引。例: -10 で約10%引き）</label>
                  <input value={editDistanceDiscountBps} onChange={(e) => setEditDistanceDiscountBps(e.target.value)} inputMode="decimal" />
                  <details style={{ marginTop: 8 }}>
                    <summary>迎車の詳しい設定（上級者向け）</summary>
                    <button type="button" style={{ marginBottom: 6, marginTop: 6 }} onClick={() => setEditPickupRuleJson(PICKUP_TEMPLATE)}>
                      例（距離の幅ごとの金額）を入れる
                    </button>
                    <textarea value={editPickupRuleJson} onChange={(e) => setEditPickupRuleJson(e.target.value)} rows={8} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }} />
                  </details>
                  <label>キャンセル時の金額として控える（円・運賃の合計には含みません）</label>
                  <input value={editCancellationFeeYen} onChange={(e) => setEditCancellationFeeYen(e.target.value)} inputMode="numeric" />
                  <label>社内向けメモ</label>
                  <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} style={{ width: "100%" }} />
                </section>
              ) : t.id === "extras" ? (
                <p style={{ marginTop: "0.5rem" }}>先に「料金セット一覧」で、直したい内容を選んでください。</p>
              ) : null}
              {t.id === "simulator" && selVer && selectedVersion ? (
                <section style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", maxWidth: 640 }}>
                  <h3 style={{ marginTop: 0, fontSize: "1rem" }}>試しに計算（{findVerLabel(plans, selVer)}）</h3>
                  <p style={{ fontSize: "0.8rem", marginTop: 0 }}>
                    距離の割引は、設定した距離以上の走行に対して走行の運賃へ一度だけかかります。そのあと夜間などの割増し、各定額、待ち時間、経由、迎車の順で足されます。
                  </p>
                  <label>走行距離（キロ）</label>
                  <input value={simDistanceKm} onChange={(e) => setSimDistanceKm(e.target.value)} inputMode="decimal" placeholder="例: 5.2" />
                  <label>待ち時間（分）</label>
                  <input value={simWaitMin} onChange={(e) => setSimWaitMin(e.target.value)} inputMode="numeric" />
                  <label>迎車までの距離（基準地点からのメートル・空欄でなし）</label>
                  <input value={simPickupFromBaseM} onChange={(e) => setSimPickupFromBaseM(e.target.value)} inputMode="numeric" />
                  <label>
                    <input type="checkbox" checked={simMember} onChange={(e) => setSimMember(e.target.checked)} /> 会員料金で試す
                  </label>
                  <label>経由の回数</label>
                  <input value={simViaStops} onChange={(e) => setSimViaStops(e.target.value)} inputMode="numeric" />
                  <label>
                    <input type="checkbox" checked={simNight} onChange={(e) => setSimNight(e.target.checked)} /> 夜間の割増し（走行の運賃に％）
                  </label>
                  <label>
                    <input type="checkbox" checked={simLeftHand} onChange={(e) => setSimLeftHand(e.target.checked)} /> 左ハンドル車の割増し（％）
                  </label>
                  <label>
                    <input type="checkbox" checked={simLeftHandFlat} onChange={(e) => setSimLeftHandFlat(e.target.checked)} /> 左ハンドル車の定額を足す
                  </label>
                  <label>
                    <input type="checkbox" checked={simNightFlat} onChange={(e) => setSimNightFlat(e.target.checked)} /> 深夜の定額を足す
                  </label>
                  <label>
                    <input type="checkbox" checked={simLateFlat} onChange={(e) => setSimLateFlat(e.target.checked)} /> さらに遅い時間帯の定額
                  </label>
                  <label>
                    <input type="checkbox" checked={simEarlyFlat} onChange={(e) => setSimEarlyFlat(e.target.checked)} /> 早朝の定額（その1）
                  </label>
                  <label>
                    <input type="checkbox" checked={simRushFlat} onChange={(e) => setSimRushFlat(e.target.checked)} /> 早朝の定額（その2）
                  </label>
                  <p style={{ marginTop: "0.5rem", fontWeight: 600 }}>
                    試しに出した運賃: {simResultYen === null ? "—" : `${simResultYen.toLocaleString("ja-JP")} 円`}
                  </p>
                  {simCancelHint ? (
                    <p style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
                      参考（一般的な「最初の区間＋追加」で表を使わない場合・待ち0・定額オフ）: 合計 {simCancelHint.totalNoSurchargeWait.toLocaleString("ja-JP")} 円（うち迎車{" "}
                      {simCancelHint.pickup.toLocaleString("ja-JP")} 円）。キャンセル時の控えとして登録している金額 {simCancelHint.cancelMeta.toLocaleString("ja-JP")} 円。
                    </p>
                  ) : null}
                </section>
              ) : t.id === "simulator" ? (
                <p style={{ marginTop: "0.5rem" }}>先に「料金セット一覧」で、直したい内容を選んでください。</p>
              ) : null}
            </div>
          ),
        }))}
      />

      {selVer && selectedVersion ? (
        <p style={{ marginTop: "0.75rem" }}>
          <button type="button" disabled={verSaveSubmitting} onClick={() => void saveVersionParams()}>
            {verSaveSubmitting ? "保存中…" : "今の内容を保存（すべてのタブの入力をまとめて反映）"}
          </button>
        </p>
      ) : null}

      <StepWizard
        open={planWizardOpen}
        onClose={() => {
          setPlanWizardOpen(false);
          setName("");
          resetNewWizardDraft();
        }}
        title="新しい料金セット（最初の内容まで）"
        steps={newPlanSteps}
        finishLabel="料金セットを作成して保存する"
        onFinish={submitNewPlanWizard}
        isSubmitting={planSubmitting}
      />
      <StepWizard
        open={segWizardOpen}
        onClose={closeSegWizard}
        title="距離の幅ごとの金額を1行足す"
        steps={segmentSteps}
        finishLabel="この距離の幅を登録する"
        onFinish={submitSegment}
        isSubmitting={segSubmitting}
      />
    </Card>
  );
}
