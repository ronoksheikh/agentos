CREATE TABLE "channel_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"channel" text NOT NULL,
	"external_page_id" text NOT NULL,
	"display_name" text,
	"agent_id" text NOT NULL,
	"credential_ref_id" text,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"paused" boolean DEFAULT true NOT NULL,
	"setup_method" text NOT NULL,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_verified_at" timestamp with time zone,
	"test_message_id" text,
	"test_conversation_id" text,
	"reply_verified_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_webhook_at" timestamp with time zone,
	"last_error_code" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_secrets" (
	"reference_id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messenger_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"action_id" text NOT NULL,
	"state" text NOT NULL,
	"external_message_id" text,
	"safe_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messenger_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"last_customer_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"business_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"credential_ref_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_webhook_status" (
	"app_id" text PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_credential_ref_id_credential_references_id_fk" FOREIGN KEY ("credential_ref_id") REFERENCES "public"."credential_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_secrets" ADD CONSTRAINT "credential_secrets_reference_id_credential_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."credential_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_secrets" ADD CONSTRAINT "credential_secrets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_sends" ADD CONSTRAINT "messenger_sends_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_sends" ADD CONSTRAINT "messenger_sends_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_sends" ADD CONSTRAINT "messenger_sends_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_threads" ADD CONSTRAINT "messenger_threads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_threads" ADD CONSTRAINT "messenger_threads_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_threads" ADD CONSTRAINT "messenger_threads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_threads" ADD CONSTRAINT "messenger_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_oauth_states" ADD CONSTRAINT "meta_oauth_states_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_oauth_states" ADD CONSTRAINT "meta_oauth_states_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_oauth_states" ADD CONSTRAINT "meta_oauth_states_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_oauth_states" ADD CONSTRAINT "meta_oauth_states_credential_ref_id_credential_references_id_fk" FOREIGN KEY ("credential_ref_id") REFERENCES "public"."credential_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_page_uq" ON "channel_connections" USING btree ("channel","external_page_id");--> statement-breakpoint
CREATE INDEX "channel_connections_business_idx" ON "channel_connections" USING btree ("business_id","state");--> statement-breakpoint
CREATE INDEX "credential_secrets_business_idx" ON "credential_secrets" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_sends_key_uq" ON "messenger_sends" USING btree ("business_id","connection_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "messenger_sends_state_idx" ON "messenger_sends" USING btree ("business_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_threads_sender_uq" ON "messenger_threads" USING btree ("business_id","connection_id","sender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_threads_conversation_uq" ON "messenger_threads" USING btree ("business_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_oauth_states_hash_uq" ON "meta_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "meta_oauth_states_business_idx" ON "meta_oauth_states" USING btree ("business_id","expires_at");