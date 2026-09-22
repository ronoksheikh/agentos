CREATE TABLE "custom_tool_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"run_id" text NOT NULL,
	"intent_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"safe_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_tool_intents" ADD CONSTRAINT "custom_tool_intents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tool_intents" ADD CONSTRAINT "custom_tool_intents_tool_id_custom_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."custom_tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tool_intents_scope_uq" ON "custom_tool_intents" USING btree ("business_id","tool_id","intent_key");--> statement-breakpoint
CREATE INDEX "custom_tool_intents_status_idx" ON "custom_tool_intents" USING btree ("business_id","status","updated_at");