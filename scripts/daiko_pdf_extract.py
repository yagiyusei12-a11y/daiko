#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
運転代行業者一覧 PDF から表データを抽出する共通ロジック。

都道府県ごとにヘッダー表記が異なる場合でも、ヘッダー行の検出と列インデックスの
再マッピングで対応します。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import pandas as pd
import pdfplumber

# ヘッダー候補（完全一致）
CERT_HEADER_ALIASES = frozenset({"認定番号", "認定の番号"})
NAME_HEADER_ALIASES = frozenset(
    {
        "主たる営業所名",
        "業者名",
        "事業所名",
        "名称",
        "商号又は名称",
        "営業所の名称",
        "運転代行名",
        "代行業者名",
    }
)
ADDRESS_HEADER_ALIASES = frozenset(
    {
        "主たる営業所の所在地",
        "所在地",
        "住所",
        "主たる営業所所在地",
        "営業所の所在地",
        "営業の拠点",
    }
)
# 認定番号列と誤認しやすい列（データ行判定の除外用）
NON_CERT_HEADER_ALIASES = frozenset({"連番", "番号"})

# 従来の滋賀県 PDF 3 列セット（後方互換）
LEGACY_HEADER_MARKERS = frozenset(
    {"認定番号", "主たる営業所名", "主たる営業所の所在地"}
)

DEFAULT_OUTPUT_COLUMNS = ("認定番号", "業者名", "所在地")

SHIGA_OUTPUT_COLUMNS = (
    "認定番号",
    "業者名",
    "代表者名",
    "主たる営業所の所在地",
)

CERT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^第[０-９0-9]+号$"),
    re.compile(r"^[第]?[０-９0-9]+号$"),
    # 岐阜・愛知・福井など（認定番号が「199」「2」のみの形式）
    re.compile(r"^[０-９0-9]{1,4}$"),
)


@dataclass
class ColumnMap:
    cert: int = 0
    name: int = 1
    address: int = 2

    def pick(self, cells: list[str], key: str) -> str:
        index = getattr(self, key)
        if index >= len(cells):
            return ""
        return normalize_cell(cells[index])


def project_root_from_scripts() -> Path:
    return Path(__file__).resolve().parents[1]


def ensure_data_dirs(root: Path | None = None) -> tuple[Path, Path]:
    """data/1_raw_pdf と data/2_base_csv を用意する。"""
    base = root or project_root_from_scripts()
    raw_dir = base / "data" / "1_raw_pdf"
    csv_dir = base / "data" / "2_base_csv"
    raw_dir.mkdir(parents=True, exist_ok=True)
    csv_dir.mkdir(parents=True, exist_ok=True)
    return raw_dir, csv_dir


def normalize_cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").strip()
    return re.sub(r"\s+", " ", text)


def normalize_header_label(value: str) -> str:
    return normalize_cell(value).replace(" ", "")


def cell_matches_aliases(cell: str, aliases: frozenset[str]) -> bool:
    normalized = normalize_header_label(cell)
    if normalized in aliases:
        return True
    if normalized in NON_CERT_HEADER_ALIASES:
        return False
    return any(alias in normalized for alias in aliases if len(alias) >= 2)


def parse_header_map(cells: list[str]) -> ColumnMap | None:
    cert_idx: int | None = None
    name_idx: int | None = None
    address_idx: int | None = None

    for i, raw in enumerate(cells):
        cell = normalize_cell(raw)
        if not cell:
            continue
        normalized = normalize_header_label(cell)
        if normalized in NON_CERT_HEADER_ALIASES:
            continue
        if cell_matches_aliases(cell, CERT_HEADER_ALIASES):
            cert_idx = i
        elif cell_matches_aliases(cell, NAME_HEADER_ALIASES):
            name_idx = i
        elif cell_matches_aliases(cell, ADDRESS_HEADER_ALIASES):
            address_idx = i

    if cert_idx is not None and name_idx is not None and address_idx is not None:
        return ColumnMap(cert=cert_idx, name=name_idx, address=address_idx)

    first_three = {normalize_cell(c) for c in cells[:3]}
    if LEGACY_HEADER_MARKERS.issubset(first_three):
        return ColumnMap(0, 1, 2)
    if normalize_cell(cells[0]) == "認定番号" and len(cells) >= 3:
        return ColumnMap(0, 1, 2)

    return None


def is_header_row(cells: list[str]) -> bool:
    return parse_header_map(cells) is not None


def matches_cert_number(value: str) -> bool:
    if not value:
        return False
    return any(pattern.match(value) for pattern in CERT_PATTERNS)


def is_data_row(cells: list[str], col_map: ColumnMap) -> bool:
    cert = col_map.pick(cells, "cert")
    name = col_map.pick(cells, "name")
    address = col_map.pick(cells, "address")
    if not cert or not name or not address:
        return False
    if is_header_row(cells):
        return False
    if normalize_header_label(cert) in NON_CERT_HEADER_ALIASES:
        return False
    if normalize_header_label(name) in NAME_HEADER_ALIASES | ADDRESS_HEADER_ALIASES:
        return False
    if not matches_cert_number(cert):
        return False
    # 所在地・名称が日付だけの行（福井 PDF の認定年月日列など）を除外
    if re.fullmatch(r"[平成令和昭和０-９0-9年月日\s]+", address):
        return False
    return True


def row_from_cells(cells: list[str], col_map: ColumnMap) -> dict[str, str]:
    return {
        "認定番号": col_map.pick(cells, "cert"),
        "業者名": col_map.pick(cells, "name"),
        "所在地": col_map.pick(cells, "address"),
    }


def extract_rows_from_pdf(pdf_path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    col_map = ColumnMap()

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if not tables:
                continue
            for table in tables:
                for raw in table:
                    cells = [normalize_cell(c) for c in (raw or [])]
                    if not any(cells):
                        continue

                    header_map = parse_header_map(cells)
                    if header_map is not None:
                        col_map = header_map
                        continue

                    if not is_data_row(cells, col_map):
                        continue

                    rows.append(row_from_cells(cells, col_map))

    return rows


def dedupe_rows(
    rows: list[dict[str, str]], *, key: str = "認定番号"
) -> list[dict[str, str]]:
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for row in rows:
        cert = row.get(key, "").strip()
        if not cert or cert in seen:
            continue
        seen.add(cert)
        unique.append(row)
    return unique


def rows_to_dataframe(
    rows: list[dict[str, str]],
    *,
    columns: Sequence[str] = DEFAULT_OUTPUT_COLUMNS,
    include_representative: bool = False,
) -> pd.DataFrame:
    records: list[dict[str, str]] = []
    for row in rows:
        if include_representative:
            records.append(
                {
                    "認定番号": row.get("認定番号", ""),
                    "業者名": row.get("業者名", ""),
                    "代表者名": "",
                    "主たる営業所の所在地": row.get("所在地", ""),
                }
            )
        else:
            records.append(
                {
                    "認定番号": row.get("認定番号", ""),
                    "業者名": row.get("業者名", ""),
                    "所在地": row.get("所在地", ""),
                }
            )

    col_list = list(SHIGA_OUTPUT_COLUMNS if include_representative else columns)
    df = pd.DataFrame(records, columns=col_list)
    return df.drop_duplicates(subset=["認定番号"], keep="first").reset_index(drop=True)


def extract_pdf_to_dataframe(
    pdf_path: Path,
    *,
    columns: Sequence[str] = DEFAULT_OUTPUT_COLUMNS,
    include_representative: bool = False,
) -> pd.DataFrame:
    rows = dedupe_rows(extract_rows_from_pdf(pdf_path))
    return rows_to_dataframe(
        rows, columns=columns, include_representative=include_representative
    )


def save_dataframe_csv(df: pd.DataFrame, csv_path: Path) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(csv_path, index=False, encoding="utf-8-sig")


def iter_pdf_files(raw_dir: Path) -> Iterable[Path]:
    return sorted(p for p in raw_dir.glob("*.pdf") if p.is_file())
