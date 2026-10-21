# أُنْس المسلم

تطبيق عربي RTL مبني باستخدام React وVite، للقرآن الكريم والأذكار والمسبحة والأدعية. المكونات الجديدة موجودة في `src/components/`، والخدمات في `src/services/`، والأيقونات المصدرية في `src/assets/icons/`. نُبقي مؤقتاً وحدة التفاعل القديمة في `src/legacy/app.js` كطبقة توافق تُحمّل بعد تركيب مكونات React، حفاظاً على وظائف التطبيق بينما يجري تحويل منطق التفاعل تدريجياً إلى hooks ومكونات React أصلية.

## استخراج البيانات والتشغيل محلياً

1. شغّل `php converter.php` عند الحاجة إلى إعادة استخراج `data.json` من ملفات PHP.
2. شغّل `npm run dev` وافتح عنوان Vite الظاهر في الطرفية (المنفذ `5173`).

خادم Vite مخصص لتطوير واجهة التطبيق ولا ينفّذ ملفات PHP. تتطلب نقاط API وتسجيل الدخول والدفع استضافة تدعم PHP؛ لا تشغّل خادم PHP المحلي على منفذ Vite.

## بناء نسخة الإنتاج

يتطلب البناء Node.js وnpm:

```sh
npm install
npm run build
```

ينشئ الأمر أيقونات PNG بقياسي 192×192 و512×512 من شعار `src/assets/uns-logo.svg`، ثم ينشئ Vite مجلد `dist/`، ويجمع JavaScript الخاص بالتطبيق ويصغّره ويلتمس تشويش أسماء المعرفات والسلاسل النصية، من دون إنشاء source maps. انسخ محتويات `dist/` إلى استضافة الإنتاج. يتضمن الناتج ملفات PHP وبيانات JSON دون قاعدة ملاحظات المستخدم القابلة للكتابة؛ لذا يلزم خادم يدعم PHP مع `FEEDBACK_STORAGE_DIR` خارج جذر الويب لواجهات الملاحظات والدفع. لا ترفع مجلد `dist/` إلى Git، فهو ناتج بناء قابل لإعادة الإنشاء.

### النشر على GitHub Pages

ينشر سير العمل في `.github/workflows/deploy-pages.yml` ناتج Vite من `dist/` تلقائياً عند الدفع إلى `main` أو يدوياً من تبويب Actions. فعّل GitHub Pages من إعدادات المستودع مع مصدر النشر **GitHub Actions**؛ لا تنشر جذر المستودع أو مجلد `src/` لأن ذلك يقدّم JSX الخام إلى المتصفح. للتحقق والنشر من PowerShell:

```powershell
npm ci
npm run build:pages
git status --short
git add README.md vite.config.js
git commit -m "Fix GitHub Pages production assets"
git push origin HEAD:main
```

بعد نجاح الدفع، انتظر اكتمال سير العمل `Deploy static UI to GitHub Pages` في تبويب Actions. بناء Pages يجمع JavaScript عبر Vite، ويضمّن المسارات النسبية للملفات، وينسخ manifest وأيقونات `public/assets/icons/` إلى `dist/`، ويستبعد ملفات PHP حتى لا ينشر مصدر الخادم. وبما أن Pages لا يشغّل PHP، فإن تسجيل الدخول والملاحظات والدفع وأي طلب يعتمد على واجهة PHP لن يتوفر هناك. استخدم استضافة تدعم PHP إذا كانت هذه الميزات مطلوبة.

التصغير والتشويش يرفعان كلفة القراءة السريعة فقط، ولا يحميان الأسرار أو يمنعان الهندسة العكسية. لا تضع مفاتيح API أو رموزاً سرية أو بيانات اعتماد في JavaScript أو التخزين المحلي. لا يعطّل التطبيق قائمة النقر الأيمن أو اختصارات أدوات المطور، لأن ذلك لا يوفّر حماية فعلية ويضر بإمكانية الوصول. تبقى محددات المعدل على الخادم هي الحماية الفعلية؛ ويضيف المتصفح تأخيراً قصيراً لطلبات البحث ومهلة بين إرسال النماذج لتقليل الطلبات المكررة.

### تسجيل Google الحقيقي وملف الحساب

يوفر `auth.php` تدفق OAuth 2.0/OIDC من الخادم، مع `state` و`nonce` وPKCE والتحقق من رمز الهوية عبر Google، وجلسة `HttpOnly` و`SameSite=Lax`. تُسترجع بيانات الاسم والبريد والصورة من Google وتُحفظ سجلات الحساب وحقول VIP في ملف JSON خاص مع قفل كتابة؛ لا تُحفظ رموز Google في المتصفح. يتطلب PHP امتداد cURL واتصال HTTPS بخدمات Google.

قبل التفعيل، أنشئ OAuth Client من نوع Web في Google Cloud وأضف عنوان إعادة التوجيه المطابق تماماً، ثم عيّن المتغيرات التالية في بيئة PHP/الخادم (لا تضع الأسرار في متغيرات `VITE_` أو في مستودع Git):

```text
APP_ORIGIN=https://your-domain.example
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-domain.example/auth.php?action=callback
AUTH_DATA_DIR=/var/lib/zad/auth
```

يجب أن يكون `AUTH_DATA_DIR` مساراً مطلقاً قابلاً للكتابة وخارج جذر الويب؛ يرفض endpoint تخزين بيانات الحساب داخله. عيّن نطاق النشر نفسه في إعدادات OAuth و`APP_ORIGIN`. لا يعمل تسجيل Google قبل ضبط هذه الإعدادات على الخادم.

يوفر `auth.php?action=vip-checkout` خطتي VIP المدفوعتين مسبقاً (30 و365 يوماً) بالبطاقة، وعرض Telegram مدى الحياة بسعر ثابت 250 جنيهاً مصرياً بالبطاقة أو بمحافظ Paymob المُهيأة. يتطلب عرض Telegram تسجيل دخول Google وربط محادثة Telegram برمز عشوائي أحادي الاستخدام صالح لعشر دقائق. يربط Webhook الموقّع في `paymob-webhook.php` الطلب بحساب Google ومعرّف المحادثة والخطة وطريقة الدفع والمبلغ، ثم يفعّل العضوية بعد نجاح المعاملة والتحقق من HMAC والعملة والتكامل والمبلغ؛ الرجوع من صفحة الدفع وحده لا يمنح VIP. يستعلم البوت عن حالة الاشتراك من الخادم بمفتاح خدمة منفصل، ويحدّث الجلسات المرتبطة كل دقيقة تقريباً.

اضبط مفاتيح Paymob ومعرّفات تكامل البطاقة والمحافظ و`PAYMOB_IFRAME_ID` و`PAYMOB_HMAC_SECRET` في بيئة PHP. اضبط أيضاً `TELEGRAM_BOT_USERNAME` و`TELEGRAM_AUTH_API_URL=https://<api-host>/auth.php` و`TELEGRAM_BOT_API_SECRET`؛ يجب أن يكون السر العشوائي نفسه (32 حرفاً عشوائياً على الأقل) في بيئة PHP والبوت. لا تضعه في متغير `VITE_`. فعّل callback الموقّع في لوحة Paymob على `https://<api-host>/paymob-webhook.php`. تُجدّد الخطط الزمنية يدوياً؛ لا ينشئ هذا التكامل خصماً دورياً.

InstaPay ليس لديه Webhook موثّق في هذا المشروع: الزر يفتح رابط التحصيل الرسمي فقط، ثم يرسل المستخدم رقم العملية أو صورة إيصال. تُحفظ الإيصالات خارج جذر الويب بحالة `pending_review`، ولا يُمنح الاشتراك حتى يراجعها مسؤول عبر واجهات `auth.php?action=telegram-receipts` و`telegram-receipt-image` ثم يوافق عبر `telegram-receipt-review`. تتطلب هذه الواجهات `TELEGRAM_RECEIPT_REVIEW_SECRET` مستقلاً (Bearer، 32 حرفاً عشوائياً على الأقل). استرجع قائمة الإيصالات بـ GET، وصورة الإيصال عند الحاجة بـ GET مع `receipt_id`، ثم اعتمد أو ارفض JSON مثل `{"receiptId":"<id>","approved":true}` عبر POST. لا تعتمد على مرجع يكتبه المستخدم وحده بوصفه إثبات دفع.

تظل بيانات الاشتراك مخزنة في ملف حساب Google الخاص؛ البوت يقرأ الحالة عبر API الخادم، ولا يخزن مفاتيح Google أو بيانات الدفع. GitHub Pages لا يشغّل PHP: للحصول على Google OAuth وPaymob وInstaPay وربط Telegram، وجّه الواجهة إلى استضافة PHP HTTPS متوافقة مع مسارات API الحالية. لا تستخدم زر فتح البوت كدليل على وجود اشتراك.

### أيقونة PWA

يستخدم التطبيق الأيقونة الثابتة `assets/icons/icon-192x192.png` في الواجهة وملف manifest. ينشئ `npm run icons:generate` نسخة 192×192 من شعار `src/assets/uns-logo.svg`، ولا توجد أيقونات أو ملفات manifest موسمية.

## بوت Telegram المعزول

يوجد البوت مستقلاً عن الواجهة في `telegram-bot/bot.py`، ولا يُحمّل من `index.html` أو `app.js`. من مجلد البوت ثبّت `pip install -r requirements.txt`، واضبط `TELEGRAM_BOT_TOKEN` و`TELEGRAM_AUTH_API_URL` و`TELEGRAM_BOT_API_SECRET` قبل التشغيل. يجب أن يطابق سر API قيمة الخادم، وأن يكون عنوان API هو ملف `auth.php` العام عبر HTTPS. يدعم البوت رمز `/start link_<token>` الناتج من صفحة الحساب، ويتحقق من اشتراك مدى الحياة ومن المحافظ المؤكدة عبر API؛ لا تعتمد صلاحية البوت على رابط دفع أو إدخال العميل.

يدعم البوت `/remind 25m quran` أو `/remind 30m evening` للتذكير الدوري (الفاصل المسموح 25–30 دقيقة)، و`/remind 07:00 morning` (أو `quran` / `evening`) لضبط تذكير يومي. ألغِ تذكيراً باستخدام `/remind off morning`، واعرض الحالة والاشتراك عبر `/vip` أو `/subscribe`. يدعم `/dua` و`/progress 13 20` أيضاً. أضف اسم المستخدم العام للبوت إلى `.env` باسم `VITE_TELEGRAM_BOT_USERNAME` (راجع `.env.example`) ثم أعد بناء الواجهة؛ هذه قيمة عامة فقط ولا تضع رمز البوت أو أي سر في متغير يبدأ بـ `VITE_`.

للتشغيل، عيّن `TELEGRAM_BOT_TOKEN` و`BOT_TIMEZONE`، ثم شغّل `python bot.py` من مجلد `telegram-bot`. في الإنتاج، عيّن `BOT_ENV=production` و`TELEGRAM_BOT_DATA_DIR` إلى مجلد مطلق خاص خارج جذر الويب؛ يرفض البوت بدء الإنتاج دون هذا المسار. تُحفظ سجلات VIP والتذكيرات معاً بكتابة ذرية وصلاحيات ملف خاصة حيث يدعمها النظام. يمكن إبقاء `/grantvip CHAT_ID DAYS` لتفعيل إداري يدوي للخطط الزمنية. احمِ رموز البوت وأسرار API والمراجعة في مدير أسرار الخادم ولا تشغّل البوت من خادم الويب العام.

## إصدار التطبيق وبدء التشغيل

رقم الإصدار الظاهر للمستخدم محفوظ في `src/config/appVersion.js`، وإصدار الحزمة في `package.json` و`package-lock.json` يبدأ بـ `1.1.1`. حدّث القيم الثلاث معاً عند إصدار نسخة جديدة. تُظهر شاشة البداية حتى ينتهي تحميل بيانات القرآن والملف الشخصي، مع مهلة حماية كي لا تبقى فوق التطبيق عند تعذر خدمة اختيارية.

ملف البوت المرفق لا يحتوي على مصفوفة نصية للسور والآيات؛ يعرض القرآن من خلال صور صفحات المصحف ذات الـ604 صفحة. لذلك يحتوي `data.json` على بيانات صفحات الصور وفهرس السور والأجزاء، بينما تبقى `quran.surahs` بيانات فهرس فقط ولا تحتوي على نص الآيات. يحافظ المحوّل على فهرس السور والأجزاء الموجود مسبقاً عند إعادة توليد الأذكار. يستخرج المحوّل أذكار الصباح والمساء والنوم والاستيقاظ، وصيغ التسبيح، وأسماء الله الحسنى.

يستخدم البحث النص القرآني المحلي في `quran-text.json` (رواية النص العثماني، 6,236 آية؛ المصدر: [AlQuran Cloud API](https://api.alquran.cloud/v1/quran/quran-uthmani)، edition `quran-uthmani`). تُخزّن الآيات بمصفوفات compact لتقليل حجم الملف، ويُبنى الفهرس مرة واحدة في المتصفح. يطبّع البحث التشكيل واختلافات الهمزة والألف والياء قبل المطابقة. تعرض النتيجة السورة والآية ورقم الصفحة من بيانات المصدر، وتنقلك إلى صورة صفحة المصحف مع إظهار نص الآية وتظليل موضع التطابق. تُنسخ قاعدة البحث تلقائياً إلى `dist/` عند البناء.

## إضافة الأدعية ودعاء الختم

أضف أدعيتك مباشرة إلى `duas.json` كمصفوفة JSON. يحتوي كل عنصر على `title` و`category` و`text`، مثلاً:

```json
[
  {
    "title": "دعاء الختم",
    "category": "دعاء الختم",
    "text": "ألصق نص الدعاء هنا"
  },
  {
    "title": "دعاء",
    "category": "أدعية عامة",
    "text": "ألصق نص الدعاء هنا"
  }
]
```

تأكد من صحة الفواصل وعلامات الاقتباس في JSON. يدعم القسم البحث والتصفية والنسخ، ويقرأ الملف عند فتح التطبيق.

## التذكيرات والنسخ الاحتياطي

تعمل التذكيرات عبر إشعارات المتصفح عند فتح التطبيق والسماح بالإشعارات. لا يرسل التطبيق بريداً إلكترونياً؛ يتطلب إرسال البريد ربط مزود بريد وخدمة إرسال. تحفظ الإعدادات والعلامات والعدادات محلياً، ويمكن تصديرها واستيرادها من نافذة الإعدادات.

## الدعم والمدفوعات الآمنة

تستخدم واجهة الدعم صفحة Paymob المستضافة للدفع بالبطاقات والمحافظ. لا تجمع الواجهة رقم البطاقة أو CVV ولا تحفظ أي سر دفع في JavaScript أو `localStorage`. InstaPay يحوّل المستخدم إلى رابط HTTPS يحدده المشغّل. لا تُفعّل وسائل الدفع في الإنتاج قبل ضبط متغيرات البيئة التالية على خادم PHP (لا تضعها في ملفات الواجهة أو في مستودع عام):

- `APP_ORIGIN`: أصل الموقع الكامل بلا مسار أو شرطة نهائية، مثل `https://example.com`؛ يتحقق منه endpoint إنشاء الدفع لمنع الطلبات العابرة للمواقع.
- `PAYMOB_API_KEY`: مفتاح API السري من حساب التاجر.
- `PAYMOB_IFRAME_ID`: معرّف iframe المستضاف من Paymob.
- `PAYMOB_CARD_INTEGRATION_ID`: تكامل البطاقات.
- `PAYMOB_VODAFONE_CASH_INTEGRATION_ID`, `PAYMOB_ETISALAT_CASH_INTEGRATION_ID`, `PAYMOB_ORANGE_CASH_INTEGRATION_ID`: معرّفات تكاملات المحافظ التي أُنشئت وفُعّلت في لوحة Paymob.
- `PAYMOB_HMAC_SECRET`: سر HMAC المستخدم للتحقق من callback.
- `INSTAPAY_PAYMENT_URL`: رابط التحصيل HTTPS الذي يقدمه حساب InstaPay الخاص بالمشغّل.

يتطلب إنشاء جلسة Paymob PHP 8.1 أو أحدث، وامتداد cURL مع تحقق TLS. تمر البطاقات وVodafone Cash وEtisalat Cash وOrange Cash عبر تكاملات Paymob المستضافة. ينشئ `create-payment.php` الطلب على الخادم، ويحدّ المعدل إلى 6 محاولات لكل عنوان IP خلال 5 دقائق. InstaPay يستخدم رابط التحصيل الرسمي الذي يحدده التاجر، وليس واجهة Paymob؛ يلزم مطابقة التحويلات الواردة مع كشف حساب InstaPay. اضبط عنوان webhook في لوحة Paymob إلى `https://example.com/paymob-webhook.php`; يتحقق endpoint من HMAC-SHA512 قبل الإقرار بالحدث. لا يرسل التطبيق بيانات البطاقة أو يسجل تفاصيل المعاملة محلياً. وصّل webhook بنظام الطلبات/المحاسبة لديك قبل الإنتاج إذا كنت تحتاج معالجة آلية لتأكيد الدفع.

لا تُدخل أو تحفظ أرقام بطاقات المستلم أو CVV أو أرقام بطاقة البريد في واجهة التطبيق أو إعداداته. أرقام البطاقات ليست طريقة آمنة لإعلان وجهة التحويل؛ اضبط حساب التسوية من لوحة Paymob، أو استخدم رابط InstaPay HTTPS رسمي. لا تعرض IBAN للمتبرعين إلا إذا اخترت صراحةً نشر تعليمات تحويل بنكي مناسبة، وتذكّر أن التشفير لا يخفي قيمة بعد عرضها في صفحة عامة.

تضيف ملفات PHP ترويسات CSP و`X-Frame-Options` و`X-Content-Type-Options`، وتمنع `converter.php` من التشغيل عبر الويب. يطبّق `.htaccess` هذه الترويسات والتخزين المؤقت للأصول على Apache، ويحجب مجلد البوت وملفات إعدادات الخادم؛ على خادم آخر طبّق السياسة نفسها في إعدادات الويب سيرفر. استخدم HTTPS دائماً، ولا تثق بـ `X-Forwarded-For` دون إعداد proxy موثوق، وأضف حدّ طلبات على مستوى reverse proxy/WAF للحماية من الهجمات الموزعة.

### تعليقات المستخدمين

في نشر Vercel، ترسل نافذتا الملاحظات الطلبات إلى `api/feedback.js` على النطاق نفسه. تتحقق الوظيفة من المصدر والحقول، ثم تمرر الطلب إلى Google Apps Script؛ ويسجل Apps Script الرسالة ووقتها ونوعها في تبويب `Feedback` في Google Sheet، ويرسل إشعاراً نصياً إلى `25yjdx@gmail.com`. لا تُضمّن بيانات اعتماد Google أو سر webhook في ملفات المتصفح.

لإعداد التكامل:

1. أنشئ Google Sheet في الحساب المستلم، وافتح **Extensions → Apps Script**، وانسخ محتوى `google-apps-script/feedback.gs` إلى المشروع واحفظه.
2. من **Project Settings → Script Properties** أضف `FEEDBACK_SPREADSHEET_ID` (معرّف جدول البيانات من رابطه) و`FEEDBACK_WEBHOOK_SECRET` (قيمة عشوائية طويلة تُنشأ محلياً).
3. شغّل `authorizeFeedbackIntegrations` من محرر Apps Script ووافق على صلاحيات البريد وجدول البيانات، ثم انشر Apps Script كـ **Web app** مع **Execute as: Me** و**Who has access: Anyone**. انسخ رابط النشر المنتهي بـ `/exec`.
4. في إعدادات مشروع Vercel، أضف `ZAD_FEEDBACK_SCRIPT_URL` (رابط `/exec`) و`ZAD_FEEDBACK_WEBHOOK_SECRET` (نفس السر من Script Properties) لكل بيئة مطلوبة. أنشئ السر محلياً مثلاً باستخدام `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`؛ لا تضفه إلى Git أو تضعه في متغير يبدأ بـ `VITE_`.
5. للتجربة عبر Vite محلياً، انسخ القيمتين نفسيهما إلى `.env.local`؛ يمرر خادم التطوير `/api/feedback` إلى معالج Vercel نفسه. لا ترسل رسالة حتى تضبط رابط Apps Script والسر.
6. انشر التطبيق على Vercel بعد حفظ المتغيرات، ثم أرسل رسالة تجريبية وتحقق من البريد والصف في `Feedback`. لإرسال تغييرات الشيفرة:

   ```sh
   git add api/feedback.js google-apps-script/feedback.gs src/legacy/app.js .env.example README.md
   git commit -m "Connect feedback to Google Sheets and email"
   git push origin main
   ```

يعيد Apps Script رفض الطلبات المكررة بأمان باستخدام معرّف الإرسال، ويحد الإرسال إلى 5 رسائل لكل عنوان IP كل 5 دقائق دون حفظ عنوان IP في الجدول. يبقى `feedback.php` كما هو لاستخدامات استضافة PHP السابقة؛ لا تستخدم نموذج Vercel على GitHub Pages لأن Pages لا يشغّل وظائف `/api/*`.

### أيقونات التطبيق الموسمية

يحتوي `manifest.json` على أيقونات الهوية العادية ورمضان والعيد ضمن `assets/icons/`. يختار رابط أيقونة المتصفح وأيقونة اللمس تلقائياً بحسب التقويم الهجري أم القرى عند فتح التطبيق. قد تحتفظ أيقونة مثبتة مسبقاً بنسخة مخبأة من النظام؛ بعد تغييرها موسمياً قد يلزم تحديث بيانات التطبيق أو إعادة تثبيته، إذ تختلف آلية تحديث أيقونة المشغّل بين أنظمة التشغيل والمتصفحات.

## GitHub Pages Deployment

GitHub Pages hosts static files only. It cannot run PHP or Vercel `/api/*` functions, so the frontend and its `data.json` fallback can be published there, but the feedback endpoint, PHP endpoints such as `api.php`, `create-payment.php`, and `paymob-webhook.php` will not execute. Feedback and payments therefore require their configured backend on Vercel/PHP hosting; they will not work on a Pages-only deployment.

This repository uses `.github/workflows/deploy-pages.yml` and publishes the compiled `dist/` artifact with GitHub Actions. In **Settings → Pages**, set the source to **GitHub Actions**. Do not select the repository root or deploy raw `src/` files; Vite must compile the JSX before the browser serves the app. The Vite `base: './'` setting and relative manifest/icon paths support project-site subpaths.

From PowerShell, build and publish a change with:

```powershell
npm ci
npm run build:pages
git status --short
git add README.md vite.config.js
git commit -m "Fix GitHub Pages production assets"
git push origin HEAD:main
```

The push starts the Pages workflow; wait for `Deploy static UI to GitHub Pages` to finish, then open the URL shown in **Settings → Pages**. For a project site, the URL is usually `https://<owner>.github.io/<repository>/`. Do not publish real API keys, bot tokens, private configuration, or payment secrets.

Pages does not apply this project's PHP security headers or Apache `.htaccess` rules. For live payments, deploy the PHP backend on an HTTPS server and route the frontend's payment/API requests to it through a same-origin reverse proxy, or deliberately update the frontend to use a separately hosted API with narrowly scoped CORS and CSRF protections. A separate backend URL alone will not work with the current relative `create-payment.php` request. Do not weaken origin checks or put server credentials in frontend code to make it work.

## Paymob Live Keys and Egyptian Payment Methods

The frontend must never contain a Paymob API key, HMAC secret, merchant credential, or card number/CVV field. Configure secrets only in the environment of the PHP backend hosting `create-payment.php` and `paymob-webhook.php`. GitHub Pages cannot host that backend.

1. Deploy the PHP endpoints on a server with PHP 8.1+ and cURL, HTTPS, and the security configuration described above. Ensure the public frontend origin and API routing match the deployment. The current implementation expects the payment endpoint on the same origin.
2. In the Paymob merchant dashboard, activate the **Live** account and create/enable separate live integrations for cards, Vodafone Cash, Etisalat Cash, and Orange Cash. Copy the live API key, hosted iframe ID, each integration ID, and the webhook HMAC secret from the appropriate account settings. Sandbox credentials and integration IDs are not interchangeable with Live credentials. Confirm the current endpoint and checkout requirements with Paymob for your merchant account before enabling production.
3. Set the backend environment variables using the exact values for that merchant account:

   | Environment variable | Value |
   | --- | --- |
   | `APP_ORIGIN` | Exact public site origin, e.g. `https://example.com` (no path or trailing slash) |
   | `PAYMOB_API_KEY` | Secret Live API key |
   | `PAYMOB_IFRAME_ID` | Live hosted checkout iframe ID |
   | `PAYMOB_CARD_INTEGRATION_ID` | Live card integration ID |
   | `PAYMOB_VODAFONE_CASH_INTEGRATION_ID` | Live Vodafone Cash integration ID |
   | `PAYMOB_ETISALAT_CASH_INTEGRATION_ID` | Live Etisalat Cash integration ID |
   | `PAYMOB_ORANGE_CASH_INTEGRATION_ID` | Live Orange Cash integration ID |
   | `PAYMOB_HMAC_SECRET` | Secret used to verify Paymob callback signatures |
   | `INSTAPAY_PAYMENT_URL` | Merchant's official HTTPS InstaPay collection link |

   Configure these in the hosting provider's secret/environment-variable settings, not in a committed `.env`, PHP source file, HTML, JavaScript, or `localStorage`. Restart/reload the PHP service after changing them. On a Linux host, environment variables can be set by the hosting panel or service manager; do not copy real secrets into shell history or shared logs.
4. Set the Paymob callback/webhook URL to `https://<your-api-host>/paymob-webhook.php`, then verify that the HMAC secret matches the Live account. Use a non-production/sandbox setup first to test checkout and callback behavior, then repeat a low-value, controlled test in Live.
5. Before launch, verify each configured Paymob method independently and confirm the signed webhook activates the matching linked Telegram account. The webhook records pending orders and completes each only once. Do not treat a browser redirect or client-side message as proof of payment. InstaPay transfers remain pending until an authorized reviewer confirms them; the static InstaPay link does not provide automatic payment verification.

InstaPay is currently a separately configured HTTPS payment link, not a Paymob integration. Confirm that the link supports your collection workflow and reconcile transfers against the merchant account. Never ask users to enter card details into this application; Paymob Hosted Checkout must collect them.

## Android APK/AAB from the PWA

The repository includes `manifest.json`, raster 192×192 and 512×512 app icons, and a production service worker generated by `vite-plugin-pwa`. The worker precaches the app shell and uses **CacheFirst** for Quran page images (`quran.ksu.edu.sa/png_big`) and `quran-text.json`, so previously opened mushaf pages can be read offline. Payment, PHP, and `/api/` requests stay on `NetworkOnly` and are not cached. Before creating a store wrapper:

1. Check that `manifest.json` has the correct app name, `start_url` and `scope` for the deployed path (including `/<repository>/` for a GitHub Pages project site), `display: "standalone"`, theme/background colors, and icons suitable for your target packaging tool.
2. The manifest is linked from `index.html`. After `npm run build`, confirm `dist/` contains the generated service worker and that installability and updates work over HTTPS. Do not cache payment/API requests, checkout pages, or responses containing personal/payment data.
3. Deploy the production site over HTTPS and test it on Android Chrome. The PHP payment backend still needs its separate HTTPS deployment; a Trusted Web Activity (TWA) does not make PHP run on GitHub Pages.
4. On a development machine with Node.js, Java/JDK, and Android SDK tooling installed, install Bubblewrap and initialize a TWA from the live manifest URL:

   ```sh
   npm install --global @bubblewrap/cli
   bubblewrap init --manifest=https://<host>/<path>/manifest.webmanifest
   bubblewrap build
   ```

   Follow the prompts to set the Android application ID, app name, version, and signing configuration. Bubblewrap is a third-party open-source project, not an official Google product; consult its current documentation if CLI options or Android build prerequisites have changed.
5. Keep the signing keystore and passwords backed up securely and out of source control. Use the generated signed **AAB** for a new Google Play release (Play App Signing is recommended); use an APK for local/device testing where appropriate. Check the generated artifact path reported by Bubblewrap, upload the AAB through Play Console's internal testing track first, and satisfy the target API level and other Play Console requirements in effect at submission time.
6. For the TWA to open without browser UI, publish a Digital Asset Links file at `https://<host>/.well-known/assetlinks.json`. It must contain the exact Android package name and SHA-256 fingerprint of the app-signing certificate. When Play App Signing is enabled, use the **app signing certificate** fingerprint shown in Play Console (not just the upload-key fingerprint). Verify the association after publishing and retest the installed app.

Useful references: [GitHub Pages](https://docs.github.com/en/pages), [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap), and [Trusted Web Activities](https://developer.chrome.com/docs/android/trusted-web-activity/).

## Desktop Packaging

For Electron, install Node.js, Electron, and a packager such as `electron-builder`. Create a separate Electron entry point that opens `index.html`, and include the frontend files and `data.json`. If the desktop app needs the PHP API, provide and test a suitable local or remote PHP service. Do not package Telegram tokens or payment secrets in the client.
