<?php
declare(strict_types=1);

/**
 * 登録時に data/3_enriched_csv/*.csv と認定番号でマージする。
 *
 * ヒント:
 * - 認定番号は県ごとに「第２号」「199」など表記が異なるため、都道府県を併せて指定すると精度が上がります。
 * - ポータル公開 CSV を更新したら、同じ認定番号で再登録せず dashboard から編集する運用を推奨します。
 */
function find_enriched_row_by_cert(string $certNumber, ?string $prefecture = null): ?array
{
    global $config;
    $dir = $config['enriched_csv_dir'] ?? '';
    if (!$dir || !is_dir($dir)) {
        return null;
    }

    $certNorm = normalize_cert_for_match($certNumber);
    if ($certNorm === '') {
        return null;
    }

    foreach (glob(rtrim($dir, '/\\') . '/*.csv') as $csvPath) {
        if (!is_file($csvPath)) {
            continue;
        }
        $stem = pathinfo($csvPath, PATHINFO_FILENAME);
        $prefFromFile = prefecture_label_from_stem($stem);

        if ($prefecture !== null && $prefecture !== '' && $prefFromFile !== '' && $prefecture !== $prefFromFile) {
            continue;
        }

        $handle = fopen($csvPath, 'r');
        if ($handle === false) {
            continue;
        }
        $header = fgetcsv($handle);
        if (!$header) {
            fclose($handle);
            continue;
        }
        $colCert = array_search('認定番号', $header, true);
        if ($colCert === false) {
            fclose($handle);
            continue;
        }

        while (($row = fgetcsv($handle)) !== false) {
            if (!isset($row[$colCert])) {
                continue;
            }
            if (normalize_cert_for_match((string) $row[$colCert]) !== $certNorm) {
                continue;
            }
            fclose($handle);
            return row_to_company_seed($header, $row, $prefFromFile ?: $prefecture);
        }
        fclose($handle);
    }

    return null;
}

function normalize_cert_for_match(string $cert): string
{
    $cert = trim(mb_convert_kana($cert, 'asKV'));
    return $cert;
}

function prefecture_label_from_stem(string $stem): string
{
    $map = [
        'shiga' => '滋賀県',
        'fukui' => '福井県',
        'gifu' => '岐阜県',
        'aichi' => '愛知県',
        'osaka' => '大阪府',
        'kyoto' => '京都府',
        'tokyo' => '東京都',
    ];
    $key = strtolower($stem);
    return $map[$key] ?? '';
}

function row_to_company_seed(array $header, array $row, ?string $prefecture): array
{
    $get = static function (string $col) use ($header, $row): string {
        $idx = array_search($col, $header, true);
        if ($idx === false || !isset($row[$idx])) {
            return '';
        }
        return trim((string) $row[$idx]);
    };

    $address = $get('所在地') ?: $get('主たる営業所の所在地');
    $city = extract_city_from_address($address);

    $rating = $get('評価');
    $reviews = $get('レビュー数');

    return [
        'cert_number' => $get('認定番号'),
        'name' => $get('業者名'),
        'tel' => $get('電話番号'),
        'website' => $get('ウェブサイトURL'),
        'prefecture' => $prefecture ?? '',
        'city' => $city,
        'address' => $address,
        'rating' => $rating !== '' ? $rating : null,
        'review_count' => $reviews !== '' ? (int) $reviews : null,
    ];
}

function extract_city_from_address(string $address): string
{
    if (preg_match('/^(.+?(?:市|区|町|村)|.+?郡.+?(?:町|村))/', $address, $m)) {
        return $m[1];
    }
    return $address;
}
