CREATE TABLE "video_pilot_assets" (
  "id" UUID NOT NULL,
  "fixture" VARCHAR(8) NOT NULL,
  "provider" VARCHAR(40) NOT NULL DEFAULT 'cloudflare-stream',
  "provider_ref" VARCHAR(64) NOT NULL,
  "playback_host" VARCHAR(255) NOT NULL,
  "source_key" VARCHAR(512) NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "bytes" INTEGER NOT NULL,
  "duration" INTEGER NOT NULL,
  "scan_engine" VARCHAR(120) NOT NULL,
  "scanned_at" TIMESTAMPTZ(6) NOT NULL,
  "private_ready" BOOLEAN NOT NULL DEFAULT false,
  "status" "content_status" NOT NULL DEFAULT 'draft',
  "lesson_id" UUID,
  "course_id" UUID,
  CONSTRAINT "video_pilot_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "video_pilot_assets_fixture_check" CHECK (
    ("fixture"='long' AND "duration"=375) OR ("fixture"='short' AND "duration"=75)),
  CONSTRAINT "video_pilot_assets_size_check" CHECK ("bytes">0 AND "bytes"<=6291456),
  CONSTRAINT "video_pilot_assets_source_check" CHECK ("source_key" LIKE 'pilot/video-security/%'),
  CONSTRAINT "video_pilot_assets_digest_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "video_pilot_assets_placement_check" CHECK (("lesson_id" IS NULL)=("course_id" IS NULL)),
  CONSTRAINT "video_pilot_assets_publication_check" CHECK
    ("status"<>'published' OR ("private_ready" AND "lesson_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "video_pilot_assets_fixture_key" ON "video_pilot_assets"("fixture");
CREATE UNIQUE INDEX "video_pilot_assets_provider_ref_key" ON "video_pilot_assets"("provider_ref");
CREATE UNIQUE INDEX "video_pilot_assets_source_key_key" ON "video_pilot_assets"("source_key");
CREATE INDEX "video_pilot_assets_lesson_id_status_idx" ON "video_pilot_assets"("lesson_id","status");
ALTER TABLE "video_pilot_assets" ADD CONSTRAINT "video_pilot_assets_lesson_id_course_id_fkey"
  FOREIGN KEY ("lesson_id","course_id") REFERENCES "lessons"("id","course_id") ON DELETE RESTRICT ON UPDATE CASCADE;
