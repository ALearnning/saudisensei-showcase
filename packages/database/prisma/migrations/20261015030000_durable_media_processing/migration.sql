-- Additive: retained pilots, curriculum, completion and media revisions are not rewritten.
CREATE TABLE media_processing_uploads (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL UNIQUE REFERENCES media_revisions(id) ON DELETE RESTRICT,
 uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 staging_key text NOT NULL UNIQUE, source_key text NOT NULL UNIQUE, upload_ref text,
 method varchar(16) NOT NULL CHECK(method IN ('single','multipart')),
 state varchar(16) NOT NULL DEFAULT 'issued' CHECK(state IN ('issued','committing','completed')),
 source_etag varchar(128), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_processing_uploads_state_expires_at_idx ON media_processing_uploads(state,expires_at);
CREATE TABLE media_jobs (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL UNIQUE REFERENCES media_revisions(id) ON DELETE RESTRICT,
 state varchar(24) NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','retryable','succeeded','permanently_failed')),
 stage varchar(24) NOT NULL DEFAULT 'scan' CHECK(stage IN ('scan','ingest','ingest_requested','verify','document')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 10),
 failures integer NOT NULL DEFAULT 0 CHECK(failures>=0), polls integer NOT NULL DEFAULT 0 CHECK(polls BETWEEN 0 AND 60),
 available_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 provider_ref text, error_code varchar(64), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'running' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX media_jobs_claim ON media_jobs(state,available_at,lease_until);
CREATE TABLE media_processing_attempts (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES media_jobs(id) ON DELETE RESTRICT,
 number integer NOT NULL CHECK(number>0), state varchar(24) NOT NULL DEFAULT 'running' CHECK(state IN ('running','succeeded','failed','interrupted')),
 error_code varchar(64), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(job_id,number)
);
CREATE TABLE media_renditions (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES media_revisions(id) ON DELETE RESTRICT,
 kind varchar(24) NOT NULL CHECK(kind IN ('plaintext','stream','pdf','image')),
 locator text NOT NULL, content_type varchar(100) NOT NULL, verified_at timestamptz NOT NULL,
 UNIQUE(revision_id,kind)
);
-- Preserve verified derived metadata, just as the ready source revision is sealed.
CREATE FUNCTION media_rendition_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'MEDIA_RENDITION_IMMUTABLE'; END; $$;
CREATE TRIGGER media_rendition_seal BEFORE UPDATE OR DELETE ON media_renditions FOR EACH ROW EXECUTE FUNCTION media_rendition_immutable();
