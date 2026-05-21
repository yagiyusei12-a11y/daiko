# -*- coding: utf-8 -*-
"""ポータル HTML 生成用: 47都道府県定義・CSV/MySQL マージ・DB接続設定読み込み。"""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import quote

# JIS X 0401 都道府県コード順
ALL_PREFECTURES: tuple[str, ...] = (
    "北海道",
    "青森県",
    "岩手県",
    "宮城県",
    "秋田県",
    "山形県",
    "福島県",
    "茨城県",
    "栃木県",
    "群馬県",
    "埼玉県",
    "千葉県",
    "東京都",
    "神奈川県",
    "新潟県",
    "富山県",
    "石川県",
    "福井県",
    "山梨県",
    "長野県",
    "岐阜県",
    "静岡県",
    "愛知県",
    "三重県",
    "滋賀県",
    "京都府",
    "大阪府",
    "兵庫県",
    "奈良県",
    "和歌山県",
    "鳥取県",
    "島根県",
    "岡山県",
    "広島県",
    "山口県",
    "徳島県",
    "香川県",
    "愛媛県",
    "高知県",
    "福岡県",
    "佐賀県",
    "長崎県",
    "熊本県",
    "大分県",
    "宮崎県",
    "鹿児島県",
    "沖縄県",
)

# 既存本番 URL との互換（再生成でスラッグが変わらないよう固定）
PREF_SLUG_OVERRIDES: dict[str, str] = {
    "北海道": "hokkaido",
    "京都府": "kyouto",
    "大阪府": "oosaka",
    "兵庫県": "hyougo",
    "愛知県": "aichi",
    "岐阜県": "gifu",
    "三重県": "mie",
    "滋賀県": "shiga",
    "福井県": "fukui",
    "石川県": "ishikawa",
    "富山県": "toyama",
    "新潟県": "niigata",
    "長野県": "nagano",
    "山梨県": "yamanashi",
    "静岡県": "shizuoka",
    "奈良県": "nara",
    "和歌山県": "wakayama",
    "東京都": "tokyo",
    "鹿児島県": "kagoshima",
    "徳島県": "tokushima",
    "福岡県": "fukuoka",
    "沖縄県": "okinawa",
}


def normalize_unicode(text: str) -> str:
    return unicodedata.normalize("NFKC", (text or "").strip())


def normalize_prefecture_base(prefecture: str) -> str:
    s = normalize_unicode(prefecture).replace(" ", "").replace("\u3000", "")
    return re.sub(r"(都|道|府|県)$", "", s)


def extract_cert_number(cert: str) -> int | None:
    s = normalize_unicode(cert)
    if not s:
        return None
    matches = re.findall(r"\d+", s)
    if not matches:
        return None
    try:
        return int(matches[-1])
    except ValueError:
        return None


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"[^\d]", "", phone or "")
    if len(digits) >= 10 and digits.startswith("0"):
        return digits
    return digits


def merge_dedupe_key(record: dict[str, str]) -> tuple:
    pref = normalize_prefecture_base(record.get("prefecture", ""))
    cert_num = extract_cert_number(record.get("cert", ""))
    if pref and cert_num is not None:
        return ("cert", pref, cert_num)
    phone = normalize_phone(record.get("phone", ""))
    if phone:
        return ("phone", phone)
    return (
        "name",
        pref,
        normalize_unicode(record.get("name", "")),
        normalize_unicode(record.get("city", "")),
    )


def merge_business_records(
    csv_rows: list[dict[str, str]],
    mysql_rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    """CSV を優先し、MySQL 分は重複キーがなければ追加。"""
    merged: dict[tuple, dict[str, str]] = {}
    for row in csv_rows:
        merged[merge_dedupe_key(row)] = row
    for row in mysql_rows:
        key = merge_dedupe_key(row)
        if key not in merged:
            merged[key] = row
    return list(merged.values())


def load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def parse_php_db_config(config_path: Path) -> dict[str, Any] | None:
    if not config_path.is_file():
        return None
    text = config_path.read_text(encoding="utf-8")

    def pick(key: str, default: Any = None) -> Any:
        m = re.search(
            rf"['\"]{re.escape(key)}['\"]\s*=>\s*['\"]([^'\"]*)['\"]",
            text,
        )
        if m:
            return m.group(1)
        m = re.search(rf"['\"]{re.escape(key)}['\"]\s*=>\s*(\d+)", text)
        if m:
            return int(m.group(1))
        return default

    host = pick("host")
    database = pick("database")
    username = pick("username")
    if not host or not database or not username:
        return None
    return {
        "host": host,
        "port": pick("port", 3306),
        "database": database,
        "username": username,
        "password": pick("password", ""),
        "charset": pick("charset", "utf8mb4"),
    }


def load_portal_db_config(project_root: Path) -> dict[str, Any] | None:
    load_dotenv_file(project_root / ".env")

    env_map = {
        "host": os.environ.get("PORTAL_DB_HOST"),
        "port": os.environ.get("PORTAL_DB_PORT", "3306"),
        "database": os.environ.get("PORTAL_DB_DATABASE"),
        "username": os.environ.get("PORTAL_DB_USERNAME"),
        "password": os.environ.get("PORTAL_DB_PASSWORD", ""),
        "charset": os.environ.get("PORTAL_DB_CHARSET", "utf8mb4"),
    }
    if env_map["host"] and env_map["database"] and env_map["username"]:
        return {
            "host": env_map["host"],
            "port": int(env_map["port"]),
            "database": env_map["database"],
            "username": env_map["username"],
            "password": env_map["password"],
            "charset": env_map["charset"],
        }

    php_cfg = parse_php_db_config(project_root / "portal-member" / "config" / "config.php")
    if php_cfg:
        return php_cfg

    return None


def load_companies_from_mysql(project_root: Path) -> list[dict[str, str]]:
    cfg = load_portal_db_config(project_root)
    if not cfg:
        print("  注意: MySQL 設定なし（portal-member/config/config.php または PORTAL_DB_*）", flush=True)
        return []

    try:
        import pymysql
    except ImportError:
        print(
            "  注意: pymysql 未インストールのため MySQL をスキップします（pip install pymysql）",
            flush=True,
        )
        return []

    records: list[dict[str, str]] = []
    try:
        conn = pymysql.connect(
            host=cfg["host"],
            port=int(cfg.get("port", 3306)),
            user=cfg["username"],
            password=cfg.get("password", ""),
            database=cfg["database"],
            charset=cfg.get("charset", "utf8mb4"),
            cursorclass=pymysql.cursors.DictCursor,
        )
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cert_number, name, tel, website, prefecture, city, address
                FROM companies
                WHERE TRIM(name) <> ''
                  AND TRIM(prefecture) <> ''
                """
            )
            rows = cur.fetchall()
        conn.close()
    except Exception as exc:
        print(f"  警告: MySQL 読み込み失敗 ({exc})", flush=True)
        return []

    for row in rows:
        pref = normalize_unicode(str(row.get("prefecture") or ""))
        if pref not in ALL_PREFECTURES:
            continue
        records.append(
            {
                "prefecture": pref,
                "city": normalize_unicode(str(row.get("city") or "")) or "その他",
                "cert": normalize_unicode(str(row.get("cert_number") or "")),
                "name": normalize_unicode(str(row.get("name") or "")),
                "address": normalize_unicode(str(row.get("address") or "")),
                "phone": normalize_unicode(str(row.get("tel") or "")),
                "website": normalize_unicode(str(row.get("website") or "")),
                "source": "mysql",
            }
        )

    print(f"  MySQL companies: {len(records)} 件", flush=True)
    return records


def register_url_for_prefecture(prefecture: str) -> str:
    return f"/portal-member/register.php?pref={quote(prefecture)}"
