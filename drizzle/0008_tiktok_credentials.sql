CREATE TABLE IF NOT EXISTS tiktok_credentials (
  id varchar(255) PRIMARY KEY,
  organization_id varchar(255) NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  source varchar(20) NOT NULL DEFAULT 'zernio',
  tiktok_user_id varchar(255),
  username varchar(255),
  account_ref varchar(255),
  token_cipher varchar(1024) NOT NULL,
  token_iv varchar(255) NOT NULL,
  token_tag varchar(255) NOT NULL,
  webhook_secret varchar(255),
  status varchar(30) NOT NULL DEFAULT 'connected',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tiktok_credentials_org_uq ON tiktok_credentials(organization_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tiktok_credentials_account_ref_idx ON tiktok_credentials(account_ref);
