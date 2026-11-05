CREATE TABLE "mixdi_settings" (
  "org_id" uuid PRIMARY KEY REFERENCES "orgs"("id") ON DELETE CASCADE,
  "settings" jsonb NOT NULL,
  "providers_enc" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mixdi_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "request" jsonb NOT NULL,
  "draft" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "claimed_at" timestamptz,
  "result" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
