#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * Premium sync safety tests (fixtures / mocks only — no production DB).
 * Usage: php portal-member/tests/premium_sync_safety_test.php
 */

$failed = 0;
$passed = 0;

function t_assert(bool $cond, string $name, string $detail = ''): void
{
    global $failed, $passed;
    if ($cond) {
        $passed++;
        echo "PASS {$name}\n";
        return;
    }
    $failed++;
    echo "FAIL {$name}" . ($detail !== '' ? " — {$detail}" : '') . "\n";
}

$GLOBALS['test_cfg'] = [
    'paid_detection' => 'bridge_and_payment',
    'tables' => ['portal_premium_billings' => 'portal_premium_billings'],
    'status' => ['paid' => 3],
];
$GLOBALS['regen_calls'] = 0;

function invoice_config(): array
{
    return $GLOBALS['test_cfg'];
}

function invoice_table(string $logical): string
{
    return $logical;
}

function invoice_db(): ?PDO
{
    return null;
}

function db(): PDO
{
    throw new RuntimeException('test db() must not connect');
}

$root = dirname(__DIR__, 2);
require_once dirname(__DIR__) . '/includes/invoice_premium_sync.php';
require_once dirname(__DIR__) . '/includes/process_lock.php';
require_once dirname(__DIR__) . '/includes/portal_regenerate.php';

$companyInvoicedOff = [
    'id' => 10,
    'premium_invoice_slip_id' => 100,
    'premium_billing_status' => 'invoiced',
    'is_premium' => 0,
    'premium_due_date' => '2099-01-01',
];
$bridgeInvoiced = [
    'billing_status' => 'invoiced',
    'due_date' => '2099-01-01',
    'portal_company_id' => 10,
    'sales_slip_id' => 100,
];

function run_sync(array $overrides): array
{
    $portalWrites = [];
    $invoiceWrites = [];
    $GLOBALS['regen_calls'] = 0;
    $base = [
        'companies' => [],
        'fetch_bridge' => static function (int $slipId, int $companyId): array {
            return ['status' => 'ok', 'row' => ['billing_status' => 'invoiced', 'due_date' => '2099-01-01', 'portal_company_id' => $companyId, 'sales_slip_id' => $slipId]];
        },
        'detect_payment' => static function (): array {
            return ['status' => 'unmatched', 'paid' => false, 'evidence' => '', 'reason' => 'unmatched'];
        },
        'on_portal_update' => static function (int $companyId, int $premium, string $status) use (&$portalWrites): void {
            $portalWrites[] = compact('companyId', 'premium', 'status');
        },
        'on_bridge_update' => static function (string $kind, int $slipId, int $companyId) use (&$invoiceWrites): void {
            $invoiceWrites[] = compact('kind', 'slipId', 'companyId');
        },
        'trigger_regen' => static function (): bool {
            $GLOBALS['regen_calls'] = (int) ($GLOBALS['regen_calls'] ?? 0) + 1;
            return true;
        },
        'today' => '2026-08-24',
        'cfg' => $GLOBALS['test_cfg'],
    ];
    $options = array_merge($base, $overrides);
    if (isset($overrides['on_portal_update'])) {
        $options['on_portal_update'] = $overrides['on_portal_update'];
    } else {
        $options['on_portal_update'] = static function (int $companyId, int $premium, string $status) use (&$portalWrites): void {
            $portalWrites[] = compact('companyId', 'premium', 'status');
        };
    }
    if (isset($overrides['on_bridge_update'])) {
        $options['on_bridge_update'] = $overrides['on_bridge_update'];
    } else {
        $options['on_bridge_update'] = static function (string $kind, int $slipId, int $companyId) use (&$invoiceWrites): void {
            $invoiceWrites[] = compact('kind', 'slipId', 'companyId');
        };
    }
    $result = invoice_sync_premium_statuses($options);
    $result['_portal_writes'] = $portalWrites;
    $result['_invoice_writes'] = $invoiceWrites;
    return $result;
}

// 1. exact slip match → premium ON candidate
$evalPaid = invoice_evaluate_slip_payment(
    ['id' => 100, 'status' => 2, 'sum_price' => 3300, 'memo' => 'PORTAL_SLIP:100'],
    [['memo' => 'PORTAL_SLIP:100 settled', 'price' => 3300, 'target_id' => 99]],
    100,
    10,
    'bridge_and_payment',
    3
);
t_assert($evalPaid['paid'] === true && $evalPaid['evidence'] === 'PORTAL_SLIP:100', '1 exact slip match paid');

$r1 = run_sync([
    'companies' => [$companyInvoicedOff],
    'fetch_bridge' => static function () use ($bridgeInvoiced): array {
        return ['status' => 'ok', 'row' => $bridgeInvoiced];
    },
    'detect_payment' => static function (): array {
        return ['status' => 'paid', 'paid' => true, 'evidence' => 'PORTAL_SLIP:100', 'reason' => ''];
    },
]);
t_assert(
    $r1['activated'] === 1 && $r1['portal_updates'] === 1 && ($r1['candidates'][0]['proposed_action'] ?? '') === 'activate',
    '1 sync activate on unique slip evidence'
);

// 2. same customer + same amount but different slip → NO MATCH
$evalWrongSlip = invoice_evaluate_slip_payment(
    ['id' => 100, 'status' => 2, 'sum_price' => 3300, 'customer_id' => 7],
    [['memo' => 'PORTAL_SLIP:999 other invoice', 'price' => 3300, 'target_id' => 7]],
    100,
    10,
    'bridge_and_payment',
    3
);
t_assert($evalWrongSlip['paid'] === false && $evalWrongSlip['status'] === 'unmatched', '2 different slip no match');

$evalAmountOnly = invoice_evaluate_slip_payment(
    ['id' => 100, 'status' => 2, 'sum_price' => 3300, 'customer_id' => 7],
    [['memo' => 'generic payment', 'price' => 3300, 'target_id' => 7]],
    100,
    10,
    'bridge_and_payment',
    3
);
t_assert($evalAmountOnly['paid'] === false, '2 customer+amount fallback removed');

// 3. shared fallback_customer_id → cross-company match しない
$evalCross = invoice_evaluate_slip_payment(
    ['id' => 200, 'status' => 2, 'sum_price' => 3300, 'customer_id' => 1],
    [['memo' => 'PORTAL_SLIP:100', 'price' => 3300, 'target_id' => 1]],
    200,
    22,
    'bridge_and_payment',
    3
);
t_assert($evalCross['paid'] === false, '3 shared customer_id does not cross-match');

$r3 = run_sync([
    'companies' => [[
        'id' => 22,
        'premium_invoice_slip_id' => 200,
        'premium_billing_status' => 'invoiced',
        'is_premium' => 0,
        'premium_due_date' => '2099-01-01',
    ]],
    'detect_payment' => static function (): array {
        return ['status' => 'unmatched', 'paid' => false, 'evidence' => '', 'reason' => 'no_unique_slip_marker'];
    },
]);
t_assert(
    $r3['activated'] === 0 && $r3['portal_updates'] === 0 && ($r3['candidates'][0]['proposed_action'] ?? '') === 'unchanged',
    '3 cross-company does not activate'
);

// 4. bridge missing → current premium unchanged
$r4 = run_sync([
    'companies' => [[
        'id' => 10,
        'premium_invoice_slip_id' => 100,
        'premium_billing_status' => 'invoiced',
        'is_premium' => 1,
        'premium_due_date' => '2020-01-01',
    ]],
    'fetch_bridge' => static function (): array {
        return ['status' => 'bridge_missing'];
    },
]);
t_assert(
    $r4['deactivated'] === 0 && $r4['portal_updates'] === 0 && ($r4['candidates'][0]['skip_reason'] ?? '') === 'bridge_missing',
    '4 bridge missing unchanged'
);

// 5. DB error → current premium unchanged
$r5 = run_sync([
    'companies' => [[
        'id' => 10,
        'premium_invoice_slip_id' => 100,
        'premium_billing_status' => 'paid',
        'is_premium' => 1,
        'premium_due_date' => '2099-01-01',
    ]],
    'fetch_bridge' => static function (): array {
        throw new RuntimeException('simulated db error');
    },
]);
t_assert(
    $r5['deactivated'] === 0 && $r5['portal_updates'] === 0 && ($r5['candidates'][0]['skip_reason'] ?? '') === 'db_error',
    '5 db error unchanged'
);

$r5b = invoice_sync_premium_statuses([]);
t_assert($r5b['portal_updates'] === 0 && $r5b['activated'] === 0 && empty($r5b['error']), '5 invoice disabled does not write');

// 6. ambiguous duplicate bridge → unchanged
$r6 = run_sync([
    'companies' => [[
        'id' => 10,
        'premium_invoice_slip_id' => 100,
        'premium_billing_status' => 'invoiced',
        'is_premium' => 0,
        'premium_due_date' => '2099-01-01',
    ]],
    'fetch_bridge' => static function (): array {
        return ['status' => 'ambiguous_duplicate_bridge'];
    },
]);
t_assert(
    $r6['activated'] === 0 && $r6['portal_updates'] === 0 && ($r6['candidates'][0]['skip_reason'] ?? '') === 'ambiguous_duplicate_bridge',
    '6 duplicate bridge skip'
);

$ambiguousPay = run_sync([
    'companies' => [$companyInvoicedOff],
    'detect_payment' => static function (): array {
        return ['status' => 'ambiguous', 'paid' => false, 'evidence' => '', 'reason' => 'ambiguous_match'];
    },
]);
t_assert($ambiguousPay['activated'] === 0 && $ambiguousPay['portal_updates'] === 0, '6 ambiguous payment unchanged');

// 7-8 dry-run writes 0
$rDry = run_sync([
    'dry_run' => true,
    'companies' => [$companyInvoicedOff],
    'detect_payment' => static function (): array {
        return ['status' => 'paid', 'paid' => true, 'evidence' => 'PORTAL_SLIP:100', 'reason' => ''];
    },
]);
t_assert(
    $rDry['portal_updates'] === 0 && $rDry['invoice_updates'] === 0 && $rDry['regen_launches'] === 0 && $GLOBALS['regen_calls'] === 0,
    '7-8 dry-run portal/invoice/regen writes 0'
);
t_assert(($rDry['candidates'][0]['proposed_action'] ?? '') === 'activate', '7 dry-run still proposes activate');

// 9. normal run → clear paid evidence only ON
$r9 = run_sync([
    'companies' => [$companyInvoicedOff],
    'detect_payment' => static function (): array {
        return ['status' => 'paid', 'paid' => true, 'evidence' => 'sales_slip.id=100;status=paid', 'reason' => ''];
    },
]);
t_assert($r9['activated'] === 1 && $r9['portal_updates'] === 1 && $r9['regen_launches'] === 1, '9 paid evidence activates');

$evalSlipStatus = invoice_evaluate_slip_payment(
    ['id' => 100, 'status' => 3, 'sum_price' => 3300],
    [],
    100,
    10,
    'bridge_and_payment',
    3
);
t_assert($evalSlipStatus['paid'] === true, '9 sales_slip status paid is unique evidence');

// 10. cancelled / overdue
$rCancel = run_sync([
    'companies' => [[
        'id' => 10,
        'premium_invoice_slip_id' => 100,
        'premium_billing_status' => 'paid',
        'is_premium' => 1,
        'premium_due_date' => '2099-01-01',
    ]],
    'fetch_bridge' => static function (): array {
        return ['status' => 'ok', 'row' => ['billing_status' => 'cancelled', 'due_date' => '2099-01-01']];
    },
    'detect_payment' => static function (): array {
        return ['status' => 'unmatched', 'paid' => false, 'evidence' => '', 'reason' => 'unmatched'];
    },
]);
t_assert($rCancel['deactivated'] === 1 && ($rCancel['candidates'][0]['detected_billing'] ?? '') === 'cancelled', '10 cancelled deactivates');

$rOverdue = run_sync([
    'companies' => [[
        'id' => 10,
        'premium_invoice_slip_id' => 100,
        'premium_billing_status' => 'invoiced',
        'is_premium' => 1,
        'premium_due_date' => '2020-01-01',
    ]],
    'fetch_bridge' => static function (): array {
        return ['status' => 'ok', 'row' => ['billing_status' => 'invoiced', 'due_date' => '2020-01-01']];
    },
]);
t_assert($rOverdue['deactivated'] === 1 && ($rOverdue['candidates'][0]['detected_billing'] ?? '') === 'overdue', '10 overdue deactivates');

// 11. admin/manual premium not OFF on uncertain bridge
$rManualNoSlip = run_sync([
    'companies' => [[
        'id' => 55,
        'premium_invoice_slip_id' => null,
        'premium_billing_status' => 'none',
        'is_premium' => 1,
        'premium_due_date' => null,
    ]],
]);
t_assert(
    $rManualNoSlip['deactivated'] === 0 && $rManualNoSlip['portal_updates'] === 0 && ($rManualNoSlip['candidates'][0]['skip_reason'] ?? '') === 'no_slip_manual_or_unbilled',
    '11 manual premium without slip unchanged'
);

$rManualInvoiced = run_sync([
    'companies' => [[
        'id' => 10,
        'premium_invoice_slip_id' => 100,
        'premium_billing_status' => 'invoiced',
        'is_premium' => 1,
        'premium_due_date' => '2099-01-01',
    ]],
    'fetch_bridge' => static function () use ($bridgeInvoiced): array {
        return ['status' => 'ok', 'row' => $bridgeInvoiced];
    },
    'detect_payment' => static function (): array {
        return ['status' => 'unmatched', 'paid' => false, 'evidence' => '', 'reason' => 'no_unique_slip_marker'];
    },
]);
t_assert(
    $rManualInvoiced['deactivated'] === 0 && $rManualInvoiced['portal_updates'] === 0,
    '11 invoiced without unique payment does not OFF manual premium'
);

$rAmbiguousMarker = invoice_evaluate_slip_payment(
    ['id' => 12, 'status' => 2, 'sum_price' => 3300],
    [['memo' => 'PORTAL_SLIP:123', 'price' => 3300]],
    12,
    10,
    'bridge_and_payment',
    3
);
t_assert($rAmbiguousMarker['paid'] === false, '11 PORTAL_SLIP prefix does not match sibling id');

// 12. concurrent execution → second skip
$lockDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daiko-premium-lock-' . bin2hex(random_bytes(4));
@mkdir($lockDir, 0755, true);
$lockFile = $lockDir . DIRECTORY_SEPARATOR . 'premium-sync.lock';
$lock1 = daiko_try_exclusive_lock($lockFile);
$lock2 = daiko_try_exclusive_lock($lockFile);
t_assert($lock1['ok'] === true, '12 first lock acquired');
t_assert($lock2['ok'] === false && $lock2['reason'] === 'already_running', '12 second lock skipped');
daiko_release_exclusive_lock($lock1['handle']);
$lock3 = daiko_try_exclusive_lock($lockFile);
t_assert($lock3['ok'] === true, '12 lock released then acquired');
daiko_release_exclusive_lock($lock3['handle']);

// 13. regeneration concurrent launch しない
$genRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daiko-gen-' . bin2hex(random_bytes(4));
@mkdir($genRoot . DIRECTORY_SEPARATOR . 'logs', 0755, true);
$heldGen = daiko_try_exclusive_lock($genRoot . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'portal-generate.lock');
t_assert($heldGen['ok'] === true, '13 generate lock held');
$GLOBALS['config'] = ['project_root' => $genRoot, 'portal_generate_script' => 'missing-script.py'];
$spawned = portal_trigger_html_regeneration();
t_assert($spawned === false, '13 second regeneration not launched');
daiko_release_exclusive_lock($heldGen['handle']);

$py = getenv('PYTHON') ?: '';
$pyCandidates = array_values(array_filter([
    $py,
    'python',
    'py',
]));
$pyScript = $root . DIRECTORY_SEPARATOR . 'scripts' . DIRECTORY_SEPARATOR . 'portal_generate_lock.py';
$tmpPyRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daiko-py-lock-' . bin2hex(random_bytes(4));
@mkdir($tmpPyRoot . DIRECTORY_SEPARATOR . 'logs', 0755, true);
$pyBin = null;
foreach ($pyCandidates as $cand) {
    if ($cand === '') {
        continue;
    }
    if ($cand !== 'python' && $cand !== 'py' && !is_file($cand)) {
        continue;
    }
    $pyBin = $cand;
    break;
}
if ($pyBin === null) {
    t_assert(false, '13 python lock helper could not start');
} else {
    $holder = proc_open(
        [$pyBin, $pyScript, $tmpPyRoot, '--seconds', '8'],
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes,
        $root
    );
    if (is_resource($holder)) {
        stream_set_blocking($pipes[1], false);
        $line = '';
        $deadline = microtime(true) + 8;
        while (microtime(true) < $deadline) {
            $chunk = fread($pipes[1], 1024);
            if (is_string($chunk) && $chunk !== '') {
                $line .= $chunk;
            }
            if (str_contains($line, 'acquired')) {
                break;
            }
            usleep(50000);
        }
        $second = proc_open(
            [$pyBin, $pyScript, $tmpPyRoot],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes2,
            $root
        );
        $out2 = '';
        if (is_resource($second)) {
            $out2 = stream_get_contents($pipes2[1]) ?: '';
            proc_close($second);
        }
        proc_terminate($holder);
        proc_close($holder);
        t_assert(str_contains($line, 'acquired') && str_contains($out2, 'already_running'), '13 python generate lock skips second', 'holder=' . $line . ' second=' . $out2);
    } else {
        t_assert(false, '13 python lock helper could not start');
    }
}

$premiumOnlyMarker = invoice_evaluate_slip_payment(
    ['id' => 100, 'status' => 2, 'sum_price' => 3300, 'memo' => 'PORTAL_PREMIUM company_id=10'],
    [['memo' => 'PORTAL_PREMIUM company_id=10', 'price' => 3300]],
    100,
    10,
    'bridge_and_payment',
    3
);
t_assert($premiumOnlyMarker['paid'] === false, 'PORTAL_PREMIUM company marker is not unique slip evidence');

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed === 0 ? 0 : 1);
