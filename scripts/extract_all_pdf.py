#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/1_raw_pdf/ 内の PDF を一括で CSV に変換する。

各 PDF から「認定番号」「業者名」「所在地」を抽出し、
data/2_base_csv/{PDFのファイル名（拡張子除く）}.csv に保存します。

例: data/1_raw_pdf/shiga.pdf → data/2_base_csv/shiga.csv

使い方:
  1. PDF を data/1_raw_pdf/ に配置
  2. python scripts/extract_all_pdf.py

依存:
  pip install pdfplumber pandas
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from daiko_pdf_extract import (
    DEFAULT_OUTPUT_COLUMNS,
    ensure_data_dirs,
    extract_pdf_to_dataframe,
    iter_pdf_files,
    project_root_from_scripts,
    save_dataframe_csv,
)


def main(argv: list[str] | None = None) -> int:
    project_root = project_root_from_scripts()
    parser = argparse.ArgumentParser(
        description="data/1_raw_pdf 内の PDF を一括で CSV に変換します。"
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=None,
        help="PDF 入力フォルダ（既定: data/1_raw_pdf）",
    )
    parser.add_argument(
        "--csv-dir",
        type=Path,
        default=None,
        help="CSV 出力フォルダ（既定: data/2_base_csv）",
    )
    args = parser.parse_args(argv)

    raw_dir, csv_dir = ensure_data_dirs(project_root)
    if args.raw_dir is not None:
        raw_dir = args.raw_dir
        raw_dir.mkdir(parents=True, exist_ok=True)
    if args.csv_dir is not None:
        csv_dir = args.csv_dir
        csv_dir.mkdir(parents=True, exist_ok=True)

    pdfs = list(iter_pdf_files(raw_dir))
    if not pdfs:
        print(f"PDF がありません: {raw_dir}", file=sys.stderr)
        print("  例: data/1_raw_pdf/shiga.pdf を配置してください。", file=sys.stderr)
        return 1

    print(f"入力: {raw_dir}（{len(pdfs)} 件の PDF）")
    print(f"出力: {csv_dir}\n")

    failed = 0
    for pdf_path in pdfs:
        out_csv = csv_dir / f"{pdf_path.stem}.csv"
        try:
            df = extract_pdf_to_dataframe(pdf_path, columns=DEFAULT_OUTPUT_COLUMNS)
        except Exception as exc:  # noqa: BLE001 — バッチ処理は継続
            print(f"  ✗ {pdf_path.name}: 読み取り失敗 ({exc})", file=sys.stderr)
            failed += 1
            continue

        if df.empty:
            print(f"  ✗ {pdf_path.name}: データ行なし（スキップ）", file=sys.stderr)
            failed += 1
            continue

        save_dataframe_csv(df, out_csv)
        print(f"  ✓ {pdf_path.name} → {out_csv.name}（{len(df)} 件）")

    print()
    if failed:
        print(f"完了: {len(pdfs) - failed} 件成功 / {failed} 件失敗")
        return 1

    print(f"完了: 全 {len(pdfs)} 件を変換しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
