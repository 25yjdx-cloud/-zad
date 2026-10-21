import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase.js';
import { startFirestoreSync } from '../services/firebaseSync.js';
import { startReaderStateMirror } from '../services/ayahBookmarks.js';
import { startNotificationSettingsSync } from '../services/pushNotifications.js';

const AuthContext = createContext(null);

/* === Start Section: رسائل المصادقة العربية === */
function getAuthErrorMessage(error, method = 'email') {
  const code = error?.code;
  const domain = typeof window !== 'undefined' ? window.location.hostname : 'نطاق التطبيق';
  const messages = {
    'auth/invalid-email': 'يرجى إدخال بريد إلكتروني صحيح.',
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/wrong-password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/user-not-found': 'لا يوجد حساب بهذا البريد. يمكنك إنشاء حساب جديد.',
    'auth/email-already-in-use': 'هذا البريد مسجل بالفعل. اختر تسجيل الدخول بدلًا من إنشاء حساب.',
    'auth/weak-password': 'كلمة المرور قصيرة؛ استخدم ٦ أحرف على الأقل.',
    'auth/too-many-requests': 'توقفت المحاولات مؤقتًا لأمان حسابك. حاول مجددًا بعد قليل.',
    'auth/network-request-failed': 'تعذر الاتصال. تحقق من الإنترنت ثم حاول مجددًا.',
    'auth/popup-closed-by-user': 'أُغلقت نافذة Google قبل اكتمال تسجيل الدخول.',
    'auth/popup-blocked': 'يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم المحاولة مجددًا.',
    'auth/unauthorized-domain': `هذا النطاق (${domain}) غير معتمد لدى Firebase. أضفه من Firebase Console ← Authentication ← Settings ← Authorized domains.`,
    'auth/operation-not-allowed': method === 'google'
      ? 'تسجيل الدخول بواسطة Google غير مفعّل بعد. فعّل مزود Google من إعدادات Authentication في Firebase.'
      : 'تسجيل الدخول بالبريد غير مفعّل بعد. فعّل Email/Password من Authentication ← Sign-in method في Firebase.',
    'app/profile-update-failed': 'تم إنشاء الحساب، لكن تعذر حفظ الاسم في الملف الشخصي. سجّل الدخول مجددًا وحاول تحديث بيانات الحساب.',
  };
  return messages[code] || 'تعذر إكمال العملية الآن. تحقق من بياناتك واتصالك ثم حاول مجددًا.';
}
/* === End Section: رسائل المصادقة العربية === */

/* === Start Section: حالة المصادقة ومزامنة الحساب === */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [syncState, setSyncState] = useState('idle');

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setAuthLoading(false);
    setAuthError('');
  }, () => {
    setAuthError('تعذر التحقق من حالة تسجيل الدخول. تحقق من اتصالك بالإنترنت.');
    setAuthLoading(false);
  }), []);

  useEffect(() => {
    const authenticatedUser = auth.currentUser;
    const uid = authenticatedUser?.uid;
    if (!uid || uid !== user?.uid) {
      setSyncState('idle');
      return undefined;
    }
    let stopReaderStateMirror = () => {};
    let stopFirestoreSync = () => {};
    let stopNotificationSettingsSync = () => {};
    try {
      stopReaderStateMirror = startReaderStateMirror();
      stopFirestoreSync = startFirestoreSync(authenticatedUser, ({ state }) => setSyncState(state));
      stopNotificationSettingsSync = startNotificationSettingsSync(uid);
    } catch {
      setSyncState('offline');
    }
    return () => { stopReaderStateMirror(); stopFirestoreSync(); stopNotificationSettingsSync(); };
  }, [user?.uid]);

  async function runAuthAction(action, method, { keepOpen = false, successMessage = '' } = {}) {
    setAuthBusy(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const credential = await action();
      if (credential?.user) setUser(credential.user);
      if (successMessage) setAuthNotice(successMessage);
      if (!keepOpen) setAuthModalOpen(false);
      return credential;
    } catch (error) {
      setAuthError(getAuthErrorMessage(error, method));
      throw error;
    } finally {
      setAuthBusy(false);
    }
  }

  function loginWithGoogle() {
    return runAuthAction(() => signInWithPopup(auth, googleProvider), 'google');
  }

  function loginWithEmail(email, password) {
    return runAuthAction(() => signInWithEmailAndPassword(auth, email.trim(), password), 'email');
  }

  function createAccount(email, password, displayName) {
    const cleanName = displayName.trim().replace(/\s+/g, ' ');
    return runAuthAction(async () => {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      try {
        await updateProfile(credential.user, { displayName: cleanName });
      } catch {
        const error = new Error('تعذر تحديث الاسم في الملف الشخصي.');
        error.code = 'app/profile-update-failed';
        throw error;
      }
      return credential;
    }, 'email', { keepOpen: true, successMessage: 'تم إنشاء حسابك وحفظ اسمك بنجاح.' });
  }

  async function logout() {
    setAuthBusy(true);
    setAuthError('');
    try {
      await signOut(auth);
    } catch {
      setAuthError('تعذر تسجيل الخروج. أعد المحاولة.');
      throw new Error('تعذر تسجيل الخروج.');
    } finally {
      setAuthBusy(false);
    }
  }

  const value = useMemo(() => ({
    user,
    authLoading,
    authBusy,
    authError,
    authNotice,
    authModalOpen,
    syncState,
    openAuthModal: () => { setAuthError(''); setAuthNotice(''); setAuthModalOpen(true); },
    closeAuthModal: () => setAuthModalOpen(false),
    loginWithGoogle,
    loginWithEmail,
    createAccount,
    logout,
  }), [user, authLoading, authBusy, authError, authNotice, authModalOpen, syncState]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
/* === End Section: حالة المصادقة ومزامنة الحساب === */

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
