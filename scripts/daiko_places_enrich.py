#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Google Places API による代行業者 CSV 補完の共通ロジック。"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from dotenv import load_dotenv

TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
DETAIL_FIELDS = "formatted_phone_number,website,rating,user_ratings_total"
REQUEST_INTERVAL_SEC = 1.0

ENRICH_COLUMNS = ["電話番号", "ウェブサイトURL", "評価", "レビュー数"]

ADDRESS_COLUMN_CANDIDATES = ("所在地", "主たる営業所の所在地")
NAME_COLUMN_CANDIDATES = ("業者名",)
PREFECTURE_COLUMN_CANDIDATES = ("都道府県", "県名", "prefecture")

# CSV ファイル名（拡張子除く）→ 検索クエリ用の都道府県ラベル
PREFECTURE_BY_STEM: dict[str, str] = {
    "hokkaido": "北海道",
    "aomori": "青森県",
    "iwate": "岩手県",
    "miyagi": "宮城県",
    "akita": "秋田県",
    "yamagata": "山形県",
    "fukushima": "福島県",
    "ibaraki": "茨城県",
    "tochigi": "栃木県",
    "gunma": "群馬県",
    "saitama": "埼玉県",
    "chiba": "千葉県",
    "tokyo": "東京都",
    "kanagawa": "神奈川県",
    "niigata": "新潟県",
    "toyama": "富山県",
    "ishikawa": "石川県",
    "fukui": "福井県",
    "yamanashi": "山梨県",
    "nagano": "長野県",
    "gifu": "岐阜県",
    "shizuoka": "静岡県",
    "aichi": "愛知県",
    "mie": "三重県",
    "shiga": "滋賀県",
    "kyoto": "京都府",
    "osaka": "大阪府",
    "hyogo": "兵庫県",
    "nara": "奈良県",
    "wakayama": "和歌山県",
    "tottori": "鳥取県",
    "shimane": "島根県",
    "okayama": "岡山県",
    "hiroshima": "広島県",
    "yamaguchi": "山口県",
    "tokushima": "徳島県",
    "kagawa": "香川県",
    "ehime": "愛媛県",
    "kochi": "高知県",
    "fukuoka": "福岡県",
    "saga": "佐賀県",
    "nagasaki": "長崎県",
    "kumamoto": "熊本県",
    "oita": "大分県",
    "miyazaki": "宮崎県",
    "kagoshima": "鹿児島県",
    "okinawa": "沖縄県",
}


def project_root_from_scripts() -> Path:
    return Path(__file__).resolve().parents[1]


def ensure_enriched_dir(root: Path | None = None) -> Path:
    base = root or project_root_from_scripts()
    enriched_dir = base / "data" / "3_enriched_csv"
    enriched_dir.mkdir(parents=True, exist_ok=True)
    return enriched_dir


def load_project_env() -> Path:
    project_root = project_root_from_scripts()
    load_dotenv(project_root / ".env")
    return project_root


def resolve_api_key() -> str:
    import sys

    project_root = load_project_env()
    key = os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()
    if not key:
        print(
            "エラー: Google Places API キーが設定されていません。\n"
            f"  {project_root / '.env'} に GOOGLE_PLACES_API_KEY を設定してください。",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def cell_str(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    if text.lower() in ("nan", "none"):
        return ""
    return text


def pick_column(df: pd.DataFrame, candidates: tuple[str, ...]) -> str | None:
    for name in candidates:
        if name in df.columns:
            return name
    return None


def prefecture_for_csv(csv_path: Path, row: pd.Series | None = None) -> str:
    if row is not None:
        for col in PREFECTURE_COLUMN_CANDIDATES:
            if col in row.index:
                label = cell_str(row.get(col))
                if label:
                    return label
    return PREFECTURE_BY_STEM.get(csv_path.stem.lower(), "")


def build_search_query(
    row: pd.Series,
    *,
    address_col: str,
    name_col: str,
    prefecture: str = "",
) -> str:
    address = cell_str(row.get(address_col))
    name = cell_str(row.get(name_col))
    parts: list[str] = []
    if prefecture and prefecture not in address:
        parts.append(prefecture)
    if address:
        parts.append(address)
    if name:
        parts.append(name)
    return " ".join(parts)


def empty_enrichment() -> dict[str, str]:
    return {col: "" for col in ENRICH_COLUMNS}


def places_get(url: str, params: dict[str, str], api_key: str) -> dict[str, Any]:
    params = {**params, "key": api_key}
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    time.sleep(REQUEST_INTERVAL_SEC)
    return response.json()


def text_search_place_id(query: str, api_key: str) -> str | None:
    payload = places_get(TEXT_SEARCH_URL, {"query": query}, api_key)
    status = payload.get("status", "")

    if status == "OK":
        results = payload.get("results") or []
        if results:
            return results[0].get("place_id")
        return None

    if status in ("ZERO_RESULTS", "INVALID_REQUEST"):
        return None

    if status in ("OVER_QUERY_LIMIT", "REQUEST_DENIED", "UNKNOWN_ERROR"):
        message = payload.get("error_message", status)
        raise RuntimeError(f"Places Text Search エラー: {status} — {message}")

    return None


def fetch_place_details(place_id: str, api_key: str) -> dict[str, str]:
    payload = places_get(
        DETAILS_URL,
        {"place_id": place_id, "fields": DETAIL_FIELDS, "language": "ja"},
        api_key,
    )
    status = payload.get("status", "")

    if status != "OK":
        if status in ("OVER_QUERY_LIMIT", "REQUEST_DENIED", "UNKNOWN_ERROR"):
            message = payload.get("error_message", status)
            raise RuntimeError(f"Places Details エラー: {status} — {message}")
        return empty_enrichment()

    result = payload.get("result") or {}
    phone = result.get("formatted_phone_number") or ""
    website = result.get("website") or ""
    rating = result.get("rating")
    reviews = result.get("user_ratings_total")

    return {
        "電話番号": str(phone) if phone else "",
        "ウェブサイトURL": str(website) if website else "",
        "評価": "" if rating is None else str(rating),
        "レビュー数": "" if reviews is None else str(int(reviews)),
    }


def enrich_row(
    row: pd.Series,
    api_key: str,
    *,
    address_col: str,
    name_col: str,
    prefecture: str,
) -> dict[str, str]:
    query = build_search_query(
        row, address_col=address_col, name_col=name_col, prefecture=prefecture
    )
    if not query.strip():
        return empty_enrichment()

    try:
        place_id = text_search_place_id(query, api_key)
        if not place_id:
            return empty_enrichment()
        return fetch_place_details(place_id, api_key)
    except requests.RequestException as exc:
        print(f"  警告: ネットワークエラー（スキップ）: {exc}", file=sys.stderr)
        return empty_enrichment()


def meta_path_for(output_csv: Path) -> Path:
    return output_csv.with_suffix(output_csv.suffix + ".meta.json")


def load_meta(meta_path: Path) -> dict[str, Any] | None:
    if not meta_path.is_file():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save_meta(meta_path: Path, data: dict[str, Any]) -> None:
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def input_signature(csv_path: Path, row_count: int) -> dict[str, Any]:
    stat = csv_path.stat()
    return {
        "source_csv": csv_path.name,
        "source_mtime": stat.st_mtime,
        "source_size": stat.st_size,
        "rows_total": row_count,
    }


def is_file_fully_enriched(
    input_path: Path,
    output_path: Path,
    meta_path: Path,
    row_count: int,
) -> bool:
    """後方互換。実際の判定は is_enrichment_complete を優先する。"""
    if not output_path.is_file():
        return False
    meta = load_meta(meta_path)
    if meta and meta.get("complete"):
        sig = input_signature(input_path, row_count)
        if (
            meta.get("source_mtime") == sig["source_mtime"]
            and meta.get("source_size") == sig["source_size"]
            and meta.get("rows_total") == row_count
        ):
            return True
    return False


def prepare_output_frame(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in ENRICH_COLUMNS:
        if col not in out.columns:
            out[col] = ""
        else:
            out[col] = out[col].fillna("").astype(str)
    return out


def completed_cert_set(meta: dict[str, Any] | None) -> set[str]:
    if not meta:
        return set()
    certs = meta.get("completed_certs")
    if isinstance(certs, list):
        return {str(c) for c in certs}
    return set()


def cert_key(row: pd.Series, cert_col: str | None) -> str:
    if cert_col:
        return cell_str(row.get(cert_col))
    return str(row.name)


def row_has_enrichment_data(row: pd.Series) -> bool:
    """Places API で一度でも値が入った行（空欄のみの再取得を防ぐ）。"""
    for col in ENRICH_COLUMNS:
        if cell_str(row.get(col)):
            return True
    return False


def count_pending_rows(out_df: pd.DataFrame) -> int:
    pending = 0
    for _, row in out_df.iterrows():
        if not row_has_enrichment_data(row):
            pending += 1
    return pending


def enriched_cert_keys(out_df: pd.DataFrame, cert_col: str | None) -> set[str]:
    keys: set[str] = set()
    for idx, row in out_df.iterrows():
        if not row_has_enrichment_data(row):
            continue
        cert = cert_key(row, cert_col)
        keys.add(cert if cert else f"__row_{idx}")
    return keys


def is_enrichment_complete(out_df: pd.DataFrame) -> bool:
    """出力 CSV の全行に enrich 列のいずれかが入っているか。"""
    if out_df.empty:
        return False
    return count_pending_rows(out_df) == 0


def merge_input_with_enriched_output(
    input_df: pd.DataFrame,
    output_path: Path,
    cert_col: str | None,
) -> pd.DataFrame:
    """入力をベースに、既存 enriched CSV の enrich 列を認定番号でマージする。"""
    out = prepare_output_frame(input_df)
    if not output_path.is_file():
        return out

    try:
        saved = pd.read_csv(output_path, encoding="utf-8-sig", dtype=str).fillna("")
    except OSError:
        return out

    if cert_col and cert_col in saved.columns and cert_col in out.columns:
        for idx, row in out.iterrows():
            cert = cert_key(row, cert_col)
            if not cert:
                continue
            matches = saved[saved[cert_col].astype(str).str.strip() == cert]
            if matches.empty:
                continue
            saved_row = matches.iloc[0]
            for col in ENRICH_COLUMNS:
                if col in saved_row.index:
                    out.at[idx, col] = cell_str(saved_row.get(col))
        return out

    if len(saved) == len(out):
        for col in ENRICH_COLUMNS:
            if col in saved.columns:
                out[col] = saved[col].astype(str).values

    return out


def read_base_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig", dtype=str).fillna("")
    return df
