CREATE TABLE "account" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"access_token" varchar(2048),
	"refresh_token" varchar(2048),
	"id_token" varchar(2048),
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" varchar(1024),
	"password" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_attribution" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"contact_id" varchar(255) NOT NULL,
	"conversation_id" varchar(255) NOT NULL,
	"ctwa_clid" varchar(255),
	"source_id" varchar(255),
	"source_type" varchar(50),
	"source_url" varchar(1024),
	"headline" varchar(512),
	"body" text,
	"media_type" varchar(50),
	"raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profile" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"name" varchar(255) DEFAULT 'Asistente' NOT NULL,
	"tone" text,
	"instructions" text,
	"escalation_rules" text,
	"greeting" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_test_case" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"run_id" varchar(255) NOT NULL,
	"persona" varchar(255) NOT NULL,
	"conversation_id" varchar(255),
	"transcript" jsonb,
	"veredicto" varchar(20),
	"hallazgos" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_test_run" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"score" integer,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"kind" varchar(20) DEFAULT 'session' NOT NULL,
	"status" varchar(20) DEFAULT 'agendada' NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"contact_id" varchar(255),
	"conversation_id" varchar(255),
	"lead_id" varchar(255),
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer NOT NULL,
	"connector" varchar(50),
	"external_ref" varchar(255),
	"meeting_link" varchar(1024),
	"link_pending" boolean DEFAULT false NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_settings" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"weekly_hours" jsonb NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"min_notice_hours" integer DEFAULT 2 NOT NULL,
	"max_days_ahead" integer DEFAULT 7 NOT NULL,
	"timezone" varchar(50) DEFAULT 'America/Mexico_City' NOT NULL,
	"connector" varchar(50) DEFAULT 'enlace-fijo' NOT NULL,
	"meeting_link" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capi_settings" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"dataset_id" varchar(255) NOT NULL,
	"token_cipher" varchar(1024) NOT NULL,
	"token_iv" varchar(255) NOT NULL,
	"token_tag" varchar(255) NOT NULL,
	"qualified_stage_id" varchar(255),
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_product" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"price" integer DEFAULT 0 NOT NULL,
	"currency" varchar(10) DEFAULT 'MXN' NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"quote_id" varchar(255),
	"contact_id" varchar(255),
	"concept" varchar(255) NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp,
	"status" varchar(20) DEFAULT 'pendiente' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"channel" varchar(20) DEFAULT 'whatsapp' NOT NULL,
	"wa_identity" varchar(255) NOT NULL,
	"phone" varchar(20),
	"wa_user_id" varchar(255),
	"name" varchar(255) NOT NULL,
	"name_source" varchar(20) DEFAULT 'perfil' NOT NULL,
	"notes" text,
	"ficha" jsonb,
	"source" varchar(20),
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"contact_id" varchar(255) NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"channel" varchar(20) DEFAULT 'whatsapp' NOT NULL,
	"channel_thread_ref" varchar(255),
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"handoff_at" timestamp,
	"handoff_reason" varchar(30),
	"last_inbound_at" timestamp,
	"last_message_at" timestamp,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_event" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"conversation_id" varchar(255) NOT NULL,
	"attribution_id" varchar(255),
	"event_name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" text,
	"fb_trace_id" varchar(255),
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_account" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"label" varchar(255) NOT NULL,
	"email_address" varchar(255) NOT NULL,
	"from_name" varchar(255),
	"smtp_host" varchar(255) NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_secure" boolean DEFAULT true NOT NULL,
	"smtp_user" varchar(255) NOT NULL,
	"smtp_pass_cipher" varchar(1024) NOT NULL,
	"smtp_pass_iv" varchar(255) NOT NULL,
	"smtp_pass_tag" varchar(255) NOT NULL,
	"imap_host" varchar(255) NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_secure" boolean DEFAULT true NOT NULL,
	"imap_user" varchar(255) NOT NULL,
	"imap_pass_cipher" varchar(1024) NOT NULL,
	"imap_pass_iv" varchar(255) NOT NULL,
	"imap_pass_tag" varchar(255) NOT NULL,
	"signature" text,
	"daily_limit" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_message" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"message_id" varchar(512) NOT NULL,
	"thread_id" varchar(512),
	"from_email" varchar(255) NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb,
	"subject" varchar(1024),
	"body_text" text,
	"body_html" text,
	"attachments" jsonb,
	"direction" varchar(10) NOT NULL,
	"contact_id" varchar(255),
	"campaign_id" varchar(255),
	"seen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"fecha" timestamp DEFAULT now() NOT NULL,
	"descripcion" varchar(255) NOT NULL,
	"categoria" varchar(100) NOT NULL,
	"proveedor" varchar(255),
	"monto" integer NOT NULL,
	"metodo" varchar(50) NOT NULL,
	"referencia" varchar(255),
	"comprobante_url" varchar(1024),
	"notas" text,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"client_secret_cipher" varchar(1024) NOT NULL,
	"client_secret_iv" varchar(255) NOT NULL,
	"client_secret_tag" varchar(255) NOT NULL,
	"refresh_token_cipher" varchar(1024) NOT NULL,
	"refresh_token_iv" varchar(255) NOT NULL,
	"refresh_token_tag" varchar(255) NOT NULL,
	"calendar_id" varchar(255) DEFAULT 'primary' NOT NULL,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"source" varchar(20) NOT NULL,
	"ig_user_id" varchar(255) NOT NULL,
	"account_ref" varchar(255),
	"username" varchar(255),
	"token_cipher" varchar(1024) NOT NULL,
	"token_iv" varchar(255) NOT NULL,
	"token_tag" varchar(255) NOT NULL,
	"webhook_secret" varchar(255),
	"status" varchar(30) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_entry" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"question" text,
	"answer" text,
	"content" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"contact_id" varchar(255) NOT NULL,
	"stage_id" varchar(255) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"amount_cents" integer,
	"currency" varchar(10),
	"priority" varchar(20),
	"priority_updated_at" timestamp,
	"last_activity_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_stage_event" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"lead_id" varchar(255) NOT NULL,
	"contact_id" varchar(255) NOT NULL,
	"from_stage_id" varchar(255),
	"from_stage_name" varchar(255),
	"to_stage_id" varchar(255),
	"to_stage_name" varchar(255) NOT NULL,
	"to_stage_kind" varchar(20) DEFAULT 'open' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" varchar(255),
	"source" varchar(20) DEFAULT 'dueno' NOT NULL,
	"approximate" boolean DEFAULT false NOT NULL,
	"loss_reason" varchar(30),
	"loss_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_asset" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"wa_media_id" varchar(255),
	"mime_type" varchar(255),
	"file_name" varchar(512),
	"file_size" integer,
	"caption" text,
	"payload" jsonb,
	"storage_path" varchar(512),
	"fetch_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"fetch_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"conversation_id" varchar(255) NOT NULL,
	"wa_message_id" varchar(255),
	"direction" varchar(10) NOT NULL,
	"type" varchar(50) DEFAULT 'text' NOT NULL,
	"text" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"origin" varchar(20) DEFAULT 'operator' NOT NULL,
	"media_asset_id" varchar(255),
	"wa_timestamp" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "messenger_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"source" varchar(20) DEFAULT 'meta' NOT NULL,
	"page_id" varchar(255),
	"page_name" varchar(255),
	"account_ref" varchar(255),
	"token_cipher" varchar(1024) NOT NULL,
	"token_iv" varchar(255) NOT NULL,
	"token_tag" varchar(255) NOT NULL,
	"webhook_secret" varchar(255),
	"status" varchar(30) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"waba_id" varchar(255) NOT NULL,
	"phone_number_id" varchar(255) NOT NULL,
	"display_phone_number" varchar(50),
	"verified_name" varchar(255),
	"token_cipher" varchar(1024) NOT NULL,
	"token_iv" varchar(255) NOT NULL,
	"token_tag" varchar(255) NOT NULL,
	"status" varchar(30) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offered_slot" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"conversation_id" varchar(255) NOT NULL,
	"start_utc" timestamp NOT NULL,
	"label" varchar(255) NOT NULL,
	"offered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255),
	"logo" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outbound_delivery" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"webhook_id" varchar(255) NOT NULL,
	"event" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "outbound_webhook" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"secret_cipher" varchar(1024),
	"secret_iv" varchar(255),
	"secret_tag" varchar(255),
	"events" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"charge_id" varchar(255),
	"contact_id" varchar(255),
	"fecha" timestamp DEFAULT now() NOT NULL,
	"monto" integer NOT NULL,
	"metodo" varchar(50) NOT NULL,
	"referencia" varchar(255),
	"comprobante_url" varchar(1024),
	"notas" text,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"position" integer NOT NULL,
	"kind" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"contact_id" varchar(255),
	"service" varchar(100),
	"estado" varchar(20) DEFAULT 'activo' NOT NULL,
	"stage_id" varchar(255),
	"avance" integer DEFAULT 0 NOT NULL,
	"prioridad" varchar(20),
	"riesgo" varchar(20),
	"notas" text,
	"assigned_user_id" varchar(255),
	"next_meeting_at" timestamp,
	"last_activity_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_stage_event" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"project_id" varchar(255) NOT NULL,
	"from_stage_id" varchar(255),
	"from_stage_name" varchar(255),
	"to_stage_id" varchar(255),
	"to_stage_name" varchar(255) NOT NULL,
	"actor_user_id" varchar(255),
	"source" varchar(20) DEFAULT 'dueno' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_task" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"project_id" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"assignee_id" varchar(255),
	"priority" varchar(20),
	"estado" varchar(20) DEFAULT 'pendiente' NOT NULL,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"quote_number" varchar(50) NOT NULL,
	"contact_id" varchar(255),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"currency" varchar(10) DEFAULT 'MXN' NOT NULL,
	"valid_until" timestamp,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"discount_type" varchar(20),
	"discount_value" integer,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"tax_rate" integer DEFAULT 16 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"payment_plan" jsonb,
	"payment_method" jsonb,
	"send_channel" varchar(20),
	"message" text,
	"version" integer DEFAULT 1 NOT NULL,
	"locked_at" timestamp,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_event" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"quote_id" varchar(255) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"channel" varchar(20),
	"actor_id" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_item" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"quote_id" varchar(255) NOT NULL,
	"product_id" varchar(255),
	"name" varchar(255) NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"currency" varchar(10) DEFAULT 'MXN' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(1024),
	"user_id" varchar(255) NOT NULL,
	"active_organization_id" varchar(255),
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"language" varchar(20) NOT NULL,
	"category" varchar(50) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"wa_template_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waha_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"base_url" varchar(1024) NOT NULL,
	"api_key_cipher" varchar(1024) NOT NULL,
	"api_key_iv" varchar(255) NOT NULL,
	"api_key_tag" varchar(255) NOT NULL,
	"session_name" varchar(100) DEFAULT 'default' NOT NULL,
	"status" varchar(30) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoom_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"secret_cipher" varchar(1024) NOT NULL,
	"secret_iv" varchar(255) NOT NULL,
	"secret_tag" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD CONSTRAINT "agent_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD CONSTRAINT "agent_test_case_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD CONSTRAINT "agent_test_case_run_id_agent_test_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_test_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_case" ADD CONSTRAINT "agent_test_case_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_run" ADD CONSTRAINT "agent_test_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_settings" ADD CONSTRAINT "capi_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_settings" ADD CONSTRAINT "capi_settings_qualified_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("qualified_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product" ADD CONSTRAINT "catalog_product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_attribution_id_ad_attribution_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."ad_attribution"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_account" ADD CONSTRAINT "email_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_account_id_email_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_credentials" ADD CONSTRAINT "google_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD CONSTRAINT "instagram_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD CONSTRAINT "kb_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_from_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_to_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD CONSTRAINT "messenger_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD CONSTRAINT "meta_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_delivery" ADD CONSTRAINT "outbound_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_delivery" ADD CONSTRAINT "outbound_delivery_webhook_id_outbound_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outbound_webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook" ADD CONSTRAINT "outbound_webhook_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_event" ADD CONSTRAINT "project_stage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_event" ADD CONSTRAINT "project_stage_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_event" ADD CONSTRAINT "project_stage_event_from_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_event" ADD CONSTRAINT "project_stage_event_to_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_event" ADD CONSTRAINT "project_stage_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_event" ADD CONSTRAINT "quote_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_event" ADD CONSTRAINT "quote_event_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item" ADD CONSTRAINT "quote_item_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item" ADD CONSTRAINT "quote_item_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waha_credentials" ADD CONSTRAINT "waha_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoom_credentials" ADD CONSTRAINT "zoom_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_attribution_org_conversation_uq" ON "ad_attribution" USING btree ("organization_id","conversation_id");--> statement-breakpoint
CREATE INDEX "ad_attribution_org_contact_idx" ON "ad_attribution" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_org_uq" ON "agent_profile" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "test_case_run_idx" ON "agent_test_case" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "test_run_org_idx" ON "agent_test_run" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "test_run_org_status_idx" ON "agent_test_run" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "booking_org_when_idx" ON "booking" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "booking_org_status_idx" ON "booking" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_org_active_slot_idx" ON "booking" USING btree ("organization_id","scheduled_at") WHERE "booking"."status" = 'agendada' AND "booking"."is_test" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_settings_org_uq" ON "calendar_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capi_settings_org_uq" ON "capi_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "catalog_product_org_idx" ON "catalog_product" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "charge_org_idx" ON "charge" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "charge_contact_idx" ON "charge" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "charge_status_idx" ON "charge" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_org_channel_identity_uq" ON "contact" USING btree ("organization_id","channel","wa_identity");--> statement-breakpoint
CREATE INDEX "contact_org_wa_user_id_idx" ON "contact" USING btree ("organization_id","wa_user_id");--> statement-breakpoint
CREATE INDEX "contact_org_name_idx" ON "contact" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "conversation_org_last_idx" ON "conversation" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_org_contact_real_idx" ON "conversation" USING btree ("organization_id","contact_id","is_test");--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_event_org_conv_name_uq" ON "conversion_event" USING btree ("organization_id","conversation_id","event_name");--> statement-breakpoint
CREATE INDEX "conversion_event_org_created_idx" ON "conversion_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "email_account_org_idx" ON "email_account" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_message_account_message_uq" ON "email_message" USING btree ("account_id","message_id");--> statement-breakpoint
CREATE INDEX "email_message_org_idx" ON "email_message" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "email_message_thread_idx" ON "email_message" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_message_contact_idx" ON "email_message" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "expense_org_idx" ON "expense" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expense_fecha_idx" ON "expense" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "expense_categoria_idx" ON "expense" USING btree ("categoria");--> statement-breakpoint
CREATE UNIQUE INDEX "google_credentials_org_uq" ON "google_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_credentials_org_uq" ON "instagram_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_credentials_ig_user_uq" ON "instagram_credentials" USING btree ("ig_user_id");--> statement-breakpoint
CREATE INDEX "instagram_credentials_account_ref_idx" ON "instagram_credentials" USING btree ("account_ref");--> statement-breakpoint
CREATE INDEX "kb_org_idx" ON "kb_entry" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_contact_uq" ON "lead" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "lead_org_stage_idx" ON "lead" USING btree ("organization_id","stage_id","position");--> statement-breakpoint
CREATE INDEX "lse_org_occurred_idx" ON "lead_stage_event" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lse_lead_occurred_idx" ON "lead_stage_event" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lse_org_kind_occurred_idx" ON "lead_stage_event" USING btree ("organization_id","to_stage_kind","occurred_at");--> statement-breakpoint
CREATE INDEX "media_asset_org_idx" ON "media_asset" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "media_asset_wa_media_idx" ON "media_asset" USING btree ("wa_media_id");--> statement-breakpoint
CREATE INDEX "message_org_conv_idx" ON "message" USING btree ("organization_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_credentials_org_uq" ON "messenger_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_credentials_page_uq" ON "messenger_credentials" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "messenger_credentials_account_ref_idx" ON "messenger_credentials" USING btree ("account_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_credentials_org_uq" ON "meta_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_credentials_phone_uq" ON "meta_credentials" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "offered_slot_conv_idx" ON "offered_slot" USING btree ("conversation_id","start_utc");--> statement-breakpoint
CREATE INDEX "outbound_delivery_org_idx" ON "outbound_delivery" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_delivery_webhook_idx" ON "outbound_delivery" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "outbound_delivery_status_idx" ON "outbound_delivery" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "outbound_webhook_org_idx" ON "outbound_webhook" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payment_org_idx" ON "payment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payment_charge_idx" ON "payment" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "payment_fecha_idx" ON "payment" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "stage_org_pos_idx" ON "pipeline_stage" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_code_uq" ON "project" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "project_org_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_contact_idx" ON "project" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "project_stage_event_org_idx" ON "project_stage_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "project_stage_event_project_idx" ON "project_stage_event" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_task_org_idx" ON "project_task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_task_project_idx" ON "project_task" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_org_number_uq" ON "quote" USING btree ("organization_id","quote_number");--> statement-breakpoint
CREATE INDEX "quote_org_idx" ON "quote" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quote_contact_idx" ON "quote" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "quote_event_org_idx" ON "quote_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_event_quote_idx" ON "quote_event" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_item_quote_idx" ON "quote_item" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_org_name_lang_uq" ON "template" USING btree ("organization_id","name","language");--> statement-breakpoint
CREATE UNIQUE INDEX "waha_credentials_org_uq" ON "waha_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zoom_credentials_org_uq" ON "zoom_credentials" USING btree ("organization_id");