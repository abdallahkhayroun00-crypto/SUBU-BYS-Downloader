SUBÜ BYS Downloader v2.0.1
========================

التثبيت
-------
1) فك ضغط الملف ZIP.
2) افتح: chrome://extensions
3) فعّل Developer mode.
4) احذف/عطّل النسخة القديمة.
5) اضغط Load unpacked.
6) اختر المجلد: SUBU-BYS-Downloader-v2.0
7) اعمل Reload لصفحة SUBÜ BYS مرة واحدة.

أهم الميزات الجديدة
-------------------
- تصميم Popup جديد ونظيف.
- ON/OFF حقيقي: عند OFF لا توجد مراقبة للصفحة ولا polling ولا MutationObserver.
- Download All.
- اختيار الملفات واحداً واحداً من داخل الـPopup.
- Download New Only حسب History.
- حفظ على:
  * Computer
  * Google Drive
  * Computer + Drive
- يسألك عن مكان الحفظ قبل كل Session، ويمكن اختيار Remember my choice.
- Google Drive authorization مرة واحدة فقط عادةً بعد إعداد OAuth.
- اختيار أي Folder داخل My Drive من Folder Browser داخل الإضافة.
- إنشاء Folder باسم المادة تلقائياً داخل Drive (اختياري).
- إنشاء Downloads/SUBU/Course Name على الكمبيوتر (اختياري).
- Smart filenames:
  * Hafta 01 - Document title
  * 01 - Document title
  * Document title only
  * Course - Hafta 01 - Document
- PDF viewer support + PPTX + Word + Excel + ZIP.
- Retry تلقائي 0-3 مرات.
- Auto Skip اختياري.
- Retry / Skip / Stop عند الخطأ.
- Progress bar + العدد + الملف الحالي + إحصائيات.
- Resume session إذا توقف Chrome/الموقع أو أوقفت العملية.
- Delay 1/2/3/5 ثوانٍ بين الملفات لتخفيف الضغط على SUBÜ.
- عند HTTP 429 أو 5xx تنتظر الإضافة 30 ثانية قبل Retry.
- Drive duplicate policy:
  * Skip existing
  * Replace existing
  * Keep both
- Export CSV لقائمة وثائق المادة.
- Notification عند انتهاء العملية.

Google Drive - إعداد مرة واحدة
------------------------------
تم إعداد Google Drive OAuth مسبقاً في هذه النسخة للإضافة ذات ID:
pgcijlcapbmjmkdnikdaekfdiiljibmb

OAuth Client ID الموجود داخل manifest.json:
86164904652-urldpqfuu003jhs5b7epoeb48h9s9a57.apps.googleusercontent.com

لا تحتاج إلى تشغيل CONFIGURE_GOOGLE_DRIVE.bat. بعد تثبيت/Reload للإضافة، افتح الـpopup واضغط Connect Drive مرة واحدة فقط، ثم وافق على صلاحية Google Drive واختر المجلد.
