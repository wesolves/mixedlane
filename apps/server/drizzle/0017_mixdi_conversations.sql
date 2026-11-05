CREATE TABLE "mixdi_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "context" jsonb NOT NULL,
  "messages" jsonb NOT NULL,
  "draft_id" uuid REFERENCES "mixdi_drafts"("id") ON DELETE SET NULL,
  "version" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "mixdi_conversations_owner_idx" ON "mixdi_conversations" ("org_id", "user_id", "updated_at");
