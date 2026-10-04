import type { LocaleCode } from "../i18n/locales";

export type LandingMaturity = "live" | "testnet" | "paper" | "preview" | "planned" | "after_gate";

type LocaleText = {
  nav: {
    product: string;
    loop: string;
    methodology: string;
    trust: string;
    beta: string;
    menu: string;
    language: string;
  };
  heroBody: string;
  icp: string;
  modeRelationship: string;
  primary: string;
  secondary: string;
  riskState: string;
  riskReason: string;
  loopTitle: string;
  loopBody: string;
  loopScope: string;
  capabilityTitle: string;
  capabilityBody: string;
  analystTitle: string;
  analystBody: string;
  trustTitle: string;
  trustBody: string;
  eligibility: string;
  finalTitle: string;
  finalBody: string;
  riskDisclosure: string;
  terms: string;
  privacy: string;
};

export type LandingCopy = LocaleText & {
  // The landing speaks to individual users, so it carries the company category,
  // not the Guard developer-surface category.
  category: "Risk, Strategy & Evidence OS";
  heroTitle: "Plan. Prove. Improve.";
  trustLine: "Non-custodial. Paper-first. Human-authorized. No profit promises.";
  maturity: Record<LandingMaturity, string>;
};

const T: Record<LocaleCode, LocaleText> = {
  en: {
    nav: { product: "Product", loop: "Decision loop", methodology: "Methodology", trust: "Trust", beta: "Check access", menu: "Open menu", language: "Language" },
    heroBody: "A disciplined risk operating system for active traders. Structure a testable plan, inspect scoped readiness evidence, choose a human-authorized disposition, and review the decision without surrendering custody.",
    icp: "For active self-directed traders who use charts and one or more venues but lack one consistent planning, risk, decision, and review process.",
    modeRelationship: "Simple Mode shows one honest next decision. Pro Mode reveals more sources, assumptions, freshness, limitations, and specialist packs without changing the underlying truth.",
    primary: "Open access checklist", secondary: "Read the methodology",
    riskState: "Caution", riskReason: "Reference market closed (estimated). The sample quote is 0.84% above the latest feed.",
    loopTitle: "One disciplined loop. Honest maturity at every step.",
    loopBody: "Ryntra connects intent, evidence, human authority and review. Shipped pieces stay visibly separate from paper, preview and planned work.",
    loopScope: "The complete StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord loop is the north star. It is not shipped end to end.",
    capabilityTitle: "Current proof, without roadmap theatre.",
    capabilityBody: "Maturity, mode, provider scope, evidence freshness and limitation stay together. “Live” never means universally available or safe.",
    analystTitle: "An analyst note, never a verdict.",
    analystBody: "Strategy Lab is a local preview. Where AI analysis is available, AI may organize context or propose a draft; it never approves readiness, authorizes a wallet, creates a receipt, scores a review or executes. Manual deterministic analysis remains available.",
    trustTitle: "Evidence informs. The human decides.",
    trustBody: "Ryntra is non-custodial and paper-first. Unknown, stale or conflicting evidence remains visibly unresolved.",
    eligibility: "Venue access, instrument eligibility and route readiness are separate checks. A capability label is not personal eligibility.",
    finalTitle: "Make the decision legible before the wallet prompt.",
    finalBody: "Start with the public model, then enter the beta to inspect the currently supported scope.",
    riskDisclosure: "Trading and tokenized assets involve risk. Outputs are informational, not investment advice. Ryntra does not hold funds or obtain withdrawal authority.",
    terms: "Terms", privacy: "Privacy",
  },
  uk: {
    nav: { product: "Продукт", loop: "Цикл рішення", methodology: "Методологія", trust: "Довіра", beta: "Перевірити доступ", menu: "Відкрити меню", language: "Мова" },
    heroBody: "Дисциплінована операційна система ризику для активних трейдерів. Сформулюй перевірний план, оціни докази готовності, обери дозволену людиною дію та переглянь рішення без передачі активів.",
    icp: "Для активних самостійних трейдерів, які користуються графіками й одним або кількома venue, але не мають єдиного процесу плану, ризику, рішення та review.",
    modeRelationship: "Simple Mode показує одне чесне наступне рішення. Pro Mode відкриває більше джерел, припущень, свіжості, обмежень і specialist packs, не змінюючи базову правду.",
    primary: "Відкрити чекліст доступу", secondary: "Прочитати методологію",
    riskState: "Обережно", riskReason: "Референсний ринок імовірно закритий. Тестове котирування на 0,84% вище останнього feed.",
    loopTitle: "Один дисциплінований цикл. Чесна зрілість кожного кроку.",
    loopBody: "Ryntra поєднує намір, докази, людське рішення та review. Готові частини відокремлено від paper, preview і planned.",
    loopScope: "Повний цикл StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord є north star і ще не shipped наскрізно.",
    capabilityTitle: "Поточний proof без театру roadmap.",
    capabilityBody: "Зрілість, режим, provider scope, свіжість доказів і обмеження показані разом. «Live» не означає доступно всім або безпечно.",
    analystTitle: "Аналітична записка, а не вердикт.",
    analystBody: "Strategy Lab є локальним preview. Де AI-аналіз доступний, AI може структурувати контекст або запропонувати draft; він не затверджує readiness, не авторизує гаманець, не створює receipt, не оцінює review і не виконує. Ручний аналіз залишається.",
    trustTitle: "Докази інформують. Людина вирішує.",
    trustBody: "Ryntra non-custodial і paper-first. Невідомі, застарілі чи суперечливі дані залишаються видимо невирішеними.",
    eligibility: "Доступ до venue, eligibility інструмента та готовність route — окремі перевірки. Capability не є персональним дозволом.",
    finalTitle: "Зроби рішення зрозумілим до wallet prompt.",
    finalBody: "Почни з публічної моделі, а потім відкрий beta, щоб побачити реально підтримуваний scope.",
    riskDisclosure: "Торгівля й токенізовані активи пов’язані з ризиком. Матеріали мають інформаційний характер і не є інвестиційною порадою. Ryntra не зберігає кошти й не має права на виведення.",
    terms: "Умови", privacy: "Приватність",
  },
  ru: {
    nav: { product: "Продукт", loop: "Цикл решения", methodology: "Методология", trust: "Доверие", beta: "Проверить доступ", menu: "Открыть меню", language: "Язык" },
    heroBody: "Дисциплинированная операционная система риска для активных трейдеров. Сформулируйте проверяемый план, изучите доказательства готовности, выберите действие с разрешением человека и разберите решение без передачи активов.",
    icp: "Для активных самостоятельных трейдеров, которые используют графики и один или несколько venue, но не имеют единого процесса плана, риска, решения и review.",
    modeRelationship: "Simple Mode показывает одно честное следующее решение. Pro Mode раскрывает больше источников, допущений, свежести, ограничений и specialist packs, не меняя базовую правду.",
    primary: "Открыть чек-лист доступа", secondary: "Прочитать методологию",
    riskState: "Осторожно", riskReason: "Референсный рынок предположительно закрыт. Тестовая котировка на 0,84% выше последнего feed.",
    loopTitle: "Один дисциплинированный цикл. Честная зрелость каждого шага.",
    loopBody: "Ryntra соединяет намерение, доказательства, решение человека и review. Готовые части отделены от paper, preview и planned.",
    loopScope: "Полный цикл StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord — north star и пока не shipped полностью.",
    capabilityTitle: "Текущий proof без театра roadmap.",
    capabilityBody: "Зрелость, режим, provider scope, свежесть доказательств и ограничения показаны вместе. «Live» не означает доступно всем или безопасно.",
    analystTitle: "Аналитическая записка, не вердикт.",
    analystBody: "Strategy Lab — локальный preview. Там, где AI-анализ доступен, AI может структурировать контекст или предложить draft; он не утверждает readiness, не авторизует кошелёк, не создаёт receipt, не оценивает review и не исполняет. Ручной анализ остаётся.",
    trustTitle: "Доказательства информируют. Человек решает.",
    trustBody: "Ryntra non-custodial и paper-first. Неизвестные, устаревшие или противоречивые данные остаются явно нерешёнными.",
    eligibility: "Доступ к venue, eligibility инструмента и готовность route — разные проверки. Capability не является личным разрешением.",
    finalTitle: "Сделайте решение понятным до wallet prompt.",
    finalBody: "Начните с публичной модели, затем откройте beta и изучите реально поддерживаемый scope.",
    riskDisclosure: "Торговля и токенизированные активы связаны с риском. Материалы носят информационный характер и не являются инвестиционным советом. Ryntra не хранит средства и не получает полномочий на вывод.",
    terms: "Условия", privacy: "Конфиденциальность",
  },
  es: {
    nav: { product: "Producto", loop: "Ciclo de decisión", methodology: "Metodología", trust: "Confianza", beta: "Comprobar acceso", menu: "Abrir menú", language: "Idioma" },
    heroBody: "Un sistema operativo disciplinado de riesgo para traders activos. Estructura un plan comprobable, revisa evidencia de preparación, elige una acción autorizada por una persona y analiza la decisión sin ceder la custodia.",
    icp: "Para traders activos y autónomos que usan gráficos y uno o varios venues, pero carecen de un proceso coherente de planificación, riesgo, decisión y revisión.",
    modeRelationship: "Simple Mode muestra una siguiente decisión honesta. Pro Mode revela más fuentes, supuestos, frescura, límites y módulos especializados sin cambiar la verdad subyacente.",
    primary: "Abrir lista de acceso", secondary: "Leer la metodología",
    riskState: "Precaución", riskReason: "Mercado de referencia cerrado (estimado). La cotización de muestra está 0,84 % sobre el último feed.",
    loopTitle: "Un ciclo disciplinado. Madurez honesta en cada paso.",
    loopBody: "Ryntra conecta intención, evidencia, autoridad humana y revisión. Lo disponible se separa de paper, preview y planned.",
    loopScope: "El ciclo completo StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord es el objetivo y aún no está lanzado de extremo a extremo.",
    capabilityTitle: "Prueba actual, sin teatro de roadmap.",
    capabilityBody: "Madurez, modo, alcance, frescura y límite aparecen juntos. «Live» no significa universal ni seguro.",
    analystTitle: "Una nota analítica, nunca un veredicto.",
    analystBody: "Strategy Lab es una vista previa local. Cuando el análisis con AI está disponible, puede ordenar contexto o proponer un draft; nunca aprueba readiness, autoriza wallets, crea receipts, califica reviews ni ejecuta. El análisis manual sigue disponible.",
    trustTitle: "La evidencia informa. La persona decide.",
    trustBody: "Ryntra es non-custodial y paper-first. Lo desconocido, obsoleto o contradictorio sigue visible.",
    eligibility: "Acceso al venue, elegibilidad del instrumento y readiness de route son controles distintos. Capability no es permiso personal.",
    finalTitle: "Aclara la decisión antes del wallet prompt.",
    finalBody: "Empieza con el modelo público y abre la beta para ver el alcance realmente compatible.",
    riskDisclosure: "El trading y los activos tokenizados conllevan riesgo. Los resultados son informativos, no asesoramiento de inversión. Ryntra no mantiene fondos ni obtiene autoridad de retiro.",
    terms: "Términos", privacy: "Privacidad",
  },
  "pt-BR": {
    nav: { product: "Produto", loop: "Ciclo de decisão", methodology: "Metodologia", trust: "Confiança", beta: "Verificar acesso", menu: "Abrir menu", language: "Idioma" },
    heroBody: "Um sistema operacional disciplinado de risco para traders ativos. Estruture um plano testável, examine evidências de prontidão, escolha uma ação autorizada por uma pessoa e revise a decisão sem abrir mão da custódia.",
    icp: "Para traders ativos e autônomos que usam gráficos e um ou mais venues, mas não têm um processo consistente de planejamento, risco, decisão e revisão.",
    modeRelationship: "Simple Mode mostra uma próxima decisão honesta. Pro Mode revela mais fontes, premissas, atualização, limites e módulos especializados sem mudar a verdade subjacente.",
    primary: "Abrir checklist de acesso", secondary: "Ler a metodologia",
    riskState: "Cautela", riskReason: "Mercado de referência fechado (estimado). Cotação de amostra 0,84% acima do último feed.",
    loopTitle: "Um ciclo disciplinado. Maturidade honesta em cada etapa.",
    loopBody: "Ryntra conecta intenção, evidência, autoridade humana e revisão. O que existe fica separado de paper, preview e planned.",
    loopScope: "O ciclo completo StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord é o objetivo e ainda não foi lançado de ponta a ponta.",
    capabilityTitle: "Prova atual, sem teatro de roadmap.",
    capabilityBody: "Maturidade, modo, escopo, atualização e limite aparecem juntos. «Live» não significa universal ou seguro.",
    analystTitle: "Uma nota analítica, nunca um veredito.",
    analystBody: "Strategy Lab é um preview local. Quando a análise por AI está disponível, ela pode organizar contexto ou sugerir um draft; nunca aprova readiness, autoriza wallet, cria receipt, avalia review ou executa. A análise manual continua disponível.",
    trustTitle: "A evidência informa. A pessoa decide.",
    trustBody: "Ryntra é non-custodial e paper-first. Dados desconhecidos, antigos ou conflitantes ficam visíveis.",
    eligibility: "Acesso ao venue, elegibilidade do instrumento e readiness da route são verificações separadas. Capability não é permissão pessoal.",
    finalTitle: "Deixe a decisão clara antes do wallet prompt.",
    finalBody: "Comece pelo modelo público e abra a beta para ver o escopo realmente compatível.",
    riskDisclosure: "Trading e ativos tokenizados envolvem risco. As saídas são informativas, não aconselhamento de investimento. A Ryntra não mantém fundos nem obtém autoridade de saque.",
    terms: "Termos", privacy: "Privacidade",
  },
  fr: {
    nav: { product: "Produit", loop: "Boucle de décision", methodology: "Méthodologie", trust: "Confiance", beta: "Vérifier l’accès", menu: "Ouvrir le menu", language: "Langue" },
    heroBody: "Un système d’exploitation du risque discipliné pour les traders actifs. Structurez un plan testable, examinez les preuves de préparation, choisissez une action autorisée par un humain et révisez la décision sans céder la garde.",
    icp: "Pour les traders actifs et autonomes qui utilisent des graphiques et un ou plusieurs venues, sans processus cohérent de planification, risque, décision et revue.",
    modeRelationship: "Simple Mode montre une prochaine décision honnête. Pro Mode révèle davantage de sources, hypothèses, fraîcheur, limites et modules spécialisés sans changer la vérité sous-jacente.",
    primary: "Ouvrir la liste d’accès", secondary: "Lire la méthodologie",
    riskState: "Prudence", riskReason: "Marché de référence fermé (estimé). La cotation exemple est 0,84 % au-dessus du dernier feed.",
    loopTitle: "Une boucle disciplinée. Une maturité honnête à chaque étape.",
    loopBody: "Ryntra relie intention, preuves, autorité humaine et revue. Le livré reste séparé de paper, preview et planned.",
    loopScope: "La boucle complète StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord est la cible et n’est pas encore livrée de bout en bout.",
    capabilityTitle: "Preuves actuelles, sans théâtre de roadmap.",
    capabilityBody: "Maturité, mode, périmètre, fraîcheur et limite restent ensemble. « Live » ne signifie ni universel ni sûr.",
    analystTitle: "Une note d’analyste, jamais un verdict.",
    analystBody: "Strategy Lab est un aperçu local. Lorsque l’analyse AI est disponible, elle peut organiser le contexte ou proposer un draft ; elle n’approuve jamais readiness, n’autorise pas le wallet, ne crée pas de receipt, ne note pas review et n’exécute rien. L’analyse manuelle reste disponible.",
    trustTitle: "Les preuves informent. L’humain décide.",
    trustBody: "Ryntra est non-custodial et paper-first. Les données inconnues, anciennes ou contradictoires restent visibles.",
    eligibility: "Accès au venue, éligibilité de l’instrument et readiness de route sont distincts. Capability n’est pas une autorisation personnelle.",
    finalTitle: "Rendez la décision lisible avant le wallet prompt.",
    finalBody: "Commencez par le modèle public, puis ouvrez la bêta pour voir le périmètre réellement pris en charge.",
    riskDisclosure: "Le trading et les actifs tokenisés comportent des risques. Les résultats sont informatifs, pas des conseils en investissement. Ryntra ne détient pas de fonds et n’obtient aucun pouvoir de retrait.",
    terms: "Conditions", privacy: "Confidentialité",
  },
  tr: {
    nav: { product: "Ürün", loop: "Karar döngüsü", methodology: "Metodoloji", trust: "Güven", beta: "Erişimi kontrol et", menu: "Menüyü aç", language: "Dil" },
    heroBody: "Aktif traderlar için disiplinli bir risk işletim sistemi. Test edilebilir bir plan kurun, kapsamlı readiness kanıtını inceleyin, insan onaylı eylem seçin ve saklama yetkisini devretmeden kararı değerlendirin.",
    icp: "Grafikler ve bir veya daha fazla venue kullanan ancak tek bir planlama, risk, karar ve inceleme süreci olmayan aktif, kendi kararını veren traderlar için.",
    modeRelationship: "Simple Mode tek bir dürüst sonraki kararı gösterir. Pro Mode temel gerçeği değiştirmeden daha fazla kaynak, varsayım, güncellik, sınırlama ve uzman paketi açar.",
    primary: "Erişim listesini aç", secondary: "Metodolojiyi oku",
    riskState: "Dikkat", riskReason: "Referans piyasa kapalı (tahmini). Örnek teklif son feed’in %0,84 üzerinde.",
    loopTitle: "Tek disiplinli döngü. Her adımda dürüst olgunluk.",
    loopBody: "Ryntra niyet, kanıt, insan yetkisi ve incelemeyi bağlar. Shipped parçalar paper, preview ve planned’dan ayrılır.",
    loopScope: "Tam StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord döngüsü north star’dır ve uçtan uca shipped değildir.",
    capabilityTitle: "Roadmap tiyatrosu olmadan mevcut kanıt.",
    capabilityBody: "Olgunluk, mod, kapsam, güncellik ve sınır birlikte görünür. «Live» evrensel veya güvenli demek değildir.",
    analystTitle: "Analist notu; asla hüküm değil.",
    analystBody: "Strategy Lab yerel bir preview’dur. AI analizi mevcut olduğunda bağlamı düzenleyebilir veya draft önerebilir; readiness onaylamaz, wallet yetkilendirmez, receipt oluşturmaz, review puanlamaz ve işlem yürütmez. Manuel analiz kalır.",
    trustTitle: "Kanıt bilgilendirir. İnsan karar verir.",
    trustBody: "Ryntra non-custodial ve paper-first’tür. Bilinmeyen, eski veya çelişkili veri görünür kalır.",
    eligibility: "Venue erişimi, araç eligibility ve route readiness ayrı kontrollerdir. Capability kişisel izin değildir.",
    finalTitle: "Wallet prompt’tan önce kararı okunur yapın.",
    finalBody: "Açık modeli inceleyin, sonra gerçekten desteklenen kapsam için betayı açın.",
    riskDisclosure: "Trading ve tokenleştirilmiş varlıklar risklidir. Çıktılar bilgilendirme amaçlıdır, yatırım tavsiyesi değildir. Ryntra fon tutmaz veya para çekme yetkisi edinmez.",
    terms: "Koşullar", privacy: "Gizlilik",
  },
  vi: {
    nav: { product: "Sản phẩm", loop: "Vòng quyết định", methodology: "Phương pháp", trust: "Tin cậy", beta: "Kiểm tra quyền truy cập", menu: "Mở menu", language: "Ngôn ngữ" },
    heroBody: "Hệ điều hành rủi ro có kỷ luật cho trader chủ động. Lập kế hoạch có thể kiểm chứng, xem bằng chứng readiness theo phạm vi, chọn hành động do con người cho phép và đánh giá quyết định mà không giao quyền lưu ký.",
    icp: "Dành cho trader chủ động, tự quyết định, dùng biểu đồ và một hoặc nhiều venue nhưng chưa có quy trình nhất quán cho kế hoạch, rủi ro, quyết định và review.",
    modeRelationship: "Simple Mode hiển thị một quyết định tiếp theo trung thực. Pro Mode mở thêm nguồn, giả định, độ mới, giới hạn và gói chuyên sâu mà không đổi sự thật nền tảng.",
    primary: "Mở danh sách truy cập", secondary: "Đọc phương pháp",
    riskState: "Thận trọng", riskReason: "Thị trường tham chiếu đóng (ước tính). Quote mẫu cao hơn feed gần nhất 0,84%.",
    loopTitle: "Một vòng có kỷ luật. Maturity trung thực ở mỗi bước.",
    loopBody: "Ryntra nối ý định, bằng chứng, quyền của con người và review. Phần shipped tách khỏi paper, preview và planned.",
    loopScope: "Vòng đầy đủ StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord là north star và chưa shipped end-to-end.",
    capabilityTitle: "Bằng chứng hiện tại, không diễn roadmap.",
    capabilityBody: "Maturity, mode, scope, freshness và giới hạn đi cùng nhau. «Live» không có nghĩa phổ quát hay an toàn.",
    analystTitle: "Ghi chú phân tích, không phải phán quyết.",
    analystBody: "Strategy Lab là preview cục bộ. Khi phân tích AI có sẵn, AI có thể sắp xếp bối cảnh hoặc đề xuất draft; AI không duyệt readiness, cấp quyền wallet, tạo receipt, chấm review hay thực thi. Phân tích thủ công vẫn có.",
    trustTitle: "Bằng chứng cung cấp thông tin. Con người quyết định.",
    trustBody: "Ryntra non-custodial và paper-first. Dữ liệu chưa biết, cũ hoặc xung đột vẫn hiển thị.",
    eligibility: "Quyền vào venue, eligibility công cụ và route readiness là kiểm tra riêng. Capability không phải quyền cá nhân.",
    finalTitle: "Làm quyết định rõ trước wallet prompt.",
    finalBody: "Bắt đầu với mô hình công khai rồi mở beta để xem scope thực sự được hỗ trợ.",
    riskDisclosure: "Trading và tài sản token hóa có rủi ro. Kết quả chỉ mang tính thông tin, không phải tư vấn đầu tư. Ryntra không giữ tiền hoặc có quyền rút tiền.",
    terms: "Điều khoản", privacy: "Riêng tư",
  },
  id: {
    nav: { product: "Produk", loop: "Siklus keputusan", methodology: "Metodologi", trust: "Kepercayaan", beta: "Periksa akses", menu: "Buka menu", language: "Bahasa" },
    heroBody: "Sistem operasi risiko yang disiplin untuk trader aktif. Susun rencana yang dapat diuji, tinjau bukti readiness sesuai scope, pilih tindakan dengan izin manusia, dan evaluasi keputusan tanpa menyerahkan custody.",
    icp: "Untuk trader aktif dan mandiri yang memakai chart serta satu atau lebih venue tetapi belum memiliki proses planning, risk, decision, dan review yang konsisten.",
    modeRelationship: "Simple Mode menampilkan satu keputusan berikutnya secara jujur. Pro Mode membuka lebih banyak sumber, asumsi, freshness, limit, dan paket spesialis tanpa mengubah kebenaran dasarnya.",
    primary: "Buka daftar akses", secondary: "Baca metodologi",
    riskState: "Waspada", riskReason: "Pasar referensi tutup (estimasi). Quote sampel 0,84% di atas feed terbaru.",
    loopTitle: "Satu siklus disiplin. Maturity jujur di tiap langkah.",
    loopBody: "Ryntra menghubungkan niat, bukti, otoritas manusia, dan review. Bagian shipped dipisah dari paper, preview, dan planned.",
    loopScope: "Siklus lengkap StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord adalah north star dan belum shipped end-to-end.",
    capabilityTitle: "Bukti saat ini tanpa teater roadmap.",
    capabilityBody: "Maturity, mode, scope, freshness, dan limit tampil bersama. «Live» bukan berarti universal atau aman.",
    analystTitle: "Catatan analis, bukan putusan.",
    analystBody: "Strategy Lab adalah preview lokal. Saat analisis AI tersedia, AI dapat menyusun konteks atau mengusulkan draft; AI tidak menyetujui readiness, memberi izin wallet, membuat receipt, menilai review, atau mengeksekusi. Analisis manual tetap ada.",
    trustTitle: "Bukti memberi informasi. Manusia memutuskan.",
    trustBody: "Ryntra non-custodial dan paper-first. Data unknown, stale, atau conflicting tetap terlihat.",
    eligibility: "Akses venue, eligibility instrumen, dan route readiness adalah pemeriksaan terpisah. Capability bukan izin pribadi.",
    finalTitle: "Buat keputusan jelas sebelum wallet prompt.",
    finalBody: "Mulai dari model publik lalu buka beta untuk melihat scope yang benar-benar didukung.",
    riskDisclosure: "Trading dan aset tokenized berisiko. Hasilnya informatif, bukan nasihat investasi. Ryntra tidak menyimpan dana atau memperoleh wewenang penarikan.",
    terms: "Ketentuan", privacy: "Privasi",
  },
  zh: {
    nav: { product: "产品", loop: "决策循环", methodology: "方法论", trust: "信任", beta: "检查访问资格", menu: "打开菜单", language: "语言" },
    heroBody: "面向活跃交易者的纪律化风险操作系统。建立可检验计划，查看限定范围的 readiness 证据，选择由人授权的处置方式，并在不交出托管权的前提下复盘决策。",
    icp: "面向使用图表和一个或多个 venue、但缺少一致计划、风险、决策与复盘流程的主动型自主交易者。",
    modeRelationship: "Simple Mode 只呈现一个真实的下一步决策；Pro Mode 逐步展示更多来源、假设、新鲜度、限制和专业模块，但不改变底层事实。",
    primary: "打开访问清单", secondary: "阅读方法论",
    riskState: "谨慎", riskReason: "参考市场预计已收盘；示例报价比最新 feed 高 0.84%。",
    loopTitle: "一个纪律化循环，每一步都如实标注成熟度。",
    loopBody: "Ryntra 连接意图、证据、人的权限与复盘。已 shipped 的部分与 paper、preview、planned 明确分开。",
    loopScope: "完整 StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord 是 north star，目前尚未端到端 shipped。",
    capabilityTitle: "当前证据，不演 roadmap。",
    capabilityBody: "成熟度、模式、范围、新鲜度和限制放在一起。「Live」不代表人人可用或安全。",
    analystTitle: "分析师说明，不是裁决。",
    analystBody: "Strategy Lab 是本地 preview。AI 分析可用时，可以整理背景或提出 draft；但不批准 readiness、不授权 wallet、不创建 receipt、不给 review 打分，也不执行。手动分析始终可用。",
    trustTitle: "证据提供信息，人做决定。",
    trustBody: "Ryntra 是 non-custodial、paper-first。未知、过期或冲突的数据会保持可见。",
    eligibility: "Venue 访问、工具 eligibility 与 route readiness 是独立检查。Capability 标签不是个人许可。",
    finalTitle: "在 wallet prompt 前把决策讲清楚。",
    finalBody: "先了解公开模型，再进入测试版查看真正受支持的 scope。",
    riskDisclosure: "交易与代币化资产有风险。输出仅供参考，不构成投资建议。Ryntra 不持有资金，也不取得提款权限。",
    terms: "条款", privacy: "隐私",
  },
  ko: {
    nav: { product: "제품", loop: "결정 루프", methodology: "방법론", trust: "신뢰", beta: "접근 확인", menu: "메뉴 열기", language: "언어" },
    heroBody: "활동적인 트레이더를 위한 규율 중심 리스크 운영체제입니다. 검증 가능한 계획을 세우고 범위가 명확한 readiness 근거를 확인하고 사람이 승인한 처분을 선택한 뒤 custody를 넘기지 않고 결정을 review합니다.",
    icp: "차트와 하나 이상의 venue를 사용하지만 계획, 위험, 결정, review를 잇는 일관된 프로세스가 없는 능동적이고 자기주도적인 trader를 위한 제품입니다.",
    modeRelationship: "Simple Mode는 정직한 다음 결정 하나를 보여 줍니다. Pro Mode는 기본 사실을 바꾸지 않고 출처, 가정, freshness, 제한과 전문 pack을 더 공개합니다.",
    primary: "접근 체크리스트 열기", secondary: "방법론 읽기",
    riskState: "주의", riskReason: "기준 시장이 닫힌 것으로 추정됩니다. 예시 quote가 최신 feed보다 0.84% 높습니다.",
    loopTitle: "하나의 규율 루프. 단계마다 정직한 maturity.",
    loopBody: "Ryntra는 의도, 근거, 사람의 권한과 review를 연결합니다. Shipped 부분은 paper, preview, planned와 분리됩니다.",
    loopScope: "전체 StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord는 north star이며 아직 end-to-end shipped되지 않았습니다.",
    capabilityTitle: "Roadmap 연출 없는 현재 근거.",
    capabilityBody: "Maturity, mode, scope, freshness와 제한을 함께 표시합니다. «Live»는 보편적이거나 안전하다는 뜻이 아닙니다.",
    analystTitle: "분석 메모일 뿐, 판정이 아닙니다.",
    analystBody: "Strategy Lab은 로컬 preview입니다. AI 분석을 사용할 수 있을 때 맥락을 정리하거나 draft를 제안할 수 있지만 readiness 승인, wallet 권한 부여, receipt 생성, review 채점 또는 실행은 하지 않습니다. 수동 분석은 유지됩니다.",
    trustTitle: "근거가 알리고, 사람이 결정합니다.",
    trustBody: "Ryntra는 non-custodial, paper-first입니다. Unknown, stale, conflicting 데이터는 그대로 보입니다.",
    eligibility: "Venue 접근, 상품 eligibility와 route readiness는 별도 확인입니다. Capability는 개인 허가가 아닙니다.",
    finalTitle: "Wallet prompt 전에 결정을 명확하게.",
    finalBody: "공개 모델부터 보고 실제 지원 scope를 확인할 때 베타를 여세요.",
    riskDisclosure: "Trading과 토큰화 자산에는 위험이 있습니다. 출력은 정보 제공용이며 투자 조언이 아닙니다. Ryntra는 자금을 보관하거나 출금 권한을 얻지 않습니다.",
    terms: "약관", privacy: "개인정보",
  },
  ar: {
    nav: { product: "المنتج", loop: "دورة القرار", methodology: "المنهجية", trust: "الثقة", beta: "تحقق من الوصول", menu: "افتح القائمة", language: "اللغة" },
    heroBody: "نظام تشغيل منضبط للمخاطر للمتداولين النشطين. صِغ خطة قابلة للاختبار، وافحص أدلة readiness المحددة النطاق، واختر تصرفًا يصرّح به الإنسان، وراجع القرار من دون تسليم الحفظ.",
    icp: "للمتداولين النشطين المستقلين الذين يستخدمون الرسوم وvenue واحدًا أو أكثر، لكنهم يفتقرون إلى عملية موحدة للتخطيط والمخاطر والقرار والمراجعة.",
    modeRelationship: "يعرض Simple Mode قرارًا تالياً واحدًا بصدق، ويكشف Pro Mode مزيدًا من المصادر والافتراضات والحداثة والقيود والحزم المتخصصة من دون تغيير الحقيقة الأساسية.",
    primary: "افتح قائمة الوصول", secondary: "اقرأ المنهجية",
    riskState: "حذر", riskReason: "السوق المرجعي مغلق تقديريًا. سعر العينة أعلى من آخر feed بنسبة 0.84٪.",
    loopTitle: "دورة منضبطة واحدة ونضج صادق في كل خطوة.",
    loopBody: "يربط Ryntra النية والأدلة وسلطة الإنسان والمراجعة. ما تم shipped منفصل عن paper وpreview وplanned.",
    loopScope: "دورة StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord الكاملة هي north star ولم تصبح shipped من البداية إلى النهاية.",
    capabilityTitle: "الدليل الحالي بلا استعراض roadmap.",
    capabilityBody: "يظهر النضج والوضع والنطاق والحداثة والحد معًا. «Live» لا يعني متاحًا للجميع أو آمنًا.",
    analystTitle: "مذكرة تحليلية لا حكم.",
    analystBody: "Strategy Lab هو preview محلي. عندما يتوفر تحليل AI يمكنه تنظيم السياق أو اقتراح draft؛ لكنه لا يوافق على readiness ولا يصرّح للمحفظة ولا ينشئ receipt ولا يقيّم review ولا ينفذ. يبقى التحليل اليدوي متاحًا.",
    trustTitle: "الأدلة تُعلِم والإنسان يقرر.",
    trustBody: "Ryntra غير احتجازي وpaper-first. تبقى البيانات المجهولة أو القديمة أو المتعارضة ظاهرة.",
    eligibility: "الوصول إلى venue وأهلية الأداة وroute readiness فحوص منفصلة. Capability ليست تصريحًا شخصيًا.",
    finalTitle: "اجعل القرار واضحًا قبل wallet prompt.",
    finalBody: "ابدأ بالنموذج العام ثم افتح البيتا لرؤية النطاق المدعوم فعليًا.",
    riskDisclosure: "التداول والأصول المرمّزة ينطويان على مخاطر. المخرجات للمعلومات فقط وليست نصيحة استثمارية. لا تحتفظ Ryntra بالأموال ولا تحصل على صلاحية السحب.",
    terms: "الشروط", privacy: "الخصوصية",
  },
};

const MATURITY: Record<LocaleCode, Record<LandingMaturity, string>> = {
  en: { live: "Shipped", testnet: "Testnet verified", paper: "Paper simulation", preview: "Preview", planned: "Planned", after_gate: "After a separate gate" },
  uk: { live: "Випущено", testnet: "Перевірено на testnet", paper: "Симуляція", preview: "Попередній перегляд", planned: "Заплановано", after_gate: "Після окремої перевірки" },
  ru: { live: "Выпущено", testnet: "Проверено на testnet", paper: "Симуляция", preview: "Предпросмотр", planned: "Запланировано", after_gate: "После отдельной проверки" },
  es: { live: "Lanzado", testnet: "Verificado en testnet", paper: "Simulación", preview: "Vista previa", planned: "Planificado", after_gate: "Tras una validación separada" },
  "pt-BR": { live: "Lançado", testnet: "Verificado em testnet", paper: "Simulação", preview: "Prévia", planned: "Planejado", after_gate: "Após validação separada" },
  fr: { live: "Livré", testnet: "Vérifié sur testnet", paper: "Simulation", preview: "Aperçu", planned: "Planifié", after_gate: "Après une validation distincte" },
  tr: { live: "Yayınlandı", testnet: "Testnet'te doğrulandı", paper: "Simülasyon", preview: "Ön izleme", planned: "Planlandı", after_gate: "Ayrı doğrulama sonrası" },
  vi: { live: "Đã phát hành", testnet: "Đã xác minh trên testnet", paper: "Mô phỏng", preview: "Xem trước", planned: "Đã lên kế hoạch", after_gate: "Sau bước kiểm tra riêng" },
  id: { live: "Dirilis", testnet: "Terverifikasi di testnet", paper: "Simulasi", preview: "Pratinjau", planned: "Direncanakan", after_gate: "Setelah verifikasi terpisah" },
  zh: { live: "已发布", testnet: "测试网已验证", paper: "模拟", preview: "预览", planned: "已规划", after_gate: "通过独立门槛后" },
  ko: { live: "출시됨", testnet: "테스트넷 검증됨", paper: "모의", preview: "미리보기", planned: "계획됨", after_gate: "별도 검증 후" },
  ar: { live: "تم الإطلاق", testnet: "تم التحقق على شبكة الاختبار", paper: "محاكاة", preview: "معاينة", planned: "مخطط", after_gate: "بعد بوابة مستقلة" },
};

/**
 * Five-section landing copy for the public locales only.
 * The legacy 12-locale LANDING_COPY below stays intact: methodology still
 * renders from it and the hidden translations are preserved for a future
 * human-edited return.
 */
export type HomeCopy = {
  nav: { now: string; how: string; trust: string; methodology: string; beta: string; menu: string; language: string };
  skip: string;
  badge: string;
  hero: string;
  heroSub: string;
  heroSubDegraded: string;
  primary: string;
  secondary: string;
  routesLine: string;
  routesLineDegraded: string;
  trustStrip: readonly [string, string, string];
  /** Legend for the hero token ring: what each treatment actually means. */
  orbitSwap: string; orbitRead: string;
  panel: {
    title: string; sample: string; caution: string; asset: string; assetTag: string; note: string;
    marketK: string; marketV: string; liqK: string; liqV: string; oracleK: string; freshSuffix: string;
    vsK: string; lock: string; sign: string;
  };
  /** Hero composition: the live market plane and the illustrated swap ticket. */
  stage: {
    live: string; stale: string; sampleTag: string; assetName: string; source: string; sourceSample: string;
    changeLabel: string; ticketTitle: string; illustration: string; pay: string; get: string;
    ticketNote: string; ticketNoteDegraded: string; routeUnavailable: string;
  };
  stripTitle: string; stripTitleLoading: string; stripStale: string; stripUnavailable: string; stripBreakdown: string; stripFine: string; stripFineDegraded: string; stripPause: string; stripResume: string;
  nowKicker: string; nowTitle: string; nowLead: string; nowLeadDegraded: string; recheck: string; recheckBody: string;
  cards: ReadonlyArray<{ n: string; h: string; p: string; capabilityId: string }>;
  /**
   * Public maturity badges. The value shown is resolved from the capability
   * registry at render time, never chosen by the copy author, so a block
   * cannot claim a maturity the product has not reached.
   */
  maturity: { live: string; testnet: string; paper: string; preview: string; planned: string; after_gate: string; unverified: string };
  howKicker: string; howTitle: string;
  steps: ReadonlyArray<{ h: string; p: string }>;
  trustKicker: string; trustTitle: string; methodologyLink: string;
  trustCards: ReadonlyArray<{ h: string; p: string }>;
  /**
   * Scanner demonstration. The capability is not shipped, so this block shows
   * the method on deterministic sample values and says so in its own copy.
   * Its badge is resolved from the registry like every other block.
   */
  scannerKicker: string; scannerTitle: string; scannerLead: string; scannerSampleNote: string;
  scannerSteps: ReadonlyArray<{ h: string; p: string }>;
  scannerCols: { asset: string; kind: string; verdict: string };
  scannerRows: ReadonlyArray<{
    asset: string; kind: string; liquidity: number; concentration: number; freshness: number;
    verdict: "pass" | "review" | "blocked"; reason: string;
  }>;
  scannerBriefTitle: string;
  /** Stop controls: any element that moves on its own must be stoppable. */
  scannerPause: string; scannerResume: string; orbitPause: string; orbitResume: string;
  scannerMetrics: { liquidity: string; concentration: string; freshness: string };
  scannerVerdicts: { pass: string; review: string; blocked: string };
  scannerLegend: string;
  /**
   * Coverage grid. Each row states what Ryntra can actually do with that class
   * of asset today — read it, or route money through it — and nothing more.
   */
  coverageKicker: string; coverageTitle: string; coverageLead: string;
  coverageRoles: { read: string; swap: string };
  coverage: ReadonlyArray<{ name: string; detail: string; role: "read" | "swap" }>;
  /*
   * The workspace-preview entries that used to sit here were removed with the
   * block itself. Previewing an unbuilt terminal on the landing page promises
   * something the product has not earned; it returns as screenshots of the
   * working instruments, not as an illustration of them. The capability stays
   * visible through the roadmap milestone, which reads the registry.
   */
  /**
   * Contrast block. Every right-hand promise must already be true today —
   * this section carries no maturity badge, so nothing aspirational belongs here.
   */
  principlesKicker: string; principlesTitle: string; principlesLead: string;
  principlesThemLabel: string; principlesUsLabel: string;
  principles: ReadonlyArray<{ them: string; us: string }>;
  /** One verified on-chain fact instead of vanity numbers. */
  proofKicker: string; proofTitle: string; proofNote: string; proofStatus: string;
  proofRows: ReadonlyArray<{ k: string; v: string }>;
  fineGeo: string; fineAdvice: string;
  finalKicker: string; finalTitle: string; finalAccent: string; finalSub: string;
  footerTag: string; footerBoundary: string; terms: string; privacy: string;
};

export const HOME_COPY: Record<"en" | "uk" | "ru", HomeCopy> = {
  en: {
    nav: { now: "What you can do", how: "How it works", trust: "Trust", methodology: "Methodology", beta: "Open free beta", menu: "Open menu", language: "Language" },
    skip: "Skip to content",
    badge: "Non-custodial · free beta",
    hero: "Know whether this action is ready — and preserve the evidence.",
    heroSub: "Ryntra Workspace is the reference client for provider-neutral decision and settlement evidence. Supported Arcus stock-token routes remain bounded, and every action waits for your wallet.",
    heroSubDegraded: "Ryntra is a risk-first workspace for crypto and tokenized assets. Arcus swap routes are being re-verified, so this page does not offer a live money action. Any future action still waits for your wallet.",
    primary: "Open free beta",
    secondary: "See supported routes",
    routesLine: "SUPPORTED ROUTES · SWAP USDG ↔ TSLA · AAPL · AMD",
    routesLineDegraded: "READ-ONLY MARKET DATA · SWAP ROUTES BEING RE-VERIFIED",
    trustStrip: ["Your wallet, your keys", "You approve every action", "Ryntra never holds funds"],
    panel: {
      title: "Risk snapshot", sample: "Illustrative risk example", caution: "CAUTION", asset: "TSLA", assetTag: "tokenized",
      note: "Reference market is closed. The sample quote sits above the oracle price.",
      marketK: "Market hours", marketV: "Closed", liqK: "Liquidity", liqV: "Sufficient",
      oracleK: "Oracle freshness", freshSuffix: "s ago", vsK: "Price vs oracle",
      lock: "Nothing moves until you sign. Ryntra cannot touch your funds.", sign: "Review in app",
    },
    stage: {
      live: "Feed received", stale: "Stale", sampleTag: "Sample", assetName: "Tesla · stock token",
      source: "Arcus spot market · 1H", sourceSample: "Sample shape · waiting for the venue",
      changeLabel: "24h", ticketTitle: "Swap preview", illustration: "Illustration",
      pay: "You pay", get: "You get",
      ticketNote: "The real quote, fee and minimum appear in the app before anything is signed.",
      ticketNoteDegraded: "This route is being re-verified. No quote or wallet action is available from this preview.",
      routeUnavailable: "Route being re-verified",
    },
    stripTitle: "market snapshot", stripTitleLoading: "Market data", stripStale: "Stale snapshot", stripUnavailable: "Market data unavailable. Reconnecting.",
    stripBreakdown: "Read-only · {crypto} crypto · {equities} stocks and indices · {commodities} commodities",
    stripFine: "Ryntra shows data for these markets. Money only moves on the three supported swap routes, and only after you sign.",
    stripFineDegraded: "Ryntra shows this market data, but Arcus swap routes are being re-verified. No money action is available from this view.",
    stripPause: "Pause ticker", stripResume: "Resume ticker",
    nowKicker: "Available now", nowTitle: "What you can do now.",
    nowLead: "Four ways to start. If a capability needs re-verification, we say so here.",
    nowLeadDegraded: "Items being re-verified are labelled and do not claim live availability.",
    recheck: "Being re-verified",
    recheckBody: "This capability is being re-verified. No live availability is claimed until its evidence is fresh again.",
    cards: [
      { n: "01", capabilityId: "arcus-spot-rfq", h: "Swap tokenized stocks", p: "USDG ↔ TSLA, AAPL and AMD on supported Arcus routes. Each swap is signed in your wallet." },
      { n: "02", capabilityId: "rwa-risk-pack", h: "Read the risk first", p: "Market hours, liquidity, oracle freshness and price versus oracle for the asset in front of you." },
      { n: "03", capabilityId: "smarttrade-plan", h: "Practise with paper trading", p: "Run the same flow with nothing at stake. No wallet prompt, no money." },
      { n: "04", capabilityId: "decision-journal", h: "Keep a decision journal", p: "Write down why you acted, and read it back before the next one." },
    ],
    maturity: { live: "Live", testnet: "Testnet verified", paper: "Paper", preview: "Preview", planned: "In build", after_gate: "Behind a gate", unverified: "Re-verifying" },
    orbitSwap: "Swap route", orbitRead: "Read-only market",
    howKicker: "How it works", howTitle: "Three steps. You stay in control.",
    steps: [
      { h: "Connect your wallet", p: "Enter the beta through Telegram without an email or password, then connect the wallet you already use." },
      { h: "See the risk", p: "Ryntra checks the asset and shows what could go wrong right now, in plain words, before you act." },
      { h: "You approve it", p: "Every action waits for your signature in your own wallet. You can walk away at any step." },
    ],
    trustKicker: "Trust", trustTitle: "Who controls your money: you.", methodologyLink: "Read the methodology",
    trustCards: [
      { h: "Non-custodial", p: "Ryntra never holds your funds or your keys." },
      { h: "You sign everything", p: "Nothing happens without a confirmation in your wallet." },
      { h: "Free beta", p: "Opened from Telegram. No email, no password, no card." },
      { h: "No deposits, ever", p: "There is no Ryntra balance to top up. Funds stay in your wallet." },
    ],
    scannerKicker: "How we read risk",
    scannerTitle: "Before you sign, the same four questions get asked every time.",
    scannerLead: "This is the method, running on fixed example values. The scanner itself is not released — when it is, it will answer with checked facts and name what it could not check.",
    scannerSampleNote: "Sample values · not live market data",
    scannerSteps: [
      { h: "Scan", p: "Pull what is verifiable about the asset and its venue." },
      { h: "Read the brief", p: "See each signal, its source and how fresh it is." },
      { h: "Decide", p: "You choose. Nothing is auto-approved and nothing is auto-signed." },
    ],
    scannerCols: { asset: "Asset", kind: "Type", verdict: "Readiness" },
    scannerRows: [
      { asset: "TSLA", kind: "Stock token", liquidity: 78, concentration: 34, freshness: 96, verdict: "pass", reason: "Supported route, fresh oracle, depth within your size." },
      { asset: "AAPL", kind: "Stock token", liquidity: 71, concentration: 41, freshness: 92, verdict: "pass", reason: "Supported route; spread widens outside market hours." },
      { asset: "GLD", kind: "ETF token", liquidity: 52, concentration: 58, freshness: 74, verdict: "review", reason: "Read-only here — no swap route, and depth thins fast." },
      { asset: "Unlisted token", kind: "New contract", liquidity: 18, concentration: 89, freshness: 40, verdict: "blocked", reason: "Holders concentrated, contract unverified, data stale." },
    ],
    scannerBriefTitle: "Risk brief",
    scannerPause: "Pause", scannerResume: "Resume", orbitPause: "Pause markets", orbitResume: "Resume markets",
    scannerMetrics: { liquidity: "Liquidity", concentration: "Concentration", freshness: "Data freshness" },
    scannerVerdicts: { pass: "Ready", review: "Review", blocked: "Not ready" },
    scannerLegend: "Readiness is never a safety guarantee. It reports what was checked, what was found and what stayed unknown.",
    coverageKicker: "What Ryntra can reach",
    coverageTitle: "Read the venue's online market feed. Move money only where the route is proven.",
    coverageLead: "The difference matters more than the count: seeing a market and being able to trade it are not the same permission. We show the markets Arcus reports as online — nothing beyond that feed.",
    coverageRoles: { read: "Read-only", swap: "Swap route" },
    coverage: [
      { name: "Three swap routes", detail: "USDG ↔ TSLA, AAPL and AMD — the only paths where money moves.", role: "swap" },
      { name: "Equities", detail: "The equity tokens Arcus reports online, priced and charted.", role: "read" },
      { name: "Crypto", detail: "The venue's online crypto book, same feed and freshness rules.", role: "read" },
      { name: "Commodities and indices", detail: "The remaining online categories the feed returns.", role: "read" },
    ],
    principlesKicker: "What we refuse to build",
    principlesTitle: "The industry sells the left column. We ship the right one.",
    principlesLead: "Every line on the right is true today — not planned, not coming. That is the whole point of listing them.",
    principlesThemLabel: "Sold everywhere",
    principlesUsLabel: "How Ryntra works",
    principles: [
      { them: "Bots that sign while you sleep", us: "Every action waits for your signature" },
      { them: "Signals you are asked to trust", us: "Checked facts, with the unknowns named" },
      { them: "Custody, for your convenience", us: "Your keys never reach us — withdrawal is structurally impossible" },
      { them: "Profit screenshots as proof", us: "No profit promises; the risk is stated before the trade" },
      { them: "Numbers that never go stale", us: "Live, stale or unavailable — the page says which" },
    ],
    proofKicker: "Production-verified", proofTitle: "A real swap finished and the result was checked.",
    proofNote: "Verification evidence is retained internally; the public landing does not expose the wallet that signed.",
    proofStatus: "Execution and result checked",
    proofRows: [
      { k: "Size", v: "$10.00 · USDG → TSLA" },
      { k: "Fee", v: "$0.005 on a $10 swap, shown before signing" },
      { k: "Authorization", v: "Explicitly approved in a user-controlled wallet" },
      { k: "Result", v: "Checked result recorded" },
    ],
    fineGeo: "The venue is not available in the US, the UK and Canada.",
    fineAdvice: "Ryntra shows information about risk. It is not financial advice. Trading tokenized assets carries risk, including losing what you put in.",
    finalKicker: "Get started",
    finalTitle: "Look at the risk.", finalAccent: "Then decide.", finalSub: "Free beta, opened from Telegram. Your wallet stays yours.",
    footerTag: "A risk-first trading workspace. Non-custodial, human-authorized.",
    footerBoundary: "Arcus is the first shipped adapter and specialist proof. It does not define the whole Ryntra category.",
    terms: "Terms", privacy: "Privacy",
  },
  uk: {
    nav: { now: "Що можна зробити", how: "Як це працює", trust: "Довіра", methodology: "Методологія", beta: "Відкрити бету", menu: "Відкрити меню", language: "Мова" },
    skip: "Перейти до вмісту",
    badge: "Без зберігання коштів · безкоштовна бета",
    hero: "Побач ризик до підпису.",
    heroSub: "Ryntra допомагає торгувати криптовалютами й токенізованими активами, тримаючи ризик у центрі уваги. Підтримані маршрути Arcus для токенів акцій уже працюють, а кожна дія чекає на підтвердження у твоєму гаманці.",
    heroSubDegraded: "Ryntra допомагає торгувати криптовалютами й токенізованими активами, тримаючи ризик у центрі уваги. Маршрути свопу Arcus зараз проходять повторну перевірку, тому ця сторінка не пропонує операцій з реальними коштами. Будь-яка майбутня дія все одно чекатиме на підтвердження у твоєму гаманці.",
    primary: "Відкрити безкоштовну бету",
    secondary: "Подивитися доступні маршрути",
    routesLine: "ПІДТРИМАНІ МАРШРУТИ · СВОП USDG ↔ TSLA · AAPL · AMD",
    routesLineDegraded: "РИНКОВІ ДАНІ ЛИШЕ ДЛЯ ПЕРЕГЛЯДУ · МАРШРУТИ СВОПУ ПЕРЕВІРЯЮТЬСЯ",
    trustStrip: ["Твій гаманець: твої ключі", "Кожну дію підтверджуєш ти", "Ryntra ніколи не тримає кошти"],
    panel: {
      title: "Знімок ризику", sample: "Умовний приклад ризику", caution: "ОБЕРЕЖНО", asset: "TSLA", assetTag: "токенізована",
      note: "Базовий ринок зачинений. Приклад котирування вищий за ціну оракула.",
      marketK: "Години ринку", marketV: "Зачинено", liqK: "Ліквідність", liqV: "Достатня",
      oracleK: "Свіжість оракула", freshSuffix: " сек тому", vsK: "Відхилення від оракула",
      lock: "Нічого не рухається без твого підпису. Ryntra не має доступу до коштів.", sign: "Переглянути в застосунку",
    },
    stage: {
      live: "Дані отримано", stale: "Застаріло", sampleTag: "Приклад", assetName: "Tesla · токен акції",
      source: "Спотовий ринок Arcus · 1H", sourceSample: "Приклад графіка · чекаємо дані торгової платформи",
      changeLabel: "24 год", ticketTitle: "Попередній перегляд обміну", illustration: "Ілюстрація",
      pay: "Ти віддаєш", get: "Ти отримуєш",
      ticketNote: "Реальне котирування, комісію й мінімум показуємо в застосунку до будь-якого підпису.",
      ticketNoteDegraded: "Цей маршрут проходить повторну перевірку. У цьому перегляді немає котирування чи дії з гаманцем.",
      routeUnavailable: "Маршрут перевіряється",
    },
    stripTitle: "ринковий знімок", stripTitleLoading: "Дані ринку", stripStale: "Знімок застарів", stripUnavailable: "Дані ринку тимчасово недоступні. Повторюємо спробу.",
    stripBreakdown: "Лише перегляд · крипто: {crypto} · акції та індекси: {equities} · сировинні активи: {commodities}",
    stripFine: "Ryntra показує дані цих ринків. Операції з реальними коштами доступні лише на трьох підтриманих маршрутах свопу й тільки після твого підпису.",
    stripFineDegraded: "Ryntra показує ці ринкові дані, але маршрути свопу Arcus проходять повторну перевірку. З цього перегляду не можна виконати операцію з реальними коштами.",
    stripPause: "Зупинити стрічку", stripResume: "Продовжити стрічку",
    nowKicker: "Доступно зараз", nowTitle: "Що можна зробити зараз.",
    nowLead: "Чотири способи почати. Якщо якусь можливість треба перевірити повторно, ми прямо про це скажемо.",
    nowLeadDegraded: "Можливості на повторній перевірці мають окрему позначку й не подаються як доступні.",
    recheck: "Перевіряється повторно",
    recheckBody: "Цю можливість перевіряємо повторно. Поки докази знову не будуть свіжими, ми не показуємо її як доступну.",
    cards: [
      { n: "01", capabilityId: "arcus-spot-rfq", h: "Обміняти токенізовані акції", p: "USDG ↔ TSLA, AAPL і AMD на підтримуваних маршрутах Arcus. Кожен своп підписуєш у своєму гаманці." },
      { n: "02", capabilityId: "rwa-risk-pack", h: "Спершу оцінити ризик", p: "Години ринку, ліквідність, свіжість оракула й відхилення від нього для вибраного активу." },
      { n: "03", capabilityId: "smarttrade-plan", h: "Потренуватися на паперовій торгівлі", p: "Той самий процес без жодних грошей. Без підпису в гаманці, без реальних коштів." },
      { n: "04", capabilityId: "decision-journal", h: "Вести журнал рішень", p: "Запиши, чому діяв саме так, і перечитай перед наступним рішенням." },
    ],
    maturity: { live: "Live", testnet: "Перевірено на testnet", paper: "Paper", preview: "Прев'ю", planned: "У розробці", after_gate: "Після перевірки", unverified: "Перевіряємо" },
    orbitSwap: "Свап-маршрут", orbitRead: "Ринок лише для читання",
    howKicker: "Як це працює", howTitle: "Три кроки. Контроль лишається в тебе.",
    steps: [
      { h: "Підключи гаманець", p: "Увійди в бету через Telegram без пошти й паролів та підключи гаманець, яким уже користуєшся." },
      { h: "Побач ризик", p: "Ryntra аналізує актив і простими словами показує, що може піти не так саме зараз, до того, як ти дієш." },
      { h: "Підтверджуєш ти", p: "Кожна дія чекає на твій підпис у твоєму гаманці. Можеш зупинитися на будь-якому кроці." },
    ],
    trustKicker: "Довіра", trustTitle: "Хто контролює твої гроші: ти.", methodologyLink: "Прочитати методологію",
    trustCards: [
      { h: "Без зберігання коштів", p: "Ryntra ніколи не тримає твої кошти чи ключі." },
      { h: "Ти підписуєш усе", p: "Нічого не відбувається без підтвердження в твоєму гаманці." },
      { h: "Безкоштовна бета", p: "Вхід через Telegram. Без пошти, пароля чи картки." },
      { h: "Жодних депозитів", p: "У Ryntra немає балансу для поповнення. Кошти лишаються в твоєму гаманці." },
    ],
    scannerKicker: "Як ми читаємо ризик",
    scannerTitle: "До підпису ставляться ті самі чотири питання. Щоразу.",
    scannerLead: "Це метод на фіксованих прикладних значеннях. Сам сканер ще не випущений — коли вийде, він відповідатиме перевіреними фактами й називатиме те, що перевірити не вдалося.",
    scannerSampleNote: "Прикладні значення · не живі ринкові дані",
    scannerSteps: [
      { h: "Скан", p: "Зібрати те, що можна перевірити про актив і майданчик." },
      { h: "Розбір", p: "Побачити кожен сигнал, його джерело і свіжість." },
      { h: "Рішення", p: "Обираєте ви. Нічого не схвалюється й не підписується автоматично." },
    ],
    scannerCols: { asset: "Актив", kind: "Тип", verdict: "Готовність" },
    scannerRows: [
      { asset: "TSLA", kind: "Токен акції", liquidity: 78, concentration: 34, freshness: 96, verdict: "pass", reason: "Підтриманий маршрут, свіжий оракул, глибина під ваш розмір." },
      { asset: "AAPL", kind: "Токен акції", liquidity: 71, concentration: 41, freshness: 92, verdict: "pass", reason: "Маршрут підтримано; поза сесією спред ширшає." },
      { asset: "GLD", kind: "Токен ETF", liquidity: 52, concentration: 58, freshness: 74, verdict: "review", reason: "Тут лише читання — свап-маршруту немає, глибина швидко тоншає." },
      { asset: "Незалістований токен", kind: "Новий контракт", liquidity: 18, concentration: 89, freshness: 40, verdict: "blocked", reason: "Холдери сконцентровані, контракт неперевірений, дані застарілі." },
    ],
    scannerBriefTitle: "Розбір ризику",
    scannerPause: "Пауза", scannerResume: "Продовжити", orbitPause: "Зупинити ринки", orbitResume: "Продовжити рух",
    scannerMetrics: { liquidity: "Ліквідність", concentration: "Концентрація", freshness: "Свіжість даних" },
    scannerVerdicts: { pass: "Готово", review: "Перевірити", blocked: "Не готово" },
    scannerLegend: "Готовність ніколи не є гарантією безпеки. Вона показує, що перевірено, що знайдено і що лишилось невідомим.",
    coverageKicker: "До чого Ryntra має доступ",
    coverageTitle: "Читаємо стрічку онлайн-ринків майданчика. Гроші рухаємо лише там, де маршрут доведений.",
    coverageLead: "Ця різниця важливіша за кількість: бачити ринок і мати право ним торгувати — не одне й те саме. Показуємо ті ринки, які Arcus позначає як онлайн, і нічого поза цією стрічкою.",
    coverageRoles: { read: "Лише читання", swap: "Свап-маршрут" },
    coverage: [
      { name: "Три свап-маршрути", detail: "USDG ↔ TSLA, AAPL і AMD — єдині шляхи, де рухаються гроші.", role: "swap" },
      { name: "Акції", detail: "Токени акцій, які Arcus віддає як онлайн, — з цінами та графіками.", role: "read" },
      { name: "Крипта", detail: "Онлайн-книга крипти майданчика; та сама стрічка й ті самі правила свіжості.", role: "read" },
      { name: "Сировина та індекси", detail: "Решта онлайн-категорій, які повертає стрічка.", role: "read" },
    ],
    principlesKicker: "Чого ми не будуємо",
    principlesTitle: "Індустрія продає ліву колонку. Ми випускаємо праву.",
    principlesLead: "Кожен рядок праворуч працює вже сьогодні — не заплановано, не «в розробці». Саме тому ми їх і перелічуємо.",
    principlesThemLabel: "Продають скрізь",
    principlesUsLabel: "Як працює Ryntra",
    principles: [
      { them: "Боти, що підписують, поки ви спите", us: "Кожна дія чекає на ваш підпис" },
      { them: "Сигнали, яким треба просто вірити", us: "Перевірені факти, а невідоме названо прямо" },
      { them: "Кастодія — «для вашої зручності»", us: "Ключі до нас не потрапляють: вивести кошти неможливо технічно" },
      { them: "Скріншоти прибутку як доказ", us: "Жодних обіцянок прибутку; ризик показано до угоди" },
      { them: "Цифри, які ніколи не застарівають", us: "Live, stale чи unavailable — сторінка каже, що саме" },
    ],
    proofKicker: "Перевірено в робочій версії", proofTitle: "Реальний своп завершився, а результат перевірено.",
    proofNote: "Докази збережені у внутрішньому журналі; публічний лендинг не розкриває гаманець, який підписав операцію.",
    proofStatus: "Виконання та результат перевірено",
    proofRows: [
      { k: "Сума", v: "$10.00 · USDG → TSLA" },
      { k: "Комісія", v: "$0.005 для свопу на $10, показано до підпису" },
      { k: "Підтвердження", v: "Явно схвалено у гаманці користувача" },
      { k: "Результат", v: "Перевірений результат збережено" },
    ],
    fineGeo: "Торгова платформа недоступна в США, Великій Британії та Канаді.",
    fineAdvice: "Ryntra показує інформацію про ризик. Це не фінансова порада. Торгівля токенізованими активами несе ризик, включно з втратою вкладеного.",
    finalKicker: "Почати",
    finalTitle: "Подивись на ризик.", finalAccent: "Тоді вирішуй.", finalSub: "Безкоштовна бета через Telegram. Гаманець лишається твоїм.",
    footerTag: "Робочий простір для торгівлі, де ризик на першому місці. Ryntra не зберігає кошти, а кожну дію дозволяє людина.",
    footerBoundary: "Arcus є першим підключеним модулем і прикладом роботи з токенізованими активами. Він не обмежує весь напрям Ryntra.",
    terms: "Умови", privacy: "Приватність",
  },
  ru: {
    nav: { now: "Что можно сделать", how: "Как это работает", trust: "Доверие", methodology: "Методология", beta: "Открыть бету", menu: "Открыть меню", language: "Язык" },
    skip: "Перейти к содержанию",
    badge: "Без хранения средств · бесплатная бета",
    hero: "Увидь риск до подписи.",
    heroSub: "Ryntra помогает торговать криптовалютами и токенизированными активами, сохраняя риск в центре внимания. Поддерживаемые маршруты Arcus для токенов акций уже работают, а каждое действие ждёт подтверждения в твоём кошельке.",
    heroSubDegraded: "Ryntra помогает торговать криптовалютами и токенизированными активами, сохраняя риск в центре внимания. Маршруты свопа Arcus сейчас проходят повторную проверку, поэтому эта страница не предлагает операций с реальными средствами. Любое будущее действие всё равно будет ждать подтверждения в твоём кошельке.",
    primary: "Открыть бесплатную бету",
    secondary: "Посмотреть доступные маршруты",
    routesLine: "ПОДДЕРЖИВАЕМЫЕ МАРШРУТЫ · СВОП USDG ↔ TSLA · AAPL · AMD",
    routesLineDegraded: "РЫНОЧНЫЕ ДАННЫЕ ТОЛЬКО ДЛЯ ПРОСМОТРА · МАРШРУТЫ СВОПА ПРОВЕРЯЮТСЯ",
    trustStrip: ["Твой кошелёк: твои ключи", "Каждое действие подтверждаешь ты", "Ryntra никогда не держит средства"],
    panel: {
      title: "Снимок риска", sample: "Условный пример риска", caution: "ОСТОРОЖНО", asset: "TSLA", assetTag: "токенизированная",
      note: "Базовый рынок закрыт. Пример котировки выше цены оракула.",
      marketK: "Часы рынка", marketV: "Закрыт", liqK: "Ликвидность", liqV: "Достаточная",
      oracleK: "Свежесть оракула", freshSuffix: " сек назад", vsK: "Отклонение от оракула",
      lock: "Ничего не движется без твоей подписи. У Ryntra нет доступа к средствам.", sign: "Посмотреть в приложении",
    },
    stage: {
      live: "Данные получены", stale: "Устарело", sampleTag: "Пример", assetName: "Tesla · токен акции",
      source: "Спотовый рынок Arcus · 1H", sourceSample: "Пример графика · ждём данные торговой платформы",
      changeLabel: "24 ч", ticketTitle: "Предпросмотр обмена", illustration: "Иллюстрация",
      pay: "Ты отдаёшь", get: "Ты получаешь",
      ticketNote: "Реальную котировку, комиссию и минимум показываем в приложении до любой подписи.",
      ticketNoteDegraded: "Этот маршрут проходит повторную проверку. В этом окне нет котировки или действия с кошельком.",
      routeUnavailable: "Маршрут проверяется",
    },
    stripTitle: "рыночный снимок", stripTitleLoading: "Данные рынка", stripStale: "Снимок устарел", stripUnavailable: "Данные рынка временно недоступны. Повторяем попытку.",
    stripBreakdown: "Только просмотр · крипто: {crypto} · акции и индексы: {equities} · сырьевые активы: {commodities}",
    stripFine: "Ryntra показывает данные этих рынков. Операции с реальными средствами доступны только на трёх поддерживаемых маршрутах свопа и только после твоей подписи.",
    stripFineDegraded: "Ryntra показывает эти рыночные данные, но маршруты свопа Arcus проходят повторную проверку. Из этого окна нельзя выполнить операцию с реальными средствами.",
    stripPause: "Остановить ленту", stripResume: "Продолжить ленту",
    nowKicker: "Доступно сейчас", nowTitle: "Что можно сделать сейчас.",
    nowLead: "Четыре способа начать. Если какую-то возможность нужно проверить повторно, мы прямо об этом скажем.",
    nowLeadDegraded: "Возможности на повторной проверке отмечены отдельно и не показываются как доступные.",
    recheck: "Проверяется повторно",
    recheckBody: "Эту возможность проверяем повторно. Пока доказательства снова не станут свежими, мы не показываем её как доступную.",
    cards: [
      { n: "01", capabilityId: "arcus-spot-rfq", h: "Обменять токенизированные акции", p: "USDG ↔ TSLA, AAPL и AMD на поддерживаемых маршрутах Arcus. Каждый своп подписываешь в своём кошельке." },
      { n: "02", capabilityId: "rwa-risk-pack", h: "Сначала оценить риск", p: "Часы рынка, ликвидность, свежесть оракула и отклонение от него для выбранного актива." },
      { n: "03", capabilityId: "smarttrade-plan", h: "Потренироваться на бумажной торговле", p: "Тот же процесс без денег. Без подписи в кошельке, без реальных средств." },
      { n: "04", capabilityId: "decision-journal", h: "Вести журнал решений", p: "Запиши, почему действовал именно так, и перечитай перед следующим решением." },
    ],
    maturity: { live: "Live", testnet: "Проверено на testnet", paper: "Paper", preview: "Превью", planned: "В разработке", after_gate: "После проверки", unverified: "Проверяем" },
    orbitSwap: "Свап-маршрут", orbitRead: "Рынок только для чтения",
    howKicker: "Как это работает", howTitle: "Три шага. Контроль остаётся у тебя.",
    steps: [
      { h: "Подключи кошелёк", p: "Войди в бету через Telegram без почты и паролей и подключи кошелёк, которым уже пользуешься." },
      { h: "Увидь риск", p: "Ryntra анализирует актив и простыми словами показывает, что может пойти не так прямо сейчас, до того, как ты действуешь." },
      { h: "Подтверждаешь ты", p: "Каждое действие ждёт твоей подписи в твоём кошельке. Можно остановиться на любом шаге." },
    ],
    trustKicker: "Доверие", trustTitle: "Кто контролирует твои деньги: ты.", methodologyLink: "Прочитать методологию",
    trustCards: [
      { h: "Без хранения средств", p: "Ryntra никогда не держит твои средства или ключи." },
      { h: "Ты подписываешь всё", p: "Ничего не происходит без подтверждения в твоём кошельке." },
      { h: "Бесплатная бета", p: "Вход через Telegram. Без почты, пароля и карты." },
      { h: "Никаких депозитов", p: "У Ryntra нет баланса для пополнения. Средства остаются в твоём кошельке." },
    ],
    scannerKicker: "Как мы читаем риск",
    scannerTitle: "До подписи задаются те же четыре вопроса. Каждый раз.",
    scannerLead: "Это метод на фиксированных примерных значениях. Сам сканер ещё не выпущен — когда выйдет, он будет отвечать проверенными фактами и называть то, что проверить не удалось.",
    scannerSampleNote: "Примерные значения · не живые рыночные данные",
    scannerSteps: [
      { h: "Скан", p: "Собрать то, что можно проверить об активе и площадке." },
      { h: "Разбор", p: "Увидеть каждый сигнал, его источник и свежесть." },
      { h: "Решение", p: "Выбираете вы. Ничто не одобряется и не подписывается автоматически." },
    ],
    scannerCols: { asset: "Актив", kind: "Тип", verdict: "Готовность" },
    scannerRows: [
      { asset: "TSLA", kind: "Токен акции", liquidity: 78, concentration: 34, freshness: 96, verdict: "pass", reason: "Поддержанный маршрут, свежий оракул, глубина под ваш размер." },
      { asset: "AAPL", kind: "Токен акции", liquidity: 71, concentration: 41, freshness: 92, verdict: "pass", reason: "Маршрут поддержан; вне сессии спред расширяется." },
      { asset: "GLD", kind: "Токен ETF", liquidity: 52, concentration: 58, freshness: 74, verdict: "review", reason: "Здесь только чтение — свап-маршрута нет, глубина быстро истончается." },
      { asset: "Нелистингованный токен", kind: "Новый контракт", liquidity: 18, concentration: 89, freshness: 40, verdict: "blocked", reason: "Холдеры сконцентрированы, контракт непроверен, данные устарели." },
    ],
    scannerBriefTitle: "Разбор риска",
    scannerPause: "Пауза", scannerResume: "Продолжить", orbitPause: "Остановить рынки", orbitResume: "Продолжить движение",
    scannerMetrics: { liquidity: "Ликвидность", concentration: "Концентрация", freshness: "Свежесть данных" },
    scannerVerdicts: { pass: "Готово", review: "Проверить", blocked: "Не готово" },
    scannerLegend: "Готовность никогда не является гарантией безопасности. Она показывает, что проверено, что найдено и что осталось неизвестным.",
    coverageKicker: "К чему у Ryntra есть доступ",
    coverageTitle: "Читаем ленту онлайн-рынков площадки. Деньги двигаем только там, где маршрут доказан.",
    coverageLead: "Эта разница важнее количества: видеть рынок и иметь право им торговать — не одно и то же. Показываем те рынки, которые Arcus отмечает как онлайн, и ничего вне этой ленты.",
    coverageRoles: { read: "Только чтение", swap: "Свап-маршрут" },
    coverage: [
      { name: "Три свап-маршрута", detail: "USDG ↔ TSLA, AAPL и AMD — единственные пути, где движутся деньги.", role: "swap" },
      { name: "Акции", detail: "Токены акций, которые Arcus отдаёт как онлайн, — с ценами и графиками.", role: "read" },
      { name: "Крипта", detail: "Онлайн-книга крипты площадки; та же лента и те же правила свежести.", role: "read" },
      { name: "Сырьё и индексы", detail: "Остальные онлайн-категории, которые возвращает лента.", role: "read" },
    ],
    principlesKicker: "Чего мы не строим",
    principlesTitle: "Индустрия продаёт левую колонку. Мы выпускаем правую.",
    principlesLead: "Каждая строка справа работает уже сегодня — не запланировано, не «в разработке». Именно поэтому мы их и перечисляем.",
    principlesThemLabel: "Продают везде",
    principlesUsLabel: "Как работает Ryntra",
    principles: [
      { them: "Боты, которые подписывают, пока вы спите", us: "Каждое действие ждёт вашей подписи" },
      { them: "Сигналы, которым нужно просто верить", us: "Проверенные факты, а неизвестное названо прямо" },
      { them: "Кастодиальность — «для вашего удобства»", us: "Ключи к нам не попадают: вывести средства технически невозможно" },
      { them: "Скриншоты прибыли как доказательство", us: "Никаких обещаний прибыли; риск показан до сделки" },
      { them: "Цифры, которые никогда не устаревают", us: "Live, stale или unavailable — страница говорит, что именно" },
    ],
    proofKicker: "Проверено в рабочей версии", proofTitle: "Реальный своп завершился, а результат проверен.",
    proofNote: "Доказательства сохранены во внутреннем журнале; публичный лендинг не раскрывает кошелёк, подписавший операцию.",
    proofStatus: "Выполнение и результат проверены",
    proofRows: [
      { k: "Сумма", v: "$10.00 · USDG → TSLA" },
      { k: "Комиссия", v: "$0.005 для свопа на $10, показано до подписи" },
      { k: "Подтверждение", v: "Явно одобрено в кошельке пользователя" },
      { k: "Результат", v: "Проверенный результат сохранён" },
    ],
    fineGeo: "Торговая платформа недоступна в США, Великобритании и Канаде.",
    fineAdvice: "Ryntra показывает информацию о риске. Это не финансовый совет. Торговля токенизированными активами несёт риск, включая потерю вложенного.",
    finalKicker: "Начать",
    finalTitle: "Посмотри на риск.", finalAccent: "Потом решай.", finalSub: "Бесплатная бета через Telegram. Кошелёк остаётся твоим.",
    footerTag: "Рабочее пространство для торговли, где риск на первом месте. Ryntra не хранит средства, а каждое действие разрешает человек.",
    footerBoundary: "Arcus является первым подключённым модулем и примером работы с токенизированными активами. Он не ограничивает всё направление Ryntra.",
    terms: "Условия", privacy: "Конфиденциальность",
  },
};

export const LANDING_COPY: Record<LocaleCode, LandingCopy> = Object.fromEntries(
  Object.entries(T).map(([locale, copy]) => [
    locale,
    {
      ...copy,
      category: "Risk, Strategy & Evidence OS",
      heroTitle: "Plan. Prove. Improve.",
      trustLine: "Non-custodial. Paper-first. Human-authorized. No profit promises.",
      maturity: MATURITY[locale as LocaleCode],
    },
  ]),
) as Record<LocaleCode, LandingCopy>;
