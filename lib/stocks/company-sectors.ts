/**
 * The company's industry in a beginner's words, from the Standard Industrial
 * Classification code it files under at the SEC.
 *
 * The SEC's own titles are clerical («Services-Prepackaged Software»,
 * «Retail-Variety Stores»); each code the product's companies file under has a
 * plain name here in both languages, and any other code falls back to its
 * major group. A handful of companies file under a code that misnames what a
 * person knows them for (3M under surgical instruments, Visa under «business
 * services NEC»); for those the ticker names the industry instead.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

const MINING = bi("Mining", "Видобуток корисних копалин");
const OIL_GAS = bi("Oil and gas", "Нафта й газ");
const PHARMA = bi("Pharmaceuticals", "Фармацевтика");
const COMPUTERS = bi("Computers and electronics", "Комп'ютери й електроніка");
const NETWORKING = bi("Networking equipment", "Мережеве обладнання");
const ELECTRICAL = bi("Electrical equipment", "Електрообладнання");
const COMMS_EQUIPMENT = bi("Communications equipment", "Телеком-обладнання");
const COMPONENTS = bi("Electronic components", "Електронні компоненти");
const AEROSPACE_DEFENCE = bi("Aerospace and defence", "Аерокосмос і оборона");
const INSTRUMENTS = bi("Measuring instruments", "Вимірювальні прилади");
const MEDICAL_DEVICES = bi("Medical devices", "Медичні вироби");
const SHIPPING = bi("Shipping", "Морські перевезення");
const TELECOM = bi("Telecom", "Зв'язок");
const RETAIL = bi("Retail", "Роздрібна торгівля");
const RESTAURANTS = bi("Restaurants", "Ресторани й кафе");
const PAYMENTS = bi("Payments", "Платежі");
const ECOMMERCE = bi("E-commerce", "Інтернет-торгівля");

const BY_CODE: Readonly<Record<string, Bi>> = {
  "1000": bi("Metal mining", "Видобуток металів"),
  "1040": bi("Gold and silver mining", "Видобуток золота й срібла"),
  "1090": bi("Ore mining", "Видобуток руд"),
  "1311": OIL_GAS,
  "1400": MINING,
  "2080": bi("Beverages", "Напої"),
  "2111": bi("Tobacco", "Тютюн"),
  "2300": bi("Apparel", "Одяг"),
  "2810": bi("Industrial chemicals", "Промислова хімія"),
  "2834": PHARMA,
  "2836": bi("Biotechnology", "Біотехнології"),
  "2840": bi("Household products", "Побутові товари"),
  "2911": OIL_GAS,
  "3021": bi("Footwear and apparel", "Взуття й одяг"),
  "3310": bi("Steel", "Сталь"),
  "3490": bi("Industrial equipment", "Промислове обладнання"),
  "3523": bi("Farm machinery", "Сільгосптехніка"),
  "3531": bi("Construction machinery", "Будівельна техніка"),
  "3559": bi("Industrial machinery", "Промислове обладнання"),
  "3570": bi("Computer hardware", "Комп'ютерне обладнання"),
  "3571": COMPUTERS,
  "3572": bi("Data storage", "Пам'ять і зберігання даних"),
  "3576": NETWORKING,
  "3620": ELECTRICAL,
  "3621": ELECTRICAL,
  "3663": COMMS_EQUIPMENT,
  "3669": COMMS_EQUIPMENT,
  "3670": COMPONENTS,
  "3674": bi("Semiconductors", "Напівпровідники"),
  "3678": COMPONENTS,
  "3679": COMPONENTS,
  "3711": bi("Automobiles", "Автомобілі"),
  "3721": bi("Aircraft", "Авіабудування"),
  "3724": bi("Aerospace", "Аерокосмічна галузь"),
  "3760": AEROSPACE_DEFENCE,
  "3812": AEROSPACE_DEFENCE,
  "3822": bi("Building climate systems", "Клімат-системи для будівель"),
  "3823": INSTRUMENTS,
  "3827": bi("Optical instruments", "Оптичні прилади"),
  "3829": INSTRUMENTS,
  "3841": MEDICAL_DEVICES,
  "3842": MEDICAL_DEVICES,
  "3861": bi("Cameras", "Фототехніка"),
  "4210": bi("Delivery and logistics", "Доставка й логістика"),
  "4400": SHIPPING,
  "4412": SHIPPING,
  "4512": bi("Airlines", "Авіаперевезення"),
  "4700": bi("Transportation services", "Транспортні послуги"),
  "4813": TELECOM,
  "4841": bi("Cable and media", "Кабельне ТБ і медіа"),
  "4899": TELECOM,
  "4911": bi("Electric utilities", "Електроенергетика"),
  "5331": RETAIL,
  "5400": bi("Food retail", "Продукти харчування"),
  "5500": bi("Car sales", "Продаж авто"),
  "5734": RETAIL,
  "5810": RESTAURANTS,
  "5812": RESTAURANTS,
  "5961": ECOMMERCE,
  "5990": RETAIL,
  "6021": bi("Banks", "Банки"),
  "6199": bi("Financial services", "Фінансові послуги"),
  "6211": bi("Brokerage and trading", "Брокери й біржі"),
  "6324": bi("Health insurance", "Медичне страхування"),
  "6331": bi("Insurance", "Страхування"),
  "6531": bi("Real estate", "Нерухомість"),
  "6798": bi("Real estate (REIT)", "Нерухомість (REIT)"),
  "7011": bi("Hotels and casinos", "Готелі й казино"),
  "7320": bi("Financial data and ratings", "Фінансові дані й рейтинги"),
  "7370": bi("Internet and software", "Інтернет і ПЗ"),
  "7371": bi("Software and IT services", "ПЗ і ІТ-послуги"),
  "7372": bi("Software", "Програмне забезпечення"),
  "7373": bi("IT systems", "ІТ-системи"),
  "7374": bi("Internet and data", "Інтернет і дані"),
  "7389": bi("Business services", "Бізнес-послуги"),
  "7510": bi("Car rental", "Прокат авто"),
  "7830": bi("Cinemas", "Кінотеатри"),
  "7841": bi("Streaming", "Стримінг"),
  "7900": bi("Entertainment", "Розваги"),
  "7990": bi("Entertainment and betting", "Розваги й ставки"),
  "8011": bi("Healthcare services", "Медичні послуги"),
};

/** The major groups, for a code not named above. */
function byGroup(code: number): Bi {
  if (code >= 1000 && code < 1500) return MINING;
  if (code >= 1500 && code < 2000) return bi("Construction", "Будівництво");
  if (code >= 2000 && code < 4000) return bi("Manufacturing", "Виробництво");
  if (code >= 4000 && code < 5000) return bi("Transport and utilities", "Транспорт і комунальні послуги");
  if (code >= 5000 && code < 5200) return bi("Wholesale", "Оптова торгівля");
  if (code >= 5200 && code < 6000) return RETAIL;
  if (code >= 6000 && code < 6800) return bi("Finance", "Фінанси");
  if (code >= 7000 && code < 9000) return bi("Services", "Послуги");
  return bi("Other", "Інше");
}

/** Companies whose filing code misnames what a person knows them for. */
const BY_TICKER: Readonly<Record<string, Bi>> = {
  MMM: bi("Industrial conglomerate", "Промисловий конгломерат"),
  TMO: bi("Laboratory equipment", "Лабораторне обладнання"),
  ABNB: bi("Travel and home rentals", "Подорожі й оренда житла"),
  V: PAYMENTS,
  MA: PAYMENTS,
  PYPL: PAYMENTS,
  XYZ: PAYMENTS,
  MELI: ECOMMERCE,
  PDD: ECOMMERCE,
  BABA: ECOMMERCE,
  UBER: bi("Rides and delivery", "Поїздки й доставка"),
  GRAB: bi("Rides, delivery and payments", "Поїздки, доставка й платежі"),
  ACN: bi("IT consulting", "ІТ-консалтинг"),
  SPCX: AEROSPACE_DEFENCE,
  SPCE: bi("Space travel", "Космічні подорожі"),
};

export const FUND_SECTOR = bi("Exchange-traded fund", "Біржовий фонд");
export const PRIVATE_SECTOR = bi("Private company", "Приватна компанія");

/** The industry for a ticker and its SIC code, or null when neither names one. */
export function sectorLabel(ticker: string | null | undefined, sic: string | null | undefined, lang: "en" | "uk"): string | null {
  const byTicker = ticker ? BY_TICKER[ticker.toUpperCase()] : undefined;
  if (byTicker) return byTicker[lang];
  if (!sic || !/^\d{4}$/.test(sic)) return null;
  return (BY_CODE[sic] ?? byGroup(Number(sic)))[lang];
}
