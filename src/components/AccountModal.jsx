import { useEffect, useState } from 'react';
import { appUrl, fetchApp } from '../services/appUrl.js';
import { parseStoredJson, serializeStoredJson } from '../services/storage.js';

const MAX_NAME_LENGTH = 80;
const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_DATA_URL_LENGTH = 300_000;
const DEMO_PROFILE_KEY = 'zad.demoProfile';
const TELEGRAM_BOT_USERNAME = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const TELEGRAM_BOT_CONFIGURED = /^[A-Za-z0-9_]{5,32}$/.test(TELEGRAM_BOT_USERNAME);
const TELEGRAM_START_URL = TELEGRAM_BOT_CONFIGURED
  ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=zad`
  : '';
const TELEGRAM_SUBSCRIBE_URL = TELEGRAM_BOT_CONFIGURED
  ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=subscribe`
  : '';

function signalProfileHydrated() {
  window.__zadHydrationState = { ...window.__zadHydrationState, profile: true };
  window.dispatchEvent(new Event('zad:profile-ready'));
}

function signalTelegramActivated() {
  try {
    if (window.localStorage.getItem('zad.telegramLifetimeActivated.v1') === 'true') return;
    window.localStorage.setItem('zad.telegramLifetimeActivated.v1', 'true');
  } catch (error) {
    console.warn('Could not persist Telegram activation state.', error);
  }
  window.__zadTelegramActivationPending = true;
  window.dispatchEvent(new Event('zad:telegram-activated'));
}

async function readResponse(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new Error('استجابة خدمة الحساب غير صالحة.');
  }
  const serialized = await response.text();
  if (serialized.length > 64 * 1024) throw new Error('استجابة خدمة الحساب غير صالحة.');
  const payload = parseStoredJson(serialized, null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('استجابة خدمة الحساب غير صالحة.');
  }
  if (!response.ok) {
    throw new Error('تعذر إكمال طلب الحساب حالياً.');
  }
  return payload;
}

function getAvatarInitial(name) {
  return Array.from(name.trim())[0] || 'ز';
}

function readDemoProfile() {
  const profile = parseStoredJson(window.localStorage.getItem(DEMO_PROFILE_KEY), null);
  if (profile === null) return null;
  if (!profile || typeof profile !== 'object' || typeof profile.name !== 'string'
    || typeof profile.picture !== 'string' || profile.name.length > MAX_NAME_LENGTH
    || profile.picture.length > MAX_AVATAR_DATA_URL_LENGTH || !isSecureAvatarUrl(profile.picture)) {
    throw new Error('بيانات الملف المحلي غير صالحة. احذف بيانات الملف التجريبي ثم حاول مجدداً.');
  }
  return {
    id: 'local-demo',
    name: profile.name,
    email: '',
    picture: profile.picture,
    isDemo: true,
  };
}

function persistDemoProfile(profile) {
  const serialized = serializeStoredJson({
    name: profile.name,
    picture: profile.picture,
  });
  if (serialized === null) throw new Error('تعذر حفظ الملف التجريبي محلياً.');
  window.localStorage.setItem(DEMO_PROFILE_KEY, serialized);
}

function isSecureAvatarUrl(value) {
  if (!value) return true;
  if (value.length > MAX_AVATAR_DATA_URL_LENGTH) return false;
  if (/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function loadAvatarImage(file) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      if (image.naturalWidth && image.naturalHeight) resolve(image);
      else reject(new Error('أبعاد الصورة غير مدعومة.'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('تعذر قراءة الصورة. اختر صورة أخرى بصيغة PNG أو JPEG أو WebP.'));
    };
    image.src = imageUrl;
  });
}

async function resizeAvatarImage(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    || file.size > MAX_AVATAR_FILE_BYTES) {
    throw new Error('اختر صورة PNG أو JPEG أو WebP لا يتجاوز حجمها 5 ميغابايت.');
  }
  const image = await loadAvatarImage(file);
  if (!image.naturalWidth || !image.naturalHeight
    || image.naturalWidth > 8192 || image.naturalHeight > 8192) {
    throw new Error('أبعاد الصورة غير مدعومة.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('تعذر تجهيز الصورة في هذا المتصفح.');
  const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
  const cropX = (image.naturalWidth - cropSize) / 2;
  const cropY = (image.naturalHeight - cropSize) / 2;
  context.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, 256, 256);
  const avatarBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.78));
  if (!avatarBlob || avatarBlob.size > 200 * 1024) {
    throw new Error('تعذر ضغط الصورة إلى حجم آمن. اختر صورة أصغر.');
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('تعذر تجهيز الصورة الشخصية.'));
    reader.readAsDataURL(avatarBlob);
  });
  if (!isSecureAvatarUrl(dataUrl)) throw new Error('تعذر التحقق من الصورة الشخصية.');
  return dataUrl;
}

export default function AccountModal() {
  const [account, setAccount] = useState({
    available: false,
    loading: true,
    user: null,
    csrfToken: '',
    mode: 'server',
  });
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState('');
  const [plans, setPlans] = useState({});
  const [telegramStartUrl, setTelegramStartUrl] = useState('');
  const [walletPhone, setWalletPhone] = useState('');
  const [receiptStatus, setReceiptStatus] = useState('');

  async function handleAvatarUpload(event) {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      const avatarDataUrl = await resizeAvatarImage(file);
      setAvatarUrl(avatarDataUrl);
      setSaved(false);
      setStatus('تم تجهيز الصورة. احفظ الملف لتثبيتها على هذا الجهاز.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر تجهيز الصورة الشخصية.');
    } finally {
      event.target.value = '';
    }
  }

  function createLocalProfile(event) {
    event.preventDefault();
    const normalizedName = name.replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH)
      || 'زائر أُنْس';
    const picture = avatarUrl.trim();
    if (!isSecureAvatarUrl(picture)) {
      setSaved(false);
      setStatus('اختر صورة محلية آمنة أو اترك الصورة فارغة.');
      return;
    }
    const demoProfile = {
      id: 'local-demo',
      name: normalizedName,
      email: '',
      picture,
      isDemo: true,
    };
    try {
      persistDemoProfile(demoProfile);
      setAccount((current) => ({ ...current, user: demoProfile }));
      setName(normalizedName);
      setAvatarUrl(picture);
      setSaved(true);
      setStatus('تم إنشاء ملفك المحلي على هذا الجهاز.');
    } catch {
      setSaved(false);
      setStatus('تعذر حفظ الملف محلياً. تحقق من مساحة التخزين في المتصفح.');
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    function enableLocalMode(message = '') {
      let demoProfile = null;
      let localStatus = message;
      try {
        demoProfile = readDemoProfile();
      } catch {
        localStatus = 'تعذر استعادة الملف المحلي. يمكنك بدء ملف تجريبي جديد وحفظه على هذا الجهاز.';
      }
      setAccount({
        available: false,
        loading: false,
        user: demoProfile,
        csrfToken: '',
        mode: 'local',
      });
      setName(demoProfile?.name || '');
      setAvatarUrl(demoProfile?.picture || '');
      setStatus(localStatus);
      signalProfileHydrated();
    }

    async function loadAccount() {
      if (import.meta.env.DEV || __GITHUB_PAGES__) {
        enableLocalMode();
        return;
      }

      try {
        const response = await fetchApp('auth.php?action=me', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        const payload = await readResponse(response);
        setAccount({
          available: payload.available === true,
          loading: false,
          user: payload.user || null,
          csrfToken: payload.csrfToken || '',
          mode: payload.available === true ? 'server' : 'local',
        });
        setPlans(payload.plans || {});
        setName(payload.user?.name || '');
        setAvatarUrl(payload.user?.picture || '');
        if (payload.user?.subscription?.status === 'active'
          && payload.user.subscription.plan === 'telegram_lifetime') {
          signalTelegramActivated();
        }
        signalProfileHydrated();
        if (payload.available !== true) {
          enableLocalMode();
          return;
        }

        const authResult = new URLSearchParams(window.location.search).get('auth');
        if (authResult === 'success') {
          setStatus(payload.user
            ? 'تم تسجيل الدخول والتحقق من حساب Google بنجاح.'
            : 'لم نتمكن من استعادة جلسة الحساب. يرجى تسجيل الدخول مرة أخرى.');
        }
        if (authResult === 'failed') setStatus('تعذر التحقق من تسجيل الدخول. حاول مرة أخرى.');
        if (authResult) {
          window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        enableLocalMode('خدمة الحسابات غير متاحة الآن. يمكنك المتابعة بملف تجريبي محلي.');
      }
    }

    loadAccount();
    return () => controller.abort();
  }, []);

  async function submitProfile(event) {
    event.preventDefault();
    const normalizedName = name.replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ');
    if (!normalizedName) {
      setSaved(false);
      setStatus('أدخل اسماً صالحاً قبل الحفظ.');
      return;
    }
    if (normalizedName.length > MAX_NAME_LENGTH) {
      setSaved(false);
      setStatus(`يجب ألا يتجاوز الاسم ${MAX_NAME_LENGTH} حرفاً.`);
      return;
    }
    setName(normalizedName);

    if (account.mode === 'local') {
      if (!isSecureAvatarUrl(avatarUrl.trim())) {
        setSaved(false);
        setStatus('أدخل رابط صورة آمن يبدأ بـ https:// أو اتركه فارغاً.');
        return;
      }
      const demoProfile = {
        id: 'local-demo',
        name: normalizedName,
        email: '',
        picture: avatarUrl.trim(),
        isDemo: true,
      };
      try {
        persistDemoProfile(demoProfile);
        setAccount((current) => ({ ...current, user: demoProfile }));
        setName(normalizedName);
        setAvatarUrl(demoProfile.picture);
        setSaved(true);
        setStatus('تم حفظ الملف التجريبي على هذا الجهاز.');
      } catch {
        setSaved(false);
        setStatus('تعذر حفظ الملف محلياً. تحقق من مساحة التخزين في المتصفح.');
      }
      return;
    }

    try {
      const response = await fetchApp('auth.php?action=profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': account.csrfToken,
        },
        body: JSON.stringify({ name: normalizedName }),
      });
      const payload = await readResponse(response);
      setAccount((current) => ({
        ...current,
        user: { ...current.user, ...payload.user },
      }));
      setSaved(true);
      setStatus('تم تحديث بيانات ملفك في الحساب.');
    } catch {
      setSaved(false);
      setStatus('تعذر حفظ التغييرات الآن. تحقق من اتصال الحساب وحاول مجدداً.');
    }
  }

  async function signOut() {
    if (account.mode === 'local') {
      try {
        window.localStorage.removeItem(DEMO_PROFILE_KEY);
        setAccount((current) => ({ ...current, user: null }));
        setName('');
        setAvatarUrl('');
        setSaved(false);
        setStatus('تم تسجيل الخروج من الملف التجريبي على هذا الجهاز.');
      } catch {
        setStatus('تعذر تسجيل الخروج محلياً. تحقق من إعدادات التخزين في المتصفح.');
      }
      return;
    }

    try {
      const response = await fetchApp('auth.php?action=logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': account.csrfToken,
        },
        body: '{}',
      });
      await readResponse(response);
      setAccount((current) => ({ ...current, user: null, csrfToken: '' }));
      setName('');
      setAvatarUrl('');
      setSaved(false);
      setStatus('تم تسجيل الخروج من هذا الجهاز.');
    } catch {
      setStatus('تعذر تسجيل الخروج الآن. تحقق من اتصال الحساب وحاول مجدداً.');
    }
  }

  async function refreshAccountStatus() {
    try {
      const response = await fetchApp('auth.php?action=me', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = await readResponse(response);
      const priorSubscription = account.user?.subscription;
      const nextUser = payload.user || null;
      setAccount((current) => ({
        ...current,
        available: payload.available === true,
        user: nextUser,
        csrfToken: payload.csrfToken || current.csrfToken,
        mode: payload.available === true ? 'server' : 'local',
      }));
      setPlans(payload.plans || {});
      if (priorSubscription?.plan !== 'telegram_lifetime'
        && nextUser?.subscription?.plan === 'telegram_lifetime'
        && nextUser.subscription.status === 'active') {
        signalTelegramActivated();
      }
      setStatus(nextUser?.telegramLinked
        ? 'تم التحقق من ربط حساب Telegram.'
        : 'لم يكتمل ربط Telegram بعد. افتح رابط الربط من البوت ثم حدّث الحالة.');
    } catch {
      setStatus('تعذر تحديث حالة الحساب الآن. حاول مرة أخرى بعد قليل.');
    }
  }

  async function createTelegramLink() {
    setStatus('');
    setTelegramStartUrl('');
    try {
      const response = await fetchApp('auth.php?action=telegram-link', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': account.csrfToken,
        },
        body: '{}',
      });
      const payload = await readResponse(response);
      if (typeof payload.startUrl !== 'string'
        || !/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=link_[A-Za-z0-9_-]{40,48}$/.test(payload.startUrl)) {
        throw new Error('رابط ربط Telegram غير صالح.');
      }
      setTelegramStartUrl(payload.startUrl);
      setStatus('افتح الرابط في Telegram، ثم ارجع واضغط «تحديث حالة الربط».');
    } catch (error) {
      setStatus(error instanceof Error
        ? error.message
        : 'تعذر إنشاء رابط ربط Telegram الآن.');
    }
  }

  async function startCheckout(planId, method = 'card') {
    if (method !== 'card' && !/^\+?[0-9]{8,15}$/.test(walletPhone.replace(/[\s().-]/g, ''))) {
      setStatus('أدخل رقم المحفظة الصحيح قبل متابعة الدفع.');
      return;
    }
    setCheckoutPlan(`${planId}:${method}`);
    setStatus('');
    try {
      const response = await fetchApp('auth.php?action=vip-checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': account.csrfToken,
        },
        body: JSON.stringify({
          plan: planId,
          method,
          ...(method !== 'card' ? { phone: walletPhone } : {}),
        }),
      });
      const payload = await readResponse(response);
      if (typeof payload.redirectUrl !== 'string'
        || !payload.redirectUrl.startsWith('https://accept.paymob.com/')) {
        throw new Error('أعاد مزود الدفع رابطاً غير صالح.');
      }
      window.location.assign(payload.redirectUrl);
    } catch {
      setCheckoutPlan('');
      setStatus('تعذر بدء الدفع الآمن حالياً. تحقق من اتصال الحساب وحاول مجدداً.');
    }
  }

  async function startInstaPay() {
    setCheckoutPlan('telegram_lifetime:instapay');
    setStatus('');
    try {
      const response = await fetchApp('auth.php?action=telegram-instapay', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': account.csrfToken,
        },
        body: '{}',
      });
      const payload = await readResponse(response);
      if (typeof payload.redirectUrl !== 'string' || !payload.redirectUrl.startsWith('https://')) {
        throw new Error('رابط InstaPay الذي أعاده الخادم غير صالح.');
      }
      window.location.assign(payload.redirectUrl);
    } catch {
      setCheckoutPlan('');
      setStatus('تعذر فتح رابط InstaPay. تأكد من ضبطه على الخادم ثم حاول مجدداً.');
    }
  }

  async function submitReceipt(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const transactionId = new FormData(form).get('transactionId');
    const receiptFile = new FormData(form).get('receipt');
    if (typeof transactionId !== 'string' || transactionId.trim().length > 120) {
      setReceiptStatus('أدخل رقم عملية صحيحاً لا يتجاوز 120 حرفاً.');
      return;
    }
    const file = receiptFile instanceof File && receiptFile.size > 0 ? receiptFile : null;
    if (!transactionId.trim() && !file) {
      setReceiptStatus('أدخل رقم العملية أو أرفق صورة الإيصال.');
      return;
    }
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      || file.size > 2 * 1024 * 1024)) {
      setReceiptStatus('اختر صورة JPEG أو PNG أو WebP لا تتجاوز 2 ميغابايت.');
      return;
    }
    const data = new FormData();
    data.set('transactionId', transactionId.trim());
    if (file) data.set('receipt', file);
    setReceiptStatus('جارٍ إرسال الإيصال بأمان...');
    try {
      const response = await fetchApp('auth.php?action=telegram-receipt', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': account.csrfToken,
        },
        body: data,
      });
      const result = await readResponse(response);
      form.reset();
      setReceiptStatus(
        `استلمنا الطلب ${typeof result.receiptId === 'string' ? result.receiptId : ''} وهو قيد المراجعة. لن يُفعّل الاشتراك قبل تأكيد الدفع.`,
      );
    } catch {
      setReceiptStatus('تعذر إرسال الإيصال الآن. لم يتم تفعيل الاشتراك؛ حاول مرة أخرى لاحقاً.');
    }
  }

  const subscription = account.user?.subscription;
  const hasActiveVip = subscription?.status === 'active';
  const subscriptionExpiry = subscription?.expiresAt
    ? new Date(subscription.expiresAt).toLocaleDateString('ar-EG')
    : '';

  return (
    <div className="modal fade" id="account-modal" tabIndex="-1" aria-labelledby="account-modal-title" aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content account-modal-content">
          <div className="modal-header">
            <div>
              <p className="section-kicker mb-1">حسابك على أُنْس</p>
              <h2 id="account-modal-title" className="modal-title h5">الملف الشخصي</h2>
            </div>
            <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="إغلاق"></button>
          </div>
          <div className="modal-body">
            {account.loading ? (
              <p className="account-profile-status" role="status">جارٍ التحقق من حالة الحساب...</p>
            ) : account.user ? (
              <>
                <div className="account-user-profile" aria-label={account.user.isDemo ? 'ملف محلي تجريبي' : 'حساب Google متصل'}>
                  {account.user.picture ? (
                    <img className="account-user-avatar" src={account.user.picture} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="account-user-avatar" aria-hidden="true">{getAvatarInitial(account.user.name)}</span>
                  )}
                  <span>
                    <strong>{account.user.name}</strong>
                    <small>{account.user.isDemo ? 'ملف تجريبي محفوظ على هذا الجهاز' : account.user.email}</small>
                  </span>
                </div>
                {account.user.isDemo ? (
                  <>
                    <p className="account-local-notice" role="note">
                      هذا ملف محلي خاص بهذا الجهاز. سجّل الدخول بحساب Google لمزامنة ملفك والوصول إلى مزايا الحساب.
                    </p>
                    <ul className="account-feature-list" aria-label="مزايا تسجيل الدخول">
                      <li>حفظ ملفك ومزامنته عبر أجهزتك.</li>
                      <li>إدارة إعداداتك واشتراكك من حساب موثّق.</li>
                      <li>الوصول إلى مزايا Telegram عند تفعيلها.</li>
                    </ul>
                  </>
                ) : (
                  <>
                    <section className="telegram-plan-card" aria-labelledby="telegram-plan-title">
                      <h3 id="telegram-plan-title">اشتراك بوت أُنْس مدى الحياة</h3>
                      <p className="telegram-lifetime-price">
                        <del>٥٠٠ جنيه</del>
                        <strong>٢٥٠ جنيه مصري مدى الحياة</strong>
                      </p>
                      <ul className="telegram-plan-benefits">
                        <li>آيات وورد قرآني يومي.</li>
                        <li>تذكيرات مستمرة بأذكار الصباح والمساء.</li>
                        <li>تحديثات روحانية مخصصة من البوت.</li>
                      </ul>
                      {hasActiveVip && subscription?.plan === 'telegram_lifetime' ? (
                        <p className="account-local-notice" role="status">اشتراك Telegram مدى الحياة مفعّل لحسابك.</p>
                      ) : (
                        <>
                          {!account.user.telegramLinked ? (
                            <div className="telegram-link-controls">
                              <p>اربط حساب Telegram أولاً لتفعيل الخدمة على محادثتك بعد تأكيد الدفع.</p>
                              <button className="btn btn-success w-100" type="button" onClick={createTelegramLink}>
                                ربط حساب Telegram
                              </button>
                              {telegramStartUrl && (
                                <a className="btn btn-outline-success w-100" href={telegramStartUrl} target="_blank" rel="noopener noreferrer">
                                  فتح Telegram لإكمال الربط
                                </a>
                              )}
                              {telegramStartUrl && (
                                <button className="btn btn-outline-secondary w-100" type="button" onClick={refreshAccountStatus}>
                                  تحديث حالة الربط
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="telegram-checkout-controls">
                              <p className="account-local-notice" role="status">تم ربط Telegram. اختر وسيلة الدفع الآمنة لتفعيل الاشتراك بعد تأكيد Paymob.</p>
                              {plans.telegram_lifetime?.methods?.vodafone_cash
                                || plans.telegram_lifetime?.methods?.etisalat_cash
                                || plans.telegram_lifetime?.methods?.orange_cash ? (
                                  <label className="settings-control" htmlFor="telegram-wallet-phone">رقم المحفظة للدفع
                                    <input
                                      id="telegram-wallet-phone"
                                      className="form-control"
                                      type="tel"
                                      inputMode="tel"
                                      autoComplete="tel"
                                      maxLength={24}
                                      value={walletPhone}
                                      onChange={(event) => setWalletPhone(event.target.value)}
                                    />
                                  </label>
                                ) : null}
                              <div className="telegram-checkout-buttons">
                                {[
                                  ['card', 'الدفع بالبطاقة عبر Paymob'],
                                  ['vodafone_cash', 'Vodafone Cash'],
                                  ['etisalat_cash', 'Etisalat Cash'],
                                  ['orange_cash', 'Orange Cash'],
                                ].map(([method, label]) => {
                                  const available = plans.telegram_lifetime?.methods?.[method] === true;
                                  return (
                                    <button
                                      className="btn btn-outline-success"
                                      key={method}
                                      type="button"
                                      disabled={!available || checkoutPlan !== ''}
                                      onClick={() => startCheckout('telegram_lifetime', method)}
                                    >
                                      {checkoutPlan === `telegram_lifetime:${method}`
                                        ? 'جارٍ تجهيز الدفع...'
                                        : available ? label : `${label} — غير متاح`}
                                    </button>
                                  );
                                })}
                                <button
                                  className="btn btn-outline-success"
                                  type="button"
                                  disabled={checkoutPlan !== ''}
                                  onClick={startInstaPay}
                                >
                                  InstaPay — ادفع ثم أرسل الإيصال
                                </button>
                              </div>
                              <button className="btn btn-link" type="button" onClick={refreshAccountStatus}>
                                تحقّق من تفعيل الاشتراك
                              </button>
                              <form className="telegram-receipt-form" onSubmit={submitReceipt}>
                                <h4>تم الدفع عبر InstaPay؟ تأكيد العملية</h4>
                                <label className="settings-control" htmlFor="telegram-transaction-id">رقم العملية (اختياري عند إرفاق صورة)
                                  <input id="telegram-transaction-id" className="form-control" name="transactionId" type="text" maxLength={120} autoComplete="off" />
                                </label>
                                <label className="settings-control" htmlFor="telegram-receipt-image">صورة الإيصال (اختيارية)
                                  <input id="telegram-receipt-image" className="form-control" name="receipt" type="file" accept="image/jpeg,image/png,image/webp" />
                                  <small>JPEG أو PNG أو WebP، حتى 2 ميغابايت. تُخزّن الصورة في مساحة خاصة للمراجعة.</small>
                                </label>
                                <button className="btn btn-outline-secondary w-100" type="submit">إرسال للتحقق الآمن</button>
                                <p className="settings-note" role="status" aria-live="polite">{receiptStatus}</p>
                              </form>
                            </div>
                          )}
                        </>
                      )}
                      {TELEGRAM_BOT_CONFIGURED ? (
                        <div className="telegram-plan-actions">
                          <a className="btn btn-success" href={TELEGRAM_START_URL} target="_blank" rel="noopener noreferrer">
                            ابدأ مع بوت تليجرام
                          </a>
                          <a className="telegram-subscribe-link" href={TELEGRAM_SUBSCRIBE_URL} target="_blank" rel="noopener noreferrer">
                            فتح الاشتراك في Telegram
                          </a>
                        </div>
                      ) : (
                        <p className="telegram-plan-setup" role="status">
                          لم يُضبط اسم البوت العام بعد؛ أضف VITE_TELEGRAM_BOT_USERNAME إلى إعدادات الواجهة.
                        </p>
                      )}
                      <p className="settings-note" role="status" aria-live="polite">{status}</p>
                    </section>
                    <section className="telegram-plan-card" aria-labelledby="other-vip-title">
                      <h3 id="other-vip-title">خطط VIP للحساب</h3>
                      {hasActiveVip && subscription?.plan !== 'telegram_lifetime' ? (
                        <p>اشتراك VIP نشط{subscriptionExpiry ? ` حتى ${subscriptionExpiry}` : ''}.</p>
                      ) : <p>الخطط الزمنية الاختيارية لحساب أُنْس.</p>}
                      <div className="vip-plan-options" aria-label="خطط اشتراك VIP">
                        {['monthly', 'annual'].map((planId) => {
                          const plan = plans[planId];
                          const available = plan?.available === true;
                          return (
                            <button
                              className="vip-plan-option"
                              key={planId}
                              type="button"
                              disabled={!available || checkoutPlan !== ''}
                              onClick={() => startCheckout(planId)}
                            >
                              <strong>{plan?.label || (planId === 'monthly' ? 'شهري - 30 يوماً' : 'سنوي - 365 يوماً')}</strong>
                              <span>
                                {checkoutPlan === `${planId}:card`
                                  ? 'جارٍ تجهيز الدفع...'
                                  : available && Number.isInteger(plan.amount)
                                    ? `${new Intl.NumberFormat('ar-EG').format(plan.amount)} ${plan.currency}`
                                    : 'غير متاح حالياً'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </>
                )}
                <form className="account-profile-form" onSubmit={submitProfile}>
                  <label className="settings-control" htmlFor="profile-name">الاسم الظاهر
                    <input
                      id="profile-name"
                      className="form-control"
                      type="text"
                      autoComplete="name"
                      maxLength={MAX_NAME_LENGTH}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        setStatus('');
                        setSaved(false);
                      }}
                    />
                  </label>
                  {account.mode === 'local' && (
                    <>
                      <label className="settings-control" htmlFor="profile-avatar">رابط الصورة الشخصية (اختياري)
                      <input
                        id="profile-avatar"
                        className="form-control"
                        type="text"
                        inputMode="url"
                        autoComplete="url"
                        maxLength={MAX_AVATAR_DATA_URL_LENGTH}
                        placeholder="https://example.com/photo.jpg"
                        value={avatarUrl}
                        onChange={(event) => {
                          setAvatarUrl(event.target.value);
                          setStatus('');
                          setSaved(false);
                        }}
                      />
                    </label>
                      <label className="settings-control" htmlFor="profile-avatar-upload">أو ارفع صورة شخصية
                        <input
                          id="profile-avatar-upload"
                          className="form-control"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleAvatarUpload}
                        />
                        <small>PNG أو JPEG أو WebP، حتى 5 ميغابايت؛ تُضغط الصورة وتُحفظ محلياً.</small>
                      </label>
                    </>
                  )}
                  <button className="btn btn-success w-100" type="submit">حفظ التغييرات</button>
                  <button className="btn btn-outline-secondary w-100" type="button" onClick={signOut}>
                    {account.mode === 'local' ? 'إنهاء الملف التجريبي' : 'تسجيل الخروج'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <section className="account-login-hero">
                  <span className="account-login-symbol" aria-hidden="true">ز</span>
                  <p className="section-kicker">مساحة قرآنية خاصة بك</p>
                  <h3>{account.mode === 'local' ? 'ابدأ بملف زائر' : 'مرحباً بك في أُنْس'}</h3>
                  <p className="account-modal-note">
                    {account.mode === 'local'
                      ? 'احفظ اسماً وصورة على هذا الجهاز، أو استخدم Google عند توفر تسجيل الدخول الآمن.'
                      : 'سجّل الدخول بحساب Google موثّق لحفظ ملفك ومزامنة مزايا الحساب.'}
                  </p>
                </section>
                <ul className="account-feature-list account-login-features">
                  <li>احتفظ بملف شخصي يرحب بك في كل زيارة.</li>
                  <li>تابع علاماتك وإعدادات قراءتك بسهولة.</li>
                  <li>اكتشف مزايا التذكيرات عند تفعيلها.</li>
                </ul>
                {account.mode === 'local' ? (
                  <form className="account-guest-form" onSubmit={createLocalProfile}>
                    <label className="settings-control" htmlFor="profile-name">الاسم الظاهر
                      <input
                        id="profile-name"
                        className="form-control"
                        type="text"
                        autoComplete="name"
                        maxLength={MAX_NAME_LENGTH}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label className="settings-control" htmlFor="profile-avatar-upload">الصورة الشخصية (اختياري)
                      <input
                        id="profile-avatar-upload"
                        className="form-control"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleAvatarUpload}
                      />
                      <small>PNG أو JPEG أو WebP، حتى 5 ميغابايت.</small>
                    </label>
                    {avatarUrl && <img className="account-avatar-preview" src={avatarUrl} alt="معاينة الصورة الشخصية" />}
                    <button className="btn btn-success w-100" type="submit">إنشاء ملف زائر</button>
                  </form>
                ) : (
                  <button
                    className="google-signin-button"
                    type="button"
                    disabled={account.loading}
                    onClick={() => window.location.assign(appUrl('auth.php?action=google'))}
                  >
                    <span className="google-signin-mark" aria-hidden="true">G</span>
                    <span>{account.loading ? 'جارٍ التحقق...' : 'تسجيل الدخول باستخدام Google'}</span>
                  </button>
                )}
              </>
            )}
            <p className={`account-profile-status${saved ? ' is-success' : ''}`} role="status" aria-live="polite">
              {status}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
