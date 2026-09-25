CREATE TABLE IF NOT EXISTS "chatbot_conversation" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"title" varchar(255),
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "chatbot_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "chatbot_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatbot_conv_org_user_idx" ON "chatbot_conversation" ("organization_id","user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chatbot_message" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(255) NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "chatbot_message_conversation_id_chatbot_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chatbot_conversation"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatbot_msg_conv_idx" ON "chatbot_message" ("conversation_id","created_at");
