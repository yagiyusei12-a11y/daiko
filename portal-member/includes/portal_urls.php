<?php
declare(strict_types=1);

/**
 * ポータル静的HTML（portal-data.json）と会員 companies を突き合わせ、詳細ページURLを解決する。
 */

/**
 * @return array<string, mixed>|null
 */
function portal_load_data_json(): ?array
{
    global $config;
    $path = $config['portal_data_json'] ?? dirname(__DIR__, 2) . '/public/portal/portal-data.json';
    if (!is_readable($path)) {
        return null;
    }
    $raw = file_get_contents($path);
    if ($raw === false) {
        return null;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

function portal_public_base_url(): string
{
    global $config;
    $base = $config['portal_public_base'] ?? null;
    if (is_string($base) && $base !== '') {
        return rtrim($base, '/') . '/';
    }
    $lp = $config['daiko_lp_url'] ?? 'https://daiko.harunoyukoto.jp/';
    return rtrim($lp, '/') . '/portal/';
}

function portal_normalize_cert_digits(string $cert): ?int
{
    if (!preg_match_all('/\d+/', $cert, $matches) || empty($matches[0])) {
        return null;
    }
    $last = end($matches[0]);
    return is_numeric($last) ? (int) $last : null;
}

/**
 * @param array<string, mixed> $company
 * @param array<string, mixed> $row portal-data.json の businesses 1件
 */
function portal_business_matches_company(array $company, array $row): bool
{
    $mysqlId = (string) (int) ($company['id'] ?? 0);
    $rowCompanyId = trim((string) ($row['company_id'] ?? ''));
    if ($mysqlId !== '0' && $rowCompanyId === $mysqlId) {
        return true;
    }

    $certDb = portal_normalize_cert_digits((string) ($company['cert_number'] ?? ''));
    $certRow = portal_normalize_cert_digits((string) ($row['cert'] ?? ''));
    if ($certDb === null || $certRow === null || $certDb !== $certRow) {
        return false;
    }

    $prefDb = trim((string) ($company['prefecture'] ?? ''));
    $prefRow = trim((string) ($row['prefecture'] ?? ''));
    return $prefDb !== '' && $prefDb === $prefRow;
}

/**
 * @param array<string, mixed> $company
 * @return array{url: string, path: string, business: array<string, mixed>}|null
 */
function resolve_company_portal_detail(array $company): ?array
{
    $data = portal_load_data_json();
    if ($data === null || !isset($data['businesses']) || !is_array($data['businesses'])) {
        return null;
    }

    $matched = null;
    foreach ($data['businesses'] as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (portal_business_matches_company($company, $row)) {
            $matched = $row;
            break;
        }
    }

    if ($matched === null) {
        return null;
    }

    $prefSlug = trim((string) ($matched['pref_slug'] ?? ''));
    $citySlug = trim((string) ($matched['city_slug'] ?? ''));
    $companyId = trim((string) ($matched['company_id'] ?? ''));
    if ($prefSlug === '' || $citySlug === '' || $companyId === '') {
        return null;
    }

    $safeId = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $companyId) ?? $companyId;
    $safeId = trim($safeId, '-') ?: 'company';
    $path = $prefSlug . '/' . $citySlug . '/' . $safeId . '/';
    $url = portal_public_base_url() . $path;

    return [
        'url' => $url,
        'path' => '/' . 'portal/' . $path,
        'business' => $matched,
    ];
}
