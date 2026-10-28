import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import type { Tx } from "../../courses/lms.store.js";
import { AttemptsService, policy } from "../attempts/attempts.service.js";
import type { QuizPolicy } from "../contracts/policy.js";
import { projectStudentQuestion, validateAnswerForQuestion, validateGradingDefinitionForQuestion, type StudentQuestion } from "../contracts/questions.js";
import { correctAnswerPresentation } from "./deterministic-grader.js";

export function visibilityPermits(visibility: QuizPolicy["scoreVisibility"], maxAttempts: number | null, used: number, released: boolean, hasInProgress: boolean): boolean {
  switch (visibility) {
    case "never": return false;
    case "after_grading": return true;
    case "after_attempt_limit": return maxAttempts !== null && used >= maxAttempts && !hasInProgress;
    case "manual_release": return released;
  }
}

/** readOwned already holds the Q5 enrollment write fence through commit, shared
 * with starts/resumes/submissions. Count every revision/enrollment in that same
 * serializable snapshot; an allocated but still writable final attempt is not exhaustion. */
async function releaseConditions(tx: Tx, a: { studentUserId: string; quizId: string; quizRevisionId: string }) {
  const where = { studentUserId: a.studentUserId, quizId: a.quizId };
  const used = await tx.assessmentAttempt.count({ where });
  const open = await tx.assessmentAttempt.findFirst({ where: { ...where, status: "IN_PROGRESS" }, select: { id: true } });
  const release = await tx.quizReviewRelease.findUnique({ where: { quizRevisionId: a.quizRevisionId } });
  return { used, released: !!release, hasInProgress: !!open };
}

@Injectable()
export class AssessmentResultsService {
  constructor(@Inject(AttemptsService) private readonly attempts: AttemptsService) {}

  result(req: AuthenticatedRequest, attemptId: string) {
    return this.attempts.readOwned(req, attemptId, async (tx, a) => {
      if (a.status === "IN_PROGRESS") throw new ConflictException("ATTEMPT_NOT_SUBMITTED");
      if (a.status !== "GRADED") return { attemptId: a.id, state: a.status, status: "processing" as const, processingCode: "GRADING_PENDING" as const };
      const p = policy(a.revision);
      const { used, released, hasInProgress } = await releaseConditions(tx, a);
      if (!visibilityPermits(p.scoreVisibility, p.maxAttempts, used, released, hasInProgress)) {
        return { attemptId: a.id, state: "GRADED" as const, status: "withheld" as const };
      }
      const g = await tx.attemptGrade.findUniqueOrThrow({ where: { attemptId: a.id } });
      return { attemptId: a.id, state: "GRADED" as const, status: "available" as const,
        earnedPoints: g.earnedPoints, possiblePoints: g.possiblePoints, passed: g.passed };
    });
  }

  async review(req: AuthenticatedRequest, attemptId: string) {
    const view = await this.attempts.readOwned(req, attemptId, async (tx, a) => {
      if (a.status !== "GRADED") return null;
      const p = policy(a.revision);
      const { used, released, hasInProgress } = await releaseConditions(tx, a);
      // Enforce ordering for historical immutable policies too. Item outcomes can
      // reconstruct the aggregate, so review must require score release first.
      if (!visibilityPermits(p.scoreVisibility, p.maxAttempts, used, released, hasInProgress) ||
        !visibilityPermits(p.reviewVisibility, p.maxAttempts, used, released, hasInProgress)) return null;
      const explain = visibilityPermits(p.explanationVisibility, p.maxAttempts, used, released, hasInProgress);
      // Only hydrate private keys after review authorization. Never select a live/latest revision.
      const questions = await tx.attemptQuestion.findMany({ where: { attemptId: a.id }, orderBy: { position: "asc" },
        include: { answer: true, grade: true, item: { include: { questionRevision: true } } } });
      return { attemptId: a.id, state: "GRADED" as const, questions: questions.map(q => {
        if (!q.grade) throw new Error("GRADE_MISSING");
        const question = projectStudentQuestion(q.presentation as StudentQuestion);
        const definition = validateGradingDefinitionForQuestion(question, q.item.questionRevision.gradingDefinition);
        const explanations = q.item.questionRevision.explanation as Record<string, unknown>;
        const explanation = explanations[question.locale];
        return { question, answer: validateAnswerForQuestion(question, q.answer?.answer ?? null),
          correct: q.grade.hadAcceptedAnswer ? q.grade.correct : null,
          earnedPoints: q.grade.earnedPoints, possiblePoints: q.grade.possiblePoints,
          correctAnswer: correctAnswerPresentation(definition, question.locale),
          ...(explain && typeof explanation === "string" ? { explanation } : {}) };
      }) };
    });
    // Commit any authorized lazy deadline finalization before returning the denial.
    if (view === null) throw new ConflictException("REVIEW_UNAVAILABLE");
    return view;
  }
}
