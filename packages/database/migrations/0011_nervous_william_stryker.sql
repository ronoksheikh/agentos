CREATE TABLE "comment_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"classification" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"outcome" text NOT NULL,
	"safe_reason" text NOT NULL,
	"action_status" text DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_id" text NOT NULL,
	"run_id" text,
	"external_action_id" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_reply" boolean DEFAULT false NOT NULL,
	"auto_hide" boolean DEFAULT false NOT NULL,
	"allow_delete" boolean DEFAULT false NOT NULL,
	"minimum_confidence" double precision DEFAULT 0.85 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"post_id" text,
	"external_comment_id" text NOT NULL,
	"external_parent_id" text,
	"author_external_id" text,
	"customer_id" text,
	"conversation_id" text,
	"text" text,
	"can_comment" boolean,
	"can_hide" boolean,
	"is_hidden" boolean,
	"source_event_id" text NOT NULL,
	"state" text DEFAULT 'RECEIVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_post_id" text NOT NULL,
	"text" text,
	"product_ref" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_comment_id_facebook_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."facebook_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_source_event_id_universal_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."universal_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_policies" ADD CONSTRAINT "comment_policies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_policies" ADD CONSTRAINT "comment_policies_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_policies" ADD CONSTRAINT "comment_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_comments" ADD CONSTRAINT "facebook_comments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_comments" ADD CONSTRAINT "facebook_comments_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_comments" ADD CONSTRAINT "facebook_comments_post_id_facebook_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."facebook_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_comments" ADD CONSTRAINT "facebook_comments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_comments" ADD CONSTRAINT "facebook_comments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_comments" ADD CONSTRAINT "facebook_comments_source_event_id_universal_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."universal_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_posts" ADD CONSTRAINT "facebook_posts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_posts" ADD CONSTRAINT "facebook_posts_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_decisions_idempotency_uq" ON "comment_decisions" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "comment_decisions_scope_idx" ON "comment_decisions" USING btree ("business_id","comment_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_policies_scope_uq" ON "comment_policies" USING btree ("business_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facebook_comments_external_uq" ON "facebook_comments" USING btree ("business_id","connection_id","external_comment_id");--> statement-breakpoint
CREATE INDEX "facebook_comments_post_idx" ON "facebook_comments" USING btree ("business_id","post_id");--> statement-breakpoint
CREATE INDEX "facebook_comments_state_idx" ON "facebook_comments" USING btree ("business_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "facebook_posts_external_uq" ON "facebook_posts" USING btree ("business_id","connection_id","external_post_id");