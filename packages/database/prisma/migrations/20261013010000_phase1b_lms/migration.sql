ALTER TABLE "courses" ADD COLUMN "edit_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "courses" ADD CONSTRAINT "courses_nonnegative_revision" CHECK ("edit_revision" >= 0);
CREATE INDEX "enrollments_user_id_status_idx" ON "enrollments" ("user_id", "status");
CREATE INDEX "chapters_course_id_status_position_idx" ON "chapters" ("course_id", "status", "position");
