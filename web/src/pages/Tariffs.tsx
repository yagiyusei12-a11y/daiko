import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import {
  fareYenForTrip,
  pickupFareYen,
  type TierPick,
  type VersionPricingInput,
} from "../lib/tariffPricing";
import { Card, Err, StepWizard, type StepWizardStep } from "../ui";

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

function findVerLabel(plans: Plan[], verId: string | null): string {
  if (!verId) return "（未選択）";
  for (const p of plans) {
    for (const v of p.versions) {
      if (v.id === verId) return `${p.name} / v${v.version}`;
    }
  }
  return verId;
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
  { id: "linear0", label: "シンプル（分×円）", json: { type: "linear", graceMin: 0, perMinYen: 0 } },
  { id: "block_kece", label: "KECE型（10分無料→10分ごと1000円）", json: { type: "block", graceMin: 10, blockEveryMin: 10, blockYen: 1000 } },
  { id: "block_as", label: "5分ブロック（例: 無料10分→5分ごと500円）", json: { type: "block", graceMin: 10, blockEveryMin: 5, blockYen: 500 } },
  { id: "grace_plus", label: "PLUS型（3分無料→200円→100円/分）", json: { type: "grace_flat_then_linear", graceMin: 3, firstChargeYen: 200, perMinAfterFirstYen: 100 } },
  {
    id: "daruma_wait",
    label: "だるま型（先15分500円→以降5分ごと500円）",
    json: { type: "prefix_block_then_block", graceMin: 0, prefixMin: 15, prefixYen: 500, blockEveryMin: 5, blockYen: 500 },
  },
  {
    id: "hiyoko_wait",
    label: "ひよこ型（先20分1000円→以降10分ごと1000円）",
    json: { type: "prefix_block_then_block", graceMin: 0, prefixMin: 20, prefixYen: 1000, blockEveryMin: 10, blockYen: 1000 },
  },
];

const PICKUP_TEMPLATE = `[
  { "fromM": 0, "toM": 5000, "yen": 0 },
  { "fromM": 5001, "toM": 10000, "yen": 500 },
  { "fromM": 10001, "toM": null, "yen": 1000 }
]`;

const TAB_LABELS: { id: TabId; label: string }[] = [
  { id: "plans", label: "プランと版" },
  { id: "distance", label: "距離" },
  { id: "waiting", label: "待機・経由" },
  { id: "extras", label: "割増・迎車・その他" },
  { id: "simulator", label: "試算" },
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

  const selectedVersion = useMemo(() => findVersion(plans, selVer), [plans, selVer]);

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
      setPlans(r.data.plans);
      if (!selVer && r.data.plans[0]?.versions[0]) setSelVer(r.data.plans[0].versions[0].id);
    } else setErr(r.error);
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
    setEditNightSurchargeBps(String(v.nightSurchargeBps ?? 0));
    setEditLeftHandSurchargeBps(String(v.leftHandSurchargeBps ?? 0));
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
    setEditDistanceDiscountBps(String(v.distanceDiscountBps ?? 0));
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
        setErr(r.error);
        return;
      }
      const vid = r.data.version.id;
      let waitingRuleJson: unknown;
      let pickupRuleJson: unknown;
      try {
        waitingRuleJson = JSON.parse(nwWaitingRuleJson || "{}");
      } catch {
        setErr("新規プラン: 待機 JSON が不正です。");
        return;
      }
      try {
        pickupRuleJson = JSON.parse(nwPickupRuleJson || "[]");
      } catch {
        setErr("新規プラン: 迎車 JSON が不正です。");
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
        nightSurchargeBps: Math.floor(Number(nwNightSurchargeBps)),
        leftHandSurchargeBps: Math.floor(Number(nwLeftHandSurchargeBps)),
        nightSurchargeFlatYen: Math.floor(Number(nwNightSurchargeFlatYen)),
        lateNightFlatYen: Math.floor(Number(nwLateNightFlatYen)),
        earlyMorningFlatYen: Math.floor(Number(nwEarlyMorningFlatYen)),
        earlyRushFlatYen: Math.floor(Number(nwEarlyRushFlatYen)),
        pickupRuleJson,
        distanceDiscountFromM:
          nwDistanceDiscountFromM.trim() === "" ? null : Math.floor(Number(nwDistanceDiscountFromM)),
        distanceDiscountBps: Math.floor(Number(nwDistanceDiscountBps)),
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
        setErr("新規プラン: 距離・待機の数値を確認してください。");
        return;
      }
      if (patch.distanceDiscountFromM != null && !Number.isFinite(patch.distanceDiscountFromM)) {
        setErr("新規プラン: 距離割引の閾値が不正です。");
        return;
      }
      const pr = await apiFetch<Ver>(`/tariff-versions/${vid}`, { method: "PATCH", json: patch });
      if (!pr.ok) {
        setErr(pr.error);
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
    if (!r.ok) setErr(r.error);
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
      setErr("料金版の数値はすべて整数で入力してください。");
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
      setErr("待機ルール JSON の形式が不正です。");
      return;
    }
    let pickupRuleJson: unknown;
    try {
      pickupRuleJson = JSON.parse(editPickupRuleJson || "[]");
    } catch {
      setErr("迎車ルール JSON の形式が不正です。");
      return;
    }
    const perViaStopYen = Math.floor(Number(editPerViaStopYen));
    const cancellationFeeYen = Math.floor(Number(editCancellationFeeYen));
    const nightSurchargeBps = Math.floor(Number(editNightSurchargeBps));
    const leftHandSurchargeBps = Math.floor(Number(editLeftHandSurchargeBps));
    const nightSurchargeFlatYen = Math.floor(Number(editNightSurchargeFlatYen));
    const lateNightFlatYen = Math.floor(Number(editLateNightFlatYen));
    const earlyMorningFlatYen = Math.floor(Number(editEarlyMorningFlatYen));
    const earlyRushFlatYen = Math.floor(Number(editEarlyRushFlatYen));
    const distanceDiscountBps = Math.floor(Number(editDistanceDiscountBps));
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
      !Number.isFinite(lateNightFlatYen) ||
      lateNightFlatYen < 0 ||
      !Number.isFinite(earlyMorningFlatYen) ||
      earlyMorningFlatYen < 0 ||
      !Number.isFinite(earlyRushFlatYen) ||
      earlyRushFlatYen < 0 ||
      !Number.isFinite(distanceDiscountBps) ||
      (distanceDiscountFromM != null && !Number.isFinite(distanceDiscountFromM))
    ) {
      setErr("版メタの数値は整数で入力してください。");
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
        setErr(r.error);
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
        setErr(r.error);
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
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
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
      setErr("ティア: fromM・stepM・加算額を正しく入力してください。");
      return;
    }
    if (untilRaw !== "" && (!Number.isFinite(untilM as number) || (untilM as number) <= fromM)) {
      setErr("ティア: untilM は空（最後まで）か、fromM より大きい整数にしてください。");
      return;
    }
    setTierSubmitting(true);
    try {
      const r = await apiFetch<Tier>(`/tariff-versions/${selVer}/distance-tiers`, {
        method: "POST",
        json: { fromM, untilM, stepM, addYenPerStep },
      });
      if (!r.ok) {
        setErr(r.error);
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
    if (!r.ok) setErr((r as { ok: false; error: string }).error);
    else await load();
  }

  const nameOk = name.trim().length > 0;
  const fromOk = fromM.trim() !== "" && !Number.isNaN(Number(fromM));
  const toOk = toM.trim() !== "" && !Number.isNaN(Number(toM));
  const fareOk = fareYen.trim() !== "" && !Number.isNaN(Number(fareYen));
  const segNumsOk = fromOk && toOk && fareOk && Number(fromM) < Number(toM);

  const newPlanSteps: StepWizardStep[] = [
    {
      id: "nw-name",
      title: "プラン名",
      description: "このプランの表示名です。作成後に初版の全項目を一度に保存します。",
      canProceed: nameOk,
      children: (
        <>
          <label>新規プラン名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </>
      ),
    },
    {
      id: "nw-distance",
      title: "距離モードと初乗り・加算",
      canProceed: true,
      children: (
        <>
          <label>距離モード</label>
          <select value={nwDistanceMode} onChange={(e) => setNwDistanceMode(e.target.value)}>
            <option value="INITIAL_ADD">初乗り＋単一加算</option>
            <option value="SEGMENTS_ONLY">セグメント表のみ</option>
            <option value="TIERED_ADD">初乗り＋多段距離加算</option>
          </select>
          <label>初乗り距離（m）</label>
          <input value={nwInitialDistanceM} onChange={(e) => setNwInitialDistanceM(e.target.value)} inputMode="numeric" />
          <label>初乗り運賃（円）</label>
          <input value={nwInitialFareYen} onChange={(e) => setNwInitialFareYen(e.target.value)} inputMode="numeric" />
          <label>加算距離単位（m）</label>
          <input value={nwAddUnitDistanceM} onChange={(e) => setNwAddUnitDistanceM(e.target.value)} inputMode="numeric" />
          <label>加算運賃（円／単位）</label>
          <input value={nwAddFareYen} onChange={(e) => setNwAddFareYen(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "nw-wait",
      title: "待機・経由",
      canProceed: true,
      children: (
        <>
          <label>待機（互換・円／分）</label>
          <input value={nwWaitingFareYenPerMin} onChange={(e) => setNwWaitingFareYenPerMin(e.target.value)} inputMode="numeric" />
          <p style={{ fontSize: "0.8rem" }}>プリセット</p>
          <p>
            {WAITING_PRESETS.map((p) => (
              <button key={p.id} type="button" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => applyNwWaitingPreset(p.json)}>
                {p.label}
              </button>
            ))}
          </p>
          <label>待機ルール JSON</label>
          <textarea value={nwWaitingRuleJson} onChange={(e) => setNwWaitingRuleJson(e.target.value)} rows={5} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }} />
          <label>経由1回あたり（円）</label>
          <input value={nwPerViaStopYen} onChange={(e) => setNwPerViaStopYen(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "nw-extra",
      title: "割増・迎車・割引・キャンセル",
      canProceed: true,
      children: (
        <>
          <label>夜間割増（bps）</label>
          <input value={nwNightSurchargeBps} onChange={(e) => setNwNightSurchargeBps(e.target.value)} inputMode="numeric" />
          <label>左ハンドル割増（bps）</label>
          <input value={nwLeftHandSurchargeBps} onChange={(e) => setNwLeftHandSurchargeBps(e.target.value)} inputMode="numeric" />
          <label>深夜定額（円・便で「深夜定額」ON）</label>
          <input value={nwNightSurchargeFlatYen} onChange={(e) => setNwNightSurchargeFlatYen(e.target.value)} inputMode="numeric" />
          <label>さらに遅い時間帯の定額（円）</label>
          <input value={nwLateNightFlatYen} onChange={(e) => setNwLateNightFlatYen(e.target.value)} inputMode="numeric" />
          <label>早朝帯1 定額（円）</label>
          <input value={nwEarlyMorningFlatYen} onChange={(e) => setNwEarlyMorningFlatYen(e.target.value)} inputMode="numeric" />
          <label>早朝帯2 定額（円）</label>
          <input value={nwEarlyRushFlatYen} onChange={(e) => setNwEarlyRushFlatYen(e.target.value)} inputMode="numeric" />
          <label>距離割引をかける距離（m・空で無効）</label>
          <input value={nwDistanceDiscountFromM} onChange={(e) => setNwDistanceDiscountFromM(e.target.value)} inputMode="numeric" placeholder="例: 11000" />
          <label>距離割引 bps（負数で割引、例 -1000 で約10%）</label>
          <input value={nwDistanceDiscountBps} onChange={(e) => setNwDistanceDiscountBps(e.target.value)} inputMode="numeric" />
          <label>迎車ルール JSON（帯の配列）</label>
          <button type="button" style={{ marginBottom: 6 }} onClick={() => setNwPickupRuleJson(PICKUP_TEMPLATE)}>
            かもたく例を挿入
          </button>
          <textarea value={nwPickupRuleJson} onChange={(e) => setNwPickupRuleJson(e.target.value)} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }} />
          <label>キャンセル料（円・メタ）</label>
          <input value={nwCancellationFeeYen} onChange={(e) => setNwCancellationFeeYen(e.target.value)} inputMode="numeric" />
          <label>備考</label>
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
          <dt>プラン名</dt>
          <dd>{name.trim()}</dd>
          <dt>距離モード</dt>
          <dd>{nwDistanceMode}</dd>
          <dt>初乗り</dt>
          <dd>
            {nwInitialDistanceM}m / {nwInitialFareYen}円
          </dd>
          <dt>加算</dt>
          <dd>
            {nwAddUnitDistanceM}m ごと {nwAddFareYen}円
          </dd>
        </dl>
      ),
    },
  ];

  const segmentSteps: StepWizardStep[] = [
    {
      id: "from",
      title: "距離の開始（m）",
      description: "セグメントの開始メートルです。",
      canProceed: fromOk,
      children: (
        <>
          <label>開始距離（m）</label>
          <input value={fromM} onChange={(e) => setFromM(e.target.value)} inputMode="numeric" autoFocus />
        </>
      ),
    },
    {
      id: "to",
      title: "距離の終了（m）",
      description: "終了メートルは開始より大きい必要があります。",
      canProceed: toOk && fromOk && Number(toM) > Number(fromM),
      children: (
        <>
          <label>終了距離（m）</label>
          <input value={toM} onChange={(e) => setToM(e.target.value)} inputMode="numeric" />
        </>
      ),
    },
    {
      id: "fare",
      title: "運賃（円）",
      description: "この距離帯に適用する金額です。",
      canProceed: fareOk,
      children: (
        <>
          <label>一般運賃（円）</label>
          <input value={fareYen} onChange={(e) => setFareYen(e.target.value)} inputMode="numeric" />
          <label>会員運賃（円・任意）</label>
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
          <dt>適用料金版</dt>
          <dd>{findVerLabel(plans, selVer)}</dd>
          <dt>距離帯</dt>
          <dd>
            {fromM} – {toM} m
          </dd>
          <dt>一般運賃</dt>
          <dd>{fareYen} 円</dd>
          {fareMemberYen.trim() !== "" ? (
            <>
              <dt>会員運賃</dt>
              <dd>{fareMemberYen} 円</dd>
            </>
          ) : null}
        </dl>
      ),
    },
  ];

  return (
    <Card title="料金プラン">
      <Err msg={err} />
      <p style={{ fontSize: "0.82rem", marginTop: 0 }}>
        料金版は直近30版まで表示（<code>?versionsLimit=1〜100</code>）。新版追加で前版からコピーします。タブで入力を整理し、下部の「版を保存」で距離・待機・割増などを一括 PATCH します。
      </p>
      <p style={{ marginTop: 0 }}>
        <button type="button" onClick={() => { setPlanWizardOpen(true); resetNewWizardDraft(); }}>
          新規プランを作成（全項目ウィザード）
        </button>{" "}
        <button type="button" onClick={() => setSegWizardOpen(true)} disabled={!selVer}>
          距離帯セグメントを追加
        </button>
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "0.75rem", borderBottom: "1px solid #ccc", paddingBottom: 8 }}>
        {TAB_LABELS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            style={{
              fontWeight: activeTab === t.id ? 700 : 400,
              borderBottom: activeTab === t.id ? "2px solid #333" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {selVer && selectedVersion ? (
        <p style={{ marginTop: "0.75rem" }}>
          <button type="button" disabled={verSaveSubmitting} onClick={() => void saveVersionParams()}>
            {verSaveSubmitting ? "保存中…" : "版を保存（全タブの入力を反映）"}
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
        title="新規プラン（初版の全項目）"
        steps={newPlanSteps}
        finishLabel="プラン作成して初版を保存"
        onFinish={submitNewPlanWizard}
        isSubmitting={planSubmitting}
      />
      <StepWizard
        open={segWizardOpen}
        onClose={closeSegWizard}
        title="距離帯セグメントを追加"
        steps={segmentSteps}
        finishLabel="セグメント追加"
        onFinish={submitSegment}
        isSubmitting={segSubmitting}
      />

      {activeTab === "plans" && (
        <section style={{ marginTop: "1rem" }}>
          {plans.map((p) => (
            <div key={p.id} style={{ marginTop: "1rem" }}>
              <strong>{p.name}</strong>{" "}
              <button type="button" onClick={() => void addVersion(p.id)}>
                新版追加（前版からコピー）
              </button>
              <ul>
                {p.versions.map((v) => (
                  <li key={v.id}>
                    <label>
                      <input type="radio" name="ver" checked={selVer === v.id} onChange={() => setSelVer(v.id)} /> v{v.version}{" "}
                      [{v.distanceMode ?? "INITIAL_ADD"}] 初乗り{v.initialDistanceM}m/{v.initialFareYen}円
                    </label>
                    <ul>
                      {[...v.segments]
                        .sort((a, b) => a.fromM - b.fromM)
                        .map((s) => (
                          <li key={s.id}>
                            {s.fromM}–{s.toM}m → 一般{s.fareYen}円
                            {s.fareMemberYen != null ? ` / 会員${s.fareMemberYen}円` : ""}{" "}
                            <button type="button" onClick={() => void delSegment(s.id)}>
                              削除
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
      )}

      {activeTab === "distance" && selVer && selectedVersion && (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>距離（{findVerLabel(plans, selVer)}）</h3>
          <label>距離モード</label>
          <select value={editDistanceMode} onChange={(e) => setEditDistanceMode(e.target.value)}>
            <option value="INITIAL_ADD">初乗り＋単一加算（従来）</option>
            <option value="SEGMENTS_ONLY">セグメント表のみ</option>
            <option value="TIERED_ADD">初乗り＋多段距離加算（ティア）</option>
          </select>
          <label>初乗り距離（m）</label>
          <input value={editInitialDistanceM} onChange={(e) => setEditInitialDistanceM(e.target.value)} inputMode="numeric" />
          <label>初乗り運賃（円）</label>
          <input value={editInitialFareYen} onChange={(e) => setEditInitialFareYen(e.target.value)} inputMode="numeric" />
          <label>加算距離単位（m）</label>
          <input value={editAddUnitDistanceM} onChange={(e) => setEditAddUnitDistanceM(e.target.value)} inputMode="numeric" />
          <label>加算運賃（円／単位）</label>
          <input value={editAddFareYen} onChange={(e) => setEditAddFareYen(e.target.value)} inputMode="numeric" />
          <p style={{ fontSize: "0.8rem" }}>
            セグメントは「距離帯セグメントを追加」から。TIERED_ADD のときは下のティアを編集（モード切替後は保存してください）。
          </p>
          {(editDistanceMode === "TIERED_ADD" || (selectedVersion.distanceTiers?.length ?? 0) > 0) && (
            <>
              <h4 style={{ marginBottom: "0.25rem" }}>距離加算ティア</h4>
              <ul>
                {[...(selectedVersion.distanceTiers ?? [])]
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((t) => (
                    <li key={t.id}>
                      {t.fromM}m–{t.untilM == null ? "∞" : `${t.untilM}m`} / {t.stepM}m ごと +{t.addYenPerStep}円{" "}
                      <button type="button" onClick={() => void delTier(t.id)}>
                        削除
                      </button>
                    </li>
                  ))}
              </ul>
              <label>fromM（m）</label>
              <input value={tierFromM} onChange={(e) => setTierFromM(e.target.value)} inputMode="numeric" />
              <label>untilM（空=最後まで）</label>
              <input value={tierUntilM} onChange={(e) => setTierUntilM(e.target.value)} inputMode="numeric" />
              <label>stepM</label>
              <input value={tierStepM} onChange={(e) => setTierStepM(e.target.value)} inputMode="numeric" />
              <label>加算（円/step）</label>
              <input value={tierAddYen} onChange={(e) => setTierAddYen(e.target.value)} inputMode="numeric" />
              <p>
                <button type="button" disabled={tierSubmitting} onClick={() => void addTier()}>
                  {tierSubmitting ? "追加中…" : "ティアを追加"}
                </button>
              </p>
            </>
          )}
        </section>
      )}

      {activeTab === "waiting" && selVer && selectedVersion && (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>待機・経由</h3>
          <label>待機（互換・円／分）</label>
          <input value={editWaitingFareYenPerMin} onChange={(e) => setEditWaitingFareYenPerMin(e.target.value)} inputMode="numeric" />
          <p style={{ fontSize: "0.8rem" }}>プリセット</p>
          <p>
            {WAITING_PRESETS.map((p) => (
              <button key={p.id} type="button" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => applyWaitingPreset(p.json)}>
                {p.label}
              </button>
            ))}
          </p>
          <label>待機ルール JSON</label>
          <textarea value={editWaitingRuleJson} onChange={(e) => setEditWaitingRuleJson(e.target.value)} rows={8} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }} />
          <label>経由1回あたり（円）</label>
          <input value={editPerViaStopYen} onChange={(e) => setEditPerViaStopYen(e.target.value)} inputMode="numeric" />
        </section>
      )}

      {activeTab === "extras" && selVer && selectedVersion && (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>割増・迎車・距離割引・キャンセル・備考</h3>
          <label>夜間割増（bps・距離運賃に乗算、便で「夜間％」ON）</label>
          <input value={editNightSurchargeBps} onChange={(e) => setEditNightSurchargeBps(e.target.value)} inputMode="numeric" />
          <label>左ハンドル割増（bps）</label>
          <input value={editLeftHandSurchargeBps} onChange={(e) => setEditLeftHandSurchargeBps(e.target.value)} inputMode="numeric" />
          <label>深夜定額（円・便で ON）</label>
          <input value={editNightSurchargeFlatYen} onChange={(e) => setEditNightSurchargeFlatYen(e.target.value)} inputMode="numeric" />
          <label>さらに遅い時間帯の定額（円）</label>
          <input value={editLateNightFlatYen} onChange={(e) => setEditLateNightFlatYen(e.target.value)} inputMode="numeric" />
          <label>早朝帯1 定額（円）</label>
          <input value={editEarlyMorningFlatYen} onChange={(e) => setEditEarlyMorningFlatYen(e.target.value)} inputMode="numeric" />
          <label>早朝帯2 定額（円）</label>
          <input value={editEarlyRushFlatYen} onChange={(e) => setEditEarlyRushFlatYen(e.target.value)} inputMode="numeric" />
          <label>距離割引をかける距離（m・空で無効）</label>
          <input value={editDistanceDiscountFromM} onChange={(e) => setEditDistanceDiscountFromM(e.target.value)} inputMode="numeric" />
          <label>距離割引 bps（負数で割引）</label>
          <input value={editDistanceDiscountBps} onChange={(e) => setEditDistanceDiscountBps(e.target.value)} inputMode="numeric" />
          <label>迎車ルール JSON</label>
          <button type="button" style={{ marginBottom: 6 }} onClick={() => setEditPickupRuleJson(PICKUP_TEMPLATE)}>
            例テンプレを挿入
          </button>
          <textarea value={editPickupRuleJson} onChange={(e) => setEditPickupRuleJson(e.target.value)} rows={8} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }} />
          <label>キャンセル料（円・帳票メタ、運賃合計には含めません）</label>
          <input value={editCancellationFeeYen} onChange={(e) => setEditCancellationFeeYen(e.target.value)} inputMode="numeric" />
          <label>備考</label>
          <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} style={{ width: "100%" }} />
        </section>
      )}

      {activeTab === "simulator" && selVer && selectedVersion && (
        <section style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ccc", borderRadius: 4, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>試算（{findVerLabel(plans, selVer)}）</h3>
          <p style={{ fontSize: "0.8rem", marginTop: 0 }}>
            距離割引は閾値以上の走行距離で距離運賃に1回適用。その後％割増、続いて各定額、待機、経由、迎車の順です。
          </p>
          <label>走行距離（km）</label>
          <input value={simDistanceKm} onChange={(e) => setSimDistanceKm(e.target.value)} inputMode="decimal" placeholder="例: 5.2" />
          <label>待機（分）</label>
          <input value={simWaitMin} onChange={(e) => setSimWaitMin(e.target.value)} inputMode="numeric" />
          <label>迎車距離（基準地点から m・空で無し）</label>
          <input value={simPickupFromBaseM} onChange={(e) => setSimPickupFromBaseM(e.target.value)} inputMode="numeric" />
          <label>
            <input type="checkbox" checked={simMember} onChange={(e) => setSimMember(e.target.checked)} /> 会員
          </label>
          <label>経由ストップ回数</label>
          <input value={simViaStops} onChange={(e) => setSimViaStops(e.target.value)} inputMode="numeric" />
          <label>
            <input type="checkbox" checked={simNight} onChange={(e) => setSimNight(e.target.checked)} /> 夜間％割増（距離運賃）
          </label>
          <label>
            <input type="checkbox" checked={simLeftHand} onChange={(e) => setSimLeftHand(e.target.checked)} /> 左ハンドル％割増
          </label>
          <label>
            <input type="checkbox" checked={simNightFlat} onChange={(e) => setSimNightFlat(e.target.checked)} /> 深夜定額
          </label>
          <label>
            <input type="checkbox" checked={simLateFlat} onChange={(e) => setSimLateFlat(e.target.checked)} /> 遅番定額
          </label>
          <label>
            <input type="checkbox" checked={simEarlyFlat} onChange={(e) => setSimEarlyFlat(e.target.checked)} /> 早朝1 定額
          </label>
          <label>
            <input type="checkbox" checked={simRushFlat} onChange={(e) => setSimRushFlat(e.target.checked)} /> 早朝2 定額
          </label>
          <p style={{ marginTop: "0.5rem", fontWeight: 600 }}>
            試算運賃: {simResultYen === null ? "—" : `${simResultYen.toLocaleString("ja-JP")} 円`}
          </p>
          {simCancelHint ? (
            <p style={{ fontSize: "0.82rem", color: "#444" }}>
              参考（INITIAL_ADD・セグメントなし・待機0・定額OFF）: 合計 {simCancelHint.totalNoSurchargeWait.toLocaleString("ja-JP")} 円（内迎車{" "}
              {simCancelHint.pickup.toLocaleString("ja-JP")} 円）。登録キャンセルメタ {simCancelHint.cancelMeta.toLocaleString("ja-JP")} 円。
            </p>
          ) : null}
        </section>
      )}

      {!selVer && activeTab !== "plans" ? <p style={{ marginTop: "1rem" }}>料金版を選択してください（プランと版タブ）。</p> : null}
    </Card>
  );
}
