CREATE INDEX "idx_committee_sessions_committee_id" ON "committee_sessions" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "idx_mk_activity_mk_id" ON "mk_activity" USING btree ("mk_id");--> statement-breakpoint
CREATE INDEX "idx_mk_roles_mk_id" ON "mk_roles" USING btree ("mk_id");--> statement-breakpoint
CREATE INDEX "idx_mk_votes_mk_id" ON "mk_votes" USING btree ("mk_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_token_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens" USING btree ("expires_at");