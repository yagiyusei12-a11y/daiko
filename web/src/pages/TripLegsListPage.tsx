import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth, formatFlexDatetime } from "../auth";
import { Card, Err } from "../ui";

type TripRow = {
  id: string;
  dailyReportId: string;
  businessDate: string;
  departedAt: string;
  arrivedAt: string;
  clientName: string;
  charterVehicleNo: string | null;
  origin: string;
  destination: string;
  viaStops: string[];
  fareYen: number;
  parkingAdvanceYen: number;
  tripPaymentMethod: string | null;
  tripReceiptIssued: boolean;
  accompanyingCrewName: string | null;
  mainEmployee: { id: string; name: string };
  partnerEmployee: { id: string; name: string } | null;
  escortVehicle: { id: string; label: string } | null;
};

type EmpOpt = { id: string; familyName: string; givenName: string };
type VehOpt = { id: string; label: string };

type SearchFilters = {
  clientName: string;
  charterVehicleNo: string;
  tripReceiptIssued: "" | "true" | "false";
  mainEmployeeIds: string[];
  partnerEmployeeIds: string[];
  escortVehicleIds: string[];
  tripPaymentMethods: string[];
};

const EMPTY_FILTERS: SearchFilters = {
  clientName: "",
  charterVehicleNo: "",
  tripReceiptIssued: "",
  mainEmployeeIds: [],
  partnerEmployeeIds: [],
  escortVehicleIds: [],
  tripPaymentMethods: [],
};

function viaSummary(viaStops: string[]): string {
  const v = viaStops.filter(Boolean);
  if (v.length === 0) return "—";
  return v.join(" · ");
}

function formatTripStart(departedIso: string, businessDate: string, dayChangeHour: number): string {
  if (!departedIso) return "—";
  const label = formatFlexDatetime(departedIso, businessDate, dayChangeHour);
  if (!label) return "—";
  const m = label.match(/^\d{4}\/(\d{2}\/\d{2} \d{2}:\d{2})$/);
  return m ? m[1] : label;
}

function paymentLabel(method: string | null): string {
  return method?.trim() ? method : "—";
}

function receiptLabel(issued: boolean): string {
  return issued ? "発行済" : "—";
}

function buildQuery(filters: SearchFilters): string {
  const p = new URLSearchParams();
  if (filters.clientName.trim()) p.set("clientName", filters.clientName.trim());
  if (filters.charterVehicleNo.trim()) p.set("charterVehicleNo", filters.charterVehicleNo.trim());
  if (filters.tripReceiptIssued) p.set("tripReceiptIssued", filters.tripReceiptIssued);
  if (filters.mainEmployeeIds.length) p.set("mainEmployeeIds", filters.mainEmployeeIds.join(","));
  if (filters.partnerEmployeeIds.length) p.set("partnerEmployeeIds", filters.partnerEmployeeIds.join(","));
  if (filters.escortVehicleIds.length) p.set("escortVehicleIds", filters.escortVehicleIds.join(","));
  if (filters.tripPaymentMethods.length) p.set("tripPaymentMethods", filters.tripPaymentMethods.join(","));
  return p.toString();
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function MultiCheckGroup({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}): JSX.Element {
  if (options.length === 0) {
    return (
      <fieldset className="settings-fieldset trip-legs-filter-group">
        <legend>{legend}</legend>
        <p className="settings-hint" style={{ margin: 0 }}>
          候補がありません
        </p>
      </fieldset>
    );
  }
  return (
    <fieldset className="settings-fieldset trip-legs-filter-group">
      <legend>{legend}</legend>
      <div className="trip-legs-check-grid">
        {options.map((o) => (
          <label key={o.id} className="settings-check trip-legs-check">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={() => onChange(toggleId(selected, o.id))}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TripDetailDialog({
  trip,
  dayChangeHour,
  onClose,
}: {
  trip: TripRow;
  dayChangeHour: number;
  onClose: () => void;
}): JSX.Element {
  const startLabel = formatTripStart(trip.departedAt, trip.businessDate, dayChangeHour);
  const endLabel = formatFlexDatetime(trip.arrivedAt, trip.businessDate, dayChangeHour) || "—";

  return (
    <div
      className="pricing-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pricing-modal attend-shift-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-detail-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="trip-detail-title" className="pricing-modal-title">
          運行の詳細
        </h2>
        <div className="attend-shift-dialog-scroll">
          <dl className="trip-legs-detail-dl">
            <dt>事業日</dt>
            <dd>{trip.businessDate}</dd>
            <dt>開始時刻</dt>
            <dd>{startLabel}</dd>
            <dt>到着時刻</dt>
            <dd>{endLabel}</dd>
            <dt>依頼者名</dt>
            <dd>{trip.clientName?.trim() || "（未入力）"}</dd>
            <dt>客車の車両番号</dt>
            <dd>{trip.charterVehicleNo?.trim() || "—"}</dd>
            <dt>開始場所</dt>
            <dd>{trip.origin?.trim() || "—"}</dd>
            <dt>経由地</dt>
            <dd>{viaSummary(trip.viaStops)}</dd>
            <dt>到着場所</dt>
            <dd>{trip.destination?.trim() || "—"}</dd>
            <dt>運賃</dt>
            <dd>¥{trip.fareYen.toLocaleString("ja-JP")}</dd>
            <dt>駐車場料金（立替）</dt>
            <dd>¥{(trip.parkingAdvanceYen ?? 0).toLocaleString("ja-JP")}</dd>
            <dt>支払方法</dt>
            <dd>{paymentLabel(trip.tripPaymentMethod)}</dd>
            <dt>領収書</dt>
            <dd>{trip.tripReceiptIssued ? "発行した" : "未発行"}</dd>
            <dt>客車担当</dt>
            <dd>{trip.mainEmployee.name}</dd>
            <dt>ペア（乗務員）</dt>
            <dd>{trip.partnerEmployee?.name || trip.accompanyingCrewName?.trim() || "—"}</dd>
            <dt>同伴乗務員名（記録）</dt>
            <dd>{trip.accompanyingCrewName?.trim() || "—"}</dd>
            <dt>随伴車</dt>
            <dd>{trip.escortVehicle?.label || "—"}</dd>
          </dl>
          <p style={{ marginTop: "0.75rem" }}>
            <Link to={`/daily-reports/${trip.dailyReportId}`}>この日報を開く</Link>
          </p>
        </div>
        <div className="pricing-modal-actions">
          <button type="button" className="settings-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TripLegsListPage(): JSX.Element {
  const { me } = useAuth();
  const dayChangeHour = me?.dayChangeHour ?? 28;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [draft, setDraft] = useState<SearchFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<SearchFilters>(EMPTY_FILTERS);
  const [detailTrip, setDetailTrip] = useState<TripRow | null>(null);

  const [employees, setEmployees] = useState<EmpOpt[]>([]);
  const [passengerDrivers, setPassengerDrivers] = useState<EmpOpt[]>([]);
  const [vehicles, setVehicles] = useState<VehOpt[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);

  const empOpts = useMemo(
    () => passengerDrivers.map((e) => ({ id: e.id, label: `${e.familyName} ${e.givenName}`.trim() })),
    [passengerDrivers],
  );
  const partnerOpts = useMemo(
    () => employees.map((e) => ({ id: e.id, label: `${e.familyName} ${e.givenName}`.trim() })),
    [employees],
  );
  const vehOpts = useMemo(() => vehicles.map((v) => ({ id: v.id, label: v.label })), [vehicles]);

  const loadMeta = useCallback(async () => {
    const [r1, r2, r3, r4] = await Promise.all([
      apiFetch<{ employees: EmpOpt[] }>("/settings/employees"),
      apiFetch<{ employees: EmpOpt[] }>("/settings/employees?forPassengerDriver=1"),
      apiFetch<{ vehicles: VehOpt[] }>("/settings/vehicles"),
      apiFetch<{ paymentMethods: string[] }>("/settings/basics"),
    ]);
    if (r1.ok) setEmployees(r1.data.employees);
    if (r2.ok) setPassengerDrivers(r2.data.employees);
    if (r3.ok) setVehicles(r3.data.vehicles);
    if (r4.ok && Array.isArray(r4.data.paymentMethods)) {
      setPaymentMethods(r4.data.paymentMethods.filter((x): x is string => typeof x === "string"));
    }
  }, []);

  const search = useCallback(async (filters: SearchFilters) => {
    setBusy(true);
    setErr(null);
    const qs = buildQuery(filters);
    const r = await apiFetch<{ trips: TripRow[] }>(`/trip-legs${qs ? `?${qs}` : ""}`);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setTrips(r.data.trips);
    setApplied(filters);
  }, []);

  useEffect(() => {
    void loadMeta();
    void search(EMPTY_FILTERS);
  }, [loadMeta, search]);

  async function deleteTrip(t: TripRow): Promise<void> {
    const label = `${formatTripStart(t.departedAt, t.businessDate, dayChangeHour)} ${t.clientName?.trim() || "（未入力）"}`;
    if (!window.confirm(`この運行を削除しますか？\n${label}`)) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch(`/daily-reports/${t.dailyReportId}/trips/${t.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    if (detailTrip?.id === t.id) setDetailTrip(null);
    void search(applied);
  }

  return (
    <Card title="運行一覧">
      <div className="card-header-actions">
        <Link to="/daily-reports" className="settings-secondary" style={{ textDecoration: "none" }}>
          ← 日報一覧
        </Link>
      </div>
      <Err msg={err} />

      <div className="settings-section-panel trip-legs-search-panel">
        <h3 className="settings-subtitle" style={{ marginTop: 0 }}>
          検索
        </h3>
        <div className="settings-form trip-legs-search-form">
          <label htmlFor="tl-client">依頼者名</label>
          <input
            id="tl-client"
            type="text"
            value={draft.clientName}
            onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value }))}
            placeholder="部分一致"
          />
          <label htmlFor="tl-charter">客車の車両番号</label>
          <input
            id="tl-charter"
            type="text"
            value={draft.charterVehicleNo}
            onChange={(e) => setDraft((d) => ({ ...d, charterVehicleNo: e.target.value }))}
            placeholder="部分一致"
          />
          <label htmlFor="tl-receipt">領収書を発行した</label>
          <select
            id="tl-receipt"
            value={draft.tripReceiptIssued}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                tripReceiptIssued: e.target.value as SearchFilters["tripReceiptIssued"],
              }))
            }
          >
            <option value="">すべて</option>
            <option value="true">発行済のみ</option>
            <option value="false">未発行のみ</option>
          </select>
        </div>

        <MultiCheckGroup
          legend="支払方法"
          options={paymentMethods.map((pm) => ({ id: pm, label: pm }))}
          selected={draft.tripPaymentMethods}
          onChange={(tripPaymentMethods) => setDraft((d) => ({ ...d, tripPaymentMethods }))}
        />
        <MultiCheckGroup
          legend="客車担当"
          options={empOpts}
          selected={draft.mainEmployeeIds}
          onChange={(mainEmployeeIds) => setDraft((d) => ({ ...d, mainEmployeeIds }))}
        />
        <MultiCheckGroup
          legend="ペア（乗務員）"
          options={partnerOpts}
          selected={draft.partnerEmployeeIds}
          onChange={(partnerEmployeeIds) => setDraft((d) => ({ ...d, partnerEmployeeIds }))}
        />
        <MultiCheckGroup
          legend="随伴車"
          options={vehOpts}
          selected={draft.escortVehicleIds}
          onChange={(escortVehicleIds) => setDraft((d) => ({ ...d, escortVehicleIds }))}
        />

        <div className="settings-toolbar" style={{ marginTop: "0.65rem" }}>
          <button
            type="button"
            className="settings-primary"
            disabled={busy}
            onClick={() => void search(draft)}
          >
            {busy ? "検索中…" : "検索"}
          </button>
          <button
            type="button"
            className="settings-secondary"
            disabled={busy}
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              void search(EMPTY_FILTERS);
            }}
          >
            条件をクリア
          </button>
        </div>
        <p className="settings-hint" style={{ marginBottom: 0 }}>
          直近の運行から最大 50 件を表示します。
        </p>
      </div>

      <div className="settings-section-panel trip-history-wrap" style={{ marginTop: "1rem" }}>
        <h3 className="settings-subtitle" style={{ marginTop: 0 }}>
          運行（{trips.length}件）
        </h3>
        {trips.length === 0 ? (
          <p className="settings-hint">該当する運行がありません。</p>
        ) : (
          <table className="trip-history-table trip-legs-list-table">
            <thead>
              <tr>
                <th>開始時刻</th>
                <th>依頼者名</th>
                <th>開始場所</th>
                <th>経由地</th>
                <th>到着場所</th>
                <th>支払方法</th>
                <th>領収書</th>
                <th className="trip-history-th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const startLabel = formatTripStart(t.departedAt, t.businessDate, dayChangeHour);
                const viaLabel = viaSummary(t.viaStops);
                const clientLabel = t.clientName?.trim() ? t.clientName : "（未入力）";
                return (
                  <tr
                    key={t.id}
                    className="trip-history-tr"
                    tabIndex={0}
                    role="button"
                    onClick={() => setDetailTrip(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetailTrip(t);
                      }
                    }}
                  >
                    <td className="trip-history-cell-clip" title={startLabel}>
                      {startLabel}
                    </td>
                    <td className="trip-history-cell-clip" title={clientLabel}>
                      {clientLabel}
                    </td>
                    <td className="trip-history-cell-clip" title={t.origin}>
                      {t.origin?.trim() || "—"}
                    </td>
                    <td className="trip-history-cell-clip" title={viaLabel}>
                      {viaLabel}
                    </td>
                    <td className="trip-history-cell-clip" title={t.destination}>
                      {t.destination?.trim() || "—"}
                    </td>
                    <td className="trip-history-cell-clip">{paymentLabel(t.tripPaymentMethod)}</td>
                    <td>{receiptLabel(t.tripReceiptIssued)}</td>
                    <td className="trip-history-td-actions">
                      <button
                        type="button"
                        className="settings-secondary"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteTrip(t);
                        }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailTrip ? (
        <TripDetailDialog trip={detailTrip} dayChangeHour={dayChangeHour} onClose={() => setDetailTrip(null)} />
      ) : null}
    </Card>
  );
}
