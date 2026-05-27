CREATE TABLE IF NOT EXISTS "execution_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_type" text NOT NULL,
  "owner_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "status" text NOT NULL,
  "policy_snapshot" jsonb,
  "active_attempt_id" text,
  "idempotency_key" text NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "legacy_data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL,
  "attempt_index" integer NOT NULL,
  "role" text NOT NULL,
  "provider" text,
  "model" text,
  "model_id" text,
  "agent_run_id" text,
  "status" text NOT NULL,
  "error_class" text,
  "error_message" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "legacy_data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_events" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL,
  "attempt_id" text,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "legacy_data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_batch_run_items"
  ADD COLUMN IF NOT EXISTS "execution_job_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_agent_id_agents_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_job_id_execution_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_agent_run_id_agent_runs_id_fk"
    FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_job_id_execution_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_attempt_id_execution_attempts_id_fk"
    FOREIGN KEY ("attempt_id") REFERENCES "public"."execution_attempts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_batch_run_items" ADD CONSTRAINT "agent_batch_run_items_execution_job_id_execution_jobs_id_fk"
    FOREIGN KEY ("execution_job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_idempotency_key_idx" ON "execution_jobs" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_active_owner_idx" ON "execution_jobs" USING btree ("owner_type","owner_id") WHERE "status" in ('queued', 'dispatching', 'running');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_active_target_idx" ON "execution_jobs" USING btree ("agent_id","target_type","target_id") WHERE "status" in ('queued', 'dispatching', 'running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_jobs_owner_idx" ON "execution_jobs" USING btree ("owner_type","owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_jobs_target_status_idx" ON "execution_jobs" USING btree ("agent_id","target_type","target_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_jobs_status_idx" ON "execution_jobs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_attempts_job_idx" ON "execution_attempts" USING btree ("job_id","attempt_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_attempts_agent_run_idx" ON "execution_attempts" USING btree ("agent_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_attempts_status_idx" ON "execution_attempts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_events_job_created_idx" ON "execution_events" USING btree ("job_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_events_attempt_idx" ON "execution_events" USING btree ("attempt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_batch_run_items_execution_job_id_idx" ON "agent_batch_run_items" USING btree ("execution_job_id");
