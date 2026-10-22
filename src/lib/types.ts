/** DTOs que viajan por la API interna (lado cliente). */

import type { Channel } from "@/lib/channels";
import type { MediumValue } from "@/lib/contact-medium";

export type ConversationDto = {
  id: string;
  /** 014: canal de la conversacion, para el distintivo de la bandeja. */
  channel: Channel;
  contact: { id: string; name: string; phone: string | null };
  stageName: string | null;
  aiEnabled: boolean;
  /** El canal está encendido para la IA en Ajustes → Agente. */
  channelAiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  windowRemainingMs: number;
  /**
   * True cuando la ventana de 24 h ya pasó pero el canal aún acepta respuesta
   * con la etiqueta HUMAN_AGENT (Instagram/Messenger, hasta 7 días).
   * El operador puede enviar; el envío sale etiquetado.
   */
  humanAgentMode: boolean;
  preview: string | null;
};

/** 008 — Adjunto de un mensaje, para previsualización en el hilo. */
export type MessageMediaDto = {
  assetId: string;
  kind:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contacts";
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  caption: string | null;
  fetchStatus: "available" | "pending" | "failed";
  /** location {latitude, longitude, name?, address?} / contacts (subset). */
  payload: unknown;
};

/**
 * Contexto de un comentario público: la publicación sobre la que se comentó
 * y el autor. Viaja en el mensaje entrante para que el hilo muestre la
 * publicación UNA vez (tarjeta superior) en lugar de repetir el caption
 * dentro de cada burbuja.
 */
export type MessageCommentDto = {
  platform: "instagram" | "messenger" | "tiktok";
  externalCommentId: string;
  postExternalId: string;
  postCaption: string | null;
  authorName: string | null;
  /** Comentario al que responde, cuando es una respuesta dentro del hilo. */
  parentExternalId: string | null;
  /** Enlace a la publicación original cuando la plataforma lo permite. */
  postUrl: string | null;
};

export type MessageDto = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  /** Motivo del fallo en lenguaje llano cuando status = "failed". */
  error: string | null;
  aiGenerated: boolean;
  /** 008 — Origen del saliente (en entrantes viene 'operator' y se ignora). */
  origin: "ai" | "operator" | "manual" | "template";
  media: MessageMediaDto | null;
  /** Presente solo en mensajes entrantes del canal Comentarios. */
  comment: MessageCommentDto | null;
  createdAt: string;
};

/**
 * Tipo de etapa del pipeline. `qualified` marca la etapa que el dueño define
 * como "lead calificado" y alimenta el embudo (CPQL, prospecto→calificado).
 * `won`/`lost` son anclas terminales; `open`/`qualified` son etapas de avance.
 */
export type StageKind = "open" | "qualified" | "won" | "lost";

export type StageDto = {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
};

/** Un dato de la ficha. Escalar a propósito: ver `server/bot/ficha`. */
export type FichaValue = string | number | boolean;

/**
 * Ficha de calificación del lead. Claves libres: cada negocio califica
 * distinto, así que las define quien pregunta —el agente o el dueño— y el CRM
 * no las cablea.
 */
export type FichaDto = Record<string, FichaValue>;

export type ContactDto = {
  id: string;
  name: string;
  /** null en contactos que llegaron solo con BSUID (003). */
  phone: string | null;
  notes: string | null;
  /** Canal de transporte: whatsapp, instagram, messenger, tiktok, etc. */
  channel: string;
  /** Etapa del embudo del lead asociado; null si el contacto no tiene lead. */
  stageName: string | null;
  /** Monto del lead asociado (centavos); null si no se ha calificado. */
  amountCents: number | null;
  archivedAt: string | null;
  /** De dónde salió el prospecto, capturada o deducida. */
  source?: SourceDto;
  /** Detalle de la compra, solo cuando la fuente es "compra". */
  purchaseProduct?: string | null;
  purchaseDate?: string | null;
  purchaseAmountCents?: number | null;
  /** Por qué canal llegó la primera conversación; null mientras no se capture. */
  medium?: MediumValue | null;
  /** La red social elegida, solo cuando `medium = "red_social"`. */
  mediumDetail?: string | null;
  /** Prioridad del lead asociado; null si nadie la fijó. */
  priority?: PriorityValue | null;
  /** Lo que se sabe del lead. `{}` mientras nadie haya calificado. */
  ficha?: FichaDto;
  /** Cuándo aceptó recibir plantillas de marketing por WhatsApp (opt-in Meta). */
  waMarketingOptInAt?: string | null;
  /** Cómo se obtuvo ese consentimiento. */
  waMarketingOptInSource?: string | null;
};

/* ============================================================
 * Prospectos (bandeja → dueño)
 * ============================================================ */

/**
 * Fila de la pantalla de Prospectos: todo el que escribió al menos un mensaje
 * entrante, por chat o por correo.
 *
 * Las de chat se derivan de `contact` + `conversation` + `message`; las de
 * correo, de `email_message` agrupadas por remitente. Un remitente de correo
 * NO es un contacto hasta que el dueño lo dé de alta (`email_message.contact_id`
 * se queda en NULL en la ingesta), así que `contactId` y `conversationId` son
 * nullables a propósito: la pantalla muestra a la persona aunque el CRM aún no
 * tenga ficha de ella.
 */
export type ProspectDto = {
  /** null cuando el prospecto solo existe como remitente de correo. */
  contactId: string | null;
  name: string;
  /** null mientras el cliente no deje su número en el chat. */
  phone: string | null;
  channel: string;
  channelLabel: string;
  /** Hilo real del contacto: enlaza la fila con Bandeja (`/inbox?contact=`). */
  conversationId: string | null;
  /** Dirección de la persona cuando el prospecto vino del correo. */
  email: string | null;
  firstInboundAt: string | null;
  lastInboundAt: string | null;
  inboundCount: number;
  /** Último mensaje entrante, para ver si ya dejó datos o solo pregunta. */
  lastInboundText: string | null;
  archivedAt: string | null;
  /** Fecha del descarte; null si la tarjeta no está descartada. */
  dismissedAt: string | null;
  stageName: string | null;
  priority: PriorityValue | null;
  amountCents: number | null;
};

/* ============================================================
 * Bitácora de etapas
 * ============================================================ */

/** Por qué se perdió un trato. Lista corta a propósito: una taxonomía larga
 *  se responde "otro" y deja de informar. */
export type LossReason =
  | "precio"
  | "no_es_perfil"
  | "sin_presupuesto"
  | "eligio_otro"
  | "nunca_contesto"
  | "otro";

export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  precio: "Le pareció caro",
  no_es_perfil: "No era el perfil",
  sin_presupuesto: "Sin presupuesto ahora",
  eligio_otro: "Se fue con otro",
  nunca_contesto: "Nunca contestó",
  otro: "Otro",
};

/** Quién provocó un movimiento de etapa. */
export type StageChangeSource = "dueno" | "bot" | "sistema" | "migracion";

/* ============================================================
 * Fuente del prospecto
 * ============================================================ */

export type SourceValue =
  | "anuncio"
  | "organico"
  | "referido"
  | "conocido"
  | "compra"
  | "otro";

export type SourceDto = {
  /** "desconocida" cuando nadie la capturó y no se pudo deducir. */
  value: SourceValue | "desconocida";
  /** `deducida` = la infirió el sistema; `capturada` = la puso el dueño. */
  source: "capturada" | "deducida";
};

/* ============================================================
 * Proveedores
 * ============================================================ */

export const SUPPLIER_CATEGORIES = [
  { value: "servicios", label: "Servicios" },
  { value: "materiales", label: "Materiales" },
  { value: "tecnologia", label: "Tecnologia" },
  { value: "logistica", label: "Logistica" },
  { value: "profesionales", label: "Profesionales" },
  { value: "otro", label: "Otro" },
] as const;

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number]["value"];

export type SupplierDto = {
  id: string;
  name: string;
  tradeName: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  rfc: string | null;
  address: string | null;
  website: string | null;
  category: string | null;
  paymentTerms: string | null;
  rating: number | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ============================================================
 * Sucursales e inventario por sucursal
 * ============================================================ */

export type BranchDto = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  /** Productos enlazados, aunque su cantidad sea 0. */
  skuCount: number;
  /** Suma de piezas de todos los productos enlazados. */
  totalUnits: number;
  updatedAt: string;
};

export type BranchInventoryDto = {
  id: string;
  productId: string;
  name: string;
  price: number;
  currency: string;
  /** Stock general del catálogo (el del cotizador), no el de la sucursal. */
  stock: number | null;
  available: boolean;
  quantity: number;
  updatedAt: string;
};

/* ============================================================
 * Prioridad del lead
 * ============================================================ */

/** La fija el dueño; NULL = nadie la ha decidido (no es "media"). */
export type PriorityValue = "alta" | "media" | "baja";
