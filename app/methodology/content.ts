import type { LocaleCode } from "../i18n/locales";

export type MethodologySummary = Readonly<{
  title: string;
  lead: string;
  loopBoundary: string;
  wrrd: string;
  trust: string;
  aiBoundary: string;
  technicalReference: string;
  backHome: string;
}>;

export const METHODOLOGY_SUMMARY: Record<LocaleCode, MethodologySummary> = {
  en: {
    title: "Methodology & product truth",
    lead: "How Ryntra separates the decision method from what the product actually ships.",
    loopBoundary: "The complete StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord loop is the target model. It is not shipped end to end today.",
    wrrd: "WRRD means Weekly Risk-Reviewed Decisions. It does not mean trades, volume, profit, referrals, or AI calls.",
    trust: "Ryntra never holds funds. Paper comes before unsupported execution, and a human remains the decision authority.",
    aiBoundary: "Strategy Lab is a local preview. Where AI analysis is separately available, it may explain context in a sourced analyst note; it never approves a plan, determines readiness, authorizes a disposition, or executes.",
    technicalReference: "The technical reference below is maintained in English so identifiers, maturity labels, and registry limitations stay mechanically exact.",
    backHome: "Back to Ryntra",
  },
  uk: {
    title: "Методологія і правда про продукт",
    lead: "Як Ryntra відокремлює метод прийняття рішень від того, що продукт справді вже постачає.",
    loopBoundary: "Повний цикл StrategySpec → готовність → рішення → DecisionReceipt → ReviewRecord є цільовою моделлю. Сьогодні він ще не постачається від початку до кінця.",
    wrrd: "WRRD означає щотижневі рішення з переглядом ризику. Це не кількість угод, обсяг, прибуток, реферали чи виклики AI.",
    trust: "Ryntra не зберігає кошти. До непідтвердженого виконання застосовується paper-first, а остаточне рішення завжди залишається за людиною.",
    aiBoundary: "Strategy Lab є локальним preview. Де AI-аналіз окремо доступний, він може пояснювати контекст у нотатці з джерелами; він не схвалює план, не визначає готовність, не авторизує рішення і не виконує.",
    technicalReference: "Технічний довідник нижче ведеться англійською, щоб ідентифікатори, рівні зрілості й обмеження реєстру залишалися механічно точними.",
    backHome: "Назад до Ryntra",
  },
  ru: {
    title: "Методология и факты о продукте",
    lead: "Как Ryntra отделяет метод принятия решений от того, что продукт действительно поставляет.",
    loopBoundary: "Полный цикл StrategySpec → готовность → решение → DecisionReceipt → ReviewRecord — целевая модель. Сегодня он ещё не поставляется от начала до конца.",
    wrrd: "WRRD означает еженедельные решения с разбором риска. Это не число сделок, объём, прибыль, рефералы или вызовы AI.",
    trust: "Ryntra не хранит средства. Для неподтверждённого исполнения действует paper-first, а окончательное решение всегда остаётся за человеком.",
    aiBoundary: "Strategy Lab — локальный preview. Там, где AI-анализ отдельно доступен, он может объяснять контекст в заметке с источниками; он не одобряет план, не определяет готовность, не авторизует решение и не исполняет.",
    technicalReference: "Технический справочник ниже ведётся на английском, чтобы идентификаторы, статусы зрелости и ограничения реестра оставались механически точными.",
    backHome: "Назад к Ryntra",
  },
  es: {
    title: "Metodología y verdad del producto",
    lead: "Cómo Ryntra separa el método de decisión de lo que el producto realmente ofrece hoy.",
    loopBoundary: "El ciclo completo StrategySpec → preparación → disposición → DecisionReceipt → ReviewRecord es el modelo objetivo. Hoy no está disponible de extremo a extremo.",
    wrrd: "WRRD significa decisiones semanales revisadas por riesgo. No significa operaciones, volumen, beneficio, referidos ni llamadas de AI.",
    trust: "Ryntra no custodia fondos. Se usa paper-first cuando la ejecución no está verificada y la persona conserva la autoridad de decisión.",
    aiBoundary: "Strategy Lab es una vista previa local. Cuando el análisis AI está disponible por separado, puede explicar contexto en una nota con fuentes; nunca aprueba un plan, decide la preparación, autoriza una disposición ni ejecuta.",
    technicalReference: "La referencia técnica se mantiene en inglés para conservar exactos los identificadores, estados de madurez y límites del registro.",
    backHome: "Volver a Ryntra",
  },
  "pt-BR": {
    title: "Metodologia e verdade do produto",
    lead: "Como a Ryntra separa o método de decisão do que o produto realmente entrega hoje.",
    loopBoundary: "O ciclo completo StrategySpec → prontidão → disposição → DecisionReceipt → ReviewRecord é o modelo-alvo. Hoje ele não é entregue de ponta a ponta.",
    wrrd: "WRRD significa decisões semanais revisadas por risco. Não significa trades, volume, lucro, indicações ou chamadas de AI.",
    trust: "A Ryntra não mantém fundos em custódia. O princípio é paper-first quando a execução não está verificada, e a pessoa mantém a autoridade de decisão.",
    aiBoundary: "Strategy Lab é um preview local. Quando a análise AI está disponível separadamente, pode explicar contexto em uma nota com fontes; nunca aprova um plano, decide prontidão, autoriza uma disposição ou executa.",
    technicalReference: "A referência técnica abaixo é mantida em inglês para preservar identificadores, maturidades e limitações do registro com exatidão mecânica.",
    backHome: "Voltar para a Ryntra",
  },
  fr: {
    title: "Méthodologie et vérité produit",
    lead: "Comment Ryntra distingue la méthode de décision de ce que le produit livre réellement.",
    loopBoundary: "La boucle complète StrategySpec → préparation → disposition → DecisionReceipt → ReviewRecord est le modèle cible. Elle n’est pas livrée de bout en bout aujourd’hui.",
    wrrd: "WRRD signifie décisions hebdomadaires revues sous l’angle du risque. Ce n’est ni le nombre de trades, ni le volume, le profit, les parrainages ou les appels AI.",
    trust: "Ryntra ne conserve aucun fonds. L’approche est paper-first si l’exécution n’est pas vérifiée, et l’humain garde l’autorité de décision.",
    aiBoundary: "Strategy Lab est un aperçu local. Quand l’analyse AI est disponible séparément, elle peut expliquer le contexte dans une note sourcée ; elle n’approuve pas un plan, ne fixe pas la préparation, n’autorise pas une disposition et n’exécute rien.",
    technicalReference: "La référence technique reste en anglais afin que les identifiants, maturités et limites du registre demeurent mécaniquement exacts.",
    backHome: "Retour à Ryntra",
  },
  tr: {
    title: "Metodoloji ve ürün doğruluğu",
    lead: "Ryntra'nın karar yöntemini ürünün bugün gerçekten sunduklarından nasıl ayırdığı.",
    loopBoundary: "StrategySpec → hazırlık → karar → DecisionReceipt → ReviewRecord tam döngüsü hedef modeldir. Bugün uçtan uca sunulmamaktadır.",
    wrrd: "WRRD, Haftalık Risk İncelemeli Kararlar demektir. İşlem sayısı, hacim, kâr, yönlendirme veya AI çağrısı değildir.",
    trust: "Ryntra fon saklamaz. Doğrulanmamış yürütmede önce simülasyon uygulanır ve karar yetkisi insanda kalır.",
    aiBoundary: "Strategy Lab yerel bir preview’dur. AI analizi ayrıca kullanılabildiğinde kaynaklı bir notta bağlamı açıklayabilir; planı onaylamaz, hazırlığa karar vermez, bir sonucu yetkilendirmez veya yürütmez.",
    technicalReference: "Kimliklerin, olgunlukların ve kayıt sınırlamalarının mekanik olarak kesin kalması için teknik referans İngilizce tutulur.",
    backHome: "Ryntra'ya dön",
  },
  vi: {
    title: "Phương pháp và sự thật sản phẩm",
    lead: "Cách Ryntra tách phương pháp ra quyết định khỏi những gì sản phẩm thực sự cung cấp hôm nay.",
    loopBoundary: "Vòng hoàn chỉnh StrategySpec → mức sẵn sàng → quyết định → DecisionReceipt → ReviewRecord là mô hình mục tiêu. Hiện chưa được cung cấp trọn vẹn.",
    wrrd: "WRRD là Quyết định hàng tuần được rà soát rủi ro. Đây không phải số giao dịch, khối lượng, lợi nhuận, giới thiệu hay lượt gọi AI.",
    trust: "Ryntra không giữ tiền. Mô phỏng được ưu tiên khi execution chưa được xác minh và con người giữ quyền quyết định.",
    aiBoundary: "Strategy Lab là preview cục bộ. Khi phân tích AI được cung cấp riêng, AI có thể giải thích bối cảnh trong ghi chú có nguồn; AI không phê duyệt kế hoạch, quyết định mức sẵn sàng, cho phép hành động hay thực thi.",
    technicalReference: "Tài liệu kỹ thuật bên dưới được duy trì bằng tiếng Anh để mã định danh, mức trưởng thành và giới hạn của registry luôn chính xác.",
    backHome: "Quay lại Ryntra",
  },
  id: {
    title: "Metodologi dan kebenaran produk",
    lead: "Cara Ryntra memisahkan metode pengambilan keputusan dari hal yang benar-benar tersedia saat ini.",
    loopBoundary: "Siklus lengkap StrategySpec → kesiapan → disposisi → DecisionReceipt → ReviewRecord adalah model tujuan. Siklus itu belum tersedia secara menyeluruh.",
    wrrd: "WRRD berarti Keputusan Mingguan yang Ditinjau Risikonya. Bukan jumlah trade, volume, profit, referral, atau panggilan AI.",
    trust: "Ryntra tidak menyimpan dana. Paper-first berlaku bila execution belum terverifikasi dan manusia tetap memegang kewenangan keputusan.",
    aiBoundary: "Strategy Lab adalah preview lokal. Saat analisis AI tersedia secara terpisah, AI dapat menjelaskan konteks dalam catatan bersumber; AI tidak menyetujui rencana, menentukan kesiapan, mengesahkan disposisi, atau mengeksekusi.",
    technicalReference: "Referensi teknis dipertahankan dalam bahasa Inggris agar ID, kematangan, dan batasan registry tetap akurat secara mekanis.",
    backHome: "Kembali ke Ryntra",
  },
  zh: {
    title: "方法论与产品事实",
    lead: "Ryntra 如何区分决策方法与产品当前实际交付的能力。",
    loopBoundary: "完整的 StrategySpec → 准备度 → 处置 → DecisionReceipt → ReviewRecord 循环是目标模型，目前尚未端到端交付。",
    wrrd: "WRRD 指每周经风险复核的决策，不代表交易次数、交易量、利润、推荐数或 AI 调用次数。",
    trust: "Ryntra 不托管资金。执行未经验证时优先模拟，最终决策权始终属于人。",
    aiBoundary: "Strategy Lab 是本地 preview。AI 分析另行可用时，可在带来源和限制的说明中解释背景，但不能批准计划、判定准备度、授权处置或执行。",
    technicalReference: "下方技术参考以英语维护，确保标识符、成熟度和能力注册表限制保持机械一致。",
    backHome: "返回 Ryntra",
  },
  ko: {
    title: "방법론 및 제품 사실",
    lead: "Ryntra가 의사결정 방법과 현재 제품이 실제로 제공하는 기능을 구분하는 방식입니다.",
    loopBoundary: "전체 StrategySpec → 준비 상태 → 처분 → DecisionReceipt → ReviewRecord 루프는 목표 모델이며 현재 처음부터 끝까지 제공되지 않습니다.",
    wrrd: "WRRD는 매주 위험 검토를 거친 결정을 뜻합니다. 거래 수, 거래량, 수익, 추천 또는 AI 호출 수가 아닙니다.",
    trust: "Ryntra는 자금을 보관하지 않습니다. 실행이 검증되지 않으면 모의를 우선하며 최종 결정 권한은 사람에게 있습니다.",
    aiBoundary: "Strategy Lab은 로컬 preview입니다. AI 분석이 별도로 제공될 때 출처와 한계가 있는 메모로 맥락을 설명할 수 있지만 계획 승인, 준비 상태 결정, 처분 권한 부여 또는 실행은 할 수 없습니다.",
    technicalReference: "식별자, 성숙도 및 registry 제한을 기계적으로 정확하게 유지하기 위해 기술 참조는 영어로 관리됩니다.",
    backHome: "Ryntra로 돌아가기",
  },
  ar: {
    title: "المنهجية وحقيقة المنتج",
    lead: "كيف تفصل Ryntra بين منهج القرار وما يقدمه المنتج فعلياً اليوم.",
    loopBoundary: "الدورة الكاملة StrategySpec ← الجاهزية ← القرار ← DecisionReceipt ← ReviewRecord هي النموذج المستهدف، ولم تُطرح بعد من البداية إلى النهاية.",
    wrrd: "تعني WRRD القرارات الأسبوعية الخاضعة لمراجعة المخاطر، ولا تعني عدد الصفقات أو الحجم أو الربح أو الإحالات أو استدعاءات AI.",
    trust: "لا تحتفظ Ryntra بالأموال. نبدأ بالمحاكاة عندما لا يكون التنفيذ موثّقاً، وتبقى سلطة القرار للإنسان.",
    aiBoundary: "Strategy Lab هو preview محلي. عندما يتوفر تحليل AI بشكل منفصل يمكنه شرح السياق في مذكرة ذات مصادر وقيود؛ ولا يوافق على الخطة أو يحدد الجاهزية أو يفوض القرار أو ينفذ.",
    technicalReference: "يُحافَظ على المرجع التقني أدناه بالإنجليزية لكي تبقى المعرّفات ومستويات النضج وحدود السجل دقيقة آلياً.",
    backHome: "العودة إلى Ryntra",
  },
};
