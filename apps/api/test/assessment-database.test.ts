import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AssessmentDatabaseFixture } from "./assessment-database.fixture.js";

test("Q2 additive database foundation on full disposable PostgreSQL schema", { timeout: 120000 }, async (t) => {
  const f = new AssessmentDatabaseFixture();
  const i = f.ids;
  const fails = async (sql: string, code = "23514") => {
    await assert.rejects(f.sql(sql), (error: unknown) => error instanceof Error && error.message.includes(code));
  };
  try {
    await f.setup();
    const baseline = await f.baseline();
    await f.migrate();
    await t.test("all 25 tables migrate without changing existing data/progress", async () => {
      assert.equal(await f.baseline(), baseline);
      assert.equal(await f.sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name LIKE 'assessment_%'`), "25");
    });
    await f.author();
    await t.test("composite ancestry, owned revision pointers and exact question lineage", async () => {
      await fails(`INSERT INTO assessment_quizzes(id,course_id,parent_type,parent_id,chapter_id,created_by)
        VALUES('${randomUUID()}','${i.otherCourse}','chapter','${i.chapter}','${i.chapter}','${i.user}')`, "23503");
      await fails(`UPDATE assessment_questions SET current_revision_id='${i.questionRevision}' WHERE id='${i.question2}'`, "23503");
      await fails(`UPDATE assessment_quizzes SET current_revision_id='${i.quizRevision}' WHERE id='${i.quiz2}'`, "23503");
      await fails(`INSERT INTO assessment_quiz_draft_items(id,quiz_id,question_id,question_revision_id,position,points)
        VALUES('${randomUUID()}','${i.quiz}','${i.question2}','${i.questionRevision}',0,1)`, "23503");
      await fails(`INSERT INTO assessment_skill_content_links
        (id,skill_id,course_id,target_type,chapter_id,lesson_id,relation_kind,created_by)
        VALUES('${randomUUID()}','${i.skill}','${i.otherCourse}','lesson','${i.chapter}','${i.lesson}','remedial','${i.user}')`, "23503");
    });
    await t.test("drafts stay mutable; immutable revisions, children and parent location stay sealed", async () => {
      await f.sql(`UPDATE assessment_question_drafts SET content='{"edited":true}' WHERE question_id='${i.question}';
        UPDATE assessment_quiz_drafts SET content='{"edited":true}' WHERE quiz_id='${i.quiz}';
        INSERT INTO assessment_quiz_draft_items(id,quiz_id,question_id,question_revision_id,position,points)
        VALUES('${randomUUID()}','${i.quiz}','${i.question}','${i.questionRevision}',0,1);
        DELETE FROM assessment_quiz_draft_items WHERE quiz_id='${i.quiz}'`);
      for (const [table, id] of [["assessment_question_revisions", i.questionRevision], ["assessment_quiz_revisions", i.quizRevision], ["assessment_quiz_revision_items", i.item]]) {
        await fails(`UPDATE ${table} SET id=id WHERE id='${id}'`);
        await fails(`DELETE FROM ${table} WHERE id='${id}'`);
      }
      await fails(`INSERT INTO assessment_quiz_revision_items(id,quiz_revision_id,question_id,question_revision_id,position,points,evidence_snapshot)
        VALUES('${randomUUID()}','${i.quizRevision}','${i.question}','${i.questionRevision}',1,1,'{}')`);
      await fails(`UPDATE assessment_quizzes SET parent_type='chapter',parent_id='${i.chapter}',chapter_id='${i.chapter}' WHERE id='${i.quiz}'`);
      await fails(`BEGIN; ${f.quizRevision(randomUUID(), i.quiz, 3, randomUUID()).split("INSERT INTO assessment_quiz_revision_items")[0]} COMMIT;`);
      await fails(`DELETE FROM assessment_questions WHERE id='${i.question}'`);
    });
    await t.test("primary skill uniqueness and publishable exactly-one active primary", async () => {
      await fails(`INSERT INTO assessment_question_skills(question_id,skill_id,role) VALUES('${i.question}','${i.otherSkill}','primary')`, "23505");
      await fails(f.questionRevision(randomUUID(), i.question2));
      await fails(`BEGIN; UPDATE assessment_skills SET status='archived' WHERE id='${i.skill}'; ${f.questionRevision(randomUUID(), i.question, 2)} COMMIT;`);
      await fails(`BEGIN; UPDATE assessment_questions SET status='archived' WHERE id='${i.question}';
        UPDATE assessment_question_drafts SET content='{}' WHERE question_id='${i.question}'; COMMIT;`);
      await fails(`BEGIN; UPDATE assessment_questions SET status='archived' WHERE id='${i.question}';
        INSERT INTO assessment_question_cognitive_tags(question_id,code) VALUES('${i.question}','debugging'); COMMIT;`);
    });
    await t.test("taxonomy cycles and eight-level maximum including subtree moves", async () => {
      await fails(`UPDATE assessment_skills SET parent_id=id WHERE id='${i.skill}'`);
      await fails(`BEGIN; UPDATE assessment_skills SET parent_id='${i.otherSkill}' WHERE id='${i.skill}';
        UPDATE assessment_skills SET parent_id='${i.skill}' WHERE id='${i.otherSkill}'; COMMIT;`);
      const chain = Array.from({ length: 9 }, () => randomUUID());
      const inserts = chain.map((id, n) => `INSERT INTO assessment_skills(id,slug,parent_id) VALUES('${id}','depth-${n}',${n ? `'${chain[n - 1]}'` : "NULL"});`);
      await f.sql(`BEGIN; ${inserts.slice(0, 8).join("\n")} COMMIT;`);
      await fails(`BEGIN; ${inserts[8]} COMMIT;`);
      await fails(`UPDATE assessment_skills SET parent_id='${i.skill}' WHERE id='${chain[0]}'`);
      assert.equal(await f.sql(`SELECT count(*) FROM assessment_skills WHERE slug LIKE 'depth-%'`), "8");
    });
    await t.test("concurrent taxonomy moves cannot commit a cycle", async () => {
      const a = randomUUID(); const b = randomUUID();
      await f.sql(`INSERT INTO assessment_skills(id,slug) VALUES('${a}','race-a'),('${b}','race-b')`);
      const outcomes = await Promise.allSettled([
        f.sql(`BEGIN; UPDATE assessment_skills SET parent_id='${b}' WHERE id='${a}'; SELECT pg_sleep(0.1); COMMIT;`),
        f.sql(`BEGIN; UPDATE assessment_skills SET parent_id='${a}' WHERE id='${b}'; SELECT pg_sleep(0.1); COMMIT;`),
      ]);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
      assert.match(String(rejected.reason), /23514|40001|40P01/);
    });
    await t.test("idempotency keys are actor/scope unique and receipts immutable", async () => {
      const mutation = randomUUID(); const client = randomUUID();
      const insert = (id: string, scope: string) => `INSERT INTO assessment_mutations
        (id,actor_id,operation_scope,client_mutation_id,payload_hash,receipt)
        VALUES('${id}','${i.user}','${scope}','${client}','hash','{}')`;
      await f.sql(insert(mutation, "answer:fixture"));
      await fails(insert(randomUUID(), "answer:fixture"), "23505");
      await f.sql(insert(randomUUID(), "flag:fixture"));
      await fails(`UPDATE assessment_mutations SET payload_hash='changed' WHERE id='${mutation}'`);
    });
    await t.test("attempt ownership, immutable exact revision membership and complete initial presentation", async () => {
      await fails(`BEGIN; ${f.attempt().replace(`'${i.enrollment}'`, `'${i.otherEnrollment}'`)} COMMIT;`, "23503");
      await fails(`BEGIN; ${f.attempt(i.attempt, i.attemptQuestion, 1, i.quizRevision, i.item2)} COMMIT;`, "23503");
      await fails(`BEGIN; ${f.attempt().split("INSERT INTO assessment_attempt_questions")[0]} COMMIT;`);
      await f.sql(`BEGIN; ${f.attempt()} COMMIT;`);
      await fails(`UPDATE assessment_attempts SET selected_content_locale='en' WHERE id='${i.attempt}'`);
      await fails(`UPDATE assessment_attempt_questions SET presentation='{}' WHERE id='${i.attemptQuestion}'`);
      await fails(`BEGIN; UPDATE assessment_attempts SET concurrency_version=concurrency_version+1 WHERE id='${i.attempt}';
        INSERT INTO assessment_attempt_questions(id,attempt_id,quiz_revision_id,item_id,position,content_locale,presentation)
        VALUES('${randomUUID()}','${i.attempt}','${i.quizRevision}','${i.item}',1,'ar','{}'); COMMIT;`);
      await fails(`DELETE FROM assessment_attempts WHERE id='${i.attempt}'`);
    });
    await t.test("durable answers and independent flags; post-submit child inserts and changes rejected", async () => {
      await f.sql(`INSERT INTO assessment_attempt_answers(attempt_question_id) VALUES('${i.attemptQuestion}');
        INSERT INTO assessment_attempt_question_states(attempt_question_id) VALUES('${i.attemptQuestion}');
        UPDATE assessment_attempt_answers SET answer='true',answer_revision=1,change_count=1,first_answered_at=now(),final_answered_at=now()
          WHERE attempt_question_id='${i.attemptQuestion}'`);
      const answer = await f.sql(`SELECT to_jsonb(t) FROM assessment_attempt_answers t`);
      await f.sql(`UPDATE assessment_attempt_question_states SET is_flagged=true,flag_revision=1 WHERE attempt_question_id='${i.attemptQuestion}'`);
      assert.equal(await f.sql(`SELECT to_jsonb(t) FROM assessment_attempt_answers t`), answer);
      await fails(`UPDATE assessment_attempt_question_states SET is_flagged=false WHERE attempt_question_id='${i.attemptQuestion}'`);
      await fails(`UPDATE assessment_attempt_answers SET answer='false' WHERE attempt_question_id='${i.attemptQuestion}'`);
      await f.sql(`UPDATE assessment_attempt_question_states SET is_flagged=false,flag_revision=2 WHERE attempt_question_id='${i.attemptQuestion}';
        UPDATE assessment_attempt_answers SET answer=NULL,answer_revision=2,change_count=2 WHERE attempt_question_id='${i.attemptQuestion}';
        UPDATE assessment_attempts SET status='SUBMITTED',submitted_at=now(),effective_submitted_at=now(),finalization_reason='voluntary' WHERE id='${i.attempt}'`);
      await fails(`UPDATE assessment_attempt_answers SET answer='true',answer_revision=3,change_count=3 WHERE attempt_question_id='${i.attemptQuestion}'`);
      await fails(`UPDATE assessment_attempt_question_states SET is_flagged=true,flag_revision=3 WHERE attempt_question_id='${i.attemptQuestion}'`);
      await fails(`INSERT INTO assessment_attempt_question_telemetry(attempt_question_id) VALUES('${i.attemptQuestion}')`);
      await fails(`UPDATE assessment_attempts SET status='IN_PROGRESS',submitted_at=NULL,effective_submitted_at=NULL,finalization_reason=NULL WHERE id='${i.attempt}'`);
      assert.equal(await f.sql(`SELECT first_answered_at IS NOT NULL FROM assessment_attempt_answers WHERE attempt_question_id='${i.attemptQuestion}'`), "t");
    });
    await t.test("partial uniqueness under simultaneous starts; numbering across revisions/reactivation", async () => {
      const starts = [2, 3].map((number) => f.sql(`BEGIN; ${f.attempt(randomUUID(), randomUUID(), number, i.quizRevision2, i.item2)} SELECT pg_sleep(0.1); COMMIT;`));
      const outcomes = await Promise.allSettled(starts);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
      assert.match(String(rejected.reason), /23505/);
      assert.match(String(rejected.reason), /assessment_one_open_attempt/);
      await f.sql(`UPDATE assessment_attempts SET status='SUBMITTED',submitted_at=now(),effective_submitted_at=now(),finalization_reason='voluntary' WHERE status='IN_PROGRESS';
        UPDATE enrollments SET status='revoked' WHERE id='${i.enrollment}';
        UPDATE enrollments SET status='active' WHERE id='${i.enrollment}'`);
      await fails(`BEGIN; ${f.attempt(randomUUID(), randomUUID(), 1)} COMMIT;`, "23505");
      await fails(`DELETE FROM enrollments WHERE id='${i.enrollment}'`, "23503");
    });
    await t.test("policy bounds, exclusive close, clipped immutable deadline/reason and expired writes", async () => {
      const revision = randomUUID(); const item = randomUUID();
      const policy = f.quizRevision(revision, i.quiz, 4, item)
        .replace("total_points,grader_version", "opens_at,closes_at,time_limit_seconds,total_points,grader_version")
        .replace("'never',1,'v1'", "'never','2099-01-01 20:00Z','2099-01-01 22:00Z',1800,1,'v1'");
      await fails(`BEGIN; ${policy.replace("'2099-01-01 20:00Z'", "'2099-01-01 23:00Z'")} COMMIT;`);
      await fails(`BEGIN; ${policy.replace(",1800,1,'v1'", ",59,1,'v1'")} COMMIT;`);
      await f.sql(`BEGIN; SAVEPOINT assembly; ${policy} RELEASE SAVEPOINT assembly; COMMIT;`);
      const bounded = (start: string, deadline: string, reason: string) => f.attempt(randomUUID(), randomUUID(), 4, revision, item)
        .replace("attempt_number,selected_content_locale)", "attempt_number,selected_content_locale,started_at,opens_at,closes_at,time_limit_seconds,deadline_at,deadline_reason)")
        .replace(",4,'ar');", `,4,'ar','${start}','2099-01-01 20:00Z','2099-01-01 22:00Z',1800,'${deadline}','${reason}');`);
      await fails(`BEGIN; ${bounded("2099-01-01 19:59Z", "2099-01-01 20:29Z", "time_limit")} COMMIT;`);
      await fails(`BEGIN; ${bounded("2099-01-01 22:00Z", "2099-01-01 22:00Z", "availability_close")} COMMIT;`);
      await fails(`BEGIN; ${bounded("2099-01-01 21:50Z", "2099-01-01 22:20Z", "availability_close")} COMMIT;`);
      await fails(`BEGIN; ${bounded("2099-01-01 21:50Z", "2099-01-01 22:00Z", "time_limit")} COMMIT;`);
      await f.sql(`BEGIN; ${bounded("2099-01-01 21:50Z", "2099-01-01 22:00Z", "availability_close")} SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`);
      await f.sql(`BEGIN; ${bounded("2099-01-01 20:00Z", "2099-01-01 20:30Z", "time_limit")} SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`);
      await f.sql(`BEGIN; ${bounded("2099-01-01 21:30Z", "2099-01-01 22:00Z", "both")} SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`);
      await fails(`BEGIN; ${bounded("2099-01-01 21:50Z", "2099-01-01 22:00Z", "availability_close").replace(",1800,", ",1200,")} COMMIT;`);
      const expiredRevision = randomUUID(); const expiredItem = randomUUID();
      await f.sql(`BEGIN; ${f.quizRevision(expiredRevision, i.quiz, 5, expiredItem)
        .replace("total_points,grader_version", "closes_at,total_points,grader_version")
        .replace("'never',1,'v1'", "'never','2000-01-01 22:00Z',1,'v1'")} COMMIT;`);
      const expiredAttempt = randomUUID(); const expiredQuestion = randomUUID();
      await f.sql(`BEGIN; ${f.attempt(expiredAttempt, expiredQuestion, 4, expiredRevision, expiredItem)
        .replace("attempt_number,selected_content_locale)", "attempt_number,selected_content_locale,started_at,closes_at,deadline_at,deadline_reason)")
        .replace(",4,'ar');", ",4,'ar','2000-01-01 21:50Z','2000-01-01 22:00Z','2000-01-01 22:00Z','availability_close');")} COMMIT;`);
      await fails(`INSERT INTO assessment_attempt_answers(attempt_question_id,answer) VALUES('${expiredQuestion}','true')`);
      await fails(`INSERT INTO assessment_attempt_question_states(attempt_question_id,is_flagged) VALUES('${expiredQuestion}',true)`);
      await fails(`UPDATE assessment_attempts SET status='AUTO_SUBMITTED',submitted_at=now(),
        effective_submitted_at=now(),finalization_reason='availability_close' WHERE id='${expiredAttempt}'`);
      await f.sql(`UPDATE assessment_attempts SET status='AUTO_SUBMITTED',submitted_at=now(),
        effective_submitted_at=deadline_at,finalization_reason='availability_close' WHERE id='${expiredAttempt}'`);
    });
    await t.test("grade is atomic, complete, immutable and four-state evidence does not call blanks wrong", async () => {
      await fails(`UPDATE assessment_attempts SET status='GRADED',graded_at=now() WHERE id='${i.attempt}'`);
      const grading = `
        UPDATE assessment_attempts SET status='GRADED',graded_at=now() WHERE id='${i.attempt}';
        INSERT INTO assessment_attempt_grades(id,attempt_id,earned_points,possible_points,passed,grader_version,checksum)
          VALUES('${i.grade}','${i.attempt}',0,1,false,'v1','hash');
        INSERT INTO assessment_attempt_question_grades
          (id,attempt_question_id,attempt_id,grade_id,earned_points,possible_points,correct,reason_code,response_state,
           had_accepted_answer,had_recorded_view,coverage,finalization_reason)
          VALUES('${i.questionGrade}','${i.attemptQuestion}','${i.attempt}','${i.grade}',0,1,false,'unanswered',
           'unanswered_unviewed',false,false,'unknown','voluntary');
        INSERT INTO assessment_skill_evidence
          (id,question_grade_id,attempt_id,student_user_id,skill_id,role,taxonomy_snapshot,response_state,answered_correctly,
           had_accepted_answer,had_recorded_view,coverage,finalization_reason,earned_points,possible_points,time_quality,mode,graded_at)
          VALUES('${randomUUID()}','${i.questionGrade}','${i.attempt}','${i.user}','${i.skill}','primary',
           '[{"skillId":"${i.skill}","role":"primary","path":[],"labels":{"ar":"مهارة"}}]'::jsonb->0,
           'unanswered_unviewed',NULL,false,false,'unknown','voluntary',0,1,'unknown','practice',now());`;
      await fails(`BEGIN; ${grading.replace("'unanswered_unviewed',NULL", "'unanswered_unviewed',false")} COMMIT;`);
      assert.equal(await f.sql(`SELECT count(*) FROM assessment_attempt_grades`), "0");
      await fails(`BEGIN; ${grading.split("INSERT INTO assessment_skill_evidence")[0]} COMMIT;`);
      await f.sql(`BEGIN; ${grading} COMMIT;`);
      assert.equal(await f.sql(`SELECT answered_correctly IS NULL FROM assessment_skill_evidence`), "t");
      for (const table of ["assessment_attempt_grades", "assessment_attempt_question_grades", "assessment_skill_evidence"]) {
        await fails(`UPDATE ${table} SET id=id`);
        await fails(`DELETE FROM ${table}`);
      }
      await fails(`INSERT INTO assessment_skill_evidence SELECT '${randomUUID()}',question_grade_id,attempt_id,student_user_id,
        '${i.otherSkill}',role,taxonomy_snapshot,response_state,answered_correctly,had_accepted_answer,had_recorded_view,coverage,
        finalization_reason,earned_points,possible_points,estimated_active_ms,time_quality,mode,evidence_version,graded_at
        FROM assessment_skill_evidence`);
    });
    await t.test("answered-without-view, incorrect and viewed-blank evidence preserve distinct meaning", async () => {
      const cases = [
        { state: "correct_answered", answered: true, correct: true, viewed: false },
        { state: "incorrect_answered", answered: true, correct: false, viewed: true },
        { state: "unanswered_viewed", answered: false, correct: false, viewed: true },
      ];
      for (const [n, value] of cases.entries()) {
        const attempt = randomUUID(); const question = randomUUID(); const grade = randomUUID(); const questionGrade = randomUUID();
        const points = value.correct ? 1 : 0;
        await f.sql(`BEGIN;
          ${f.attempt(attempt, question, n + 10)}
          ${value.answered ? `INSERT INTO assessment_attempt_answers(attempt_question_id,answer,answer_revision,change_count,first_answered_at,final_answered_at)
            VALUES('${question}','true',1,1,now(),now());` : ""}
          ${value.viewed ? `INSERT INTO assessment_attempt_question_telemetry(attempt_question_id,first_viewed_at,visit_count)
            VALUES('${question}',now(),1);` : ""}
          UPDATE assessment_attempts SET status='SUBMITTED',submitted_at=now(),effective_submitted_at=now(),finalization_reason='voluntary' WHERE id='${attempt}';
          UPDATE assessment_attempts SET status='GRADED',graded_at=now() WHERE id='${attempt}';
          INSERT INTO assessment_attempt_grades(id,attempt_id,earned_points,possible_points,passed,grader_version,checksum)
            VALUES('${grade}','${attempt}',${points},1,${value.correct},'v1','hash');
          INSERT INTO assessment_attempt_question_grades
            (id,attempt_question_id,attempt_id,grade_id,earned_points,possible_points,correct,reason_code,response_state,
             had_accepted_answer,had_recorded_view,coverage,finalization_reason)
            VALUES('${questionGrade}','${question}','${attempt}','${grade}',${points},1,${value.correct},'deterministic','${value.state}',
             ${value.answered},${value.viewed},'unknown','voluntary');
          INSERT INTO assessment_skill_evidence
            (id,question_grade_id,attempt_id,student_user_id,skill_id,role,taxonomy_snapshot,response_state,answered_correctly,
             had_accepted_answer,had_recorded_view,coverage,finalization_reason,earned_points,possible_points,time_quality,mode,graded_at)
            SELECT '${randomUUID()}','${questionGrade}','${attempt}','${i.user}','${i.skill}','primary',skill_snapshot->0,
             '${value.state}',${value.answered ? value.correct : "NULL"},${value.answered},${value.viewed},'unknown','voluntary',
             ${points},1,'unknown','practice',now() FROM assessment_question_revisions WHERE id='${i.questionRevision}';
          COMMIT;`);
      }
      assert.equal(await f.sql(`SELECT count(DISTINCT response_state) FROM assessment_skill_evidence`), "4");
      assert.equal(await f.sql(`SELECT count(*) FROM assessment_skill_evidence
        WHERE NOT had_accepted_answer AND answered_correctly IS NOT NULL`), "0");
    });
    await t.test("lesson history, curriculum/media edit revisions and progress remain byte-for-byte unchanged", async () => {
      assert.equal(await f.baseline(), baseline);
    });
  } finally { await f.cleanup(); }
});
