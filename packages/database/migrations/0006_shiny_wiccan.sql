CREATE TABLE "effect_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"conversation_id" text,
	"action_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"included_sequence" integer NOT NULL,
	"related_order_id" text,
	"state" text NOT NULL,
	"external_id" text,
	"safe_code" text,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"trigger_event_id" text,
	"state" text NOT NULL,
	"result_code" text,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"channel" text NOT NULL,
	"connection_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"state" text NOT NULL,
	"message_ids" text[] NOT NULL,
	"event_ids" text[] NOT NULL,
	"first_sequence" integer NOT NULL,
	"upper_sequence" integer NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"run_id" text,
	"safe_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_inbound_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"channel" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"external_event_id" text,
	"payload_sha256" text NOT NULL,
	"payload_bytes" integer NOT NULL,
	"state" text NOT NULL,
	"safe_code" text,
	"retention_until" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"raw_event_id" text,
	"connection_id" text NOT NULL,
	"channel" text NOT NULL,
	"conversation_id" text,
	"customer_id" text,
	"schema_version" text NOT NULL,
	"type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"trace_id" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"safe_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"conversation_id" text,
	"connection_id" text,
	"trace_id" text NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"safe_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "active_batch_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "effect_intents" ADD CONSTRAINT "effect_intents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effect_intents" ADD CONSTRAINT "effect_intents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effect_intents" ADD CONSTRAINT "effect_intents_related_order_id_orders_id_fk" FOREIGN KEY ("related_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_executions" ADD CONSTRAINT "goal_executions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_executions" ADD CONSTRAINT "goal_executions_goal_id_pending_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."pending_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_inbound_events" ADD CONSTRAINT "raw_inbound_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universal_events" ADD CONSTRAINT "universal_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universal_events" ADD CONSTRAINT "universal_events_raw_event_id_raw_inbound_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_inbound_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universal_events" ADD CONSTRAINT "universal_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universal_events" ADD CONSTRAINT "universal_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "effect_intents_dedupe_uq" ON "effect_intents" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "effect_intents_state_idx" ON "effect_intents" USING btree ("business_id","state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_executions_once_uq" ON "goal_executions" USING btree ("business_id","goal_id");--> statement-breakpoint
CREATE INDEX "goal_executions_state_idx" ON "goal_executions" USING btree ("business_id","state");--> statement-breakpoint
CREATE INDEX "message_batches_due_idx" ON "message_batches" USING btree ("business_id","state","due_at");--> statement-breakpoint
CREATE INDEX "message_batches_conversation_idx" ON "message_batches" USING btree ("business_id","conversation_id","upper_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_inbound_dedupe_uq" ON "raw_inbound_events" USING btree ("business_id","connection_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "raw_inbound_retention_idx" ON "raw_inbound_events" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "universal_events_dedupe_uq" ON "universal_events" USING btree ("business_id","connection_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "universal_events_state_idx" ON "universal_events" USING btree ("business_id","state","received_at");--> statement-breakpoint
CREATE INDEX "universal_events_conversation_idx" ON "universal_events" USING btree ("business_id","conversation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_resource_uq" ON "work_items" USING btree ("business_id","kind","resource_id");--> statement-breakpoint
CREATE INDEX "work_items_due_idx" ON "work_items" USING btree ("state","run_at","priority");--> statement-breakpoint
CREATE INDEX "work_items_scope_idx" ON "work_items" USING btree ("business_id","state","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_uq" ON "messages" USING btree ("business_id","connection_id","external_message_id");