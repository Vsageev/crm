CREATE TABLE IF NOT EXISTS "board_execution_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "board_id" text NOT NULL REFERENCES "boards"("id"),
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL,
  "layers" jsonb NOT NULL,
  "created_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "legacy_data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_execution_plans_board_id_idx" ON "board_execution_plans" USING btree ("board_id");
