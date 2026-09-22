CREATE TABLE "order_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_audits" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_notes_scope_idx" ON "order_notes" USING btree ("business_id","order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_audits_idempotency_uq" ON "order_audits" USING btree ("business_id","order_id","idempotency_key");