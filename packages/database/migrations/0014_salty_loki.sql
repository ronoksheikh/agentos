CREATE TABLE "comment_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"disposition" text NOT NULL,
	"actor_id" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD CONSTRAINT "comment_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD CONSTRAINT "comment_reviews_decision_id_comment_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."comment_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD CONSTRAINT "comment_reviews_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reviews_decision_uq" ON "comment_reviews" USING btree ("business_id","decision_id");--> statement-breakpoint
CREATE INDEX "comment_reviews_scope_idx" ON "comment_reviews" USING btree ("business_id","reviewed_at");