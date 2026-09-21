CREATE TABLE IF NOT EXISTS whatsapp_zernio (
  organization_id varchar(255) PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  account_id varchar(255) NOT NULL UNIQUE,
  cipher text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
