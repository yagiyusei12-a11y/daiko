#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
滋賀県の自動車運転代行業認定業者一覧 PDF から表を抽出し CSV に保存する。

共通ロジックは scripts/daiko_pdf_extract.py を使用。
全国展開用の一括処理は scripts/extract_all_pdf.py を参照。

使い方:
  python scripts/extract_shiga_daiko_list.py
  python scripts/extract_shiga_daiko_list.py path/to/shiga.pdf path/to/output.csv

推奨配置:
  PDF: data/1_raw_pdf/shiga.pdf
  CSV: data/2_base_csv/shiga.csv

依存:
  pip install pdfplumber pandas
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from daiko_pdf_extract import (
    ensure_data_dirs,
    extract_pdf_to_dataframe,
    project_root_from_scripts,
    save_dataframe_csv,
)


def find_default_pdf(project_root: Path) -> Path | None:
    raw_dir, _ = ensure_data_dirs(project_root)
    candidates = [
        raw_dir / "shiga.pdf",
        project_root / "data" / "1_raw_pdf" / "shiga.pdf",
    ]
    for path in candidates:
        if path.is_file():
            return path

    # 後方互換: 旧配置・旧ファイル名
    legacy = [
        project_root / "5592765.pdf",
        *project_root.rglob("5592765.pdf"),
    ]
    for path in legacy:
        if path.is_file():
            return path
    return None


def main(argv: list[str] | None = None) -> int:
    project_root = project_root_from_scripts()
    _, csv_dir = ensure_data_dirs(project_root)

    parser = argparse.ArgumentParser(
        description="滋賀県・運転代行業者一覧 PDF から CSV を生成します。"
    )
    parser.add_argument(
        "pdf",
        nargs="?",
        type=Path,
        default=None,
        help="入力 PDF（省略時: data/1_raw_pdf/shiga.pdf 等を検索）",
    )
    parser.add_argument(
        "csv",
        nargs="?",
        type=Path,
        default=csv_dir / "shiga.csv",
        help="出力 CSV（既定: data/2_base_csv/shiga.csv）",
    )
    args = parser.parse_args(argv)

    pdf_path = args.pdf or find_default_pdf(project_root)
    if pdf_path is None or not pdf_path.is_file():
        print(
            "エラー: PDF が見つかりません。\n"
            "  data/1_raw_pdf/shiga.pdf を配置するか、引数でパスを指定してください。",
            file=sys.stderr,
        )
        return 1

    df = extract_pdf_to_dataframe(pdf_path, include_representative=True)
    if df.empty:
        print("エラー: 表からデータ行を抽出できませんでした。", file=sys.stderr)
        return 1

    out_path: Path = args.csv
    save_dataframe_csv(df, out_path)

    print(f"入力: {pdf_path}")
    print(f"出力: {out_path}（{len(df)} 件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
