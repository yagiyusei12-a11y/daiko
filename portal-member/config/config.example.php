<?php
/**
 * 設定ファイルの雛形。
 * コピー: cp config/config.example.php config/config.php
 * 本番では config/config.php を .gitignore 対象のままサーバーにのみ配置してください。
 */
declare(strict_types=1);

return [
    'app_name' => '運転代行ポータル 業者会員',
    'base_url' => '/portal-member',
    'daiko_lp_url' => 'https://daiko.harunoyukoto.jp/',
    'daiko_app_url' => 'https://daiko.harunoyukoto.jp/app/register',
    /** ポータル掲載データ（generate_portal_html.py 出力） */
    'portal_data_json' => dirname(__DIR__, 2) . '/public/portal/portal-data.json',
    'portal_public_base' => 'https://daiko.harunoyukoto.jp/portal/',
    'session_name' => 'portal_member_session',
    /** enriched CSV のルート（認定番号マージ用） */
    'enriched_csv_dir' => dirname(__DIR__, 2) . '/data/3_enriched_csv',
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'database' => 'portal_member',
        'username' => 'portal_user',
        'password' => 'change_me',
        'charset' => 'utf8mb4',
    ],
    /** ポータル HTML 再生成（is_premium 変更時） */
    'project_root' => dirname(__DIR__, 2),
    'portal_python' => 'python3',
    'portal_generate_script' => 'scripts/generate_portal_html.py',
    'portal_generate_log' => dirname(__DIR__, 2) . '/logs/portal-generate.log',
    /**
     * 自社請求システム（invoice.harunoyukoto.com / sales_entry 相当）
     * 請求 DB に database/migrations/invoice_system/001_portal_premium_bridge.sql を実行してください。
     */
    'invoice' => [
        'enabled' => false,
        'db' => [
            'host' => '127.0.0.1',
            'port' => 3306,
            'database' => 'invoice_db_name',
            'username' => 'invoice_user',
            'password' => 'change_me',
            'charset' => 'utf8mb4',
        ],
        'tables' => [
            'sales_slip' => 'sales_slip',
            'sales_parts' => 'sales_parts',
            'sales_slip_display_name' => 'sales_slip_display_name',
            'm_customer' => 'm_customer',
            'portal_premium_billings' => 'portal_premium_billings',
            'portal_ride_fee_billings' => 'portal_ride_fee_billings',
            'portal_shop_kickback_billings' => 'portal_shop_kickback_billings',
            'pay_receipt' => 'pay_receipt',
        ],
        'status' => [
            'billing' => 2,
            'paid' => 3,
        ],
        'ride_fee' => [
            'product_name' => 'ポータル配車手数料（プラットフォーム売上）',
            'product_code' => 'PORTAL-RIDE-FEE',
            'slip_prefix' => 'R',
            'kind' => 1,
            'charger_id' => 1,
            'section_id' => 1,
        ],
        'cancellation_fee' => [
            'product_name' => 'ポータル配車キャンセル料（プラットフォーム手数料）',
            'product_code' => 'PORTAL-CANCEL-FEE',
            'slip_prefix' => 'C',
            'kind' => 1,
            'charger_id' => 1,
            'section_id' => 1,
        ],
        'shop_kickback' => [
            'product_name' => '飲食店への紹介料支払い（支払手数料）',
            'product_code' => 'PORTAL-SHOP-KB',
            'slip_prefix' => 'K',
            'kind' => 1,
            'charger_id' => 1,
            'section_id' => 1,
        ],
        'paid_detection' => 'bridge_and_payment', // bridge_only = ブリッジ手動更新のみ。自動 paid は伝票固有根拠が必須
        'defaults' => [
            'monthly_amount_yen' => 3300,
            'product_name' => 'ポータルサイトプレミアム枠掲載料',
            'product_code' => 'PORTAL-PREMIUM',
            'due_days' => 14,
            'kind' => 1,
            'tax_rate' => 10.0,
            'tax_type' => 1,
            'slip_prefix' => 'P',
            'charger_id' => 1,
            'section_id' => 1,
            'fallback_customer_id' => 0,
        ],
    ],
    /**
     * LINE Messaging API（ポータル業者の営業ステータス更新）
     * 本番は .env の LINE_CHANNEL_* を推奨。Webhook URL は docs/line-webhook-setup.md 参照。
     */
    /**
     * 配車オンライン決済（Stripe / モック）
     * mock_mode=true のときはテスト用 UI から Webhook を模擬実行します。
     */
    /** キャンセルポリシー（マッチング成立後のドタキャン対策） */
    /**
     * ダイナミックプライシング（サージ倍率）
     * 天気: .env の OPENWEATHERMAP_API_KEY（未設定時は天候加算なし）
     */
    'surge' => [
        'max_multiplier' => 2.0,
        'min_multiplier' => 1.0,
        'peak_time_multiplier' => 1.2,
        'weather_bonus' => 0.2,
        'demand_window_hours' => 1,
        'heatmap_hours' => 6,
        'badge_threshold' => 1.1,
        'city_centroids' => [
            '山梨県|甲斐' => ['lat' => 35.6641, 'lng' => 138.5685],
            '東京都|新宿区' => ['lat' => 35.6938, 'lng' => 139.7034],
        ],
    ],
    'cancellation' => [
        'grace_minutes' => 5,
        'fee_yen' => 1000,
        'platform_fee_yen' => 200,
        'agency_compensation_yen' => 800,
    ],
    /** 飲食店紹介キックバック（廃止・付与しない） */
    'kickback' => [
        'enabled' => false,
        'amount_yen' => 0,
    ],
    'stripe' => [
        'mock_mode' => true,
        'publishable_key' => 'pk_test_xxxxxxxx',
        'secret_key' => 'sk_test_xxxxxxxx',
        'webhook_secret' => 'whsec_xxxxxxxx',
        'mock_webhook_token' => 'dev_portal_payment_mock',
        'default_amount_yen' => 3000,
        'currency' => 'jpy',
    ],
    'line' => [
        'channel_access_token' => '',
        'channel_secret' => '',
        'bot_basic_id' => '',
    ],
    /** スーパー管理者（portal-member/admin/）— 本番は .env 推奨 */
    'admin' => [
        'username' => '',
        'password' => '',
    ],
];
