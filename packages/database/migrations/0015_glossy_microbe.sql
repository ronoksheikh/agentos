CREATE TABLE "service_heartbeats" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "service_heartbeats_live_idx" ON "service_heartbeats" USING btree ("service","last_seen_at");