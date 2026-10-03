# AREEN Sales & Representatives

نظام مبيعات ومتابعة مناديب Mobile First لشركة AREEN TOP، يعمل من المتصفح على Android وiPhone والويب، ويدعم العربية والإنجليزية.

## ما تم تنفيذه

- تسجيل دخول Username + Password باستخدام Firebase Authentication.
- صلاحيتان: مدير المبيعات (Full Access) ومندوب المبيعات.
- ربط المندوب بالمناطق، والعميل بالمنطقة والمندوب.
- إدارة المناطق والمناديب والأصناف والعملاء.
- أهداف سنوية لكل مندوب موزعة على 12 شهر، مع عدد أيام العمل لكل شهر.
- لوحة مؤشرات: أيام العمل المنفذة والمتبقية، الهدف الشهري، الهدف لتاريخه، الفعلي، المتبقي، المطلوب يومياً، إجمالي البيع والتحصيل.
- رفع العملاء والأصناف من Excel مع Preview والتحقق قبل الاستيراد.
- تنزيل نموذج Excel للعملاء والأصناف من داخل النظام.
- عملية بيع متعددة الأصناف، وتسجيل المدفوع، وحساب الرصيد تلقائياً:
  `الرصيد السابق + قيمة البيع - المدفوع = الرصيد الجديد`
- سجل مبيعات العميل وتحصيلاته.
- تقارير المبيعات، التحصيل، أرصدة العملاء، أداء المناديب، كشف حركة العميل، والزيارات.
- تصدير التقارير Excel وPDF.
- عربي RTL / English LTR.
- PWA: قابل للإضافة إلى الشاشة الرئيسية على Android وiPhone.
- Firestore + Firebase Authentication فقط. لا توجد Cloud Functions أو Firebase Storage.

## Firebase Project

المشروع مضبوط بالفعل على:

`areen-5b706`

الملف: `firebase.js`

## إعداد Firebase لأول مرة

### 1. Authentication

من Firebase Console:

`Authentication > Sign-in method > Email/Password > Enable`

أنشئ أول مستخدم مدير يدوياً:

- Email: `manager@areen.local`
- Password: اختر كلمة مرور قوية

المستخدم سيكتب في شاشة الدخول فقط:

- Username: `manager`
- Password: نفس كلمة المرور

بعد أول تسجيل دخول سيظهر زر **تهيئة** لإنشاء ملف مدير المبيعات في Firestore.

### 2. Firestore

أنشئ Firestore Database ثم انسخ محتوى ملف:

`firestore.rules`

إلى:

`Firestore Database > Rules`

ثم Publish.

> الـCollections سيتم إنشاؤها تلقائياً عند إضافة البيانات. لا تحتاج لإنشائها يدوياً.

## أسماء Collections

الأسماء ثابتة وواضحة:

- `users`
- `sales_representatives`
- `regions`
- `customers`
- `products`
- `monthly_targets`
- `visits`
- `sales`
- `payments`

## Document IDs

لا يعتمد النظام على Auto IDs عشوائية لبيانات العمل. أمثلة:

- `REP-AHMED`
- `REG-RIYADH-EAST`
- `CUST-0001`
- `PRD-0001`
- `TGT-REP-AHMED-2026`
- `SALE-20261003-153012123-REP-AHMED`
- `PAY-20261003-153012124-REP-AHMED`
- `VIS-20261003-153012125-REP-AHMED`

الاستثناء الوحيد هو Firebase Authentication UID الداخلي، لكنه لا يُستخدم كاسم Document لبيانات العمل.

## تشغيل محلي

يجب تشغيل المشروع من Web Server وليس بفتح `index.html` مباشرة بسبب ES Modules وService Worker.

مثال:

```bash
python3 -m http.server 8080
```

ثم افتح:

`http://localhost:8080`

## النشر

المشروع Static ويمكن نشره على Vercel / Firebase Hosting / Netlify أو أي استضافة HTTPS.

إذا استخدمت Vercel، ارفع **كل الملفات الموجودة في هذا المجلد إلى جذر Repository نفسه**، وليس ملف ZIP وحده ولا بعض الملفات فقط. هذه النسخة مسطحة (Flat) عمدًا حتى لا تضيع مجلدات `css/js/assets` أثناء الرفع من واجهة GitHub. لا تحتاج Build Command.

## Excel - العملاء

النظام يقبل عناوين عربية أو إنجليزية. العناوين القياسية:

- `customer_code`
- `name_ar`
- `name_en`
- `mobile`
- `address`
- `region_code`
- `representative_code`
- `opening_balance`
- `customer_type`
- `notes`

يمكن أيضاً إدخال اسم المنطقة أو اسم المندوب بدلاً من الكود إذا كان الاسم مطابقاً لما هو مسجل في النظام.

## Excel - الأصناف

- `product_code`
- `name_ar`
- `name_en`
- `unit`
- `price`

## ملاحظات أمنية مهمة

لأن المشروع متعمد أن يكون بدون Cloud Functions أو Backend مخصص، تم نقل التحكم الأساسي إلى Firestore Security Rules، ومنها:

- المندوب يرى عملاءه وعملياته فقط.
- المندوب لا يستطيع تعديل بيانات العميل العادية بعد الإنشاء.
- تحديث رصيد العميل من حساب مندوب مسموح فقط مع عملية بيع مرتبطة داخل نفس Transaction.
- المندوب لا يستطيع تسجيل تحصيل مستقل؛ المدفوع عند البيع فقط. مدير المبيعات يستطيع تسجيل تحصيل مستقل.
- إنشاء حسابات المناديب يتم من حساب المدير بواسطة Firebase Auth secondary app حتى لا يتم تسجيل خروج المدير.

حذف مستخدم Firebase Auth آخر نهائياً غير متاح بأمان من Web Client بدون Admin SDK/Backend. لذلك النظام يستخدم **إيقاف/تفعيل الحساب** بدلاً من حذف حساب Authentication.
