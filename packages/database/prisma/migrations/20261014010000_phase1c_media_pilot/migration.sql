-- Additive pilot metadata only. No curriculum, enrollment or progress changes.
CREATE TABLE "media_assets" (
  "id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "revision_ref" UUID NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "bytes" INTEGER NOT NULL CHECK ("bytes" > 0 AND "bytes" <= 6291456),
  "object_key" VARCHAR(512) NOT NULL,
  "preview_key" VARCHAR(512),
  "sha256" VARCHAR(64),
  "scan_state" VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK ("scan_state" IN ('pending', 'scanning', 'clean', 'rejected', 'failed')),
  "scanned_at" TIMESTAMPTZ(6),
  "scan_engine" VARCHAR(120),
  "status" "content_status" NOT NULL DEFAULT 'draft',
  "downloads_allowed" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_assets_lesson_id_course_id_fkey" FOREIGN KEY ("lesson_id", "course_id")
    REFERENCES "lessons"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_assets_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_assets_clean_publication" CHECK (
    "status" <> 'published' OR
    ("scan_state" = 'clean' AND "scanned_at" IS NOT NULL AND "sha256" IS NOT NULL AND "preview_key" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "media_assets_revision_ref_key" ON "media_assets"("revision_ref");
CREATE UNIQUE INDEX "media_assets_object_key_key" ON "media_assets"("object_key");
CREATE UNIQUE INDEX "media_assets_preview_key_key" ON "media_assets"("preview_key");
CREATE INDEX "media_assets_lesson_id_status_scan_state_idx" ON "media_assets"("lesson_id", "status", "scan_state");

CREATE TABLE "media_upload_sessions" (
  "id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "uploader_id" UUID NOT NULL,
  "staging_key" VARCHAR(512) NOT NULL,
  "provider_upload_id" TEXT,
  "method" VARCHAR(16) NOT NULL CHECK ("method" IN ('single', 'multipart')),
  "state" VARCHAR(16) NOT NULL DEFAULT 'issued' CHECK ("state" IN ('issued', 'quarantined', 'aborted')),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_upload_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_upload_sessions_asset_id_fkey" FOREIGN KEY ("asset_id")
    REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_upload_sessions_uploader_id_fkey" FOREIGN KEY ("uploader_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "media_upload_sessions_asset_id_key" ON "media_upload_sessions"("asset_id");
CREATE UNIQUE INDEX "media_upload_sessions_staging_key_key" ON "media_upload_sessions"("staging_key");
CREATE INDEX "media_upload_sessions_uploader_id_state_expires_at_idx"
  ON "media_upload_sessions"("uploader_id", "state", "expires_at");
