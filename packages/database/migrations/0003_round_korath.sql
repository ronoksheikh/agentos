CREATE TABLE "attachment_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"language" text,
	"confidence" double precision,
	"provider" text NOT NULL,
	"version" text NOT NULL,
	"source_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"conversation_id" text,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_hash" text,
	"object_key" text,
	"status" text NOT NULL,
	"error_code" text,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"safe_url" text,
	"safe_code" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"run_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"safe_url" text NOT NULL,
	"status" text NOT NULL,
	"actions" integer DEFAULT 0 NOT NULL,
	"egress" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_references" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"vault_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"method" text NOT NULL,
	"base_url" text NOT NULL,
	"path_template" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"output_mapping" jsonb NOT NULL,
	"safe_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ref_id" text,
	"allowed_hosts" text[] NOT NULL,
	"allowed_agent_ids" text[] NOT NULL,
	"required_capabilities" text[] NOT NULL,
	"safety_class" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"test_state" text DEFAULT 'UNTESTED' NOT NULL,
	"timeout_ms" integer NOT NULL,
	"max_request_bytes" integer NOT NULL,
	"max_response_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"canonical_url" text,
	"status" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"checksum" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"retention_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"pending_order_id" text NOT NULL,
	"intent_key" text NOT NULL,
	"order_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text,
	"canonical_url" text,
	"product_name" text NOT NULL,
	"variant_name" text NOT NULL,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"discount_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"number" text NOT NULL,
	"conversation_id" text NOT NULL,
	"customer_id" text,
	"pending_order_id" text NOT NULL,
	"source_channel" text NOT NULL,
	"source_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"agent_id" text,
	"agent_version_id" text,
	"run_id" text,
	"origin" text NOT NULL,
	"fields" jsonb NOT NULL,
	"payment_method" text NOT NULL,
	"delivery_method" text NOT NULL,
	"confirmation" text NOT NULL,
	"status" text NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"notification_state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"customer_id" text,
	"channel" text NOT NULL,
	"agent_id" text,
	"agent_version_id" text,
	"run_id" text,
	"state" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"missing_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"payment_method" text,
	"delivery_method" text,
	"confirmation" text NOT NULL,
	"source_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_goals" ADD COLUMN "trigger_type" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_goals" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "attachment_artifacts" ADD CONSTRAINT "attachment_artifacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_artifacts" ADD CONSTRAINT "attachment_artifacts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_runs" ADD CONSTRAINT "browser_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_runs" ADD CONSTRAINT "browser_runs_session_id_browser_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_runs" ADD CONSTRAINT "browser_runs_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_references" ADD CONSTRAINT "credential_references_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_credential_ref_id_credential_references_id_fk" FOREIGN KEY ("credential_ref_id") REFERENCES "public"."credential_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_audits" ADD CONSTRAINT "order_audits_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_audits" ADD CONSTRAINT "order_audits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_pending_order_id_pending_orders_id_fk" FOREIGN KEY ("pending_order_id") REFERENCES "public"."pending_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_policies" ADD CONSTRAINT "order_policies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pending_order_id_pending_orders_id_fk" FOREIGN KEY ("pending_order_id") REFERENCES "public"."pending_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_artifacts_scope_idx" ON "attachment_artifacts" USING btree ("business_id","attachment_id");--> statement-breakpoint
CREATE INDEX "attachments_scope_idx" ON "attachments" USING btree ("business_id","conversation_id","status");--> statement-breakpoint
CREATE INDEX "attachments_hash_idx" ON "attachments" USING btree ("business_id","content_hash");--> statement-breakpoint
CREATE INDEX "browser_runs_scope_idx" ON "browser_runs" USING btree ("business_id","run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "browser_sessions_scope_idx" ON "browser_sessions" USING btree ("business_id","run_id","status");--> statement-breakpoint
CREATE INDEX "credential_refs_scope_idx" ON "credential_references" USING btree ("business_id","kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tools_name_uq" ON "custom_tools" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "custom_tools_scope_idx" ON "custom_tools" USING btree ("business_id","enabled");--> statement-breakpoint
CREATE INDEX "customer_notes_scope_idx" ON "customer_notes" USING btree ("business_id","customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_version_ordinal_uq" ON "knowledge_chunks" USING btree ("business_id","source_id","source_version","ordinal");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
CREATE INDEX "knowledge_sources_scope_idx" ON "knowledge_sources" USING btree ("business_id","status","enabled");--> statement-breakpoint
CREATE INDEX "knowledge_sources_checksum_idx" ON "knowledge_sources" USING btree ("business_id","checksum");--> statement-breakpoint
CREATE INDEX "order_audits_scope_idx" ON "order_audits" USING btree ("business_id","order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_intents_scope_uq" ON "order_intents" USING btree ("business_id","conversation_id","pending_order_id","intent_key");--> statement-breakpoint
CREATE INDEX "order_items_scope_idx" ON "order_items" USING btree ("business_id","order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("business_id","product_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_policies_business_uq" ON "order_policies" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_uq" ON "orders" USING btree ("business_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_pending_uq" ON "orders" USING btree ("business_id","pending_order_id");--> statement-breakpoint
CREATE INDEX "orders_scope_status_idx" ON "orders" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("business_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "pending_orders_scope_idx" ON "pending_orders" USING btree ("business_id","conversation_id","state","expires_at");