import { randomUUID } from "node:crypto";

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

export type TillWallet = { id: string; name: string };

export type TillSettingsV1 = {
  version: 1;
  mode: "vehicle" | "wallet";
  vehicleCashYen: Record<string, number>;
  wallets: TillWallet[];
  walletCashYen: Record<string, number>;
};

const DEFAULT_TILL: TillSettingsV1 = {
  version: 1,
  mode: "vehicle",
  vehicleCashYen: {},
  wallets: [],
  walletCashYen: {},
};

function numRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
  }
  return out;
}

function coerceWallets(raw: unknown): TillWallet[] {
  if (!Array.isArray(raw)) return [];
  const out: TillWallet[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : randomUUID();
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (name) out.push({ id, name });
  }
  return out;
}

export function coerceTillFromCustomJson(customJson: unknown): TillSettingsV1 {
  const root = asObj(customJson);
  const raw = root.tillSettings;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TILL };
  const o = raw as Record<string, unknown>;
  const mode = o.mode === "wallet" ? "wallet" : "vehicle";
  return {
    version: 1,
    mode,
    vehicleCashYen: numRecord(o.vehicleCashYen),
    wallets: coerceWallets(o.wallets),
    walletCashYen: numRecord(o.walletCashYen),
  };
}

export function parseTillPut(body: Record<string, unknown>): { ok: true; value: TillSettingsV1 } | { ok: false; error: string } {
  const mode = body.mode === "wallet" ? "wallet" : "vehicle";
  const vehicleCashYen = numRecord(body.vehicleCashYen);
  if (!Array.isArray(body.wallets)) return { ok: false, error: "wallets は配列で指定してください" };
  const wallets = coerceWallets(body.wallets);
  const walletCashYen = numRecord(body.walletCashYen);
  return {
    ok: true,
    value: {
      version: 1,
      mode,
      vehicleCashYen,
      wallets,
      walletCashYen,
    },
  };
}

export function mergeTillIntoCustomJson(prevCustomJson: unknown, till: TillSettingsV1): JsonObj {
  const prev = asObj(prevCustomJson);
  return { ...prev, tillSettings: till as unknown as JsonObj };
}
