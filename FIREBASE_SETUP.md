# إعداد Firebase لتطبيق أُنْس

## تفعيل تسجيل الدخول

1. افتح مشروع `uns-app-2026` في Firebase Console.
2. من **Authentication → Sign-in method** فعّل مزود **Google** واختر بريد الدعم.
3. من **Authentication → Settings → Authorized domains** أضف نطاق الموقع، وأبقِ `localhost` للتطوير المحلي.

## تفعيل مزامنة البيانات

1. أنشئ قاعدة بيانات **Cloud Firestore** في المشروع.
2. انشر القواعد المحددة في `firestore.rules` باستخدام Firebase CLI:

   ```sh
   firebase deploy --only firestore:rules --project uns-app-2026
   ```

Self-accountability data syncs to `users/{uid}/worship/accountability`, and worship habits sync to `users/{uid}/worship/tracking`. Deploy these rules before expecting cloud sync for either section; both continue to save locally while offline.

يخزن التطبيق مفاتيح بيانات `zad.*` في مستندات منفصلة تحت `users/{uid}/appData/`، ولا يسمح ملف القواعد بقراءة بيانات الحساب أو تعديلها إلا لصاحب `uid` المسجل. تُستخدم بيانات المتصفح كنسخة محلية عند انقطاع الشبكة، وتبقى تغييراتها معلّقة حتى عودة الاتصال.

ملف `src/firebase.js` يحتوي إعدادات الويب التي زود بها مالك المشروع. لا تضع مفاتيح حسابات الخدمة أو أسرار الخادم في تطبيق المتصفح.
