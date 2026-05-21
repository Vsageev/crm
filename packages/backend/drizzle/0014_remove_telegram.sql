DELETE FROM "message_drafts"
WHERE "conversation_id" IN (
  SELECT "id" FROM "conversations" WHERE "channel_type" = 'telegram'
);

DELETE FROM "messages"
WHERE "conversation_id" IN (
  SELECT "id" FROM "conversations" WHERE "channel_type" = 'telegram'
);

DELETE FROM "conversations" WHERE "channel_type" = 'telegram';

DROP TABLE IF EXISTS "telegram_bots";

DROP INDEX IF EXISTS "contacts_telegram_id_idx";

ALTER TABLE "contacts" DROP COLUMN IF EXISTS "telegram_id";
