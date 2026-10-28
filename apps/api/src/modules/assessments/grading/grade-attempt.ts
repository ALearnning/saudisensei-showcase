import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@workspace/saudisensei-database";
import type { Tx } from "../../courses/lms.store.js";
import { canonical } from "../attempts/attempts.service.js";
import { projectStudentQuestion, type StudentQuestion } from "../contracts/questions.js";
import { aggregateScore, EVIDENCE_VERSION, gradeItem, GRADER_VERSION } from "./deterministic-grader.js";

const skillsSchema = z.array(z.object({ skillId: z.string().uuid(), role: z.enum(["primary", "secondary"]) }).passthrough()).min(1).max(21);
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Internal job transition only. Caller holds retained ancestry, attempt and fenced job locks. */
export async function gradeFrozenAttempt(tx: Tx, attemptId: string, gradedAt: Date) {
  const a = await tx.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: {
    revision: true, grade: true,
    questions: { orderBy: { position: "asc" }, include: { answer: true, telemetry: true, item: { include: { questionRevision: true } } } },
  } });
  if (a.status === "GRADED") {
    if (!a.grade) throw new Error("GRADE_MISSING");
    return; // Duplicate persisted delivery must never create another audit/evidence row.
  }
  if (!["SUBMITTED", "AUTO_SUBMITTED"].includes(a.status) || !a.finalizationReason) throw new Error("ATTEMPT_NOT_FROZEN");
  if (a.revision.schemaVersion !== 1 || a.revision.graderVersion !== GRADER_VERSION) throw new Error("GRADER_VERSION_UNSUPPORTED");
  const items = a.questions.map(q => {
    const r = q.item.questionRevision;
    const question = projectStudentQuestion(q.presentation as StudentQuestion);
    if (question.attemptQuestionId !== q.id || question.locale !== q.contentLocale || question.position !== q.position ||
      question.points !== q.item.points || question.type !== r.type) throw new Error("GRADING_SNAPSHOT_INVALID");
    const skills = skillsSchema.parse(r.skillSnapshot);
    if (new Set(skills.map(s => s.skillId)).size !== skills.length || skills.filter(s => s.role === "primary").length !== 1) {
      throw new Error("GRADING_SKILLS_INVALID");
    }
    const decision = gradeItem({ question, definition: r.gradingDefinition, answer: q.answer?.answer ?? null,
      schemaVersion: r.schemaVersion, graderVersion: r.graderVersion,
      hadRecordedView: q.telemetry?.firstViewedAt != null, coverage: q.telemetry?.coverage ?? "unknown" });
    return { q, skills, decision };
  });
  const score = aggregateScore(items.map(i => i.decision), a.revision.passBasisPoints);
  if (score.possiblePoints !== a.revision.totalPoints) throw new Error("GRADING_TOTAL_INVALID");
  const checksum = createHash("sha256").update(canonical({ attemptId, quizRevisionId: a.quizRevisionId,
    graderVersion: GRADER_VERSION, score, items: items.map(({ q, decision }) => ({ attemptQuestionId: q.id,
      questionRevisionId: q.item.questionRevisionId, answer: q.answer?.answer ?? null, decision })) })).digest("hex");
  const grade = await tx.attemptGrade.create({ data: { attemptId, ...score, gradedAt, graderVersion: GRADER_VERSION, checksum } });
  for (const { q, skills, decision } of items) {
    const questionGrade = await tx.attemptQuestionGrade.create({ data: {
      attemptQuestionId: q.id, attemptId, gradeId: grade.id, ...decision, finalizationReason: a.finalizationReason,
    } });
    // Observation quality remains explicit; missing telemetry is not a made-up zero duration/view.
    const timeQuality = q.telemetry?.coverage === "unknown" || !q.telemetry ? "unknown"
      : Array.isArray(q.telemetry.qualityFlags) && q.telemetry.qualityFlags.length === 0 ? q.telemetry.coverage : "partial";
    await tx.skillEvidence.createMany({ data: skills.map(skill => ({
      questionGradeId: questionGrade.id, attemptId, studentUserId: a.studentUserId, skillId: skill.skillId,
      role: skill.role, taxonomySnapshot: json(skill), responseState: decision.responseState,
      answeredCorrectly: decision.hadAcceptedAnswer ? decision.correct : null,
      hadAcceptedAnswer: decision.hadAcceptedAnswer, hadRecordedView: decision.hadRecordedView,
      coverage: decision.coverage, finalizationReason: a.finalizationReason!,
      earnedPoints: decision.earnedPoints, possiblePoints: decision.possiblePoints,
      estimatedActiveMs: timeQuality === "unknown" ? null : q.telemetry!.estimatedActiveMs,
      timeQuality, mode: a.revision.mode, evidenceVersion: EVIDENCE_VERSION, gradedAt,
    })) });
  }
  await tx.assessmentAttempt.update({ where: { id: attemptId }, data: { status: "GRADED", gradedAt } });
  await tx.auditLog.create({ data: { actorUserId: null, action: "assessment.attempt.graded",
    entityType: "assessment_attempt", entityId: attemptId, metadata: {
      quizId: a.quizId, quizRevisionId: a.quizRevisionId, attemptNumber: a.attemptNumber,
      graderVersion: GRADER_VERSION, previousStatus: a.status, nextStatus: "GRADED",
      reason: a.finalizationReason, initiator: "grade_job",
    } } });
}
