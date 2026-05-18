#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/2_base_csv/ 内の県別 CSV を Google Places API で補完し、
data/3_enriched_csv/ に一括出力する。

使い方:
  1. .env に GOOGLE_PLACES_API_KEY を設定
  2. python scripts/enrich_all_data.py
  3. python scripts/enrich_all_data.py --file shiga.csv --limit 50

再実行時:
  出力先 CSV に電話番号等が既にある行は API を呼ばずスキップします（meta.json 不要）。

依存:
  pip install pandas requests python-dotenv
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from daiko_places_enrich import (
    ADDRESS_COLUMN_CANDIDATES,
    NAME_COLUMN_CANDIDATES,
    build_search_query,
    cell_str,
    cert_key,
    completed_cert_set,
    count_pending_rows,
    enrich_row,
    ensure_enriched_dir,
    enriched_cert_keys,
    input_signature,
    is_enrichment_complete,
    load_meta,
    merge_input_with_enriched_output,
    meta_path_for,
    pick_column,
    prefecture_for_csv,
    project_root_from_scripts,
    read_base_csv,
    resolve_api_key,
    row_has_enrichment_data,
    save_meta,
)


def should_skip_row(
    out_row: object,
    row_key: str,
    attempted_keys: set[str],
) -> bool:
    """enrich 列に値がある行、または同一入力で API 済みの行はスキップ。"""
    if row_has_enrichment_data(out_row):  # type: ignore[arg-type]
        return True
    return row_key in attempted_keys


def load_attempted_keys(
    meta_path: Path,
    sig: dict[str, object],
    out_df: object,
    cert_col: str | None,
) -> set[str]:
    keys = enriched_cert_keys(out_df, cert_col)  # type: ignore[arg-type]
    meta = load_meta(meta_path)
    if meta and meta.get("source_mtime") == sig.get("source_mtime"):
        keys |= completed_cert_set(meta)
    return keys


def list_base_csv_files(base_dir: Path, file_filter: str | None) -> list[Path]:
    if file_filter:
        name = file_filter if file_filter.lower().endswith(".csv") else f"{file_filter}.csv"
        path = base_dir / name
        return [path] if path.is_file() else []
    return sorted(p for p in base_dir.glob("*.csv") if p.is_file())


def enrich_one_file(
    input_path: Path,
    output_path: Path,
    api_key: str,
    *,
    global_remaining: list[int | None],
) -> int:
    """1 ファイルを処理。API 呼び出し件数（概算）を返す。"""
    df = read_base_csv(input_path)
    if df.empty:
        print(f"  スキップ: {input_path.name}（データ行なし）")
        return 0

    address_col = pick_column(df, ADDRESS_COLUMN_CANDIDATES)
    name_col = pick_column(df, NAME_COLUMN_CANDIDATES)
    if not address_col or not name_col:
        print(
            f"  エラー: {input_path.name} に必要な列がありません"
            f"（{', '.join(ADDRESS_COLUMN_CANDIDATES)} / 業者名）",
            file=sys.stderr,
        )
        return 0

    cert_col = "認定番号" if "認定番号" in df.columns else None
    meta_path = meta_path_for(output_path)
    row_count = len(df)

    out = merge_input_with_enriched_output(df, output_path, cert_col)
    pending = count_pending_rows(out)
    already_done = row_count - pending

    if output_path.is_file() and pending == 0:
        print(
            f"  スキップ: {output_path.name}（全 {row_count} 行とも enrich 済み・API 呼び出しなし）"
        )
        sig = input_signature(input_path, row_count)
        save_meta(
            meta_path,
            {
                **sig,
                "complete": True,
                "rows_completed": row_count,
                "completed_certs": sorted(enriched_cert_keys(out, cert_col)),
                "skipped_by_existing_csv": True,
            },
        )
        return 0

    if output_path.is_file() and already_done > 0:
        print(
            f"  再開: {output_path.name}（既存 {already_done} 行はスキップ / 未処理 {pending} 行）"
        )

    prefecture_default = prefecture_for_csv(input_path)
    api_calls = 0
    processed_this_run = 0
    skipped_this_run = 0
    sig = input_signature(input_path, row_count)
    attempted_keys = load_attempted_keys(meta_path, sig, out, cert_col)

    print(f"\n=== {input_path.name} → {output_path.name}（{row_count} 件）===")
    if prefecture_default:
        print(f"  都道府県プレフィックス: {prefecture_default}")
    if pending > 0:
        sample = df.iloc[0]
        sample_pref = prefecture_for_csv(input_path, sample)
        print(
            f"  検索例: {build_search_query(sample, address_col=address_col, name_col=name_col, prefecture=sample_pref)}"
        )

    for i, (index, row) in enumerate(df.iterrows(), start=1):
        if global_remaining[0] is not None and global_remaining[0] <= 0:
            print("  --limit に達したため処理を中断します。")
            break

        cert = cert_key(row, cert_col)
        row_key = cert if cert else f"__row_{index}"
        out_row = out.loc[index]

        if should_skip_row(out_row, row_key, attempted_keys):
            skipped_this_run += 1
            continue

        pref = prefecture_for_csv(input_path, row) or prefecture_default
        name = cell_str(row.get(name_col))
        print(f"  [{i}/{row_count}] {cert or '-'} {name} …", flush=True)

        enriched = enrich_row(
            row,
            api_key,
            address_col=address_col,
            name_col=name_col,
            prefecture=pref,
        )
        api_calls += 2
        processed_this_run += 1

        if global_remaining[0] is not None:
            global_remaining[0] -= 1

        for col, value in enriched.items():
            out.at[index, col] = value

        attempted_keys.add(row_key)

        partial_meta = {
            **sig,
            "complete": is_enrichment_complete(out),
            "rows_completed": row_count - count_pending_rows(out),
            "pending_rows": count_pending_rows(out),
            "completed_certs": sorted(k for k in attempted_keys if not k.startswith("__row_")),
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        out.to_csv(output_path, index=False, encoding="utf-8-sig")
        save_meta(meta_path, partial_meta)

    final_pending = count_pending_rows(out)
    final_meta = {
        **sig,
        "complete": final_pending == 0,
        "rows_completed": row_count - final_pending,
        "pending_rows": final_pending,
        "completed_certs": sorted(k for k in attempted_keys if not k.startswith("__row_")),
    }
    save_meta(meta_path, final_meta)

    filled_phone = (out["電話番号"].astype(str).str.strip() != "").sum()
    status = "完了" if final_pending == 0 else "途中保存（再実行で未処理行のみ続行）"
    print(
        f"  → {status}: 電話番号 {filled_phone}/{row_count} 件 / "
        f"今回スキップ {skipped_this_run} 行 / API 対象 {processed_this_run} 行"
    )
    return api_calls


def main(argv: list[str] | None = None) -> int:
    project_root = project_root_from_scripts()
    base_dir = project_root / "data" / "2_base_csv"
    enriched_dir = ensure_enriched_dir(project_root)

    parser = argparse.ArgumentParser(
        description="県別 CSV を Google Places API で一括補完します。"
    )
    parser.add_argument(
        "--file",
        type=str,
        default=None,
        help="処理する CSV のみ指定（例: shiga.csv または shiga）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="今回の実行で API 処理する最大行数（全ファイル合計）",
    )
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=base_dir,
        help="入力 CSV フォルダ（既定: data/2_base_csv）",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=enriched_dir,
        help="出力フォルダ（既定: data/3_enriched_csv）",
    )
    args = parser.parse_args(argv)

    if not args.base_dir.is_dir():
        print(f"エラー: 入力フォルダがありません: {args.base_dir}", file=sys.stderr)
        return 1

    csv_files = list_base_csv_files(args.base_dir, args.file)
    if not csv_files:
        if args.file:
            print(f"エラー: ファイルが見つかりません: {args.file}", file=sys.stderr)
        else:
            print(f"エラー: CSV がありません: {args.base_dir}", file=sys.stderr)
        return 1

    api_key = resolve_api_key()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"入力: {args.base_dir}（{len(csv_files)} ファイル）")
    print(f"出力: {args.output_dir}")
    print("既存 enriched CSV にデータがある行は API をスキップします。")
    if args.limit is not None:
        print(f"上限: 今回最大 {args.limit} 行まで API 処理")

    global_remaining: list[int | None] = [args.limit]
    total_api = 0

    for input_path in csv_files:
        output_path = args.output_dir / input_path.name
        total_api += enrich_one_file(
            input_path,
            output_path,
            api_key,
            global_remaining=global_remaining,
        )
        if global_remaining[0] is not None and global_remaining[0] <= 0:
            break

    print(f"\n処理終了（概算 API リクエスト: 約 {total_api} 回）")
    if global_remaining[0] is not None and global_remaining[0] <= 0:
        print("  --limit に達しました。続きは同じコマンドを再実行してください（未処理行のみ API します）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
