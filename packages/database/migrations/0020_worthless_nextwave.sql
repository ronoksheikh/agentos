CREATE TABLE "comment_classifier_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"label_accepted" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_classifier_usages" ADD CONSTRAINT "comment_classifier_usages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_classifier_usages" ADD CONSTRAINT "comment_classifier_usages_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_classifier_usages" ADD CONSTRAINT "comment_classifier_usages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_classifier_usage_business_time_idx" ON "comment_classifier_usages" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "comment_classifier_usage_agent_time_idx" ON "comment_classifier_usages" USING btree ("business_id","agent_id","created_at");