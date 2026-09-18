CREATE TABLE IF NOT EXISTS diagnostic_event (
  id varchar(255) PRIMARY KEY,
  organization_id varchar(255) NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  source varchar(40) NOT NULL,
  severity varchar(20) NOT NULL,
  code varchar(80) NOT NULL,
  message text NOT NULL,
  metadata jsonb,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diagnostic_event_org_created_idx ON diagnostic_event(organization_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS whatsapp_settings (
  organization_id varchar(255) PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL DEFAULT 'meta',
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO whatsapp_settings (organization_id, provider)
SELECT id, CASE WHEN metadata LIKE '%"whatsappProvider"%"waha"%' THEN 'waha' ELSE 'meta' END FROM organization
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS integration_secret (
  organization_id varchar(255) NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  cipher text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  PRIMARY KEY (organization_id, provider)
);
--> statement-breakpoint
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS provider varchar(20);
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS provider_ref text;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS provider_account varchar(255);
ALTER TABLE message ADD COLUMN IF NOT EXISTS provider varchar(20);
ALTER TABLE message ADD COLUMN IF NOT EXISTS provider_account varchar(255);
ALTER TABLE message ADD COLUMN IF NOT EXISTS provider_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS message_provider_identity_uq ON message(organization_id, provider, provider_account, provider_message_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS whatsapp_address (
  organization_id varchar(255) NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id varchar(255) NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  account varchar(255) NOT NULL,
  address varchar(255) NOT NULL,
  PRIMARY KEY (organization_id, contact_id, account),
  UNIQUE (organization_id, account, address)
);
