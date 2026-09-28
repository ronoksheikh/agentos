CREATE TABLE "agent_evaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"suite_version" text NOT NULL,
	"status" text NOT NULL,
	"passed_cases" integer NOT NULL,
	"failed_cases" integer NOT NULL,
	"result" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_evaluation_runs" ADD CONSTRAINT "agent_evaluation_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation_runs" ADD CONSTRAINT "agent_evaluation_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation_runs" ADD CONSTRAINT "agent_evaluation_runs_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_evaluations_version_idx" ON "agent_evaluation_runs" USING btree ("business_id","agent_version_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "agent_evaluations_suite_idx" ON "agent_evaluation_runs" USING btree ("business_id","suite_version","status","evaluated_at");