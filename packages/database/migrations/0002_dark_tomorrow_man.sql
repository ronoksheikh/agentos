CREATE TYPE "public"."handoff_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_preference" AS ENUM('ENABLED', 'DENIED', 'UNAVAILABLE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "client_projection_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"conversation_id" text,
	"run_id" text,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"safe_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_ownership_history" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"handoff_id" text,
	"from_state" "conversation_ownership" NOT NULL,
	"to_state" "conversation_ownership" NOT NULL,
	"actor_id" text NOT NULL,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"user_id" text NOT NULL,
	"browser_delivery" "notification_delivery_preference" DEFAULT 'DISABLED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"site_id" text NOT NULL,
	"customer_id" text,
	"visitor_id_hash" text NOT NULL,
	"origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"public_key" text NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sdk_major_version" integer DEFAULT 1 NOT NULL,
	"requests_per_minute" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoffs" ALTER COLUMN "priority" SET DEFAULT 'NORMAL'::"public"."handoff_priority";--> statement-breakpoint
ALTER TABLE "handoffs" ALTER COLUMN "priority" SET DATA TYPE "public"."handoff_priority" USING "priority"::"public"."handoff_priority";--> statement-breakpoint
ALTER TABLE "handoffs" ALTER COLUMN "state" SET DEFAULT 'HANDOFF_REQUESTED'::"public"."conversation_ownership";--> statement-breakpoint
ALTER TABLE "handoffs" ALTER COLUMN "state" SET DATA TYPE "public"."conversation_ownership" USING "state"::"public"."conversation_ownership";--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "channel" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "external_reference" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "stale_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "handoff_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "client_projection_events" ADD CONSTRAINT "client_projection_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_projection_events" ADD CONSTRAINT "client_projection_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_projection_events" ADD CONSTRAINT "client_projection_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_ownership_history" ADD CONSTRAINT "conversation_ownership_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_ownership_history" ADD CONSTRAINT "conversation_ownership_history_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_ownership_history" ADD CONSTRAINT "conversation_ownership_history_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_site_id_website_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."website_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_sites" ADD CONSTRAINT "website_sites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_sites" ADD CONSTRAINT "website_sites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_projection_source_uq" ON "client_projection_events" USING btree ("business_id","source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_projection_sequence_uq" ON "client_projection_events" USING btree ("business_id","sequence");--> statement-breakpoint
CREATE INDEX "client_projection_conversation_idx" ON "client_projection_events" USING btree ("business_id","conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "ownership_history_scope_idx" ON "conversation_ownership_history" USING btree ("business_id","conversation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_scope_uq" ON "notification_preferences" USING btree ("business_id","user_id");--> statement-breakpoint
CREATE INDEX "visitor_sessions_scope_idx" ON "visitor_sessions" USING btree ("business_id","site_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_sessions_identity_uq" ON "visitor_sessions" USING btree ("business_id","site_id","visitor_id_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "website_sites_public_key_uq" ON "website_sites" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "website_sites_business_idx" ON "website_sites" USING btree ("business_id","agent_id");--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoffs_attention_idx" ON "handoffs" USING btree ("business_id","state","priority","stale_at");