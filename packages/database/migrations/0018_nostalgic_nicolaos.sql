CREATE TABLE "business_retention_policies" (
	"business_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"messages_days" integer,
	"event_payload_days" integer,
	"trace_details_days" integer,
	"realtime_payload_days" integer,
	"browser_history_days" integer,
	"comment_text_days" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_retention_policies" ADD CONSTRAINT "business_retention_policies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_retention_policies" ADD CONSTRAINT "business_retention_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_retention_enabled_idx" ON "business_retention_policies" USING btree ("enabled","updated_at");