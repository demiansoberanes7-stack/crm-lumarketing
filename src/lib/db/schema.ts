import { eq, sql } from "drizzle-orm";
import type { AgentFichaField, AgentRules } from "@/lib/agent-config";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: varchar("image", { length: 1024 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: varchar("id", { length: 255 }).primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 1024 }),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: varchar("active_organization_id", { length: 255 }),
});

export const account = pgTable("account", {
  id: varchar("id", { length: 255 }).primaryKey(),
  accountId: varchar("account_id", { length: 255 }).notNull(),
  providerId: varchar("provider_id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: varchar("access_token", { length: 2048 }),
  refreshToken: varchar("refresh_token", { length: 2048 }),
  idToken: varchar("id_token", { length: 2048 }),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: varchar("scope", { length: 1024 }),
  password: varchar("password", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: varchar("id", { length: 255 }).primaryKey(),
  identifier: varchar("identifier", { length: 255 }).notNull(),
  value: varchar("value", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ============================================================
 * MCP OAuth (ChatGPT connection)
 * ============================================================ */

export const mcpAuthorizationCode = pgTable(
  "mcp_authorization_code",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    codeHash: varchar("code_hash", { length: 64 }).notNull().unique(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource").notNull(),
    codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
    codeChallengeMethod: varchar("code_challenge_method", { length: 10 })
      .notNull()
      .default("S256"),
    scopes: text("scopes").notNull(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("mcp_auth_code_expiry_idx").on(t.expiresAt)]
);

export const mcpAccessToken = pgTable(
  "mcp_access_token",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    clientId: text("client_id").notNull(),
    resource: text("resource").notNull(),
    scopes: text("scopes").notNull(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("mcp_access_token_expiry_idx").on(t.expiresAt)]
);

export const mcpOauthClient = pgTable("mcp_oauth_client", {
  id: varchar("id", { length: 255 }).primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name"),
  redirectUris: text("redirect_uris").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).unique(),
  logo: varchar("logo", { length: 1024 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});

export const member = pgTable("member", {
  id: varchar("id", { length: 255 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 255 })
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: varchar("id", { length: 255 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 255 })
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: varchar("inviter_id", { length: 255 })
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 20 })
      .notNull()
      .default("whatsapp"),
    waIdentity: varchar("wa_identity", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    waUserId: varchar("wa_user_id", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    nameSource: varchar("name_source", { length: 20 })
      .notNull()
      .default("perfil"),
    notes: text("notes"),
    ficha: jsonb("ficha"),
    source: varchar("source", { length: 20 }),
    /** Producto comprado, solo cuando `source = 'compra'`. */
    purchaseProduct: varchar("purchase_product", { length: 255 }),
    /** Fecha de la compra, solo cuando `source = 'compra'`. */
    purchaseDate: timestamp("purchase_date"),
    /** Monto de la compra en centavos (el del lead es el del trato en curso). */
    purchaseAmountCents: integer("purchase_amount_cents"),
    /** Cómo se contactó: red social, llamada, correo o presencial (lib/contact-medium). */
    medium: varchar("medium", { length: 30 }),
    /** La red social elegida, solo cuando `medium = 'red_social'`. */
    mediumDetail: varchar("medium_detail", { length: 60 }),
    /** Canal de adquisición normalizado (catálogo `acquisition_channel`). */
    acquisitionChannelId: varchar("acquisition_channel_id", { length: 255 }).references(
      () => acquisitionChannel.id,
      { onDelete: "set null" }
    ),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_org_channel_identity_uq").on(
      t.organizationId,
      t.channel,
      t.waIdentity
    ),
    index("contact_org_wa_user_id_idx").on(t.organizationId, t.waUserId),
    index("contact_org_name_idx").on(t.organizationId, t.name),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    position:   integer("position").notNull(),
    kind: varchar("kind", { length: 20 })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 })
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: varchar("stage_id", { length: 255 })
      .notNull()
      .references(() => pipelineStage.id),
    position:   integer("position").notNull().default(0),
    amountCents:   integer("amount_cents"),
    currency: varchar("currency", { length: 10 }),
    priority: varchar("priority", { length: 20 }),
    priorityUpdatedAt: timestamp("priority_updated_at"),
    lastActivityAt: timestamp("last_activity_at"),
    /** Lead principal del contacto (las rutas 1:1 existentes operan sobre él). */
    isPrimary: boolean("is_primary").notNull().default(true),
    /** Cuándo se calificó, si lo estuvo. */
    qualifiedAt: timestamp("qualified_at"),
    /** Qué criterios de calificación se cumplieron (jsonb). */
    qualificationData: jsonb("qualification_data"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

export const leadStageEvent = pgTable(
  "lead_stage_event",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: varchar("lead_id", { length: 255 })
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 })
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    fromStageId: varchar("from_stage_id", { length: 255 }).references(
      () => pipelineStage.id,
      { onDelete: "set null" }
    ),
    fromStageName: varchar("from_stage_name", { length: 255 }),
    toStageId: varchar("to_stage_id", { length: 255 }).references(
      () => pipelineStage.id,
      { onDelete: "set null" }
    ),
    toStageName: varchar("to_stage_name", { length: 255 }).notNull(),
    toStageKind: varchar("to_stage_kind", { length: 20 })
      .notNull()
      .default("open"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    actorUserId: varchar("actor_user_id", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    source: varchar("source", { length: 20 })
      .notNull()
      .default("dueno"),
    approximate: boolean("approximate").notNull().default(false),
    lossReason: varchar("loss_reason", { length: 30 }),
    lossNote: text("loss_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("lse_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("lse_lead_occurred_idx").on(t.leadId, t.occurredAt),
    index("lse_org_kind_occurred_idx").on(
      t.organizationId,
      t.toStageKind,
      t.occurredAt
    ),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 })
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    isTest: boolean("is_test").notNull().default(false),
    channel: varchar("channel", { length: 20 })
      .notNull()
      .default("whatsapp"),
    channelThreadRef: varchar("channel_thread_ref", { length: 255 }),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: varchar("handoff_reason", { length: 30 }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount:   integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
    uniqueIndex("conversation_org_contact_real_idx")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
  ]
);

export const message = pgTable(
  "message",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 255 })
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    waMessageId: varchar("wa_message_id", { length: 255 }).unique(),
    provider: varchar("provider", { length: 20 }),
    providerAccount: varchar("provider_account", { length: 255 }),
    providerMessageId: text("provider_message_id"),
    direction: varchar("direction", { length: 10 }).notNull(),
    type: varchar("type", { length: 50 }).notNull().default("text"),
    text: text("text"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending"),
    error: text("error"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    origin: varchar("origin", { length: 20 })
      .notNull()
      .default("operator"),
    mediaAssetId: varchar("media_asset_id", { length: 255 }).references(
      () => mediaAsset.id,
      { onDelete: "set null" }
    ),
    waTimestamp: timestamp("wa_timestamp"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
  ]
);

/** Durable follow-up queue and source of truth for automation metrics. */
export const automationExecution = pgTable(
  "automation_execution",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 255 })
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    ruleId: varchar("rule_id", { length: 80 }).notNull(),
    triggeredBy: varchar("triggered_by", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    scheduledAt: timestamp("scheduled_at").notNull(),
    startedAt: timestamp("started_at"),
    sentAt: timestamp("sent_at"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("automation_execution_due_idx").on(t.status, t.scheduledAt),
    index("automation_execution_org_sent_idx").on(t.organizationId, t.sentAt),
    index("automation_execution_conversation_idx").on(t.conversationId, t.createdAt),
    // El dedup de enqueueFollowUp era SELECT-then-INSERT: dos eventos
    // simultáneos pasaban la revisión y colaban el mismo seguimiento dos
    // veces. El índice único parcial cierra la carrera en la propia BD
    // (una sola ejecución activa por regla y conversación).
    uniqueIndex("automation_execution_active_uq")
      .on(t.organizationId, t.conversationId, t.ruleId)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ]
);

export const mediaAsset = pgTable(
  "media_asset",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    waMediaId: varchar("wa_media_id", { length: 255 }),
    provider: varchar("provider", { length: 20 }),
    providerRef: text("provider_ref"),
    providerAccount: varchar("provider_account", { length: 255 }),
    mimeType: varchar("mime_type", { length: 255 }),
    fileName: varchar("file_name", { length: 512 }),
    fileSize:   integer("file_size"),
    caption: text("caption"),
    payload: jsonb("payload"),
    storagePath: varchar("storage_path", { length: 512 }),
    fetchStatus: varchar("fetch_status", { length: 20 })
      .notNull()
      .default("pending"),
    fetchError: text("fetch_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("media_asset_org_idx").on(t.organizationId, t.createdAt),
    index("media_asset_wa_media_idx").on(t.waMediaId),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: varchar("waba_id", { length: 255 }).notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 255 }).notNull(),
    displayPhoneNumber: varchar("display_phone_number", { length: 50 }),
    verifiedName: varchar("verified_name", { length: 255 }),
    tokenCipher: varchar("token_cipher", { length: 1024 }).notNull(),
    tokenIv: varchar("token_iv", { length: 255 }).notNull(),
    tokenTag: varchar("token_tag", { length: 255 }).notNull(),
    status: varchar("status", { length: 30 })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
  ]
);

export const instagramCredentials = pgTable(
  "instagram_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 20 }).notNull(),
    igUserId: varchar("ig_user_id", { length: 255 }).notNull(),
    accountRef: varchar("account_ref", { length: 255 }),
    username: varchar("username", { length: 255 }),
    tokenCipher: varchar("token_cipher", { length: 1024 }).notNull(),
    tokenIv: varchar("token_iv", { length: 255 }).notNull(),
    tokenTag: varchar("token_tag", { length: 255 }).notNull(),
    webhookSecret: varchar("webhook_secret", { length: 255 }),
    status: varchar("status", { length: 30 })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instagram_credentials_org_uq").on(t.organizationId),
    uniqueIndex("instagram_credentials_ig_user_uq").on(t.igUserId),
    index("instagram_credentials_account_ref_idx").on(t.accountRef),
  ]
);

export const messengerCredentials = pgTable(
  "messenger_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 20 })
      .notNull()
      .default("meta"),
    pageId: varchar("page_id", { length: 255 }),
    pageName: varchar("page_name", { length: 255 }),
    accountRef: varchar("account_ref", { length: 255 }),
    tokenCipher: varchar("token_cipher", { length: 1024 }).notNull(),
    tokenIv: varchar("token_iv", { length: 255 }).notNull(),
    tokenTag: varchar("token_tag", { length: 255 }).notNull(),
    webhookSecret: varchar("webhook_secret", { length: 255 }),
    status: varchar("status", { length: 30 })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messenger_credentials_org_uq").on(t.organizationId),
    uniqueIndex("messenger_credentials_page_uq").on(t.pageId),
    index("messenger_credentials_account_ref_idx").on(t.accountRef),
  ]
);

export const tiktokCredentials = pgTable(
  "tiktok_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 20 }).notNull().default("zernio"),
    tiktokUserId: varchar("tiktok_user_id", { length: 255 }),
    username: varchar("username", { length: 255 }),
    accountRef: varchar("account_ref", { length: 255 }),
    tokenCipher: varchar("token_cipher", { length: 1024 }).notNull(),
    tokenIv: varchar("token_iv", { length: 255 }).notNull(),
    tokenTag: varchar("token_tag", { length: 255 }).notNull(),
    webhookSecret: varchar("webhook_secret", { length: 255 }),
    status: varchar("status", { length: 30 })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tiktok_credentials_org_uq").on(t.organizationId),
    index("tiktok_credentials_account_ref_idx").on(t.accountRef),
  ]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: varchar("name", { length: 255 }).notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    pipelineKeywords: text("pipeline_keywords"),
    fichaFields: jsonb("ficha_fields").$type<AgentFichaField[]>().notNull().default(sql`'[{"key":"interes","label":"Interés"},{"key":"presupuesto","label":"Presupuesto"},{"key":"ubicacion","label":"Ubicación"},{"key":"plazo","label":"Plazo"},{"key":"preferencias","label":"Preferencias"}]'::jsonb`),
    rules: jsonb("rules").$type<AgentRules>().notNull().default(sql`'{"captureLeadData":true,"sendProductQuotes":true,"handoffOnRequest":true,"moveStageOnIntent":true,"strictKnowledgeBase":true}'::jsonb`),
    aiToken: text("ai_token"),
    aiTokenCipher: text("ai_token_cipher"),
    aiTokenIv: text("ai_token_iv"),
    aiTokenTag: text("ai_token_tag"),
    aiModel: varchar("ai_model", { length: 255 }),
    // LUMARK — configuraciones extra del bot
    maxResponseWaitSeconds: integer("max_response_wait_seconds").notNull().default(12),
    responseLanguage: varchar("response_language", { length: 20 }).notNull().default("auto"),
    fallbackLanguage: varchar("fallback_language", { length: 20 }).notNull().default("es"),
    reactWithEmoji: boolean("react_with_emoji").notNull().default(false),
    activeInNewConversations: boolean("active_in_new_conversations").notNull().default(true),
    businessIndustry: varchar("business_industry", { length: 100 }),
    businessLocation: varchar("business_location", { length: 255 }),
    businessDescription: text("business_description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("running"),
    score:   integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
    index("test_run_org_status_idx").on(t.organizationId, t.status),
    uniqueIndex("one_running_run_per_org")
      .on(t.organizationId)
      .where(eq(t.status, "running")),
  ]
);

/* ============================================================
 * 015 — Motor de agenda (detrás de la bandera AGENDA)
 * ============================================================ */

export const calendarSettings = pgTable(
  "calendar_settings",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    weeklyHours: jsonb("weekly_hours").notNull(),
    slotMinutes:   integer("slot_minutes").notNull().default(30),
    bufferMinutes:   integer("buffer_minutes").notNull().default(0),
    minNoticeHours:   integer("min_notice_hours").notNull().default(2),
    maxDaysAhead:   integer("max_days_ahead").notNull().default(7),
    timezone: varchar("timezone", { length: 50 })
      .notNull()
      .default("America/Mexico_City"),
    connector: varchar("connector", { length: 50 })
      .notNull()
      .default("enlace-fijo"),
    meetingLink: varchar("meeting_link", { length: 1024 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_settings_org_uq").on(t.organizationId)]
);

export const booking = pgTable(
  "booking",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 })
      .notNull()
      .default("session"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("agendada"),
    source: varchar("source", { length: 20 })
      .notNull()
      .default("manual"),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    projectId: varchar("project_id", { length: 255 }).references(
      () => project.id,
      { onDelete: "set null" }
    ),
    conversationId: varchar("conversation_id", { length: 255 }).references(
      () => conversation.id,
      { onDelete: "set null" }
    ),
    leadId: varchar("lead_id", { length: 255 }).references(() => lead.id, {
      onDelete: "set null",
    }),
    scheduledAt: timestamp("scheduled_at").notNull(),
    durationMinutes:   integer("duration_minutes").notNull(),
    connector: varchar("connector", { length: 50 }),
    externalRef: varchar("external_ref", { length: 255 }),
    meetingLink: varchar("meeting_link", { length: 1024 }),
    linkPending: boolean("link_pending").notNull().default(false),
    isTest: boolean("is_test").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("booking_org_when_idx").on(t.organizationId, t.scheduledAt),
    index("booking_project_idx").on(t.projectId),
    index("booking_org_status_idx").on(t.organizationId, t.status),
    uniqueIndex("booking_org_active_slot_idx")
      .on(t.organizationId, t.scheduledAt)
      .where(sql`${t.status} = 'agendada' AND ${t.isTest} = false`),
  ]
);

export const offeredSlot = pgTable(
  "offered_slot",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 255 })
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    startUtc: timestamp("start_utc").notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    offeredAt: timestamp("offered_at").notNull().defaultNow(),
  },
  (t) => [index("offered_slot_conv_idx").on(t.conversationId, t.startUtc)]
);

export const zoomCredentials = pgTable(
  "zoom_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    secretCipher: varchar("secret_cipher", { length: 1024 }).notNull(),
    secretIv: varchar("secret_iv", { length: 255 }).notNull(),
    secretTag: varchar("secret_tag", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("zoom_credentials_org_uq").on(t.organizationId)]
);

export const googleCredentials = pgTable(
  "google_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    clientSecretCipher: varchar("client_secret_cipher", { length: 1024 }).notNull(),
    clientSecretIv: varchar("client_secret_iv", { length: 255 }).notNull(),
    clientSecretTag: varchar("client_secret_tag", { length: 255 }).notNull(),
    refreshTokenCipher: varchar("refresh_token_cipher", { length: 1024 }).notNull(),
    refreshTokenIv: varchar("refresh_token_iv", { length: 255 }).notNull(),
    refreshTokenTag: varchar("refresh_token_tag", { length: 255 }).notNull(),
    calendarId: varchar("calendar_id", { length: 255 })
      .notNull()
      .default("primary"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("connected"),
    syncTasks: boolean("sync_tasks").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("google_credentials_org_uq").on(t.organizationId)]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: varchar("run_id", { length: 255 })
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: varchar("persona", { length: 255 }).notNull(),
    conversationId: varchar("conversation_id", { length: 255 }).references(
      () => conversation.id,
      { onDelete: "set null" }
    ),
    transcript: jsonb("transcript"),
    veredicto: varchar("veredicto", { length: 20 }),
    hallazgos: jsonb("hallazgos"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * 016 — Atribución de anuncios y Conversions API
 * ============================================================ */

export const adAttribution = pgTable(
  "ad_attribution",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 })
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 255 })
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    ctwaClid: varchar("ctwa_clid", { length: 255 }),
    sourceId: varchar("source_id", { length: 255 }),
    sourceType: varchar("source_type", { length: 50 }),
    sourceUrl: varchar("source_url", { length: 1024 }),
    headline: varchar("headline", { length: 512 }),
    body: text("body"),
    mediaType: varchar("media_type", { length: 50 }),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_attribution_org_conversation_uq").on(
      t.organizationId,
      t.conversationId
    ),
    index("ad_attribution_org_contact_idx").on(t.organizationId, t.contactId),
  ]
);

export const conversionEvent = pgTable(
  "conversion_event",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 255 })
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    attributionId: varchar("attribution_id", { length: 255 }).references(
      () => adAttribution.id,
      { onDelete: "set null" }
    ),
    eventName: varchar("event_name", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending"),
    error: text("error"),
    fbTraceId: varchar("fb_trace_id", { length: 255 }),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversion_event_org_conv_name_uq").on(
      t.organizationId,
      t.conversationId,
      t.eventName
    ),
    index("conversion_event_org_created_idx").on(
      t.organizationId,
      t.createdAt
    ),
  ]
);

export const capiSettings = pgTable(
  "capi_settings",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    datasetId: varchar("dataset_id", { length: 255 }).notNull(),
    tokenCipher: varchar("token_cipher", { length: 1024 }).notNull(),
    tokenIv: varchar("token_iv", { length: 255 }).notNull(),
    tokenTag: varchar("token_tag", { length: 255 }).notNull(),
    qualifiedStageId: varchar("qualified_stage_id", { length: 255 }).references(
      () => pipelineStage.id,
      { onDelete: "set null" }
    ),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("capi_settings_org_uq").on(t.organizationId)]
);

/* ============================================================
 * WAHA — Credenciales del adaptador WhatsApp HTTP
 * ============================================================ */

export const wahaCredentials = pgTable(
  "waha_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    baseUrl: varchar("base_url", { length: 1024 }).notNull(),
    apiKeyCipher: varchar("api_key_cipher", { length: 1024 }).notNull(),
    apiKeyIv: varchar("api_key_iv", { length: 255 }).notNull(),
    apiKeyTag: varchar("api_key_tag", { length: 255 }).notNull(),
    sessionName: varchar("session_name", { length: 100 }).notNull().default("default"),
    status: varchar("status", { length: 30 })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("waha_credentials_org_uq").on(t.organizationId),
  ]
);

/* ============================================================
 * Webhooks salientes — configurables por organización
 * ============================================================ */

export const outboundWebhook = pgTable(
  "outbound_webhook",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    url: varchar("url", { length: 1024 }).notNull(),
    secretCipher: varchar("secret_cipher", { length: 1024 }),
    secretIv: varchar("secret_iv", { length: 255 }),
    secretTag: varchar("secret_tag", { length: 255 }),
    events: jsonb("events").notNull(),
    active: boolean("active").notNull().default(true),
    maxRetries:   integer("max_retries").notNull().default(3),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("outbound_webhook_org_idx").on(t.organizationId),
  ]
);

export const outboundDelivery = pgTable(
  "outbound_delivery",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    webhookId: varchar("webhook_id", { length: 255 })
      .notNull()
      .references(() => outboundWebhook.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending"),
    attempts:   integer("attempts").notNull().default(0),
    lastStatusCode:   integer("last_status_code"),
    lastError: text("last_error"),
    nextRetryAt: timestamp("next_retry_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
  },
  (t) => [
    index("outbound_delivery_org_idx").on(t.organizationId, t.createdAt),
    index("outbound_delivery_webhook_idx").on(t.webhookId),
    index("outbound_delivery_status_idx").on(t.status, t.nextRetryAt),
  ]
);

/* ============================================================
 * Proyectos — seguimiento de proyectos de clientes
 * ============================================================ */

export const projectStage = pgTable("project_stage", {
  id: varchar("id", { length: 255 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 255 }).notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  position: integer("position").notNull(),
}, (t) => [uniqueIndex("project_stage_org_position_uq").on(t.organizationId, t.position)]);

export const project = pgTable(
  "project",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    service: varchar("service", { length: 100 }),
    estado: varchar("estado", { length: 20 })
      .notNull()
      .default("activo"),
    /** Clave del tipo en `src/lib/project-types.ts` (marketing|maintenance|web_service|…). */
    projectType: varchar("project_type", { length: 50 })
      .notNull()
      .default("marketing"),
    /** Workflow del expediente (borrador|planeacion|en_proceso|en_revision|completado|cancelado). */
    status: varchar("status", { length: 20 })
      .notNull()
      .default("borrador"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    stageId: varchar("stage_id", { length: 255 }).references(
      () => projectStage.id,
      { onDelete: "set null" }
    ),
    avance:   integer("avance").notNull().default(0),
    prioridad: varchar("prioridad", { length: 20 }),
    riesgo: varchar("riesgo", { length: 20 }),
    notas: text("notas"),
    assignedUserId: varchar("assigned_user_id", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    nextMeetingAt: timestamp("next_meeting_at"),
    archivedAt: timestamp("archived_at"),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_org_code_uq").on(t.organizationId, t.code),
    index("project_org_idx").on(t.organizationId),
    index("project_contact_idx").on(t.contactId),
    index("project_org_type_idx").on(t.organizationId, t.projectType),
  ]
);

/** Pasos del expediente: un registro por paso del stepper del proyecto. */
export const projectStep = pgTable(
  "project_step",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: varchar("project_id", { length: 255 })
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    stepKey: varchar("step_key", { length: 100 }).notNull(),
    position: integer("position").notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pendiente"),
    data: jsonb("data").notNull().default({}),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_step_project_key_uq").on(t.projectId, t.stepKey),
    index("project_step_org_idx").on(t.organizationId),
    index("project_step_project_idx").on(t.projectId),
  ]
);

export const projectStageEvent = pgTable(
  "project_stage_event",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: varchar("project_id", { length: 255 })
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    fromStageId: varchar("from_stage_id", { length: 255 }).references(
      () => projectStage.id,
      { onDelete: "set null" }
    ),
    fromStageName: varchar("from_stage_name", { length: 255 }),
    toStageId: varchar("to_stage_id", { length: 255 }).references(
      () => projectStage.id,
      { onDelete: "set null" }
    ),
    toStageName: varchar("to_stage_name", { length: 255 }).notNull(),
    actorUserId: varchar("actor_user_id", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    source: varchar("source", { length: 20 })
      .notNull()
      .default("dueno"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_stage_event_org_idx").on(t.organizationId, t.createdAt),
    index("project_stage_event_project_idx").on(t.projectId, t.createdAt),
  ]
);

export const projectTask = pgTable(
  "project_task",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: varchar("project_id", { length: 255 })
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    assigneeId: varchar("assignee_id", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    priority: varchar("priority", { length: 20 }),
    estado: varchar("estado", { length: 20 })
      .notNull()
      .default("pendiente"),
    dueDate: timestamp("due_date"),
    googleEventId: varchar("google_event_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_task_org_idx").on(t.organizationId),
    index("project_task_project_idx").on(t.projectId),
  ]
);

/**
 * Productos / servicios entregados en el expediente: la sección que imprime
 * el PDF. Un solo renglón por partida (nombre, cantidad, precio), sin
 * versionado — el cotizador es quien maneja versiones.
 */
export const projectItem = pgTable(
  "project_item",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: varchar("project_id", { length: 255 })
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull().default(1),
    /** Centavos, como en quote_item. */
    unitPrice: integer("unit_price").notNull().default(0),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_item_org_idx").on(t.organizationId),
    index("project_item_project_idx").on(t.projectId),
  ]
);

/* ============================================================
 * Cotizador — catálogo y cotizaciones versionadas
 * ============================================================ */

export const catalogProduct = pgTable(
  "catalog_product",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    shortDescription: varchar("short_description", { length: 500 }),
    longDescription: text("long_description"),
    /** URL pública del producto (sitio web, marketplace, tienda). */
    websiteUrl: varchar("website_url", { length: 1024 }),
    /** Piezas disponibles. null = sin control de inventario (mostrar "consultar"). */
    stock: integer("stock"),
    price:   integer("price").notNull().default(0),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    available: boolean("available").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("catalog_product_org_idx").on(t.organizationId),
  ]
);

export const quote = pgTable(
  "quote",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    quoteNumber: varchar("quote_number", { length: 50 }).notNull(),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("draft"),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    validUntil: timestamp("valid_until"),
    subtotal:   integer("subtotal").notNull().default(0),
    discountType: varchar("discount_type", { length: 20 }),
    discountValue:   integer("discount_value"),
    discountAmount:   integer("discount_amount").notNull().default(0),
    taxRate:   integer("tax_rate").notNull().default(16),
    taxAmount:   integer("tax_amount").notNull().default(0),
    total:   integer("total").notNull().default(0),
    paymentPlan: jsonb("payment_plan"),
    paymentMethod: jsonb("payment_method"),
    sendChannel: varchar("send_channel", { length: 20 }),
    message: text("message"),
    version:   integer("version").notNull().default(1),
    lockedAt: timestamp("locked_at"),
    createdBy: varchar("created_by", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    uniqueIndex("quote_org_number_uq").on(t.organizationId, t.quoteNumber),
    index("quote_org_idx").on(t.organizationId),
    index("quote_contact_idx").on(t.contactId),
  ]
);

export const whatsappZernio = pgTable("whatsapp_zernio", {
  organizationId: varchar("organization_id", { length: 255 }).primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  accountId: varchar("account_id", { length: 255 }).notNull().unique(),
  cipher: text("cipher").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const quoteItem = pgTable(
  "quote_item",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    quoteId: varchar("quote_id", { length: 255 })
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    productId: varchar("product_id", { length: 255 }).references(
      () => catalogProduct.id,
      { onDelete: "set null" }
    ),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    quantity:   integer("quantity").notNull().default(1),
    unitPrice:   integer("unit_price").notNull().default(0),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    position:   integer("position").notNull().default(0),
  },
  (t) => [
    index("quote_item_quote_idx").on(t.quoteId),
    index("quote_item_org_idx").on(t.organizationId),
  ]
);

export const quoteEvent = pgTable(
  "quote_event",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    quoteId: varchar("quote_id", { length: 255 })
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    channel: varchar("channel", { length: 20 }),
    actorId: varchar("actor_id", { length: 255 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("quote_event_org_idx").on(t.organizationId, t.createdAt),
    index("quote_event_quote_idx").on(t.quoteId),
  ]
);

/* ============================================================
 * Cobranza — cuentas por cobrar, pagos y gastos
 * ============================================================ */

export const charge = pgTable(
  "charge",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    quoteId: varchar("quote_id", { length: 255 }).references(
      () => quote.id,
      { onDelete: "set null" }
    ),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    concept: varchar("concept", { length: 255 }).notNull(),
    totalAmount:   integer("total_amount").notNull().default(0),
    paidAmount:   integer("paid_amount").notNull().default(0),
    dueDate: timestamp("due_date"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pendiente"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("charge_org_idx").on(t.organizationId),
    index("charge_contact_idx").on(t.contactId),
    index("charge_status_idx").on(t.status),
    uniqueIndex("charge_quote_uq").on(t.organizationId, t.quoteId),
  ]
);

export const payment = pgTable(
  "payment",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    chargeId: varchar("charge_id", { length: 255 }).references(
      () => charge.id,
      { onDelete: "set null" }
    ),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    fecha: timestamp("fecha").notNull().defaultNow(),
    monto:   integer("monto").notNull(),
    metodo: varchar("metodo", { length: 50 }).notNull(),
    referencia: varchar("referencia", { length: 255 }),
    comprobanteUrl: varchar("comprobante_url", { length: 1024 }),
    notas: text("notas"),
    createdBy: varchar("created_by", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("payment_org_idx").on(t.organizationId),
    index("payment_charge_idx").on(t.chargeId),
    index("payment_fecha_idx").on(t.fecha),
  ]
);

export const expense = pgTable(
  "expense",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fecha: timestamp("fecha").notNull().defaultNow(),
    descripcion: varchar("descripcion", { length: 255 }).notNull(),
    categoria: varchar("categoria", { length: 100 }).notNull(),
    proveedor: varchar("proveedor", { length: 255 }),
    monto:   integer("monto").notNull(),
    metodo: varchar("metodo", { length: 50 }).notNull(),
    referencia: varchar("referencia", { length: 255 }),
    comprobanteUrl: varchar("comprobante_url", { length: 1024 }),
    notas: text("notas"),
    createdBy: varchar("created_by", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("expense_org_idx").on(t.organizationId),
    index("expense_fecha_idx").on(t.fecha),
    index("expense_categoria_idx").on(t.categoria),
  ]
);

/* ============================================================
 * Buzón Hostinger — cuentas de correo IMAP/SMTP
 * ============================================================ */

export const emailAccount = pgTable(
  "email_account",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 255 }).notNull(),
    emailAddress: varchar("email_address", { length: 255 }).notNull(),
    fromName: varchar("from_name", { length: 255 }),
    smtpHost: varchar("smtp_host", { length: 255 }).notNull(),
    smtpPort:   integer("smtp_port").notNull().default(465),
    smtpSecure: boolean("smtp_secure").notNull().default(true),
    smtpUser: varchar("smtp_user", { length: 255 }).notNull(),
    smtpPassCipher: varchar("smtp_pass_cipher", { length: 1024 }).notNull(),
    smtpPassIv: varchar("smtp_pass_iv", { length: 255 }).notNull(),
    smtpPassTag: varchar("smtp_pass_tag", { length: 255 }).notNull(),
    imapHost: varchar("imap_host", { length: 255 }).notNull(),
    imapPort:   integer("imap_port").notNull().default(993),
    imapSecure: boolean("imap_secure").notNull().default(true),
    imapUser: varchar("imap_user", { length: 255 }).notNull(),
    imapPassCipher: varchar("imap_pass_cipher", { length: 1024 }).notNull(),
    imapPassIv: varchar("imap_pass_iv", { length: 255 }).notNull(),
    imapPassTag: varchar("imap_pass_tag", { length: 255 }).notNull(),
    signature: text("signature"),
    dailyLimit:   integer("daily_limit").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("email_account_org_idx").on(t.organizationId),
  ]
);

export const emailMessage = pgTable(
  "email_message",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 255 })
      .notNull()
      .references(() => emailAccount.id, { onDelete: "cascade" }),
    messageId: varchar("message_id", { length: 512 }).notNull(),
    threadId: varchar("thread_id", { length: 512 }),
    from: varchar("from_email", { length: 255 }).notNull(),
    to: jsonb("to").notNull(),
    cc: jsonb("cc"),
    subject: varchar("subject", { length: 1024 }),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    attachments: jsonb("attachments"),
    direction: varchar("direction", { length: 10 }).notNull(),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    campaignId: varchar("campaign_id", { length: 255 }),
    seen: boolean("seen").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_message_account_message_uq").on(t.accountId, t.messageId),
    index("email_message_org_idx").on(t.organizationId, t.createdAt),
    index("email_message_thread_idx").on(t.threadId),
    index("email_message_contact_idx").on(t.contactId),
  ]
);

/* ============================================================
 * CalTodo — tareas personales con vista de calendario
 * ============================================================ */

export const caltodoTask = pgTable(
  "caltodo_task",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 }).notNull(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    projectId: varchar("project_id", { length: 255 }).references(
      () => project.id,
      { onDelete: "set null" }
    ),
    title: varchar("title", { length: 200 }).notNull(),
    details: text("details"),
    urgent: boolean("urgent").notNull().default(false),
    duration: integer("duration"),
    scheduledStart: timestamp("scheduled_start"),
    scheduledEnd: timestamp("scheduled_end"),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at"),
    priority: integer("priority").notNull().default(0),
    googleEventId: varchar("google_event_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("caltodo_task_org_idx").on(t.organizationId, t.userId),
    index("caltodo_task_completed_idx").on(t.completed),
    index("caltodo_task_contact_idx").on(t.contactId),
  ]
);

export const caltodoSettings = pgTable(
  "caltodo_settings",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 }).notNull(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    workStartHour: integer("work_start_hour").notNull().default(9),
    workEndHour: integer("work_end_hour").notNull().default(17),
    timezone: varchar("timezone", { length: 64 }).notNull().default("America/Mexico_City"),
    defaultDuration: integer("default_duration").notNull().default(60),
  },
  (t) => [uniqueIndex("caltodo_settings_org_user_unique").on(t.organizationId, t.userId)]
);

/* ============================================================
 * Proveedores — directorio manual de proveedores del negocio
 * ============================================================ */

export const supplier = pgTable(
  "supplier",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    tradeName: varchar("trade_name", { length: 255 }),
    contactName: varchar("contact_name", { length: 255 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 254 }),
    rfc: varchar("rfc", { length: 20 }),
    address: varchar("address", { length: 500 }),
    website: varchar("website", { length: 254 }),
    category: varchar("category", { length: 50 }),
    paymentTerms: varchar("payment_terms", { length: 100 }),
    rating: integer("rating"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("supplier_org_idx").on(t.organizationId),
    index("supplier_org_name_idx").on(t.organizationId, t.name),
  ]
);

/* ============================================================
 * Integraciones — Google Ads, Meta Ads, GA4
 * ============================================================ */

export const integration = pgTable(
  "integration",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(), // 'google_ads', 'meta_ads', 'ga4'
    /**
     * Legado en claro: se conserva como fallback de lectura hasta correr
     * `scripts/encrypt-integrations.mjs`. Las escrituras nuevas van al triple
     * cifrado de abajo (AES-256-GCM, patrón 0007).
     */
    credentials: jsonb("credentials").notNull(),
    credentialsCipher: text("credentials_cipher"),
    credentialsIv: text("credentials_iv"),
    credentialsTag: text("credentials_tag"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("integration_org_provider_idx").on(t.organizationId, t.provider),
  ]
);

/* ============================================================
 * Reseñas de Google Business Profile (bandera GOOGLE_BUSINESS)
 * ============================================================ */

/**
 * Credenciales de la app OAuth de Google Cloud del negocio, con scope
 * `business.manage`. Mismo patrón que google_credentials (015): el dueño pega
 * clientId, clientSecret y refreshToken una sola vez; los secretos viajan
 * cifrados (AES-256-GCM, triple cipher/iv/tag).
 */
export const googleBusinessCredentials = pgTable(
  "google_business_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: varchar("client_id", { length: 512 }).notNull(),
    clientSecretCipher: text("client_secret_cipher").notNull(),
    clientSecretIv: text("client_secret_iv").notNull(),
    clientSecretTag: text("client_secret_tag").notNull(),
    refreshTokenCipher: text("refresh_token_cipher").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenTag: text("refresh_token_tag").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("connected"),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gb_credentials_org_uq").on(t.organizationId)]
);

/** Ubicaciones (locales) del negocio en Google Business Profile. */
export const googleBusinessLocation = pgTable(
  "google_business_location",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Resource name: `accounts/{a}/locations/{l}`. */
    name: varchar("name", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    averageRating: numeric("average_rating", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gb_location_org_name_uq").on(t.organizationId, t.name),
    index("gb_location_org_idx").on(t.organizationId),
  ]
);

/**
 * Reseñas públicas. Cada reseña es un mensaje entrante en la conversación del
 * reviewer (canal google_business); `reviewName` es el resource name y la
 * llave de idempotencia del poller.
 */
export const googleBusinessReview = pgTable(
  "google_business_review",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    locationId: varchar("location_id", { length: 255 })
      .notNull()
      .references(() => googleBusinessLocation.id, { onDelete: "cascade" }),
    /** Resource name: `accounts/{a}/locations/{l}/reviews/{r}`. */
    reviewName: varchar("review_name", { length: 255 }).notNull(),
    reviewerName: varchar("reviewer_name", { length: 255 }),
    /** Estrellas 1-5 de la API (ONE..FIVE normalizado a entero). */
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createTime: timestamp("create_time").notNull(),
    updateTime: timestamp("update_time"),
    /** Reply público actual (null = sin respuesta). */
    replyComment: text("reply_comment"),
    repliedAt: timestamp("replied_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gb_review_org_name_uq").on(t.organizationId, t.reviewName),
    index("gb_review_org_location_idx").on(t.organizationId, t.locationId),
  ]
);

/**
 * Credenciales OAuth de Mercado Libre (canal `mercado_libre`, mensajería
 * post-venta). Mismo patrón que google_business_credentials: el dueño pega
 * clientId, clientSecret y refreshToken; los secretos viven cifrados
 * (AES-256-GCM) y el access token de corta vida se refresca en el poller.
 */
export const marketplaceCredentials = pgTable(
  "marketplace_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** user_id de la cuenta vendedora (se guarda al conectar vía /users/me). */
    userId: varchar("user_id", { length: 64 }),
    /** Sitio del vendedor (MLM, MLB, MCO, MLC…). */
    siteId: varchar("site_id", { length: 16 }),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    clientSecretCipher: text("client_secret_cipher").notNull(),
    clientSecretIv: text("client_secret_iv").notNull(),
    clientSecretTag: text("client_secret_tag").notNull(),
    refreshTokenCipher: text("refresh_token_cipher").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenTag: text("refresh_token_tag").notNull(),
    /** Access token de corta vida; se refresca con el refresh token. */
    accessTokenCipher: text("access_token_cipher"),
    accessTokenIv: text("access_token_iv"),
    accessTokenTag: text("access_token_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    status: varchar("status", { length: 20 }).notNull().default("connected"),
    lastPolledAt: timestamp("last_polled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ml_credentials_org_uq").on(t.organizationId)]
);

/* ============================================================
 * Ciclo 1 — Modelo comercial, atribución y métricas
 * ============================================================ */

/** Catálogo de canales de adquisición (orgánico, pagado, directo, marketplace…). */
export const acquisitionChannel = pgTable(
  "acquisition_channel",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 30 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("acquisition_channel_org_name_uq").on(t.organizationId, t.name)]
);

/** Campañas de marketing (plataforma discriminatoria: meta_ads, google_ads, manual…). */
export const campaign = pgTable(
  "campaign",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 30 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    externalId: varchar("external_id", { length: 255 }),
    objective: varchar("objective", { length: 100 }),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    budgetPlannedCents: integer("budget_planned_cents"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_org_external_uq")
      .on(t.organizationId, t.platform, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index("campaign_org_idx").on(t.organizationId),
  ]
);

/** Conjuntos de anuncios dentro de una campaña. */
export const adSet = pgTable(
  "ad_set",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: varchar("campaign_id", { length: 255 })
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    externalId: varchar("external_id", { length: 255 }),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_set_campaign_external_uq")
      .on(t.campaignId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  ]
);

/** Creatividades (anuncios) asociadas a un conjunto o campaña. */
export const adCreative = pgTable(
  "ad_creative",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    adSetId: varchar("ad_set_id", { length: 255 }).references(() => adSet.id, {
      onDelete: "cascade",
    }),
    campaignId: varchar("campaign_id", { length: 255 }).references(
      () => campaign.id,
      { onDelete: "cascade" }
    ),
    name: varchar("name", { length: 255 }).notNull(),
    externalId: varchar("external_id", { length: 255 }),
    creativeType: varchar("creative_type", { length: 50 }),
    headline: varchar("headline", { length: 512 }),
    body: text("body"),
    mediaUrl: varchar("media_url", { length: 1024 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ad_creative_campaign_idx").on(t.campaignId)]
);

/** Ofertas comerciales (descuentos, promociones) con vigencia. */
export const offer = pgTable(
  "offer",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    service: varchar("service", { length: 100 }),
    discountType: varchar("discount_type", { length: 20 }),
    discountValue: integer("discount_value"),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("offer_org_idx").on(t.organizationId)]
);

/** Eventos de atribución first/last touch por contacto. */
export const attributionEvent = pgTable(
  "attribution_event",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    conversationId: varchar("conversation_id", { length: 255 }).references(
      () => conversation.id,
      { onDelete: "set null" }
    ),
    channelId: varchar("channel_id", { length: 255 }).references(
      () => acquisitionChannel.id,
      { onDelete: "set null" }
    ),
    campaignId: varchar("campaign_id", { length: 255 }).references(
      () => campaign.id,
      { onDelete: "set null" }
    ),
    offerId: varchar("offer_id", { length: 255 }).references(() => offer.id, {
      onDelete: "set null",
    }),
    creativeId: varchar("creative_id", { length: 255 }).references(
      () => adCreative.id,
      { onDelete: "set null" }
    ),
    touchType: varchar("touch_type", { length: 10 }).notNull(),
    attributionType: varchar("attribution_type", { length: 20 }).notNull(),
    source: varchar("source", { length: 100 }),
    medium: varchar("medium", { length: 100 }),
    campaignName: varchar("campaign_name", { length: 255 }),
    utmSource: varchar("utm_source", { length: 255 }),
    utmMedium: varchar("utm_medium", { length: 255 }),
    utmCampaign: varchar("utm_campaign", { length: 255 }),
    utmContent: varchar("utm_content", { length: 255 }),
    utmTerm: varchar("utm_term", { length: 255 }),
    clickId: varchar("click_id", { length: 255 }),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("attribution_event_org_contact_idx").on(t.organizationId, t.contactId),
    index("attribution_event_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("attribution_event_org_touch_idx").on(
      t.organizationId,
      t.touchType,
      t.occurredAt
    ),
  ]
);

/** Actividades comerciales de prospección (llamadas, correos, visitas…). */
export const activityEvent = pgTable(
  "activity_event",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    leadId: varchar("lead_id", { length: 255 }).references(() => lead.id, {
      onDelete: "set null",
    }),
    conversationId: varchar("conversation_id", { length: 255 }).references(
      () => conversation.id,
      { onDelete: "set null" }
    ),
    type: varchar("type", { length: 30 }).notNull(),
    direction: varchar("direction", { length: 10 }).notNull().default("outbound"),
    outcome: varchar("outcome", { length: 50 }),
    durationMinutes: integer("duration_minutes"),
    actorUserId: varchar("actor_user_id", { length: 255 }).references(
      () => user.id,
      { onDelete: "set null" }
    ),
    notes: text("notes"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("activity_event_org_contact_idx").on(t.organizationId, t.contactId),
    index("activity_event_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("activity_event_org_type_idx").on(t.organizationId, t.type, t.occurredAt),
    index("activity_event_org_actor_idx").on(t.organizationId, t.actorUserId),
  ]
);

/** Costo de prestación por servicio/producto, con vigencia. */
export const serviceCost = pgTable(
  "service_cost",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    catalogProductId: varchar("catalog_product_id", { length: 255 }).references(
      () => catalogProduct.id,
      { onDelete: "set null" }
    ),
    service: varchar("service", { length: 100 }),
    name: varchar("name", { length: 255 }).notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    effectiveFrom: timestamp("effective_from"),
    effectiveTo: timestamp("effective_to"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("service_cost_org_idx").on(t.organizationId),
    index("service_cost_org_service_idx").on(t.organizationId, t.service),
  ]
);

/** Estado de sincronización por proveedor de integración. */
export const syncState = pgTable(
  "sync_state",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    lastSyncAt: timestamp("last_sync_at"),
    lastStatus: varchar("last_status", { length: 20 }),
    lastError: text("last_error"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    recordsImported: integer("records_imported").notNull().default(0),
    duplicatesDetected: integer("duplicates_detected").notNull().default(0),
    currency: varchar("currency", { length: 10 }),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sync_state_org_provider_uq").on(t.organizationId, t.provider)]
);

/** Experimentos A/B: hipótesis, variantes y evidencia. */
export const experiment = pgTable(
  "experiment",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    hypothesis: text("hypothesis"),
    problem: text("problem"),
    service: varchar("service", { length: 100 }),
    channelId: varchar("channel_id", { length: 255 }).references(
      () => acquisitionChannel.id,
      { onDelete: "set null" }
    ),
    campaignId: varchar("campaign_id", { length: 255 }).references(
      () => campaign.id,
      { onDelete: "set null" }
    ),
    offerId: varchar("offer_id", { length: 255 }).references(() => offer.id, {
      onDelete: "set null",
    }),
    primaryMetric: varchar("primary_metric", { length: 50 }),
    status: varchar("status", { length: 20 }).notNull().default("borrador"),
    evidenceStatus: varchar("evidence_status", { length: 20 })
      .notNull()
      .default("inconcluso"),
    conclusion: text("conclusion"),
    budgetPlannedCents: integer("budget_planned_cents"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    createdBy: varchar("created_by", { length: 255 }).references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("experiment_org_idx").on(t.organizationId)]
);

/** Variantes de un experimento (A/B). */
export const experimentVariant = pgTable(
  "experiment_variant",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    experimentId: varchar("experiment_id", { length: 255 })
      .notNull()
      .references(() => experiment.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 10 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    creativeId: varchar("creative_id", { length: 255 }).references(
      () => adCreative.id,
      { onDelete: "set null" }
    ),
    offerId: varchar("offer_id", { length: 255 }).references(() => offer.id, {
      onDelete: "set null",
    }),
    message: text("message"),
    isControl: boolean("is_control").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("experiment_variant_exp_key_uq").on(t.experimentId, t.key)]
);

/** Observaciones diarias de un experimento por variante. */
export const experimentObservation = pgTable(
  "experiment_observation",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    experimentId: varchar("experiment_id", { length: 255 })
      .notNull()
      .references(() => experiment.id, { onDelete: "cascade" }),
    variantId: varchar("variant_id", { length: 255 })
      .notNull()
      .references(() => experimentVariant.id, { onDelete: "cascade" }),
    observedOn: date("observed_on").notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    qualifiedLeads: integer("qualified_leads").notNull().default(0),
    quotes: integer("quotes").notNull().default(0),
    sales: integer("sales").notNull().default(0),
    revenueCents: integer("revenue_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    contributionCents: integer("contribution_cents").notNull().default(0),
    sampleSize: integer("sample_size"),
    confidenceLow: numeric("confidence_low"),
    confidenceHigh: numeric("confidence_high"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("experiment_observation_unique_idx").on(
      t.experimentId,
      t.variantId,
      t.observedOn
    ),
    index("experiment_observation_org_idx").on(t.organizationId, t.observedOn),
  ]
);

/** Criterios de calificación configurables por organización. */
export const qualificationCriteria = pgTable(
  "qualification_criteria",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    definition: jsonb("definition").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("qualification_criteria_org_uq").on(t.organizationId)]
);

/** Catálogo normalizado de motivos de pérdida (configurable). */
export const lossReasonCatalog = pgTable(
  "loss_reason",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 50 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("loss_reason_org_key_uq").on(t.organizationId, t.key)]
);

/** Ventas de marketplace (Mercado Libre) registradas manualmente. */
export const marketplaceOrder = pgTable(
  "marketplace_order",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 30 }).notNull().default("mercado_libre"),
    externalId: varchar("external_id", { length: 255 }),
    orderNumber: varchar("order_number", { length: 100 }).notNull(),
    contactId: varchar("contact_id", { length: 255 }).references(
      () => contact.id,
      { onDelete: "set null" }
    ),
    itemName: varchar("item_name", { length: 255 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    amountCents: integer("amount_cents").notNull().default(0),
    commissionCents: integer("commission_cents").notNull().default(0),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    status: varchar("status", { length: 30 }).notNull().default("completed"),
    orderedAt: timestamp("ordered_at").notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_order_org_external_uq")
      .on(t.organizationId, t.platform, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index("marketplace_order_org_idx").on(t.organizationId, t.orderedAt),
  ]
);

/** Historial append-only de notas manuales y capturadas por la IA. */
export const contactNote = pgTable(
  "contact_note",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 })
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    source: varchar("source", { length: 20 }).notNull().default("manual"),
    createdBy: varchar("created_by", { length: 255 }).references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("contact_note_org_contact_created_idx").on(t.organizationId, t.contactId, t.createdAt),
    index("contact_note_org_created_idx").on(t.organizationId, t.createdAt),
  ]
);

/** A persisted bulk-message campaign. Recipient snapshots live in their own rows. */
export const broadcastCampaign = pgTable(
  "broadcast_campaign",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    senderAccountId: varchar("sender_account_id", { length: 255 }),
    subject: varchar("subject", { length: 1024 }),
    messageText: text("message_text").notNull(),
    templateName: varchar("template_name", { length: 255 }),
    templateLanguage: varchar("template_language", { length: 20 }),
    templateParams: jsonb("template_params"),
    filters: jsonb("filters").notNull().default({}),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    recipientCount: integer("recipient_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    readCount: integer("read_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    createdBy: varchar("created_by", { length: 255 }).references(() => user.id, { onDelete: "set null" }),
    scheduledAt: timestamp("scheduled_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("broadcast_campaign_org_created_idx").on(t.organizationId, t.createdAt),
    index("broadcast_campaign_status_schedule_idx").on(t.status, t.scheduledAt),
  ]
);

/** Durable recipient-level queue, idempotency, and delivery audit for a campaign. */
export const broadcastRecipient = pgTable(
  "broadcast_recipient",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: varchar("campaign_id", { length: 255 })
      .notNull()
      .references(() => broadcastCampaign.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id", { length: 255 }).references(() => contact.id, { onDelete: "set null" }),
    conversationId: varchar("conversation_id", { length: 255 }).references(() => conversation.id, { onDelete: "set null" }),
    channel: varchar("channel", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    messageId: varchar("message_id", { length: 255 }),
    providerMessageId: text("provider_message_id"),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: text("error_message"),
    skipReason: varchar("skip_reason", { length: 100 }),
    attempts: integer("attempts").notNull().default(0),
    scheduledAt: timestamp("scheduled_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("broadcast_recipient_campaign_contact_uq").on(t.campaignId, t.contactId),
    index("broadcast_recipient_due_idx").on(t.status, t.scheduledAt),
    index("broadcast_recipient_org_campaign_idx").on(t.organizationId, t.campaignId),
    index("broadcast_recipient_conversation_idx").on(t.organizationId, t.conversationId, t.createdAt),
  ]
);

/** Watsi — conversaciones del copiloto interno de métricas. */
export const watsiConversation = pgTable(
  "watsi_conversation",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull().default("Nueva conversación"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("watsi_conversation_org_user_idx").on(t.organizationId, t.userId, t.updatedAt),
  ]
);

/** Watsi — mensajes del copiloto. */
export const watsiMessage = pgTable(
  "watsi_message",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 255 })
      .notNull()
      .references(() => watsiConversation.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("watsi_message_conversation_idx").on(t.conversationId, t.createdAt),
  ]
);

/** Per-organization access selection for the read-only workspace Copilot. */
export const copilotSettings = pgTable("copilot_settings", {
  organizationId: varchar("organization_id", { length: 255 })
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  accessMode: varchar("access_mode", { length: 20 }).notNull().default("selected"),
  dataSources: jsonb("data_sources").notNull().default(
    sql`'["metrics","pipeline","contacts","agenda"]'::jsonb`
  ),
  updatedBy: varchar("updated_by", { length: 255 }).references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Insights diarios de campañas de anuncios (Meta Ads), sincronizados por el
 * poller. Guarda componentes atómicos (gasto, impresiones, alcance, clics,
 * conversiones y métricas de video/reels); las razones (CTR, CPC, CPM, ROAS,
 * frecuencia, retención) se recalculan al consultar para que la agregación por
 * selección múltiple sea correcta.
 */
export const campaignInsight = pgTable(
  "campaign_insight",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 30 }).notNull().default("meta_ads"),
    campaignExternalId: varchar("campaign_external_id", { length: 255 }).notNull(),
    campaignName: varchar("campaign_name", { length: 500 }),
    campaignObjective: varchar("campaign_objective", { length: 100 }),
    status: varchar("status", { length: 30 }),
    dateStart: date("date_start"),
    dateStop: date("date_stop"),
    currency: varchar("currency", { length: 10 }).notNull().default("MXN"),
    spendCents: bigint("spend_cents", { mode: "number" }).notNull().default(0),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    reach: bigint("reach", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    uniqueClicks: bigint("unique_clicks", { mode: "number" }).notNull().default(0),
    conversions: bigint("conversions", { mode: "number" }).notNull().default(0),
    conversionValueCents: bigint("conversion_value_cents", { mode: "number" }).notNull().default(0),
    videoViews: bigint("video_views", { mode: "number" }).notNull().default(0),
    thruplay: bigint("thruplay", { mode: "number" }).notNull().default(0),
    avgWatchTimeMs: bigint("avg_watch_time_ms", { mode: "number" }).notNull().default(0),
    videoP25: bigint("video_p25", { mode: "number" }).notNull().default(0),
    videoP50: bigint("video_p50", { mode: "number" }).notNull().default(0),
    videoP75: bigint("video_p75", { mode: "number" }).notNull().default(0),
    videoP100: bigint("video_p100", { mode: "number" }).notNull().default(0),
    videoPlays: bigint("video_plays", { mode: "number" }).notNull().default(0),
    uniqueVideoViews: bigint("unique_video_views", { mode: "number" }).notNull().default(0),
    videoPlays2s: bigint("video_plays_2s", { mode: "number" }).notNull().default(0),
    actions: jsonb("actions"),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_insight_org_platform_camp_day_uq")
      .on(t.organizationId, t.platform, t.campaignExternalId, t.dateStart),
    index("campaign_insight_org_date_idx").on(t.organizationId, t.dateStart),
  ]
);

/**
 * Comentarios públicos de publicaciones (Instagram / Facebook / TikTok),
 * sincronizados por el poller de `comments`. Cada comentario es un mensaje
 * entrante en la conversación del autor sobre ese post (hebra por autor/post).
 * `externalCommentId` es la llave de idempotencia del poller (mismo criterio
 * que `reviewName` en Google Business).
 */
export const socialComment = pgTable(
  "social_comment",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Plataforma de origen: "instagram" | "messenger" | "tiktok". */
    platform: varchar("platform", { length: 20 }).notNull(),
    /** Id del comentario en la plataforma. */
    externalCommentId: varchar("external_comment_id", { length: 255 }).notNull(),
    /** Id de la publicación (media de IG / post de la página). */
    postExternalId: varchar("post_external_id", { length: 255 }).notNull(),
    postCaption: varchar("post_caption", { length: 500 }),
    /** Id del autor del comentario (ig userId / PSID de la página). */
    authorExternalId: varchar("author_external_id", { length: 255 }).notNull(),
    authorName: varchar("author_name", { length: 255 }),
    body: text("body").notNull(),
    /** Comentario padre cuando es una respuesta dentro de la misma hebra. */
    parentExternalId: varchar("parent_external_id", { length: 255 }),
    commentTime: timestamp("comment_time").notNull(),
    /** Reply público del negocio (null = sin responder). */
    replyText: text("reply_text"),
    repliedAt: timestamp("replied_at"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_comment_org_ext_uq").on(t.organizationId, t.externalCommentId),
    index("social_comment_org_platform_post_idx").on(t.organizationId, t.platform, t.postExternalId),
  ]
);

/* ============================================================
 * Inteligencia de mercado (bandera INTEL)
 *
 * Todas las tablas del módulo son org-scoped (Constitución III): el dato de
 * mercado se captura por instancia/organización, sin excepciones de datos
 * "globales". Secretos cifrados AES-256-GCM (triple cipher/iv/tag), mismo
 * patrón que google_business_credentials.
 * ============================================================ */

/**
 * Credenciales del módulo de inteligencia. Cada proveedor es independiente:
 * SerpApi y Apify para Google Trends, DENUE para INEGI, YouTube opcional.
 * Secretos cifrados AES-256-GCM (triple cipher/iv/tag). YouTubeKey* ahora
 * es opcional: no se exige para configurar SerpApi/Apify/INEGI.
 */
export const intelCredentials = pgTable(
  "intel_credentials",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // YouTube (opcional)
    youtubeKeyCipher: text("youtube_key_cipher"),
    youtubeKeyIv: text("youtube_key_iv"),
    youtubeKeyTag: text("youtube_key_tag"),
    // INEGI DENUE
    denueTokenCipher: text("denue_token_cipher"),
    denueTokenIv: text("denue_token_iv"),
    denueTokenTag: text("denue_token_tag"),
    // SerpApi (Google Trends principal)
    serpapiKeyCipher: text("serpapi_key_cipher"),
    serpapiKeyIv: text("serpapi_key_iv"),
    serpapiKeyTag: text("serpapi_key_tag"),
    serpapiStatus: varchar("serpapi_status", { length: 20 }),
    serpapiLastTestAt: timestamp("serpapi_last_test_at"),
    serpapiLastSyncAt: timestamp("serpapi_last_sync_at"),
    serpapiQueriesUsed: integer("serpapi_queries_used").notNull().default(0),
    // Apify (Google Trends respaldo)
    apifyTokenCipher: text("apify_token_cipher"),
    apifyTokenIv: text("apify_token_iv"),
    apifyTokenTag: text("apify_token_tag"),
    apifyActorId: varchar("apify_actor_id", { length: 255 }),
    apifyStatus: varchar("apify_status", { length: 20 }),
    apifyLastTestAt: timestamp("apify_last_test_at"),
    apifyLastSyncAt: timestamp("apify_last_sync_at"),
    apifyQueriesUsed: integer("apify_queries_used").notNull().default(0),
    /** Último ingest exitoso (fuente YouTube legacy). */
    lastIngestAt: timestamp("last_ingest_at"),
    status: varchar("status", { length: 20 }).notNull().default("connected"),
    // Estado de pruebas en vivo por fuente (distingue "guardado" de "conectado")
    youtubeLastTestAt: timestamp("youtube_last_test_at"),
    youtubeStatus: varchar("youtube_status", { length: 20 }),
    denueLastTestAt: timestamp("denue_last_test_at"),
    denueStatus: varchar("denue_status", { length: 20 }),
    // Google Trends (ADR-001): habilitado por org + estado de la última prueba
    gtEnabled: boolean("gt_enabled").notNull().default(false),
    gtLastSyncAt: timestamp("gt_last_sync_at"),
    gtStatus: varchar("gt_status", { length: 20 }),
    gtLastTestAt: timestamp("gt_last_test_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("intel_credentials_org_uq").on(t.organizationId)]
);

/** Término/nicho monitoreado. `keywords` = JSON array de strings. */
export const intelTerm = pgTable(
  "intel_term",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    /** JSON array de palabras clave (minúsculas) con las que se matchean videos. */
    keywords: jsonb("keywords").$type<string[]>().notNull(),
    /** ISO 3166-1 alpha-2 del geo monitoreado. */
    geo: varchar("geo", { length: 2 }).notNull().default("MX"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("intel_term_org_name_uq").on(t.organizationId, t.name),
    index("intel_term_org_active_idx").on(t.organizationId, t.active),
  ]
);

/**
 * Snapshot diario por término: agregados del matching del día.
 * `day` es "YYYY-MM-DD" (UTC) para dedupe determinista.
 */
export const intelSnapshot = pgTable(
  "intel_snapshot",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    termId: varchar("term_id", { length: 255 })
      .notNull()
      .references(() => intelTerm.id, { onDelete: "cascade" }),
    /** Día UTC del snapshot, formato "YYYY-MM-DD". */
    day: varchar("day", { length: 10 }).notNull(),
    /** Suma de vistas de los videos coincidentes del día (proxy de interés). */
    value: bigint("value", { mode: "number" }).notNull(),
    /** Videos coincidentes del día. */
    videoCount: integer("video_count").notNull().default(0),
    /** Origen del dato: "youtube_mostpopular". */
    source: varchar("source", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("intel_snapshot_term_day_uq").on(t.termId, t.day),
    index("intel_snapshot_org_day_idx").on(t.organizationId, t.day),
    index("intel_snapshot_org_term_idx").on(t.organizationId, t.termId),
  ]
);

/** Videos coincidentes capturados por ingest (muestra cruda del snapshot). */
export const intelVideo = pgTable(
  "intel_video",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    termId: varchar("term_id", { length: 255 })
      .notNull()
      .references(() => intelTerm.id, { onDelete: "cascade" }),
    /** Id del video en YouTube. */
    videoId: varchar("video_id", { length: 40 }).notNull(),
    title: varchar("title", { length: 300 }),
    views: bigint("views", { mode: "number" }).notNull().default(0),
    likes: bigint("likes", { mode: "number" }).notNull().default(0),
    /** Duración en segundos (contentDetails del API). */
    durationSeconds: integer("duration_seconds"),
    /** Fecha de publicación del video. */
    publishedAt: timestamp("published_at"),
    channelTitle: varchar("channel_title", { length: 200 }),
    /** Día UTC de captura, "YYYY-MM-DD". */
    day: varchar("day", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("intel_video_term_video_day_uq").on(t.termId, t.videoId, t.day),
    index("intel_video_org_term_idx").on(t.organizationId, t.termId, t.day),
  ]
);

/** Historial de búsquedas del motor (UX + métrica de uso del módulo). */
export const intelSearchLog = pgTable(
  "intel_search_log",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    query: varchar("query", { length: 200 }).notNull(),
    /** Término con el que se resolvió la búsqueda (null si no hubo match). */
    termId: varchar("term_id", { length: 255 }).references(() => intelTerm.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("intel_search_log_org_idx").on(t.organizationId, t.createdAt)]
);

/**
 * Conteo de establecimientos DENUE por estado y día (competencia por
 * geografía). `censored` = la ventana devolvió 10 registros: el total real
 * es ≥10 (la API no entrega el total exacto).
 */
export const intelGeoSnapshot = pgTable(
  "intel_geo_snapshot",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    termId: varchar("term_id", { length: 255 })
      .notNull()
      .references(() => intelTerm.id, { onDelete: "cascade" }),
    /** Clave INEGI de la entidad federativa, "01"…"32". */
    state: varchar("state", { length: 2 }).notNull(),
    count: integer("count").notNull(),
    censored: boolean("censored").notNull().default(false),
    /** Día UTC del conteo, formato "YYYY-MM-DD". */
    day: varchar("day", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("intel_geo_term_state_day_uq").on(t.termId, t.state, t.day),
    index("intel_geo_org_day_idx").on(t.organizationId, t.day),
    index("intel_geo_org_term_idx").on(t.organizationId, t.termId),
  ]
);

/**
 * Snapshot diario de Google Trends por término (índice 0–100, escala GT).
 * Se separa de `intel_snapshot` (vistas YouTube, bigint) porque la escala es
 * distinta y así el fallback YouTube→GT es explícito en la UI.
 */
export const intelGtSnapshot = pgTable(
  "intel_gt_snapshot",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    termId: varchar("term_id", { length: 255 })
      .notNull()
      .references(() => intelTerm.id, { onDelete: "cascade" }),
    /** Día UTC "YYYY-MM-DD". */
    day: varchar("day", { length: 10 }).notNull(),
    /** Índice 0–100 de Google Trends (100 = máximo de la ventana). */
    value: integer("value").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("intel_gt_snapshot_term_day_uq").on(t.termId, t.day),
    index("intel_gt_snapshot_org_term_idx").on(t.organizationId, t.termId),
  ]
);

/** Interés por subregión (estado) de Google Trends, índice 0–100. */
export const intelGtRegion = pgTable(
  "intel_gt_region",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    termId: varchar("term_id", { length: 255 })
      .notNull()
      .references(() => intelTerm.id, { onDelete: "cascade" }),
    /** Clave INEGI de la entidad, "01"…"32". */
    state: varchar("state", { length: 2 }).notNull(),
    /** Índice 0–100 (100 = estado con más interés). */
    value: integer("value").notNull(),
    day: varchar("day", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("intel_gt_region_term_state_day_uq").on(t.termId, t.state, t.day),
    index("intel_gt_region_org_term_idx").on(t.organizationId, t.termId),
  ]
);

/**
 * Temas y consultas relacionados de Google Trends.
 * `isBreakout` = Google lo marcó «breakout» (rising); la UI lo muestra como
 * «Aumento puntual» sin % (denominador ~0).
 */
export const intelGtRelated = pgTable(
  "intel_gt_related",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    termId: varchar("term_id", { length: 255 })
      .notNull()
      .references(() => intelTerm.id, { onDelete: "cascade" }),
    /** "topic" (tema) o "query" (consulta). */
    kind: varchar("kind", { length: 10 }).notNull(),
    /** Texto del tema/consulta. */
    label: varchar("label", { length: 300 }).notNull(),
    /** Índice 0–100 (para top) o valor crudo del rising. */
    value: integer("value").notNull().default(0),
    /** Cambio % vs periodo previo; null si es breakout o sin base. */
    pct: integer("pct"),
    isBreakout: boolean("is_breakout").notNull().default(false),
    day: varchar("day", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("intel_gt_related_term_kind_label_day_uq").on(
      t.termId,
      t.kind,
      t.label,
      t.day
    ),
    index("intel_gt_related_org_term_idx").on(t.organizationId, t.termId),
  ]
);

/** Bucket atómico de rate limit compartido entre réplicas del monolito. */
export const rateLimitBucket = pgTable("rate_limit_bucket", {
  key: varchar("key", { length: 255 }).primaryKey(),
  windowStartedAt: timestamp("window_started_at").notNull(),
  count: integer("count").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
});

/**
 * Job asíncrono de las ingestas INTEL (todos los nichos, un término, mapa
 * DENUE). El índice único parcial sobre (org, kind, term) en estado
 * "running" es el candado anti-ingestas duplicadas: dos clics en «Actualizar»
 * comparten un solo job y no gastan dos veces la cuota.
 */
export const intelJob = pgTable(
  "intel_job",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** "gt_all" (todos los nichos) | "gt_term" (uno) | "geo" (mapa DENUE). */
    kind: varchar("kind", { length: 20 }).notNull(),
    termId: varchar("term_id", { length: 255 }),
    geo: varchar("geo", { length: 10 }),
    /** "running" | "done" | "error". */
    status: varchar("status", { length: 20 }).notNull().default("running"),
    total: integer("total").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    uniqueIndex("intel_job_active_uq")
      .on(t.organizationId, t.kind, sql`COALESCE(${t.termId}, '')`)
      .where(sql`${t.status} = 'running'`),
    index("intel_job_org_created_idx").on(t.organizationId, t.createdAt),
  ]
);
