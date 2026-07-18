<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/bootstrap_admin.php';

portal_admin_logout();
header('Location: login.php');
exit;
