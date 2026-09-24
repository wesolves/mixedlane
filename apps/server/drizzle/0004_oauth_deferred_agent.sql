ALTER TABLE "oauth_codes" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD COLUMN "new_agent" jsonb;