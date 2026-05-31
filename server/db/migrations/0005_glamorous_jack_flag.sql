CREATE TABLE "tracked_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"position" text DEFAULT 'עוקבים' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uniq_user_bill" UNIQUE("user_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "tracked_committees" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"committee_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uniq_user_committee" UNIQUE("user_id","committee_id")
);
--> statement-breakpoint
CREATE TABLE "tracked_mks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mk_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uniq_user_mk" UNIQUE("user_id","mk_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracked_bills" ADD CONSTRAINT "tracked_bills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_bills" ADD CONSTRAINT "tracked_bills_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_committees" ADD CONSTRAINT "tracked_committees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_committees" ADD CONSTRAINT "tracked_committees_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_mks" ADD CONSTRAINT "tracked_mks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_mks" ADD CONSTRAINT "tracked_mks_mk_id_mks_id_fk" FOREIGN KEY ("mk_id") REFERENCES "public"."mks"("id") ON DELETE restrict ON UPDATE no action;