-- Additive only: never rewrites pilot, curriculum, identity or learning rows.
CREATE TABLE content_media_assets (
 id uuid PRIMARY KEY, course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
 kind varchar(16) NOT NULL CHECK(kind IN ('video','document','image','attachment')),
 title varchar(255) NOT NULL CHECK(length(trim(title))>0),
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived','removed')),
 downloads_allowed boolean NOT NULL DEFAULT false,
 current_revision_id uuid, staged_revision_id uuid,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,course_id),
 CHECK(status <> 'published' OR current_revision_id IS NOT NULL),
 CHECK(kind <> 'video' OR NOT downloads_allowed)
);
CREATE INDEX content_media_assets_course_status ON content_media_assets(course_id,status);
CREATE TABLE media_revisions (
 id uuid PRIMARY KEY, asset_id uuid NOT NULL, course_id uuid NOT NULL,
 filename varchar(255) NOT NULL, mime_type varchar(100) NOT NULL, bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=2147483648),
 state varchar(16) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','quarantined','processing','ready','failed','rejected')),
 scan_state varchar(16) NOT NULL DEFAULT 'pending' CHECK(scan_state IN ('pending','scanning','clean','failed','rejected')),
 sha256 varchar(64), scan_engine varchar(120), scanned_at timestamptz,
 object_key text, preview_key text, provider_ref text,
 private_ready boolean NOT NULL DEFAULT false, safe_preview boolean NOT NULL DEFAULT false,
 duration integer CHECK(duration>0 AND duration<=7200), page_count integer CHECK(page_count>0 AND page_count<=500),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,asset_id,course_id),
 FOREIGN KEY(asset_id,course_id) REFERENCES content_media_assets(id,course_id) ON DELETE RESTRICT,
 CHECK(state <> 'ready' OR (scan_state='clean' AND sha256 IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND scan_engine IS NOT NULL AND scanned_at IS NOT NULL AND object_key IS NOT NULL AND private_ready))
);
CREATE INDEX media_revisions_asset_created ON media_revisions(asset_id,created_at);
ALTER TABLE content_media_assets ADD CONSTRAINT content_media_current_owned FOREIGN KEY(current_revision_id,id,course_id) REFERENCES media_revisions(id,asset_id,course_id) ON DELETE RESTRICT;
ALTER TABLE content_media_assets ADD CONSTRAINT content_media_staged_owned FOREIGN KEY(staged_revision_id,id,course_id) REFERENCES media_revisions(id,asset_id,course_id) ON DELETE RESTRICT;
-- Content metadata is immutable. Worker evidence may be filled until ready;
-- a ready revision is fully sealed. Replacement always creates another row.
CREATE FUNCTION media_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MEDIA_REVISION_RETAINED'; END IF; IF OLD.state='ready' OR ROW(NEW.id,NEW.asset_id,NEW.course_id,NEW.filename,NEW.mime_type,NEW.bytes,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.asset_id,OLD.course_id,OLD.filename,OLD.mime_type,OLD.bytes,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'MEDIA_REVISION_IMMUTABLE'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER media_revision_seal BEFORE UPDATE OR DELETE ON media_revisions FOR EACH ROW EXECUTE FUNCTION media_revision_immutable();
CREATE UNIQUE INDEX lessons_media_ancestry_key ON lessons(id,chapter_id,course_id);
CREATE TABLE media_collections (
 id uuid PRIMARY KEY, course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
 parent_type varchar(16) NOT NULL CHECK(parent_type IN ('courses','chapters','lessons')),
 parent_id uuid NOT NULL, chapter_id uuid, lesson_id uuid,
 title varchar(255) NOT NULL CHECK(length(trim(title))>0), description varchar(1000) NOT NULL DEFAULT '',
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived','removed')),
 UNIQUE(id,course_id,parent_type,parent_id),
 FOREIGN KEY(chapter_id,course_id) REFERENCES chapters(id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY(lesson_id,chapter_id,course_id) REFERENCES lessons(id,chapter_id,course_id) ON DELETE RESTRICT,
 CHECK((parent_type='courses' AND parent_id=course_id AND chapter_id IS NULL AND lesson_id IS NULL) OR (parent_type='chapters' AND parent_id=chapter_id AND chapter_id IS NOT NULL AND lesson_id IS NULL) OR (parent_type='lessons' AND parent_id=lesson_id AND chapter_id IS NOT NULL AND lesson_id IS NOT NULL))
);
CREATE INDEX media_collections_parent_order ON media_collections(course_id,parent_type,parent_id,position);
CREATE TABLE media_placements (
 id uuid PRIMARY KEY, course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
 asset_id uuid NOT NULL UNIQUE, parent_type varchar(16) NOT NULL CHECK(parent_type IN ('courses','chapters','lessons')),
 parent_id uuid NOT NULL, chapter_id uuid, lesson_id uuid, collection_id uuid,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived','removed')),
 FOREIGN KEY(asset_id,course_id) REFERENCES content_media_assets(id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY(chapter_id,course_id) REFERENCES chapters(id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY(lesson_id,chapter_id,course_id) REFERENCES lessons(id,chapter_id,course_id) ON DELETE RESTRICT,
 CONSTRAINT media_placements_collection_scope_fkey FOREIGN KEY(collection_id,course_id,parent_type,parent_id) REFERENCES media_collections(id,course_id,parent_type,parent_id) ON DELETE RESTRICT,
 UNIQUE(asset_id,course_id),
 CHECK((parent_type='courses' AND parent_id=course_id AND chapter_id IS NULL AND lesson_id IS NULL) OR (parent_type='chapters' AND parent_id=chapter_id AND chapter_id IS NOT NULL AND lesson_id IS NULL) OR (parent_type='lessons' AND parent_id=lesson_id AND chapter_id IS NOT NULL AND lesson_id IS NOT NULL))
);
CREATE INDEX media_placements_parent_order ON media_placements(course_id,parent_type,parent_id,collection_id,position);
CREATE TABLE course_media_states (
 course_id uuid PRIMARY KEY REFERENCES courses(id) ON DELETE RESTRICT,
 edit_revision integer NOT NULL DEFAULT 0 CHECK(edit_revision>=0)
);
