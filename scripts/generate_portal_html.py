#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/3_enriched_csv/ 内の県別 CSV を統合し、全国対応ポータル index.html を生成する。

使い方:
  python scripts/generate_portal_html.py

出力（同一内容）:
  - index.html（プロジェクトルート）
  - public/portal/index.html

依存:
  pip install pandas
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

import pandas as pd

from daiko_places_enrich import PREFECTURE_BY_STEM

SITE_URL = "https://daiko.harunoyukoto.jp/"
PORTAL_URL = "https://daiko.harunoyukoto.jp/portal/"
PAGE_TITLE = "全国の運転代行業者一覧・検索 | はるのゆこと"
META_DESCRIPTION = (
    "滋賀県、福井県、岐阜県、大阪府など、各地域の運転代行業者一覧。"
    "営業時間や電話番号を掲載し、スマホからワンタップで今すぐ代行を呼べます。"
    "エリアや市区町村での絞り込み対応。"
)

ADDRESS_COLUMNS = ("所在地", "主たる営業所の所在地")
CITY_PATTERN = re.compile(
    r"^(.+?(?:市|区|町|村)|.+?郡.+?(?:町|村))"
)


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


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
    # 8515_2740104_misc などの非標準名 → 既知の別名
    stem_aliases = {
        "8515_2740104_misc": "岐阜県",
        "daikougyouitirann5matu": "愛知県",
        "daikouitirannintekyoten": "福井県",
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
                    "rating": cell_str(row.get("評価")),
                    "reviews": cell_str(row.get("レビュー数")),
                }
            )

    return records


def build_prefecture_index(records: list[dict[str, str]]) -> dict[str, list[str]]:
    cities_by_pref: dict[str, set[str]] = {}
    for row in records:
        pref = row["prefecture"]
        cities_by_pref.setdefault(pref, set()).add(row["city"])
    return {
        pref: sorted(cities, key=lambda c: (c == "その他", c))
        for pref, cities in sorted(cities_by_pref.items())
    }


def build_html(records: list[dict[str, str]]) -> str:
    prefectures = sorted({r["prefecture"] for r in records})
    cities_by_pref = build_prefecture_index(records)
    payload = {
        "businesses": records,
        "prefectures": prefectures,
        "citiesByPrefecture": cities_by_pref,
        "total": len(records),
    }
    json_data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    json_data = json_data.replace("</", "<\\/")

    pref_options = "\n".join(
        f'            <option value="{html.escape(p)}">{html.escape(p)}</option>'
        for p in prefectures
    )

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
      .pref-tab.active {{
        background-color: #2563eb;
        color: #fff;
        border-color: #2563eb;
      }}
    </style>
  </head>
  <body class="min-h-screen bg-slate-50 text-slate-900 antialiased">
    <header class="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div>
          <p class="text-xs font-semibold tracking-wide text-brand">全国対応</p>
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
      <section class="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-blue-700 p-6 text-white shadow-lg sm:p-8" aria-labelledby="cta-top">
        <h2 id="cta-top" class="text-base font-bold leading-relaxed sm:text-lg">
          【運転代行業者様へ】配車・売上管理をスマートにする最新システムを導入しませんか？初期費用を抑えて業務を効率化。詳しくはこちら
        </h2>
        <a href="{html.escape(SITE_URL)}"
           class="mt-5 inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand shadow-md transition hover:bg-blue-50 sm:text-base">
          Daiko（運転代行向け業務管理）を見る →
        </a>
      </section>

      <section class="mb-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="filter-heading">
        <h2 id="filter-heading" class="text-sm font-bold text-slate-800">都道府県・市区町村で絞り込み</h2>

        <div class="mt-4">
          <label for="pref-select" class="mb-1 block text-xs font-semibold text-slate-500">都道府県を選択</label>
          <select id="pref-select"
                  class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-medium text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20">
            <option value="">すべての都道府県</option>
{pref_options}
          </select>
        </div>

        <div id="pref-tabs" class="mt-3 hidden flex-wrap gap-2 sm:flex" role="tablist" aria-label="都道府県タブ"></div>

        <div id="city-wrap" class="mt-4 hidden">
          <label for="city-select" class="mb-1 block text-xs font-semibold text-slate-500">市区町村を選択</label>
          <select id="city-select"
                  class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20">
            <option value="">すべての市区町村</option>
          </select>
        </div>

        <p class="mt-4 text-sm text-slate-600">
          掲載 <strong id="result-count" class="text-slate-900">0</strong> 件
          <span class="text-slate-400">（全 <span id="total-count">{len(records)}</span> 件）</span>
        </p>
      </section>

      <div id="card-grid" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite"></div>
      <p id="empty-msg" class="hidden rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">
        条件に一致する業者がありません。都道府県または市区町村を変更してください。
      </p>
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

    <script id="portal-data" type="application/json">{json_data}</script>
    <script>
      (function () {{
        const SITE_URL = {json.dumps(SITE_URL)};
        const DATA = JSON.parse(document.getElementById("portal-data").textContent);

        const prefSelect = document.getElementById("pref-select");
        const citySelect = document.getElementById("city-select");
        const cityWrap = document.getElementById("city-wrap");
        const prefTabs = document.getElementById("pref-tabs");
        const grid = document.getElementById("card-grid");
        const emptyMsg = document.getElementById("empty-msg");
        const resultCount = document.getElementById("result-count");

        const state = {{ pref: "", city: "" }};

        function esc(s) {{
          if (!s) return "";
          return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        }}

        function telHref(phone) {{
          const d = String(phone).replace(/[^\\d+]/g, "");
          return d ? "tel:" + d : "";
        }}

        function normalizeUrl(url) {{
          if (!url) return "";
          return /^https?:\\/\\//i.test(url) ? url : "https://" + url;
        }}

        function starsHtml(rating) {{
          const r = parseFloat(rating);
          if (isNaN(r)) return '<span class="text-slate-400 text-sm">評価なし</span>';
          const full = Math.max(0, Math.min(5, Math.floor(r + 0.25)));
          const empty = 5 - full;
          return (
            '<span class="text-amber-500 tracking-tight" aria-hidden="true">' +
            "★".repeat(full) + "☆".repeat(empty) +
            '</span><span class="text-sm font-semibold text-slate-800">' + r.toFixed(1) + "</span>"
          );
        }}

        function cardHtml(b) {{
          const cert = esc(b.cert);
          const name = esc(b.name);
          const pref = esc(b.prefecture);
          const addr = esc(b.address);
          const phone = b.phone || "";
          const website = normalizeUrl(b.website || "");
          const reviews = b.reviews
            ? '<span class="text-xs text-slate-500">（' + esc(b.reviews) + "件のレビュー）</span>"
            : "";

          let callBtn = "";
          if (phone) {{
            const href = esc(telHref(phone));
            callBtn =
              '<a href="' + href + '" class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-base font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-[0.98]">' +
              '<svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>' +
              "電話で呼ぶ</a><p class=\\"mt-1 text-center text-xs text-slate-500\\">" + esc(phone) + "</p>";
          }}

          let siteLink = "";
          if (website) {{
            const display = esc(website.replace(/^https?:\\/\\//, "").replace(/\\/$/, ""));
            siteLink =
              '<a href="' + esc(website) + '" target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">' +
              "公式HP</a>";
          }}

          const certBadge = cert
            ? '<span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">' + cert + "</span>"
            : "";

          return (
            '<article class="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">' +
            '<div class="flex flex-wrap items-start justify-between gap-2"><h2 class="text-lg font-bold leading-snug text-slate-900">' + name + "</h2>" + certBadge + "</div>" +
            '<p class="mt-1 text-xs font-medium text-brand">' + pref + " · " + esc(b.city) + "</p>" +
            '<p class="mt-2 flex items-start gap-1.5 text-sm text-slate-600"><span>' + pref + " " + addr + "</span></p>" +
            '<div class="mt-3 flex flex-wrap items-center gap-2">' + starsHtml(b.rating) + reviews + "</div>" +
            siteLink + callBtn + "</article>"
          );
        }}

        function buildPrefTabs() {{
          prefTabs.innerHTML = "";
          DATA.prefectures.forEach(function (p) {{
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "pref-tab rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-brand";
            btn.textContent = p;
            btn.dataset.pref = p;
            btn.addEventListener("click", function () {{
              prefSelect.value = p;
              onPrefChange();
            }});
            prefTabs.appendChild(btn);
          }});
          if (DATA.prefectures.length > 0) {{
            prefTabs.classList.remove("hidden");
          }}
        }}

        function syncTabActive() {{
          prefTabs.querySelectorAll(".pref-tab").forEach(function (btn) {{
            btn.classList.toggle("active", btn.dataset.pref === state.pref);
          }});
        }}

        function updateCityOptions() {{
          citySelect.innerHTML = '<option value="">すべての市区町村</option>';
          if (!state.pref) {{
            cityWrap.classList.add("hidden");
            state.city = "";
            return;
          }}
          const cities = DATA.citiesByPrefecture[state.pref] || [];
          cities.forEach(function (c) {{
            const opt = document.createElement("option");
            opt.value = c;
            opt.textContent = c;
            citySelect.appendChild(opt);
          }});
          cityWrap.classList.remove("hidden");
        }}

        function filtered() {{
          return DATA.businesses.filter(function (b) {{
            if (state.pref && b.prefecture !== state.pref) return false;
            if (state.city && b.city !== state.city) return false;
            return true;
          }});
        }}

        function render() {{
          const list = filtered();
          resultCount.textContent = String(list.length);
          grid.innerHTML = "";
          if (list.length === 0) {{
            emptyMsg.classList.remove("hidden");
            return;
          }}
          emptyMsg.classList.add("hidden");
          const frag = document.createDocumentFragment();
          const template = document.createElement("template");
          list.forEach(function (b) {{
            template.innerHTML = cardHtml(b);
            frag.appendChild(template.content.firstChild);
          }});
          grid.appendChild(frag);
        }}

        function onPrefChange() {{
          state.pref = prefSelect.value;
          state.city = "";
          citySelect.value = "";
          syncTabActive();
          updateCityOptions();
          render();
        }}

        function onCityChange() {{
          state.city = citySelect.value;
          render();
        }}

        prefSelect.addEventListener("change", onPrefChange);
        citySelect.addEventListener("change", onCityChange);

        buildPrefTabs();
        render();
      }})();
    </script>
  </body>
</html>
"""


def write_outputs(html_doc: str, paths: list[Path]) -> None:
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(html_doc, encoding="utf-8")
        print(f"  出力: {path.resolve()}")


def main(argv: list[str] | None = None) -> int:
    root = project_root()
    parser = argparse.ArgumentParser(description="全国運転代行ポータル HTML を生成します。")
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=root / "data" / "3_enriched_csv",
        help="enriched CSV フォルダ",
    )
    args = parser.parse_args(argv)

    if not args.input_dir.is_dir():
        print(f"エラー: フォルダがありません: {args.input_dir}", file=sys.stderr)
        return 1

    print(f"読み込み: {args.input_dir}")
    records = load_all_businesses(args.input_dir)
    if not records:
        print("エラー: 読み込める CSV がありません。", file=sys.stderr)
        return 1

    prefs = sorted({r["prefecture"] for r in records})
    print(f"  合計 {len(records)} 件 / {len(prefs)} 都道府県: {', '.join(prefs)}")

    html_doc = build_html(records)
    outputs = [
        root / "index.html",
        root / "public" / "portal" / "index.html",
    ]
    write_outputs(html_doc, outputs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
