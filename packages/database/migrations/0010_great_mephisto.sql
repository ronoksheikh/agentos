CREATE TABLE "web_chat_rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD COLUMN "conversation_id" text;--> statement-breakpoint
CREATE INDEX "web_chat_rate_expires_idx" ON "web_chat_rate_buckets" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;