import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  member: "mem",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  leadStageEvent: "lse",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  mediaAsset: "ma",
  // 015 — motor de agenda
  calendarSettings: "cal",
  booking: "bk",
  offeredSlot: "ofs",
  zoomCredentials: "zcred",
  googleCredentials: "gcred",
  // 016 — atribución de anuncios
  adAttribution: "att",
  conversionEvent: "cve",
  capiSettings: "capi",
  // LUMARK — módulos nuevos
  wahaCredentials: "waha",
  outboundWebhook: "wh",
  outboundDelivery: "whd",
  project: "prj",
  projectStageEvent: "prje",
  projectTask: "prjt",
  catalogProduct: "cat",
  quote: "qt",
  quoteItem: "qti",
  quoteEvent: "qte",
  charge: "chr",
  payment: "pay",
  expense: "exp",
  emailAccount: "emac",
  emailMessage: "emmsg",
  supplier: "sup",
  chatbotConversation: "cbc",
  chatbotMessage: "cbm",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}
