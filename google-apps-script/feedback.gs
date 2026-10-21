const FEEDBACK_RECIPIENT = '25yjdx@gmail.com';
const FEEDBACK_SHEET_NAME = 'Feedback';
const FEEDBACK_CATEGORIES = new Set(['suggestion', 'note', 'complaint', 'issue', 'other']);
const FEEDBACK_LIMIT = 5;
const FEEDBACK_WINDOW_SECONDS = 300;

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEquals(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function digestHex(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8,
  ).map((byte) => (byte + 256).toString(16).slice(-2)).join('');
}

function getFeedbackSheet(spreadsheetId) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(FEEDBACK_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(FEEDBACK_SHEET_NAME);
  const headers = ['Request ID', 'Received At (UTC)', 'Category', 'Message', 'Email Status'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((header, index) => existingHeaders[index] !== header)) {
      throw new Error('The Feedback sheet has an unexpected column layout.');
    }
  }
  return sheet;
}

function authorizeFeedbackIntegrations() {
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty('FEEDBACK_WEBHOOK_SECRET') || '';
  const spreadsheetId = properties.getProperty('FEEDBACK_SPREADSHEET_ID') || '';
  if (!/^[0-9a-f]{64,}$/i.test(secret) || !spreadsheetId) {
    throw new Error('Set FEEDBACK_WEBHOOK_SECRET and FEEDBACK_SPREADSHEET_ID first.');
  }
  getFeedbackSheet(spreadsheetId);
  MailApp.getRemainingDailyQuota();
}

function findRequestRow(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(requestId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function doPost(event) {
  const properties = PropertiesService.getScriptProperties();
  const expectedSecret = properties.getProperty('FEEDBACK_WEBHOOK_SECRET') || '';
  const spreadsheetId = properties.getProperty('FEEDBACK_SPREADSHEET_ID') || '';
  if (!/^[0-9a-f]{64,}$/i.test(expectedSecret)
    || !spreadsheetId
    || !event?.postData?.contents) {
    return jsonResponse({ success: false, error: 'Feedback service is not configured' });
  }

  let payload;
  try {
    payload = JSON.parse(event.postData.contents);
  } catch {
    return jsonResponse({ success: false, error: 'Invalid request' });
  }

  if (!payload || typeof payload !== 'object'
    || typeof payload.secret !== 'string'
    || !constantTimeEquals(payload.secret, expectedSecret)
    || typeof payload.requestId !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(payload.requestId)
    || typeof payload.category !== 'string'
    || !FEEDBACK_CATEGORIES.has(payload.category)
    || typeof payload.message !== 'string'
    || payload.message.trim().length === 0
    || payload.message.length > 2000
    || typeof payload.clientAddress !== 'string') {
    return jsonResponse({ success: false, error: 'Invalid request' });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonResponse({ success: false, error: 'Feedback service is busy' });
  }

  try {
    const sheet = getFeedbackSheet(spreadsheetId);
    let row = findRequestRow(sheet, payload.requestId);
    if (row && sheet.getRange(row, 5).getValue() === 'SENT') {
      return jsonResponse({ success: true });
    }

    if (!row) {
      if (payload.clientAddress) {
        const rateLimitKey = `feedback:${digestHex(`${expectedSecret}:${payload.clientAddress}`)}`;
        const cache = CacheService.getScriptCache();
        const currentCount = Number(cache.get(rateLimitKey) || 0);
        if (currentCount >= FEEDBACK_LIMIT) {
          return jsonResponse({ success: false, error: 'Rate limit exceeded' });
        }
        cache.put(rateLimitKey, String(currentCount + 1), FEEDBACK_WINDOW_SECONDS);
      }

      const newRow = sheet.getLastRow() + 1;
      const rowRange = sheet.getRange(newRow, 1, 1, 5);
      rowRange.setNumberFormat('@');
      rowRange.setValues([[
        payload.requestId,
        new Date().toISOString(),
        payload.category,
        payload.message.trim(),
        'PENDING',
      ]]);
      row = newRow;
    }

    const categoryLabels = {
      suggestion: 'اقتراح',
      note: 'ملاحظة',
      complaint: 'شكوى',
      issue: 'بلاغ عن مشكلة',
      other: 'أخرى',
    };
    MailApp.sendEmail({
      to: FEEDBACK_RECIPIENT,
      subject: `رسالة جديدة من تطبيق أُنْس: ${categoryLabels[payload.category]}`,
      body: [
        'وصلت رسالة جديدة من نموذج الملاحظات في تطبيق أُنْس.',
        `النوع: ${categoryLabels[payload.category]}`,
        '',
        payload.message.trim(),
        '',
        `رقم الإرسال: ${payload.requestId}`,
      ].join('\n'),
    });
    sheet.getRange(row, 5).setValue('SENT');
    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ success: false, error: 'Feedback could not be saved or emailed' });
  } finally {
    lock.releaseLock();
  }
}
