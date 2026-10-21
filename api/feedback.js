const ALLOWED_CATEGORIES = new Set(['suggestion', 'note', 'complaint', 'issue', 'other']);
const MAX_MESSAGE_LENGTH = 2000;
const MAX_BODY_BYTES = 16_384;

function sendJson(res, statusCode, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(statusCode).json(body);
}

function parseRequestBody(body) {
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

export function createFeedbackHandler(environment = process.env) {
  return async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return;
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) {
    sendJson(res, 403, { success: false, error: 'Request origin is not allowed' });
    return;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    sendJson(res, 403, { success: false, error: 'Request origin is not allowed' });
    return;
  }
  if (parsedOrigin.host.toLowerCase() !== host.toLowerCase()
    || (parsedOrigin.protocol !== 'https:' && parsedOrigin.hostname !== 'localhost'
      && parsedOrigin.hostname !== '127.0.0.1')) {
    sendJson(res, 403, { success: false, error: 'Request origin is not allowed' });
    return;
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    sendJson(res, 413, { success: false, error: 'Feedback request is too large' });
    return;
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, { success: false, error: 'Expected JSON request body' });
    return;
  }

  let payload;
  try {
    payload = parseRequestBody(req.body);
  } catch {
    sendJson(res, 400, { success: false, error: 'Invalid JSON request body' });
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !ALLOWED_CATEGORIES.has(payload.category)
    || typeof payload.message !== 'string'
    || payload.message.trim().length === 0
    || payload.message.length > MAX_MESSAGE_LENGTH
    || typeof payload.requestId !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(payload.requestId)) {
    sendJson(res, 422, { success: false, error: 'Feedback fields are invalid' });
    return;
  }

  const scriptUrl = environment?.ZAD_FEEDBACK_SCRIPT_URL;
  const sharedSecret = environment?.ZAD_FEEDBACK_WEBHOOK_SECRET;
  if (!scriptUrl || !sharedSecret) {
    sendJson(res, 503, { success: false, error: 'Feedback service is not configured' });
    return;
  }

  let parsedScriptUrl;
  try {
    parsedScriptUrl = new URL(scriptUrl);
  } catch {
    sendJson(res, 503, { success: false, error: 'Feedback service is not configured' });
    return;
  }
  if (parsedScriptUrl.protocol !== 'https:'
    || parsedScriptUrl.hostname !== 'script.google.com'
    || !/^\/macros\/s\/[^/]+\/exec$/.test(parsedScriptUrl.pathname)
    || parsedScriptUrl.search
    || parsedScriptUrl.hash
    || parsedScriptUrl.username
    || parsedScriptUrl.password
    || !/^[0-9a-f]{64,}$/i.test(sharedSecret)) {
    sendJson(res, 503, { success: false, error: 'Feedback service is not configured' });
    return;
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const clientAddress = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim().slice(0, 128)
    : '';

  try {
    const upstreamResponse = await fetch(parsedScriptUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        secret: sharedSecret,
        requestId: payload.requestId,
        category: payload.category,
        message: payload.message.trim(),
        clientAddress,
      }),
      redirect: 'follow',
    });
    const result = await upstreamResponse.json();
    if (!upstreamResponse.ok || result.success !== true) {
      sendJson(res, 502, { success: false, error: 'Feedback could not be delivered' });
      return;
    }
    sendJson(res, 200, { success: true });
  } catch {
    sendJson(res, 502, { success: false, error: 'Feedback service is unavailable' });
  }
  };
}

export default createFeedbackHandler();
