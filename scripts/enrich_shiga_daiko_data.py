#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
滋賀県の代行業者 CSV を Google Places API で補完する（単一ファイル用）。

一括処理は scripts/enrich_all_data.py を使用してください。

使い方:
  1. プロジェクトルートの .env に GOOGLE_PLACES_API_KEY を設定
  2. python scripts/enrich_shiga_daiko_data.py

依存:
  pip install pandas requests python-dotenv
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from daiko_places_enrich import (
    ADDRESS_COLUMN_CANDIDATES,
    build_search_query,
    enrich_row,
    pick_column,
    prepare_output_frame,
    project_root_from_scripts,
    read_base_csv,
    resolve_api_key,
)
def main(argv: list[str] | None = None) -> int:
    project_root = project_root_from_scripts()
    parser = argparse.ArgumentParser(
        description="滋賀県代行業者 CSV を Google Places API で補完します。"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=project_root / "data" / "2_base_csv" / "shiga.csv",
        help="入力 CSV",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "shiga_daiko_enriched.csv",
        help="出力 CSV",
    )
    args = parser.parse_args(argv)

    if not args.input.is_file():
        print(f"エラー: 入力ファイルが見つかりません: {args.input}", file=sys.stderr)
        return 1

    api_key = resolve_api_key()
    df = read_base_csv(args.input)

    address_col = pick_column(df, ADDRESS_COLUMN_CANDIDATES)
    name_col = pick_column(df, ("業者名",))
    if not address_col or not name_col:
        print(
            f"エラー: CSV に必要な列がありません（所在地系 / 業者名）",
            file=sys.stderr,
        )
        return 1

    out = prepare_output_frame(df)
    total = len(out)
    prefecture = "滋賀県"

    print(f"入力: {args.input}（{total} 件）")
    print(
        f"検索例: {build_search_query(out.iloc[0], address_col=address_col, name_col=name_col, prefecture=prefecture)}"
    )
    print("Places API へ問い合わせ中（1 リクエストあたり約 1 秒のウェイト）…\n")

    for i, (index, row) in enumerate(out.iterrows(), start=1):
        cert = str(row.get("認定番号", "")).strip()
        name = str(row.get(name_col, "")).strip()
        print(f"[{i}/{total}] {cert} {name} …", flush=True)
        try:
            enriched = enrich_row(
                row,
                api_key,
                address_col=address_col,
                name_col=name_col,
                prefecture=prefecture,
            )
        except RuntimeError as exc:
            print(f"致命的エラー: {exc}", file=sys.stderr)
            raise

        for col, value in enriched.items():
            out.at[index, col] = value

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.output, index=False, encoding="utf-8-sig")

    filled_phone = (out["電話番号"].astype(str).str.strip() != "").sum()
    print(f"\n出力: {args.output}")
    print(f"電話番号が取得できた件数: {filled_phone} / {len(out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
