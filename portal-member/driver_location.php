<?php
declare(strict_types=1);

/**
 * 獲得ドライバー向け GPS 送信ページ（LINE から開く）
 * ?ride_id=123&token=...
 */
require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/ride_dispatch.php';

$rideId = (int) ($_GET['ride_id'] ?? $_GET['request_id'] ?? 0);
$token = trim((string) ($_GET['token'] ?? ''));
$request = $rideId > 0 ? ride_fetch_request_by_id($rideId) : null;
$valid = $request
    && $token !== ''
    && hash_equals((string) ($request['driver_tracking_token'] ?? ''), $token)
    && (string) ($request['status'] ?? '') === 'accepted';

$updateApi = '/portal-member/api/update_location.php';
$pageTitle = '配車中 — 位置送信';
?>
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1.25rem; background: #f8fafc; color: #0f172a; }
    h1 { font-size: 1.125rem; margin: 0 0 0.5rem; }
    .status { font-size: 0.875rem; color: #475569; margin-bottom: 1rem; }
    .ok { color: #047857; font-weight: 700; }
    .err { color: #b91c1c; font-weight: 700; }
    .hint { font-size: 0.8125rem; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>🚗 お客様への位置共有</h1>
<?php if (!$valid): ?>
  <p class="err">リンクが無効か、案件が終了しています。</p>
<?php else: ?>
  <p class="status" id="gps-status">GPS を取得しています…</p>
  <p class="hint">この画面を開いたままお迎えに向かうと、お客様の画面の地図に車の位置が表示されます。</p>
  <script>
    (function () {
      var API = <?= json_encode($updateApi, JSON_UNESCAPED_UNICODE) ?>;
      var rideId = <?= (int) $rideId ?>;
      var token = <?= json_encode($token, JSON_UNESCAPED_UNICODE) ?>;
      var statusEl = document.getElementById("gps-status");
      var lastSent = 0;
      var minIntervalMs = 4000;

      function setStatus(msg, ok) {
        statusEl.textContent = msg;
        statusEl.className = "status " + (ok ? "ok" : "err");
      }

      function sendPosition(lat, lng) {
        var now = Date.now();
        if (now - lastSent < minIntervalMs) return;
        lastSent = now;
        fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ride_request_id: rideId,
            lat: lat,
            lng: lng,
            token: token
          }),
          credentials: "same-origin"
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.ok) {
              setStatus("位置を送信中（" + new Date().toLocaleTimeString() + "）", true);
            } else {
              setStatus((data && data.message) || "送信に失敗しました", false);
            }
          })
          .catch(function () {
            setStatus("通信エラー", false);
          });
      }

      if (!navigator.geolocation) {
        setStatus("お使いの端末は GPS に対応していません", false);
        return;
      }

      navigator.geolocation.watchPosition(
        function (pos) {
          sendPosition(pos.coords.latitude, pos.coords.longitude);
        },
        function (err) {
          setStatus("GPS 取得エラー: " + (err.message || err.code), false);
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
      );
    })();
  </script>
<?php endif; ?>
</body>
</html>
