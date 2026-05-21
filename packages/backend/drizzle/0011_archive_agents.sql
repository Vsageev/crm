ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_archived_at_idx" ON "agents" USING btree ("archived_at");
