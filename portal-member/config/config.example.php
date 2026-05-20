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
];
