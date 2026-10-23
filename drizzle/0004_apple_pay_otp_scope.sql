DROP INDEX "card_webhook_events_uq";--> statement-breakpoint
ALTER TABLE "card_webhook_events" ADD COLUMN "provider_scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_webhook_events" ADD COLUMN "event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "provider_scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "card_webhook_events_uq" ON "card_webhook_events" USING btree ("provider_scope","provider_event_id");