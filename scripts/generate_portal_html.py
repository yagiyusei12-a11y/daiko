#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CSV + MySQL(companies) をマージし、全国47都道府県のポータル HTML を 3 階層で生成する。

使い方:
  pip install pandas pykakasi pymysql
  python scripts/generate_portal_html.py

DB接続: portal-member/config/config.php または環境変数 PORTAL_DB_*

フェーズ3: portal/sitemap.xml・portal/robots.txt 自動生成、営業中カード先頭並び、市町村ページ近隣リンク
フェーズ4: 業者個別詳細ページ（/portal/{pref}/{city}/{company_id}/）全自動生成・サイトマップ連携
フェーズ5: GPS現在地から市町村ページへ遷移（PORTAL_AREA_MAP + HeartRails 逆ジオコーディング）
フェーズ6: 利用規約・お気に入り・プレミアム掲載フラグ
フェーズ7: PWA（manifest.json / sw.js）・ホーム画面追加UI
GA4 / Search Console 確認 meta の全ページ自動埋め込み
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

import pandas as pd

from daiko_places_enrich import PREFECTURE_BY_STEM
from portal_data_sources import (
    ALL_PREFECTURES,
    PREF_SLUG_OVERRIDES,
    apply_rating_aggregates_to_records,
    extract_cert_number,
    load_companies_from_mysql,
    load_company_rating_aggregates_from_mysql,
    filter_suspended_portal_records,
    merge_business_records,
    register_url_for_prefecture,
)

SITE_URL = "https://daiko.harunoyukoto.jp/"
PORTAL_BASE = "/portal/"
PORTAL_DATA_URL = "/portal/portal-data.json"
PORTAL_CSS_URL = "/portal/portal.css"
PORTAL_NEO_CSS_URL = "/portal/portal-neo-2026.css"
LIVE_API_URL = "/portal-member/api/get_live_info.php"
REQUEST_RIDE_API = "/portal-member/api/request_ride.php"
CHECK_RIDE_STATUS_API = "/portal-member/api/check_ride_status.php"
CREATE_PAYMENT_API = "/portal-member/api/create_payment.php"
PAYMENT_WEBHOOK_API = "/portal-member/api/payment_webhook.php"
CANCEL_RIDE_API = "/portal-member/api/cancel_ride.php"
GET_SURGE_MULTIPLIER_API = "/portal-member/api/get_surge_multiplier.php"
SAVE_REVIEW_API = "/portal-member/api/save_review.php"
APPLY_COUPON_API = "/portal-member/api/apply_coupon.php"
GET_COMPANY_RATINGS_API = "/portal-member/api/get_company_ratings.php"
HEARTRAILS_GEO_API = "https://geoapi.heartrails.com/api/json"
GPS_ERROR_MESSAGE = (
    "位置情報が取得できませんでした。都道府県一覧からお選びください。"
)

# こだわり条件: (DBキー, data属性・フィルター用スラッグ, バッジ表示)
PORTAL_FEATURE_DEFS: tuple[tuple[str, str, str], ...] = (
    ("accept_cashless", "accept-cashless", "💳 キャッシュレス"),
    ("is_invoice_registered", "invoice", "🧾 インボイス"),
    ("has_female_driver", "female-driver", "👩 女性スタッフ"),
    ("left_hand_drive_ok", "left-hand-drive", "🚗 外車OK"),
)
MEMBER_REGISTER_URL = "/portal-member/register.php"
MEMBER_LOGIN_URL = "/portal-member/login.php"
PORTAL_TERMS_PATH = "/portal/terms/"
PORTAL_MANIFEST_URL = "/portal/manifest.json"
PORTAL_SW_URL = "/portal/sw.js"
PWA_APP_NAME = "代行ナビ - はるのゆこと"
PWA_SHORT_NAME = "代行ナビ"
PWA_THEME_COLOR = "#10b981"
PWA_BG_COLOR = "#ecfdf5"

# Google Analytics 4（全ポータルページの <head> に埋め込み）
GA4_MEASUREMENT_ID = "G-KVBE5XF4JN"

# Google Search Console 所有権確認（content の値のみ。未設定時は meta を出力しない）
GSC_VERIFICATION_CODE = "dO_l-HH149K60PPSNLJWT3AWxZsnATg4-_V8b1GOA-U"


def render_head_tracking_snippets() -> str:
    """GA4 グローバルタグと（設定時のみ）GSC 確認 meta。"""
    parts: list[str] = []
    gsc_code = (GSC_VERIFICATION_CODE or "").strip()
    if gsc_code:
        parts.append(
            f'    <meta name="google-site-verification" content="{html.escape(gsc_code)}" />'
        )
    parts.append(
        f'    <script async src="https://www.googletagmanager.com/gtag/js?id={html.escape(GA4_MEASUREMENT_ID)}"></script>'
    )
    parts.append(f"""    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){{dataLayer.push(arguments);}}
      gtag('js', new Date());
      gtag('config', {json.dumps(GA4_MEASUREMENT_ID)});
    </script>""")
    return "\n".join(parts) + "\n"


def render_pwa_head_snippets() -> str:
    """PWA manifest・iOS ホーム画面用 meta。"""
    return f"""    <link rel="manifest" href="{html.escape(PORTAL_MANIFEST_URL)}" />
    <meta name="theme-color" content="{html.escape(PWA_THEME_COLOR)}" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="{html.escape(PWA_SHORT_NAME)}" />
    <link rel="apple-touch-icon" href="/portal/icon-192x192.png" />
"""


def render_service_worker_register_js() -> str:
    """Service Worker 登録（全ポータル HTML の </body> 直前）。"""
    sw_url = json.dumps(PORTAL_SW_URL)
    return f"""
    <script>
      (function () {{
        if (!("serviceWorker" in navigator)) return;
        window.addEventListener("load", function () {{
          navigator.serviceWorker.register({sw_url}).catch(function (err) {{
            console.warn("Service Worker registration failed", err);
          }});
        }});
      }})();
    </script>
"""


def build_portal_manifest_json() -> str:
    """public/portal/manifest.json の内容。"""
    payload = {
        "name": PWA_APP_NAME,
        "short_name": PWA_SHORT_NAME,
        "description": "全国の運転代行業者をすぐ検索。お気に入り・GPS・リアルタイム営業情報に対応。",
        "start_url": PORTAL_BASE,
        "scope": PORTAL_BASE,
        "display": "standalone",
        "orientation": "portrait-primary",
        "background_color": PWA_BG_COLOR,
        "theme_color": PWA_THEME_COLOR,
        "lang": "ja",
        "icons": [
            {
                "src": "/portal/icon-192x192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": "/portal/icon-512x512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": "/portal/icon-512x512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def build_portal_service_worker_js() -> str:
    """public/portal/sw.js — 静的アセットのキャッシュ（HTML はネットワーク優先）。"""
    precache = [
        PORTAL_CSS_URL,
        PORTAL_MANIFEST_URL,
        "/portal/icon-192x192.png",
        "/portal/icon-512x512.png",
        PORTAL_BASE,
    ]
    precache_js = json.dumps(precache, ensure_ascii=False)
    return f"""/* 代行ポータル PWA Service Worker（generate_portal_html.py で自動生成） */
const CACHE_VERSION = "portal-daiko-v1";
const PRECACHE_URLS = {precache_js};

self.addEventListener("install", function (event) {{
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {{
      return cache.addAll(PRECACHE_URLS.map(function (u) {{
        return new Request(u, {{ credentials: "same-origin" }});
      }})).catch(function () {{}});
    }}).then(function () {{ return self.skipWaiting(); }})
  );
}});

self.addEventListener("activate", function (event) {{
  event.waitUntil(
    caches.keys().then(function (keys) {{
      return Promise.all(
        keys.filter(function (k) {{ return k !== CACHE_VERSION; }}).map(function (k) {{
          return caches.delete(k);
        }})
      );
    }}).then(function () {{ return self.clients.claim(); }})
  );
}});

function isPortalStaticAsset(url) {{
  const p = url.pathname;
  return (
    p.endsWith(".css") ||
    p.endsWith(".js") ||
    p.endsWith(".json") ||
    p.endsWith(".png") ||
    p.endsWith(".webp") ||
    p.endsWith(".ico") ||
    p === "/portal/manifest.json"
  );
}}

self.addEventListener("fetch", function (event) {{
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/portal")) return;

  if (isPortalStaticAsset(url)) {{
    event.respondWith(
      caches.match(event.request).then(function (cached) {{
        if (cached) return cached;
        return fetch(event.request).then(function (res) {{
          if (!res || res.status !== 200) return res;
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) {{
            cache.put(event.request, clone);
          }});
          return res;
        }});
      }})
    );
    return;
  }}

  event.respondWith(
    fetch(event.request)
      .then(function (res) {{
        if (res && res.status === 200 && res.type === "basic") {{
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) {{
            cache.put(event.request, clone);
          }});
        }}
        return res;
      }})
      .catch(function () {{
        return caches.match(event.request).then(function (cached) {{
          return cached || caches.match("/portal/index.html");
        }});
      }})
  );
}});
"""


def render_pwa_install_banner_html() -> str:
    """スマホ向け「ホーム画面に追加」バナー（フィルター付近・画面下部）。"""
    return """
    <div id="portal-pwa-install" class="portal-pwa-install hidden" role="region" aria-label="アプリのインストール" hidden>
      <div class="portal-pwa-install-inner">
        <p class="portal-pwa-install-title">📱 このサイトをホーム画面に追加してアプリとして使う</p>
        <p class="portal-pwa-install-text">よく使う代行をすぐ開けます。通信が不安定なときも表示が速くなります。</p>
        <div class="portal-pwa-install-actions">
          <button type="button" id="portal-pwa-install-btn" class="portal-pwa-install-btn">ホーム画面に追加</button>
          <button type="button" id="portal-pwa-install-dismiss" class="portal-pwa-install-dismiss" aria-label="閉じる">閉じる</button>
        </div>
        <p id="portal-pwa-install-ios-hint" class="portal-pwa-install-ios hidden">
          iPhoneの場合: 画面下の <strong>共有</strong> → <strong>ホーム画面に追加</strong> をタップしてください。
        </p>
      </div>
    </div>"""


def portal_pwa_install_js() -> str:
    """PWA インストール促進（モバイルのみ表示）。"""
    return """
    <script>
      (function () {
        const DISMISS_KEY = "portal_pwa_install_dismissed_v1";
        const banner = document.getElementById("portal-pwa-install");
        const installBtn = document.getElementById("portal-pwa-install-btn");
        const dismissBtn = document.getElementById("portal-pwa-install-dismiss");
        const iosHint = document.getElementById("portal-pwa-install-ios-hint");
        let deferredPrompt = null;

        function isMobileUa() {
          return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
        }

        function isStandalone() {
          return (
            window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true
          );
        }

        function showBanner() {
          if (!banner || !isMobileUa() || isStandalone()) return;
          try {
            if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
          } catch (e) {}
          banner.classList.remove("hidden");
          banner.hidden = false;
        }

        function hideBanner() {
          if (!banner) return;
          banner.classList.add("hidden");
          banner.hidden = true;
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch (e) {}
        }

        window.addEventListener("beforeinstallprompt", function (e) {
          e.preventDefault();
          deferredPrompt = e;
          showBanner();
        });

        if (installBtn) {
          installBtn.addEventListener("click", function () {
            const ua = navigator.userAgent || "";
            const isIos =
              /iPhone|iPad|iPod/i.test(ua) &&
              !/CriOS|FxiOS|EdgiOS/i.test(ua);
            if (isIos && iosHint) {
              iosHint.classList.remove("hidden");
              return;
            }
            if (!deferredPrompt) {
              alert(
                "ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選択してください。"
              );
              return;
            }
            deferredPrompt.prompt();
            deferredPrompt.userChoice.finally(function () {
              deferredPrompt = null;
              hideBanner();
            });
          });
        }

        if (dismissBtn) {
          dismissBtn.addEventListener("click", hideBanner);
        }

        if (isMobileUa() && !isStandalone()) {
          window.setTimeout(showBanner, 1200);
        }

        document.querySelectorAll("[data-portal-pwa-scroll-install]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            showBanner();
            if (banner && banner.scrollIntoView) {
              banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          });
        });
      })();
    </script>
"""


NATIONAL_TITLE = "【2026年最新】全国の運転代行一覧｜料金・すぐ呼べる代行検索"
NATIONAL_DESCRIPTION = (
    "全国の運転代行業者を都道府県・市区町村から探せる一覧ポータル。"
    "料金・電話番号・公式サイトを掲載。すぐ呼べる代行業者を検索できます。"
)

ADDRESS_COLUMNS = ("所在地", "主たる営業所の所在地")
CITY_PATTERN = re.compile(
    r"^(.+?(?:市|区|町|村)|.+?郡.+?(?:町|村))"
)

# 地方区分（47都道府県すべてをリンク表示）
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

    def pref_slug(self, prefecture: str, fixed: str | None = None) -> str:
        base = fixed if fixed else slug_from_place_name(prefecture)
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


def build_pref_slug_map() -> dict[str, str]:
    """全国47都道府県の URL スラッグ（既存本番 URL 互換を優先）。"""
    registry = SlugRegistry()
    slug_map: dict[str, str] = {}
    for pref in ALL_PREFECTURES:
        fixed = PREF_SLUG_OVERRIDES.get(pref)
        slug_map[pref] = registry.pref_slug(pref, fixed=fixed)
    return slug_map


def assign_slugs_to_records(
    records: list[dict[str, str]],
    pref_slug_map: dict[str, str],
) -> None:
    """同一都道府県・同一市区町村名は必ず同じ city_slug を共有する。"""
    city_registries: dict[str, SlugRegistry] = {}
    city_slug_cache: dict[tuple[str, str], str] = {}
    for row in records:
        pref = row.get("prefecture", "")
        if pref not in pref_slug_map:
            continue
        ps = pref_slug_map[pref]
        row["pref_slug"] = ps
        city_name = row.get("city") or "その他"
        cache_key = (ps, city_name)
        if cache_key not in city_slug_cache:
            reg = city_registries.setdefault(ps, SlugRegistry())
            city_slug_cache[cache_key] = reg.city_slug(ps, city_name)
        row["city_slug"] = city_slug_cache[cache_key]


def build_prefecture_index(records: list[dict[str, str]]) -> dict[str, list[str]]:
    cities_by_pref: dict[str, set[str]] = {}
    for row in records:
        pref = row["prefecture"]
        cities_by_pref.setdefault(pref, set()).add(row["city"])
    return {
        pref: sorted(cities, key=lambda c: (c == "その他", c))
        for pref, cities in sorted(cities_by_pref.items())
    }


def portal_path(
    pref_slug: str | None = None,
    city_slug: str | None = None,
    company_id: str | None = None,
) -> str:
    if not pref_slug:
        return PORTAL_BASE
    if not city_slug:
        return f"{PORTAL_BASE}{pref_slug}/"
    if not company_id:
        return f"{PORTAL_BASE}{pref_slug}/{city_slug}/"
    safe_id = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(company_id)).strip("-") or "company"
    return f"{PORTAL_BASE}{pref_slug}/{city_slug}/{safe_id}/"


def company_detail_path(rec: dict[str, str]) -> str:
    return portal_path(
        rec.get("pref_slug", ""),
        rec.get("city_slug", ""),
        rec.get("company_id", ""),
    )


def canonical_url(
    pref_slug: str | None = None,
    city_slug: str | None = None,
    company_id: str | None = None,
) -> str:
    return SITE_URL.rstrip("/") + portal_path(pref_slug, city_slug, company_id)


def build_portal_area_map(
    records: list[dict[str, str]],
    pref_slug_map: dict[str, str],
) -> dict[str, dict[str, object]]:
    """都道府県・市町村の漢字名と URL スラッグの対応表（GPS 遷移用）。"""
    area_map: dict[str, dict[str, object]] = {
        pref: {"slug": pref_slug_map[pref], "cities": {}}
        for pref in ALL_PREFECTURES
    }
    for row in records:
        pref = row.get("prefecture", "")
        city = row.get("city") or ""
        city_slug = row.get("city_slug") or ""
        if pref not in area_map or not city or not city_slug:
            continue
        cities = area_map[pref]["cities"]
        assert isinstance(cities, dict)
        if city not in cities:
            cities[city] = city_slug
    return area_map


def render_portal_area_map_script(area_map: dict[str, dict[str, object]]) -> str:
    payload = json.dumps(area_map, ensure_ascii=False, separators=(",", ":"))
    return f"    <script>window.PORTAL_AREA_MAP = {payload};</script>\n"


def render_gps_locate_button_html(*, variant: str) -> str:
    """variant: hero | sticky"""
    if variant == "hero":
        return """
        <button type="button" class="portal-gps-locate-btn portal-gps-hero-btn" id="portal-gps-hero-btn" aria-live="polite">
          <span class="portal-gps-hero-btn-icon" aria-hidden="true">📍</span>
          <span class="portal-gps-hero-btn-text">現在地から今すぐ呼べる代行を探す</span>
        </button>
        <p class="portal-hero-gps-hint">スマホの位置情報で、いまいる市区町村の代行一覧へ移動します</p>
        <button type="button" class="portal-hero-pref-picker" id="hero-open-area-sheet">
          都道府県一覧から選ぶ
        </button>"""
    return """
      <button type="button" class="portal-sticky-nav-btn portal-sticky-nav-btn--gps portal-gps-locate-btn" id="portal-gps-sticky-btn" aria-live="polite">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        <span class="portal-gps-sticky-label">現在地</span>
      </button>"""


def portal_geolocation_js() -> str:
    """全ポータルページ共通: GPS 取得 → 逆ジオコーディング → 市町村ページへ遷移。"""
    err_msg = json.dumps(GPS_ERROR_MESSAGE, ensure_ascii=False)
    geo_api = json.dumps(HEARTRAILS_GEO_API)
    portal_base = json.dumps(PORTAL_BASE)
    return f"""
    <script>
      (function () {{
        const GPS_ERROR_MSG = {err_msg};
        const HEARTRAILS_GEO_API = {geo_api};
        const PORTAL_BASE = {portal_base};

        function normalizePlaceName(s) {{
          let t = String(s || "").trim();
          try {{ t = t.normalize("NFKC"); }} catch (e) {{}}
          return t.replace(/[\\s\\u3000]+/g, "");
        }}

        function findPrefEntry(prefName) {{
          const map = window.PORTAL_AREA_MAP;
          if (!map || !prefName) return null;
          if (map[prefName]) return {{ name: prefName, entry: map[prefName] }};
          const norm = normalizePlaceName(prefName);
          for (const key of Object.keys(map)) {{
            if (normalizePlaceName(key) === norm) return {{ name: key, entry: map[key] }};
          }}
          return null;
        }}

        function findCitySlug(prefEntry, cityName) {{
          if (!prefEntry || !prefEntry.cities || !cityName) return null;
          const cities = prefEntry.cities;
          if (cities[cityName]) return cities[cityName];
          const norm = normalizePlaceName(cityName);
          for (const key of Object.keys(cities)) {{
            const kn = normalizePlaceName(key);
            if (kn === norm) return cities[key];
            if (kn.startsWith(norm) || norm.startsWith(kn)) return cities[key];
          }}
          return null;
        }}

        function setGpsLoading(loading) {{
          document.querySelectorAll(".portal-gps-locate-btn").forEach(function (btn) {{
            if (loading) {{
              if (!btn.dataset.portalGpsOriginalHtml) {{
                btn.dataset.portalGpsOriginalHtml = btn.innerHTML;
              }}
              btn.disabled = true;
              btn.setAttribute("aria-busy", "true");
              btn.classList.add("portal-gps-locate-btn--loading");
              if (btn.classList.contains("portal-gps-hero-btn")) {{
                btn.innerHTML =
                  '<span class="portal-gps-hero-btn-icon" aria-hidden="true">⏳</span>' +
                  '<span class="portal-gps-hero-btn-text">現在地を取得中...</span>';
              }} else {{
                var lbl = btn.querySelector(".portal-gps-sticky-label");
                if (lbl) lbl.textContent = "取得中...";
              }}
            }} else {{
              btn.disabled = false;
              btn.removeAttribute("aria-busy");
              btn.classList.remove("portal-gps-locate-btn--loading");
              if (btn.dataset.portalGpsOriginalHtml) {{
                btn.innerHTML = btn.dataset.portalGpsOriginalHtml;
              }}
            }}
          }});
        }}

        function failGps() {{
          setGpsLoading(false);
          alert(GPS_ERROR_MSG);
        }}

        function resolveCityPageUrl(prefName, cityName) {{
          const found = findPrefEntry(prefName);
          if (!found || !found.entry || !found.entry.slug) return null;
          const citySlug = findCitySlug(found.entry, cityName);
          if (!citySlug) return null;
          return PORTAL_BASE + found.entry.slug + "/" + citySlug + "/";
        }}

        async function geocodeAndRedirect(lng, lat) {{
          try {{
            const url =
              HEARTRAILS_GEO_API +
              "?method=searchByGeoLocation&x=" +
              encodeURIComponent(String(lng)) +
              "&y=" +
              encodeURIComponent(String(lat));
            const res = await fetch(url, {{ cache: "no-store" }});
            if (!res.ok) {{
              failGps();
              return;
            }}
            const data = await res.json();
            const loc = data && data.response && data.response.location;
            const first = Array.isArray(loc) ? loc[0] : loc;
            if (!first) {{
              failGps();
              return;
            }}
            const prefName = String(first.prefecture || "").trim();
            const cityName = String(first.city || "").trim();
            const target = resolveCityPageUrl(prefName, cityName);
            if (!target) {{
              failGps();
              return;
            }}
            window.location.href = target;
          }} catch (err) {{
            console.warn("逆ジオコーディングに失敗しました", err);
            failGps();
          }}
        }}

        function onGpsClick() {{
          if (!navigator.geolocation) {{
            failGps();
            return;
          }}
          setGpsLoading(true);
          navigator.geolocation.getCurrentPosition(
            function (pos) {{
              const lng = pos.coords.longitude;
              const lat = pos.coords.latitude;
              geocodeAndRedirect(lng, lat);
            }},
            function () {{
              failGps();
            }},
            {{ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }}
          );
        }}

        document.querySelectorAll(".portal-gps-locate-btn").forEach(function (btn) {{
          btn.addEventListener("click", onGpsClick);
        }});
      }})();
    </script>"""


def assign_company_ids(records: list[dict[str, str]]) -> None:
    """全業者に安定した company_id を付与（MySQL id 優先、なければ認定番号ベース）。"""
    used: set[str] = set()
    for row in records:
        mysql_id = (row.get("mysql_company_id") or "").strip()
        if mysql_id:
            base = mysql_id
        else:
            cert_num = extract_cert_number(row.get("cert", ""))
            pref_slug = row.get("pref_slug", "area")
            if cert_num is not None:
                base = f"c{cert_num}"
            else:
                key = "|".join(
                    [
                        pref_slug,
                        row.get("city_slug", ""),
                        row.get("name", ""),
                        row.get("phone", ""),
                        row.get("address", ""),
                    ]
                )
                digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
                base = f"h{digest}"
        cid = base
        n = 2
        while cid in used:
            cid = f"{base}-{n}"
            n += 1
        used.add(cid)
        row["company_id"] = cid


def collect_sitemap_url(
    pref_slug_map: dict[str, str],
    city_pages: list[tuple[str, str]],
    company_pages: list[tuple[str, str, str]],
) -> list[str]:
    """全国・都道府県・市町村・業者詳細ページの絶対URL一覧。"""
    urls: list[str] = [canonical_url(), f"{SITE_URL.rstrip('/')}{PORTAL_TERMS_PATH}"]
    for pref in ALL_PREFECTURES:
        urls.append(canonical_url(pref_slug_map[pref]))
    for pref_slug, city_slug in city_pages:
        urls.append(canonical_url(pref_slug, city_slug))
    for pref_slug, city_slug, company_id in company_pages:
        urls.append(canonical_url(pref_slug, city_slug, company_id))
    return urls


def write_portal_sitemap(portal_dir: Path, urls: list[str], lastmod: str) -> None:
    """public/portal/sitemap.xml を生成。"""
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for loc in urls:
        safe_loc = xml_escape(loc)
        lines.append("  <url>")
        lines.append(f"    <loc>{safe_loc}</loc>")
        lines.append(f"    <lastmod>{lastmod}</lastmod>")
        lines.append("    <changefreq>weekly</changefreq>")
        path_part = loc.replace(SITE_URL.rstrip("/"), "").strip("/")
        segments = [s for s in path_part.split("/") if s]
        if segments == ["portal"]:
            priority = "1.0"
        elif len(segments) == 2:
            priority = "0.9"
        elif len(segments) == 3:
            priority = "0.8"
        else:
            priority = "0.7"
        lines.append(f"    <priority>{priority}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    path = portal_dir / "sitemap.xml"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  出力: {path.resolve()} ({len(urls)} URL)")


def write_portal_robots(portal_dir: Path) -> None:
    """public/portal/robots.txt（ルート sitemap への参照を含む）。"""
    root = SITE_URL.rstrip("/")
    content = f"""User-agent: *
Allow: /portal/

Sitemap: {root}/sitemap.xml
Sitemap: {root}/portal/sitemap.xml
"""
    path = portal_dir / "robots.txt"
    path.write_text(content, encoding="utf-8")
    print(f"  出力: {path.resolve()}")


def render_nearby_city_links(
    prefecture: str,
    pref_slug: str,
    current_city_slug: str,
    cities: list[dict[str, object]],
) -> str:
    """同一都道府県内の他市町村への内部リンク（SEO）。"""
    others = [
        c
        for c in cities
        if str(c.get("city_slug", "")) != current_city_slug
    ]
    if not others:
        return ""
    tags = "\n".join(
        f'        <a href="{html.escape(portal_path(pref_slug, str(c["city_slug"])))}" '
        f'class="portal-nearby-link">{html.escape(str(c["city"]))}'
        f'<span class="portal-nearby-count">（{c["count"]}件）</span></a>'
        for c in others
    )
    return f"""
      <section class="portal-nearby-section mt-10" aria-labelledby="nearby-areas-heading">
        <h2 id="nearby-areas-heading" class="text-lg font-bold text-slate-100">
          {html.escape(prefecture)}の他のエリアから運転代行を探す
        </h2>
        <p class="mt-2 text-sm text-slate-600">同じ都道府県の別エリアの一覧ページです。近隣の市区町村からも業者を探せます。</p>
        <div class="portal-nearby-cloud mt-4">
{tags}
        </div>
      </section>"""


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


def feature_flag_value(rec: dict[str, str], db_key: str) -> str:
    v = rec.get(db_key, "0")
    return "1" if str(v).strip() in ("1", "true", "True") else "0"


def render_feature_badges_html(rec: dict[str, str]) -> str:
    parts: list[str] = []
    for db_key, slug, label in PORTAL_FEATURE_DEFS:
        if feature_flag_value(rec, db_key) == "1":
            parts.append(
                f'<span class="portal-feature-badge" data-feature="{html.escape(slug)}">'
                f"{html.escape(label)}</span>"
            )
    hidden_attr = " hidden" if not parts else ""
    inner = "".join(parts)
    return f'<div class="portal-feature-badges"{hidden_attr} aria-label="こだわり条件">{inner}</div>'


def card_feature_data_attrs(rec: dict[str, str]) -> str:
    attrs: list[str] = []
    for db_key, slug, _ in PORTAL_FEATURE_DEFS:
        attrs.append(f'data-{slug}="{feature_flag_value(rec, db_key)}"')
    wait = (rec.get("wait_time_minutes") or "").strip()
    if wait:
        attrs.append(f'data-wait-minutes="{html.escape(wait)}"')
    attrs.append(f'data-is-premium="{feature_flag_value(rec, "is_premium")}"')
    return " ".join(attrs)


def render_premium_badge_html(rec: dict[str, str]) -> str:
    if feature_flag_value(rec, "is_premium") != "1":
        return ""
    return (
        '<span class="portal-premium-badge portal-premium-badge--neo" aria-label="おすすめ掲載">'
        '<span class="portal-premium-badge-icon" aria-hidden="true">✦</span>'
        '<span class="portal-premium-badge-text">おすすめ</span></span>'
    )


def render_favorite_button_html(company_id: str) -> str:
    cid = (company_id or "").strip()
    if not cid:
        return ""
    cid_esc = html.escape(cid)
    return (
        f'<button type="button" class="portal-favorite-btn" data-favorite-btn '
        f'data-company-id="{cid_esc}" aria-pressed="false" '
        f'aria-label="お気に入りに追加" title="お気に入りに追加">'
        '<span class="portal-favorite-btn-icon" aria-hidden="true">⭐</span>'
        '<span class="portal-favorite-btn-text">お気に入り</span></button>'
    )


def portal_rating_from_record(rec: dict[str, str]) -> tuple[float | None, int]:
    """ポータル用平均評価・件数（reviews 集計優先）。"""
    count_raw = (rec.get("portal_review_count") or "").strip()
    avg_raw = (rec.get("portal_avg_rating") or "").strip()
    if count_raw and avg_raw:
        try:
            return float(avg_raw), int(count_raw)
        except ValueError:
            pass
    return None, 0


def render_portal_rating_html(rec: dict[str, str], *, detail: bool = False) -> str:
    avg, count = portal_rating_from_record(rec)
    if count <= 0 or avg is None:
        return ""
    label = f"⭐ {avg:.1f} ({count}件)"
    cls = "portal-rating portal-rating--detail" if detail else "portal-rating"
    return (
        f'<p class="{cls} portal-rating-stars" data-portal-avg-rating="{html.escape(f"{avg:.1f}")}" '
        f'data-portal-review-count="{count}">'
        f'<span class="portal-rating-star" aria-hidden="true">⭐</span>'
        f'<span class="portal-rating-value" aria-label="平均評価 {avg:.1f}、レビュー {count} 件">'
        f'{html.escape(f"{avg:.1f}")} <span class="portal-rating-count">({count}件)</span></span></p>'
    )


def render_portal_rating_spec_dd(rec: dict[str, str]) -> str:
    avg, count = portal_rating_from_record(rec)
    if count <= 0 or avg is None:
        return '<span class="text-slate-500">まだレビューはありません</span>'
    label = f"⭐ {avg:.1f} ({count}件)"
    return (
        f'<span class="portal-rating portal-rating--inline" data-portal-avg-rating="{html.escape(f"{avg:.1f}")}" '
        f'data-portal-review-count="{count}">{html.escape(label)}</span>'
    )


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
        f'<span class="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-xs font-medium text-slate-400">{cert}</span>'
        if cert
        else ""
    )

    call_btn = ""
    if phone:
        href = html.escape(tel_href(phone))
        call_btn = (
            f'<a href="{href}" class="portal-call-now-btn" aria-label="{html.escape(name)}に電話する">'
            '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">'
            '<path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>'
            "今すぐ電話で呼ぶ</a>"
            f'<p class="mt-1 text-center text-xs text-slate-500">{html.escape(phone)}</p>'
        )

    site_link = ""
    if website:
        site_link = (
            f'<a href="{html.escape(website)}" target="_blank" rel="noopener noreferrer" '
            'class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">公式HP</a>'
        )

    feature_attrs = card_feature_data_attrs(rec)
    badges = render_feature_badges_html(rec)
    detail_href = html.escape(company_detail_path(rec))
    company_id_attr = html.escape((rec.get("company_id") or "").strip())
    is_premium = feature_flag_value(rec, "is_premium") == "1"
    card_extra_class = " portal-card--premium" if is_premium else ""
    premium_badge = render_premium_badge_html(rec)
    favorite_btn = render_favorite_button_html(rec.get("company_id") or "")
    rating_html = render_portal_rating_html(rec)

    return (
        f'<article class="portal-glass-card flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm transition-all duration-200 hover:shadow-md{card_extra_class}" '
        f'data-prefecture="{pref_raw}" data-cert="{cert_raw}" data-company-id="{company_id_attr}" {feature_attrs}>'
        f'<div class="portal-card-header flex flex-wrap items-start justify-between gap-2">'
        f'<div class="min-w-0 flex-1">'
        f"{premium_badge}"
        f'<h2 class="text-lg font-bold leading-snug text-slate-100">'
        f'<a href="{detail_href}" class="text-slate-100 hover:text-emerald-400">{name}</a></h2>'
        f"{rating_html}"
        f"{cert_badge}</div>"
        f"{favorite_btn}</div>"
        f'<p class="mt-1 text-xs font-medium text-brand">{pref} · {city}</p>'
        f"{badges}"
        f'<p class="mt-2 flex items-start gap-1.5 text-sm text-slate-600"><span>{pref} {addr}</span></p>'
        '<div class="portal-live hidden" data-live-slot="1" aria-live="polite" hidden></div>'
        f"{site_link}"
        f'<a href="{detail_href}" class="portal-detail-link">詳細を見る →</a>'
        f"{call_btn}</article>"
    )


def render_empty_listing_cta(prefecture: str, city: str | None = None) -> str:
    area_label = f"{prefecture} · {city}" if city else prefecture
    reg_url = register_url_for_prefecture(prefecture)
    return f"""
      <div class="portal-empty-cta" role="status">
        <p class="portal-empty-cta-title">このエリアの掲載はまだありません</p>
        <p class="portal-empty-cta-text">
          現在、<strong>{html.escape(area_label)}</strong>で掲載されている運転代行業者はありません。
          掲載を希望される業者様は、今すぐ無料で会員登録して情報を掲載できます！
        </p>
        <a href="{html.escape(reg_url)}"
           class="portal-empty-cta-btn">
          無料で掲載登録する（{html.escape(prefecture)}）→
        </a>
      </div>"""


def render_live_only_filter() -> str:
    chips = "\n".join(
        f'        <button type="button" class="portal-feature-chip" data-filter="{html.escape(slug)}" '
        f'aria-pressed="false">{html.escape(label)}</button>'
        for _db, slug, label in PORTAL_FEATURE_DEFS
    )
    return f"""
      <div class="portal-listing-filters">
        <div class="portal-live-filter" role="group" aria-labelledby="live-filter-label">
          <label class="portal-live-filter-label" for="live-only-toggle">
            <input type="checkbox" id="live-only-toggle" class="portal-live-filter-input" />
            <span class="portal-live-filter-track" aria-hidden="true"></span>
            <span id="live-filter-label" class="portal-live-filter-text">今すぐ呼べる（本日営業中）業者だけを表示</span>
          </label>
          <p class="portal-live-filter-hint">会員がリアルタイム配信している営業中の店舗のみ表示します</p>
        </div>
        <div class="portal-feature-filters" role="group" aria-label="こだわり条件で絞り込み">
          <p class="portal-feature-filters-label">こだわりで絞り込み（複数選択可）</p>
          <div class="portal-feature-filters-chips">
{chips}
          </div>
        </div>
      </div>
      <p id="live-filter-empty" class="portal-live-filter-empty hidden" role="status">
        現在、このエリアでリアルタイム情報を配信している業者はいません。しばらくしてから再度お試しください。
      </p>
      <p id="feature-filter-empty" class="portal-live-filter-empty hidden" role="status">
        選択したこだわり条件に一致する業者がありません。条件を変えてお試しください。
      </p>
      <div class="portal-pwa-install-inline md:hidden" aria-hidden="true">
        <p class="portal-pwa-install-inline-text">📱 ホーム画面に追加すると、アプリのようにすぐ開けます</p>
        <button type="button" class="portal-pwa-install-inline-btn" data-portal-pwa-scroll-install>
          追加方法を見る
        </button>
      </div>"""


def render_cards_grid(records: list[dict[str, str]], *, with_live_filter: bool = True) -> str:
    sorted_recs = sorted(
        records,
        key=lambda r: (
            0 if feature_flag_value(r, "is_premium") == "1" else 1,
            r.get("city") or "",
            r.get("name") or "",
        ),
    )
    cards = "\n".join(card_article_html(r) for r in sorted_recs)
    count = len(sorted_recs)
    filter_block = render_live_only_filter() if with_live_filter else ""
    return f"""
      <div id="portal-shop-banner" class="portal-shop-banner hidden" role="status">
        <p class="portal-shop-banner-title">🍶 飲食店モード — 今すぐ呼べる代行</p>
        <p class="portal-shop-banner-sub">営業中の店舗だけ表示しています。タップで電話発信</p>
      </div>
      {filter_block}
      <p id="result-count-line" class="mb-4 text-sm text-slate-600 portal-shop-hide">
        掲載 <strong id="result-count" class="text-slate-100">{count}</strong> 件
      </p>
      <p id="portal-shop-empty" class="portal-shop-empty hidden" role="status">
        現在、リアルタイムで営業中の代行はありません。しばらくしてから再度お試しください。
      </p>
      <div id="card-grid" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
{cards}
      </div>"""


def render_listing_section(
    records: list[dict[str, str]],
    prefecture: str,
    city: str | None = None,
) -> str:
    if not records:
        return render_empty_listing_cta(prefecture, city)
    return render_cards_grid(records, with_live_filter=True)


def render_hero(
    *,
    level: str,
    headline: str,
    subline: str,
    eyebrow: str = "運転代行ポータル",
    badge_live: bool = True,
    show_gps_hero: bool = False,
) -> str:
    live_badge = (
        '<span class="portal-hero-badge portal-hero-badge--live">'
        '<span class="portal-live-dot" aria-hidden="true"></span> 本日営業中をリアルタイム表示</span>'
        if badge_live
        else ""
    )
    gps_block = render_gps_locate_button_html(variant="hero") if show_gps_hero else ""
    ride_btn = render_ride_request_hero_button()
    return f"""
    <section class="portal-hero" aria-labelledby="portal-hero-title">
      <div class="portal-hero-inner">
        <p class="portal-hero-eyebrow">{html.escape(eyebrow)}</p>
        <h2 id="portal-hero-title" class="portal-hero-title">{html.escape(headline)}</h2>
        <p class="portal-hero-sub">{html.escape(subline)}</p>
        <div class="portal-hero-badges">
          <span class="portal-hero-badge">📍 {html.escape(level)}</span>
          {live_badge}
        </div>
        {ride_btn}
        {gps_block}
      </div>
    </section>"""


def render_sticky_mobile_nav(
    *,
    page_kind: str,
    prefecture: str = "",
    pref_slug: str = "",
) -> str:
    """page_kind: national | prefecture | city | detail"""
    gps_btn = render_gps_locate_button_html(variant="sticky")
    list_anchor = "#portal-regions" if page_kind == "national" else "#portal-list-heading"

    ride_sticky_btn = (
        '<button type="button" class="portal-sticky-nav-btn portal-sticky-nav-btn--ride portal-ride-open-btn" '
        'id="portal-ride-open-sticky" aria-label="一斉配車リクエスト">'
        '<span class="portal-sticky-nav-ride-icon" aria-hidden="true">⚡</span>'
        '<span class="portal-sticky-nav-ride-label">配車</span></button>'
    )
    return f"""
    <nav class="portal-sticky-nav md:hidden" aria-label="スマホ用クイックナビ">
      <a href="{html.escape(PORTAL_BASE)}" class="portal-sticky-nav-btn portal-sticky-nav-btn--side">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
        トップ</a>
      {gps_btn}
      {ride_sticky_btn}
      <a href="{list_anchor}" class="portal-sticky-nav-btn portal-sticky-nav-btn--side">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
        一覧へ</a>
    </nav>"""


def render_national_area_sheet(pref_slug_map: dict[str, str]) -> str:
    links = "\n".join(
        f'<li><a href="{html.escape(portal_path(pref_slug_map[p]))}" class="portal-pref-link">'
        f"{html.escape(p)}</a></li>"
        for p in ALL_PREFECTURES
    )
    return f"""
    <div id="portal-area-sheet" class="portal-area-sheet" role="dialog" aria-modal="true" aria-labelledby="area-sheet-title" hidden>
      <div class="portal-area-sheet-panel">
        <button type="button" class="portal-area-sheet-close" id="area-sheet-close" aria-label="閉じる">×</button>
        <h3 id="area-sheet-title" class="portal-area-sheet-title">都道府県を選ぶ</h3>
        <ul class="portal-pref-list grid grid-cols-1 gap-2 sm:grid-cols-2">
{links}
        </ul>
      </div>
    </div>"""


def render_shop_mode_early_script() -> str:
    """?mode=shop 時の FOUC 防止（<html> にクラス付与）。"""
    return """    <script>
      (function () {
        try {
          var m = new URLSearchParams(location.search).get("mode");
          if (m === "shop") {
            document.documentElement.classList.add("portal--shop-mode");
          }
        } catch (e) {}
      })();
    </script>
"""


def render_header(h1: str, subtitle: str = "全国対応") -> str:
    return f"""
    <header class="portal-site-header sticky top-0 z-50 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
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
             class="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 no-underline shadow-sm hover:border-emerald-500/50 hover:text-emerald-400 transition-all duration-200 active:scale-95">
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


def build_terms_page() -> str:
    """利用規約・プライバシーポリシー・免責事項（全ポータル共通）。"""
    terms_canonical = f"{SITE_URL.rstrip('/')}{PORTAL_TERMS_PATH}"
    body_sections = """
      <section class="portal-terms-section rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-6 shadow-sm sm:p-8">
        <h2 class="portal-terms-h2">第1条（本サービスの性質）</h2>
        <p class="portal-terms-p">
          本サイト（運転代行ポータル、以下「本サービス」）は、運転代行業者の情報を仲介・掲載しているポータルサイトであり、
          運転代行業務そのものの提供主体ではありません。利用者と各運転代行業者との間で締結される契約・取引・運送等について、
          運営者は当事者とならず、一切関与いたしません。
        </p>
      </section>
      <section class="portal-terms-section rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50 to-white p-6 shadow-sm ring-2 ring-amber-100 sm:p-8">
        <h2 class="portal-terms-h2 text-amber-900">第2条（免責事項・責任の限定）</h2>
        <p class="portal-terms-p font-semibold text-slate-800">
          本サイトは運転代行業者の情報を仲介・掲載しているポータルサイトであり、
          <strong class="text-amber-900">実際の代行業務における事故、料金トラブル、遅延、器物損壊、人身事故、犯罪、法令違反、
          サービス内容の相違、クレーム、その他一切のトラブル等に関して、運営者は一切の責任を負いません。</strong>
        </p>
        <ul class="portal-terms-list mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>掲載情報（電話番号・料金・営業状況・所在地等）は、公開情報・会員登録情報等に基づき自動または手動で掲載しており、正確性・最新性・完全性を保証するものではありません。</li>
          <li>会員による「リアルタイム情報」は各業者が自己責任で配信するものであり、運営者はその内容を保証しません。</li>
          <li>本サービスの利用または利用不能により生じた損害（間接損害・逸失利益を含む）について、運営者の故意または重過失がある場合を除き、一切の賠償責任を負いません。</li>
          <li>利用者は、代行依頼前に各業者へ料金・条件・保険等を直接ご確認のうえ、自己の責任でご利用ください。</li>
        </ul>
      </section>
      <section class="portal-terms-section rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-6 shadow-sm sm:p-8">
        <h2 class="portal-terms-h2">第3条（プライバシーポリシー）</h2>
        <p class="portal-terms-p">
          本サービスでは、サイト改善のため Google Analytics 等のアクセス解析を利用する場合があります。
          会員登録時に取得するメールアドレス等は、掲載管理・本人確認・お問い合わせ対応の目的で利用し、法令に基づく場合を除き、
          同意なく第三者に提供しません。位置情報（GPS検索）を利用する場合、ブラウザの許可に基づき一時的に処理し、
          運営者サーバーへの恒久的な保存は行いません（外部ジオコーディングAPI利用時を除く）。
        </p>
      </section>
      <section class="portal-terms-section rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-6 shadow-sm sm:p-8">
        <h2 class="portal-terms-h2">第4条（掲載業者・会員）</h2>
        <p class="portal-terms-p">
          掲載希望の業者は、正確な情報を登録・維持する責任を負います。虚偽の掲載、第三者の権利侵害、
          法令違反が判明した場合、運営者は事前の通知なく掲載の停止・削除等の措置を行うことがあります。
        </p>
      </section>
      <section class="portal-terms-section rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-6 shadow-sm sm:p-8">
        <h2 class="portal-terms-h2">第5条（規約の変更）</h2>
        <p class="portal-terms-p">
          運営者は、必要に応じて本規約を変更できます。変更後の規約は、本ページに掲載した時点から効力を生じます。
          重要な変更がある場合は、本サイト上で合理的な方法により告知します。
        </p>
        <p class="portal-terms-p mt-4 text-xs text-slate-500">最終更新: """ + html.escape(str(date.today())) + """</p>
      </section>"""
    main = f"""
{render_breadcrumbs([
    ("トップ", PORTAL_BASE),
    ("利用規約・免責事項", None),
])}
      <div class="portal-terms-prose mx-auto max-w-3xl">
        <p class="mb-6 text-sm leading-relaxed text-slate-600">
          本ページは、運転代行ポータル（{html.escape(SITE_URL)}）のご利用にあたっての条件を定めるものです。
          ご利用前に必ずお読みください。
        </p>
{body_sections}
        <p class="mt-8 text-center">
          <a href="{html.escape(PORTAL_BASE)}" class="inline-flex rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white no-underline shadow-sm hover:bg-blue-800">
            ポータルトップへ戻る
          </a>
        </p>
      </div>
"""
    return page_shell(
        title="利用規約・プライバシーポリシー・免責事項｜運転代行ポータル",
        description="運転代行ポータルの利用規約、プライバシーポリシー、免責事項。掲載情報の仲介に関する責任限定について定めています。",
        canonical=terms_canonical,
        h1="利用規約・免責事項",
        hero_html=render_hero(
            level="全国",
            headline="利用規約・プライバシーポリシー・免責事項",
            subline="本サイトのご利用条件と、運営者の責任範囲についてご確認ください。",
            badge_live=False,
        ),
        main_body=main,
        sticky_nav_html=render_sticky_mobile_nav(page_kind="national"),
        page_js=portal_sticky_nav_js(),
        subtitle="運営情報",
        area_map={},
    )


def render_footer() -> str:
    return f"""
    <footer class="mt-12 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md">
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
          · <a href="{html.escape(PORTAL_TERMS_PATH)}" class="text-brand hover:underline">利用規約・免責事項</a>
          · <a href="{html.escape(MEMBER_REGISTER_URL)}" class="text-brand hover:underline">業者会員登録</a>
          · <a href="{html.escape(MEMBER_LOGIN_URL)}" class="text-brand hover:underline">会員ログイン</a>
        </p>
      </section>
    </footer>"""


def render_portal_body_data_attrs(
    *,
    pref_slug: str = "",
    city_slug: str = "",
    city_name: str = "",
    prefecture: str = "",
) -> str:
    parts: list[str] = []
    if pref_slug:
        parts.append(f'data-portal-pref-slug="{html.escape(pref_slug)}"')
    if city_slug:
        parts.append(f'data-portal-city-slug="{html.escape(city_slug)}"')
    if city_name:
        parts.append(f'data-portal-city-name="{html.escape(city_name)}"')
    if prefecture:
        parts.append(f'data-portal-prefecture="{html.escape(prefecture)}"')
    return " ".join(parts)


def render_ride_request_hero_button() -> str:
    return """
        <button type="button" class="portal-ride-open-btn portal-ride-open-btn--hero portal-ride-hide-shop" aria-haspopup="dialog">
          ⚡ 近くの営業中業者に一斉リクエスト（電話不要）
        </button>"""


def render_ride_request_fab() -> str:
    return """
    <button type="button" class="portal-ride-fab portal-ride-open-btn portal-ride-hide-shop hidden md:inline-flex" aria-haspopup="dialog">
      ⚡ 一斉配車リクエスト
    </button>"""


def render_ride_request_modal_html() -> str:
    return """
    <div id="portal-ride-modal" class="portal-ride-modal hidden" role="dialog" aria-modal="true" aria-labelledby="portal-ride-modal-title" hidden>
      <div class="portal-ride-modal-backdrop" data-portal-ride-close="1"></div>
      <div class="portal-ride-modal-panel">
        <button type="button" class="portal-ride-modal-close" data-portal-ride-close="1" aria-label="閉じる">×</button>
        <div id="portal-ride-step-form">
          <h2 id="portal-ride-modal-title" class="portal-ride-modal-title">⚡ 一斉配車リクエスト</h2>
          <p class="portal-ride-modal-lead">営業中の代行に一斉通知。一番早く対応した店舗がお迎えに向かいます（電話不要でマッチング）。</p>
          <p id="portal-ride-area-hint" class="portal-ride-area-hint hidden" role="status"></p>
          <p id="portal-ride-surge-badge-form" class="portal-ride-surge-badge hidden" role="status"></p>
          <form id="portal-ride-form" class="portal-ride-form">
            <label class="portal-ride-label">お名前 *
              <input type="text" name="user_name" required maxlength="128" class="portal-ride-input" placeholder="例: 山田 太郎" />
            </label>
            <label class="portal-ride-label">電話番号 *
              <input type="tel" name="user_phone" required class="portal-ride-input" placeholder="例: 09012345678" />
            </label>
            <label class="portal-ride-label">現在地・お迎え先 *
              <input type="text" name="location_details" required class="portal-ride-input" placeholder="例: ○○駅北口・△△ビル前" />
            </label>
            <button type="submit" class="portal-ride-submit-btn">リクエストを送信する</button>
          </form>
        </div>
        <div id="portal-ride-step-waiting" class="portal-ride-step-waiting hidden" aria-live="polite">
          <div class="portal-ride-spinner" aria-hidden="true"></div>
          <p class="portal-ride-waiting-title">業者からの応答を待っています...</p>
          <p class="portal-ride-waiting-sub">営業中の代行店に通知しました。しばらくお待ちください。</p>
        </div>
        <div id="portal-ride-step-success" class="portal-ride-step-success hidden" aria-live="polite">
          <p class="portal-ride-success-emoji">🎉</p>
          <h3 class="portal-ride-success-title" id="portal-ride-success-title">マッチング成功！</h3>
          <p class="portal-ride-success-body" id="portal-ride-success-body"></p>
          <div id="portal-ride-track-wrap" class="portal-ride-track-wrap hidden">
            <p class="portal-ride-track-label">ドライバーの現在地</p>
            <div id="portal-ride-track-map" class="portal-ride-track-map" role="img" aria-label="お迎え先とドライバー位置の地図"></div>
            <p id="portal-ride-track-hint" class="portal-ride-track-hint">位置情報が届くと地図に🚗が表示されます</p>
          </div>
          <div id="portal-ride-payment-wrap" class="portal-ride-payment-wrap hidden">
            <p class="portal-ride-payment-label">お支払い</p>
            <p id="portal-ride-surge-badge-pay" class="portal-ride-surge-badge hidden" role="status"></p>
            <p id="portal-ride-payment-amount" class="portal-ride-payment-amount">—</p>
            <p id="portal-ride-payment-note" class="portal-ride-payment-note">確定料金（目安）はマッチング店舗の料金設定に基づきます</p>
            <div id="portal-ride-payment-paid" class="portal-ride-payment-paid hidden">
              <span class="portal-ride-payment-paid-badge">✓ お支払い済み</span>
            </div>
            <div id="portal-ride-payment-form" class="portal-ride-payment-form">
              <div id="portal-ride-coupon-wrap" class="portal-ride-coupon-wrap">
                <p class="portal-ride-coupon-label">プロモーションコード（クーポン）</p>
                <div class="portal-ride-coupon-row">
                  <input type="text" id="portal-ride-coupon-code" class="portal-ride-input portal-ride-coupon-input"
                         placeholder="例: WELCOME500" autocomplete="off" />
                  <button type="button" id="portal-ride-coupon-apply" class="portal-ride-coupon-apply-btn">適用</button>
                </div>
                <p id="portal-ride-coupon-msg" class="portal-ride-coupon-msg hidden" role="status"></p>
              </div>
              <div id="portal-ride-stripe-element" class="portal-ride-stripe-mock-card">
                <p class="portal-ride-stripe-mock-title">カード情報（テスト環境）</p>
                <input type="text" id="portal-ride-card-mock" class="portal-ride-input" placeholder="4242 4242 4242 4242" autocomplete="cc-number" />
              </div>
              <button type="button" id="portal-ride-pay-btn" class="portal-ride-pay-btn">
                💳 クレジットカード / PayPay で支払う
              </button>
              <p id="portal-ride-payment-error" class="portal-ride-payment-error hidden" role="alert"></p>
            </div>
          </div>
          <a href="#" id="portal-ride-success-call" class="portal-ride-success-call-btn">今すぐ電話する</a>
          <button type="button" id="portal-ride-cancel-btn" class="portal-ride-cancel-btn">リクエストをキャンセルする</button>
          <button type="button" class="portal-ride-success-close" data-portal-ride-close="1">閉じる</button>
        </div>
        <p id="portal-ride-error" class="portal-ride-error hidden" role="alert"></p>
      </div>
      <div id="portal-ride-cancel-warn" class="portal-ride-cancel-warn hidden" role="alertdialog" aria-modal="true" aria-labelledby="portal-ride-cancel-warn-title" hidden>
        <div class="portal-ride-cancel-warn-backdrop" data-portal-cancel-warn-close="1"></div>
        <div class="portal-ride-cancel-warn-panel">
          <h3 id="portal-ride-cancel-warn-title" class="portal-ride-cancel-warn-title">キャンセルの確認</h3>
          <p id="portal-ride-cancel-warn-body" class="portal-ride-cancel-warn-body"></p>
          <div class="portal-ride-cancel-warn-actions">
            <button type="button" class="portal-ride-cancel-warn-back" data-portal-cancel-warn-close="1">戻る</button>
            <button type="button" id="portal-ride-cancel-confirm" class="portal-ride-cancel-warn-confirm">同意してキャンセル</button>
          </div>
        </div>
      </div>
    </div>
    <div id="portal-review-modal" class="portal-review-modal hidden" role="dialog" aria-modal="true"
         aria-labelledby="portal-review-modal-title" hidden>
      <div class="portal-review-modal-backdrop" data-portal-review-close="1"></div>
      <div class="portal-review-modal-panel">
        <h2 id="portal-review-modal-title" class="portal-review-modal-title">ご利用ありがとうございました</h2>
        <p class="portal-review-modal-lead">マッチした代行店のサービスはいかがでしたか？星評価とコメントをお願いします。</p>
        <div class="portal-review-stars" role="group" aria-label="5段階評価">
          <button type="button" class="portal-review-star" data-rating="1" aria-label="1つ星">★</button>
          <button type="button" class="portal-review-star" data-rating="2" aria-label="2つ星">★</button>
          <button type="button" class="portal-review-star" data-rating="3" aria-label="3つ星">★</button>
          <button type="button" class="portal-review-star" data-rating="4" aria-label="4つ星">★</button>
          <button type="button" class="portal-review-star" data-rating="5" aria-label="5つ星">★</button>
        </div>
        <p id="portal-review-rating-hint" class="portal-review-rating-hint">タップして評価を選択</p>
        <label class="portal-review-label" for="portal-review-comment">コメント（任意）</label>
        <textarea id="portal-review-comment" class="portal-review-textarea" rows="3"
                  maxlength="2000" placeholder="お迎えの速さ、ドライバーの対応など"></textarea>
        <p id="portal-review-error" class="portal-review-error hidden" role="alert"></p>
        <div class="portal-review-actions">
          <button type="button" id="portal-review-submit" class="portal-review-submit" disabled>レビューを送信</button>
          <button type="button" class="portal-review-skip" data-portal-review-close="1">あとで</button>
        </div>
      </div>
    </div>"""


def portal_ride_request_js() -> str:
    request_api = json.dumps(REQUEST_RIDE_API)
    check_api = json.dumps(CHECK_RIDE_STATUS_API)
    create_payment_api = json.dumps(CREATE_PAYMENT_API)
    payment_webhook_api = json.dumps(PAYMENT_WEBHOOK_API)
    mock_payment_token = json.dumps("dev_portal_payment_mock")
    cancel_ride_api = json.dumps(CANCEL_RIDE_API)
    get_surge_api = json.dumps(GET_SURGE_MULTIPLIER_API)
    save_review_api = json.dumps(SAVE_REVIEW_API)
    apply_coupon_api = json.dumps(APPLY_COUPON_API)
    return f"""
    <script>
      (function () {{
        const REQUEST_API = {request_api};
        const CHECK_API = {check_api};
        const CREATE_PAYMENT_API = {create_payment_api};
        const PAYMENT_WEBHOOK_API = {payment_webhook_api};
        const CANCEL_RIDE_API = {cancel_ride_api};
        const GET_SURGE_API = {get_surge_api};
        const SAVE_REVIEW_API = {save_review_api};
        const APPLY_COUPON_API = {apply_coupon_api};
        const MOCK_PAYMENT_TOKEN = {mock_payment_token};
        const SHOP_REF_STORAGE_KEY = "portal_shop_ref_v1";
        const CANCEL_GRACE_MINUTES = 5;
        const CANCEL_FEE_YEN = 1000;
        const modal = document.getElementById("portal-ride-modal");
        if (!modal) return;

        const stepForm = document.getElementById("portal-ride-step-form");
        const stepWaiting = document.getElementById("portal-ride-step-waiting");
        const stepSuccess = document.getElementById("portal-ride-step-success");
        const form = document.getElementById("portal-ride-form");
        const errEl = document.getElementById("portal-ride-error");
        const areaHint = document.getElementById("portal-ride-area-hint");
        const successTitle = document.getElementById("portal-ride-success-title");
        const successBody = document.getElementById("portal-ride-success-body");
        const successCall = document.getElementById("portal-ride-success-call");
        const trackWrap = document.getElementById("portal-ride-track-wrap");
        const trackHint = document.getElementById("portal-ride-track-hint");
        const paymentWrap = document.getElementById("portal-ride-payment-wrap");
        const paymentAmount = document.getElementById("portal-ride-payment-amount");
        const paymentPaid = document.getElementById("portal-ride-payment-paid");
        const paymentForm = document.getElementById("portal-ride-payment-form");
        const paymentErr = document.getElementById("portal-ride-payment-error");
        const payBtn = document.getElementById("portal-ride-pay-btn");
        const cancelBtn = document.getElementById("portal-ride-cancel-btn");
        const cancelWarn = document.getElementById("portal-ride-cancel-warn");
        const cancelWarnBody = document.getElementById("portal-ride-cancel-warn-body");
        const cancelConfirmBtn = document.getElementById("portal-ride-cancel-confirm");
        const modalPanel = modal.querySelector(".portal-ride-modal-panel");
        let pollTimer = null;
        let activeRequestId = null;
        let matchedOnce = false;
        let pendingPickupCoords = null;
        let trackState = null;
        let paymentSession = null;
        let stripeInstance = null;
        let stripeElements = null;
        let stripeCard = null;
        let matchedAcceptedAt = null;
        let cancelPolicy = null;
        let currentSurge = {{ multiplier: 1.0, show_surge_badge: false, surge_label: "" }};
        let reviewModalShownFor = null;
        let selectedReviewRating = 0;
        let appliedCouponDiscount = 0;

        const couponCodeInput = document.getElementById("portal-ride-coupon-code");
        const couponApplyBtn = document.getElementById("portal-ride-coupon-apply");
        const couponMsg = document.getElementById("portal-ride-coupon-msg");

        function captureShopRefFromUrl() {{
          try {{
            const ref = new URLSearchParams(location.search).get("ref");
            if (ref && String(ref).trim()) {{
              sessionStorage.setItem(SHOP_REF_STORAGE_KEY, String(ref).trim());
            }}
          }} catch (e) {{}}
        }}

        function getShopRefId() {{
          try {{
            const v = sessionStorage.getItem(SHOP_REF_STORAGE_KEY);
            const n = parseInt(v || "0", 10);
            return n > 0 ? n : null;
          }} catch (e) {{
            return null;
          }}
        }}

        captureShopRefFromUrl();

        const reviewModal = document.getElementById("portal-review-modal");
        const reviewStars = reviewModal ? reviewModal.querySelectorAll(".portal-review-star") : [];
        const reviewHint = document.getElementById("portal-review-rating-hint");
        const reviewComment = document.getElementById("portal-review-comment");
        const reviewSubmit = document.getElementById("portal-review-submit");
        const reviewErr = document.getElementById("portal-review-error");

        function reviewDoneKey(id) {{
          return "portal_review_done_v1_" + String(id);
        }}

        function isReviewDone(id) {{
          try {{
            return sessionStorage.getItem(reviewDoneKey(id)) === "1";
          }} catch (e) {{
            return false;
          }}
        }}

        function markReviewDone(id) {{
          try {{
            sessionStorage.setItem(reviewDoneKey(id), "1");
          }} catch (e) {{}}
        }}

        function setReviewStars(rating) {{
          selectedReviewRating = rating;
          reviewStars.forEach(function (btn) {{
            const v = parseInt(btn.getAttribute("data-rating") || "0", 10);
            btn.classList.toggle("portal-review-star--on", v > 0 && v <= rating);
            btn.setAttribute("aria-pressed", v <= rating && v > 0 ? "true" : "false");
          }});
          if (reviewHint) {{
            reviewHint.textContent = rating > 0 ? rating + " / 5" : "タップして評価を選択";
          }}
          if (reviewSubmit) reviewSubmit.disabled = rating < 1;
        }}

        function openReviewModal() {{
          if (!reviewModal || !activeRequestId) return;
          reviewModal.classList.remove("hidden");
          reviewModal.hidden = false;
          document.body.classList.add("portal-review-modal-open");
          setReviewStars(0);
          if (reviewComment) reviewComment.value = "";
          if (reviewErr) {{
            reviewErr.textContent = "";
            reviewErr.classList.add("hidden");
          }}
        }}

        function closeReviewModal() {{
          if (!reviewModal) return;
          reviewModal.classList.add("hidden");
          reviewModal.hidden = true;
          document.body.classList.remove("portal-review-modal-open");
        }}

        function maybePromptReview(data) {{
          if (!activeRequestId || reviewModalShownFor === activeRequestId) return;
          if (isReviewDone(activeRequestId)) return;
          if (data && data.review_submitted) {{
            markReviewDone(activeRequestId);
            return;
          }}
          const paid = data && data.payment && (data.payment.paid || data.payment.payment_status === "paid");
          if (!paid) return;
          reviewModalShownFor = activeRequestId;
          setTimeout(openReviewModal, 400);
        }}

        function submitReview() {{
          if (!activeRequestId || selectedReviewRating < 1) return;
          if (reviewSubmit) reviewSubmit.disabled = true;
          if (reviewErr) reviewErr.classList.add("hidden");
          fetch(SAVE_REVIEW_API, {{
            method: "POST",
            headers: {{ "Content-Type": "application/json" }},
            body: JSON.stringify({{
              ride_request_id: activeRequestId,
              rating: selectedReviewRating,
              comment: reviewComment ? reviewComment.value : "",
            }}),
          }})
            .then(function (res) {{ return res.json(); }})
            .then(function (result) {{
              if (result && result.ok) {{
                markReviewDone(activeRequestId);
                closeReviewModal();
                return;
              }}
              if (reviewErr) {{
                reviewErr.textContent = (result && result.message) || "送信に失敗しました。";
                reviewErr.classList.remove("hidden");
              }}
            }})
            .catch(function () {{
              if (reviewErr) {{
                reviewErr.textContent = "通信エラーが発生しました。";
                reviewErr.classList.remove("hidden");
              }}
            }})
            .finally(function () {{
              if (reviewSubmit) reviewSubmit.disabled = selectedReviewRating < 1;
            }});
        }}

        function bodyData() {{
          const b = document.body;
          return {{
            prefSlug: b.getAttribute("data-portal-pref-slug") || "",
            citySlug: b.getAttribute("data-portal-city-slug") || "",
            cityName: b.getAttribute("data-portal-city-name") || "",
            prefecture: b.getAttribute("data-portal-prefecture") || "",
          }};
        }}

        function showError(msg) {{
          if (!errEl) return;
          errEl.textContent = msg || "";
          errEl.classList.toggle("hidden", !msg);
        }}

        function showStep(step) {{
          if (stepForm) stepForm.classList.toggle("hidden", step !== "form");
          if (stepWaiting) stepWaiting.classList.toggle("hidden", step !== "waiting");
          if (stepSuccess) stepSuccess.classList.toggle("hidden", step !== "success");
          if (modalPanel) {{
            modalPanel.classList.toggle("portal-ride-modal-panel--tracking", step === "success");
          }}
        }}

        function openModal() {{
          const d = bodyData();
          if (!d.citySlug || !d.cityName || !d.prefecture) {{
            if (areaHint) {{
              areaHint.textContent = "市区町村ページ（一覧があるページ）でご利用ください。GPSで近くの市区町村へ移動してからお試しください。";
              areaHint.classList.remove("hidden");
            }}
          }} else if (areaHint) {{
            areaHint.textContent = "対象エリア: " + d.prefecture + " " + d.cityName;
            areaHint.classList.remove("hidden");
          }}
          fetchSurgeMultiplier();
          matchedOnce = false;
          showStep("form");
          showError("");
          modal.classList.remove("hidden");
          modal.hidden = false;
          document.body.classList.add("portal-ride-modal-open");
        }}

        function closeModal() {{
          if (pollTimer) {{
            clearInterval(pollTimer);
            pollTimer = null;
          }}
          if (trackState && trackState.animFrame) {{
            cancelAnimationFrame(trackState.animFrame);
          }}
          trackState = null;
          modal.classList.add("hidden");
          modal.hidden = true;
          document.body.classList.remove("portal-ride-modal-open");
        }}

        function loadLeafletAssets() {{
          if (window.L) return Promise.resolve();
          var cssHref = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
          if (!document.querySelector('link[data-portal-leaflet="1"]')) {{
            var link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = cssHref;
            link.setAttribute("data-portal-leaflet", "1");
            document.head.appendChild(link);
          }}
          return new Promise(function (resolve, reject) {{
            if (window.L) {{
              resolve();
              return;
            }}
            var s = document.createElement("script");
            s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
            s.async = true;
            s.onload = function () {{ resolve(); }};
            s.onerror = function () {{ reject(new Error("leaflet load failed")); }};
            document.head.appendChild(s);
          }});
        }}

        function geocodePickup(data) {{
          if (data.pickup_lat != null && data.pickup_lng != null) {{
            return Promise.resolve([data.pickup_lat, data.pickup_lng]);
          }}
          if (pendingPickupCoords) {{
            return Promise.resolve(pendingPickupCoords);
          }}
          var q = [data.prefecture, data.city_name, data.location_details].filter(Boolean).join(" ");
          if (!q) return Promise.resolve(null);
          var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
            + encodeURIComponent(q);
          return fetch(url, {{
            headers: {{ "Accept": "application/json", "Accept-Language": "ja" }}
          }})
            .then(function (res) {{ return res.json(); }})
            .then(function (rows) {{
              if (!rows || !rows[0]) return null;
              return [parseFloat(rows[0].lat), parseFloat(rows[0].lon)];
            }})
            .catch(function () {{ return null; }});
        }}

        function fitMapToMarkers(state) {{
          if (!state || !state.map) return;
          var bounds = [];
          if (state.pickupMarker) bounds.push(state.pickupMarker.getLatLng());
          if (state.driverMarker) bounds.push(state.driverMarker.getLatLng());
          if (bounds.length >= 2) {{
            state.map.fitBounds(L.latLngBounds(bounds), {{ padding: [36, 36], maxZoom: 16 }});
          }} else if (bounds.length === 1) {{
            state.map.setView(bounds[0], 15);
          }}
        }}

        function animateDriverTo(state, lat, lng) {{
          if (!state || !state.driverMarker) return;
          var from = state.driverDisplayPos || state.driverMarker.getLatLng();
          var to = L.latLng(lat, lng);
          var start = performance.now();
          var duration = 700;
          if (state.animFrame) cancelAnimationFrame(state.animFrame);
          function frame(now) {{
            var t = Math.min(1, (now - start) / duration);
            var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            var curLat = from.lat + (to.lat - from.lat) * eased;
            var curLng = from.lng + (to.lng - from.lng) * eased;
            state.driverMarker.setLatLng([curLat, curLng]);
            state.driverDisplayPos = L.latLng(curLat, curLng);
            if (t < 1) {{
              state.animFrame = requestAnimationFrame(frame);
            }} else {{
              state.animFrame = null;
              state.driverDisplayPos = to;
            }}
          }}
          state.animFrame = requestAnimationFrame(frame);
        }}

        function ensureDriverMarker(state, lat, lng) {{
          if (!state || !state.map || !window.L) return;
          var carIcon = L.divIcon({{
            className: "portal-ride-car-marker",
            html: '<span class="portal-ride-car-pin" aria-hidden="true">🚗</span>',
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }});
          if (!state.driverMarker) {{
            state.driverMarker = L.marker([lat, lng], {{ icon: carIcon, zIndexOffset: 1000 }}).addTo(state.map);
            state.driverDisplayPos = L.latLng(lat, lng);
            if (trackHint) trackHint.textContent = "ドライバーが向かっています";
          }} else {{
            animateDriverTo(state, lat, lng);
          }}
        }}

        function initTrackingMap(data) {{
          if (!trackWrap) return;
          trackWrap.classList.remove("hidden");
          loadLeafletAssets().then(function () {{
            var el = document.getElementById("portal-ride-track-map");
            if (!el || !window.L) return;
            if (trackState && trackState.map) {{
              trackState.map.remove();
            }}
            trackState = {{
              map: L.map(el, {{ zoomControl: true, attributionControl: true }}),
              pickupMarker: null,
              driverMarker: null,
              driverDisplayPos: null,
              animFrame: null,
            }};
            L.tileLayer("https://{{s}}.basemaps.cartocdn.com/dark_all/{{z}}/{{x}}/{{y}}{{r}}.png", {{
              maxZoom: 19,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            }}).addTo(trackState.map);

            var pickupIcon = L.divIcon({{
              className: "portal-ride-pickup-marker",
              html: '<span aria-hidden="true">📍</span>',
              iconSize: [28, 28],
              iconAnchor: [14, 28],
            }});

            return geocodePickup(data).then(function (pickup) {{
              if (pickup && pickup.length === 2) {{
                trackState.pickupMarker = L.marker(pickup, {{ icon: pickupIcon }}).addTo(trackState.map);
                trackState.map.setView(pickup, 14);
              }} else {{
                trackState.map.setView([35.6812, 139.7671], 10);
                if (trackHint) trackHint.textContent = "お迎え先を地図に表示できませんでした。ドライバー位置のみ表示します。";
              }}
              if (data.driver_lat != null && data.driver_lng != null) {{
                ensureDriverMarker(trackState, data.driver_lat, data.driver_lng);
              }}
              fitMapToMarkers(trackState);
              setTimeout(function () {{
                if (trackState && trackState.map) trackState.map.invalidateSize();
              }}, 200);
            }});
          }}).catch(function () {{
            if (trackHint) trackHint.textContent = "地図の読み込みに失敗しました";
          }});
        }}

        function parseAcceptedAtMs(data) {{
          const raw = data.accepted_at || (data.cancellation && data.cancellation.accepted_at);
          if (!raw) return null;
          const ms = Date.parse(String(raw).replace(" ", "T"));
          return isNaN(ms) ? null : ms;
        }}

        function isPenaltyCancelClient(data) {{
          const policy = data.cancellation || cancelPolicy;
          if (policy && typeof policy.penalty_applies === "boolean") {{
            return policy.penalty_applies;
          }}
          const ms = matchedAcceptedAt || parseAcceptedAtMs(data);
          if (!ms) return false;
          return (Date.now() - ms) >= CANCEL_GRACE_MINUTES * 60 * 1000;
        }}

        function showCancelWarnModal(message) {{
          if (!cancelWarn || !cancelWarnBody) return;
          cancelWarnBody.textContent = message;
          cancelWarn.classList.remove("hidden");
          cancelWarn.hidden = false;
        }}

        function hideCancelWarnModal() {{
          if (!cancelWarn) return;
          cancelWarn.classList.add("hidden");
          cancelWarn.hidden = true;
        }}

        function executeCancelRide(confirmPenalty) {{
          if (!activeRequestId) return;
          showError("");
          if (cancelBtn) cancelBtn.disabled = true;
          fetch(CANCEL_RIDE_API, {{
            method: "POST",
            headers: {{ "Content-Type": "application/json" }},
            body: JSON.stringify({{
              ride_request_id: activeRequestId,
              confirm_penalty: !!confirmPenalty,
            }}),
          }})
            .then(function (res) {{ return res.json().then(function (j) {{ return {{ status: res.status, body: j }}; }}); }})
            .then(function ({{ status, body }}) {{
              if (body && body.needs_confirmation) {{
                showCancelWarnModal(body.message || (
                  "【ご注意】マッチング成立から" + CANCEL_GRACE_MINUTES + "分以上経過しているため、"
                  + "今キャンセルすると規約に基づきキャンセル料" + CANCEL_FEE_YEN.toLocaleString() + "円が即時決済されます。本当によろしいですか？"
                ));
                return;
              }}
              if (!body || !body.ok) {{
                showError((body && body.message) || "キャンセルに失敗しました。");
                return;
              }}
              hideCancelWarnModal();
              if (pollTimer) {{
                clearInterval(pollTimer);
                pollTimer = null;
              }}
              if (successTitle) successTitle.textContent = "キャンセルしました";
              if (successBody) {{
                successBody.textContent = body.fee_charged
                  ? "キャンセル料の決済が完了しました。ご利用ありがとうございました。"
                  : "依頼をキャンセルしました（キャンセル料は発生しません）。";
              }}
              if (trackWrap) trackWrap.classList.add("hidden");
              if (paymentWrap) paymentWrap.classList.add("hidden");
              if (cancelBtn) cancelBtn.classList.add("hidden");
              showStep("success");
            }})
            .catch(function () {{
              showError("通信エラーが発生しました。");
            }})
            .finally(function () {{
              if (cancelBtn) cancelBtn.disabled = false;
            }});
        }}

        function onCancelRideClick() {{
          if (!activeRequestId) return;
          const penalty = isPenaltyCancelClient({{ cancellation: cancelPolicy, accepted_at: matchedAcceptedAt }});
          if (penalty) {{
            showCancelWarnModal(
              "【ご注意】マッチング成立から" + CANCEL_GRACE_MINUTES + "分以上経過しているため、"
              + "今キャンセルすると規約に基づきキャンセル料" + CANCEL_FEE_YEN.toLocaleString()
              + "円が即時決済されます。本当によろしいですか？"
            );
          }} else if (window.confirm("配車リクエストをキャンセルしますか？（キャンセル料はかかりません）")) {{
            executeCancelRide(false);
          }}
        }}

        function applyStatusData(data) {{
          if (!data || !data.ok) return;
          if (data.status === "cancelled" || data.cancelled) {{
            if (pollTimer) {{
              clearInterval(pollTimer);
              pollTimer = null;
            }}
            if (successTitle) successTitle.textContent = "キャンセル済み";
            if (successBody) {{
              successBody.textContent = data.cancellation_fee_charged
                ? "この依頼はキャンセルされました（キャンセル料決済済み）。"
                : "この依頼はキャンセルされました。";
            }}
            if (cancelBtn) cancelBtn.classList.add("hidden");
            showStep("success");
            return;
          }}
          if (data.status === "accepted" && data.company) {{
            if (data.cancellation) cancelPolicy = data.cancellation;
            const atMs = parseAcceptedAtMs(data);
            if (atMs) matchedAcceptedAt = atMs;
            const c = data.company;
            const wait = c.wait_time_label ? "（目安:" + c.wait_time_label + "）" : "";
            successTitle.textContent = "マッチング成功！";
            successBody.textContent = "🎉 " + (c.name || "代行") + wait + " が向かいます！";
            if (successCall && c.tel) {{
              successCall.href = "tel:" + String(c.tel).replace(/[^0-9+]/g, "");
              successCall.classList.remove("hidden");
            }} else if (successCall) {{
              successCall.classList.add("hidden");
            }}
            if (!matchedOnce) {{
              matchedOnce = true;
              showStep("success");
              initTrackingMap(data);
              fetchSurgeMultiplier();
            }}
            if (trackState && data.driver_lat != null && data.driver_lng != null) {{
              ensureDriverMarker(trackState, data.driver_lat, data.driver_lng);
              fitMapToMarkers(trackState);
            }}
            updatePaymentUI(data);
          }}
        }}

        function showPaymentError(msg) {{
          if (!paymentErr) return;
          paymentErr.textContent = msg || "";
          paymentErr.classList.toggle("hidden", !msg);
        }}

        function applySurgeBadge(surge, targetForm, targetPay) {{
          const s = surge || currentSurge;
          const text = s.surge_label || (s.show_surge_badge && s.surge_multiplier >= 1.1
            ? "⚡ 混雑のため料金 x" + s.surge_multiplier + "倍" : "");
          [targetForm, targetPay].forEach(function (el) {{
            if (!el) return;
            if (text) {{
              el.textContent = text;
              el.classList.remove("hidden");
            }} else {{
              el.classList.add("hidden");
            }}
          }});
        }}

        function fetchSurgeMultiplier() {{
          const d = bodyData();
          if (!d.prefecture || !d.cityName) return Promise.resolve(null);
          const qs = new URLSearchParams({{
            prefecture: d.prefecture,
            city_name: d.cityName,
          }});
          if (pendingPickupCoords && pendingPickupCoords.length === 2) {{
            qs.set("lat", String(pendingPickupCoords[0]));
            qs.set("lng", String(pendingPickupCoords[1]));
          }}
          return fetch(GET_SURGE_API + "?" + qs.toString(), {{ cache: "no-store" }})
            .then(function (res) {{ return res.json(); }})
            .then(function (data) {{
              if (data && data.ok) {{
                currentSurge = data;
                applySurgeBadge(data, surgeBadgeForm, surgeBadgePay);
              }}
              return data;
            }})
            .catch(function () {{ return null; }});
        }}

        function updatePaymentUI(data) {{
          if (!paymentWrap || !data.payment) return;
          paymentWrap.classList.remove("hidden");
          const p = data.payment;
          const surge = data.surge || p.surge || currentSurge;
          if (surge && surge.surge_multiplier) currentSurge = surge;
          applySurgeBadge(surge, surgeBadgeForm, surgeBadgePay);
          const label = p.amount_label || p.estimated_label || "—";
          const isPaid = p.paid || p.payment_status === "paid";
          const baseNote = p.base_amount_label && p.surge_multiplier > 1
            ? "（基本 " + p.base_amount_label + " ×" + p.surge_multiplier + "倍）" : "";
          appliedCouponDiscount = parseInt(p.coupon_discount || 0, 10) || 0;
          const couponNote = appliedCouponDiscount > 0
            ? "（クーポン -¥" + appliedCouponDiscount.toLocaleString() + "）" : "";
          if (paymentAmount) {{
            paymentAmount.textContent = isPaid
              ? label + "（お支払い済み）"
              : label + (p.is_estimate ? "（目安・サージ込）" : "") + couponNote + baseNote;
          }}
          if (paymentPaid) paymentPaid.classList.toggle("hidden", !isPaid);
          if (paymentForm) paymentForm.classList.toggle("hidden", isPaid);
          if (isPaid) {{
            showPaymentError("");
            maybePromptReview(data);
          }}
        }}

        function loadStripeJs(publishableKey) {{
          if (window.Stripe) return Promise.resolve(window.Stripe(publishableKey));
          return new Promise(function (resolve, reject) {{
            var s = document.createElement("script");
            s.src = "https://js.stripe.com/v3/";
            s.async = true;
            s.onload = function () {{
              if (window.Stripe) resolve(window.Stripe(publishableKey));
              else reject(new Error("Stripe load failed"));
            }};
            s.onerror = function () {{ reject(new Error("Stripe load failed")); }};
            document.head.appendChild(s);
          }});
        }}

        function confirmMockPayment(transactionId) {{
          return fetch(PAYMENT_WEBHOOK_API, {{
            method: "POST",
            headers: {{
              "Content-Type": "application/json",
              "X-Portal-Payment-Mock": MOCK_PAYMENT_TOKEN,
            }},
            body: JSON.stringify({{ transaction_id: transactionId }}),
          }}).then(function (res) {{ return res.json(); }});
        }}

        function applyCoupon() {{
          if (!activeRequestId) return;
          const code = couponCodeInput ? String(couponCodeInput.value || "").trim() : "";
          if (!code) {{
            if (couponMsg) {{
              couponMsg.textContent = "クーポンコードを入力してください。";
              couponMsg.classList.remove("hidden");
            }}
            return;
          }}
          if (couponApplyBtn) couponApplyBtn.disabled = true;
          fetch(APPLY_COUPON_API, {{
            method: "POST",
            headers: {{ "Content-Type": "application/json" }},
            body: JSON.stringify({{ ride_request_id: activeRequestId, code: code }}),
          }})
            .then(function (res) {{ return res.json(); }})
            .then(function (data) {{
              if (data && data.ok) {{
                if (couponMsg) {{
                  couponMsg.textContent = (data.message || "適用しました") +
                    (data.discount_label ? "（-" + data.discount_label + "）" : "");
                  couponMsg.classList.remove("hidden");
                  couponMsg.classList.add("portal-ride-coupon-msg--ok");
                }}
                if (data.payment) {{
                  applyStatusData({{ ok: true, payment: data.payment, status: "accepted" }});
                }} else if (activeRequestId) {{
                  fetch(CHECK_API + "?id=" + encodeURIComponent(String(activeRequestId)), {{ cache: "no-store" }})
                    .then(function (r) {{ return r.json(); }})
                    .then(applyStatusData);
                }}
              }} else if (couponMsg) {{
                couponMsg.textContent = (data && data.message) || "クーポンを適用できませんでした。";
                couponMsg.classList.remove("hidden");
                couponMsg.classList.remove("portal-ride-coupon-msg--ok");
              }}
            }})
            .catch(function () {{
              if (couponMsg) {{
                couponMsg.textContent = "通信エラーが発生しました。";
                couponMsg.classList.remove("hidden");
              }}
            }})
            .finally(function () {{
              if (couponApplyBtn) couponApplyBtn.disabled = false;
            }});
        }}

        function processPayment() {{
          if (!activeRequestId) return;
          showPaymentError("");
          if (payBtn) payBtn.disabled = true;
          fetch(CREATE_PAYMENT_API, {{
            method: "POST",
            headers: {{ "Content-Type": "application/json" }},
            body: JSON.stringify({{ ride_request_id: activeRequestId }}),
          }})
            .then(function (res) {{ return res.json(); }})
            .then(function (data) {{
              if (!data || !data.ok) {{
                showPaymentError((data && data.message) || "決済の準備に失敗しました。");
                if (payBtn) payBtn.disabled = false;
                return;
              }}
              paymentSession = data;
              if (data.mock_mode) {{
                return confirmMockPayment(data.transaction_id);
              }}
              return loadStripeJs(data.publishable_key).then(function (stripe) {{
                stripeInstance = stripe;
                if (!stripeElements) {{
                  stripeElements = stripe.elements();
                  var mount = document.getElementById("portal-ride-stripe-element");
                  if (mount && !stripeCard) {{
                    mount.innerHTML = "";
                    stripeCard = stripeElements.create("card");
                    stripeCard.mount(mount);
                  }}
                }}
                return stripe.confirmCardPayment(data.client_secret, {{
                  payment_method: {{ card: stripeCard }},
                }});
              }}).then(function (result) {{
                if (result && result.error) {{
                  throw new Error(result.error.message || "カード決済に失敗しました。");
                }}
                return confirmMockPayment(data.transaction_id);
              }});
            }})
            .then(function (result) {{
              if (result && result.ok) {{
                showPaymentError("");
                if (activeRequestId) {{
                  fetch(CHECK_API + "?id=" + encodeURIComponent(String(activeRequestId)), {{ cache: "no-store" }})
                    .then(function (r) {{ return r.json(); }})
                    .then(applyStatusData);
                }}
              }} else if (result) {{
                showPaymentError(result.message || "決済に失敗しました。");
              }}
            }})
            .catch(function (err) {{
              showPaymentError(err && err.message ? err.message : "決済エラーが発生しました。");
            }})
            .finally(function () {{
              if (payBtn) payBtn.disabled = false;
            }});
        }}

        function startPolling(requestId) {{
          activeRequestId = requestId;
          showStep("waiting");
          if (pollTimer) clearInterval(pollTimer);
          const poll = function () {{
            fetch(CHECK_API + "?id=" + encodeURIComponent(String(requestId)), {{ cache: "no-store" }})
              .then(function (res) {{ return res.json(); }})
              .then(function (data) {{
                applyStatusData(data);
              }})
              .catch(function () {{}});
          }};
          poll();
          pollTimer = setInterval(poll, 3000);
        }}

        function capturePickupCoords() {{
          return new Promise(function (resolve) {{
            if (!navigator.geolocation) {{
              resolve(null);
              return;
            }}
            navigator.geolocation.getCurrentPosition(
              function (pos) {{
                resolve([pos.coords.latitude, pos.coords.longitude]);
              }},
              function () {{ resolve(null); }},
              {{ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }}
            );
          }});
        }}

        document.querySelectorAll(".portal-ride-open-btn").forEach(function (btn) {{
          btn.addEventListener("click", openModal);
        }});
        modal.querySelectorAll("[data-portal-ride-close]").forEach(function (el) {{
          el.addEventListener("click", closeModal);
        }});

        if (payBtn) {{
          payBtn.addEventListener("click", processPayment);
        }}
        if (couponApplyBtn) {{
          couponApplyBtn.addEventListener("click", applyCoupon);
        }}

        reviewStars.forEach(function (btn) {{
          btn.addEventListener("click", function () {{
            setReviewStars(parseInt(btn.getAttribute("data-rating") || "0", 10));
          }});
        }});
        if (reviewSubmit) {{
          reviewSubmit.addEventListener("click", submitReview);
        }}
        if (reviewModal) {{
          reviewModal.querySelectorAll("[data-portal-review-close]").forEach(function (el) {{
            el.addEventListener("click", closeReviewModal);
          }});
        }}

        if (cancelBtn) {{
          cancelBtn.addEventListener("click", onCancelRideClick);
        }}
        if (cancelConfirmBtn) {{
          cancelConfirmBtn.addEventListener("click", function () {{
            hideCancelWarnModal();
            executeCancelRide(true);
          }});
        }}
        if (cancelWarn) {{
          cancelWarn.querySelectorAll("[data-portal-cancel-warn-close]").forEach(function (el) {{
            el.addEventListener("click", hideCancelWarnModal);
          }});
        }}

        if (form) {{
          form.addEventListener("submit", function (ev) {{
            ev.preventDefault();
            showError("");
            const fd = new FormData(form);
            const d = bodyData();
            const payload = {{
              user_name: String(fd.get("user_name") || "").trim(),
              user_phone: String(fd.get("user_phone") || "").trim(),
              location_details: String(fd.get("location_details") || "").trim(),
              city_slug: d.citySlug,
              pref_slug: d.prefSlug,
              city_name: d.cityName,
              prefecture: d.prefecture,
            }};
            const shopRef = getShopRefId();
            if (shopRef) payload.referred_by_shop_id = shopRef;
            capturePickupCoords().then(function (coords) {{
              pendingPickupCoords = coords;
              if (coords && coords.length === 2) {{
                payload.pickup_lat = coords[0];
                payload.pickup_lng = coords[1];
              }}
              return fetch(REQUEST_API, {{
                method: "POST",
                headers: {{ "Content-Type": "application/json" }},
                body: JSON.stringify(payload),
              }});
            }})
              .then(function (res) {{ return res.json(); }})
              .then(function (data) {{
                if (!data || !data.ok) {{
                  showError((data && data.message) || "送信に失敗しました。");
                  return;
                }}
                startPolling(data.request_id);
              }})
              .catch(function () {{
                showError("通信エラーが発生しました。再度お試しください。");
              }});
          }});
        }}
      }})();
    </script>
"""


def page_shell(
    *,
    title: str,
    description: str,
    canonical: str,
    h1: str,
    hero_html: str,
    main_body: str,
    sticky_nav_html: str,
    extra_html: str = "",
    page_js: str = "",
    subtitle: str = "全国対応",
    head_extra: str = "",
    area_map: dict[str, dict[str, object]] | None = None,
    portal_pref_slug: str = "",
    portal_city_slug: str = "",
    portal_city_name: str = "",
    portal_prefecture: str = "",
) -> str:
    area_map_script = render_portal_area_map_script(area_map or {})
    body_attrs = render_portal_body_data_attrs(
        pref_slug=portal_pref_slug,
        city_slug=portal_city_slug,
        city_name=portal_city_name,
        prefecture=portal_prefecture,
    )
    ride_extra = render_ride_request_modal_html() + render_ride_request_fab()
    combined_page_js = (
        (page_js or "")
        + portal_geolocation_js()
        + portal_favorites_js()
        + portal_pwa_install_js()
        + portal_shop_mode_js()
        + portal_ride_request_js()
    )
    return f"""<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
{render_shop_mode_early_script()}{render_head_tracking_snippets()}{render_pwa_head_snippets()}{area_map_script}{head_extra}    <title>{html.escape(title)}</title>
    <meta name="description" content="{html.escape(description)}" />
    <link rel="canonical" href="{html.escape(canonical)}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:title" content="{html.escape(title)}" />
    <meta property="og:description" content="{html.escape(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{html.escape(canonical)}" />
    <meta property="og:locale" content="ja_JP" />
    <link rel="stylesheet" href="{html.escape(PORTAL_CSS_URL)}" />
    <link rel="stylesheet" href="{html.escape(PORTAL_NEO_CSS_URL)}" />
  </head>
  <body class="min-h-screen bg-slate-950 text-slate-100 antialiased portal-body--sticky portal-neo-dark" {body_attrs}>
{render_header(h1, subtitle)}
{hero_html}
    <main id="main" class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
{main_body}
    </main>
{render_footer()}
{render_pwa_install_banner_html()}
{ride_extra}
{sticky_nav_html}
{extra_html}
{combined_page_js}
{render_service_worker_register_js()}
  </body>
</html>
"""


def build_national_page(
    records: list[dict[str, str]],
    pref_slug_map: dict[str, str],
    area_map: dict[str, dict[str, object]],
) -> str:
    counts: dict[str, int] = {pref: 0 for pref in ALL_PREFECTURES}
    for row in records:
        pref = row.get("prefecture", "")
        if pref in counts:
            counts[pref] += 1

    pref_meta = {
        pref: {
            "name": pref,
            "slug": pref_slug_map[pref],
            "count": counts[pref],
        }
        for pref in ALL_PREFECTURES
    }

    region_blocks: list[str] = []
    for region_name, pref_list in REGION_PREFS:
        prefs_in_region = [pref_meta[p] for p in pref_list]
        links = "\n".join(
            f'          <li><a href="{html.escape(portal_path(str(m["slug"])))}" class="portal-pref-link">'
            f'{html.escape(str(m["name"]))} <span class="text-slate-400">（{m["count"]}件）</span></a></li>'
            for m in prefs_in_region
        )
        region_blocks.append(
            f"""
      <section class="portal-region-block mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-5 shadow-sm sm:p-6">
        <h2 class="text-base font-bold text-slate-800">{html.escape(region_name)}</h2>
        <ul class="portal-pref-list mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
{links}
        </ul>
      </section>"""
        )

    total = len(records)
    prefs_with_data = sum(1 for c in counts.values() if c > 0)
    hero = render_hero(
        level="全国",
        headline="今夜、全国どこでもすぐ呼べる運転代行を探す",
        subline="深夜のタクシー代わりに。都道府県・市区町村から業者を選び、本日営業中の店舗はワンタップで電話できます。",
        eyebrow="全国47都道府県対応",
        show_gps_hero=True,
    )
    main = f"""
{render_breadcrumbs([("トップ", None)])}
{render_cta_block()}
      <section id="portal-regions" aria-labelledby="national-heading">
        <h2 id="national-heading" class="text-xl font-bold text-slate-100 sm:text-2xl">都道府県から探す</h2>
        <p class="mt-2 text-sm text-slate-600">掲載業者数 合計 <strong>{total}</strong> 件 · 掲載あり {prefs_with_data} / 全国 {len(ALL_PREFECTURES)} 都道府県</p>
        <p class="mt-1 text-sm text-slate-500">お住まいの地域を選ぶと、市区町村別の一覧ページへ移動します。掲載0件の県からも無料登録で掲載開始できます。</p>
      </section>
{"".join(region_blocks)}
"""
    return page_shell(
        title=NATIONAL_TITLE,
        description=NATIONAL_DESCRIPTION,
        canonical=canonical_url(),
        h1="運転代行ポータル | はるのゆこと",
        hero_html=hero,
        main_body=main,
        sticky_nav_html=render_sticky_mobile_nav(page_kind="national"),
        extra_html=render_national_area_sheet(pref_slug_map),
        page_js=portal_national_page_js(),
        area_map=area_map,
    )


def build_prefecture_page(
    prefecture: str,
    pref_slug: str,
    records: list[dict[str, str]],
    cities: list[dict[str, str]],
    area_map: dict[str, dict[str, object]],
) -> str:
    title = f"【2026年最新】{prefecture}の運転代行一覧｜料金・イベント情報"
    description = (
        f"{prefecture}の運転代行業者一覧。市区町村別に探せます。"
        "料金・電話番号・会員のリアルタイム営業情報を掲載。"
    )
    if cities:
        city_links = "\n".join(
            f'          <li><a href="{html.escape(portal_path(pref_slug, str(c["city_slug"])))}" class="portal-city-link">'
            f'{html.escape(str(c["city"]))} <span class="text-slate-400">（{c["count"]}件）</span></a></li>'
            for c in cities
        )
        city_section = f"""
      <section id="portal-city-nav" class="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-5 shadow-sm sm:p-6" aria-labelledby="city-nav-heading">
        <h2 id="city-nav-heading" class="text-base font-bold text-slate-800">{html.escape(prefecture)}の市区町村一覧</h2>
        <ul class="portal-city-list mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
{city_links}
        </ul>
      </section>"""
    else:
        city_section = ""

    hero = render_hero(
        level=prefecture,
        headline=f"{prefecture}で今すぐ呼べる運転代行・深夜のタクシー代わりに",
        subline="本日営業中の店舗をリアルタイム表示。電話番号・料金を確認して、そのまま代行を手配できます。",
    )
    main = f"""
{render_breadcrumbs([("トップ", PORTAL_BASE), (prefecture, None)])}
{render_cta_block()}
{city_section}
      <section aria-labelledby="list-heading">
        <h2 id="portal-list-heading" class="mb-4 text-xl font-bold text-slate-100">{html.escape(prefecture)}の運転代行業者一覧</h2>
{render_listing_section(records, prefecture)}
      </section>
"""
    return page_shell(
        title=title,
        description=description,
        canonical=canonical_url(pref_slug),
        h1=f"{prefecture}の運転代行一覧",
        hero_html=hero,
        main_body=main,
        sticky_nav_html=render_sticky_mobile_nav(
            page_kind="prefecture", prefecture=prefecture, pref_slug=pref_slug
        ),
        page_js=portal_live_listing_js() if records else portal_sticky_nav_js(),
        area_map=area_map,
    )


def build_city_page(
    prefecture: str,
    pref_slug: str,
    city: str,
    city_slug: str,
    records: list[dict[str, str]],
    cities_in_pref: list[dict[str, object]] | None = None,
    area_map: dict[str, dict[str, object]] | None = None,
) -> str:
    title = f"【2026年最新】{city}の運転代行一覧｜すぐ呼べる代行業者"
    description = (
        f"{prefecture}{city}の運転代行業者一覧。"
        "電話番号・公式サイト・会員のリアルタイム営業情報を掲載。"
    )
    hero = render_hero(
        level=f"{prefecture} · {city}",
        headline=f"{city}で今すぐ呼べる運転代行・深夜のタクシー代わりに",
        subline="飲み会帰り・急な移動にも。営業中の代行店舗から、スマホでそのまま電話できます。",
    )
    main = f"""
{render_breadcrumbs([
    ("トップ", PORTAL_BASE),
    (prefecture, portal_path(pref_slug)),
    (city, None),
])}
{render_cta_block()}
      <section aria-labelledby="list-heading">
        <h2 id="portal-list-heading" class="mb-4 text-xl font-bold text-slate-100">{html.escape(city)}の運転代行業者一覧</h2>
{render_listing_section(records, prefecture, city)}
      </section>
{render_nearby_city_links(prefecture, pref_slug, city_slug, cities_in_pref or [])}
"""
    return page_shell(
        title=title,
        description=description,
        canonical=canonical_url(pref_slug, city_slug),
        h1=f"{city}の運転代行一覧",
        hero_html=hero,
        main_body=main,
        sticky_nav_html=render_sticky_mobile_nav(
            page_kind="city", prefecture=prefecture, pref_slug=pref_slug
        ),
        page_js=portal_live_listing_js() if records else portal_sticky_nav_js(),
        area_map=area_map or {},
        portal_pref_slug=pref_slug,
        portal_city_slug=city_slug,
        portal_city_name=city,
        portal_prefecture=prefecture,
    )


def render_company_local_business_json_ld(rec: dict[str, str], canonical: str) -> str:
    name = rec.get("name", "")
    phone = rec.get("phone", "")
    address = rec.get("address", "")
    prefecture = rec.get("prefecture", "")
    city = rec.get("city", "")
    website = normalize_website(rec.get("website") or "")
    payload: dict[str, object] = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": name,
        "url": canonical,
        "address": {
            "@type": "PostalAddress",
            "streetAddress": address,
            "addressLocality": city,
            "addressRegion": prefecture,
            "addressCountry": "JP",
        },
        "areaServed": f"{prefecture}{city}",
    }
    if phone:
        payload["telephone"] = phone
    if website:
        payload["sameAs"] = website
    cert = (rec.get("cert") or "").strip()
    if cert:
        payload["identifier"] = cert
    avg, count = portal_rating_from_record(rec)
    if count > 0 and avg is not None:
        payload["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": round(avg, 1),
            "reviewCount": count,
            "bestRating": 5,
            "worstRating": 1,
        }
    return (
        '    <script type="application/ld+json">\n'
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + "\n    </script>\n"
    )


def render_company_detail_spec_grid(rec: dict[str, str]) -> str:
    cert = html.escape(rec.get("cert") or "—")
    phone = rec.get("phone") or ""
    addr = html.escape(f"{rec.get('prefecture', '')} {rec.get('address', '')}".strip())
    website = normalize_website(rec.get("website") or "")
    phone_row = (
        f'<a href="{html.escape(tel_href(phone))}" class="text-lg font-bold text-brand hover:underline">'
        f"{html.escape(phone)}</a>"
        if phone
        else '<span class="text-slate-500">掲載なし（会員登録で追加できます）</span>'
    )
    site_row = (
        f'<a href="{html.escape(website)}" target="_blank" rel="noopener noreferrer" '
        f'class="font-semibold text-brand hover:underline">公式サイトを開く</a>'
        if website
        else '<span class="text-slate-500">—</span>'
    )
    badges = render_feature_badges_html(rec).replace('class="portal-feature-badges"', 'class="portal-feature-badges portal-detail-feature-badges"', 1)
    rating_spec = (
        f'<div class="portal-detail-spec-row">'
        f'<dt>利用者レビュー</dt><dd>{render_portal_rating_spec_dd(rec)}</dd></div>'
    )
    return f"""
      <dl class="portal-detail-spec-grid">
        {rating_spec}
        <div class="portal-detail-spec-row">
          <dt>認定番号</dt>
          <dd>{cert}</dd>
        </div>
        <div class="portal-detail-spec-row">
          <dt>電話番号</dt>
          <dd>{phone_row}</dd>
        </div>
        <div class="portal-detail-spec-row">
          <dt>所在地</dt>
          <dd>{addr}</dd>
        </div>
        <div class="portal-detail-spec-row">
          <dt>公式サイト</dt>
          <dd>{site_row}</dd>
        </div>
        <div class="portal-detail-spec-row portal-detail-spec-row--full">
          <dt>こだわり条件</dt>
          <dd>{badges if "portal-feature-badge" in badges else '<span class="text-slate-500">会員登録で設定できます</span>'}</dd>
        </div>
      </dl>"""


def build_company_detail_page(
    rec: dict[str, str],
    area_map: dict[str, dict[str, object]],
) -> str:
    prefecture = rec.get("prefecture", "")
    city = rec.get("city", "")
    pref_slug = rec.get("pref_slug", "")
    city_slug = rec.get("city_slug", "")
    company_id = rec.get("company_id", "")
    name = rec.get("name", "")
    title = f"【2026年最新】{name}の料金・営業時間・電話番号｜{city}の運転代行"
    description = (
        f"{city}の運転代行「{name}」の詳細情報です。料金システム、営業時間、対応エリア、"
        "最新のリアルタイム待機状況はこちら。お酒を飲んだ後の深夜のお帰りにすぐ呼べる電話番号を掲載中。"
    )
    canonical = canonical_url(pref_slug, city_slug, company_id)
    city_list_href = portal_path(pref_slug, city_slug)
    json_ld = render_company_local_business_json_ld(rec, canonical)
    feature_attrs = card_feature_data_attrs(rec)
    cert_raw = html.escape((rec.get("cert") or "").strip())
    pref_raw = html.escape((rec.get("prefecture") or "").strip())
    phone = rec.get("phone") or ""

    call_block = ""
    if phone:
        call_block = (
            f'<a href="{html.escape(tel_href(phone))}" class="portal-call-now-btn portal-call-now-btn--detail" '
            f'aria-label="{html.escape(name)}に電話する">'
            '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">'
            '<path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>'
            "今すぐ電話で呼ぶ</a>"
        )

    hero = f"""
    <section class="portal-detail-hero border-b border-slate-200/80 bg-gradient-to-br from-slate-900 via-slate-800 to-brand/90 text-white">
      <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <p class="text-xs font-semibold uppercase tracking-wide text-emerald-200">{html.escape(prefecture)} · {html.escape(city)}</p>
        <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            {render_premium_badge_html(rec)}
            <h1 class="text-2xl font-extrabold leading-tight sm:text-3xl">{html.escape(name)}</h1>
            {render_portal_rating_html(rec, detail=True).replace('portal-rating--detail', 'portal-rating--detail portal-rating--hero')}
          </div>
          {render_favorite_button_html(company_id)}
        </div>
        <p class="mt-2 max-w-2xl text-sm text-slate-200 sm:text-base">運転代行の料金・営業状況・お迎え目安をこのページで確認できます。</p>
        {render_ride_request_hero_button().replace("portal-ride-open-btn--hero", "portal-ride-open-btn--hero portal-ride-open-btn--detail")}
      </div>
    </section>"""

    main = f"""
{render_breadcrumbs([
    ("トップ", PORTAL_BASE),
    (prefecture, portal_path(pref_slug)),
    (city, city_list_href),
    (name, None),
])}
      <div id="company-detail"
           class="portal-detail-root"
           data-prefecture="{pref_raw}"
           data-cert="{cert_raw}"
           data-company-id="{html.escape(company_id)}"
           {feature_attrs}>
        <div id="portal-detail-live-banner" class="portal-detail-live-banner hidden" aria-live="polite" hidden></div>
        <div class="portal-detail-layout">
          <div class="portal-detail-main">
            <section class="portal-detail-card" aria-labelledby="detail-overview-heading">
              <h2 id="detail-overview-heading" class="portal-detail-card-title">基本情報</h2>
{render_company_detail_spec_grid(rec)}
              {call_block}
            </section>
            <section class="portal-detail-card" aria-labelledby="detail-price-heading">
              <h2 id="detail-price-heading" class="portal-detail-card-title">料金</h2>
              <div id="portal-detail-price-live" class="portal-live hidden" data-live-slot="detail-price" aria-live="polite" hidden></div>
              <p class="portal-detail-muted">会員が料金を登録している場合、リアルタイムで表示されます。</p>
            </section>
            <section class="portal-detail-card" aria-labelledby="detail-hours-heading">
              <h2 id="detail-hours-heading" class="portal-detail-card-title">営業時間・待機状況</h2>
              <div id="portal-detail-hours-live" class="portal-live hidden" data-live-slot="detail-hours" aria-live="polite" hidden></div>
              <p class="portal-detail-muted">本日の営業状況・待機ドライバー数・お迎え目安は会員のリアルタイム配信で更新されます。</p>
            </section>
          </div>
          <aside class="portal-detail-aside">
            <div class="portal-detail-aside-card">
              <p class="text-sm font-bold text-slate-800">一覧に戻る</p>
              <a href="{html.escape(city_list_href)}" class="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand hover:bg-blue-50">
                {html.escape(city)}の業者一覧へ
              </a>
            </div>
{render_cta_block()}
          </aside>
        </div>
      </div>
"""
    return page_shell(
        title=title,
        description=description,
        canonical=canonical,
        h1=f"{name} | {city}の運転代行",
        hero_html=hero,
        main_body=main,
        sticky_nav_html=render_sticky_mobile_nav(
            page_kind="detail", prefecture=prefecture, pref_slug=pref_slug
        ),
        page_js=portal_company_detail_js(),
        subtitle=f"{prefecture} · {city}",
        head_extra=json_ld,
        area_map=area_map,
        portal_pref_slug=pref_slug,
        portal_city_slug=city_slug,
        portal_city_name=city,
        portal_prefecture=prefecture,
    )


def portal_company_detail_js() -> str:
    """業者詳細ページ: 単一業者向けリアルタイム API 表示。"""
    sticky = portal_sticky_nav_js().strip()
    feature_defs_js = json.dumps(
        [{"slug": slug, "label": label} for _db, slug, label in PORTAL_FEATURE_DEFS],
        ensure_ascii=False,
    )
    return f"""
    <script>
      (function () {{
        const LIVE_API_URL = {json.dumps(LIVE_API_URL)};
        const FEATURE_DEFS = {feature_defs_js};
        const root = document.getElementById("company-detail");
        const banner = document.getElementById("portal-detail-live-banner");
        const priceSlot = document.getElementById("portal-detail-price-live");
        const hoursSlot = document.getElementById("portal-detail-hours-live");

        function esc(s) {{
          if (!s) return "";
          return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        }}

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

        function flagOn(v) {{
          return v === true || v === 1 || v === "1";
        }}

        function waitMinutesLabel(minutes) {{
          const n = Number(minutes);
          if (!Number.isFinite(n) || n <= 0) return "";
          if (n >= 60) return "60分以上";
          return "約" + n + "分";
        }}

        function hasValue(v) {{
          if (v === null || v === undefined) return false;
          if (typeof v === "string") return v.trim() !== "";
          return true;
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

        function buildLiveInnerHtml(live) {{
          let html = "";
          const waitLabel = waitMinutesLabel(live.wait_time_minutes);
          const ev = live.event;
          if (ev) {{
            const active = ev.is_active === true || ev.is_active === 1 || ev.is_active === "1";
            const drivers = Number(ev.drivers_available) || 0;
            if (active) {{
              let title =
                '<span class="inline-flex items-center gap-1.5"><span class="portal-live-dot" aria-hidden="true"></span>🔥 本日営業中';
              if (waitLabel) title += "（お迎え目安：" + esc(waitLabel) + "）";
              title += "</span>";
              if (drivers > 0) title += "<span>（待機: " + esc(String(drivers)) + "名）</span>";
              html += '<p class="flex flex-wrap items-center gap-2 portal-live-title">' + title + "</p>";
            }} else if (drivers > 0) {{
              html += '<p class="portal-live-title">待機ドライバー: ' + esc(String(drivers)) + "名</p>";
            }}
            if (hasValue(ev.title) || hasValue(ev.body)) {{
              const label = (ev.title || ev.body || "").trim();
              html += '<p class="mt-1 portal-live-muted"><span class="font-semibold">イベント:</span> ' + esc(label) + "</p>";
            }}
          }} else if (waitLabel) {{
            html += '<p class="portal-live-title"><span class="portal-live-dot" aria-hidden="true"></span> お迎え目安：' + esc(waitLabel) + "</p>";
          }}
          const priceLine = formatPriceLine(live.prices);
          if (priceLine) {{
            html += '<p class="mt-2 portal-live-muted"><span class="font-semibold">料金:</span> ' + esc(priceLine) + "</p>";
          }}
          return html;
        }}

        function showSlot(slot, html) {{
          if (!slot || !html.trim()) return;
          slot.innerHTML = html;
          slot.className = "portal-live portal-live--visible";
          slot.hidden = false;
          slot.removeAttribute("hidden");
        }}

        function syncFeatureMeta(live) {{
          if (!root || !live) return;
          FEATURE_DEFS.forEach(function (def) {{
            let on = false;
            if (def.slug === "accept-cashless") on = flagOn(live.accept_cashless);
            else if (def.slug === "invoice") on = flagOn(live.is_invoice_registered);
            else if (def.slug === "female-driver") on = flagOn(live.has_female_driver);
            else if (def.slug === "left-hand-drive") on = flagOn(live.left_hand_drive_ok);
            root.setAttribute("data-" + def.slug, on ? "1" : "0");
          }});
          const box = root.querySelector(".portal-detail-feature-badges, .portal-feature-badges");
          if (!box) return;
          let inner = "";
          FEATURE_DEFS.forEach(function (def) {{
            if (root.getAttribute("data-" + def.slug) === "1") {{
              inner += '<span class="portal-feature-badge" data-feature="' + esc(def.slug) + '">' + esc(def.label) + "</span>";
            }}
          }});
          box.innerHTML = inner;
          if (inner) box.classList.remove("hidden");
        }}

        function applyLive(live) {{
          if (!live) return;
          syncFeatureMeta(live);
          const inner = buildLiveInnerHtml(live);
          const ev = live.event;
          const active = ev && (ev.is_active === true || ev.is_active === 1 || ev.is_active === "1");
          const waitLabel = waitMinutesLabel(live.wait_time_minutes);
          if (banner && (active || waitLabel || inner.trim())) {{
            banner.innerHTML = inner || ('<p class="portal-live-title">会員の最新情報があります</p>');
            banner.classList.remove("hidden");
            banner.hidden = false;
            banner.removeAttribute("hidden");
          }}
          const priceLine = formatPriceLine(live.prices);
          if (priceSlot && priceLine) {{
            showSlot(priceSlot, '<p class="portal-live-title"><span class="font-semibold">料金:</span> ' + esc(priceLine) + "</p>");
          }}
          if (hoursSlot && inner) {{
            showSlot(hoursSlot, inner);
          }}
        }}

        function findLive(byKey) {{
          if (!root || !byKey) return null;
          const prefAttr = root.getAttribute("data-prefecture") || "";
          const certAttr = root.getAttribute("data-cert") || "";
          const cardPrefBase = normalizePrefectureBase(prefAttr);
          const cardCertNum = extractCertNumber(certAttr);
          if (!cardPrefBase || cardCertNum === null) return null;
          let matched = null;
          Object.keys(byKey).forEach(function (apiKey) {{
            const item = byKey[apiKey];
            if (!item) return;
            const prefBase = normalizePrefectureBase(item.prefecture);
            const certNum = extractCertNumber(item.cert_number);
            if (prefBase === cardPrefBase && certNum === cardCertNum) matched = item;
          }});
          return matched;
        }}

        async function boot() {{
          if (!root) return;
          try {{
            const res = await fetch(LIVE_API_URL, {{ credentials: "same-origin", cache: "no-store" }});
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !data.ok || !data.by_key) return;
            const live = findLive(data.by_key);
            if (live) applyLive(live);
          }} catch (err) {{
            console.warn("リアルタイム情報の取得に失敗しました", err);
          }}
        }}

        boot();
      }})();
    </script>
    {sticky}
"""


def portal_sticky_nav_js() -> str:
    return """
    <script>
      (function () {
        document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
          anchor.addEventListener("click", function (e) {
            const id = anchor.getAttribute("href");
            if (!id || id.length < 2) return;
            const el = document.querySelector(id);
            if (!el) return;
            e.preventDefault();
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        });
      })();
    </script>"""


def portal_national_page_js() -> str:
    return """
    <script>
      (function () {
        var sheet = document.getElementById("portal-area-sheet");
        var openBtn = document.getElementById("hero-open-area-sheet");
        var closeBtn = document.getElementById("area-sheet-close");
        function openSheet() {
          if (!sheet) return;
          sheet.hidden = false;
          sheet.classList.add("portal-area-sheet--open");
          if (openBtn) openBtn.setAttribute("aria-expanded", "true");
        }
        function closeSheet() {
          if (!sheet) return;
          sheet.classList.remove("portal-area-sheet--open");
          sheet.hidden = true;
          if (openBtn) openBtn.setAttribute("aria-expanded", "false");
        }
        if (openBtn) openBtn.addEventListener("click", openSheet);
        if (closeBtn) closeBtn.addEventListener("click", closeSheet);
        if (sheet) {
          sheet.addEventListener("click", function (e) {
            if (e.target === sheet) closeSheet();
          });
        }
        document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
          anchor.addEventListener("click", function (e) {
            var id = anchor.getAttribute("href");
            if (!id || id.length < 2) return;
            var el = document.querySelector(id);
            if (!el) return;
            e.preventDefault();
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        });
      })();
    </script>"""


def portal_shop_mode_js() -> str:
    """飲食店スタッフ向け ?mode=shop UI（営業中カードのみ・電話ボタン極大化）。"""
    return """
    <script>
      (function () {
        function isShopMode() {
          try {
            return new URLSearchParams(location.search).get("mode") === "shop";
          } catch (e) {
            return false;
          }
        }

        function persistShopRef() {
          try {
            var ref = new URLSearchParams(location.search).get("ref");
            if (ref && String(ref).trim()) {
              sessionStorage.setItem("portal_shop_ref_v1", String(ref).trim());
            }
          } catch (e) {}
        }

        window.portalApplyShopMode = function () {
          persistShopRef();
          if (!isShopMode()) return;
          document.documentElement.classList.add("portal--shop-mode");
          var grid = document.getElementById("card-grid");
          var emptyEl = document.getElementById("portal-shop-empty");
          var banner = document.getElementById("portal-shop-banner");
          if (banner) banner.classList.remove("hidden");
          if (!grid) return;
          var liveCount = 0;
          grid.querySelectorAll("article[data-company-id]").forEach(function (article) {
            if (article.classList.contains("portal-card--live")) {
              article.classList.remove("portal-card-filtered-out");
              article.classList.add("portal-card--shop-visible");
              liveCount += 1;
            } else {
              article.classList.add("portal-card--shop-hidden");
            }
          });
          if (emptyEl) {
            if (liveCount === 0) emptyEl.classList.remove("hidden");
            else emptyEl.classList.add("hidden");
          }
        };

        persistShopRef();
        if (isShopMode()) {
          document.addEventListener("DOMContentLoaded", function () {
            window.portalApplyShopMode();
          });
        }
      })();
    </script>
"""


def portal_favorites_js() -> str:
    """お気に入り（localStorage）と一覧カードの優先並び替え（お気に入り &gt; プレミアム &gt; 営業中）。"""
    return """
    <script>
      (function () {
        const STORAGE_KEY = "portal_favorite_company_ids_v1";

        function readFavoriteIds() {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(function (id) { return String(id || "").trim(); }).filter(Boolean);
          } catch (e) {
            return [];
          }
        }

        function writeFavoriteIds(ids) {
          const unique = [];
          ids.forEach(function (id) {
            const s = String(id || "").trim();
            if (!s || unique.indexOf(s) >= 0) return;
            unique.push(s);
          });
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
          } catch (e) {}
        }

        function isFavorite(companyId) {
          const id = String(companyId || "").trim();
          if (!id) return false;
          return readFavoriteIds().indexOf(id) >= 0;
        }

        function toggleFavorite(companyId) {
          const id = String(companyId || "").trim();
          if (!id) return false;
          const ids = readFavoriteIds();
          const idx = ids.indexOf(id);
          if (idx >= 0) {
            ids.splice(idx, 1);
            writeFavoriteIds(ids);
            return false;
          }
          ids.unshift(id);
          writeFavoriteIds(ids);
          return true;
        }

        function updateFavoriteButton(btn, on) {
          if (!btn) return;
          btn.setAttribute("aria-pressed", on ? "true" : "false");
          btn.classList.toggle("portal-favorite-btn--active", on);
          const text = btn.querySelector(".portal-favorite-btn-text");
          if (text) text.textContent = on ? "お気に入り済み" : "お気に入り";
        }

        function applyFavoriteArticleState(article) {
          if (!article) return;
          const id = article.getAttribute("data-company-id") || "";
          const on = isFavorite(id);
          article.classList.toggle("portal-card--favorite", on);
          const btn = article.querySelector("[data-favorite-btn]");
          updateFavoriteButton(btn, on);
        }

        function reorderCardGrid() {
          const grid = document.getElementById("card-grid");
          if (!grid) return;
          const buckets = { favorite: [], premium: [], live: [], other: [] };
          grid.querySelectorAll("article[data-company-id]").forEach(function (article) {
            const id = article.getAttribute("data-company-id") || "";
            if (isFavorite(id)) {
              buckets.favorite.push(article);
            } else if (article.getAttribute("data-is-premium") === "1" || article.classList.contains("portal-card--premium")) {
              buckets.premium.push(article);
            } else if (article.classList.contains("portal-card--live")) {
              buckets.live.push(article);
            } else {
              buckets.other.push(article);
            }
          });
          ["favorite", "premium", "live", "other"].forEach(function (key) {
            buckets[key].forEach(function (article) {
              grid.appendChild(article);
            });
          });
        }

        window.portalReorderCardGrid = reorderCardGrid;

        function initFavoriteButtons() {
          document.querySelectorAll("[data-favorite-btn]").forEach(function (btn) {
            const id = btn.getAttribute("data-company-id") || "";
            updateFavoriteButton(btn, isFavorite(id));
            if (btn.dataset.favoriteBound === "1") return;
            btn.dataset.favoriteBound = "1";
            btn.addEventListener("click", function () {
              const on = toggleFavorite(id);
              updateFavoriteButton(btn, on);
              const article = btn.closest("article");
              if (article) applyFavoriteArticleState(article);
              const detailRoot = document.getElementById("company-detail");
              if (detailRoot && (detailRoot.getAttribute("data-company-id") || "") === id) {
                detailRoot.classList.toggle("portal-detail--favorite", on);
              }
              reorderCardGrid();
            });
          });
          document.querySelectorAll("article[data-company-id]").forEach(applyFavoriteArticleState);
          const detailRoot = document.getElementById("company-detail");
          if (detailRoot) {
            const id = detailRoot.getAttribute("data-company-id") || "";
            detailRoot.classList.toggle("portal-detail--favorite", isFavorite(id));
          }
          reorderCardGrid();
        }

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", initFavoriteButtons);
        } else {
          initFavoriteButtons();
        }
      })();
    </script>
"""


def portal_live_listing_js() -> str:
    """都道府県・市町村ページ用: 静的カード + 会員リアルタイム枠 + 営業中・こだわりフィルター。"""
    sticky = portal_sticky_nav_js().strip()
    feature_defs_js = json.dumps(
        [{"slug": slug, "label": label} for _db, slug, label in PORTAL_FEATURE_DEFS],
        ensure_ascii=False,
    )
    return f"""
    <script>
      (function () {{
        const LIVE_API_URL = {json.dumps(LIVE_API_URL)};
        const FEATURE_DEFS = {feature_defs_js};
        const grid = document.getElementById("card-grid");
        const liveToggle = document.getElementById("live-only-toggle");
        const liveFilterEmpty = document.getElementById("live-filter-empty");
        const featureFilterEmpty = document.getElementById("feature-filter-empty");
        const resultCountEl = document.getElementById("result-count");
        const featureChips = document.querySelectorAll(".portal-feature-chip");
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

        function flagOn(v) {{
          return v === true || v === 1 || v === "1";
        }}

        function waitMinutesLabel(minutes) {{
          const n = Number(minutes);
          if (!Number.isFinite(n) || n <= 0) return "";
          if (n >= 60) return "60分以上";
          return "約" + n + "分";
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
          if (live.wait_time_minutes != null && Number(live.wait_time_minutes) > 0) return true;
          if (flagOn(live.accept_cashless) || flagOn(live.is_invoice_registered) || flagOn(live.has_female_driver) || flagOn(live.left_hand_drive_ok)) {{
            return true;
          }}
          return false;
        }}

        function syncFeatureMetaToCard(article, live) {{
          if (!article || !live) return;
          FEATURE_DEFS.forEach(function (def) {{
            const slug = def.slug;
            let on = false;
            if (slug === "accept-cashless") on = flagOn(live.accept_cashless);
            else if (slug === "invoice") on = flagOn(live.is_invoice_registered);
            else if (slug === "female-driver") on = flagOn(live.has_female_driver);
            else if (slug === "left-hand-drive") on = flagOn(live.left_hand_drive_ok);
            article.setAttribute("data-" + slug, on ? "1" : "0");
          }});
          if (live.wait_time_minutes != null && Number(live.wait_time_minutes) > 0) {{
            article.setAttribute("data-wait-minutes", String(live.wait_time_minutes));
          }} else {{
            article.removeAttribute("data-wait-minutes");
          }}
          if (flagOn(live.is_premium)) {{
            article.setAttribute("data-is-premium", "1");
            article.classList.add("portal-card--premium");
          }}
          const box = article.querySelector(".portal-feature-badges");
          if (!box) return;
          let inner = "";
          FEATURE_DEFS.forEach(function (def) {{
            if (article.getAttribute("data-" + def.slug) === "1") {{
              inner += '<span class="portal-feature-badge" data-feature="' + esc(def.slug) + '">' + esc(def.label) + "</span>";
            }}
          }});
          box.innerHTML = inner;
          if (inner) box.classList.remove("hidden");
          else box.classList.add("hidden");
        }}

        function buildLiveInnerHtml(live) {{
          let html = "";
          const waitLabel = waitMinutesLabel(live.wait_time_minutes);
          const ev = live.event;
          if (ev) {{
            const active = ev.is_active === true || ev.is_active === 1 || ev.is_active === "1";
            const drivers = Number(ev.drivers_available) || 0;
            if (active) {{
              let title =
                '<span class="inline-flex items-center gap-1.5"><span class="portal-live-dot" aria-hidden="true"></span>🔥 本日営業中';
              if (waitLabel) title += "（お迎え目安：" + esc(waitLabel) + "）";
              title += "</span>";
              if (drivers > 0) title += "<span>（待機ドライバー: " + esc(String(drivers)) + "名）</span>";
              html += '<p class="flex flex-wrap items-center gap-2 portal-live-title">' + title + "</p>";
            }} else if (drivers > 0) {{
              html += '<p class="portal-live-title">待機ドライバー: ' + esc(String(drivers)) + "名</p>";
              if (waitLabel) {{
                html += '<p class="mt-1 portal-live-muted">お迎え目安：' + esc(waitLabel) + "</p>";
              }}
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
          if (!html.trim() && waitLabel) {{
            html = '<p class="portal-live-title"><span class="portal-live-dot" aria-hidden="true"></span> お迎え目安：' + esc(waitLabel) + "</p>";
          }}
          if (!html.trim()) {{
            html = '<p class="portal-live-title">会員登録の最新情報があります</p>';
          }}
          return html;
        }}

        function getActiveFeatureFilters() {{
          const active = [];
          featureChips.forEach(function (chip) {{
            if (chip.classList.contains("portal-feature-chip--active")) {{
              active.push(chip.getAttribute("data-filter") || "");
            }}
          }});
          return active.filter(Boolean);
        }}

        function cardMatchesFeatureFilters(article, activeFilters) {{
          if (!activeFilters.length) return true;
          return activeFilters.every(function (slug) {{
            return article.getAttribute("data-" + slug) === "1";
          }});
        }}

        /** お気に入り &gt; プレミアム &gt; 営業中 &gt; その他 の順で並び替え */
        function moveLiveCardsToFront() {{
          if (typeof window.portalReorderCardGrid === "function") {{
            window.portalReorderCardGrid();
          }}
        }}

        function applyCardFilters() {{
          if (!grid) return;
          const liveOn = liveToggle && liveToggle.checked;
          const featureFilters = getActiveFeatureFilters();
          let visible = 0;
          const total = grid.querySelectorAll("article").length;
          grid.querySelectorAll("article").forEach(function (article) {{
            const isLive = article.classList.contains("portal-card--live");
            const hideLive = liveOn && !isLive;
            const hideFeature = !cardMatchesFeatureFilters(article, featureFilters);
            if (hideLive || hideFeature) {{
              article.classList.add("portal-card-filtered-out");
            }} else {{
              article.classList.remove("portal-card-filtered-out");
              visible += 1;
            }}
          }});
          if (liveFilterEmpty) {{
            if (liveOn && visible === 0 && !featureFilters.length) {{
              liveFilterEmpty.classList.remove("hidden");
            }} else {{
              liveFilterEmpty.classList.add("hidden");
            }}
          }}
          if (featureFilterEmpty) {{
            if (featureFilters.length && visible === 0) {{
              featureFilterEmpty.classList.remove("hidden");
            }} else {{
              featureFilterEmpty.classList.add("hidden");
            }}
          }}
          if (resultCountEl) {{
            resultCountEl.textContent = String(liveOn || featureFilters.length ? visible : total);
          }}
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
              if (live) syncFeatureMetaToCard(article, live);
              if (!live || !hasLivePayload(live)) {{
                hideLiveSlot(slot);
                return;
              }}
              showLiveSlot(slot, live);
            }});
            moveLiveCardsToFront();
            applyCardFilters();
            if (typeof window.portalApplyShopMode === "function") {{
              window.portalApplyShopMode();
            }}
          }} catch (err) {{
            console.warn("リアルタイム情報の反映に失敗しました", err);
          }}
        }}

        if (liveToggle) {{
          liveToggle.addEventListener("change", function () {{
            applyCardFilters();
            if (!liveToggle.checked) moveLiveCardsToFront();
          }});
        }}
        featureChips.forEach(function (chip) {{
          chip.addEventListener("click", function () {{
            const on = chip.classList.toggle("portal-feature-chip--active");
            chip.setAttribute("aria-pressed", on ? "true" : "false");
            applyCardFilters();
          }});
        }});

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
          if (typeof window.portalReorderCardGrid === "function") {{
            window.portalReorderCardGrid();
          }}
          await loadLiveInfo();
          applyLiveToGrid();
        }}

        boot();
      }})();
    </script>
    {sticky}
"""


def write_pwa_assets(portal_dir: Path) -> None:
    """manifest.json と Service Worker（sw.js / service-worker.js）を出力。"""
    sw_body = build_portal_service_worker_js()
    write_text(portal_dir / "manifest.json", build_portal_manifest_json())
    write_text(portal_dir / "sw.js", sw_body)
    write_text(portal_dir / "service-worker.js", sw_body)


def clean_generated_portal_dirs(portal_dir: Path) -> None:
    keep_names = {
        "portal.css",
        "portal-neo-2026.css",
        "portal-data.json",
        "index.html",
        "sitemap.xml",
        "robots.txt",
        "terms",
        "manifest.json",
        "sw.js",
        "service-worker.js",
    }
    if not portal_dir.is_dir():
        return
    for child in portal_dir.iterdir():
        if child.name in keep_names:
            continue
        if child.is_dir():
            shutil.rmtree(child)
            print(f"  削除（再生成）: {child.name}/")


def write_text(path: Path, content: str, *, quiet: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    if not quiet:
        print(f"  出力: {path.resolve()}")


def generate_all_pages(
    records: list[dict[str, str]],
    portal_dir: Path,
    pref_slug_map: dict[str, str],
    area_map: dict[str, dict[str, object]],
) -> tuple[int, list[tuple[str, str]], list[tuple[str, str, str]]]:
    clean_generated_portal_dirs(portal_dir)
    write_pwa_assets(portal_dir)

    city_pages: list[tuple[str, str]] = []
    company_pages: list[tuple[str, str, str]] = []

    national_html = build_national_page(records, pref_slug_map, area_map)
    write_text(portal_dir / "index.html", national_html)

    terms_html = build_terms_page()
    write_text(portal_dir / "terms" / "index.html", terms_html)

    by_pref: dict[str, list[dict[str, str]]] = {pref: [] for pref in ALL_PREFECTURES}
    for row in records:
        pref = row.get("prefecture", "")
        if pref in by_pref:
            by_pref[pref].append(row)

    page_count = 1
    detail_count = 0
    for prefecture in ALL_PREFECTURES:
        pref_rows = by_pref[prefecture]
        pref_slug = pref_slug_map[prefecture]

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
            prefecture, pref_slug, pref_rows, cities_sorted, area_map  # type: ignore[arg-type]
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
                prefecture,
                pref_slug,
                city,
                city_slug,
                city_rows,
                cities_in_pref=cities_sorted,  # type: ignore[arg-type]
                area_map=area_map,
            )
            write_text(portal_dir / pref_slug / city_slug / "index.html", city_html)
            city_pages.append((pref_slug, city_slug))
            page_count += 1

    for row in records:
        pref_slug = row.get("pref_slug", "")
        city_slug = row.get("city_slug", "")
        company_id = row.get("company_id", "")
        if not pref_slug or not city_slug or not company_id:
            continue
        detail_html = build_company_detail_page(row, area_map)
        detail_path = portal_dir / pref_slug / city_slug / company_id / "index.html"
        write_text(detail_path, detail_html, quiet=True)
        company_pages.append((pref_slug, city_slug, company_id))
        detail_count += 1

    page_count += detail_count
    print(f"  業者詳細ページ: {detail_count} 件")
    return page_count, city_pages, company_pages


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

    print("依存パッケージ: pip install pandas pykakasi pymysql")
    pref_slug_map = build_pref_slug_map()

    csv_records: list[dict[str, str]] = []
    if args.input_dir.is_dir():
        print(f"CSV 読み込み: {args.input_dir}")
        csv_records = load_all_businesses(args.input_dir)
        print(f"  CSV: {len(csv_records)} 件")
    else:
        print(f"  注意: CSV フォルダなし ({args.input_dir}) — MySQL のみで生成します")

    print("MySQL 読み込み（companies）...")
    mysql_records = load_companies_from_mysql(root)
    records = merge_business_records(csv_records, mysql_records)
    rating_aggregates = load_company_rating_aggregates_from_mysql(root)
    apply_rating_aggregates_to_records(records, rating_aggregates)
    records = filter_suspended_portal_records(records, root)
    assign_slugs_to_records(records, pref_slug_map)
    assign_company_ids(records)

    prefs_with_data = sorted({r["prefecture"] for r in records if r.get("prefecture")})
    print(
        f"  マージ後 合計 {len(records)} 件 / 掲載あり {len(prefs_with_data)} 都道府県"
        f"（全ページは {len(ALL_PREFECTURES)} 都道府県）"
    )

    portal_dir = root / "public" / "portal"
    area_map = build_portal_area_map(records, pref_slug_map)
    page_count, city_pages, company_pages = generate_all_pages(
        records, portal_dir, pref_slug_map, area_map
    )
    print(f"  HTML ページ数: {page_count}（詳細 {len(company_pages)} 含む）")

    lastmod = date.today().isoformat()
    sitemap_urls = collect_sitemap_url(pref_slug_map, city_pages, company_pages)
    write_portal_sitemap(portal_dir, sitemap_urls, lastmod)
    write_portal_robots(portal_dir)

    data_path = portal_dir / "portal-data.json"
    payload = {
        "businesses": records,
        "prefectures": list(ALL_PREFECTURES),
        "prefectureSlugs": pref_slug_map,
        "citiesByPrefecture": build_prefecture_index(records),
        "areaMap": area_map,
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
