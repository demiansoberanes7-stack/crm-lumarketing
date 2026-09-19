import { eq, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
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
    aiToken: text("ai_token"),
    aiTokenCipher: text("ai_token_cipher"),
    aiTokenIv: text("ai_token_iv"),
    aiTokenTag: text("ai_token_tag"),
    aiModel: varchar("ai_model", { length: 255 }),
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

export const template = pgTable(
  "template",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    organizationId: varchar("organization_id", { length: 255 })
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    language: varchar("language", { length: 20 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    body: text("body").notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: varchar("wa_template_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
  ]
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
      { onDelete: "cascade" }
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("project_task_org_idx").on(t.organizationId),
    index("project_task_project_idx").on(t.projectId),
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
  },
  (t) => [
    uniqueIndex("quote_org_number_uq").on(t.organizationId, t.quoteNumber),
    index("quote_org_idx").on(t.organizationId),
    index("quote_contact_idx").on(t.contactId),
  ]
);

export const quoteItem = pgTable(
  "quote_item",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
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
