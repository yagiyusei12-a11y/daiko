/** 公開ベータの初期テスター自動付与 */

export function earlyTesterAutoEnrollEnabled(): boolean {
  const raw = (process.env.EARLY_TESTER_AUTO_ENROLL ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function earlyTesterLockedPriceYen(): number {
  const n = Number(process.env.EARLY_TESTER_PRICE_YEN ?? "2980");
  if (!Number.isFinite(n) || n <= 0) return 2980;
  return Math.round(n);
}
