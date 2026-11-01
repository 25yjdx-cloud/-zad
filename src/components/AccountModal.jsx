import { useEffect, useState } from 'react';
import { appUrl, fetchApp } from '../services/appUrl.js';
import { parseStoredJson } from '../services/storage.js';
import { useAuth } from '../contexts/AuthContext.jsx';

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

export default function AccountModal() {
  const { user: firebaseUser, authLoading, authBusy, authError, loginWithGoogle, logout } = useAuth();
  const [account, setAccount] = useState({
    available: false,
    user: null,
    csrfToken: '',
  });
  const [status, setStatus] = useState('');
  const [checkoutPlan, setCheckoutPlan] = useState('');
  const [plans, setPlans] = useState({});
  const [telegramStartUrl, setTelegramStartUrl] = useState('');
  const [walletPhone, setWalletPhone] = useState('');
  const [receiptStatus, setReceiptStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    function disableAccountServices() {
      setAccount({
        available: false,
        user: null,
        csrfToken: '',
      });
      signalProfileHydrated();
    }

    async function loadAccount() {
      if (import.meta.env.DEV || __GITHUB_PAGES__) {
        disableAccountServices();
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
          user: payload.user || null,
          csrfToken: payload.csrfToken || '',
        });
        setPlans(payload.plans || {});
        if (payload.user?.subscription?.status === 'active'
          && payload.user.subscription.plan === 'telegram_lifetime') {
          signalTelegramActivated();
        }
        signalProfileHydrated();
      } catch (error) {
        if (error.name === 'AbortError') return;
        disableAccountServices();
      }
    }

    loadAccount();
    return () => controller.abort();
  }, []);

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

  const serviceUser = firebaseUser?.email
    && typeof account.user?.email === 'string'
    && account.available
    && account.user.email.toLowerCase() === firebaseUser.email.toLowerCase()
    ? account.user
    : null;
  const subscription = serviceUser?.subscription;
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
            {authLoading ? (
              <p className="account-profile-status" role="status">جارٍ التحقق من حالة تسجيل الدخول...</p>
            ) : firebaseUser ? (
              <>
                <div className="account-user-profile" aria-label="حساب Firebase متصل">
                  {firebaseUser.photoURL ? (
                    <img className="account-user-avatar" src={firebaseUser.photoURL} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="account-user-avatar" aria-hidden="true">
                      {getAvatarInitial(firebaseUser.displayName || firebaseUser.email || '')}
                    </span>
                  )}
                  <span>
                    <strong>{firebaseUser.displayName || 'مستخدم أُنْس'}</strong>
                    {firebaseUser.email && <small>{firebaseUser.email}</small>}
                  </span>
                </div>
                {serviceUser ? (
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
                          {!serviceUser.telegramLinked ? (
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
                ) : (
                  <p className="account-modal-note" role="note">
                    بيانات الملف من حساب Firebase. خدمات الاشتراك غير متاحة لهذا الحساب حالياً.
                  </p>
                )}
                <button
                  className="btn btn-outline-secondary w-100"
                  type="button"
                  disabled={authBusy}
                  onClick={() => { void logout().catch(() => {}); }}
                >
                  {authBusy ? 'جارٍ تسجيل الخروج...' : 'تسجيل الخروج'}
                </button>
              </>
            ) : (
              <>
                <section className="account-login-hero">
                  <span className="account-login-symbol" aria-hidden="true">أ</span>
                  <p className="section-kicker">مساحة قرآنية خاصة بك</p>
                  <h3>مرحباً بك في أُنْس</h3>
                  <p className="account-modal-note">سجّل الدخول بحساب Google لعرض ملفك الحقيقي ومزامنة بياناتك.</p>
                </section>
                <ul className="account-feature-list account-login-features">
                  <li>عرض اسمك وبريدك وصورتك من حساب Google.</li>
                  <li>مزامنة بيانات القراءة بين أجهزتك.</li>
                  <li>إدارة إعدادات الحساب من مكان واحد.</li>
                </ul>
                <button
                  className="google-signin-button"
                  type="button"
                  disabled={authBusy}
                  onClick={() => { void loginWithGoogle().catch(() => {}); }}
                >
                  <span className="google-signin-mark" aria-hidden="true">G</span>
                  <span>{authBusy ? 'جارٍ الاتصال بجوجل...' : 'تسجيل الدخول باستخدام Google'}</span>
                </button>
                {authError && <p className="auth-error" role="alert">{authError}</p>}
              </>
            )}
            <p className="account-profile-status" role="status" aria-live="polite">
              {status}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
