-- Prisma cannot express CHECK constraints. Keep them in version-controlled SQL.
ALTER TABLE "users" ADD CONSTRAINT "users_supported_locale"
  CHECK ("preferred_locale" IN ('ar', 'en'));
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_nonnegative_position"
  CHECK ("position" >= 0);
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_nonnegative_position"
  CHECK ("position" >= 0);
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_nonnegative_estimate"
  CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" >= 0);
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_expiry_after_grant"
  CHECK ("expires_at" IS NULL OR "expires_at" > "enrolled_at");
