CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"name" text,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"monthly_cap_usdg_micros" bigint,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"subject" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer_balances" (
	"buyer_id" uuid PRIMARY KEY NOT NULL,
	"balance_usdg_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_usdg_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_balances_reserved_chk" CHECK ("buyer_balances"."reserved_usdg_micros" >= 0),
	CONSTRAINT "buyer_balances_available_chk" CHECK ("buyer_balances"."balance_usdg_micros" - "buyer_balances"."reserved_usdg_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "buyer_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"usdg_micros" bigint NOT NULL,
	"job_id" uuid,
	"tx_hash" text,
	"log_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_ledger_kind_chk" CHECK ("buyer_ledger"."kind" in ('deposit', 'charge', 'refund', 'adjust'))
);
--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyers_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "buyers_address_unique" UNIQUE("address"),
	CONSTRAINT "buyers_address_chk" CHECK ("buyers"."address" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "canary_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" text,
	"expected" jsonb,
	"observed" jsonb,
	"pass" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_usd_cents" bigint,
	"network" text,
	"invoice" jsonb,
	"funding_wallet" text,
	"ip_hash" text,
	"provider_txn_id" text,
	"status" text NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_operations_kind_chk" CHECK ("card_operations"."kind" in ('issue', 'topup')),
	CONSTRAINT "card_operations_network_chk" CHECK (("card_operations"."network" is null or "card_operations"."network" in ('bsc', 'tron'))),
	CONSTRAINT "card_operations_status_chk" CHECK ("card_operations"."status" in ('created', 'submitting', 'awaiting_payment', 'processing', 'completed', 'failed', 'expired', 'review')),
	CONSTRAINT "card_operations_wallet_chk" CHECK (("card_operations"."funding_wallet" is null or "card_operations"."funding_wallet" ~ '^0x[0-9a-f]{40}$'))
);
--> statement-breakpoint
CREATE TABLE "card_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_enc" text,
	"alias_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"provider_txn_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text,
	"merchant" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"raw" jsonb,
	CONSTRAINT "card_transactions_provider_txn_id_unique" UNIQUE("provider_txn_id")
);
--> statement-breakpoint
CREATE TABLE "card_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"type" text,
	"payload" jsonb,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_card_id" text,
	"client_card_ref" uuid DEFAULT gen_random_uuid() NOT NULL,
	"product" text NOT NULL,
	"last4" text,
	"status" text NOT NULL,
	"balance_usd_cents" bigint,
	"finish" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	CONSTRAINT "cards_provider_card_id_unique" UNIQUE("provider_card_id"),
	CONSTRAINT "cards_client_card_ref_unique" UNIQUE("client_card_ref"),
	CONSTRAINT "cards_status_chk" CHECK ("cards"."status" in ('pending_payment', 'paid_pending_issue', 'issued', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"epoch" bigint NOT NULL,
	"amount_usdg_micros" bigint NOT NULL,
	"tx_hash" text,
	"block_number" bigint,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_tx_hash_unique" UNIQUE("tx_hash"),
	CONSTRAINT "claims_owner_chk" CHECK ("claims"."owner" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "claims_status_chk" CHECK ("claims"."status" in ('submitted', 'confirmed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "earning_events" (
	"ts" timestamp with time zone NOT NULL,
	"node_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"job_id" uuid,
	"kind" text NOT NULL,
	"usdg_micros" bigint NOT NULL,
	"epoch" bigint,
	CONSTRAINT "earning_events_owner_chk" CHECK ("earning_events"."owner" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "earning_events_kind_chk" CHECK ("earning_events"."kind" in ('job', 'floor', 'slash', 'canary_withhold'))
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text,
	"pairing_code" text,
	"node_key" text,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "enrollments_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "enrollments_pairing_code_unique" UNIQUE("pairing_code"),
	CONSTRAINT "enrollments_kind_chk" CHECK ("enrollments"."kind" in ('token', 'pairing')),
	CONSTRAINT "enrollments_status_chk" CHECK ("enrollments"."status" in ('pending', 'claimed', 'approved', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "epoch_balances" (
	"epoch" bigint NOT NULL,
	"owner" text NOT NULL,
	"cumulative_usdg_micros" bigint NOT NULL,
	CONSTRAINT "epoch_balances_epoch_owner_pk" PRIMARY KEY("epoch","owner"),
	CONSTRAINT "epoch_balances_owner_chk" CHECK ("epoch_balances"."owner" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "epochs" (
	"epoch" bigint PRIMARY KEY NOT NULL,
	"root" text NOT NULL,
	"total_earned_usdg_micros" bigint NOT NULL,
	"owners" integer NOT NULL,
	"tree_path" text NOT NULL,
	"tx_hash" text,
	"status" text NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	CONSTRAINT "epochs_status_chk" CHECK ("epochs"."status" in ('built', 'posting', 'posted', 'vetoed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "floor_payments" (
	"epoch" bigint NOT NULL,
	"node_id" uuid NOT NULL,
	"usdg_micros" bigint NOT NULL,
	CONSTRAINT "floor_payments_epoch_node_id_pk" PRIMARY KEY("epoch","node_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"node_id" uuid,
	"lane" text,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"units" numeric DEFAULT '0' NOT NULL,
	"unit_kind" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"buyer_usdg_micros" bigint DEFAULT 0 NOT NULL,
	"provider_usdg_micros" bigint DEFAULT 0 NOT NULL,
	"pay_mode" text NOT NULL,
	"x402_payment_id" uuid,
	"status" text NOT NULL,
	"error" text,
	"is_canary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_lane_chk" CHECK (("jobs"."lane" is null or "jobs"."lane" in ('sealed', 'open'))),
	CONSTRAINT "jobs_kind_chk" CHECK ("jobs"."kind" in ('chat', 'embeddings', 'images')),
	CONSTRAINT "jobs_unit_kind_chk" CHECK ("jobs"."unit_kind" in ('tokens_1m', 'image', 'job', 'gpu_hour')),
	CONSTRAINT "jobs_pay_mode_chk" CHECK ("jobs"."pay_mode" in ('balance', 'x402', 'canary', 'probe')),
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled', 'timeout'))
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text,
	"engine_ids" jsonb,
	"hf_tokenizer" text,
	"kind" text,
	"min_vram_gb" integer,
	"lanes" text[],
	"enabled" boolean DEFAULT true NOT NULL,
	"unit_kind" text
);
--> statement-breakpoint
CREATE TABLE "node_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"quote_hash" text,
	"bundle" jsonb,
	"verified" boolean DEFAULT false NOT NULL,
	"reason" text,
	"measurements" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onchain_id" bigint,
	"owner" text NOT NULL,
	"user_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"node_pubkey" text NOT NULL,
	"name" text NOT NULL,
	"engine" text NOT NULL,
	"gpu_model" text,
	"gpu_count" integer,
	"vram_gb" integer,
	"gpu_class" smallint NOT NULL,
	"cc_capable" boolean DEFAULT false NOT NULL,
	"lane" text NOT NULL,
	"binding_sig" text,
	"binding_deadline" bigint,
	"registered" boolean DEFAULT false NOT NULL,
	"stake_spdl" numeric(78, 0) DEFAULT '0' NOT NULL,
	"stake_pending" numeric(78, 0) DEFAULT '0' NOT NULL,
	"reputation" integer DEFAULT 1000 NOT NULL,
	"status" text NOT NULL,
	"suspended_reason" text,
	"is_house" boolean DEFAULT false NOT NULL,
	"agent_version" text,
	"benchmark" jsonb,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_probe_at" timestamp with time zone,
	"last_attest_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_onchain_id_unique" UNIQUE("onchain_id"),
	CONSTRAINT "nodes_node_key_unique" UNIQUE("node_key"),
	CONSTRAINT "nodes_owner_chk" CHECK ("nodes"."owner" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "nodes_node_key_chk" CHECK ("nodes"."node_key" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "nodes_engine_chk" CHECK ("nodes"."engine" in ('ollama', 'vllm')),
	CONSTRAINT "nodes_lane_chk" CHECK ("nodes"."lane" in ('sealed', 'open')),
	CONSTRAINT "nodes_status_chk" CHECK ("nodes"."status" in ('offline', 'online', 'busy', 'suspended', 'deactivated'))
);
--> statement-breakpoint
CREATE TABLE "probe_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"vram_gb" integer,
	"tok_per_sec" numeric,
	"class_ok" boolean NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_card" (
	"day" date NOT NULL,
	"gpu_class" smallint NOT NULL,
	"lane" text NOT NULL,
	"unit_kind" text NOT NULL,
	"provider_usdg_micros_per_unit" bigint NOT NULL,
	"buyer_usdg_micros_per_unit" bigint NOT NULL,
	CONSTRAINT "rate_card_day_gpu_class_lane_unit_kind_pk" PRIMARY KEY("day","gpu_class","lane","unit_kind"),
	CONSTRAINT "rate_card_lane_chk" CHECK ("rate_card"."lane" in ('sealed', 'open')),
	CONSTRAINT "rate_card_unit_kind_chk" CHECK ("rate_card"."unit_kind" in ('tokens_1m', 'image', 'job', 'gpu_hour'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"cose" "bytea" NOT NULL,
	"payload" jsonb NOT NULL,
	"attestation_ref" text,
	"verified" boolean NOT NULL,
	"reason" text,
	"recount_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_operation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"origin_amount_micros" bigint,
	"dest_currency" text,
	"dest_chain_id" bigint,
	"dest_address" text,
	"dest_amount" text,
	"quote" jsonb,
	"deposit_tx" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relay_orders_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "relay_orders_status_chk" CHECK ("relay_orders"."status" in ('quoted', 'signing', 'submitted', 'pending', 'success', 'refund', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"fresh_until" timestamp with time zone,
	"user_agent" text,
	"ip_hash" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "slash_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb,
	"evidence_hash" text,
	"proposed_bps" integer,
	"status" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slash_cases_status_chk" CHECK ("slash_cases"."status" in ('open', 'submitted', 'executed', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "stock_tokens" (
	"address" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"decimals" integer NOT NULL,
	"pool_fee" integer,
	"pool_address" text,
	"verified_at" timestamp with time zone,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stock_tokens_address_chk" CHECK ("stock_tokens"."address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "stock_tokens_pool_chk" CHECK (("stock_tokens"."pool_address" is null or "stock_tokens"."pool_address" ~ '^0x[0-9a-f]{40}$'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "users_address_unique" UNIQUE("address"),
	CONSTRAINT "users_address_chk" CHECK ("users"."address" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" text NOT NULL,
	"payer" text NOT NULL,
	"scheme" text NOT NULL,
	"cap_micros" bigint,
	"surcharge_micros" bigint,
	"used_micros" bigint DEFAULT 0 NOT NULL,
	"nonce" numeric(78, 0),
	"deadline" bigint,
	"valid_after" bigint,
	"signature" text,
	"permit" jsonb,
	"status" text NOT NULL,
	"session_token_hash" text,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"settle_tx" text,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "x402_payments_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "x402_payments_session_token_hash_unique" UNIQUE("session_token_hash"),
	CONSTRAINT "x402_payments_payer_chk" CHECK ("x402_payments"."payer" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "x402_payments_scheme_chk" CHECK ("x402_payments"."scheme" in ('exact', 'session')),
	CONSTRAINT "x402_payments_status_chk" CHECK ("x402_payments"."status" in ('open', 'closing', 'settling', 'settled', 'failed', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_balances" ADD CONSTRAINT "buyer_balances_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_ledger" ADD CONSTRAINT "buyer_ledger_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canary_results" ADD CONSTRAINT "canary_results_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canary_results" ADD CONSTRAINT "canary_results_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_operations" ADD CONSTRAINT "card_operations_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_operations" ADD CONSTRAINT "card_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_profiles" ADD CONSTRAINT "card_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_payments" ADD CONSTRAINT "floor_payments_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_x402_payment_id_x402_payments_id_fk" FOREIGN KEY ("x402_payment_id") REFERENCES "public"."x402_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_attestations" ADD CONSTRAINT "node_attestations_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_results" ADD CONSTRAINT "probe_results_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_orders" ADD CONSTRAINT "relay_orders_card_operation_id_card_operations_id_fk" FOREIGN KEY ("card_operation_id") REFERENCES "public"."card_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_orders" ADD CONSTRAINT "relay_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slash_cases" ADD CONSTRAINT "slash_cases_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_ledger_tx_log_uq" ON "buyer_ledger" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "buyer_ledger_buyer_idx" ON "buyer_ledger" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "card_operations_status_lease_idx" ON "card_operations" USING btree ("status","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "card_webhook_events_uq" ON "card_webhook_events" USING btree ("provider_event_id","payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_one_pending_per_product_uq" ON "cards" USING btree ("user_id","product") WHERE "cards"."status" = 'pending_payment';--> statement-breakpoint
CREATE INDEX "claims_owner_created_idx" ON "claims" USING btree ("owner","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "earning_events_owner_ts_idx" ON "earning_events" USING btree ("owner","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "earning_events_epoch_idx" ON "earning_events" USING btree ("epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_pending_pairing_uq" ON "enrollments" USING btree ("pairing_code") WHERE "enrollments"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_buyer_created_idx" ON "jobs" USING btree ("buyer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_node_created_idx" ON "jobs" USING btree ("node_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "nodes_owner_idx" ON "nodes" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "nodes_status_idx" ON "nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "receipts_node_idx" ON "receipts" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "x402_payments_status_deadline_idx" ON "x402_payments" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "x402_payments_payer_status_idx" ON "x402_payments" USING btree ("payer","status");