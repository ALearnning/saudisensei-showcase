import { z } from "zod";
import { projectStudentQuestion, validateAnswerForQuestion, validateGradingDefinitionForQuestion,
  type Answer, type GradingDefinition, type StudentQuestion } from "../contracts/questions.js";
import { normalizeShortText } from "../question-bank/question-bank.schemas.js";

export const GRADER_VERSION = "deterministic-v1";
export const EVIDENCE_VERSION = 1;
const coverageSchema = z.enum(["unknown", "partial", "complete"]);

function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("INVALID_GRADING_INTEGER");
  return value;
}
export function aggregateScore(items: readonly { earnedPoints: number; possiblePoints: number }[], threshold: number) {
  integer(items.length, 1, 100);
  integer(threshold, 0, 10000);
  let earnedPoints = 0, possiblePoints = 0;
  for (const item of items) {
    integer(item.possiblePoints, 1, 1000);
    integer(item.earnedPoints, 0, item.possiblePoints);
    earnedPoints = integer(earnedPoints + item.earnedPoints, 0, 100000);
    possiblePoints = integer(possiblePoints + item.possiblePoints, 1, 100000);
  }
  // Integer cross-products, never a rounded display percentage.
  const earned = integer(earnedPoints * 10000, 0, Number.MAX_SAFE_INTEGER);
  const required = integer(possiblePoints * threshold, 0, Number.MAX_SAFE_INTEGER);
  return { earnedPoints, possiblePoints, passed: earned >= required };
}

/** Revalidate persisted frozen input; incompatible versions fail closed for retry/operations. */
export function gradeItem(input: {
  schemaVersion: number; graderVersion: string; question: StudentQuestion;
  definition: unknown; answer: unknown; hadRecordedView: boolean; coverage: string;
}) {
  if (input.schemaVersion !== 1 || input.graderVersion !== GRADER_VERSION) throw new Error("GRADER_VERSION_UNSUPPORTED");
  const question = projectStudentQuestion(input.question);
  const definition = validateGradingDefinitionForQuestion(question, input.definition);
  const answer = validateAnswerForQuestion(question, input.answer);
  const coverage = coverageSchema.parse(input.coverage);
  let correct = false;
  if (answer !== null) {
    switch (definition.type) {
      case "single_choice": correct = answer.type === definition.type && answer.optionId === definition.correctOptionId; break;
      case "true_false": correct = answer.type === definition.type && answer.value === definition.correctValue; break;
      case "multiple_choice": correct = answer.type === definition.type && answer.optionIds.length === definition.correctOptionIds.length &&
        answer.optionIds.every(id => definition.correctOptionIds.includes(id)); break;
      case "ordering": correct = answer.type === definition.type && answer.orderedItemIds.length === definition.correctOrderedItemIds.length &&
        answer.orderedItemIds.every((id, index) => id === definition.correctOrderedItemIds[index]); break;
      case "short_text": correct = answer.type === definition.type && definition.acceptedByLocale[question.locale]!.some(variant =>
        normalizeShortText(variant, definition.normalizer) === normalizeShortText(answer.text, definition.normalizer)); break;
    }
  }
  const hadAcceptedAnswer = answer !== null;
  return {
    earnedPoints: correct ? question.points : 0, possiblePoints: question.points, correct,
    reasonCode: hadAcceptedAnswer ? correct ? "EXACT_MATCH" : "NO_MATCH" : "UNANSWERED",
    responseState: hadAcceptedAnswer ? correct ? "correct_answered" : "incorrect_answered"
      : input.hadRecordedView ? "unanswered_viewed" : "unanswered_unviewed",
    hadAcceptedAnswer, hadRecordedView: input.hadRecordedView, coverage,
  };
}

/** Dedicated review key projection. Short text exposes one authored example, never the private variant list or normalizer. */
export function correctAnswerPresentation(definition: GradingDefinition, locale: "ar" | "en"): Answer {
  switch (definition.type) {
    case "single_choice": return { type: definition.type, optionId: definition.correctOptionId };
    case "true_false": return { type: definition.type, value: definition.correctValue };
    case "multiple_choice": return { type: definition.type, optionIds: [...definition.correctOptionIds] };
    case "ordering": return { type: definition.type, orderedItemIds: [...definition.correctOrderedItemIds] };
    case "short_text": return { type: definition.type, text: definition.acceptedByLocale[locale]![0]! };
  }
}
