CREATE TABLE "job_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"reporter" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_reports_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "job_reports_reporter_chk" CHECK ("job_reports"."reporter" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "job_reports_reason_chk" CHECK ("job_reports"."reason" in ('wrong_model', 'bad_output', 'other')),
	CONSTRAINT "job_reports_status_chk" CHECK ("job_reports"."status" in ('open', 'upheld', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_reports_status_created_idx" ON "job_reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "job_reports_node_idx" ON "job_reports" USING btree ("node_id");