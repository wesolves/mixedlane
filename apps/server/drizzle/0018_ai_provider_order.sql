ALTER TABLE whatsapp_connections ADD COLUMN provider_order jsonb NOT NULL DEFAULT '[]'::jsonb;
