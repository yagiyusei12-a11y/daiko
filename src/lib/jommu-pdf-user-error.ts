/**
 * 乗務記録簿 PDF の 500 応答に載せてよい文言（ファイルパス・cwd・スタックは含めない）。
 */
export function userFacingJommuPdfError(err: unknown): string {
  const fallback = "乗務記録簿 PDF の生成に失敗しました。時間をおいて再度お試しください。";
  if (!(err instanceof Error)) return fallback;
  const m = err.message;
  if (m.startsWith("LibreOffice が PDF")) return m;
  if (m.startsWith("soffice の実行に失敗")) return m;
  if (m.startsWith("jommu:")) return m;
  if (m.startsWith("乗務記録簿テンプレが見つかりません")) return m;
  if (m.startsWith("pdf 結合:")) return m;
  return fallback;
}
