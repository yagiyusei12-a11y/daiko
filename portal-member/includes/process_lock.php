<?php
declare(strict_types=1);

/**
 * Single-run file lock (flock). Keep the returned handle open until the process exits.
 *
 * @return array{ok: bool, handle: mixed, reason: string}
 */
function daiko_try_exclusive_lock(string $path): array
{
    $dir = dirname($path);
    if ($dir !== '' && $dir !== '.' && !is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $fp = @fopen($path, 'c+');
    if ($fp === false) {
        return ['ok' => false, 'handle' => null, 'reason' => 'lock_open_failed'];
    }
    if (!flock($fp, LOCK_EX | LOCK_NB)) {
        fclose($fp);
        return ['ok' => false, 'handle' => null, 'reason' => 'already_running'];
    }
    ftruncate($fp, 0);
    fwrite($fp, (string) getmypid());
    fflush($fp);
    return ['ok' => true, 'handle' => $fp, 'reason' => ''];
}

function daiko_release_exclusive_lock(mixed $handle): void
{
    if ($handle === null) {
        return;
    }
    flock($handle, LOCK_UN);
    fclose($handle);
}
