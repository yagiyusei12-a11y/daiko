#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shiga_daiko_enriched.csv から滋賀県運転代行ポータル（index.html）を生成する。

使い方:
  python scripts/generate_portal_html.py
  python scripts/generate_portal_html.py --output public/portal/index.html

依存:
  pip install pandas
"""

from __future__ import annotations

import argparse
import html
import math
import re
import sys
from pathlib import Path

import pandas as pd

SITE_URL = "https://daiko.harunoyukoto.jp/"
PORTAL_URL = "https://daiko.harunoyukoto.jp/portal"
PAGE_TITLE = "滋賀県の運転代行業者一覧｜長浜・大津・彦根など｜はるのゆこと"
META_DESCRIPTION = (
    "滋賀県・長浜市・大津市・彦根市などの運転代行業者一覧。"
    "ワンタップで今すぐ代行を呼べます。電話番号・評価・公式サイトを掲載。"
)


def cell_str(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    if text.lower() in ("nan", "none"):
        return ""
    return text


def tel_href(phone: str) -> str:
    cleaned = re.sub(r"[^\d+]", "", phone)
    if not cleaned:
        return ""
    return f"tel:{cleaned}"


def normalize_website(url: str) -> str:
    url = url.strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.I):
        return f"https://{url}"
    return url


def parse_rating(value: str) -> float | None:
    if not value:
        return None
    try:
        rating = float(value)
    except ValueError:
        return None
    if rating < 0 or rating > 5:
        return None
    return rating


def stars_markup(rating: float | None) -> str:
    if rating is None:
        return '<span class="text-slate-400 text-sm">評価なし</span>'

    full = int(math.floor(rating + 0.25))
    full = max(0, min(5, full))
    empty = 5 - full
    stars = (
        f'<span class="text-amber-500 tracking-tight" aria-hidden="true">'
        f'{"★" * full}{"☆" * empty}</span>'
        f'<span class="text-sm font-semibold text-slate-800">{rating:.1f}</span>'
    )
    return stars


def render_card(row: pd.Series) -> str:
    name = html.escape(cell_str(row.get("業者名")))
    address = html.escape(cell_str(row.get("主たる営業所の所在地")))
    cert = html.escape(cell_str(row.get("認定番号")))
    phone = cell_str(row.get("電話番号"))
    website = normalize_website(cell_str(row.get("ウェブサイトURL")))
    rating = parse_rating(cell_str(row.get("評価")))
    reviews = cell_str(row.get("レビュー数"))

    stars = stars_markup(rating)
    reviews_html = ""
    if reviews:
        reviews_html = (
            f'<span class="text-xs text-slate-500">'
            f'（{html.escape(reviews)}件のレビュー）</span>'
        )

    call_btn = ""
    if phone:
        href = html.escape(tel_href(phone), quote=True)
        label = html.escape(phone)
        call_btn = f"""
          <a href="{href}"
             class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-base font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-[0.98]">
            <svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
            </svg>
            電話で呼ぶ
          </a>
          <p class="mt-1 text-center text-xs text-slate-500">{label}</p>
        """

    website_link = ""
    if website:
        safe_url = html.escape(website, quote=True)
        display = html.escape(website.replace("https://", "").replace("http://", "").rstrip("/"))
        if len(display) > 36:
            display = display[:33] + "…"
        website_link = f"""
          <a href="{safe_url}" target="_blank" rel="noopener noreferrer"
             class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            公式HP
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
          </a>
        """

    cert_badge = ""
    if cert:
        cert_badge = (
            f'<span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">'
            f'{cert}</span>'
        )

    return f"""
    <article class="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <h2 class="font-display text-lg font-bold leading-snug text-slate-900">{name}</h2>
        {cert_badge}
      </div>
      <p class="mt-2 flex items-start gap-1.5 text-sm text-slate-600">
        <svg class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        <span>滋賀県 {address}</span>
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        {stars}
        {reviews_html}
      </div>
      {website_link}
      {call_btn}
    </article>
    """


def build_html(df: pd.DataFrame) -> str:
    cards = "\n".join(render_card(row) for _, row in df.iterrows())
    count = len(df)

    return f"""<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{html.escape(PAGE_TITLE)}</title>
    <meta name="description" content="{html.escape(META_DESCRIPTION)}" />
    <link rel="canonical" href="{html.escape(PORTAL_URL)}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:title" content="{html.escape(PAGE_TITLE)}" />
    <meta property="og:description" content="{html.escape(META_DESCRIPTION)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{html.escape(PORTAL_URL)}" />
    <meta property="og:locale" content="ja_JP" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {{
        theme: {{
          extend: {{
            colors: {{
              brand: {{ DEFAULT: "#2563eb", dark: "#1d4ed8" }},
            }},
            fontFamily: {{
              display: ['"Segoe UI"', "Hiragino Sans", "Meiryo", "sans-serif"],
            }},
          }},
        }},
      }};
    </script>
    <style>
      body {{ font-family: "Segoe UI", "Hiragino Sans", "Meiryo", sans-serif; }}
    </style>
  </head>
  <body class="min-h-screen bg-slate-50 text-slate-900 antialiased">
    <header class="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div>
          <p class="text-xs font-semibold tracking-wide text-brand">滋賀県</p>
          <h1 class="text-lg font-bold leading-tight sm:text-xl">
            運転代行ポータル <span class="text-slate-400 font-normal">|</span> はるのゆこと
          </h1>
        </div>
        <a href="{html.escape(SITE_URL)}"
           class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 no-underline shadow-sm hover:border-brand hover:text-brand">
          システムについて（トップへ戻る）
        </a>
      </div>
    </header>

    <main id="main" class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <section class="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-blue-700 p-6 text-white shadow-lg sm:p-8" aria-labelledby="cta-heading">
        <h2 id="cta-heading" class="text-base font-bold leading-relaxed sm:text-lg">
          【運転代行業者様へ】配車・売上管理をスマートにする最新システムを導入しませんか？初期費用を抑えて業務を効率化。詳しくはこちら
        </h2>
        <a href="{html.escape(SITE_URL)}"
           class="mt-5 inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand shadow-md transition hover:bg-blue-50 sm:text-base">
          Daiko（運転代行向け業務管理）を見る →
        </a>
      </section>

      <div class="mb-6">
        <p class="text-sm text-slate-600">
          滋賀県内の認定運転代行業者 <strong class="text-slate-900">{count}</strong> 件を掲載しています。
          お酒を飲んだあとは運転代行をご利用ください。スマホからワンタップでお電話できます。
        </p>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards}
      </div>
    </main>

    <footer class="mt-12 border-t border-slate-200 bg-white">
      <section class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div class="rounded-2xl border border-blue-100 bg-blue-50 p-6 sm:p-8">
          <p class="text-sm font-semibold leading-relaxed text-slate-800 sm:text-base">
            【運転代行業者様へ】配車・売上管理をスマートにする最新システムを導入しませんか？初期費用を抑えて業務を効率化。詳しくはこちら
          </p>
          <a href="{html.escape(SITE_URL)}"
             class="mt-4 inline-flex rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white no-underline shadow-sm hover:bg-blue-800">
            詳しくはこちら（Daiko 公式サイト）
          </a>
        </div>
        <p class="mt-8 text-center text-xs text-slate-500">
          掲載情報は Google 等の公開情報をもとに自動収集しています。内容の正確性は各事業者へご確認ください。<br />
          運営: <a href="{html.escape(SITE_URL)}" class="text-brand hover:underline">はるのゆこと / Daiko</a>
        </p>
      </section>
    </footer>
  </body>
</html>
"""


def main(argv: list[str] | None = None) -> int:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="滋賀県運転代行ポータル HTML を生成します。")
    parser.add_argument(
        "--input",
        type=Path,
        default=project_root / "shiga_daiko_enriched.csv",
        help="入力 CSV（既定: shiga_daiko_enriched.csv）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "index.html",
        help="出力 HTML（既定: プロジェクトルートの index.html）",
    )
    args = parser.parse_args(argv)

    if not args.input.is_file():
        print(f"エラー: 入力ファイルが見つかりません: {args.input}", file=sys.stderr)
        return 1

    df = pd.read_csv(args.input, encoding="utf-8-sig", dtype=str).fillna("")
    if "業者名" not in df.columns:
        print("エラー: CSV に「業者名」列がありません。", file=sys.stderr)
        return 1

    html_doc = build_html(df)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html_doc, encoding="utf-8")

    print(f"入力: {args.input}（{len(df)} 件）")
    print(f"出力: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
