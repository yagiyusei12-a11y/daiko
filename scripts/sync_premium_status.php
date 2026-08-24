#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * 請求システムの入金状態とポータル companies.is_premium を同期する Cron 用スクリプト。
 *
 * 使い方:
 *   php scripts/sync_premium_status.php
 *   php scripts/sync_premium_status.php --dry-run
 *
 * dry-run では portal / invoice DB の UPDATE と HTML 再生成を行いません。
 */

$root = dirname(__DIR__);
require_once $root . '/portal-member/includes/process_lock.php';

$dryRun = in_array('--dry-run', $argv ?? [], true);

$lockPath = $root . '/logs/premium-sync.lock';
$lock = daiko_try_exclusive_lock($lockPath);
if (!$lock['ok']) {
    fwrite(STDERR, "[sync_premium_status] skip: " . $lock['reason'] . "\n");
    exit(0);
}

require_once $root . '/portal-member/includes/bootstrap.php';

if (!invoice_db() instanceof PDO) {
    fwrite(STDERR, "[sync_premium_status] invoice DB not configured (invoice.enabled)\n");
    daiko_release_exclusive_lock($lock['handle']);
    exit(1);
}

$result = invoice_sync_premium_statuses(['dry_run' => $dryRun]);

if ($dryRun) {
    echo sprintf(
        "[%s] DRY-RUN portal_updates=%d invoice_updates=%d regen_launches=%d activated=%d deactivated=%d\n",
        date('c'),
        (int) $result['portal_updates'],
        (int) $result['invoice_updates'],
        (int) $result['regen_launches'],
        (int) $result['activated'],
        (int) $result['deactivated']
    );
    foreach ($result['candidates'] as $row) {
        echo sprintf(
            "company_id=%s current_premium=%s slip_id=%s detected_billing=%s proposed_action=%s match_evidence=%s skip_reason=%s\n",
            (string) ($row['company_id'] ?? ''),
            (string) ($row['current_premium'] ?? ''),
            $row['slip_id'] === null ? '-' : (string) $row['slip_id'],
            (string) ($row['detected_billing'] ?? ''),
            (string) ($row['proposed_action'] ?? ''),
            (string) ($row['match_evidence'] ?? ''),
            (string) ($row['skip_reason'] ?? '')
        );
    }
} else {
    echo sprintf(
        "[%s] updated=%d activated=%d deactivated=%d regenerated=%s\n",
        date('c'),
        (int) $result['updated'],
        (int) $result['activated'],
        (int) $result['deactivated'],
        !empty($result['regenerated']) ? 'yes' : 'no'
    );
}

daiko_release_exclusive_lock($lock['handle']);
exit(0);
