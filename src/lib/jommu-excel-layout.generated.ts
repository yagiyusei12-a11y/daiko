/**
 * 自動生成: `python scripts/extract_jommu_excel_spec.py`
 * 元ファイル: zyoumukiroku.xlsx
 * ヘッダー地色・列幅比率・フォントサイズは Excel から解決した値。
 */
export const JOMMU_EXCEL_SOURCE_FILE = "zyoumukiroku.xlsx";

/** 乗務記録ヘッダー帯（A6 塗りつぶしの解決色） */
export const JOMMU_EXCEL_HEADER_FILL = "#FBE5D6";

/** タイトル「乗 務 記 録 簿」行のフォント */
export const JOMMU_EXCEL_TITLE_FONT_FAMILY = "ＭＳ Ｐ明朝, MS PMincho, Noto Serif CJK JP, Yu Mincho, serif";
export const JOMMU_EXCEL_TITLE_FONT_PT = 20.0 as const;

/** 保存期間（右上） */
export const JOMMU_EXCEL_RETENTION_FONT_PT = 10.0 as const;

/** 明細ヘッダー・本文の基準 */
export const JOMMU_EXCEL_BODY_FONT_PT = 10.0 as const;

/** メイン表 12 列の幅比率（Excel A,B:J,…,BX:CB の合計 px から算出） */
export const JOMMU_EXCEL_TABLE_COL_FRAC = [0.0125, 0.1125, 0.125, 0.1125, 0.0625, 0.1, 0.125, 0.0625, 0.075, 0.075, 0.075, 0.0625] as const;

/** Excel サンプル左罫線スタイル（medium 等） */
export const JOMMU_EXCEL_HEADER_BORDER_LEFT = "medium";
