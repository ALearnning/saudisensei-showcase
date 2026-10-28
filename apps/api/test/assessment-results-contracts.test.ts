import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AssessmentResultsService } from "../src/modules/assessments/grading/results.service.js";
import { submissionReceipt } from "../src/modules/assessments/attempts/attempts.service.js";
const root = resolve(import.meta.dirname, import.meta.dirname.includes("/dist/") ? "../../../.." : "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const requireSpec = createRequire(resolve(root, "lib/api-spec/package.json"));
const { parse } = requireSpec("yaml") as { parse: (text: string) => any };
const spec = parse(read("lib/api-spec/assessment-attempts.yaml"));
const generated = () => import(pathToFileURL(resolve(root, "lib/api-zod/src/generated/api.ts")).href);
const id = "11111111-1111-4111-8111-111111111111";
const revision = { mode: "practice", required: false, passBasisPoints: 7000, maxAttempts: null, timeLimitSeconds: null,
  opensAt: null, closesAt: null, shuffleQuestions: false, shuffleOptions: false, aiAnalysisEnabled: false,
  scoreVisibility: "after_grading", reviewVisibility: "after_grading", explanationVisibility: "never" };

test("Q6 actual result DTOs match generated discriminated contracts and withheld/processing omit every outcome", async () => {
  const g = await generated();
  let gradeReads = 0;
  const a = { id, studentUserId: id, quizId: id, quizRevisionId: id, status: "SUBMITTED", revision: { ...revision } };
  const tx = { assessmentAttempt: { count: async () => 1, findFirst: async () => null }, quizReviewRelease: { findUnique: async () => null },
    attemptGrade: { findUniqueOrThrow: async () => { gradeReads++; return { earnedPoints: 2, possiblePoints: 3, passed: false,
      checksum: "PRIVATE", answer: "PRIVATE", skillSnapshot: "PRIVATE" }; } } };
  const service = new AssessmentResultsService({ readOwned: async (_req: unknown, _id: string, fn: Function) => fn(tx, a) } as never);
  const processing = await service.result({} as never, id);
  assert.equal(g.StudentAttemptResultResponse.safeParse(processing).success, true);
  assert.deepEqual(Object.keys(processing).sort(), ["attemptId", "processingCode", "state", "status"]);
  a.status = "GRADED";
  for (const visibility of ["never", "manual_release"]) {
    a.revision.scoreVisibility = visibility;
    const withheld = await service.result({} as never, id);
    assert.equal(g.StudentAttemptResultResponse.safeParse(withheld).success, true);
    assert.deepEqual(withheld, { attemptId: id, state: "GRADED", status: "withheld" });
  }
  assert.equal(gradeReads, 0);
  a.revision.scoreVisibility = "after_grading";
  const result = await service.result({} as never, id);
  assert.equal(g.StudentAttemptResultResponse.safeParse(result).success, true);
  assert.deepEqual(result, { attemptId: id, state: "GRADED", status: "available", earnedPoints: 2, possiblePoints: 3, passed: false });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|checksum|correctAnswer|explanation|skillSnapshot|job/);
  const receipt = submissionReceipt({ id, quizId: id, status: "GRADED", submittedAt: new Date(), effectiveSubmittedAt: new Date(), finalizationReason: "voluntary" } as never);
  assert.equal(receipt.processing, "ready"); assert.equal(g.StudentAttemptGetResponse.safeParse(receipt).success, true);
});
test("Q6 actual review DTO is a typed allowlist, null for unanswered and separately gated explanations", async () => {
  const g = await generated(); let release = false, reads = 0;
  const a = { id, studentUserId: id, quizId: id, quizRevisionId: id, status: "GRADED", revision: { ...revision, explanationVisibility: "manual_release" } };
  const question = { attemptQuestionId: id, type: "short_text", locale: "en", prompt: "Question", position: 0, points: 1,
    checksum: "PRIVATE", skillSnapshot: "PRIVATE", explanation: "PRIVATE" };
  const q = { presentation: question, answer: { answer: null }, grade: { hadAcceptedAnswer: false, correct: false, earnedPoints: 0, possiblePoints: 1 },
    item: { questionRevision: { gradingDefinition: { type: "short_text", normalizer: { version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false }, acceptedByLocale: { en: ["Example", "PRIVATE ALTERNATIVE"], ar: ["PRIVATE LOCALE"] } }, explanation: { en: "Explanation", ar: "PRIVATE LOCALE" }, checksum: "PRIVATE" } } };
  const tx = { assessmentAttempt: { count: async () => 1, findFirst: async () => null }, quizReviewRelease: { findUnique: async ({ where }: any) => { assert.equal(where.quizRevisionId, id); return release ? {} : null; } },
    attemptQuestion: { findMany: async () => { reads++; return [q]; } } };
  const service = new AssessmentResultsService({ readOwned: async (_req: unknown, _id: string, fn: Function) => fn(tx, a) } as never);
  const before = await service.review({} as never, id);
  assert.equal(g.StudentAttemptReviewResponse.safeParse(before).success, true);
  assert.equal(before.questions[0]!.correct, null); assert.equal("explanation" in before.questions[0]!, false);
  assert.deepEqual(before.questions[0]!.correctAnswer, { type: "short_text", text: "Example" });
  assert.doesNotMatch(JSON.stringify(before), /PRIVATE|checksum|normalizer|acceptedByLocale|skillSnapshot/);
  release = true;
  assert.equal((await service.review({} as never, id)).questions[0]!.explanation, "Explanation");
  const priorReads = reads;
  // Legacy immutable policy remains parseable, but score gating must happen
  // before any private key query, even if review itself says after_grading.
  a.revision.scoreVisibility = "never";
  await assert.rejects(() => service.review({} as never, id), /REVIEW_UNAVAILABLE/);
  assert.equal(reads, priorReads);
  a.revision.scoreVisibility = "manual_release"; release = false;
  await assert.rejects(() => service.review({} as never, id), /REVIEW_UNAVAILABLE/);
  assert.equal(reads, priorReads);
  a.revision.scoreVisibility = "after_grading"; a.revision.reviewVisibility = "never"; a.revision.explanationVisibility = "never";
  await assert.rejects(() => service.review({} as never, id), /REVIEW_UNAVAILABLE/);
  assert.equal(reads, priorReads);
});
test("Q6 schema graphs cannot reach private definitions or job/evidence fields", () => {
  const visited = new Set<string>();
  function visit(node: any, document = spec): void {
    if (!node || typeof node !== "object") return;
    for (const property of Object.keys(node.properties ?? {}))
      assert.doesNotMatch(property, /^(gradingDefinition|acceptedByLocale|normalizer|checksum|skillSnapshot|evidenceSnapshot|job|assemblyTransaction)$/);
    if (node.$ref && !visited.has(node.$ref)) {
      visited.add(node.$ref); assert.doesNotMatch(node.$ref, /Admin|GradingDefinition/);
      const [file, name] = node.$ref.split("#/components/schemas/");
      const source = file ? parse(read(`lib/api-spec/${file.replace("./", "")}`)) : document;
      assert.ok(source.components.schemas[name]); visit(source.components.schemas[name], source);
    }
    Object.values(node).forEach(value => visit(value, document));
  }
  visit(spec.components.schemas.StudentAttemptResult); visit(spec.components.schemas.StudentAttemptReview);
  const resultKeys = Object.keys(spec.components.schemas.StudentResultWithheld.properties);
  assert.deepEqual(resultKeys, ["attemptId", "state", "status"]);
  const facade = read("packages/api-client/src/index.ts");
  for (const name of ["StudentAttemptResult", "StudentAttemptReview", "StudentQuestionReview"]) assert.ok(facade.includes(name));
});
test("Q6 has no progress, telemetry collection, AI, code execution or public grading handler", () => {
  const source = ["grade-attempt.ts", "deterministic-grader.ts", "assessment-grading.service.ts", "results.service.ts", "results.controller.ts"]
    .map(name => read(`apps/api/src/modules/assessments/grading/${name}`)).join("\n");
  assert.doesNotMatch(source, /lessonCompletion\.|progressService|fetch\(|child_process|execFile|currentRevision|questionDraft|quizDraft|telemetry\.(?:create|update)|learningInsight/);
  assert.doesNotMatch(read("apps/api/src/modules/assessments/grading/results.controller.ts"), /@Post|@Put|@Patch/);
});
