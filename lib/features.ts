// Every word of marketing copy the site shows, in one place.
//
// The landing page and the /xususiyyetler pages both read from here, so a wording
// change happens once. Nothing in this file may claim something the app does not
// actually do — each group is written from the panel that implements it, and the
// comment above each entry names that source.
//
// No icons or JSX here on purpose: this file stays serialisable plain data, and the
// pages map `slug` to a lucide icon on their own.

export type FeaturePoint = {
  name: string;
  body: string;
};

export type FeatureFaq = {
  q: string;
  a: string;
};

export type Feature = {
  slug: string;
  /** Short label for nav and cards. */
  nav: string;
  /** The page's <h1>. */
  h1: string;
  /** <title>, brand appended by the layout template. */
  title: string;
  /** Meta description, 140–160 chars. */
  description: string;
  /** One-liner on the landing page overview card. */
  tagline: string;
  /** Problem-framing paragraph under the h1. */
  intro: string;
  points: FeaturePoint[];
  faqs: FeatureFaq[];
};

// ─── 1. QR menyu və sifariş qəbulu ────────────────────────────────────────────
// Source: app/[slug]/menu/page.tsx, app/s/[slug]/[token]/page.tsx, app/seller/page.tsx
const QR_MENU: Feature = {
  slug: 'qr-menyu',
  nav: 'QR menyu',
  h1: 'QR menyu və sifariş qəbulu',
  title: 'QR menyu və QR ilə sifariş sistemi',
  description:
    'Müştəri masadakı QR kodu skan edir, menyunu telefonunda görür və sifarişi özü verir. Tətbiq yükləmək lazım deyil — hər şey brauzerdə işləyir.',
  tagline: 'Müştəri masadan telefonuyla sifariş verir — tətbiq yükləmədən.',
  intro:
    'Kağız menyu köhnəlir, qiymət dəyişəndə yenidən çap olunur, ofisiant isə eyni sualı gündə yüz dəfə cavablandırır. QR menyu bu döngəni qırır: müştəri masadakı kodu skan edir, menyunu şəkilləri və qiymətləri ilə görür, sifarişi özü yığır. Sifariş həmin an mətbəxə düşür. Heç nə yüklənmir, heç nə quraşdırılmır — telefon kamerası və brauzer kifayətdir.',
  points: [
    {
      name: 'Hər masaya öz QR kodu',
      body: 'Kod skan olunanda sifariş avtomatik həmin masaya yazılır. Ofisiantın masa nömrəsini soruşmasına və ya yadda saxlamasına ehtiyac qalmır.',
    },
    {
      name: 'Yalnız menyu baxışı rejimi',
      body: 'Sifarişi hələ ofisiant qəbul etsin istəyirsinizsə, QR-ı sifarişsiz rejimə keçirin: müştəri menyunu və qiymətləri görür, amma sifariş düyməsi görünmür.',
    },
    {
      name: 'Satıcı terminal linki',
      body: 'Ofisiantın öz telefonu bir link vasitəsilə tam sifariş terminalına çevrilir — heç nə quraşdırmadan. Link sizin nəzarətinizdədir: bir kliklə yeniləyirsiniz və köhnəsi dərhal işdən düşür.',
    },
    {
      name: 'Takeaway sifarişlər',
      body: 'Özü ilə aparan müştəri üçün masa seçmək lazım deyil. Takeaway sifarişlər masalardan ayrı gedir, hesabatlarda isə eyni cür görünür.',
    },
    {
      name: 'Variantlı məhsullar',
      body: 'Bir məhsulun bir neçə ölçüsü və növü olur — kiçik/böyük, isti/soyuq. Hər variantın öz qiyməti və öz maya dəyəri var, ona görə mənfəət hesabatı da variant səviyyəsində dəqiqdir.',
    },
    {
      name: 'Açıq sifarişə sonradan əlavə',
      body: 'Müştəri sonra bir qəhvə də istəyəndə yeni sifariş açmağa ehtiyac yoxdur. Əlavə eyni hesaba düşür və mətbəxdə ayrıca partiya kimi görünür ki, aşpaz nəyin təzə gəldiyini anlasın.',
    },
    {
      name: 'Masa dəyişmə',
      body: 'Müştəri başqa masaya keçəndə açıq sifariş bütün məhsulları ilə birlikdə köçürülür. Hesabı yenidən yığmaq lazım deyil.',
    },
    {
      name: 'Səbəbli ləğv',
      body: 'Sifariş ləğv ediləndə səbəb seçilir — müştəri imtina etdi, səhv sifariş, məhsul yoxdur. Ay sonunda nə qədər və nə üçün itirdiyinizi görürsünüz.',
    },
    {
      name: 'Ödənişsiz bağlama',
      body: 'Hesabı qonaq etmək lazım gələndə sifariş səbəbi yazılmaqla ödənişsiz bağlanır. Kassa hesabatında bu məbləğ satış kimi sayılmır.',
    },
  ],
  faqs: [
    {
      q: 'Müştəri tətbiq yükləməlidir?',
      a: 'Xeyr. Müştəri QR kodu telefon kamerası ilə skan edir və menyu birbaşa brauzerdə açılır. Nə App Store, nə Google Play — heç bir yükləmə yoxdur.',
    },
    {
      q: 'Neçə masa dəstəklənir?',
      a: 'Limitsiz. İstədiyiniz qədər masa əlavə edə, hər birinə ayrıca QR kod yarada bilərsiniz.',
    },
    {
      q: 'QR menyunu sifarişsiz, yalnız baxış üçün istifadə edə bilərəmmi?',
      a: 'Bəli. Admin panelindən “Yalnız menyu baxışı” rejimini yandırın — müştəri menyunu və qiymətləri görür, sifarişi isə əvvəlki kimi ofisiant qəbul edir.',
    },
  ],
};

// ─── 2. Mətbəx ekranı və sexlər ───────────────────────────────────────────────
// Source: app/station/page.tsx, lib/stations.ts, lib/sound.ts, lib/push.ts
const KITCHEN: Feature = {
  slug: 'metbex-ekrani',
  nav: 'Mətbəx ekranı',
  h1: 'Mətbəx ekranı və sexlərə bölünmə',
  title: 'Mətbəx ekranı və sex idarəetməsi',
  description:
    'Sifariş real vaxtda mətbəx ekranına düşür. Hər sex — mətbəx, bar, mangal — yalnız öz hazırlayacağı yeməkləri görür. Səs siqnalı və push bildiriş daxildir.',
  tagline: 'Hər sex yalnız öz yeməyini görür, sifariş isə real vaxtda düşür.',
  intro:
    'Kağız bilet itir, ofisiantın səsi səs-küydə eşidilmir, bar isə mətbəxin sifarişini oxumağa məcbur qalır. Mətbəx ekranı sifarişi verildiyi an göstərir və onu sexlərə bölür: mangalın ekranında yalnız mangal yeməkləri, barın ekranında yalnız içkilər görünür. Aşpaz hazır olan hər yeməyi bir toxunuşla işarələyir, ofisiant isə telefonunda bildiriş alır.',
  points: [
    {
      name: 'Real vaxtda yenilənən ekran',
      body: 'Sifariş verildiyi an ekrana düşür — səhifəni yeniləmək və ya gözləmək lazım deyil. Bağlantı kəsiləndə ekran bunu açıq şəkildə yazır ki, heç kim boş ekrana baxıb sifariş yoxdur sanmasın.',
    },
    {
      name: 'Sexlərə bölünmə',
      body: 'Mətbəx, bar, mangal, şirniyyat — istədiyiniz qədər sex yaradırsınız. Hər məhsul öz sexinə bağlanır və yalnız o sexin ekranına düşür. Aşpaz başqa sexin işini görmür, ona görə də qarışıqlıq olmur.',
    },
    {
      name: 'Sex əməkdaşları',
      body: 'Hər əməkdaş bir sexə təhkim olunur və ekranda yalnız öz sexinin yeməklərini görür. Girişi PIN ilədir, ona görə bir planşeti bütün növbə paylaşa bilər.',
    },
    {
      name: 'Yemək-yemək hazır işarəsi',
      body: 'Bütün sifarişi deyil, hər yeməyi ayrıca hazır işarələyirsiniz. Ofisiant sifarişin neçə hissəsinin hazır olduğunu görür və masaya vaxtından əvvəl getmir.',
    },
    {
      name: 'Səs siqnalı',
      body: 'Sex printeri hələ qoşulmayıbsa, yeni sifariş səslə xəbər verilir. Səs proqram tərəfindən yaradılır — yüklənəcək fayl yoxdur, ona görə heç vaxt “səs gəlmədi” problemi olmur.',
    },
    {
      name: 'Push bildiriş',
      body: 'Yemək hazır olanda ofisiantın telefonuna sistem bildirişi gedir — telefon kilidli olsa və ya səhifə bağlı olsa belə. Səhifədəki səs telefon kilidlənəndə eşidilmir, bildiriş isə çatır.',
    },
    {
      name: 'Sifariş partiyaları',
      body: 'Sonradan əlavə olunan yeməklər ekranda ayrıca partiya kimi görünür. Aşpaz nəyin ilk sifarişdən, nəyin təzə gəldiyini bir baxışda ayırır.',
    },
  ],
  faqs: [
    {
      q: 'Mətbəx ekranı üçün xüsusi cihaz almalıyam?',
      a: 'Xeyr. İstənilən planşet, köhnə telefon və ya monitoru olan kompüter işə yarayır — ekran brauzerdə açılır.',
    },
    {
      q: 'Bir yeməyin hansı sexə getdiyini necə təyin edirəm?',
      a: 'Menyuda hər məhsulun yanında sex seçilir. Sex seçilməyibsə, yemək şirkətin ilk sexinə düşür — yəni heç bir sifariş “heç yerə” getmir.',
    },
    {
      q: 'İnternet kəsiləndə nə olur?',
      a: 'Ekran bağlantının olmadığını açıq şəkildə göstərir və bağlantı qayıdan kimi özü yenilənir.',
    },
  ],
};

// ─── 3. Çek çapı və pul çəkməcəsi ─────────────────────────────────────────────
// Source: lib/escpos.ts, lib/printer.ts, agent/index.ts, PRINTER_SETUP.md
const PRINTING: Feature = {
  slug: 'cek-capi',
  nav: 'Çek çapı',
  h1: 'Çek çapı, sex biletləri və pul çəkməcəsi',
  title: 'Termal çek çapı və pul çəkməcəsi',
  description:
    'Termal printerə birbaşa brauzerdən ESC/POS çapı, avtomatik sex biletləri və proqramdan açılan pul çəkməcəsi. Ayrıca sürücü quraşdırmadan.',
  tagline: 'Termal çek, sex biletləri və pul çəkməcəsi — birbaşa brauzerdən.',
  intro:
    'Çek printeri adətən ayrıca proqram, ayrıca sürücü və ayrıca baş ağrısı deməkdir. Burada çek birbaşa brauzerdən çap olunur: proqram printerə ESC/POS əmrlərini özü göndərir. Pul çəkməcəsi də eyni kabeldən açılır. Şəbəkə printerləriniz varsa, kassa kompüterində işləyən kiçik bir agent biletləri hər sexin öz printerinə çatdırır.',
  points: [
    {
      name: 'Birbaşa brauzerdən çap',
      body: 'Chrome və ya Edge printerə ESC/POS baytlarını özü göndərir. Ayrıca çap proqramı və ya sürücü quraşdırmaq lazım deyil — printer bir dəfə seçilir, sonra hər açılışda özü qoşulur.',
    },
    {
      name: 'Pul çəkməcəsinin açılması',
      body: 'Çəkməcə printerə qoşulub və proqramdan açılır. Ödəniş qəbul edilən kimi çəkməcə açılır — kassirin ayrıca düyməyə uzanmasına ehtiyac qalmır.',
    },
    {
      name: 'Avtomatik sex biletləri',
      body: 'Sifariş verilən kimi sistem onu sexlərə bölür və hər sexə öz biletini göndərir. Mangal öz biletini, bar öz biletini alır.',
    },
    {
      name: 'Bilet üzərində qiymət yoxdur',
      body: 'Sex biletində yalnız nə hazırlanacağı və neçə ədəd olduğu yazılır. Qiymətlər aşpazın işinə yaramır və vacib məlumatı sıxışdırır.',
    },
    {
      name: 'Şəbəkə printerləri üçün agent',
      body: 'Buludda işləyən proqram restoranın daxili şəbəkəsindəki printerə birbaşa çıxa bilmir. Kassa kompüterində işləyən kiçik agent bu boşluğu doldurur: bileti götürür və sexin printer IP-sinə göndərir. Çatmayan bilet təkrar cəhd edilir.',
    },
    {
      name: 'Yenidən çap',
      body: 'Kağız bitib, çek cırılıb və ya müştəri ikinci nüsxə istəyir — istənilən çek bir düymə ilə yenidən çap olunur.',
    },
    {
      name: 'Azərbaycan hərfləri',
      body: 'Termal printerlərin şrifti Azərbaycan hərflərini tanımır. Sistem onları avtomatik ən yaxın latın formasına çevirir — çek oxunaqlı çıxır, qarışıq simvollar görünmür.',
    },
  ],
  faqs: [
    {
      q: 'Hansı printerlər dəstəklənir?',
      a: 'ESC/POS əmrlərini başa düşən termal çek printerləri — bazardakı çek printerlərinin böyük əksəriyyəti. USB ilə birbaşa, şəbəkə printerləri isə çap agenti vasitəsilə qoşulur.',
    },
    {
      q: 'Hansı brauzer lazımdır?',
      a: 'USB ilə birbaşa çap üçün Chrome və ya Edge. Firefox bu texnologiyanı dəstəkləmir. Şəbəkə printerləri ilə işləyəndə brauzerin fərqi yoxdur.',
    },
    {
      q: 'Çek printerim yoxdur — sistem işləyəcəkmi?',
      a: 'Bəli. Printer olmadan da bütün sifarişlər mətbəx ekranında görünür, üstəlik yeni sifariş səslə xəbər verilir.',
    },
  ],
};

// ─── 4. Kassa və növbə ────────────────────────────────────────────────────────
// Source: app/admin/page.tsx (kassa tab), app/seller/page.tsx (shift open/close)
const CASH: Feature = {
  slug: 'kassa',
  nav: 'Kassa',
  h1: 'Kassa və növbə idarəetməsi',
  title: 'Restoran üçün kassa və növbə proqramı',
  description:
    'Növbə açılışı və bağlanışı, mədaxil-məxaric, kassada olmalı olan məbləğlə sayılanın müqayisəsi və kart satışının ayrıca izlənməsi.',
  tagline: 'Növbə açılışı, mədaxil-məxaric və kəsir nəzarəti — hər gün dəqiq.',
  intro:
    'Gün sonunda kassada nə qədər pul olmalı idi və nə qədər var — bu sualın cavabı çox vaxt kağız üzərində, yaddaşdan və mübahisə ilə tapılır. Kassa modulu növbəni əvvəldən sona qədər yazır: kassir başlanğıc məbləği daxil edərək növbəni açır, gün ərzində hər mədaxil və məxaric qeyd olunur, bağlananda isə sistem olmalı olan məbləği özü hesablayır və sayılanla müqayisə edir.',
  points: [
    {
      name: 'Növbə açılışı',
      body: 'Kassir işə başlayanda kassadakı başlanğıc məbləği daxil edir. Bütün günün hesabı bu rəqəmin üstündən qurulur.',
    },
    {
      name: 'Mədaxil və məxaric',
      body: 'Kassadan çıxan və kassaya girən hər məbləğ qeydlə yazılır — tədarükçüyə ödəniş, xırda alış, kassaya əlavə pul. Gün sonunda “bəs bu pul hara getdi?” sualı qalmır.',
    },
    {
      name: 'Kassa uyğunluğu',
      body: 'Növbə bağlananda sistem kassada olmalı olan məbləği göstərir, kassir isə saydığını daxil edir. Nəticə dərhal görünür: dəqiq, kəsir, yoxsa artıq.',
    },
    {
      name: 'Terminal ayrıca izlənir',
      body: 'Kartla ödənişlər kassaya girmir — bank terminalından keçir. Sistem onları ayrıca sayır və terminalın Z-hesabatı ilə üzləşdirməyə imkan verir. Nağd və kart bir-birinə qarışmır.',
    },
    {
      name: 'Bağlanmış növbələrin tarixçəsi',
      body: 'Hər növbə üçün kim açıb, kim bağlayıb, başlanğıc nə qədər olub, olmalı idi nə qədər, sayılan nə qədər — hamısı saxlanılır. Kəsir təkrarlanırsa, bu, cədvəldə özünü göstərir.',
    },
    {
      name: 'Ödənişin düzəldilməsi',
      body: 'Ödəniş üsulu səhv seçiləndə — nağd əvəzinə kart — admin onu sonradan düzəldə bilər. Növbənin hesabı avtomatik yenilənir.',
    },
  ],
  faqs: [
    {
      q: 'Kassir gün ərzində kassadan pul götürsə nə olur?',
      a: 'Bunu məxaric kimi qeydlə yazır. Növbə bağlananda həmin məbləğ olmalı olan puldan çıxılır, ona görə kəsir kimi görünmür.',
    },
    {
      q: 'Kart satışları kassaya daxildirmi?',
      a: 'Xeyr. Kart satışları ayrıca sayılır, çünki pul terminaldan banka gedir. Sistem terminal məbləğini ayrıca göstərir ki, Z-hesabatla tutuşdura biləsiniz.',
    },
    {
      q: 'Bir neçə kassirim var — hər birinin öz növbəsi olurmu?',
      a: 'Bəli. Növbəni kim açıb, kim bağlayıb yazılır və hər növbə öz hesabı ilə tarixçədə qalır.',
    },
  ],
};

// ─── 5. Statistika, mənfəət və hesabatlar ─────────────────────────────────────
// Source: app/admin/page.tsx (stats tab, AnalizPanel), lib/business-day.ts, lib/excel.ts
const REPORTS: Feature = {
  slug: 'hesabatlar',
  nav: 'Hesabatlar',
  h1: 'Statistika, mənfəət və hesabatlar',
  title: 'Restoran hesabatları və mənfəət analizi',
  description:
    'Gəlir yox, mənfəət. Maya dəyəri, marja, orta çek, top məhsullar, saatlıq və günlük analiz — hamısı avtomatik, Excel-ə ixracla.',
  tagline: 'Gəlir deyil, mənfəət: maya dəyəri, marja və orta çek bir ekranda.',
  intro:
    'Kassanın ümumi dövriyyəsi heç nə demir — restoranı gəlir deyil, mənfəət yaşadır. Hesabatlar hər məhsulun maya dəyərini bildiyi üçün gəlirlə yanaşı xərci, mənfəəti və marjanı da göstərir. Hansı yeməyin nə qədər satıldığını, hansı saatlarda izdiham olduğunu, hansı satıcının nə qədər iş gördüyünü ayrıca görürsünüz. Hər şey Excel-ə çıxarılır.',
  points: [
    {
      name: 'Gəlir, maya dəyəri, mənfəət',
      body: 'Seçilmiş dövr üçün dörd rəqəm bir yerdə: nə qədər satılıb, nə qədərə başa gəlib, nə qədər qalıb və marja neçə faizdir. Orta çek və sifariş sayı da yanındadır.',
    },
    {
      name: 'Kateqoriya mənfəəti',
      body: 'Hansı kateqoriya real pul gətirir? Çox vaxt ən çox satılan ən çox qazandıran deyil — bu hesabat fərqi açıq göstərir.',
    },
    {
      name: 'Top məhsullar',
      body: 'Ən çox satılan yeməklərin siyahısı. Menyunu qısaltmaq və ya qiymət dəyişmək qərarını rəqəmə söykəyirsiniz.',
    },
    {
      name: 'Satıcı statistikası',
      body: 'Hər satıcının satış həcmi ayrıca. Kimin çox iş gördüyünü mübahisəsiz görürsünüz.',
    },
    {
      name: 'Gün saatlarına və həftənin günlərinə görə',
      body: 'İzdiham hansı saatlarda başlayır, hansı günlər boş keçir. Növbə cədvəlini bu qrafiklərə görə qurmaq olar.',
    },
    {
      name: 'Aşağı marja xəbərdarlığı',
      body: 'Marjası 20%-dən aşağı düşən məhsullar avtomatik işarələnir. Tədarükçü qiyməti qaldıranda bunu ay sonunda deyil, dərhal görürsünüz.',
    },
    {
      name: 'Biznes günü',
      body: 'Restoran gecə saat 2-yə qədər işləyirsə, gecə yarısından sonrakı sifarişlər əvvəlki günün hesabına yazılır. Hər şirkət öz saat qurşağı və iş saatları ilə qurulur, ona görə rəqəmlər real iş gününə uyğun gəlir.',
    },
    {
      name: 'Ödəniş üsullarının bölgüsü',
      body: 'Nağd və kart satışının nisbəti ayrıca görünür — həm planlaşdırma, həm də kassa üzləşməsi üçün.',
    },
    {
      name: 'Excel ixracı',
      body: 'Sifarişlər, menyu və analiz cədvəli bir kliklə Excel faylına çıxır. Mühasibə göndərmək üçün əl ilə heç nə köçürmək lazım deyil.',
    },
  ],
  faqs: [
    {
      q: 'Mənfəəti necə hesablayır?',
      a: 'Hər məhsulun maya dəyərindən. Maya dəyərini əl ilə yaza, yaxud resept qurub anbardakı real ingredient qiymətindən avtomatik aldıra bilərsiniz.',
    },
    {
      q: 'Gecə yarısından sonrakı satışlar hansı günə yazılır?',
      a: 'Şirkətin iş saatlarına görə. Bağlanış saatı açılışdan əvvəldirsə — məsələn 10:00–04:00 — gecə yarısından sonrakı sifarişlər əvvəlki iş gününə aid edilir.',
    },
    {
      q: 'Hesabatları Excel-ə çıxara bilərəmmi?',
      a: 'Bəli. Sifarişlər, menyu və analiz cədvəli bir düymə ilə .xlsx faylı kimi yüklənir.',
    },
  ],
};

// ─── 6. Anbar ─────────────────────────────────────────────────────────────────
// Source: components/AnbarPanel.tsx (SUBS: warehouses…recipes)
const INVENTORY: Feature = {
  slug: 'anbar',
  nav: 'Anbar',
  h1: 'Anbar, reseptlər və maya dəyəri',
  title: 'Restoran anbar proqramı və reseptlər',
  description:
    'Anbar qalıqları, tədarükçülər və borclar, bazarlıqlar, transferlər, silinmələr və reseptlər — yeməyin maya dəyəri ingredientdən avtomatik çıxır.',
  tagline: 'Qalıqlar, tədarükçülər, reseptlər — maya dəyəri ingredientdən çıxır.',
  intro:
    'Restoranın pulu ən çox anbarda itir: qalıq bilinmir, tədarükçüyə nə qədər borc olduğu dəftərdə qalır, xarab olan məhsul isə heç yerdə yazılmır. Anbar modulu bunların hamısını bir yerə yığır. Ən vacibi isə reseptlərdir: yeməyin hansı ingredientdən nə qədər getdiyini yazanda, maya dəyəri real alış qiymətindən özü hesablanır — və mənfəət hesabatı nəhayət doğru olur.',
  points: [
    {
      name: 'Bir neçə anbar',
      body: 'Mətbəx anbarı, bar anbarı, əsas anbar — hər biri ayrıca qalığı ilə. Hansı məhsulun harada olduğu həmişə bəllidir.',
    },
    {
      name: 'Qalıqlar',
      body: 'Hər məhsulun hər anbardakı qalığı canlı görünür. Axtarış sahəsi ilə uzun siyahıda saniyəyə tapırsınız.',
    },
    {
      name: 'Tədarükçülər və borc',
      body: 'Hər tədarükçü üçün nə alındığı və nə qədər borc qaldığı ayrıca izlənir. Ödəniş edəndə borc avtomatik azalır — dəftər saxlamağa ehtiyac qalmır.',
    },
    {
      name: 'Bazarlıqlar',
      body: 'Alış sənədi bir ekranda yığılır: hansı məhsul, nə qədər, hansı qiymətə, nə qədəri ödənilib. Qalıq və orta alış qiyməti həmin an yenilənir.',
    },
    {
      name: 'Anbarlar arası transfer',
      body: 'Əsas anbardan mətbəxə məhsul köçürəndə qeydlə yazılır. İki anbarın qalığı özü düzəlir, məhsul isə yolda “itmir”.',
    },
    {
      name: 'Səbəbli silinmələr',
      body: 'Xarab olan, sınan və ya işçi yeməyinə gedən məhsul səbəbi ilə silinir. Ay sonunda itkinin nə qədər olduğunu və nədən yarandığını görürsünüz.',
    },
    {
      name: 'Reseptlər',
      body: 'Yeməyin tərkibini yazırsınız — 200 qram ət, 150 qram kartof, 20 qram yağ. Sistem maya dəyərini anbardakı real qiymətdən hesablayır. Tədarükçü qiyməti qaldıranda yeməyin marjası dərhal dəyişir.',
    },
    {
      name: 'Tədarükçüyə ödənişlər',
      body: 'Hər ödəniş məbləği və qeydi ilə yazılır, cari borc həmişə göz önündədir.',
    },
  ],
  faqs: [
    {
      q: 'Resept qurmasam maya dəyərini yaza bilərəmmi?',
      a: 'Bəli. Hər məhsul üçün maya dəyərini əl ilə də yazmaq olar — mənfəət hesabatı yenə işləyir. Resept sadəcə bu rəqəmi avtomatik və həmişə güncəl saxlayır.',
    },
    {
      q: 'Neçə anbar yarada bilərəm?',
      a: 'İstədiyiniz qədər. Mətbəx, bar, əsas anbar — hər birinin qalığı ayrıca izlənir və aralarında transfer etmək olar.',
    },
    {
      q: 'Tədarükçü borclarını izləyirmi?',
      a: 'Bəli. Bazarlıqda ödənilməyən məbləğ borc kimi qalır, ödəniş etdikcə azalır və hər tədarükçünün cari borcu siyahıda görünür.',
    },
  ],
};

// ─── 7. Menyu idarəetməsi ─────────────────────────────────────────────────────
// Source: app/admin/page.tsx (menu tab), lib/excel.ts
const MENU: Feature = {
  slug: 'menyu-idareetmesi',
  nav: 'Menyu',
  h1: 'Menyu idarəetməsi',
  title: 'Menyu idarəetməsi və Excel idxalı',
  description:
    'Kateqoriyalar, şəkillər, variantlar və maya dəyəri. Mövcud menyunu Excel-dən bir dəfəyə idxal edin, silinən məhsulu zibil qutusundan qaytarın.',
  tagline: 'Menyunu Excel-dən idxal edin, qiyməti bir ekrandan idarə edin.',
  intro:
    'Menyu dəyişəndə qiyməti üç yerdə düzəltmək lazım gəlmir: menyu bir yerdədir və QR menyu, satıcı terminalı, mətbəx ekranı eyni mənbədən oxuyur. Kateqoriyaları sürükləyib sıralayırsınız, məhsula şəkil qoyursunuz, mövsümi yeməyi silmədən gizlədirsiniz. Onsuz da Excel-də olan menyunu isə əl ilə köçürmək əvəzinə bir dəfəyə idxal edirsiniz.',
  points: [
    {
      name: 'Kateqoriyalar və sıralama',
      body: 'Kateqoriyaları və içindəki məhsulları sürükləməklə sıralayırsınız. Müştəri QR menyuda tam olaraq sizin qurduğunuz ardıcıllığı görür.',
    },
    {
      name: 'Şəkillər',
      body: 'Hər məhsula şəkil yükləyirsiniz. Şəkilli menyu daha çox satır, xüsusən yeni müştəri üçün.',
    },
    {
      name: 'Gizlətmə',
      body: 'Mövsümü bitən və ya müvəqqəti bitmiş yeməyi silmək lazım deyil — gizlədirsiniz. Menyudan çıxır, tarixçədə və hesabatlarda qalır.',
    },
    {
      name: 'Variantlar və marja',
      body: 'Bir məhsulun bir neçə variantı olur, hər birinin öz qiyməti və maya dəyəri var. Marja variant yazılan an ekranda hesablanır.',
    },
    {
      name: 'Excel-dən idxal',
      body: 'Hazır menyunu Excel faylından yükləyirsiniz. Sütun adları sərbəst yazıla bilər — sistem böyük-kiçik hərfi, Azərbaycan hərflərini və ingilis qarşılıqlarını özü tanıyır. İdxaldan əvvəl neçə məhsulun yeni, neçəsinin yenilənəcəyini göstərir.',
    },
    {
      name: 'Excel-ə ixrac',
      body: 'Menyunu istənilən an .xlsx faylı kimi yükləyib redaktə edə və geri idxal edə bilərsiniz.',
    },
    {
      name: 'Zibil qutusu',
      body: 'Səhvən silinən məhsul və kateqoriya birbaşa yox olmur — zibil qutusuna düşür və oradan qaytarıla bilir.',
    },
    {
      name: 'Məhsulun kopyalanması',
      body: 'Oxşar yeməyi sıfırdan yazmaq əvəzinə mövcud olanı kopyalayıb adını dəyişirsiniz.',
    },
  ],
  faqs: [
    {
      q: 'Mövcud menyumu necə köçürə bilərəm?',
      a: 'Excel faylı kimi idxal edin. Sütun adlarını dəqiq yazmaq şərt deyil — sistem “ad/name”, “qiymət/price” kimi qarşılıqları özü tanıyır.',
    },
    {
      q: 'Səhvən sildiyim məhsulu qaytara bilərəmmi?',
      a: 'Bəli. Silinən məhsul və kateqoriyalar zibil qutusuna düşür və oradan bərpa olunur.',
    },
    {
      q: 'Qiyməti dəyişəndə köhnə sifarişlər dəyişirmi?',
      a: 'Xeyr. Sifarişdəki qiymət satış anındakı qiymətdir və sonradan dəyişmir, ona görə keçmiş hesabatlar sabit qalır.',
    },
  ],
};

// ─── 8. Masalar və zal planı ──────────────────────────────────────────────────
// Source: app/admin/page.tsx (tables tab)
const TABLES: Feature = {
  slug: 'masalar',
  nav: 'Masalar',
  h1: 'Masalar və zal planı',
  title: 'Masa izlənməsi və zal planı',
  description:
    'Bütün masaların statusu bir baxışda. Zal planını real düzülüşünüzə uyğun qurun — masaları sürükləyin, forma və tutum verin.',
  tagline: 'Bütün masaların statusu bir baxışda, real zal planı üzərində.',
  intro:
    'Hansı masa doludur, hansında sifariş neçə dəqiqədir gözləyir — bunu bilmək üçün zalı gəzmək lazım deyil. Masalar ekranı bütün zalın vəziyyətini bir baxışda göstərir. Planı sizin real düzülüşünüzə uyğun qurursunuz: masaları sürükləyib yerləşdirirsiniz, formasını və tutumunu yazırsınız, ona görə ekrandakı şəkil zalın özünə oxşayır.',
  points: [
    {
      name: 'Real vaxtda status',
      body: 'Dolu masalar dərhal işarələnir. Yeni ofisiant da hansı masada iş getdiyini soruşmadan görür.',
    },
    {
      name: 'Zal planı redaktoru',
      body: 'Masaları sürükləyərək zalın real düzülüşünü qurursunuz. Plan bir dəfə qurulur və hamı eyni şəkli görür.',
    },
    {
      name: 'Forma və tutum',
      body: 'Masa üfüqi, şaquli və ya dairəvi ola bilər, hər birinə neçə nəfərlik olduğunu yazırsınız. Plan zalın özünə oxşayanda ofisiant onu tez oxuyur.',
    },
    {
      name: 'Plan və siyahı görünüşü',
      body: 'Böyük zal üçün plan, kiçik məkan üçün sadə siyahı — hansı rahatdırsa onu seçirsiniz.',
    },
    {
      name: 'Masaya QR kod',
      body: 'Hər masanın öz QR kodu var. Çap edib masaya qoyursunuz, sifariş avtomatik həmin masaya yazılır.',
    },
    {
      name: 'Aktiv masanın qorunması',
      body: 'Açıq sifarişi olan masanı silmək olmur. Beləliklə hesab “havada qalmır”.',
    },
  ],
  faqs: [
    {
      q: 'Masa sayında limit varmı?',
      a: 'Xeyr, limitsizdir. İstədiyiniz qədər masa əlavə edə bilərsiniz.',
    },
    {
      q: 'Zalım iki mərtəbədir — plan işləyəcəkmi?',
      a: 'Bəli. Masaları plan üzərində istədiyiniz kimi qruplaşdırıb yerləşdirə, adlarını da ona uyğun verə bilərsiniz.',
    },
  ],
};

// ─── 9. Əməkdaşlar və təhlükəsizlik ───────────────────────────────────────────
// Source: app/admin/page.tsx (users + logins tabs), app/api/verify-pin, lib/auth.ts
const STAFF: Feature = {
  slug: 'emekdaslar',
  nav: 'Əməkdaşlar',
  h1: 'Əməkdaşlar, PIN giriş və təhlükəsizlik',
  title: 'Əməkdaş rolları, PIN giriş və giriş qeydləri',
  description:
    'Admin, ofisiant, satıcı və sex əməkdaşı üçün ayrı panellər. Ümumi terminalda PIN ilə sürətli giriş, zəif PIN bloklanması və tam giriş qeydləri.',
  tagline: 'Rollar, PIN giriş və kim-haradan girdiyinin tam qeydi.',
  intro:
    'Hər əməkdaşa bütün sistemi açmaq lazım deyil. Rollar hər kəsə yalnız öz işini göstərir: satıcı sifariş qəbul edir, sex əməkdaşı öz yeməklərini görür, admin isə hesabatlara və tənzimləmələrə çıxır. Bir terminalı bütün növbə paylaşırsa, hər dəfə şifrə yazmaq əvəzinə qısa PIN kifayətdir — və hər girişin kim tərəfindən, haradan edildiyi yazılır.',
  points: [
    {
      name: 'Rollara görə panellər',
      body: 'Admin, satıcı və sex əməkdaşı ayrı-ayrı panellərə düşür. Heç kim öz işinə aid olmayan ekranı görmür.',
    },
    {
      name: 'PIN giriş',
      body: 'Ümumi kassa terminalında hər əməkdaş öz qısa PIN-i ilə girir. Şifrə yazmağa vaxt itmir, satış isə kimin adına yazıldığı bəlli olur.',
    },
    {
      name: 'Zəif PIN bloklanması',
      body: 'Sistem 1234 kimi asan təxmin edilən PIN-lərin qurulmasına icazə vermir.',
    },
    {
      name: 'Giriş qeydləri',
      body: 'Sistemə kim, nə vaxt, hansı IP ünvanından və hansı cihazdan daxil olub — hamısı cədvəldə qalır. Şübhəli giriş varsa, görünür.',
    },
    {
      name: 'Satıcı terminal linkinin ləğvi',
      body: 'Ofisiantın telefonundakı terminal linki işdən çıxan gün bir kliklə yenilənir. Köhnə link dərhal işləməz olur.',
    },
    {
      name: 'Əməkdaşın tarixçəsi qalır',
      body: 'Əməkdaş silinsə də, keçmiş sifarişlərdə adı qalır. Köhnə hesabatlar boşalmır.',
    },
    {
      name: 'Şirkət məlumatlarının ayrılığı',
      body: 'Hər şirkət yalnız öz datasını görür. Bu, tənzimləmə ilə deyil, verilənlər bazası səviyyəsində təmin olunur.',
    },
  ],
  faqs: [
    {
      q: 'Bir terminalda bir neçə ofisiant işləyə bilərmi?',
      a: 'Bəli. Hər biri öz PIN-i ilə girir, sifariş isə həmin əməkdaşın adına yazılır — satıcı statistikası buna görə dəqiq olur.',
    },
    {
      q: 'Ofisiant işdən çıxsa, girişini necə bağlayıram?',
      a: 'Əməkdaşı silmək və ya terminal linkini yeniləmək kifayətdir. Köhnə link və PIN dərhal işləməz olur, keçmiş sifarişlərdə isə adı qalır.',
    },
    {
      q: 'Məlumatlar haradadır?',
      a: 'Supabase infrastrukturunda, şifrəli formada saxlanılır. Hər şirkətin datası verilənlər bazası səviyyəsində bir-birindən ayrılıb.',
    },
  ],
};

export const FEATURES: Feature[] = [
  QR_MENU,
  KITCHEN,
  PRINTING,
  CASH,
  REPORTS,
  INVENTORY,
  MENU,
  TABLES,
  STAFF,
];

export function featureBySlug(slug: string): Feature | undefined {
  return FEATURES.find(f => f.slug === slug);
}

// The FAQ shown on the landing page: the general questions a first-time visitor asks,
// before they care about any single module.
export const HOME_FAQS: FeatureFaq[] = [
  {
    q: 'Possiblle kimə uyğundur?',
    a: 'Kiçik kafedən böyük restorana qədər hər ölçülü müəssisəyə. QR menyu ilə başlayıb sonradan kassa, anbar və hesabatları işə salmaq olar — hamısını birdən qurmaq şərt deyil.',
  },
  {
    q: 'Müştəri tətbiq yükləməlidir?',
    a: 'Xeyr. Müştəri sadəcə QR kodu skan edir və sifarişi brauzer üzərindən verir. Sizin əməkdaşlarınız üçün də yükləmə tələb olunmur — sistem istənilən telefonda, planşetdə və kompüterdə brauzerdə işləyir.',
  },
  {
    q: 'Quraşdırma nə qədər çəkir?',
    a: 'Menyunu Excel-dən idxal edirsiniz, masaları yaradırsınız, QR kodları çap edirsiniz — bir gün ərzində işə düşmək mümkündür. Çek printeri və anbar sonradan da qoşula bilər.',
  },
  {
    q: 'Neçə masa dəstəklənir?',
    a: 'Limitsiz. Masa, məhsul və əməkdaş sayında məhdudiyyət yoxdur.',
  },
  {
    q: 'Çek printeri mütləqdirmi?',
    a: 'Xeyr. Printer olmadan da sifarişlər mətbəx ekranında görünür və səslə xəbər verilir. Printeriniz varsa, ESC/POS dəstəkləyən termal printerlər birbaşa brauzerdən işləyir.',
  },
  {
    q: 'Məlumatlar haradadır?',
    a: 'Supabase infrastrukturunda, şifrəli formada saxlanılır. Hər şirkət yalnız öz datasını görür.',
  },
];
