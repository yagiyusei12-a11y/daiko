import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { StepWizard, type StepWizardStep } from "../ui";

const PRICING_FEATURE_OPTS: { id: string; label: string }[] = [
  { id: "pickup", label: "迎車料金" },
  { id: "waiting", label: "待機時間" },
  { id: "leftHand", label: "左ハンドル" },
  { id: "foreignCar", label: "外車" },
  { id: "specialFare", label: "特別料金" },
  { id: "cancel", label: "キャンセル" },
];

type DistanceBand = {
  baseFareYen: number;
  includedDistanceM: number;
  addEveryM: number;
  addFareYen: number;
};

type TimeBand = {
  baseFareYen: number;
  includedMinutes: number;
  addEveryMin: number;
  addFareYen: number;
};

type SpecialFareEntry = {
  id: string;
  name: string;
  regime: "distance" | "time" | "both";
  distance: DistanceBand;
  time: TimeBand;
  nightExtraYen: number;
  earlyExtraYen: number;
  memberExtraYen: number;
};

type PricingPrefsV1 = {
  version: 1;
  regime: "" | "distance" | "time" | "both";
  features: string[];
  mainDistance: DistanceBand;
  mainTime: TimeBand;
  pickupBaseYen: number;
  waiting: TimeBand;
  leftHandBaseYen: number;
  foreignCarBaseYen: number;
  cancelBaseYen: number;
  specialFares: SpecialFareEntry[];
};

function emptyD(): DistanceBand {
  return { baseFareYen: 0, includedDistanceM: 0, addEveryM: 0, addFareYen: 0 };
}

function emptyT(): TimeBand {
  return { baseFareYen: 0, includedMinutes: 0, addEveryMin: 0, addFareYen: 0 };
}

function defaultPrefs(): PricingPrefsV1 {
  return {
    version: 1,
    regime: "",
    features: [],
    mainDistance: emptyD(),
    mainTime: emptyT(),
    pickupBaseYen: 0,
    waiting: emptyT(),
    leftHandBaseYen: 0,
    foreignCarBaseYen: 0,
    cancelBaseYen: 0,
    specialFares: [],
  };
}

function asPrefs(v: unknown): PricingPrefsV1 {
  if (!v || typeof v !== "object") return defaultPrefs();
  const p = v as Record<string, unknown>;
  const md = (p.mainDistance as DistanceBand | undefined) ?? emptyD();
  const mt = (p.mainTime as TimeBand | undefined) ?? emptyT();
  const w = (p.waiting as TimeBand | undefined) ?? emptyT();
  const feats = Array.isArray(p.features) ? p.features.filter((x): x is string => typeof x === "string") : [];
  const sf = Array.isArray(p.specialFares) ? (p.specialFares as SpecialFareEntry[]) : [];
  return {
    version: 1,
    regime:
      p.regime === "distance" || p.regime === "time" || p.regime === "both" || p.regime === ""
        ? p.regime
        : "",
    features: [...new Set(feats.filter((id) => id !== "distance" && id !== "time"))],
    mainDistance: { ...emptyD(), ...md },
    mainTime: { ...emptyT(), ...mt },
    pickupBaseYen: Number(p.pickupBaseYen) || 0,
    waiting: { ...emptyT(), ...w },
    leftHandBaseYen: Number(p.leftHandBaseYen) || 0,
    foreignCarBaseYen: Number(p.foreignCarBaseYen) || 0,
    cancelBaseYen: Number(p.cancelBaseYen) || 0,
    specialFares: sf
      .filter((x) => x && typeof x === "object" && String((x as SpecialFareEntry).name || "").trim())
      .map((x) => ({
        ...x,
        distance: { ...emptyD(), ...(x as SpecialFareEntry).distance },
        time: { ...emptyT(), ...(x as SpecialFareEntry).time },
        nightExtraYen: Number((x as SpecialFareEntry).nightExtraYen) || 0,
        earlyExtraYen: Number((x as SpecialFareEntry).earlyExtraYen) || 0,
        memberExtraYen: Number((x as SpecialFareEntry).memberExtraYen) || 0,
      })),
  };
}

function NumInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}): JSX.Element {
  return (
    <>
      <label>{label}</label>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      />
    </>
  );
}

function DistanceBlockFields({
  title,
  v,
  onChange,
}: {
  title: string;
  v: DistanceBand;
  onChange: (next: DistanceBand) => void;
}): JSX.Element {
  return (
    <fieldset className="settings-fieldset settings-pricing-block">
      <legend>{title}</legend>
      <NumInput label="基本料金（円）" value={v.baseFareYen} onChange={(n) => onChange({ ...v, baseFareYen: n })} />
      <NumInput
        label="基本料金内距離（メートル）"
        value={v.includedDistanceM}
        onChange={(n) => onChange({ ...v, includedDistanceM: n })}
      />
      <NumInput label="以降距離毎（メートル）" value={v.addEveryM} onChange={(n) => onChange({ ...v, addEveryM: n })} />
      <NumInput label="加算料金（円）" value={v.addFareYen} onChange={(n) => onChange({ ...v, addFareYen: n })} />
    </fieldset>
  );
}

function TimeBlockFields({
  title,
  v,
  onChange,
}: {
  title: string;
  v: TimeBand;
  onChange: (next: TimeBand) => void;
}): JSX.Element {
  return (
    <fieldset className="settings-fieldset settings-pricing-block">
      <legend>{title}</legend>
      <NumInput label="基本料金（円）" value={v.baseFareYen} onChange={(n) => onChange({ ...v, baseFareYen: n })} />
      <NumInput
        label="基本料金内時間（分）"
        value={v.includedMinutes}
        onChange={(n) => onChange({ ...v, includedMinutes: n })}
      />
      <NumInput label="以降時間毎（分）" value={v.addEveryMin} onChange={(n) => onChange({ ...v, addEveryMin: n })} />
      <NumInput label="加算料金（円）" value={v.addFareYen} onChange={(n) => onChange({ ...v, addFareYen: n })} />
    </fieldset>
  );
}

type Props = {
  setMsg: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
};

export default function PricingSettingsPanel({ setMsg, setErr, busy, setBusy }: Props): JSX.Element {
  const [prefs, setPrefs] = useState<PricingPrefsV1>(() => defaultPrefs());
  const [loaded, setLoaded] = useState(false);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [draft, setDraft] = useState<SpecialFareEntry | null>(null);
  const [selectedSf, setSelectedSf] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    const r = await apiFetch<{ pricingPrefs?: unknown }>("/settings/pricing");
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setPrefs(asPrefs((r.data as { pricingPrefs?: unknown }).pricingPrefs ?? r.data));
    setLoaded(true);
  }, [setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFeature = (id: string): void => {
    setPrefs((p) => ({
      ...p,
      features: p.features.includes(id) ? p.features.filter((x) => x !== id) : [...p.features, id],
    }));
  };

  const toggleSfSel = (id: string): void => {
    setSelectedSf((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const deleteSelectedSf = (): void => {
    if (!selectedSf.size) return;
    if (!window.confirm("選択した特別料金を削除しますか？")) return;
    setPrefs((p) => ({ ...p, specialFares: p.specialFares.filter((x) => !selectedSf.has(x.id)) }));
    setSelectedSf(new Set());
  };

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const r = await apiFetch("/settings/pricing", { method: "PUT", json: { pricingPrefs: prefs } });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else setMsg("料金設定を保存しました。");
  }

  const openNewSpecial = (): void => {
    setDraft({
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sf_${Date.now()}`,
      name: "",
      regime: "distance",
      distance: emptyD(),
      time: emptyT(),
      nightExtraYen: 0,
      earlyExtraYen: 0,
      memberExtraYen: 0,
    });
    setSpecialOpen(true);
  };

  const specialSteps: StepWizardStep[] = useMemo(() => {
    if (!draft) return [];
    return [
      {
        id: "meta",
        title: "特別料金",
        description: "名称と深夜・早朝・会員の追加額（任意）を入力します。",
        canProceed: Boolean(draft.name.trim()),
        children: (
          <div className="settings-form">
            <label>特別料金名称</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <p className="settings-hint">深夜料金・早朝料金・会員料金（円・任意）</p>
            <NumInput
              label="深夜料金（円）"
              value={draft.nightExtraYen}
              onChange={(n) => setDraft({ ...draft, nightExtraYen: n })}
            />
            <NumInput
              label="早朝料金（円）"
              value={draft.earlyExtraYen}
              onChange={(n) => setDraft({ ...draft, earlyExtraYen: n })}
            />
            <NumInput
              label="会員料金（円）"
              value={draft.memberExtraYen}
              onChange={(n) => setDraft({ ...draft, memberExtraYen: n })}
            />
          </div>
        ),
      },
      {
        id: "regime",
        title: "料金体制（この特別料金）",
        description: "距離制・時間制・併用から選び、次の画面で金額を入力します。",
        canProceed: true,
        children: (
          <fieldset className="settings-fieldset">
            <legend>料金体制をお選びください</legend>
            <label>
              <input
                type="radio"
                name="sfreg"
                checked={draft.regime === "distance"}
                onChange={() => setDraft({ ...draft, regime: "distance" })}
              />{" "}
              距離制
            </label>
            <label>
              <input
                type="radio"
                name="sfreg"
                checked={draft.regime === "time"}
                onChange={() => setDraft({ ...draft, regime: "time" })}
              />{" "}
              時間制
            </label>
            <label>
              <input
                type="radio"
                name="sfreg"
                checked={draft.regime === "both"}
                onChange={() => setDraft({ ...draft, regime: "both" })}
              />{" "}
              距離・時間の併用
            </label>
          </fieldset>
        ),
      },
      {
        id: "amounts",
        title: "料金の内訳",
        canProceed: true,
        children: (
          <div className="settings-form">
            {(draft.regime === "distance" || draft.regime === "both") && (
              <DistanceBlockFields
                title="距離制"
                v={draft.distance}
                onChange={(distance) => setDraft({ ...draft, distance })}
              />
            )}
            {(draft.regime === "time" || draft.regime === "both") && (
              <TimeBlockFields title="時間制" v={draft.time} onChange={(time) => setDraft({ ...draft, time })} />
            )}
          </div>
        ),
      },
    ];
  }, [draft]);

  if (!loaded) return <p className="settings-hint">読み込み中…</p>;

  return (
    <div className="settings-form settings-pricing-root">
      <fieldset className="settings-fieldset">
        <legend>料金体制をお選びください</legend>
        <label>
          <input type="radio" name="regime" checked={prefs.regime === ""} onChange={() => setPrefs({ ...prefs, regime: "" })} />{" "}
          未選択
        </label>
        <label>
          <input
            type="radio"
            name="regime"
            checked={prefs.regime === "distance"}
            onChange={() => setPrefs({ ...prefs, regime: "distance" })}
          />{" "}
          距離制を主とする
        </label>
        <label>
          <input
            type="radio"
            name="regime"
            checked={prefs.regime === "time"}
            onChange={() => setPrefs({ ...prefs, regime: "time" })}
          />{" "}
          時間制を主とする
        </label>
        <label>
          <input
            type="radio"
            name="regime"
            checked={prefs.regime === "both"}
            onChange={() => setPrefs({ ...prefs, regime: "both" })}
          />{" "}
          距離・時間の併用
        </label>
      </fieldset>

      {(prefs.regime === "distance" || prefs.regime === "both") && (
        <DistanceBlockFields title="メイン（距離制）" v={prefs.mainDistance} onChange={(mainDistance) => setPrefs({ ...prefs, mainDistance })} />
      )}
      {(prefs.regime === "time" || prefs.regime === "both") && (
        <TimeBlockFields title="メイン（時間制）" v={prefs.mainTime} onChange={(mainTime) => setPrefs({ ...prefs, mainTime })} />
      )}

      <p className="settings-hint">取り扱い項目（複数選択）</p>
      <div className="settings-check-grid">
        {PRICING_FEATURE_OPTS.map((o) => (
          <label key={o.id} className="settings-check">
            <input type="checkbox" checked={prefs.features.includes(o.id)} onChange={() => toggleFeature(o.id)} /> {o.label}
          </label>
        ))}
      </div>

      {prefs.features.includes("pickup") && (
        <fieldset className="settings-fieldset">
          <legend>迎車料金</legend>
          <NumInput
            label="基本迎車料金（円）"
            value={prefs.pickupBaseYen}
            onChange={(pickupBaseYen) => setPrefs({ ...prefs, pickupBaseYen })}
          />
          <p className="settings-hint">日報の運行で迎車料金にチェックを入れると、この金額が初期表示されます（運行上で変更可）。</p>
        </fieldset>
      )}

      {prefs.features.includes("waiting") && (
        <TimeBlockFields title="待機時間" v={prefs.waiting} onChange={(waiting) => setPrefs({ ...prefs, waiting })} />
      )}

      {prefs.features.includes("leftHand") && (
        <fieldset className="settings-fieldset">
          <legend>左ハンドル</legend>
          <NumInput
            label="基本料金（円）"
            value={prefs.leftHandBaseYen}
            onChange={(leftHandBaseYen) => setPrefs({ ...prefs, leftHandBaseYen })}
          />
          <p className="settings-hint">日報で左ハンドルにチェックを入れると初期表示されます（変更可）。</p>
        </fieldset>
      )}

      {prefs.features.includes("foreignCar") && (
        <fieldset className="settings-fieldset">
          <legend>外車</legend>
          <NumInput
            label="基本料金（円）"
            value={prefs.foreignCarBaseYen}
            onChange={(foreignCarBaseYen) => setPrefs({ ...prefs, foreignCarBaseYen })}
          />
          <p className="settings-hint">日報で外車にチェックを入れると初期表示されます（変更可）。</p>
        </fieldset>
      )}

      {prefs.features.includes("cancel") && (
        <fieldset className="settings-fieldset">
          <legend>キャンセル</legend>
          <NumInput
            label="基本料金（円）"
            value={prefs.cancelBaseYen}
            onChange={(cancelBaseYen) => setPrefs({ ...prefs, cancelBaseYen })}
          />
          <p className="settings-hint">日報でキャンセルにチェックを入れると初期表示されます（変更可）。</p>
        </fieldset>
      )}

      {prefs.features.includes("specialFare") && (
        <div className="settings-special-fare">
          <div className="settings-toolbar">
            <button type="button" onClick={openNewSpecial}>
              特別料金を追加
            </button>
            <button type="button" disabled={!selectedSf.size} onClick={deleteSelectedSf}>
              選択を削除
            </button>
          </div>
          <ul className="settings-sf-list">
            {prefs.specialFares.map((sf) => (
              <li key={sf.id} className="settings-sf-row">
                <label className="settings-check">
                  <input type="checkbox" checked={selectedSf.has(sf.id)} onChange={() => toggleSfSel(sf.id)} />
                </label>
                <span className="settings-sf-name">{sf.name}</span>
                <span className="settings-sf-meta">{sf.regime}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" className="settings-primary" disabled={busy} onClick={() => void save()}>
        保存
      </button>

      <StepWizard
        open={specialOpen && !!draft}
        onClose={() => {
          setSpecialOpen(false);
          setDraft(null);
        }}
        title="特別料金の追加"
        steps={specialSteps}
        finishLabel="保存して一覧へ"
        onFinish={() => {
          if (!draft?.name.trim()) return;
          setPrefs((p) => ({ ...p, specialFares: [...p.specialFares, draft] }));
          setSpecialOpen(false);
          setDraft(null);
        }}
      />
    </div>
  );
}
