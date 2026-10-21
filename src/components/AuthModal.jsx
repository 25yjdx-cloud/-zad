import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

function GoogleMark() {
  return (
    <svg className="auth-google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.71 7.18l7.6 5.9c4.43-4.09 6.98-10.12 6.98-17.55Z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.55 2.56 10.78l7.97-6.19Z" transform="translate(1 0)" />
      <path fill="#34A853" d="M24 48c6.47 0 11.91-2.13 15.88-5.8l-7.6-5.9c-2.11 1.42-4.82 2.27-8.28 2.27-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -4)" />
    </svg>
  );
}

/* === Start Section: نافذة تسجيل الدخول وإنشاء الحساب === */
export default function AuthModal() {
  const {
    user, authBusy, authError, authNotice, authModalOpen, syncState,
    closeAuthModal, loginWithGoogle, loginWithEmail, createAccount, logout,
  } = useAuth();
  const [mode, setMode] = useState('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const isSignUp = mode === 'signup';

  useEffect(() => {
    if (!authModalOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !authBusy) closeAuthModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authModalOpen, authBusy, closeAuthModal]);

  useEffect(() => {
    setFormError('');
    setPassword('');
    setFullName('');
  }, [mode]);

  if (!authModalOpen) return null;

  const syncLabel = {
    syncing: 'جارٍ مزامنة بياناتك…',
    synced: '✓ تمت مزامنة بياناتك بنجاح',
    offline: 'بياناتك محفوظة على هذا الجهاز، وستُزامن عند عودة الاتصال.',
    error: 'تعذرت المزامنة الآن؛ بياناتك المحلية محفوظة وستُعاد المحاولة عند عودة الاتصال.',
  }[syncState] || 'ستُحفظ بياناتك محليًا حتى تسجيل الدخول';

  async function submitCredentials(event) {
    event.preventDefault();
    setFormError('');
    if (isSignUp && !fullName.trim()) {
      setFormError('يرجى كتابة الاسم الكامل.');
      return;
    }
    if (isSignUp && password.length < 6) {
      setFormError('استخدم كلمة مرور من ٦ أحرف على الأقل.');
      return;
    }
    try {
      if (isSignUp) await createAccount(email, password, fullName);
      else await loginWithEmail(email, password);
    } catch {
      // === Start Section: يعرض AuthContext رسالة عربية مفهومة ===
      // لا نعرض تفاصيل Firebase الداخلية للمستخدم.
      // === End Section: يعرض AuthContext رسالة عربية مفهومة ===
    }
  }

  return (
    <div className="auth-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !authBusy) closeAuthModal();
    }}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" dir="rtl">
        <button type="button" className="auth-modal-close" onClick={closeAuthModal} disabled={authBusy} aria-label="إغلاق">×</button>
        <div className="auth-modal-brand-mark" aria-hidden="true">أ</div>
        <p className="section-kicker">أُنْس · مساحة آمنة لتقدمك</p>
        <h2 id="auth-modal-title">{user ? 'حسابك ومزامنة بياناتك' : 'مرحبًا بك في أُنْس'}</h2>
        {user ? (
          <div className="auth-account-details">
            {user.photoURL
              ? <img className="auth-account-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
              : <span className="auth-account-avatar auth-account-avatar-fallback" aria-hidden="true">{Array.from(user.displayName?.trim() || 'أ')[0]}</span>}
            <strong>{user.displayName || 'مستخدم أُنْس'}</strong>
            {user.email && <span>{user.email}</span>}
            {authNotice && <p className="auth-success" role="status">{authNotice}</p>}
            <p className={`auth-sync-status is-${syncState}`}>{syncLabel}</p>
            {authError && <p className="auth-error" role="alert">{authError}</p>}
            <button type="button" className="auth-signout-button" onClick={() => { void logout().catch(() => {}); }} disabled={authBusy}>
              {authBusy ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}
            </button>
          </div>
        ) : (
          <>
            <p className="auth-modal-description">سجّل الدخول لحفظ تقدمك ومزامنة بياناتك بين أجهزتك.</p>
            <div className="auth-mode-switch" role="tablist" aria-label="نوع الحساب">
              <button type="button" role="tab" aria-selected={!isSignUp} className={!isSignUp ? 'is-active' : ''} onClick={() => setMode('signin')}>تسجيل الدخول</button>
              <button type="button" role="tab" aria-selected={isSignUp} className={isSignUp ? 'is-active' : ''} onClick={() => setMode('signup')}>إنشاء حساب جديد</button>
            </div>
            <form className="auth-email-form" onSubmit={submitCredentials}>
              {isSignUp && (
                <>
                  <label htmlFor="auth-full-name">الاسم الكامل</label>
                  <input id="auth-full-name" type="text" autoComplete="name" placeholder="الاسم الأول والأخير" value={fullName} onChange={(event) => setFullName(event.target.value)} required disabled={authBusy} />
                </>
              )}
              <label htmlFor="auth-email">البريد الإلكتروني</label>
              <input id="auth-email" type="email" autoComplete="email" inputMode="email" dir="ltr" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={authBusy} />
              <label htmlFor="auth-password">كلمة المرور</label>
              <input id="auth-password" type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} dir="ltr" placeholder="٦ أحرف على الأقل" minLength={isSignUp ? 6 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={authBusy} />
              {authNotice && <p className="auth-success" role="status">{authNotice}</p>}
              {(formError || authError) && <p className="auth-error" role="alert">{formError || authError}</p>}
              <button type="submit" className="auth-email-submit" disabled={authBusy}>
                {authBusy ? 'جارٍ التحقق…' : isSignUp ? 'إنشاء حساب' : 'تسجيل الدخول'}
              </button>
            </form>
            <div className="auth-divider"><span>أو</span></div>
            <button type="button" className="auth-google-button" onClick={() => { void loginWithGoogle().catch(() => {}); }} disabled={authBusy}>
              <GoogleMark />
              <span>{authBusy ? 'جارٍ الاتصال بجوجل…' : 'التسجيل بواسطة جوجل'}</span>
            </button>
            <small className="auth-privacy-note">تبقى بياناتك على هذا الجهاز عند استخدام التطبيق دون تسجيل الدخول.</small>
          </>
        )}
      </section>
    </div>
  );
}
/* === End Section: نافذة تسجيل الدخول وإنشاء الحساب === */
