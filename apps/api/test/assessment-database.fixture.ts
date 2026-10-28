import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// psql receives whole SQL programs: dollar-quoted PL/pgSQL bodies are never split.
// Connection credentials stay in the inherited environment, never command args.
export class AssessmentDatabaseFixture {
  readonly schema = `assessment_test_${randomUUID().replaceAll("-", "")}`;
  readonly ids = Object.fromEntries([
    "user", "otherUser", "course", "otherCourse", "chapter", "lesson", "enrollment",
    "otherEnrollment", "completion", "skill", "otherSkill", "question", "question2",
    "questionRevision", "questionRevision2", "quiz", "quiz2", "quizRevision",
    "quizRevision2", "item", "item2", "attempt", "attemptQuestion", "grade", "questionGrade",
  ].map((key) => [key, randomUUID()])) as Record<string, string>;

  private async migrations(): Promise<string> {
    let directory = dirname(fileURLToPath(import.meta.url));
    for (;;) {
      const candidate = join(directory, "packages/database/prisma/migrations");
      try { await access(candidate); return candidate; } catch { /* walk source/compiled ancestors */ }
      const parent = dirname(directory);
      if (parent === directory) throw new Error("Assessment migration directory not found");
      directory = parent;
    }
  }

  async sql(sql: string, scoped = true): Promise<string> {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for disposable assessment tests");
    const url = new URL(process.env.DATABASE_URL);
    const sslMode = url.searchParams.get("sslaccept") === "strict"
      ? "verify-full" : url.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer";
    return new Promise((resolve, reject) => {
      const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
        env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432",
          PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
          PGDATABASE: url.pathname.slice(1), PGSSLMODE: sslMode,
          ...(url.searchParams.has("sslcert") ? { PGSSLROOTCERT: url.searchParams.get("sslcert")! } : {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = ""; let err = "";
      child.stdout.on("data", (data: Buffer) => { out += data.toString(); });
      child.stderr.on("data", (data: Buffer) => { err += data.toString(); });
      child.on("error", () => reject(new Error("Assessment PostgreSQL runner unavailable")));
      child.on("close", (code) => {
        if (code === 0) { resolve(out.trim()); return; }
        const state = err.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/)?.[1] || "UNKNOWN";
        const constraint = err.match(/constraint "(assessment_[a-z_]+)"/)?.[1] || "";
        const domainCode = err.match(/\bASSESSMENT_[A-Z_]+\b/)?.[0] || "";
        reject(new Error(`Assessment SQLSTATE ${state} ${constraint} ${domainCode}`.trim()));
      });
      child.stdin.end(`${scoped ? `SET search_path TO "${this.schema}";` : ""}\n${sql}`);
    });
  }

  async setup(): Promise<void> {
    await this.sql(`CREATE SCHEMA "${this.schema}"`, false);
    const migrations = await this.migrations();
    for (const name of (await readdir(migrations)).sort()) {
      if (!/^\d/.test(name) || name.includes("assessment_foundation")) continue;
      await this.sql(await readFile(`${migrations}/${name}/migration.sql`, "utf8"));
    }
    const i = this.ids;
    await this.sql(`
      INSERT INTO users(id,email,display_name,updated_at) VALUES
        ('${i.user}','fixture@example.invalid','Fixture',now()),('${i.otherUser}','other@example.invalid','Other',now());
      INSERT INTO courses(id,slug,title,status,created_by,updated_at) VALUES
        ('${i.course}','fixture','Fixture','published','${i.user}',now()),
        ('${i.otherCourse}','other','Other','published','${i.user}',now());
      INSERT INTO chapters(id,course_id,title,status,position,updated_at)
        VALUES('${i.chapter}','${i.course}','Fixture','published',0,now());
      INSERT INTO lessons(id,chapter_id,course_id,title,status,position,updated_at)
        VALUES('${i.lesson}','${i.chapter}','${i.course}','Fixture','published',0,now());
      INSERT INTO enrollments(id,user_id,course_id,granted_by) VALUES
        ('${i.enrollment}','${i.user}','${i.course}','${i.user}'),
        ('${i.otherEnrollment}','${i.otherUser}','${i.course}','${i.user}');
      INSERT INTO lesson_completions(id,enrollment_id,lesson_id,course_id)
        VALUES('${i.completion}','${i.enrollment}','${i.lesson}','${i.course}');
      INSERT INTO course_media_states(course_id,edit_revision) VALUES('${i.course}',7);
    `);
  }

  async migrate(): Promise<void> {
    await this.sql(await readFile(join(await this.migrations(), "20261021010000_assessment_foundation/migration.sql"), "utf8"));
  }

  async cleanup(): Promise<void> { await this.sql(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`, false); }

  async baseline(): Promise<string> {
    return this.sql(`
      SELECT jsonb_build_object(
        'users',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM users t),
        'courses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM courses t),
        'chapters',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM chapters t),
        'lessons',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM lessons t),
        'enrollments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM enrollments t),
        'completion',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM lesson_completions t),
        'mediaState',(SELECT jsonb_agg(to_jsonb(t) ORDER BY course_id) FROM course_media_states t),
        'required',(SELECT count(*) FROM lessons l JOIN chapters c ON c.id=l.chapter_id
          WHERE l.is_required AND l.status='published' AND c.status='published'),
        'completed',(SELECT count(*) FROM lesson_completions)
      )`);
  }

  questionRevision(id = this.ids.questionRevision, question = this.ids.question, number = 1): string {
    const i = this.ids;
    return `INSERT INTO assessment_question_revisions
      (id,question_id,number,type,default_content_locale,content,grading_definition,explanation,difficulty,
       skill_snapshot,cognitive_tags,grader_version,checksum,created_by)
      VALUES('${id}','${question}',${number},'true_false','ar','{}','{}','{}','easy',
        '[{"skillId":"${i.skill}","role":"primary","path":[],"labels":{"ar":"مهارة"}}]','["concept"]','v1','hash','${i.user}');`;
  }

  quizRevision(id = this.ids.quizRevision, quiz = this.ids.quiz, number = 1, item = this.ids.item): string {
    const i = this.ids;
    return `INSERT INTO assessment_quiz_revisions
      (id,quiz_id,course_id,number,default_content_locale,content,mode,score_visibility,review_visibility,
       explanation_visibility,total_points,grader_version,created_by)
      VALUES('${id}','${quiz}','${i.course}',${number},'ar','{}','practice','after_grading','manual_release','never',1,'v1','${i.user}');
      INSERT INTO assessment_quiz_revision_items
      (id,quiz_revision_id,question_id,question_revision_id,position,points,evidence_snapshot)
      VALUES('${item}','${id}','${i.question}','${i.questionRevision}',0,1,'{}');`;
  }

  attempt(id = this.ids.attempt, aq = this.ids.attemptQuestion, number = 1, revision = this.ids.quizRevision, item = this.ids.item): string {
    const i = this.ids;
    return `INSERT INTO assessment_attempts
      (id,quiz_id,quiz_revision_id,course_id,enrollment_id,student_user_id,attempt_number,selected_content_locale)
      VALUES('${id}','${i.quiz}','${revision}','${i.course}','${i.enrollment}','${i.user}',${number},'ar');
      INSERT INTO assessment_attempt_questions(id,attempt_id,quiz_revision_id,item_id,position,content_locale,presentation)
      VALUES('${aq}','${id}','${revision}','${item}',0,'ar','{"fixed":true}');`;
  }

  async author(): Promise<void> {
    const i = this.ids;
    await this.sql(`BEGIN;
      INSERT INTO assessment_skills(id,slug) VALUES('${i.skill}','fixture'),('${i.otherSkill}','other');
      INSERT INTO assessment_questions(id,created_by) VALUES('${i.question}','${i.user}'),('${i.question2}','${i.user}');
      INSERT INTO assessment_question_skills(question_id,skill_id,role) VALUES('${i.question}','${i.skill}','primary');
      INSERT INTO assessment_question_drafts(question_id,type,default_content_locale,content,grading_definition,explanation,difficulty)
        VALUES('${i.question}','true_false','ar','{}','{}','{}','easy');
      ${this.questionRevision()}
      INSERT INTO assessment_quizzes(id,course_id,parent_type,parent_id,created_by)
        VALUES('${i.quiz}','${i.course}','course','${i.course}','${i.user}'),
        ('${i.quiz2}','${i.course}','course','${i.course}','${i.user}');
      INSERT INTO assessment_quiz_drafts(quiz_id,default_content_locale,content,policy)
        VALUES('${i.quiz}','ar','{}','{}');
      ${this.quizRevision()}
      ${this.quizRevision(i.quizRevision2, i.quiz, 2, i.item2)}
      UPDATE assessment_quizzes SET current_revision_id='${i.quizRevision}',status='published' WHERE id='${i.quiz}';
      COMMIT;`);
  }
}
