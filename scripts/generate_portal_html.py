#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/3_enriched_csv/ 内の県別 CSV を統合し、ポータル用静的 HTML を 3 階層で生成する。

使い方:
  pip install pandas pykakasi
  python scripts/generate_portal_html.py

出力:
  - public/portal/index.html（全国トップ）
  - public/portal/{pref_slug}/index.html（都道府県トップ）
  - public/portal/{pref_slug}/{city_slug}/index.html（市町村トップ）
  - public/portal/portal-data.json（全国データ・参照用）
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from pathlib import Path

import pandas as pd

from daiko_places_enrich import PREFECTURE_BY_STEM

SITE_URL = "https://daiko.harunoyukoto.jp/"
PORTAL_BASE = "/portal/"
PORTAL_DATA_URL = "/portal/portal-data.json"
PORTAL_CSS_URL = "/portal/portal.css"
LIVE_API_URL = "/portal-member/api/get_live_info.php"
MEMBER_REGISTER_URL = "/portal-member/register.php"
MEMBER_LOGIN_URL = "/portal-member/login.php"

NATIONAL_TITLE = "【2026年最新】全国の運転代行一覧｜料金・すぐ呼べる代行検索"
NATIONAL_DESCRIPTION = (
    "全国の運転代行業者を都道府県・市区町村から探せる一覧ポータル。"
    "料金・電話番号・公式サイトを掲載。すぐ呼べる代行業者を検索できます。"
)

ADDRESS_COLUMNS = ("所在地", "主たる営業所の所在地")
CITY_PATTERN = re.compile(
    r"^(.+?(?:市|区|町|村)|.+?郡.+?(?:町|村))"
)

# 地方区分（掲載がある都道府県のみリンクを出す）
REGION_PREFS: list[tuple[str, list[str]]] = [
    ("北海道", ["北海道"]),
    ("東北", ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"]),
    ("関東", ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"]),
    ("中部", ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"]),
    ("近畿", ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"]),
    ("中国", ["鳥取県", "島根県", "岡山県", "広島県", "山口県"]),
    ("四国", ["徳島県", "香川県", "愛媛県", "高知県"]),
    ("九州・沖縄", ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]),
]

PREF_TO_REGION: dict[str, str] = {}
for region_label, region_pref_list in REGION_PREFS:
    for pref_name in region_pref_list:
        PREF_TO_REGION[pref_name] = region_label

_kakasi_instance = None


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def get_kakasi():
    global _kakasi_instance
    if _kakasi_instance is None:
        try:
            import pykakasi
        except ImportError as exc:
            print(
                "エラー: pykakasi がインストールされていません。\n"
                "  実行前に: pip install pykakasi",
                file=sys.stderr,
            )
            raise SystemExit(1) from exc
        _kakasi_instance = pykakasi.kakasi()
    return _kakasi_instance


def hepburn_roman(text: str) -> str:
    kks = get_kakasi()
    parts: list[str] = []
    for item in kks.convert(text):
        h = (item.get("hepburn") or item.get("passport") or "").strip()
        if h:
            parts.append(h)
    roman = "".join(parts).lower()
    roman = re.sub(r"[^a-z0-9]+", "-", roman).strip("-")
    return roman or "area"


def slug_from_place_name(name: str) -> str:
    s = name.strip()
    s = re.sub(r"(都|道|府|県|市|区|町|村)$", "", s)
    if not s or s == "その他":
        return "sonota"
    return hepburn_roman(s)


class SlugRegistry:
    """都道府県・市区町村ごとに一意の URL スラッグを割り当てる。"""

    def __init__(self) -> None:
        self._pref_used: set[str] = set()
        self._city_used: dict[str, set[str]] = {}

    def pref_slug(self, prefecture: str) -> str:
        base = slug_from_place_name(prefecture)
        slug = base
        n = 2
        while slug in self._pref_used:
            slug = f"{base}-{n}"
            n += 1
        self._pref_used.add(slug)
        return slug

    def city_slug(self, pref_slug: str, city: str) -> str:
        used = self._city_used.setdefault(pref_slug, set())
        base = slug_from_place_name(city)
        slug = base
        n = 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        return slug


def cell_str(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    if text.lower() in ("nan", "none"):
        return ""
    return text


def pick_address_column(df: pd.DataFrame) -> str | None:
    for col in ADDRESS_COLUMNS:
        if col in df.columns:
            return col
    return None


def prefecture_from_filename(csv_path: Path, row: pd.Series | None = None) -> str:
    if row is not None:
        for col in ("都道府県", "県名", "prefecture"):
            if col in row.index:
                label = cell_str(row.get(col))
                if label:
                    return label
    stem = csv_path.stem.lower()
    if stem in PREFECTURE_BY_STEM:
        return PREFECTURE_BY_STEM[stem]
    stem_aliases = {
        "8515_2740104_misc": "岐阜県",
        "daikougyouitirann5matu": "愛知県",
        "daikouitirannintekyoten": "福井県",
        "kyouto": "京都府",
        "oosaka": "大阪府",
        "hyougo": "兵庫県",
    }
    if stem in stem_aliases:
        return stem_aliases[stem]
    return stem


def extract_city(address: str, prefecture: str) -> str:
    addr = address.strip()
    if not addr:
        return "その他"
    if prefecture and addr.startswith(prefecture):
        addr = addr[len(prefecture) :].strip()
    match = CITY_PATTERN.match(addr)
    if match:
        return match.group(1)
    return addr if addr else "その他"


def load_all_businesses(enriched_dir: Path) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    csv_files = sorted(enriched_dir.glob("*.csv"))
    if not csv_files:
        return records

    for csv_path in csv_files:
        if csv_path.name.endswith(".meta.json"):
            continue
        df = pd.read_csv(csv_path, encoding="utf-8-sig", dtype=str).fillna("")
        if "業者名" not in df.columns:
            print(f"  警告: スキップ（業者名なし）: {csv_path.name}", file=sys.stderr)
            continue

        address_col = pick_address_column(df)
        if not address_col:
            print(f"  警告: スキップ（所在地なし）: {csv_path.name}", file=sys.stderr)
            continue

        pref_default = prefecture_from_filename(csv_path)
        for _, row in df.iterrows():
            prefecture = prefecture_from_filename(csv_path, row) or pref_default
            address = cell_str(row.get(address_col))
            records.append(
                {
                    "prefecture": prefecture,
                    "city": extract_city(address, prefecture),
                    "cert": cell_str(row.get("認定番号")),
                    "name": cell_str(row.get("業者名")),
                    "address": address,
                    "phone": cell_str(row.get("電話番号")),
                    "website": cell_str(row.get("ウェブサイトURL")),
                }
            )

    return records


def assign_slugs(records: list[dict[str, str]]) -> SlugRegistry:
    registry = SlugRegistry()
    pref_slug_by_name: dict[str, str] = {}
    for row in records:
        pref = row["prefecture"]
        if pref not in pref_slug_by_name:
            pref_slug_by_name[pref] = registry.pref_slug(pref)
        row["pref_slug"] = pref_slug_by_name[pref]
    for row in records:
        row["city_slug"] = registry.city_slug(row["pref_slug"], row["city"])
    return registry


def build_prefecture_index(records: list[dict[str, str]]) -> dict[str, list[str]]:
    cities_by_pref: dict[str, set[str]] = {}
    for row in records:
        pref = row["prefecture"]
        cities_by_pref.setdefault(pref, set()).add(row["city"])
    return {
        pref: sorted(cities, key=lambda c: (c == "その他", c))
        for pref, cities in sorted(cities_by_pref.items())
    }


def portal_path(pref_slug: str | None = None, city_slug: str | None = None) -> str:
    if not pref_slug:
        return PORTAL_BASE
    if not city_slug:
        return f"{PORTAL_BASE}{pref_slug}/"
    return f"{PORTAL_BASE}{pref_slug}/{city_slug}/"


def canonical_url(pref_slug: str | None = None, city_slug: str | None = None) -> str:
    return SITE_URL.rstrip("/") + portal_path(pref_slug, city_slug)


def tel_href(phone: str) -> str:
    digits = re.sub(r"[^\d+]", "", phone or "")
    return f"tel:{digits}" if digits else ""


def normalize_website(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if re.match(r"^https?://", u, re.I):
        return u
    return f"https://{u}"


def card_article_html(rec: dict[str, str]) -> str:
    cert = html.escape(rec.get("cert") or "")
    name = html.escape(rec.get("name") or "")
    pref = html.escape(rec.get("prefecture") or "")
    city = html.escape(rec.get("city") or "")
    addr = html.escape(rec.get("address") or "")
    phone = rec.get("phone") or ""
    website = normalize_website(rec.get("website") or "")
    cert_raw = html.escape((rec.get("cert") or "").strip())
    pref_raw = html.escape((rec.get("prefecture") or "").strip())

    cert_badge = (
        f'<span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{cert}</span>'
        if cert
        else ""
    )

    call_btn = ""
    if phone:
        href = html.escape(tel_href(phone))
        call_btn = (
            f'<a href="{href}" class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-base font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-[0.98]">'
            '<svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">'
            '<path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>'
            "電話で呼ぶ</a>"
            f'<p class="mt-1 text-center text-xs text-slate-500">{html.escape(phone)}</p>'
        )

    site_link = ""
    if website:
        site_link = (
            f'<a href="{html.escape(website)}" target="_blank" rel="noopener noreferrer" '
            'class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">公式HP</a>'
        )

    return (
        f'<article class="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-shadow hover:shadow-md" '
        f'data-prefecture="{pref_raw}" data-cert="{cert_raw}">'
        f'<div class="flex flex-wrap items-start justify-between gap-2"><h2 class="text-lg font-bold leading-snug text-slate-900">{name}</h2>{cert_badge}</div>'
        f'<p class="mt-1 text-xs font-medium text-brand">{pref} · {city}</p>'
        f'<p class="mt-2 flex items-start gap-1.5 text-sm text-slate-600"><span>{pref} {addr}</span></p>'
        '<div class="portal-live hidden" data-live-slot="1" aria-live="polite" hidden></div>'
        f"{site_link}{call_btn}</article>"
    )


def render_cards_grid(records: list[dict[str, str]]) -> str:
    sorted_recs = sorted(
        records,
        key=lambda r: (r.get("city") or "", r.get("name") or ""),
    )
    cards = "\n".join(card_article_html(r) for r in sorted_recs)
    count = len(sorted_recs)
    return f"""
      <p class="mb-4 text-sm text-slate-600">
        掲載 <strong class="text-slate-900">{count}</strong> 件
      </p>
      <div id="card-grid" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
{cards}
      </div>"""


def render_header(h1: str, subtitle: str = "全国対応") -> str:
    return f"""
    <header class="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div>
          <p class="text-xs font-semibold tracking-wide text-brand">{html.escape(subtitle)}</p>
          <h1 class="text-lg font-bold leading-tight sm:text-xl">
            <a href="{html.escape(PORTAL_BASE)}" class="no-underline text-inherit hover:text-brand">{html.escape(h1)}</a>
          </h1>
        </div>
        <nav class="flex flex-wrap items-center gap-2" aria-label="サイトナビゲーション">
          <a href="{html.escape(MEMBER_REGISTER_URL)}"
             class="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-blue-800">
            業者会員登録
          </a>
          <a href="{html.escape(MEMBER_LOGIN_URL)}"
             class="rounded-xl border border-brand/30 bg-white px-4 py-2 text-sm font-semibold text-brand no-underline shadow-sm hover:bg-blue-50">
            会員ログイン
          </a>
          <a href="{html.escape(SITE_URL)}"
             class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 no-underline shadow-sm hover:border-brand hover:text-brand">
            システムについて
          </a>
        </nav>
      </div>
    </header>"""


def render_breadcrumbs(items: list[tuple[str, str | None]]) -> str:
    """items: (label, href or None for current)"""
    parts: list[str] = []
    for i, (label, href) in enumerate(items):
        if href:
            parts.append(
                f'<a href="{html.escape(href)}" class="text-brand hover:underline">{html.escape(label)}</a>'
            )
        else:
            parts.append(f'<span aria-current="page" class="text-slate-700">{html.escape(label)}</span>')
    inner = ' <span class="text-slate-400">/</span> '.join(parts)
    return f"""
      <nav class="portal-breadcrumb mb-6 text-sm text-slate-500" aria-label="パンくずリスト">
        {inner}
      </nav>"""


def render_cta_block() -> str:
    return f"""
      <section class="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-blue-700 p-6 text-white shadow-lg sm:p-8" aria-labelledby="cta-top">
        <h2 id="cta-top" class="text-base font-bold leading-relaxed sm:text-lg">
          【運転代行業者様へ】配車・売上管理をスマートにする最新システムを導入しませんか？初期費用を抑えて業務を効率化。詳しくはこちら
        </h2>
        <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <a href="{html.escape(MEMBER_REGISTER_URL)}"
             class="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand shadow-md transition hover:bg-blue-50 sm:text-base">
            掲載情報を更新する（無料会員登録）→
          </a>
          <a href="{html.escape(SITE_URL)}"
             class="inline-flex items-center justify-center rounded-xl border border-white/40 bg-white/10 px-6 py-3 text-sm font-bold text-white no-underline transition hover:bg-white/20 sm:text-base">
            Daiko（業務管理システム）を見る →
          </a>
        </div>
      </section>"""


def render_footer() -> str:
    return f"""
    <footer class="mt-12 border-t border-slate-200 bg-white">
      <section class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div class="rounded-2xl border border-blue-100 bg-blue-50 p-6 sm:p-8">
          <p class="text-sm font-semibold leading-relaxed text-slate-800 sm:text-base">
            【運転代行業者様へ】配車・売上管理をスマートにする最新システムを導入しませんか？初期費用を抑えて業務を効率化。詳しくはこちら
          </p>
          <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <a href="{html.escape(MEMBER_REGISTER_URL)}"
               class="inline-flex rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white no-underline shadow-sm hover:bg-blue-800">
              業者会員登録（掲載・リアルタイム情報の更新）
            </a>
            <a href="{html.escape(SITE_URL)}"
               class="inline-flex rounded-xl border border-brand/20 bg-white px-5 py-2.5 text-sm font-bold text-brand no-underline shadow-sm hover:bg-blue-50">
              Daiko 公式サイト
            </a>
          </div>
        </div>
        <p class="mt-8 text-center text-xs text-slate-500">
          掲載情報は Google 等の公開情報をもとに自動収集しています。内容の正確性は各事業者へご確認ください。<br />
          運営: <a href="{html.escape(SITE_URL)}" class="text-brand hover:underline">はるのゆこと / Daiko</a>
          · <a href="{html.escape(MEMBER_REGISTER_URL)}" class="text-brand hover:underline">業者会員登録</a>
          · <a href="{html.escape(MEMBER_LOGIN_URL)}" class="text-brand hover:underline">会員ログイン</a>
        </p>
      </section>
    </footer>"""


def page_shell(
    *,
    title: str,
    description: str,
    canonical: str,
    h1: str,
    main_body: str,
    include_live_js: bool = False,
    subtitle: str = "全国対応",
) -> str:
    live_script = portal_live_listing_js() if include_live_js else ""
    return f"""<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{html.escape(title)}</title>
    <meta name="description" content="{html.escape(description)}" />
    <link rel="canonical" href="{html.escape(canonical)}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:title" content="{html.escape(title)}" />
    <meta property="og:description" content="{html.escape(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{html.escape(canonical)}" />
    <meta property="og:locale" content="ja_JP" />
    <link rel="stylesheet" href="{html.escape(PORTAL_CSS_URL)}" />
  </head>
  <body class="min-h-screen bg-slate-50 text-slate-900 antialiased">
{render_header(h1, subtitle)}
    <main id="main" class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
{main_body}
    </main>
{render_footer()}
{live_script}
  </body>
</html>
"""


def build_national_page(records: list[dict[str, str]]) -> str:
    pref_meta: dict[str, dict[str, object]] = {}
    for row in records:
        pref = row["prefecture"]
        ps = row["pref_slug"]
        if pref not in pref_meta:
            pref_meta[pref] = {
                "name": pref,
                "slug": ps,
                "count": 0,
                "region": PREF_TO_REGION.get(pref, "その他"),
            }
        pref_meta[pref]["count"] = int(pref_meta[pref]["count"]) + 1  # type: ignore[operator]

    region_blocks: list[str] = []
    for region_name, pref_list in REGION_PREFS:
        prefs_in_region = [
            pref_meta[p]
            for p in pref_list
            if p in pref_meta
        ]
        if not prefs_in_region:
            continue
        links = "\n".join(
            f'          <li><a href="{html.escape(portal_path(str(m["slug"])))}" class="portal-pref-link">'
            f'{html.escape(str(m["name"]))} <span class="text-slate-400">（{m["count"]}件）</span></a></li>'
            for m in sorted(prefs_in_region, key=lambda x: str(x["name"]))
        )
        region_blocks.append(
            f"""
      <section class="portal-region-block mb-8 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <h2 class="text-base font-bold text-slate-800">{html.escape(region_name)}</h2>
        <ul class="portal-pref-list mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
{links}
        </ul>
      </section>"""
        )

    other_prefs = [m for p, m in pref_meta.items() if PREF_TO_REGION.get(p) is None]
    if other_prefs:
        links = "\n".join(
            f'          <li><a href="{html.escape(portal_path(str(m["slug"])))}" class="portal-pref-link">'
            f'{html.escape(str(m["name"]))} <span class="text-slate-400">（{m["count"]}件）</span></a></li>'
            for m in sorted(other_prefs, key=lambda x: str(x["name"]))
        )
        region_blocks.append(
            f"""
      <section class="portal-region-block mb-8 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <h2 class="text-base font-bold text-slate-800">その他</h2>
        <ul class="portal-pref-list mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
{links}
        </ul>
      </section>"""
        )

    total = len(records)
    main = f"""
{render_cta_block()}
      <section aria-labelledby="national-heading">
        <h2 id="national-heading" class="text-xl font-bold text-slate-900 sm:text-2xl">都道府県から探す</h2>
        <p class="mt-2 text-sm text-slate-600">掲載業者数 合計 <strong>{total}</strong> 件 · {len(pref_meta)} 都道府県</p>
        <p class="mt-1 text-sm text-slate-500">お住まいの地域を選ぶと、市区町村別の一覧ページへ移動します。</p>
      </section>
{"".join(region_blocks)}
"""
    return page_shell(
        title=NATIONAL_TITLE,
        description=NATIONAL_DESCRIPTION,
        canonical=canonical_url(),
        h1="運転代行ポータル | はるのゆこと",
        main_body=main,
        include_live_js=False,
    )


def build_prefecture_page(
    prefecture: str,
    pref_slug: str,
    records: list[dict[str, str]],
    cities: list[dict[str, str]],
) -> str:
    title = f"【2026年最新】{prefecture}の運転代行一覧｜料金・イベント情報"
    description = (
        f"{prefecture}の運転代行業者一覧。市区町村別に探せます。"
        "料金・電話番号・会員のリアルタイム営業情報を掲載。"
    )
    city_links = "\n".join(
        f'          <li><a href="{html.escape(portal_path(pref_slug, c["city_slug"]))}" class="portal-city-link">'
        f'{html.escape(c["city"])} <span class="text-slate-400">（{c["count"]}件）</span></a></li>'
        for c in cities
    )
    main = f"""
{render_breadcrumbs([("トップ", PORTAL_BASE), (prefecture, None)])}
{render_cta_block()}
      <section class="mb-8 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="city-nav">
        <h2 id="city-nav" class="text-base font-bold text-slate-800">{html.escape(prefecture)}の市区町村一覧</h2>
        <ul class="portal-city-list mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
{city_links}
        </ul>
      </section>
      <section aria-labelledby="list-heading">
        <h2 id="list-heading" class="mb-4 text-xl font-bold text-slate-900">{html.escape(prefecture)}の運転代行業者一覧</h2>
{render_cards_grid(records)}
      </section>
"""
    return page_shell(
        title=title,
        description=description,
        canonical=canonical_url(pref_slug),
        h1=f"{prefecture}の運転代行一覧",
        main_body=main,
        include_live_js=True,
        subtitle=prefecture,
    )


def build_city_page(
    prefecture: str,
    pref_slug: str,
    city: str,
    city_slug: str,
    records: list[dict[str, str]],
) -> str:
    title = f"【2026年最新】{city}の運転代行一覧｜すぐ呼べる代行業者"
    description = (
        f"{prefecture}{city}の運転代行業者一覧。"
        "電話番号・公式サイト・会員のリアルタイム営業情報を掲載。"
    )
    main = f"""
{render_breadcrumbs([
    ("トップ", PORTAL_BASE),
    (prefecture, portal_path(pref_slug)),
    (city, None),
])}
{render_cta_block()}
      <section aria-labelledby="list-heading">
        <h2 id="list-heading" class="mb-4 text-xl font-bold text-slate-900">{html.escape(city)}の運転代行業者一覧</h2>
{render_cards_grid(records)}
      </section>
"""
    return page_shell(
        title=title,
        description=description,
        canonical=canonical_url(pref_slug, city_slug),
        h1=f"{city}の運転代行一覧",
        main_body=main,
        include_live_js=True,
        subtitle=f"{prefecture} · {city}",
    )


def portal_live_listing_js() -> str:
    """都道府県・市町村ページ用: 静的カード + 会員リアルタイム枠（絶対パス API）。"""
    return f"""
    <script>
      (function () {{
        const LIVE_API_URL = {json.dumps(LIVE_API_URL)};
        const grid = document.getElementById("card-grid");
        let liveEntries = [];

        function esc(s) {{
          if (!s) return "";
          return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        }}

        const PORTAL_LIVE_DEBUG = false;
        const LIVE_SLOT_BASE = "portal-live hidden";

        function normalizeUnicode(s) {{
          let t = String(s || "").trim();
          try {{ t = t.normalize("NFKC"); }} catch (e) {{}}
          return t;
        }}

        function normalizePrefectureBase(prefecture) {{
          let s = normalizeUnicode(prefecture);
          s = s.replace(/[\\s\\u3000]+/g, "");
          s = s.replace(/(都|道|府|県)$/u, "");
          return s;
        }}

        function extractCertNumber(cert) {{
          const s = normalizeUnicode(cert);
          if (!s) return null;
          const matches = s.match(/\\d+/g);
          if (!matches || matches.length === 0) return null;
          const n = parseInt(matches[matches.length - 1], 10);
          return Number.isFinite(n) ? n : null;
        }}

        function toLiveEntry(item, apiKey) {{
          return {{
            apiKey: apiKey || "",
            prefecture: String(item.prefecture || "").trim(),
            cert_number: String(item.cert_number || "").trim(),
            prefBase: normalizePrefectureBase(item.prefecture),
            certNum: extractCertNumber(item.cert_number),
            live: item,
          }};
        }}

        function buildLiveIndexFromApi(byKey) {{
          const list = [];
          if (!byKey || typeof byKey !== "object") return list;
          Object.keys(byKey).forEach(function (apiKey) {{
            const item = byKey[apiKey];
            if (!item) return;
            list.push(toLiveEntry(item, apiKey));
          }});
          return list;
        }}

        function findLiveForCard(prefecture, cert) {{
          const cardPrefBase = normalizePrefectureBase(prefecture);
          const cardCertNum = extractCertNumber(cert);
          if (!cardPrefBase || cardCertNum === null) return null;
          if (!liveEntries.length) return null;
          const matchedEntry = liveEntries.find(function (entry) {{
            return entry.prefBase === cardPrefBase && entry.certNum === cardCertNum;
          }});
          return matchedEntry ? {{ live: matchedEntry.live, matchedKey: matchedEntry.apiKey }} : null;
        }}

        function liveArticle(slot) {{
          return slot && slot.closest ? slot.closest("article") : null;
        }}

        function hideLiveSlot(slot) {{
          if (!slot) return;
          slot.innerHTML = "";
          slot.className = LIVE_SLOT_BASE;
          slot.classList.add("hidden");
          slot.classList.remove("portal-live--visible");
          slot.hidden = true;
          const article = liveArticle(slot);
          if (article) article.classList.remove("portal-card--live");
        }}

        function showLiveSlot(slot, live) {{
          if (!slot) return;
          slot.innerHTML = buildLiveInnerHtml(live);
          slot.className = "portal-live portal-live--visible";
          slot.classList.remove("hidden");
          slot.hidden = false;
          slot.removeAttribute("hidden");
          const article = liveArticle(slot);
          if (article) article.classList.add("portal-card--live");
        }}

        function formatPriceLine(prices) {{
          if (!prices) return "";
          const parts = [];
          if (prices.base_distance != null && prices.base_price != null) {{
            parts.push("初乗り " + prices.base_distance + "km " + prices.base_price + "円");
          }}
          if (prices.per_km_price != null) parts.push("以降 " + prices.per_km_price + "円/km");
          if (prices.note) parts.push(prices.note);
          return parts.join(" · ");
        }}

        function hasValue(v) {{
          if (v === null || v === undefined) return false;
          if (typeof v === "string") return v.trim() !== "";
          return true;
        }}

        function hasLivePayload(live) {{
          if (!live) return false;
          const ev = live.event;
          if (ev) {{
            if (ev.is_active === true || ev.is_active === 1 || ev.is_active === "1") return true;
            if (Number(ev.drivers_available) > 0) return true;
            if (hasValue(ev.title) || hasValue(ev.body)) return true;
          }}
          const p = live.prices;
          if (p) {{
            if (hasValue(p.base_price) || hasValue(p.per_km_price) || hasValue(p.base_distance)) return true;
            if (hasValue(p.note)) return true;
          }}
          return false;
        }}

        function buildLiveInnerHtml(live) {{
          let html = "";
          const ev = live.event;
          if (ev) {{
            const active = ev.is_active === true || ev.is_active === 1 || ev.is_active === "1";
            const drivers = Number(ev.drivers_available) || 0;
            if (active) {{
              html +=
                '<p class="flex flex-wrap items-center gap-2 portal-live-title">' +
                '<span class="inline-flex items-center gap-1.5"><span class="portal-live-dot" aria-hidden="true"></span>本日営業中</span>' +
                "<span>（待機ドライバー: " + esc(String(drivers)) + "名）</span></p>";
            }} else if (drivers > 0) {{
              html += '<p class="portal-live-title">待機ドライバー: ' + esc(String(drivers)) + "名</p>";
            }}
            if (hasValue(ev.title) || hasValue(ev.body)) {{
              const label = (ev.title || ev.body || "").trim();
              html += '<p class="mt-1 portal-live-muted"><span class="font-semibold text-emerald-900">イベント:</span> ' + esc(label) + "</p>";
              if (hasValue(ev.title) && hasValue(ev.body) && ev.body.trim() !== ev.title.trim()) {{
                html += '<p class="mt-0.5 text-xs text-slate-600">' + esc(ev.body.trim()) + "</p>";
              }}
            }}
          }}
          const priceLine = formatPriceLine(live.prices);
          if (priceLine) {{
            html += '<p class="mt-2 border-t border-emerald-100 pt-2 portal-live-muted"><span class="font-semibold">料金:</span> ' + esc(priceLine) + "</p>";
          }}
          if (!html.trim()) {{
            html = '<p class="portal-live-title">会員登録の最新情報があります</p>';
          }}
          return html;
        }}

        function sortLiveCardsToTop() {{
          if (!grid) return;
          const live = [];
          const rest = [];
          grid.querySelectorAll("article").forEach(function (article) {{
            if (article.classList.contains("portal-card--live")) live.push(article);
            else rest.push(article);
          }});
          live.concat(rest).forEach(function (node) {{ grid.appendChild(node); }});
        }}

        function applyLiveToGrid() {{
          try {{
            if (!grid) return;
            const articles = grid.querySelectorAll("article[data-prefecture]");
            articles.forEach(function (article) {{
              const slot = article.querySelector("div.portal-live[data-live-slot]");
              if (!slot) return;
              const prefAttr = article.getAttribute("data-prefecture") || "";
              const certAttr = article.getAttribute("data-cert") || "";
              const found = findLiveForCard(prefAttr, certAttr);
              const live = found ? found.live : null;
              if (!live || !hasLivePayload(live)) {{
                hideLiveSlot(slot);
                return;
              }}
              showLiveSlot(slot, live);
            }});
            sortLiveCardsToTop();
          }} catch (err) {{
            console.warn("リアルタイム情報の反映に失敗しました", err);
          }}
        }}

        async function loadLiveInfo() {{
          const controller = new AbortController();
          const timer = setTimeout(function () {{ controller.abort(); }}, 10000);
          try {{
            const res = await fetch(LIVE_API_URL, {{
              credentials: "same-origin",
              cache: "no-store",
              signal: controller.signal,
            }});
            if (!res.ok) return false;
            const data = await res.json();
            if (!data || !data.ok || !data.by_key) return false;
            liveEntries = buildLiveIndexFromApi(data.by_key);
            return true;
          }} catch (err) {{
            console.warn("リアルタイム情報の取得に失敗しました", err);
            return false;
          }} finally {{
            clearTimeout(timer);
          }}
        }}

        async function boot() {{
          await loadLiveInfo();
          applyLiveToGrid();
        }}

        boot();
      }})();
    </script>"""


def clean_generated_portal_dirs(portal_dir: Path) -> None:
    keep_names = {"portal.css", "portal-data.json", "index.html"}
    if not portal_dir.is_dir():
        return
    for child in portal_dir.iterdir():
        if child.name in keep_names:
            continue
        if child.is_dir():
            shutil.rmtree(child)
            print(f"  削除（再生成）: {child.name}/")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  出力: {path.resolve()}")


def generate_all_pages(records: list[dict[str, str]], portal_dir: Path) -> int:
    clean_generated_portal_dirs(portal_dir)

    national_html = build_national_page(records)
    write_text(portal_dir / "index.html", national_html)

    by_pref: dict[str, list[dict[str, str]]] = {}
    for row in records:
        by_pref.setdefault(row["prefecture"], []).append(row)

    page_count = 1
    for prefecture in sorted(by_pref.keys()):
        pref_rows = by_pref[prefecture]
        pref_slug = pref_rows[0]["pref_slug"]

        city_counts: dict[str, dict[str, object]] = {}
        for row in pref_rows:
            city = row["city"]
            if city not in city_counts:
                city_counts[city] = {
                    "city": city,
                    "city_slug": row["city_slug"],
                    "count": 0,
                }
            city_counts[city]["count"] = int(city_counts[city]["count"]) + 1  # type: ignore[operator]

        cities_sorted = sorted(
            city_counts.values(),
            key=lambda c: (str(c["city"]) == "その他", str(c["city"])),
        )

        pref_html = build_prefecture_page(
            prefecture, pref_slug, pref_rows, cities_sorted  # type: ignore[arg-type]
        )
        write_text(portal_dir / pref_slug / "index.html", pref_html)
        page_count += 1

        by_city: dict[str, list[dict[str, str]]] = {}
        for row in pref_rows:
            by_city.setdefault(row["city"], []).append(row)

        for city in sorted(by_city.keys(), key=lambda c: (c == "その他", c)):
            city_rows = by_city[city]
            city_slug = city_rows[0]["city_slug"]
            city_html = build_city_page(
                prefecture, pref_slug, city, city_slug, city_rows
            )
            write_text(portal_dir / pref_slug / city_slug / "index.html", city_html)
            page_count += 1

    return page_count


def main(argv: list[str] | None = None) -> int:
    root = project_root()
    parser = argparse.ArgumentParser(
        description="全国運転代行ポータル HTML を 3 階層で生成します。"
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=root / "data" / "3_enriched_csv",
        help="enriched CSV フォルダ",
    )
    args = parser.parse_args(argv)

    print("依存パッケージ: pip install pandas pykakasi")
    print(f"読み込み: {args.input_dir}")

    if not args.input_dir.is_dir():
        print(f"エラー: フォルダがありません: {args.input_dir}", file=sys.stderr)
        return 1

    records = load_all_businesses(args.input_dir)
    if not records:
        print("エラー: 読み込める CSV がありません。", file=sys.stderr)
        return 1

    assign_slugs(records)
    prefs = sorted({r["prefecture"] for r in records})
    print(f"  合計 {len(records)} 件 / {len(prefs)} 都道府県: {', '.join(prefs)}")

    portal_dir = root / "public" / "portal"
    page_count = generate_all_pages(records, portal_dir)
    print(f"  HTML ページ数: {page_count}")

    data_path = portal_dir / "portal-data.json"
    payload = {
        "businesses": records,
        "prefectures": prefs,
        "citiesByPrefecture": build_prefecture_index(records),
        "total": len(records),
    }
    data_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  出力: {data_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
