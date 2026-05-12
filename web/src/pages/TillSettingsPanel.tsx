import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useSavedToast } from "../saved-toast";
import { Err } from "../ui";

type TillWallet = { id: string; name: string };

type TillState = {
  version: 1;
  mode: "vehicle" | "wallet";
  vehicleCashYen: Record<string, number>;
  wallets: TillWallet[];
  walletCashYen: Record<string, number>;
};

type VehicleRow = { id: string; label: string };

function newId(p: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${p}_${Date.now()}`;
}

function numStr(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "";
  return String(Math.max(0, Math.floor(n)));
}

type Props = {
  setErr: (msg: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
};

export default function TillSettingsPanel({ setErr, busy, setBusy }: Props): JSX.Element {
  const { flashSaved } = useSavedToast();
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [till, setTill] = useState<TillState | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [walletName, setWalletName] = useState("");
  const [walletAmount, setWalletAmount] = useState("");

  const load = useCallback(async () => {
    setLocalErr(null);
    const [t, v] = await Promise.all([
      apiFetch<TillState>("/settings/till"),
      apiFetch<{ vehicles: VehicleRow[] }>("/settings/vehicles"),
    ]);
    if (!t.ok) {
      setErr(t.error);
      return;
    }
    if (!v.ok) {
      setErr(v.error);
      return;
    }
    const td = t.data;
    setTill({
      version: 1,
      mode: td.mode === "wallet" ? "wallet" : "vehicle",
      vehicleCashYen: { ...(td.vehicleCashYen ?? {}) },
      wallets: [...(td.wallets ?? [])],
      walletCashYen: { ...(td.walletCashYen ?? {}) },
    });
    setVehicles(v.data.vehicles ?? []);
  }, [setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (!till) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch("/settings/till", {
      method: "PUT",
      json: {
        mode: till.mode,
        vehicleCashYen: till.vehicleCashYen,
        wallets: till.wallets,
        walletCashYen: till.walletCashYen,
      },
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else {
      flashSaved();
      void load();
    }
  }

  function setVehicleCash(id: string, raw: string): void {
    if (!till) return;
    const n = raw.trim() === "" ? 0 : Number(raw);
    const y = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    setTill({ ...till, vehicleCashYen: { ...till.vehicleCashYen, [id]: y } });
  }

  function setWalletCash(id: string, raw: string): void {
    if (!till) return;
    const n = raw.trim() === "" ? 0 : Number(raw);
    const y = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    setTill({ ...till, walletCashYen: { ...till.walletCashYen, [id]: y } });
  }

  function confirmWalletDialog(): void {
    if (!till) return;
    const name = walletName.trim();
    if (!name) {
      setLocalErr("財布名を入力してください。");
      return;
    }
    const amt = walletAmount.trim() === "" ? 0 : Number(walletAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      setLocalErr("金額は0以上の数で入力してください。");
      return;
    }
    const id = newId("w");
    setLocalErr(null);
    setTill({
      ...till,
      wallets: [...till.wallets, { id, name }],
      walletCashYen: { ...till.walletCashYen, [id]: Math.floor(amt) },
    });
    setWalletDialogOpen(false);
    setWalletName("");
    setWalletAmount("");
  }

  function removeWallet(id: string): void {
    if (!till) return;
    const wc = { ...till.walletCashYen };
    delete wc[id];
    setTill({
      ...till,
      wallets: till.wallets.filter((w) => w.id !== id),
      walletCashYen: wc,
    });
  }

  if (!till) {
    return <p className="settings-hint">読み込み中…</p>;
  }

  return (
    <div className="settings-form">
      <p className="settings-hint">レジ金（現金在高）を、随伴車ごとか財布ごとに記録します。保存するとテナント設定に書き込まれます。</p>

      <div className="settings-toolbar" style={{ flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginTop: "0.35rem" }}>
        <span className="settings-hint" style={{ margin: 0 }}>
          単位
        </span>
        <label className="settings-inline-check">
          <input
            type="radio"
            name="till-mode"
            checked={till.mode === "vehicle"}
            onChange={() => setTill({ ...till, mode: "vehicle" })}
          />
          随伴車毎
        </label>
        <label className="settings-inline-check">
          <input
            type="radio"
            name="till-mode"
            checked={till.mode === "wallet"}
            onChange={() => setTill({ ...till, mode: "wallet" })}
          />
          財布毎
        </label>
      </div>

      {till.mode === "vehicle" ? (
        <>
          {vehicles.length === 0 ? (
            <p className="settings-hint">随伴車がまだありません。「随伴車」タブで登録してください。</p>
          ) : (
            <ul className="settings-sf-list">
              {vehicles.map((v) => (
                <li key={v.id} className="settings-sf-row attend-shift-list-row">
                  <span className="settings-sf-name">{v.label}</span>
                  <label className="settings-sf-meta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }}>
                    レジ金（円）
                    <input
                      type="number"
                      min={0}
                      className="attend-shift-time-field"
                      style={{ width: "7rem" }}
                      value={numStr(till.vehicleCashYen[v.id])}
                      onChange={(e) => setVehicleCash(v.id, e.target.value)}
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="settings-toolbar" style={{ marginTop: "0.5rem" }}>
            <button type="button" className="settings-secondary" onClick={() => setWalletDialogOpen(true)}>
              財布登録
            </button>
          </div>
          {till.wallets.length === 0 ? (
            <p className="settings-hint">財布がありません。「財布登録」から追加してください。</p>
          ) : (
            <ul className="settings-sf-list">
              {till.wallets.map((w) => (
                <li key={w.id} className="settings-sf-row attend-shift-list-row">
                  <span className="settings-sf-name">{w.name}</span>
                  <span className="settings-sf-meta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }}>
                    <span>レジ金（円）</span>
                    <input
                      type="number"
                      min={0}
                      className="attend-shift-time-field"
                      style={{ width: "7rem" }}
                      value={numStr(till.walletCashYen[w.id])}
                      onChange={(e) => setWalletCash(w.id, e.target.value)}
                    />
                    <button type="button" className="settings-secondary" onClick={() => removeWallet(w.id)}>
                      削除
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="settings-actions" style={{ marginTop: "1rem" }}>
        <button type="button" className="settings-primary" disabled={busy} onClick={() => void save()}>
          保存
        </button>
      </div>

      {walletDialogOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setWalletDialogOpen(false);
          }}
        >
          <div
            className="pricing-modal attend-shift-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="till-wallet-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="till-wallet-title" className="pricing-modal-title">
              財布を登録
            </h2>
            <div className="attend-shift-dialog-scroll">
              <Err msg={localErr} />
              <label htmlFor="tw-name">財布名</label>
              <input id="tw-name" type="text" value={walletName} onChange={(e) => setWalletName(e.target.value)} maxLength={80} />
              <label htmlFor="tw-amt">金額（円）</label>
              <input id="tw-amt" type="number" min={0} value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} />
              <p className="settings-hint">登録時の金額はレジ金の初期値として保存されます。あとから一覧の入力欄で変更できます。</p>
            </div>
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" onClick={() => confirmWalletDialog()}>
                保存
              </button>
              <button
                type="button"
                onClick={() => {
                  setWalletDialogOpen(false);
                  setLocalErr(null);
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
