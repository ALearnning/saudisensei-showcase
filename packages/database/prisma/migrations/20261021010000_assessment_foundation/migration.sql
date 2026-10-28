-- Additive Q2 only. No application data, curriculum revision or completion writes.
-- Development compatibility inspected read-only before authoring these indexes:
-- enrollments=1, null ownership=0, duplicate composite=0;
-- media placements=11, duplicate scope=0.
BEGIN;
CREATE UNIQUE INDEX enrollments_assessment_owner_key ON enrollments(id,user_id,course_id);
CREATE UNIQUE INDEX media_placements_assessment_scope_key ON media_placements(id,course_id);

CREATE TABLE assessment_questions (
 id uuid PRIMARY KEY, status varchar(16) NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 edit_revision integer NOT NULL DEFAULT 0 CHECK(edit_revision>=0), current_revision_id uuid,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TABLE assessment_skills (
 id uuid PRIMARY KEY, slug varchar(160) NOT NULL UNIQUE,
 parent_id uuid REFERENCES assessment_skills(id) ON DELETE RESTRICT,
 status varchar(16) NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 edit_revision integer NOT NULL DEFAULT 0 CHECK(edit_revision>=0),
 created_at timestamptz(6) NOT NULL DEFAULT now(), CHECK(parent_id IS DISTINCT FROM id)
);
CREATE INDEX assessment_skills_parent_id_idx ON assessment_skills(parent_id);
CREATE TABLE assessment_skill_translations (
 skill_id uuid NOT NULL REFERENCES assessment_skills(id) ON DELETE RESTRICT,
 locale varchar(2) NOT NULL CHECK(locale IN ('ar','en')), label varchar(255) NOT NULL,
 description varchar(2000) NOT NULL DEFAULT '', PRIMARY KEY(skill_id,locale)
);
CREATE TABLE assessment_question_skills (
 question_id uuid NOT NULL REFERENCES assessment_questions(id) ON DELETE RESTRICT,
 skill_id uuid NOT NULL REFERENCES assessment_skills(id) ON DELETE RESTRICT,
 role varchar(16) NOT NULL CHECK(role IN ('primary','secondary')), PRIMARY KEY(question_id,skill_id)
);
CREATE UNIQUE INDEX assessment_one_primary_skill ON assessment_question_skills(question_id) WHERE role='primary';
CREATE TABLE assessment_question_cognitive_tags (
 question_id uuid NOT NULL REFERENCES assessment_questions(id) ON DELETE RESTRICT,
 code varchar(24) NOT NULL CHECK(code IN ('concept','code_tracing','debugging','problem_solving','implementation')),
 PRIMARY KEY(question_id,code)
);
CREATE TABLE assessment_question_drafts (
 question_id uuid PRIMARY KEY REFERENCES assessment_questions(id) ON DELETE RESTRICT,
 type varchar(24) NOT NULL CHECK(type IN ('single_choice','multiple_choice','true_false','short_text','ordering')),
 default_content_locale varchar(2) NOT NULL CHECK(default_content_locale IN ('ar','en')),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=100000),
 grading_definition jsonb NOT NULL CHECK(jsonb_typeof(grading_definition)='object' AND octet_length(grading_definition::text)<=50000),
 explanation jsonb NOT NULL CHECK(octet_length(explanation::text)<=50000),
 difficulty varchar(16) NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
 default_points integer NOT NULL DEFAULT 1 CHECK(default_points BETWEEN 1 AND 1000),
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0)
);
CREATE TABLE assessment_question_revisions (
 id uuid PRIMARY KEY, question_id uuid NOT NULL REFERENCES assessment_questions(id) ON DELETE RESTRICT,
 number integer NOT NULL CHECK(number>0),
 type varchar(24) NOT NULL CHECK(type IN ('single_choice','multiple_choice','true_false','short_text','ordering')),
 default_content_locale varchar(2) NOT NULL CHECK(default_content_locale IN ('ar','en')),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=100000),
 grading_definition jsonb NOT NULL CHECK(jsonb_typeof(grading_definition)='object' AND octet_length(grading_definition::text)<=50000),
 explanation jsonb NOT NULL CHECK(octet_length(explanation::text)<=50000),
 difficulty varchar(16) NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
 skill_snapshot jsonb NOT NULL CHECK(jsonb_typeof(skill_snapshot)='array' AND octet_length(skill_snapshot::text)<=50000),
 cognitive_tags jsonb NOT NULL CHECK(jsonb_typeof(cognitive_tags)='array' AND octet_length(cognitive_tags::text)<=2000),
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0), grader_version varchar(64) NOT NULL,
 checksum varchar(64) NOT NULL, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(question_id,number), UNIQUE(id,question_id)
);
ALTER TABLE assessment_questions ADD CONSTRAINT assessment_question_current_owned
 FOREIGN KEY(current_revision_id,id) REFERENCES assessment_question_revisions(id,question_id) ON DELETE RESTRICT;

CREATE TABLE assessment_quizzes (
 id uuid PRIMARY KEY, course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
 parent_type varchar(16) NOT NULL, parent_id uuid NOT NULL, chapter_id uuid, lesson_id uuid,
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 edit_revision integer NOT NULL DEFAULT 0 CHECK(edit_revision>=0), current_revision_id uuid,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(id,course_id),
 FOREIGN KEY(chapter_id,course_id) REFERENCES chapters(id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY(lesson_id,chapter_id,course_id) REFERENCES lessons(id,chapter_id,course_id) ON DELETE RESTRICT,
 CHECK((parent_type='course' AND parent_id=course_id AND chapter_id IS NULL AND lesson_id IS NULL)
 OR (parent_type='chapter' AND chapter_id IS NOT NULL AND parent_id=chapter_id AND lesson_id IS NULL)
 OR (parent_type='lesson' AND chapter_id IS NOT NULL AND lesson_id IS NOT NULL AND parent_id=lesson_id)),
 CHECK(status<>'published' OR current_revision_id IS NOT NULL)
);
CREATE INDEX assessment_quizzes_course_id_parent_type_parent_id_idx ON assessment_quizzes(course_id,parent_type,parent_id);
CREATE TABLE assessment_quiz_drafts (
 quiz_id uuid PRIMARY KEY REFERENCES assessment_quizzes(id) ON DELETE RESTRICT,
 default_content_locale varchar(2) NOT NULL CHECK(default_content_locale IN ('ar','en')),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=100000),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=10000),
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0)
);
CREATE TABLE assessment_quiz_draft_items (
 id uuid PRIMARY KEY, quiz_id uuid NOT NULL REFERENCES assessment_quiz_drafts(quiz_id) ON DELETE RESTRICT,
 question_id uuid NOT NULL, question_revision_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 99), points integer NOT NULL CHECK(points BETWEEN 1 AND 1000),
 FOREIGN KEY(question_revision_id,question_id) REFERENCES assessment_question_revisions(id,question_id) ON DELETE RESTRICT,
 UNIQUE(quiz_id,position), UNIQUE(quiz_id,question_id)
);
CREATE TABLE assessment_quiz_revisions (
 id uuid PRIMARY KEY, assembly_transaction bigint NOT NULL DEFAULT (pg_current_xact_id()::text)::bigint,
 quiz_id uuid NOT NULL, course_id uuid NOT NULL,
 number integer NOT NULL CHECK(number>0),
 default_content_locale varchar(2) NOT NULL CHECK(default_content_locale IN ('ar','en')),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=100000),
 mode varchar(16) NOT NULL CHECK(mode IN ('practice','graded')), required boolean NOT NULL DEFAULT false,
 pass_basis_points integer NOT NULL DEFAULT 7000 CHECK(pass_basis_points BETWEEN 0 AND 10000),
 max_attempts integer CHECK(max_attempts>0), time_limit_seconds integer CHECK(time_limit_seconds BETWEEN 60 AND 10800),
 opens_at timestamptz(6), closes_at timestamptz(6),
 shuffle_questions boolean NOT NULL DEFAULT false, shuffle_options boolean NOT NULL DEFAULT false,
 score_visibility varchar(24) NOT NULL CHECK(score_visibility IN ('never','after_grading','after_attempt_limit','manual_release')),
 review_visibility varchar(24) NOT NULL CHECK(review_visibility IN ('never','after_grading','after_attempt_limit','manual_release')),
 explanation_visibility varchar(24) NOT NULL CHECK(explanation_visibility IN ('never','after_grading','after_attempt_limit','manual_release')),
 ai_analysis_enabled boolean NOT NULL DEFAULT false, total_points integer NOT NULL CHECK(total_points BETWEEN 1 AND 100000),
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0), grader_version varchar(64) NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(quiz_id,number), UNIQUE(id,quiz_id,course_id),
 FOREIGN KEY(quiz_id,course_id) REFERENCES assessment_quizzes(id,course_id) ON DELETE RESTRICT,
 CHECK(opens_at IS NULL OR closes_at IS NULL OR opens_at<closes_at),
 CHECK(max_attempts IS NOT NULL OR 'after_attempt_limit' NOT IN (score_visibility,review_visibility,explanation_visibility)),
 CHECK(explanation_visibility='never' OR explanation_visibility=review_visibility OR review_visibility='after_grading')
);
ALTER TABLE assessment_quizzes ADD CONSTRAINT assessment_quiz_current_owned
 FOREIGN KEY(current_revision_id,id,course_id) REFERENCES assessment_quiz_revisions(id,quiz_id,course_id) ON DELETE RESTRICT;
CREATE TABLE assessment_quiz_revision_items (
 id uuid PRIMARY KEY, quiz_revision_id uuid NOT NULL REFERENCES assessment_quiz_revisions(id) ON DELETE RESTRICT,
 question_id uuid NOT NULL, question_revision_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 99), points integer NOT NULL CHECK(points BETWEEN 1 AND 1000),
 evidence_snapshot jsonb NOT NULL CHECK(octet_length(evidence_snapshot::text)<=50000),
 FOREIGN KEY(question_revision_id,question_id) REFERENCES assessment_question_revisions(id,question_id) ON DELETE RESTRICT,
 UNIQUE(quiz_revision_id,position), UNIQUE(quiz_revision_id,question_id), UNIQUE(id,quiz_revision_id)
);
CREATE TABLE assessment_quiz_review_releases (
 quiz_revision_id uuid PRIMARY KEY REFERENCES assessment_quiz_revisions(id) ON DELETE RESTRICT,
 released_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, request_id uuid NOT NULL,
 released_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TABLE assessment_attempts (
 id uuid PRIMARY KEY, assembly_transaction bigint NOT NULL DEFAULT (pg_current_xact_id()::text)::bigint,
 quiz_id uuid NOT NULL, quiz_revision_id uuid NOT NULL, course_id uuid NOT NULL,
 enrollment_id uuid NOT NULL, student_user_id uuid NOT NULL,
 attempt_number integer NOT NULL CHECK(attempt_number>0),
 status varchar(24) NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS','SUBMITTED','AUTO_SUBMITTED','GRADED')),
 selected_content_locale varchar(2) NOT NULL CHECK(selected_content_locale IN ('ar','en')),
 concurrency_version integer NOT NULL DEFAULT 0 CHECK(concurrency_version>=0),
 started_at timestamptz(6) NOT NULL DEFAULT now(), opens_at timestamptz(6), closes_at timestamptz(6),
 time_limit_seconds integer CHECK(time_limit_seconds BETWEEN 60 AND 10800),
 deadline_at timestamptz(6), deadline_reason varchar(24) CHECK(deadline_reason IN ('time_limit','availability_close','both')),
 submitted_at timestamptz(6), effective_submitted_at timestamptz(6),
 finalization_reason varchar(24) CHECK(finalization_reason IN ('voluntary','time_limit','availability_close','both')),
 graded_at timestamptz(6),
 FOREIGN KEY(quiz_revision_id,quiz_id,course_id) REFERENCES assessment_quiz_revisions(id,quiz_id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY(enrollment_id,student_user_id,course_id) REFERENCES enrollments(id,user_id,course_id) ON DELETE RESTRICT,
 UNIQUE(id,quiz_revision_id), UNIQUE(id,student_user_id), UNIQUE(student_user_id,quiz_id,attempt_number),
 CHECK(opens_at IS NULL OR started_at>=opens_at), CHECK(closes_at IS NULL OR started_at<closes_at),
 CHECK(deadline_at IS NOT DISTINCT FROM LEAST(started_at+time_limit_seconds*interval '1 second',closes_at)),
 CHECK((deadline_at IS NULL)=(deadline_reason IS NULL)),
 CHECK((status='IN_PROGRESS' AND submitted_at IS NULL AND effective_submitted_at IS NULL AND finalization_reason IS NULL AND graded_at IS NULL)
 OR (status<>'IN_PROGRESS' AND submitted_at IS NOT NULL AND effective_submitted_at IS NOT NULL AND finalization_reason IS NOT NULL
 AND submitted_at>=effective_submitted_at AND effective_submitted_at>=started_at
 AND ((status='GRADED' AND graded_at IS NOT NULL AND graded_at>=submitted_at) OR (status<>'GRADED' AND graded_at IS NULL)))),
 CHECK(effective_submitted_at IS NULL OR deadline_at IS NULL OR effective_submitted_at<=deadline_at),
 CHECK(finalization_reason IS NULL OR finalization_reason='voluntary' OR effective_submitted_at=deadline_at)
);
CREATE UNIQUE INDEX assessment_one_open_attempt ON assessment_attempts(student_user_id,quiz_id) WHERE status='IN_PROGRESS';
CREATE INDEX assessment_attempts_student_user_id_started_at_id_idx ON assessment_attempts(student_user_id,started_at,id);
CREATE INDEX assessment_attempts_enrollment_id_idx ON assessment_attempts(enrollment_id);
CREATE INDEX assessment_attempts_quiz_revision_id_idx ON assessment_attempts(quiz_revision_id);
CREATE INDEX assessment_attempts_status_deadline_at_idx ON assessment_attempts(status,deadline_at);
CREATE TABLE assessment_attempt_questions (
 id uuid PRIMARY KEY, attempt_id uuid NOT NULL, quiz_revision_id uuid NOT NULL, item_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 99), content_locale varchar(2) NOT NULL CHECK(content_locale IN ('ar','en')),
 presentation jsonb NOT NULL CHECK(octet_length(presentation::text)<=100000),
 FOREIGN KEY(attempt_id,quiz_revision_id) REFERENCES assessment_attempts(id,quiz_revision_id) ON DELETE RESTRICT,
 FOREIGN KEY(item_id,quiz_revision_id) REFERENCES assessment_quiz_revision_items(id,quiz_revision_id) ON DELETE RESTRICT,
 UNIQUE(attempt_id,item_id), UNIQUE(attempt_id,position), UNIQUE(id,attempt_id)
);
CREATE TABLE assessment_attempt_question_states (
 attempt_question_id uuid PRIMARY KEY REFERENCES assessment_attempt_questions(id) ON DELETE RESTRICT,
 is_flagged boolean NOT NULL DEFAULT false, flag_revision integer NOT NULL DEFAULT 0 CHECK(flag_revision>=0),
 updated_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TABLE assessment_attempt_answers (
 attempt_question_id uuid PRIMARY KEY REFERENCES assessment_attempt_questions(id) ON DELETE RESTRICT,
 answer jsonb CHECK(octet_length(answer::text)<=10000),
 answer_revision integer NOT NULL DEFAULT 0 CHECK(answer_revision>=0),
 first_answered_at timestamptz(6), final_answered_at timestamptz(6),
 change_count integer NOT NULL DEFAULT 0 CHECK(change_count>=0),
 CHECK(first_answered_at IS NULL OR final_answered_at>=first_answered_at)
);
CREATE TABLE assessment_mutations (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 operation_scope varchar(200) NOT NULL, client_mutation_id uuid NOT NULL, payload_hash varchar(64) NOT NULL,
 receipt jsonb NOT NULL CHECK(octet_length(receipt::text)<=20000), created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(actor_id,operation_scope,client_mutation_id)
);
CREATE TABLE assessment_attempt_grades (
 id uuid PRIMARY KEY, assembly_transaction bigint NOT NULL DEFAULT (pg_current_xact_id()::text)::bigint,
 attempt_id uuid NOT NULL UNIQUE REFERENCES assessment_attempts(id) ON DELETE RESTRICT,
 earned_points integer NOT NULL CHECK(earned_points>=0), possible_points integer NOT NULL CHECK(possible_points BETWEEN 1 AND 100000),
 passed boolean NOT NULL, grader_version varchar(64) NOT NULL, checksum varchar(64) NOT NULL,
 graded_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(id,attempt_id), CHECK(earned_points<=possible_points)
);
CREATE TABLE assessment_attempt_question_grades (
 id uuid PRIMARY KEY, assembly_transaction bigint NOT NULL DEFAULT (pg_current_xact_id()::text)::bigint,
 attempt_question_id uuid NOT NULL UNIQUE, attempt_id uuid NOT NULL, grade_id uuid NOT NULL,
 earned_points integer NOT NULL CHECK(earned_points>=0), possible_points integer NOT NULL CHECK(possible_points BETWEEN 1 AND 1000),
 correct boolean NOT NULL, reason_code varchar(64) NOT NULL,
 response_state varchar(24) NOT NULL CHECK(response_state IN ('correct_answered','incorrect_answered','unanswered_viewed','unanswered_unviewed')),
 had_accepted_answer boolean NOT NULL, had_recorded_view boolean NOT NULL,
 coverage varchar(24) NOT NULL CHECK(coverage IN ('unknown','partial','complete')),
 finalization_reason varchar(24) NOT NULL CHECK(finalization_reason IN ('voluntary','time_limit','availability_close','both')),
 FOREIGN KEY(attempt_question_id,attempt_id) REFERENCES assessment_attempt_questions(id,attempt_id) ON DELETE RESTRICT,
 FOREIGN KEY(grade_id,attempt_id) REFERENCES assessment_attempt_grades(id,attempt_id) ON DELETE RESTRICT,
 UNIQUE(id,attempt_id), CONSTRAINT assessment_question_grade_owned_key UNIQUE(attempt_question_id,attempt_id),
 CHECK(earned_points=CASE WHEN correct THEN possible_points ELSE 0 END),
 CHECK((response_state='correct_answered' AND had_accepted_answer AND correct)
 OR (response_state='incorrect_answered' AND had_accepted_answer AND NOT correct)
 OR (response_state='unanswered_viewed' AND NOT had_accepted_answer AND had_recorded_view AND NOT correct)
 OR (response_state='unanswered_unviewed' AND NOT had_accepted_answer AND NOT had_recorded_view AND NOT correct))
);
CREATE TABLE assessment_attempt_question_telemetry (
 attempt_question_id uuid PRIMARY KEY REFERENCES assessment_attempt_questions(id) ON DELETE RESTRICT,
 first_viewed_at timestamptz(6), estimated_active_ms integer NOT NULL DEFAULT 0 CHECK(estimated_active_ms BETWEEN 0 AND 10800000),
 visit_count integer NOT NULL DEFAULT 0 CHECK(visit_count>=0),
 coverage varchar(24) NOT NULL DEFAULT 'unknown' CHECK(coverage IN ('unknown','partial','complete')),
 quality_flags jsonb NOT NULL DEFAULT '[]' CHECK(octet_length(quality_flags::text)<=2000),
 last_sequence integer NOT NULL DEFAULT 0 CHECK(last_sequence>=0)
);
CREATE TABLE assessment_telemetry_sessions (
 id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE RESTRICT,
 client_session_id uuid NOT NULL, last_sequence integer NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
 active_question_id uuid, last_receipt_at timestamptz(6), expires_at timestamptz(6) NOT NULL,
 FOREIGN KEY(active_question_id,attempt_id) REFERENCES assessment_attempt_questions(id,attempt_id) ON DELETE RESTRICT,
 UNIQUE(attempt_id,client_session_id)
);
CREATE INDEX assessment_telemetry_sessions_expires_at_idx ON assessment_telemetry_sessions(expires_at);
CREATE TABLE assessment_skill_evidence (
 id uuid PRIMARY KEY, question_grade_id uuid NOT NULL, attempt_id uuid NOT NULL, student_user_id uuid NOT NULL,
 skill_id uuid NOT NULL REFERENCES assessment_skills(id) ON DELETE RESTRICT,
 role varchar(16) NOT NULL CHECK(role IN ('primary','secondary')),
 taxonomy_snapshot jsonb NOT NULL CHECK(octet_length(taxonomy_snapshot::text)<=50000),
 response_state varchar(24) NOT NULL CHECK(response_state IN ('correct_answered','incorrect_answered','unanswered_viewed','unanswered_unviewed')),
 answered_correctly boolean, had_accepted_answer boolean NOT NULL, had_recorded_view boolean NOT NULL,
 coverage varchar(24) NOT NULL CHECK(coverage IN ('unknown','partial','complete')),
 finalization_reason varchar(24) NOT NULL CHECK(finalization_reason IN ('voluntary','time_limit','availability_close','both')),
 earned_points integer NOT NULL CHECK(earned_points>=0), possible_points integer NOT NULL CHECK(possible_points BETWEEN 1 AND 1000),
 estimated_active_ms integer CHECK(estimated_active_ms BETWEEN 0 AND 10800000), time_quality varchar(24) NOT NULL,
 mode varchar(16) NOT NULL CHECK(mode IN ('practice','graded')), evidence_version integer NOT NULL DEFAULT 1 CHECK(evidence_version>0),
 graded_at timestamptz(6) NOT NULL,
 FOREIGN KEY(question_grade_id,attempt_id) REFERENCES assessment_attempt_question_grades(id,attempt_id) ON DELETE RESTRICT,
 FOREIGN KEY(attempt_id,student_user_id) REFERENCES assessment_attempts(id,student_user_id) ON DELETE RESTRICT,
 UNIQUE(question_grade_id,skill_id), CHECK(earned_points<=possible_points),
 CHECK((response_state='correct_answered' AND had_accepted_answer AND answered_correctly IS TRUE AND earned_points=possible_points)
 OR (response_state='incorrect_answered' AND had_accepted_answer AND answered_correctly IS FALSE AND earned_points=0)
 OR (response_state='unanswered_viewed' AND NOT had_accepted_answer AND had_recorded_view AND answered_correctly IS NULL AND earned_points=0)
 OR (response_state='unanswered_unviewed' AND NOT had_accepted_answer AND NOT had_recorded_view AND answered_correctly IS NULL AND earned_points=0))
);
CREATE INDEX assessment_skill_evidence_student_user_id_skill_id_graded_a_idx ON assessment_skill_evidence(student_user_id,skill_id,graded_at);
CREATE TABLE assessment_skill_content_links (
 id uuid PRIMARY KEY, skill_id uuid NOT NULL REFERENCES assessment_skills(id) ON DELETE RESTRICT,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT, target_type varchar(16) NOT NULL,
 chapter_id uuid, lesson_id uuid, media_placement_id uuid,
 relation_kind varchar(24) NOT NULL, priority integer NOT NULL DEFAULT 0 CHECK(priority>=0),
 locale_notes jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(locale_notes::text)<=5000),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 edit_revision integer NOT NULL DEFAULT 0 CHECK(edit_revision>=0),
 status varchar(16) NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 FOREIGN KEY(chapter_id,course_id) REFERENCES chapters(id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY(lesson_id,chapter_id,course_id) REFERENCES lessons(id,chapter_id,course_id) ON DELETE RESTRICT,
 FOREIGN KEY(media_placement_id,course_id) REFERENCES media_placements(id,course_id) ON DELETE RESTRICT,
 CHECK((target_type='course' AND chapter_id IS NULL AND lesson_id IS NULL AND media_placement_id IS NULL)
 OR (target_type='chapter' AND chapter_id IS NOT NULL AND lesson_id IS NULL AND media_placement_id IS NULL)
 OR (target_type='lesson' AND chapter_id IS NOT NULL AND lesson_id IS NOT NULL AND media_placement_id IS NULL)
 OR (target_type='media' AND media_placement_id IS NOT NULL AND chapter_id IS NULL AND lesson_id IS NULL))
);
CREATE INDEX assessment_skill_content_links_skill_id_status_idx ON assessment_skill_content_links(skill_id,status);
CREATE TABLE assessment_jobs (
 id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE RESTRICT,
 kind varchar(16) NOT NULL CHECK(kind IN ('deadline','grade','guidance')),
 deduplication_key varchar(200) NOT NULL UNIQUE,
 state varchar(16) NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed')),
 available_at timestamptz(6) NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 100),
 lease_token uuid, lease_until timestamptz(6), fence integer NOT NULL DEFAULT 0 CHECK(fence>=0),
 error_code varchar(64), created_at timestamptz(6) NOT NULL DEFAULT now(),
 CHECK((state='running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
 OR (state<>'running' AND lease_token IS NULL AND lease_until IS NULL)), CHECK(attempts<=max_attempts)
);
CREATE INDEX assessment_jobs_state_available_at_lease_until_idx ON assessment_jobs(state,available_at,lease_until);

-- Immutable records may only be assembled in their creating transaction.
-- Database-stamped top-level transaction IDs survive savepoints; callers cannot
-- backdate an assembly seal. The stamps are never updated.
-- Deferred aggregate checks allow parent INSERT -> child INSERTs -> COMMIT.
CREATE FUNCTION assessment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ASSESSMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END $$;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assessment_question_revisions','assessment_quiz_revisions',
 'assessment_quiz_revision_items','assessment_quiz_review_releases','assessment_attempt_questions',
 'assessment_mutations','assessment_attempt_grades','assessment_attempt_question_grades','assessment_skill_evidence']
 LOOP EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION assessment_immutable()',t); END LOOP;
END $$;
-- Migration is atomic, including all constraints and functions below.

CREATE FUNCTION assessment_authoring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text; parent_key uuid;
BEGIN
 IF TG_TABLE_NAME IN ('assessment_questions','assessment_quizzes','assessment_skills','assessment_skill_content_links') THEN
  IF OLD.status='archived' THEN RAISE EXCEPTION 'ASSESSMENT_ARCHIVED' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ASSESSMENT_ARCHIVE_NOT_DELETE' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='assessment_quizzes' THEN
   IF EXISTS(SELECT 1 FROM assessment_quiz_revisions WHERE quiz_id=OLD.id)
    AND (NEW.course_id,NEW.parent_type,NEW.parent_id,NEW.chapter_id,NEW.lesson_id)
      IS DISTINCT FROM (OLD.course_id,OLD.parent_type,OLD.parent_id,OLD.chapter_id,OLD.lesson_id) THEN
    RAISE EXCEPTION 'ASSESSMENT_PARENT_SEALED' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSE
  IF TG_TABLE_NAME IN ('assessment_question_drafts','assessment_question_skills','assessment_question_cognitive_tags') THEN
   parent_key:=CASE WHEN TG_OP='DELETE' THEN OLD.question_id ELSE NEW.question_id END;
   SELECT status INTO parent_status FROM assessment_questions WHERE id=parent_key FOR UPDATE;
   IF TG_OP='UPDATE' AND NEW.question_id<>OLD.question_id THEN RAISE EXCEPTION 'ASSESSMENT_OWNER_IMMUTABLE' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='assessment_skill_translations' THEN
   parent_key:=CASE WHEN TG_OP='DELETE' THEN OLD.skill_id ELSE NEW.skill_id END;
   SELECT status INTO parent_status FROM assessment_skills WHERE id=parent_key FOR UPDATE;
   IF TG_OP='UPDATE' AND NEW.skill_id<>OLD.skill_id THEN RAISE EXCEPTION 'ASSESSMENT_OWNER_IMMUTABLE' USING ERRCODE='23514'; END IF;
  ELSE
   parent_key:=CASE WHEN TG_OP='DELETE' THEN OLD.quiz_id ELSE NEW.quiz_id END;
   SELECT status INTO parent_status FROM assessment_quizzes WHERE id=parent_key FOR UPDATE;
   IF TG_OP='UPDATE' AND NEW.quiz_id<>OLD.quiz_id THEN RAISE EXCEPTION 'ASSESSMENT_OWNER_IMMUTABLE' USING ERRCODE='23514'; END IF;
  END IF;
  IF parent_status='archived' THEN RAISE EXCEPTION 'ASSESSMENT_ARCHIVED' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assessment_questions','assessment_quizzes','assessment_skills','assessment_skill_content_links']
 LOOP EXECUTE format('CREATE TRIGGER authoring_guard BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION assessment_authoring_guard()',t); END LOOP;
 FOREACH t IN ARRAY ARRAY['assessment_question_drafts','assessment_question_skills','assessment_question_cognitive_tags','assessment_quiz_drafts','assessment_quiz_draft_items','assessment_skill_translations']
 LOOP EXECUTE format('CREATE TRIGGER authoring_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION assessment_authoring_guard()',t); END LOOP;
END $$;

CREATE FUNCTION assessment_skill_tree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Serialize structural edits. Serializable callers retry serialization failure.
 -- Repeatable-read stale-snapshot structural edits are deliberately unsupported.
 IF current_setting('transaction_isolation')='repeatable read' THEN
  RAISE EXCEPTION 'ASSESSMENT_TAXONOMY_REQUIRES_READ_COMMITTED_OR_SERIALIZABLE' USING ERRCODE='40001';
 END IF;
 PERFORM pg_advisory_xact_lock(714209,1);
 IF EXISTS(
  WITH RECURSIVE tree AS (
   SELECT id,parent_id,ARRAY[id] AS path,1 AS depth,false AS cycle FROM assessment_skills
   UNION ALL
   SELECT t.id,s.parent_id,t.path||s.id,t.depth+1,s.id=ANY(t.path)
   FROM tree t JOIN assessment_skills s ON s.id=t.parent_id WHERE NOT t.cycle AND t.depth<=8
  ) SELECT 1 FROM tree WHERE cycle OR depth>8
 ) THEN RAISE EXCEPTION 'ASSESSMENT_SKILL_CYCLE_OR_DEPTH' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assessment_skill_tree_check AFTER INSERT OR UPDATE ON assessment_skills
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assessment_skill_tree();

CREATE FUNCTION assessment_question_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE primary_id uuid; parent_status text;
BEGIN
 SELECT status INTO parent_status FROM assessment_questions WHERE id=NEW.question_id FOR UPDATE;
 SELECT qs.skill_id INTO primary_id FROM assessment_question_skills qs JOIN assessment_skills s ON s.id=qs.skill_id
 WHERE qs.question_id=NEW.question_id AND qs.role='primary' AND s.status='active' FOR SHARE OF s;
 IF parent_status<>'active' OR primary_id IS NULL
 OR (SELECT count(*) FROM jsonb_array_elements(NEW.skill_snapshot) x WHERE x->>'role'='primary')<>1
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.skill_snapshot) x WHERE x->>'role'='primary' AND x->>'skillId'=primary_id::text)
 OR jsonb_array_length(NEW.skill_snapshot)<>(SELECT count(*) FROM assessment_question_skills WHERE question_id=NEW.question_id)
 OR jsonb_array_length(NEW.skill_snapshot)<>(SELECT count(DISTINCT x->>'skillId') FROM jsonb_array_elements(NEW.skill_snapshot) x)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.skill_snapshot) x WHERE NOT EXISTS(
   SELECT 1 FROM assessment_question_skills qs JOIN assessment_skills s ON s.id=qs.skill_id
   WHERE qs.question_id=NEW.question_id AND qs.skill_id::text=x->>'skillId' AND qs.role=x->>'role' AND s.status='active'))
 THEN RAISE EXCEPTION 'ASSESSMENT_PRIMARY_SKILL_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assessment_question_seal BEFORE INSERT ON assessment_question_revisions FOR EACH ROW EXECUTE FUNCTION assessment_question_seal();

CREATE FUNCTION assessment_child_assembly() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text; assembly_id bigint;
BEGIN
 IF TG_TABLE_NAME='assessment_quiz_revision_items' THEN
  SELECT assembly_transaction INTO assembly_id FROM assessment_quiz_revisions WHERE id=NEW.quiz_revision_id;
 ELSIF TG_TABLE_NAME='assessment_attempt_questions' THEN
  SELECT assembly_transaction,status INTO assembly_id,parent_status FROM assessment_attempts WHERE id=NEW.attempt_id FOR UPDATE;
  IF parent_status<>'IN_PROGRESS' THEN RAISE EXCEPTION 'ASSESSMENT_ATTEMPT_FROZEN' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='assessment_attempt_question_grades' THEN
  SELECT assembly_transaction INTO assembly_id FROM assessment_attempt_grades WHERE id=NEW.grade_id;
 ELSE
  SELECT assembly_transaction INTO assembly_id FROM assessment_attempt_question_grades WHERE id=NEW.question_grade_id;
 END IF;
 IF assembly_id IS DISTINCT FROM (pg_current_xact_id()::text)::bigint THEN
  RAISE EXCEPTION 'ASSESSMENT_ASSEMBLY_CLOSED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION assessment_stamp_assembly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.assembly_transaction:=(pg_current_xact_id()::text)::bigint; RETURN NEW; END $$;
CREATE TRIGGER stamp_assembly BEFORE INSERT ON assessment_quiz_revisions FOR EACH ROW EXECUTE FUNCTION assessment_stamp_assembly();
CREATE TRIGGER stamp_assembly BEFORE INSERT ON assessment_attempt_grades FOR EACH ROW EXECUTE FUNCTION assessment_stamp_assembly();
CREATE TRIGGER stamp_assembly BEFORE INSERT ON assessment_attempt_question_grades FOR EACH ROW EXECUTE FUNCTION assessment_stamp_assembly();
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assessment_quiz_revision_items','assessment_attempt_questions','assessment_attempt_question_grades','assessment_skill_evidence']
 LOOP EXECUTE format('CREATE TRIGGER assembly_guard BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION assessment_child_assembly()',t); END LOOP;
END $$;

CREATE FUNCTION assessment_quiz_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item_count integer; item_total integer; parent_status text;
BEGIN
 SELECT status INTO parent_status FROM assessment_quizzes WHERE id=NEW.quiz_id FOR UPDATE;
 SELECT count(*),sum(points) INTO item_count,item_total FROM assessment_quiz_revision_items WHERE quiz_revision_id=NEW.id;
 IF parent_status='archived' OR item_count NOT BETWEEN 1 AND 100 OR item_total IS DISTINCT FROM NEW.total_points THEN
  RAISE EXCEPTION 'ASSESSMENT_QUIZ_SEAL_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assessment_quiz_seal_check AFTER INSERT ON assessment_quiz_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assessment_quiz_seal();

CREATE FUNCTION assessment_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r assessment_quiz_revisions; reason text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ASSESSMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  NEW.assembly_transaction:=(pg_current_xact_id()::text)::bigint;
  SELECT * INTO r FROM assessment_quiz_revisions WHERE id=NEW.quiz_revision_id;
  IF NEW.status<>'IN_PROGRESS' OR (NEW.opens_at,NEW.closes_at,NEW.time_limit_seconds) IS DISTINCT FROM (r.opens_at,r.closes_at,r.time_limit_seconds) THEN
   RAISE EXCEPTION 'ASSESSMENT_ATTEMPT_SNAPSHOT_INVALID' USING ERRCODE='23514';
  END IF;
  reason:=CASE WHEN NEW.deadline_at IS NULL THEN NULL
   WHEN NEW.closes_at=NEW.started_at+NEW.time_limit_seconds*interval '1 second' THEN 'both'
   WHEN NEW.closes_at IS NOT NULL AND (NEW.time_limit_seconds IS NULL OR NEW.closes_at<NEW.started_at+NEW.time_limit_seconds*interval '1 second') THEN 'availability_close'
   ELSE 'time_limit' END;
  IF NEW.deadline_reason IS DISTINCT FROM reason THEN RAISE EXCEPTION 'ASSESSMENT_DEADLINE_REASON_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','concurrency_version','submitted_at','effective_submitted_at','finalization_reason','graded_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','concurrency_version','submitted_at','effective_submitted_at','finalization_reason','graded_at']) THEN
   RAISE EXCEPTION 'ASSESSMENT_ATTEMPT_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.status='GRADED' OR (OLD.status<>'IN_PROGRESS' AND
   (NEW.status<>'GRADED' OR (NEW.submitted_at,NEW.effective_submitted_at,NEW.finalization_reason,NEW.concurrency_version)
   IS DISTINCT FROM (OLD.submitted_at,OLD.effective_submitted_at,OLD.finalization_reason,OLD.concurrency_version)))
   OR (OLD.status='IN_PROGRESS' AND NEW.status='GRADED') THEN
   RAISE EXCEPTION 'ASSESSMENT_STATE_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  IF OLD.status='IN_PROGRESS' AND NEW.status<>'IN_PROGRESS' THEN
   IF (NEW.status='SUBMITTED' AND (NEW.finalization_reason<>'voluntary' OR NEW.effective_submitted_at IS DISTINCT FROM NEW.submitted_at
     OR (NEW.deadline_at IS NOT NULL AND NEW.submitted_at>=NEW.deadline_at)))
    OR (NEW.status='AUTO_SUBMITTED' AND (NEW.deadline_at IS NULL OR NEW.finalization_reason IS DISTINCT FROM NEW.deadline_reason
     OR NEW.effective_submitted_at IS DISTINCT FROM NEW.deadline_at OR NEW.submitted_at<NEW.deadline_at)) THEN
    RAISE EXCEPTION 'ASSESSMENT_FINALIZATION_INVALID' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assessment_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON assessment_attempts FOR EACH ROW EXECUTE FUNCTION assessment_attempt_guard();

CREATE FUNCTION assessment_working_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a assessment_attempts; question_id uuid;
BEGIN
 question_id:=CASE WHEN TG_OP='DELETE' THEN OLD.attempt_question_id ELSE NEW.attempt_question_id END;
 SELECT at.* INTO a FROM assessment_attempts at JOIN assessment_attempt_questions q ON q.attempt_id=at.id WHERE q.id=question_id FOR UPDATE OF at;
 IF a.status<>'IN_PROGRESS' OR (a.deadline_at IS NOT NULL AND clock_timestamp()>=a.deadline_at) THEN
  RAISE EXCEPTION 'ASSESSMENT_ATTEMPT_FROZEN' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ASSESSMENT_WORKING_HISTORY_RETAINED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.attempt_question_id<>OLD.attempt_question_id THEN RAISE EXCEPTION 'ASSESSMENT_OWNER_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='assessment_attempt_question_states' THEN
  IF NEW.flag_revision<>OLD.flag_revision+(CASE WHEN NEW.is_flagged IS DISTINCT FROM OLD.is_flagged THEN 1 ELSE 0 END) THEN
   RAISE EXCEPTION 'ASSESSMENT_FLAG_REVISION_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='assessment_attempt_answers' THEN
  IF NEW.answer_revision<>OLD.answer_revision+(CASE WHEN NEW.answer IS DISTINCT FROM OLD.answer THEN 1 ELSE 0 END)
  OR NEW.change_count<>OLD.change_count+(CASE WHEN NEW.answer IS DISTINCT FROM OLD.answer THEN 1 ELSE 0 END)
  OR (OLD.first_answered_at IS NOT NULL AND NEW.first_answered_at IS DISTINCT FROM OLD.first_answered_at) THEN
   RAISE EXCEPTION 'ASSESSMENT_ANSWER_REVISION_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assessment_attempt_answers','assessment_attempt_question_states','assessment_attempt_question_telemetry']
 LOOP EXECUTE format('CREATE TRIGGER working_state_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION assessment_working_state_guard()',t); END LOOP;
END $$;

-- Complete presentation at start, complete grading at commit. No later child
-- insertion can change historical denominators or add skill observations.
CREATE FUNCTION assessment_attempt_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a assessment_attempts; r assessment_quiz_revisions; g assessment_attempt_grades;
BEGIN
 SELECT * INTO a FROM assessment_attempts WHERE id=NEW.id;
 SELECT * INTO r FROM assessment_quiz_revisions WHERE id=a.quiz_revision_id;
 IF (SELECT count(*) FROM assessment_attempt_questions WHERE attempt_id=a.id)
   <> (SELECT count(*) FROM assessment_quiz_revision_items WHERE quiz_revision_id=a.quiz_revision_id) THEN
  RAISE EXCEPTION 'ASSESSMENT_PRESENTATION_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF a.status='GRADED' THEN
  SELECT * INTO g FROM assessment_attempt_grades WHERE attempt_id=a.id;
  IF g.id IS NULL OR g.possible_points<>r.total_points OR g.graded_at<>a.graded_at
   OR g.passed<>(g.earned_points::bigint*10000>=g.possible_points::bigint*r.pass_basis_points)
   OR (SELECT count(*) FROM assessment_attempt_question_grades WHERE attempt_id=a.id)<>(SELECT count(*) FROM assessment_attempt_questions WHERE attempt_id=a.id)
   OR g.earned_points IS DISTINCT FROM (SELECT sum(earned_points)::integer FROM assessment_attempt_question_grades WHERE attempt_id=a.id)
   OR g.possible_points IS DISTINCT FROM (SELECT sum(possible_points)::integer FROM assessment_attempt_question_grades WHERE attempt_id=a.id)
   OR EXISTS (
    SELECT 1 FROM assessment_attempt_question_grades qg
    JOIN assessment_attempt_questions aq ON aq.id=qg.attempt_question_id
    JOIN assessment_quiz_revision_items i ON i.id=aq.item_id
    JOIN assessment_question_revisions qr ON qr.id=i.question_revision_id
    WHERE qg.attempt_id=a.id AND
    (SELECT count(*) FROM assessment_skill_evidence e WHERE e.question_grade_id=qg.id)<>jsonb_array_length(qr.skill_snapshot)
   )
   THEN RAISE EXCEPTION 'ASSESSMENT_GRADE_INCOMPLETE' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM assessment_attempt_grades WHERE attempt_id=a.id) THEN
  RAISE EXCEPTION 'ASSESSMENT_GRADE_REQUIRES_TERMINAL_STATE' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assessment_attempt_complete_check AFTER INSERT OR UPDATE ON assessment_attempts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assessment_attempt_complete();

CREATE FUNCTION assessment_grade_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a assessment_attempts; q assessment_attempt_question_grades; item_points integer; accepted boolean; viewed boolean; observed_coverage text; skills jsonb; quiz_mode text;
BEGIN
 IF TG_TABLE_NAME='assessment_attempt_grades' THEN
  SELECT * INTO a FROM assessment_attempts WHERE id=NEW.attempt_id FOR UPDATE;
  IF a.status<>'GRADED' THEN RAISE EXCEPTION 'ASSESSMENT_GRADE_REQUIRES_TERMINAL_STATE' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='assessment_attempt_question_grades' THEN
  SELECT i.points INTO item_points FROM assessment_attempt_questions aq JOIN assessment_quiz_revision_items i ON i.id=aq.item_id WHERE aq.id=NEW.attempt_question_id;
  SELECT answer IS NOT NULL AND answer<>'null'::jsonb INTO accepted FROM assessment_attempt_answers WHERE attempt_question_id=NEW.attempt_question_id;
  SELECT first_viewed_at IS NOT NULL,coverage INTO viewed,observed_coverage FROM assessment_attempt_question_telemetry WHERE attempt_question_id=NEW.attempt_question_id;
  SELECT * INTO a FROM assessment_attempts WHERE id=NEW.attempt_id;
  IF NEW.possible_points<>item_points OR NEW.had_accepted_answer<>coalesce(accepted,false)
    OR NEW.had_recorded_view<>coalesce(viewed,false) OR NEW.coverage<>coalesce(observed_coverage,'unknown')
    OR NEW.finalization_reason IS DISTINCT FROM a.finalization_reason THEN
   RAISE EXCEPTION 'ASSESSMENT_GRADE_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO q FROM assessment_attempt_question_grades WHERE id=NEW.question_grade_id;
  SELECT qr.skill_snapshot,r.mode INTO skills,quiz_mode
   FROM assessment_attempt_questions aq JOIN assessment_quiz_revision_items i ON i.id=aq.item_id
   JOIN assessment_question_revisions qr ON qr.id=i.question_revision_id
   JOIN assessment_quiz_revisions r ON r.id=i.quiz_revision_id WHERE aq.id=q.attempt_question_id;
  SELECT * INTO a FROM assessment_attempts WHERE id=NEW.attempt_id;
  IF NEW.mode<>quiz_mode OR NEW.graded_at IS DISTINCT FROM a.graded_at OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(skills) s WHERE s->>'skillId'=NEW.skill_id::text AND s->>'role'=NEW.role AND s=NEW.taxonomy_snapshot
  ) THEN RAISE EXCEPTION 'ASSESSMENT_EVIDENCE_LINEAGE_INVALID' USING ERRCODE='23514'; END IF;
  IF (NEW.response_state,NEW.had_accepted_answer,NEW.had_recorded_view,NEW.coverage,NEW.finalization_reason,NEW.earned_points,NEW.possible_points)
    IS DISTINCT FROM (q.response_state,q.had_accepted_answer,q.had_recorded_view,q.coverage,q.finalization_reason,q.earned_points,q.possible_points) THEN
   RAISE EXCEPTION 'ASSESSMENT_EVIDENCE_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assessment_attempt_grades','assessment_attempt_question_grades','assessment_skill_evidence']
 LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER grade_seal AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assessment_grade_seal()',t); END LOOP;
END $$;
-- Explicit Prisma-compatible identifiers avoid PostgreSQL's different automatic
-- truncation of long composite foreign-key names.
ALTER TABLE assessment_attempt_question_grades RENAME CONSTRAINT assessment_attempt_question_g_attempt_question_id_attempt__fkey TO assessment_attempt_question_grades_attempt_question_id_att_fkey;
ALTER TABLE assessment_quiz_revision_items RENAME CONSTRAINT assessment_quiz_revision_item_question_revision_id_questio_fkey TO assessment_quiz_revision_items_question_revision_id_questi_fkey;
ALTER TABLE assessment_skill_content_links RENAME CONSTRAINT assessment_skill_content_link_lesson_id_chapter_id_course__fkey TO assessment_skill_content_links_lesson_id_chapter_id_course_fkey;
ALTER TABLE assessment_skill_content_links RENAME CONSTRAINT assessment_skill_content_link_media_placement_id_course_id_fkey TO assessment_skill_content_links_media_placement_id_course_i_fkey;
COMMIT;
