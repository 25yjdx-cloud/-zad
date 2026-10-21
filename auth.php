<?php
declare(strict_types=1);

require_once __DIR__ . DIRECTORY_SEPARATOR . 'security.php';
zadSecurityHeaders();
header('Cache-Control: no-store, private');

function zadAuthConfig(): ?array
{
    $clientId = getenv('GOOGLE_CLIENT_ID');
    $clientSecret = getenv('GOOGLE_CLIENT_SECRET');
    $redirectUri = getenv('GOOGLE_REDIRECT_URI');
    $appOrigin = getenv('APP_ORIGIN');
    $dataDirectory = getenv('AUTH_DATA_DIR');
    if (!is_string($clientId) || $clientId === ''
        || !is_string($clientSecret) || $clientSecret === ''
        || !is_string($redirectUri) || !is_string($appOrigin) || !is_string($dataDirectory)
        || $redirectUri === '' || $appOrigin === '' || $dataDirectory === '') {
        return null;
    }

    $originParts = parse_url($appOrigin);
    $redirectParts = parse_url($redirectUri);
    if (!is_array($originParts) || !is_array($redirectParts)
        || !in_array($originParts['scheme'] ?? '', ['https', 'http'], true)
        || empty($originParts['host'])
        || isset($originParts['path']) || isset($originParts['query']) || isset($originParts['user'])
        || isset($originParts['pass'])
        || strtolower((string) ($originParts['scheme'] ?? '')) !== strtolower((string) ($redirectParts['scheme'] ?? ''))
        || strtolower((string) ($originParts['host'] ?? '')) !== strtolower((string) ($redirectParts['host'] ?? ''))
        || (int) ($originParts['port'] ?? 0) !== (int) ($redirectParts['port'] ?? 0)
        || ($redirectParts['path'] ?? '') !== '/auth.php'
        || ($redirectParts['query'] ?? '') !== 'action=callback'
        || isset($redirectParts['user']) || isset($redirectParts['pass'])
        || (!str_starts_with($dataDirectory, DIRECTORY_SEPARATOR)
            && !preg_match('/^[A-Za-z]:\\\\/', $dataDirectory))) {
        return null;
    }

    $isLocalOrigin = in_array(strtolower((string) $originParts['host']), ['localhost', '127.0.0.1'], true);
    if (($originParts['scheme'] ?? '') !== 'https' && !$isLocalOrigin) {
        return null;
    }

    return [
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'redirect_uri' => $redirectUri,
        'app_origin' => rtrim($appOrigin, '/'),
        'data_directory' => $dataDirectory,
    ];
}

function zadAuthStartSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    session_name('zad_auth');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'
            || str_starts_with((string) (getenv('APP_ORIGIN') ?: ''), 'https://'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function zadAuthUsersFile(array $config): string
{
    $directory = $config['data_directory'];
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        zadJsonResponse(503, ['error' => 'Authentication storage is unavailable']);
    }
    $resolvedDirectory = realpath($directory);
    $webRoot = realpath(__DIR__);
    if (!is_string($resolvedDirectory) || !is_string($webRoot)
        || $resolvedDirectory === $webRoot
        || str_starts_with($resolvedDirectory, $webRoot . DIRECTORY_SEPARATOR)) {
        zadJsonResponse(503, ['error' => 'Authentication storage must be outside the web root']);
    }
    return $resolvedDirectory . DIRECTORY_SEPARATOR . 'users.json';
}

function zadAuthWithUsers(array $config, callable $callback, bool $write = false): mixed
{
    $file = zadAuthUsersFile($config);
    $handle = fopen($file, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        if (is_resource($handle)) {
            fclose($handle);
        }
        zadJsonResponse(503, ['error' => 'Authentication storage is unavailable']);
    }

    $contents = stream_get_contents($handle);
    $users = is_string($contents) && $contents !== '' ? json_decode($contents, true) : [];
    if (!is_array($users)) {
        flock($handle, LOCK_UN);
        fclose($handle);
        zadJsonResponse(503, ['error' => 'Authentication storage is invalid']);
    }

    $result = $callback($users);
    if ($write) {
        $serialized = json_encode($users, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        rewind($handle);
        if (!ftruncate($handle, 0) || fwrite($handle, $serialized) !== strlen($serialized) || !fflush($handle)) {
            flock($handle, LOCK_UN);
            fclose($handle);
            zadJsonResponse(503, ['error' => 'Authentication storage could not be updated']);
        }
        if (function_exists('chmod')) {
            chmod($file, 0600);
        }
    }

    flock($handle, LOCK_UN);
    fclose($handle);
    return $result;
}

function zadAuthRequest(string $url, array $fields, bool $post, ?string $bearerToken = null): array
{
    if (!function_exists('curl_init')) {
        zadJsonResponse(503, ['error' => 'Google authentication is unavailable on this server']);
    }
    $handle = curl_init($url);
    if ($handle === false) {
        zadJsonResponse(503, ['error' => 'Google authentication is unavailable']);
    }
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ];
    if ($post) {
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = http_build_query($fields);
        $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/x-www-form-urlencoded';
    }
    if ($bearerToken !== null) {
        $options[CURLOPT_HTTPHEADER][] = 'Authorization: Bearer ' . $bearerToken;
    }
    curl_setopt_array($handle, $options);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    if (!is_string($body) || $status < 200 || $status >= 300) {
        zadJsonResponse(502, ['error' => 'Google could not complete authentication']);
    }
    try {
        $response = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        zadJsonResponse(502, ['error' => 'Google returned an invalid authentication response']);
    }
    if (!is_array($response)) {
        zadJsonResponse(502, ['error' => 'Google returned an invalid authentication response']);
    }
    return $response;
}

function zadAuthCsrf(): string
{
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expected = $_SESSION['csrf_token'] ?? '';
    if (!is_string($provided) || !is_string($expected) || $expected === ''
        || !hash_equals($expected, $provided)) {
        zadJsonResponse(403, ['error' => 'Request verification failed']);
    }
    zadRequireSameOrigin();
    return $expected;
}

function zadAuthSafePicture(mixed $picture): string
{
    if (!is_string($picture)) {
        return '';
    }
    $parts = parse_url($picture);
    $host = strtolower((string) ($parts['host'] ?? ''));
    return ($parts['scheme'] ?? '') === 'https'
        && preg_match('/^lh[0-9]+\.googleusercontent\.com$/', $host)
        ? $picture
        : '';
}

function zadAuthVipPlans(): array
{
    $plans = [];
    foreach ([
        'monthly' => ['amount_key' => 'VIP_MONTHLY_AMOUNT', 'days' => 30, 'label' => 'شهري - 30 يوماً'],
        'annual' => ['amount_key' => 'VIP_ANNUAL_AMOUNT', 'days' => 365, 'label' => 'سنوي - 365 يوماً'],
        'telegram_lifetime' => [
            'amount' => 250,
            'days' => null,
            'label' => 'Telegram مدى الحياة',
        ],
    ] as $planId => $definition) {
        $rawAmount = isset($definition['amount_key']) ? getenv($definition['amount_key']) : null;
        $amount = isset($definition['amount'])
            ? $definition['amount']
            : (is_string($rawAmount) && preg_match('/^[1-9][0-9]{0,5}$/', $rawAmount)
                ? (int) $rawAmount
                : null);
        $methods = [];
        foreach (['card', 'vodafone_cash', 'etisalat_cash', 'orange_cash'] as $method) {
            $methods[$method] = $amount !== null
                && ($planId === 'telegram_lifetime' || $method === 'card')
                && zadAuthPaymobConfigured($method);
        }
        $plans[$planId] = [
            'id' => $planId,
            'label' => $definition['label'],
            'days' => $definition['days'],
            'amount' => $amount,
            'currency' => 'EGP',
            'methods' => $methods,
            'available' => $amount !== null && (bool) array_filter($methods),
        ];
    }
    return $plans;
}

function zadAuthPaymobConfigured(string $method = 'card'): bool
{
    $apiKey = getenv('PAYMOB_API_KEY');
    $integrationEnvironment = [
        'card' => 'PAYMOB_CARD_INTEGRATION_ID',
        'vodafone_cash' => 'PAYMOB_VODAFONE_CASH_INTEGRATION_ID',
        'etisalat_cash' => 'PAYMOB_ETISALAT_CASH_INTEGRATION_ID',
        'orange_cash' => 'PAYMOB_ORANGE_CASH_INTEGRATION_ID',
    ];
    $integrationId = isset($integrationEnvironment[$method])
        ? getenv($integrationEnvironment[$method])
        : null;
    $iframeId = getenv('PAYMOB_IFRAME_ID');
    $hmacSecret = getenv('PAYMOB_HMAC_SECRET');
    return is_string($apiKey) && $apiKey !== ''
        && is_string($integrationId) && preg_match('/^[0-9]+$/', $integrationId)
        && is_string($iframeId) && preg_match('/^[0-9]+$/', $iframeId)
        && is_string($hmacSecret) && $hmacSecret !== '';
}

function zadAuthTelegramBotAuthorized(): bool
{
    $secret = getenv('TELEGRAM_BOT_API_SECRET');
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    return is_string($secret) && strlen($secret) >= 32
        && is_string($authorization)
        && str_starts_with($authorization, 'Bearer ')
        && hash_equals($secret, substr($authorization, 7));
}

function zadAuthTelegramReviewerAuthorized(): bool
{
    $secret = getenv('TELEGRAM_RECEIPT_REVIEW_SECRET');
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    return is_string($secret) && strlen($secret) >= 32
        && is_string($authorization)
        && str_starts_with($authorization, 'Bearer ')
        && hash_equals($secret, substr($authorization, 7));
}

function zadAuthTelegramBotUsername(): string
{
    $username = getenv('TELEGRAM_BOT_USERNAME');
    return is_string($username) && preg_match('/^[A-Za-z0-9_]{5,32}$/', $username)
        ? $username
        : '';
}

function zadAuthRedirect(array $config, string $query = ''): never
{
    header('Location: ' . $config['app_origin'] . '/' . $query, true, 303);
    exit;
}

$action = $_GET['action'] ?? 'me';
$config = zadAuthConfig();

if ($action === 'telegram-bot-link') {
    zadRequireMethod('POST');
    zadRequireJsonContentType();
    if (!zadAuthTelegramBotAuthorized() || $config === null) {
        zadJsonResponse(403, ['error' => 'Telegram bot authorization failed']);
    }
    zadRateLimit('telegram-bot-link', 30, 60);
    $data = zadReadJsonBody();
    $token = $data['token'] ?? null;
    $chatId = $data['chatId'] ?? null;
    if (!is_string($token) || !preg_match('/^[A-Za-z0-9_-]{40,48}$/', $token)
        || (!is_string($chatId) && !is_int($chatId))
        || !preg_match('/^[1-9][0-9]{0,19}$/', (string) $chatId)) {
        zadJsonResponse(422, ['error' => 'Telegram account link data is invalid']);
    }

    $linked = zadAuthWithUsers($config, static function (array &$users) use ($token, $chatId): bool {
        $tokenHash = hash('sha256', $token);
        foreach ($users as $userId => &$user) {
            if ((!is_string($userId) && !is_int($userId))
                || str_starts_with((string) $userId, '_') || !is_array($user)) {
                continue;
            }
            $userId = (string) $userId;
            $link = $user['telegramLink'] ?? null;
            if (!is_array($link) || !is_string($link['tokenHash'] ?? null)
                || !hash_equals($link['tokenHash'], $tokenHash)
                || !is_string($link['expiresAt'] ?? null)
                || strtotime($link['expiresAt']) <= time()) {
                continue;
            }
            $existingChatId = $user['telegramChatId'] ?? null;
            if (is_string($existingChatId) && $existingChatId !== (string) $chatId) {
                unset($user);
                return false;
            }
            foreach ($users as $otherUserId => $otherUser) {
                if ((string) $otherUserId !== $userId && is_array($otherUser)
                    && ($otherUser['telegramChatId'] ?? null) === (string) $chatId) {
                    unset($user);
                    return false;
                }
            }
            $user['telegramChatId'] = (string) $chatId;
            $user['telegramLinkedAt'] = gmdate(DATE_ATOM);
            unset($user['telegramLink']);
            unset($user);
            return true;
        }
        unset($user);
        return false;
    }, true);

    if (!$linked) {
        zadJsonResponse(404, ['error' => 'Link code is invalid, expired, or already used']);
    }
    zadJsonResponse(200, ['linked' => true]);
}

if ($action === 'telegram-bot-status') {
    zadRequireMethod('GET');
    if (!zadAuthTelegramBotAuthorized() || $config === null) {
        zadJsonResponse(403, ['error' => 'Telegram bot authorization failed']);
    }
    $chatId = $_GET['chat_id'] ?? '';
    if (!is_string($chatId) || !preg_match('/^[1-9][0-9]{0,19}$/', $chatId)) {
        zadJsonResponse(422, ['error' => 'Telegram chat identifier is invalid']);
    }
    $subscription = zadAuthWithUsers($config, static function (array $users) use ($chatId): ?array {
        foreach ($users as $userId => $user) {
            if ((is_string($userId) || is_int($userId))
                && !str_starts_with((string) $userId, '_') && is_array($user)
                && ($user['telegramChatId'] ?? null) === $chatId) {
                return is_array($user['subscription'] ?? null) ? $user['subscription'] : null;
            }
        }
        return null;
    });
    $expiresAt = is_string($subscription['expiresAt'] ?? null) ? $subscription['expiresAt'] : null;
    $active = ($subscription['status'] ?? null) === 'active'
        && (($subscription['plan'] ?? null) === 'telegram_lifetime'
            || ($expiresAt !== null && strtotime($expiresAt) > time()));
    zadJsonResponse(200, [
        'active' => $active,
        'plan' => $active ? ($subscription['plan'] ?? null) : null,
        'expiresAt' => $active ? $expiresAt : null,
    ]);
}

if (in_array($action, ['telegram-receipt-review', 'telegram-receipts', 'telegram-receipt-image'], true)) {
    if (!zadAuthTelegramReviewerAuthorized() || $config === null) {
        zadJsonResponse(403, ['error' => 'Receipt reviewer authorization failed']);
    }
    if ($action === 'telegram-receipt-review') {
        zadRequireMethod('POST');
        zadRequireJsonContentType();
        zadRateLimit('telegram-receipt-review', 60, 60);
        $data = zadReadJsonBody();
        $receiptId = $data['receiptId'] ?? null;
        $approved = $data['approved'] ?? null;
        if (!is_string($receiptId) || !preg_match('/^[a-f0-9]{32}$/', $receiptId)
            || !is_bool($approved)) {
            zadJsonResponse(422, ['error' => 'Receipt decision is invalid']);
        }
        $reviewed = zadAuthWithUsers($config, static function (array &$users) use ($receiptId, $approved): bool {
            $receipt = $users['_telegramReceipts'][$receiptId] ?? null;
            if (!is_array($receipt) || ($receipt['status'] ?? null) !== 'pending_review') {
                return false;
            }
            $userId = $receipt['userId'] ?? null;
            if (!is_string($userId) || !is_array($users[$userId] ?? null)
                || !is_string($users[$userId]['telegramChatId'] ?? null)) {
                $receipt['status'] = 'rejected';
                $receipt['reviewedAt'] = gmdate(DATE_ATOM);
                $users['_telegramReceipts'][$receiptId] = $receipt;
                return false;
            }
            $receipt['status'] = $approved ? 'approved' : 'rejected';
            $receipt['reviewedAt'] = gmdate(DATE_ATOM);
            $users['_telegramReceipts'][$receiptId] = $receipt;
            if ($approved) {
                $users[$userId]['subscription'] = [
                    'status' => 'active',
                    'plan' => 'telegram_lifetime',
                    'expiresAt' => null,
                ];
                $users[$userId]['updatedAt'] = gmdate(DATE_ATOM);
            }
            return true;
        }, true);
        if (!$reviewed) {
            zadJsonResponse(409, ['error' => 'Receipt is not pending or its account is not linked']);
        }
        zadJsonResponse(200, ['reviewed' => true, 'approved' => $approved]);
    }

    if ($action === 'telegram-receipts') {
        zadRequireMethod('GET');
        zadRateLimit('telegram-receipt-review-list', 30, 60);
        $pendingReceipts = zadAuthWithUsers($config, static function (array $users): array {
            $pending = [];
            foreach ($users['_telegramReceipts'] ?? [] as $receiptId => $receipt) {
                if (!is_string($receiptId) || !is_array($receipt)
                    || ($receipt['status'] ?? null) !== 'pending_review') {
                    continue;
                }
                $pending[] = [
                    'receiptId' => $receiptId,
                    'transactionId' => (string) ($receipt['transactionId'] ?? ''),
                    'createdAt' => (string) ($receipt['createdAt'] ?? ''),
                    'hasImage' => is_string($receipt['filePath'] ?? null),
                ];
                if (count($pending) >= 25) break;
            }
            return $pending;
        });
        zadJsonResponse(200, ['pending' => $pendingReceipts]);
    }

    if ($action === 'telegram-receipt-image') {
        zadRequireMethod('GET');
        $receiptId = $_GET['receipt_id'] ?? '';
        if (!is_string($receiptId) || !preg_match('/^[a-f0-9]{32}$/', $receiptId)) {
            zadJsonResponse(422, ['error' => 'Receipt identifier is invalid']);
        }
        $receipt = zadAuthWithUsers($config, static fn(array $users): mixed => $users['_telegramReceipts'][$receiptId] ?? null);
        if (!is_array($receipt) || !is_string($receipt['filePath'] ?? null)
            || !in_array($receipt['mimeType'] ?? null, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            zadJsonResponse(404, ['error' => 'Receipt image was not found']);
        }
        $receiptDirectory = realpath($config['data_directory'] . DIRECTORY_SEPARATOR . 'telegram-receipts');
        $receiptPath = realpath($receipt['filePath']);
        if (!is_string($receiptDirectory) || !is_string($receiptPath)
            || !str_starts_with($receiptPath, $receiptDirectory . DIRECTORY_SEPARATOR)
            || !is_file($receiptPath)) {
            zadJsonResponse(404, ['error' => 'Receipt image was not found']);
        }
        header('Content-Type: ' . $receipt['mimeType']);
        header('Content-Length: ' . filesize($receiptPath));
        header('Cache-Control: no-store, private');
        header('Content-Disposition: inline; filename="receipt-' . $receiptId . '"');
        readfile($receiptPath);
        exit;
    }
    zadJsonResponse(404, ['error' => 'Unknown receipt review action']);
}

zadAuthStartSession();

if ($action === 'me') {
    zadRequireMethod('GET');
    if ($config === null) {
        zadJsonResponse(200, ['available' => false, 'user' => null, 'plans' => zadAuthVipPlans()]);
    }
    $userId = $_SESSION['google_sub'] ?? null;
    $user = is_string($userId)
        ? zadAuthWithUsers($config, static fn(array $users): mixed => $users[$userId] ?? null)
        : null;
    if (!is_array($user)) {
        zadJsonResponse(200, ['available' => true, 'user' => null]);
    }
    $_SESSION['csrf_token'] ??= bin2hex(random_bytes(32));
    zadJsonResponse(200, [
        'available' => true,
        'csrfToken' => $_SESSION['csrf_token'],
        'plans' => zadAuthVipPlans(),
        'user' => [
            'name' => (string) ($user['name'] ?? ''),
            'email' => (string) ($user['email'] ?? ''),
            'picture' => (string) ($user['picture'] ?? ''),
            'telegramLinked' => is_string($user['telegramChatId'] ?? null),
            'subscription' => is_array($user['subscription'] ?? null)
                ? $user['subscription']
                : ['status' => 'inactive', 'plan' => null, 'expiresAt' => null],
        ],
    ]);
}

if ($action === 'vip-checkout') {
    zadRequireMethod('POST');
    zadRequireJsonContentType();
    zadAuthCsrf();
    zadRateLimit('vip-checkout', 5, 300);
    $userId = $_SESSION['google_sub'] ?? null;
    if (!is_string($userId) || $config === null) {
        zadJsonResponse(401, ['error' => 'Sign-in is required']);
    }
    $data = zadReadJsonBody();
    $planId = $data['plan'] ?? null;
    $method = $data['method'] ?? 'card';
    $plans = zadAuthVipPlans();
    if (!is_string($planId) || !isset($plans[$planId])
        || !is_string($method) || !in_array($method, ['card', 'vodafone_cash', 'etisalat_cash', 'orange_cash'], true)) {
        zadJsonResponse(422, ['error' => 'Choose an available VIP plan']);
    }
    if (($plans[$planId]['methods'][$method] ?? false) !== true
        || !zadAuthPaymobConfigured($method)) {
        zadJsonResponse(503, ['error' => 'This payment method is not configured on the server']);
    }
    $user = zadAuthWithUsers($config, static fn(array $users): mixed => $users[$userId] ?? null);
    if (!is_array($user) || !filter_var($user['email'] ?? null, FILTER_VALIDATE_EMAIL)) {
        zadJsonResponse(401, ['error' => 'A verified Google account is required']);
    }
    if ($planId === 'telegram_lifetime'
        && (!is_string($user['telegramChatId'] ?? null)
            || !preg_match('/^[1-9][0-9]{0,19}$/', $user['telegramChatId']))) {
        zadJsonResponse(409, ['error' => 'Link your Telegram account before purchasing this plan']);
    }
    $phone = preg_replace('/[\s().-]/', '', zadCleanText($data['phone'] ?? null, 24)) ?? '';
    if ($method !== 'card' && !preg_match('/^\+?[0-9]{8,15}$/', $phone)) {
        zadJsonResponse(422, ['error' => 'Enter a valid wallet phone number']);
    }

    $authResponse = zadPaymobRequest('auth/tokens', ['api_key' => getenv('PAYMOB_API_KEY')]);
    $authToken = $authResponse['token'] ?? null;
    if (!is_string($authToken) || $authToken === '') {
        zadJsonResponse(502, ['error' => 'Payment provider authentication failed']);
    }
    $amount = $plans[$planId]['amount'];
    $merchantOrderId = bin2hex(random_bytes(24));
    $orderResponse = zadPaymobRequest('ecommerce/orders', [
        'auth_token' => $authToken,
        'delivery_needed' => false,
        'amount_cents' => $amount * 100,
        'currency' => 'EGP',
        'merchant_order_id' => $merchantOrderId,
        'items' => [[
            'name' => 'Uns VIP ' . $planId,
            'amount_cents' => $amount * 100,
            'description' => 'Uns VIP prepaid subscription',
            'quantity' => 1,
        ]],
    ]);
    $orderId = $orderResponse['id'] ?? null;
    if ((!is_int($orderId) && !is_string($orderId)) || (string) $orderId === '') {
        zadJsonResponse(502, ['error' => 'Payment provider could not create the order']);
    }

    $nameParts = preg_split('/\s+/u', zadCleanText($user['name'] ?? null, 80), 2) ?: [];
    $integrationEnvironment = [
        'card' => 'PAYMOB_CARD_INTEGRATION_ID',
        'vodafone_cash' => 'PAYMOB_VODAFONE_CASH_INTEGRATION_ID',
        'etisalat_cash' => 'PAYMOB_ETISALAT_CASH_INTEGRATION_ID',
        'orange_cash' => 'PAYMOB_ORANGE_CASH_INTEGRATION_ID',
    ];
    $paymentResponse = zadPaymobRequest('acceptance/payment_keys', [
        'auth_token' => $authToken,
        'amount_cents' => $amount * 100,
        'expiration' => 1800,
        'order_id' => $orderId,
        'billing_data' => [
            'apartment' => 'NA',
            'email' => strtolower((string) $user['email']),
            'floor' => 'NA',
            'first_name' => $nameParts[0] ?? 'Uns',
            'street' => 'NA',
            'building' => 'NA',
            'phone_number' => $method === 'card' ? 'NA' : $phone,
            'shipping_method' => 'NA',
            'postal_code' => 'NA',
            'city' => 'Cairo',
            'country' => 'EG',
            'last_name' => $nameParts[1] ?? 'User',
            'state' => 'Cairo',
        ],
        'currency' => 'EGP',
        'integration_id' => (int) getenv($integrationEnvironment[$method]),
        'lock_order_when_paid' => true,
    ]);
    $paymentToken = $paymentResponse['token'] ?? null;
    if (!is_string($paymentToken) || $paymentToken === '') {
        zadJsonResponse(502, ['error' => 'Payment provider could not create a secure checkout']);
    }

    $orderKey = (string) $orderId;
    $telegramChatId = $planId === 'telegram_lifetime'
        ? (string) $user['telegramChatId']
        : null;
    zadAuthWithUsers($config, static function (array &$users) use (
        $orderKey,
        $userId,
        $planId,
        $method,
        $telegramChatId,
        $amount,
        $plans,
        $merchantOrderId
    ): void {
        if (isset($users['_orders'][$orderKey])) {
            zadJsonResponse(409, ['error' => 'Payment order already exists']);
        }
        $users['_orders'][$orderKey] = [
            'userId' => $userId,
            'plan' => $planId,
            'method' => $method,
            'days' => $plans[$planId]['days'],
            'telegramChatId' => $telegramChatId,
            'amount' => $amount,
            'currency' => 'EGP',
            'merchantOrderId' => $merchantOrderId,
            'status' => 'pending',
            'createdAt' => gmdate(DATE_ATOM),
        ];
    }, true);

    $iframeId = (string) getenv('PAYMOB_IFRAME_ID');
    zadJsonResponse(200, [
        'redirectUrl' => 'https://accept.paymob.com/api/acceptance/iframes/'
            . rawurlencode($iframeId) . '?payment_token=' . rawurlencode($paymentToken),
    ]);
}

if ($action === 'telegram-link') {
    zadRequireMethod('POST');
    zadRequireSameOrigin();
    zadRequireJsonContentType();
    zadAuthCsrf();
    zadRateLimit('telegram-account-link', 5, 300);
    $userId = $_SESSION['google_sub'] ?? null;
    $username = zadAuthTelegramBotUsername();
    if (!is_string($userId) || $config === null) {
        zadJsonResponse(401, ['error' => 'Sign-in is required']);
    }
    if ($username === '' || strlen((string) getenv('TELEGRAM_BOT_API_SECRET')) < 32) {
        zadJsonResponse(503, ['error' => 'Telegram account linking is not configured']);
    }

    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $expiresAt = gmdate(DATE_ATOM, time() + 600);
    zadAuthWithUsers($config, static function (array &$users) use ($userId, $token, $expiresAt): void {
        if (!is_array($users[$userId] ?? null)) {
            zadJsonResponse(404, ['error' => 'Account record was not found']);
        }
        $users[$userId]['telegramLink'] = [
            'tokenHash' => hash('sha256', $token),
            'expiresAt' => $expiresAt,
        ];
    }, true);
    zadJsonResponse(200, [
        'startUrl' => 'https://t.me/' . rawurlencode($username) . '?start=link_' . rawurlencode($token),
        'expiresAt' => $expiresAt,
    ]);
}

if ($action === 'telegram-instapay') {
    zadRequireMethod('POST');
    zadRequireSameOrigin();
    zadRequireJsonContentType();
    zadAuthCsrf();
    zadRateLimit('telegram-instapay', 5, 300);
    $userId = $_SESSION['google_sub'] ?? null;
    if (!is_string($userId) || $config === null) {
        zadJsonResponse(401, ['error' => 'Sign-in is required']);
    }
    $user = zadAuthWithUsers($config, static fn(array $users): mixed => $users[$userId] ?? null);
    if (!is_array($user) || !is_string($user['telegramChatId'] ?? null)) {
        zadJsonResponse(409, ['error' => 'Link your Telegram account before purchasing this plan']);
    }
    $paymentUrl = getenv('INSTAPAY_PAYMENT_URL');
    $urlParts = is_string($paymentUrl) ? parse_url($paymentUrl) : false;
    if (!is_string($paymentUrl) || $paymentUrl === '' || !is_array($urlParts)
        || ($urlParts['scheme'] ?? '') !== 'https' || empty($urlParts['host'])
        || isset($urlParts['user']) || isset($urlParts['pass'])) {
        zadJsonResponse(503, ['error' => 'InstaPay is not configured safely']);
    }
    zadJsonResponse(200, [
        'redirectUrl' => $paymentUrl,
        'amount' => zadAuthVipPlans()['telegram_lifetime']['amount'],
        'currency' => 'EGP',
    ]);
}

if ($action === 'telegram-receipt') {
    zadRequireMethod('POST');
    zadRequireSameOrigin();
    zadAuthCsrf();
    zadRateLimit('telegram-receipt', 3, 3600);
    $userId = $_SESSION['google_sub'] ?? null;
    if (!is_string($userId) || $config === null) {
        zadJsonResponse(401, ['error' => 'Sign-in is required']);
    }
    $user = zadAuthWithUsers($config, static fn(array $users): mixed => $users[$userId] ?? null);
    if (!is_array($user) || !is_string($user['telegramChatId'] ?? null)) {
        zadJsonResponse(409, ['error' => 'Link your Telegram account before submitting payment evidence']);
    }

    $transactionId = zadCleanText($_POST['transactionId'] ?? null, 120);
    $upload = $_FILES['receipt'] ?? null;
    $receiptMime = null;
    $receiptPath = null;
    if (is_array($upload) && ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        if (($upload['error'] ?? null) !== UPLOAD_ERR_OK
            || !is_string($upload['tmp_name'] ?? null)
            || !is_int($upload['size'] ?? null)
            || $upload['size'] < 1 || $upload['size'] > 2 * 1024 * 1024
            || !is_uploaded_file($upload['tmp_name'])) {
            zadJsonResponse(422, ['error' => 'Receipt image must be no larger than 2 MB']);
        }
        $fileInfo = new finfo(FILEINFO_MIME_TYPE);
        $receiptMime = $fileInfo->file($upload['tmp_name']);
        $image = @getimagesize($upload['tmp_name']);
        $allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!is_string($receiptMime) || !in_array($receiptMime, $allowedImageTypes, true)
            || !is_array($image) || ($image[0] ?? 0) < 1 || ($image[1] ?? 0) < 1
            || ($image[0] ?? 0) > 8000 || ($image[1] ?? 0) > 8000) {
            zadJsonResponse(422, ['error' => 'Upload a valid JPEG, PNG, or WebP receipt image']);
        }
        $receiptDirectory = $config['data_directory'] . DIRECTORY_SEPARATOR . 'telegram-receipts';
        if (!is_dir($receiptDirectory)
            && !mkdir($receiptDirectory, 0700, true) && !is_dir($receiptDirectory)) {
            zadJsonResponse(503, ['error' => 'Receipt storage is unavailable']);
        }
        $resolvedReceiptDirectory = realpath($receiptDirectory);
        $webRoot = realpath(__DIR__);
        if (!is_string($resolvedReceiptDirectory) || !is_string($webRoot)
            || str_starts_with($resolvedReceiptDirectory, $webRoot . DIRECTORY_SEPARATOR)) {
            zadJsonResponse(503, ['error' => 'Receipt storage must be outside the web root']);
        }
        $extension = ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/webp' => '.webp'][$receiptMime];
        $receiptPath = $resolvedReceiptDirectory . DIRECTORY_SEPARATOR . bin2hex(random_bytes(20)) . $extension;
        if (!move_uploaded_file($upload['tmp_name'], $receiptPath)) {
            zadJsonResponse(503, ['error' => 'Receipt image could not be stored securely']);
        }
        if (function_exists('chmod')) {
            chmod($receiptPath, 0600);
        }
    }
    if ($transactionId === '' && $receiptPath === null) {
        zadJsonResponse(422, ['error' => 'Enter a transaction ID or attach a receipt image']);
    }

    $receiptId = bin2hex(random_bytes(16));
    try {
        zadAuthWithUsers($config, static function (array &$users) use (
            $userId,
            $receiptId,
            $transactionId,
            $receiptPath,
            $receiptMime
        ): void {
            $users['_telegramReceipts'][$receiptId] = [
                'userId' => $userId,
                'transactionId' => $transactionId,
                'filePath' => $receiptPath,
                'mimeType' => $receiptMime,
                'status' => 'pending_review',
                'createdAt' => gmdate(DATE_ATOM),
            ];
        }, true);
    } catch (JsonException $error) {
        if (is_string($receiptPath) && is_file($receiptPath)) {
            unlink($receiptPath);
        }
        throw $error;
    }
    zadJsonResponse(202, ['receiptId' => $receiptId, 'status' => 'pending_review']);
}

if ($action === 'google') {
    zadRequireMethod('GET');
    if ($config === null) {
        zadJsonResponse(503, ['error' => 'Google OAuth is not configured on the server']);
    }
    zadRateLimit('google-oauth-start', 10, 300);
    $state = bin2hex(random_bytes(32));
    $nonce = bin2hex(random_bytes(32));
    $verifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    $_SESSION['google_oauth_state'] = $state;
    $_SESSION['google_oauth_nonce'] = $nonce;
    $_SESSION['google_oauth_verifier'] = $verifier;
    $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    $query = http_build_query([
        'client_id' => $config['client_id'],
        'redirect_uri' => $config['redirect_uri'],
        'response_type' => 'code',
        'scope' => 'openid email profile',
        'state' => $state,
        'nonce' => $nonce,
        'code_challenge' => $challenge,
        'code_challenge_method' => 'S256',
        'prompt' => 'select_account',
    ]);
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . $query, true, 302);
    exit;
}

if ($action === 'callback') {
    zadRequireMethod('GET');
    if ($config === null) {
        http_response_code(503);
        exit('Google OAuth is not configured on the server.');
    }
    $state = $_GET['state'] ?? '';
    $code = $_GET['code'] ?? '';
    $expectedState = $_SESSION['google_oauth_state'] ?? '';
    $nonce = $_SESSION['google_oauth_nonce'] ?? '';
    $verifier = $_SESSION['google_oauth_verifier'] ?? '';
    unset($_SESSION['google_oauth_state'], $_SESSION['google_oauth_nonce'], $_SESSION['google_oauth_verifier']);
    if (!is_string($state) || !is_string($expectedState) || !hash_equals($expectedState, $state)
        || !is_string($code) || $code === '' || !is_string($nonce) || !is_string($verifier)) {
        zadAuthRedirect($config, '?auth=failed');
    }

    $token = zadAuthRequest('https://oauth2.googleapis.com/token', [
        'code' => $code,
        'client_id' => $config['client_id'],
        'client_secret' => $config['client_secret'],
        'redirect_uri' => $config['redirect_uri'],
        'grant_type' => 'authorization_code',
        'code_verifier' => $verifier,
    ], true);
    $idToken = $token['id_token'] ?? '';
    $accessToken = $token['access_token'] ?? '';
    if (!is_string($idToken) || $idToken === '' || !is_string($accessToken) || $accessToken === '') {
        zadAuthRedirect($config, '?auth=failed');
    }
    $claims = zadAuthRequest(
        'https://oauth2.googleapis.com/tokeninfo?' . http_build_query(['id_token' => $idToken]),
        [],
        false,
    );
    $issuer = $claims['iss'] ?? '';
    $expiry = filter_var($claims['exp'] ?? null, FILTER_VALIDATE_INT);
    if (!in_array($issuer, ['https://accounts.google.com', 'accounts.google.com'], true)
        || !is_string($claims['aud'] ?? null) || !hash_equals($config['client_id'], $claims['aud'])
        || !is_string($claims['nonce'] ?? null) || !hash_equals($nonce, $claims['nonce'])
        || !is_int($expiry) || $expiry <= time()
        || !in_array($claims['email_verified'] ?? null, [true, 'true'], true)
        || !is_string($claims['sub'] ?? null) || $claims['sub'] === '') {
        zadAuthRedirect($config, '?auth=failed');
    }
    $googleUser = zadAuthRequest(
        'https://openidconnect.googleapis.com/v1/userinfo',
        [],
        false,
        $accessToken,
    );
    if (!is_string($googleUser['sub'] ?? null) || !hash_equals($claims['sub'], $googleUser['sub'])
        || !is_string($googleUser['email'] ?? null)
        || !in_array($googleUser['email_verified'] ?? null, [true, 'true'], true)) {
        zadAuthRedirect($config, '?auth=failed');
    }

    $userId = $claims['sub'];
    $now = gmdate(DATE_ATOM);
    zadAuthWithUsers($config, static function (array &$users) use ($userId, $googleUser, $now): void {
        $user = is_array($users[$userId] ?? null) ? $users[$userId] : [];
        $user['name'] = (string) ($user['name'] ?? $googleUser['name'] ?? '');
        $user['email'] = strtolower($googleUser['email']);
        $user['picture'] = zadAuthSafePicture($googleUser['picture'] ?? '');
        $user['createdAt'] = (string) ($user['createdAt'] ?? $now);
        $user['updatedAt'] = $now;
        $user['subscription'] = is_array($user['subscription'] ?? null)
            ? $user['subscription']
            : ['status' => 'inactive', 'plan' => null, 'expiresAt' => null];
        $users[$userId] = $user;
    }, true);
    session_regenerate_id(true);
    $_SESSION['google_sub'] = $userId;
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    zadAuthRedirect($config, '?auth=success');
}

if ($action === 'profile') {
    zadRequireMethod('POST');
    zadRequireSameOrigin();
    zadRequireJsonContentType();
    zadAuthCsrf();
    zadRateLimit('account-profile-update', 20, 300);
    $userId = $_SESSION['google_sub'] ?? null;
    if (!is_string($userId) || $config === null) {
        zadJsonResponse(401, ['error' => 'Sign-in is required']);
    }
    $data = zadReadJsonBody();
    $name = zadCleanText($data['name'] ?? null, 80);
    if ($name === '') {
        zadJsonResponse(422, ['error' => 'Enter a valid profile name']);
    }
    $user = zadAuthWithUsers($config, static function (array &$users) use ($userId, $name): ?array {
        if (!is_array($users[$userId] ?? null)) {
            return null;
        }
        $users[$userId]['name'] = $name;
        $users[$userId]['updatedAt'] = gmdate(DATE_ATOM);
        return $users[$userId];
    }, true);
    if (!is_array($user)) {
        zadJsonResponse(404, ['error' => 'Account record was not found']);
    }
    zadJsonResponse(200, ['user' => ['name' => $user['name']]]);
}

if ($action === 'logout') {
    zadRequireMethod('POST');
    zadRequireSameOrigin();
    zadRequireJsonContentType();
    zadAuthCsrf();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $params['path'],
            'domain' => $params['domain'],
            'secure' => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => 'Lax',
        ]);
    }
    session_destroy();
    zadJsonResponse(200, ['ok' => true]);
}

zadJsonResponse(404, ['error' => 'Unknown authentication action']);
