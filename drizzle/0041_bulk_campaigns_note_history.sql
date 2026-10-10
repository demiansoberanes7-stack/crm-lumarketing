CREATE TABLE IF NOT EXISTS contact_note (
  id varchar(255) PRIMARY KEY,
  organization_id varchar(255) NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_id varchar(255) NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  body text NOT NULL,
  source varchar(20) NOT NULL DEFAULT 'manual',
  created_by varchar(255) REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_note_org_contact_created_idx
  ON contact_note (organization_id, contact_id, created_at);
CREATE INDEX IF NOT EXISTS contact_note_org_created_idx
  ON contact_note (organization_id, created_at);

-- Preserve the current note as a legacy snapshot; prior revisions cannot be
-- reconstructed from the old single text field.
INSERT INTO contact_note (id, organization_id, contact_id, body, source, created_at)
SELECT 'ctn_legacy_' || md5(c.organization_id || ':' || c.id),
       c.organization_id,
       c.id,
       c.notes,
       'legacy',
       c.updated_at
FROM contact c
WHERE c.notes IS NOT NULL AND btrim(c.notes) <> ''
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS broadcast_campaign (
  id varchar(255) PRIMARY KEY,
  organization_id varchar(255) NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  channel varchar(20) NOT NULL,
  sender_account_id varchar(255),
  subject varchar(1024),
  message_text text NOT NULL,
  template_name varchar(255),
  template_language varchar(20),
  template_params jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'draft',
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  created_by varchar(255) REFERENCES "user"(id) ON DELETE SET NULL,
  scheduled_at timestamp,
  started_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broadcast_campaign_org_created_idx
  ON broadcast_campaign (organization_id, created_at);
CREATE INDEX IF NOT EXISTS broadcast_campaign_status_schedule_idx
  ON broadcast_campaign (status, scheduled_at);

CREATE TABLE IF NOT EXISTS broadcast_recipient (
  id varchar(255) PRIMARY KEY,
  organization_id varchar(255) NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  campaign_id varchar(255) NOT NULL REFERENCES broadcast_campaign(id) ON DELETE CASCADE,
  contact_id varchar(255) REFERENCES contact(id) ON DELETE SET NULL,
  conversation_id varchar(255) REFERENCES conversation(id) ON DELETE SET NULL,
  channel varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',
  message_id varchar(255),
  provider_message_id text,
  error_code varchar(80),
  error_message text,
  skip_reason varchar(100),
  attempts integer NOT NULL DEFAULT 0,
  scheduled_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  sent_at timestamp,
  delivered_at timestamp,
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS broadcast_recipient_campaign_contact_uq
  ON broadcast_recipient (campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS broadcast_recipient_due_idx
  ON broadcast_recipient (status, scheduled_at);
CREATE INDEX IF NOT EXISTS broadcast_recipient_org_campaign_idx
  ON broadcast_recipient (organization_id, campaign_id);
CREATE INDEX IF NOT EXISTS broadcast_recipient_conversation_idx
  ON broadcast_recipient (organization_id, conversation_id, created_at);

-- Replace live automatic rules without deleting their configuration/history.
UPDATE integration i
SET credentials = jsonb_set(
      i.credentials,
      '{rules}',
      coalesce((
        SELECT jsonb_agg(
          CASE
            WHEN jsonb_typeof(r.rule) = 'object' AND r.rule->'enabled' = 'true'::jsonb
              THEN jsonb_set(r.rule, '{enabled}', 'false'::jsonb, true)
            ELSE r.rule
          END ORDER BY r.ordinality
        )
        FROM jsonb_array_elements(i.credentials->'rules') WITH ORDINALITY AS r(rule, ordinality)
      ), '[]'::jsonb),
      true
    ),
    updated_at = now()
WHERE i.provider = 'automation_rules'
  AND jsonb_typeof(i.credentials->'rules') = 'array';

-- Pending automatic follow-ups are retained as cancelled audit records, not
-- deleted or delivered after the UI moves to explicit bulk campaigns.
UPDATE automation_execution
SET status = 'cancelled',
    error = 'Regla automática desactivada al sustituir Automatizaciones por Envíos masivos',
    updated_at = now()
WHERE status = 'queued'
  AND triggered_by <> 'manual';
