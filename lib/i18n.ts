// All UI strings in Arabic. Anime titles stay as scraped.
// Importers use `t` so we can swap to a locale switcher later if needed.

export const ar = {
  // Common
  appName: "بانتوفة",
  cancel: "إلغاء",
  loading: "جارٍ التحميل…",
  retry: "إعادة المحاولة",
  back: "رجوع",
  save: "حفظ",
  remove: "حذف",
  episode: "الحلقة",
  episodes: "الحلقات",
  episodeCount: (n: number) => `${n} ${n === 1 ? "حلقة" : "حلقات"}`,

  // Auth — welcome
  welcomeTagline: "أنمي بلا حدود.",
  feature1: "زامِن قائمتك عبر أجهزتك",
  feature2: "احفظ المفضّلة وتابع من حيث توقّفت",
  feature3: "تسجيل دخول آمن بحساب Google",
  ctaCreate: "إنشاء حساب",
  ctaHaveAccount: "لديّ حساب بالفعل",

  // Auth — login
  welcomeBack: "أهلًا بعودتك",
  loginSub: "سجّل الدخول لمزامنة قائمتك والمتابعة من حيث توقّفت.",
  continueWithGoogle: "المتابعة بحساب Google",
  signUpWithGoogle: "إنشاء حساب بـ Google",
  or: "أو",
  email: "البريد الإلكتروني",
  password: "كلمة المرور",
  passwordPlaceholder: "••••••••",
  emailPlaceholder: "you@example.com",
  forgotPassword: "هل نسيت كلمة المرور؟",
  signIn: "تسجيل الدخول",
  signUp: "إنشاء حساب",
  noAccount: "ليس لديك حساب؟",
  haveAccount: "لديك حساب بالفعل؟",
  emailPasswordRequired: "البريد وكلمة المرور مطلوبان",
  signInCancelled: "تم إلغاء تسجيل الدخول",
  signInFailed: "فشل تسجيل الدخول",
  authNotConfigured: "خدمة المصادقة غير مهيّأة",

  // Auth — register
  createAccount: "إنشاء حساب",
  signupSub: "احفظ مفضّلتك وتابع من حيث توقّفت على أي جهاز.",
  passwordMin6: "ستة أحرف على الأقل",
  confirmPassword: "تأكيد كلمة المرور",
  passwordsDontMatch: "كلمتا المرور غير متطابقتين",
  passwordTooShort: "كلمة المرور يجب أن تكون 6 أحرف على الأقل",
  checkInbox: "افحص بريدك",
  confirmEmailSent: (e: string) => `أرسلنا رابط التحقق إلى ${e}. اضغط عليه لتفعيل حسابك.`,
  goToSignIn: "اذهب إلى تسجيل الدخول",

  // Auth — forgot
  forgotTitle: "استعادة كلمة المرور",
  forgotSub: "أدخل بريدك وسنرسل لك رابط إعادة التعيين.",
  sendResetLink: "أرسل رابط الاستعادة",
  resetSent: "تم الإرسال — تفقّد بريدك.",

  // Home
  continueWatching: "تابع المشاهدة",
  trendingNow: "الأكثر رواجًا",
  recentlyUpdated: "حلقات جديدة",
  tvSeries: "مسلسلات",
  movies: "أفلام",
  categories: "التصنيفات",
  seeAll: (n: number) => `عرض الكل (${n})`,
  seeAllShort: "عرض الكل",
  watchNow: "شاهد الآن",
  myList: "قائمتي",
  newBadge: "جديد",
  minLeft: (m: number) => `${m} د متبقّية`,

  // Detail page
  watchEpisode: "شاهد هذه الحلقة",
  openAnimePage: "افتح صفحة الأنمي",
  tabEpisodes: "الحلقات",
  tabRelated: "ذات صلة",
  tabInfo: "تفاصيل",
  readMore: "اقرأ المزيد",
  showLess: "عرض أقل",
  noEpisodes: "لا توجد حلقات متاحة",
  noRelated: "لا توجد أنميات مشابهة",
  noInfo: "لا توجد تفاصيل متاحة",
  loadingInfo: "جارٍ تحميل التفاصيل…",
  bothSourcesMerged: "تمّ دمج المصدرين",
  sortNewest: "الأحدث",
  sortOldest: "الأقدم",
  failedToLoad: "تعذّر التحميل",
  notFound: "غير موجود",
  goBack: "ارجع",
  markedAsWatched: "تمّ التحديد كمُشاهَدة",
  unmarkedAsWatched: "أُلغي تحديد المشاهدة",
  watchedBadge: "مُشاهَدة",
  tapToToggleWatched: "اضغط مطوّلًا لتبديل حالة المشاهدة",
  titleCopied: "تم نسخ العنوان",

  // Next-episode countdown
  nextEpIn: (n: number) => `الحلقة ${n} بعد`,
  airingNow: (n: number) => `الحلقة ${n} متوفّرة الآن`,
  cdDays: "ي",
  cdHours: "س",
  cdMins: "د",
  cdSecs: "ث",

  // My List (favorites)
  myListTitle: "قائمتي",
  currentlyWatching: "أتابع حاليًا",
  planToWatch: "خطّتي للمشاهدة",
  watchingDesc: "ما تتابعه الآن",
  plannedDesc: "احفظه للاحقًا",
  addToList: "أضف إلى قائمتي",
  saveWhere: (title: string) => `أين تريد حفظ ${title}؟`,
  emptyList: "قائمتك فارغة",
  emptyListSub: "ابحث عن أنمي وأضِفه إلى قائمتك.",

  // Search
  searchPlaceholder: "ابحث عن أنمي…",
  searchSub: "اكتب اسم الأنمي للبدء",
  noResults: "لا توجد نتائج",

  // Watch / Player
  loadingServers: "جاري تحميل المصادر…",
  noServersFound: "لا توجد مصادر متاحة. اضغط لإعادة المحاولة.",
  switchServer: "تغيير المصدر",
  nextEpisode: "الحلقة التالية",
  prevEpisode: "الحلقة السابقة",
  resolving: "جاري التحضير…",
  loadingPlayer: "جاري تحميل المشغّل…",
  fallbackPlayer: "المشغّل الاحتياطي",

  // Settings / sign out
  signOut: "تسجيل الخروج",
  settings: "الإعدادات",
};

export const t = ar;
export type Translations = typeof ar;
