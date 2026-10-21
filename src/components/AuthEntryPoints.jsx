import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import AuthModal from './AuthModal.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

function UserAvatar({ user, className = '' }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = Array.from(user?.displayName?.trim() || 'أ')[0];
  if (user?.photoURL && !imageFailed) {
    return <img className={`auth-user-avatar ${className}`} src={user.photoURL} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />;
  }
  return <span className={`auth-user-avatar auth-user-avatar-fallback ${className}`} aria-hidden="true">{initial}</span>;
}

function AuthTrigger({ location }) {
  const { user, authLoading, openAuthModal } = useAuth();
  const isHeader = location === 'header';
  return (
    <button
      type="button"
      className={isHeader ? 'auth-header-button' : 'sidebar-nav-link auth-sidebar-button'}
      onClick={openAuthModal}
      disabled={authLoading}
      aria-label={user ? `حساب ${user.displayName || 'المستخدم'}` : 'تسجيل الدخول / حساب المستخدم'}
    >
      {user ? <UserAvatar user={user} /> : (
        <svg className="auth-entry-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.7" />
          <path d="M5.5 20c.5-3.55 2.75-5.4 6.5-5.4s6 1.85 6.5 5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )}
      <span className="auth-entry-label">
        {authLoading ? 'جارٍ التحقق…' : user ? (user.displayName || 'حسابي') : isHeader ? 'تسجيل الدخول' : 'تسجيل الدخول / حساب المستخدم'}
      </span>
    </button>
  );
}

/* === Start Section: نقاط دخول الحساب في الترويسة والقائمة الجانبية === */
export default function AuthEntryPoints() {
  const [slots, setSlots] = useState({ header: null, sidebar: null });

  useEffect(() => {
    setSlots({
      header: document.querySelector('#auth-header-slot'),
      sidebar: document.querySelector('#auth-sidebar-slot'),
    });
  }, []);

  return (
    <>
      {slots.header && createPortal(<AuthTrigger location="header" />, slots.header)}
      {slots.sidebar && createPortal(<AuthTrigger location="sidebar" />, slots.sidebar)}
      <AuthModal />
    </>
  );
}
/* === End Section: نقاط دخول الحساب في الترويسة والقائمة الجانبية === */
