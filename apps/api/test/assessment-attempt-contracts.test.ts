import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { startSchema, saveSchema, submitSchema, flagSchema, listSchema } from "../src/modules/assessments/attempts/attempts.schemas.js";
import { attemptView, submissionReceipt, AttemptsService } from "../src/modules/assessments/attempts/attempts.service.js";

const root = resolve(process.cwd(), process.cwd().endsWith("/apps/api") ? "../.." : ".");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const requireSpec = createRequire(resolve(root, "lib/api-spec/package.json"));
type Node = { [key: string]: any };
const { parse } = requireSpec("yaml") as { parse: (source: string) => Node };
const spec = parse(read("lib/api-spec/assessment-attempts.yaml"));
const generated = () => import(pathToFileURL(resolve(root, "lib/api-zod/src/generated/api.ts")).href);
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const operations: Record<string, [string, string]> = {
  studentQuizList: ["get", "/{scope}/{parentId}/quizzes"],
  studentQuizGet: ["get", "/{scope}/{parentId}/quizzes/{quizId}"],
  studentAttemptStart: ["post", "/{scope}/{parentId}/quizzes/{quizId}/attempts"],
  studentAttemptHistory: ["get", "/me/assessment-attempts"],
  studentAttemptGet: ["get", "/me/assessment-attempts/{attemptId}"],
  studentAttemptSaveAnswers: ["put", "/me/assessment-attempts/{attemptId}/answers"],
  studentAttemptSetFlag: ["put", "/me/assessment-attempts/{attemptId}/questions/{questionId}/flag"],
  studentAttemptSubmit: ["post", "/me/assessment-attempts/{attemptId}/submit"],
  studentAttemptResult: ["get", "/me/assessment-attempts/{attemptId}/result"],
  studentAttemptReview: ["get", "/me/assessment-attempts/{attemptId}/review"],
};

test("Q5 exact Student operations, generated paths, safe errors and closed scopes", async () => {
  const client = await import(pathToFileURL(resolve(root, "lib/api-client-react/src/generated/api.ts")).href);
  const runtime = read("lib/api-zod/src/generated/api.ts");
  const found: string[] = [];
  for (const [path, entry] of Object.entries(spec.paths) as [string, Node][]) {
    assert.ok(read("lib/api-spec/openapi.yaml").includes(`/v1${path}:`));
    for (const [method, operation] of Object.entries(entry) as [string, Node][]) {
      if (method === "parameters") continue;
      found.push(operation.operationId);
      assert.deepEqual(operations[operation.operationId], [method, path]);
      assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
      for (const status of ["400", "401", "403", "404", "429"]) assert.ok(operation.responses[status], `${operation.operationId}:${status}`);
      if (method !== "get") assert.ok(operation.responses["409"]);
      const capitalized = operation.operationId[0].toUpperCase() + operation.operationId.slice(1);
      assert.match(runtime, new RegExp(`export const ${capitalized}Response =`));
      assert.equal(typeof client[operation.operationId], "function");
      const urlArgs = path.includes("{scope}") ? ["courses", id, ...(path.includes("{quizId}") ? [other] : [])] :
        path.includes("{questionId}") ? [id, other] : path.includes("{attemptId}") ? [id] : [];
      const url = client[`get${capitalized}Url`](...urlArgs);
      assert.equal(url, `/api/v1${path.replace("{scope}", "courses").replace("{parentId}", id).replace("{quizId}", other).replace("{attemptId}", id).replace("{questionId}", other)}`);
    }
  }
  assert.deepEqual(found.sort(), Object.keys(operations).sort());
  assert.deepEqual(spec.components.parameters.StudentAssessmentScope.schema.enum, ["courses", "chapters", "lessons"]);
  const g = await generated();
  for (const scope of ["courses", "chapters", "lessons"]) assert.equal(g.StudentQuizListParams.safeParse({ scope, parentId: id }).success, true);
  assert.equal(g.StudentQuizListParams.safeParse({ scope: "students", parentId: id }).success, false);
  assert.doesNotMatch(read("lib/api-client-react/src/generated/api.ts"), /\/assessment-attempts\/[^`]*\/(?:results|grade)/);
});

test("Q5 emitted request validators match actual bounded server schemas for all five answers and clear", async () => {
  const g = await generated();
  const start = { clientMutationId: id, requestedContentLocale: "en" };
  assert.equal(startSchema.safeParse(start).success, true);
  assert.equal(g.StudentAttemptStartBody.safeParse(start).success, true);
  for (const answer of [
    { type: "single_choice", optionId: "opaque-a" }, { type: "multiple_choice", optionIds: ["opaque-a", "opaque-b"] },
    { type: "true_false", value: false }, { type: "short_text", text: "إجابة" },
    { type: "ordering", orderedItemIds: ["opaque-b", "opaque-a"] }, null,
  ]) {
    const body = { clientMutationId: id, changes: [{ attemptQuestionId: other, expectedAnswerRevision: 0, answer }] };
    assert.equal(saveSchema.safeParse(body).success, true);
    assert.equal(g.StudentAttemptSaveAnswersBody.safeParse(body).success, true);
    assert.equal(submitSchema.safeParse(body).success, true);
    assert.equal(g.StudentAttemptSubmitBody.safeParse(body).success, true);
  }
  for (const changes of [[], Array.from({ length: 11 }, () => ({ attemptQuestionId: other, expectedAnswerRevision: 0, answer: null }))]) {
    const body = { clientMutationId: id, changes };
    assert.equal(saveSchema.safeParse(body).success, false);
    assert.equal(g.StudentAttemptSaveAnswersBody.safeParse(body).success, false);
  }
  const invalidAnswers = [
    { type: "short_text", text: "x".repeat(2001) },
    { type: "multiple_choice", optionIds: [] }, { type: "ordering", orderedItemIds: ["one"] },
    { type: "true_false", value: "true" }, { type: "single_choice", optionId: "" },
  ];
  for (const answer of invalidAnswers) {
    const body = { clientMutationId: id, changes: [{ attemptQuestionId: other, expectedAnswerRevision: 0, answer }] };
    assert.equal(saveSchema.safeParse(body).success, false);
    assert.equal(g.StudentAttemptSaveAnswersBody.safeParse(body).success, false);
  }
  for (const key of ["userId", "enrollmentId", "quizRevisionId", "deadlineAt", "attemptNumber", "score"]) {
    assert.equal(startSchema.safeParse({ ...start, [key]: id }).success, false);
  }
  assert.equal(submitSchema.safeParse({ clientMutationId: id }).success, true);
  assert.equal(g.StudentAttemptSubmitBody.safeParse({ clientMutationId: id }).success, true);
  const flag = { clientMutationId: id, expectedFlagRevision: 0, isFlagged: true };
  assert.equal(flagSchema.safeParse(flag).success, true);
  assert.equal(g.StudentAttemptSetFlagBody.safeParse(flag).success, true);
  assert.equal(flagSchema.safeParse({ ...flag, expectedAnswerRevision: 0 }).success, false);
  assert.equal(g.StudentAttemptSetFlagBody.safeParse({ ...flag, expectedFlagRevision: -1 }).success, false);
  assert.equal(listSchema.safeParse({ locale: "en", pageSize: "50", cursor: id }).success, true);
  assert.equal(listSchema.safeParse({ pageSize: "51" }).success, false);
});

test("Q5 Student schema graphs explicitly whitelist DTOs and never reach private grading/Admin definitions", () => {
  const visited = new Set<string>();
  function visit(node: unknown, document: Node = spec, filename = "assessment-attempts.yaml"): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(value => visit(value, document, filename)); return; }
    const value = node as Node;
    for (const name of Object.keys(value.properties ?? {})) {
      assert.doesNotMatch(name, /^(correct.*|gradingDefinition|explanations?|private.*|checksum|skillSnapshot|evidenceSnapshot|score|grade)$/i);
    }
    const reference = `${filename}:${value.$ref}`;
    if (value.$ref && !visited.has(reference)) {
      assert.doesNotMatch(value.$ref, /Admin|GradingDefinition|EvidenceContext/);
      visited.add(reference);
      const [file, pointer] = value.$ref.split("#/components/schemas/");
      const source = file ? parse(read(`lib/api-spec/${file.replace("./", "")}`)) : document;
      assert.ok(source.components.schemas[pointer], value.$ref);
      visit(source.components.schemas[pointer], source, file || filename);
    }
    Object.values(value).forEach(node => visit(node, document, filename));
  }
  for (const schema of ["StudentQuiz", "StudentQuizPage", "StudentStartReceipt", "StudentAttemptView", "StudentAttemptPage", "StudentSaveReceipt", "StudentFlagReceipt", "StudentSubmissionReceipt"]) {
    assert.ok(spec.components.schemas[schema], schema);
    visit(spec.components.schemas[schema]);
  }
  for (const [name, schema] of Object.entries(spec.components.schemas) as [string, Node][]) {
    if (schema.type === "object") assert.equal(schema.additionalProperties, false, name);
  }
});

test("actual Q5 presentation, discovery, history and mutation DTOs validate against emitted responses", async () => {
  const g = await generated();
  const now = new Date("2028-01-01T00:00:00.000Z");
  const revision = {
    id: other, quizId: id, defaultContentLocale: "ar",
    content: { ar: { title: "اختبار", instructions: "اقرأ بعناية" } },
    mode: "practice", required: false, passBasisPoints: 7000, maxAttempts: null,
    timeLimitSeconds: null, opensAt: null, closesAt: null, shuffleQuestions: false, shuffleOptions: false,
    scoreVisibility: "after_grading", reviewVisibility: "never", explanationVisibility: "never", aiAnalysisEnabled: false,
    // These private upstream fields are deliberately hostile to projection.
    checksum: "private", gradingDefinition: { correctValue: true },
  };
  const presentation = {
    attemptQuestionId: other, type: "true_false", locale: "ar", prompt: "هل هذا صحيح؟", position: 0, points: 2,
    gradingDefinition: { correctValue: true }, explanation: "خاص", checksum: "private",
  };
  const a = {
    id, quizId: id, quizRevisionId: other, status: "IN_PROGRESS",
    attemptNumber: 1, selectedContentLocale: "ar", startedAt: now, deadlineAt: null,
    deadlineReason: null, opensAt: null, closesAt: null, timeLimitSeconds: null,
    submittedAt: null, effectiveSubmittedAt: null, finalizationReason: null, revision,
    questions: [{ id: other, presentation, answer: { answerRevision: 0, answer: null, changeCount: 0, firstAnsweredAt: null },
      state: { isFlagged: false, flagRevision: 0 } }],
  };
  const active = attemptView(a as never, now);
  assert.equal(g.StudentAttemptGetResponse.safeParse(active).success, true);
  assert.equal(g.StudentAttemptStartResponse.safeParse({ attemptId: id }).success, true);
  assert.deepEqual(Object.keys(spec.components.schemas.StudentStartReceipt.properties), ["attemptId"]);
  assert.equal("questions" in active, true);
  assert.doesNotMatch(JSON.stringify(active), /"correctValue"|"gradingDefinition"|"explanation"|"checksum"/);
  for (const status of ["SUBMITTED", "AUTO_SUBMITTED"] as const) {
    const finalized = { ...a, status, submittedAt: now, effectiveSubmittedAt: now,
      finalizationReason: status === "SUBMITTED" ? "voluntary" : "time_limit" };
    const view = attemptView(finalized as never, now);
    assert.deepEqual(view, submissionReceipt(finalized as never));
    assert.equal(g.StudentAttemptGetResponse.safeParse(view).success, true);
    assert.equal(g.StudentAttemptSubmitResponse.safeParse(view).success, true);
    assert.equal("questions" in view, false);
    assert.equal("answers" in view, false);
    assert.equal("flags" in view, false);
    assert.equal(g.StudentAttemptGetResponse.safeParse({ ...active, state: status }).success, false);
  }
  const q = { quiz: { id, courseId: other, parentType: "course", parentId: other },
    revision, ctx: { userId: id, enrollmentId: other } };
  // Narrow DTO fixture ports. Authorization/locking is covered by engine tests;
  // this invokes actual service projection/mutation code, not a parallel DTO copy.
  const receipts = new Map<string, { payloadHash: string; receipt: unknown }>();
  const tx = {
    assessmentAttempt: { count: async () => 1, findFirst: async () => ({ id, deadlineAt: null }), findMany: async () => [a] },
    quiz: { findMany: async () => [{ id }] },
    user: { findUnique: async () => ({ status: "active", roles: [{ role: { name: "student" } }] }) },
    assessmentMutation: {
      findUnique: async ({ where }: any) => receipts.get(where.actorId_operationScope_clientMutationId.operationScope) ?? null,
      create: async ({ data }: any) => { receipts.set(data.operationScope, { payloadHash: data.payloadHash, receipt: data.receipt }); return data; },
    },
    attemptAnswer: { update: async () => ({}) }, attemptQuestionState: { update: async () => ({}) },
  };
  const service = new AttemptsService({ transaction: async (work: (value: unknown) => unknown) => work(tx) } as never, {} as never);
  const internal = service as any;
  internal.clock = async () => now;
  internal.quizLock = async () => q;
  internal.context = async () => ({ courseId: other });
  internal.enrollmentNow = async () => {};
  internal.lock = async () => a;
  internal.owned = async () => ({ a, now });
  internal.finalize = async (_tx: unknown, input: unknown) => input;
  const req = { user: { id } } as never;
  const startBody = { clientMutationId: id, requestedContentLocale: "ar" };
  const started = await service.start(req, "courses", other, id, startBody);
  assert.deepEqual(started, { attemptId: id });
  assert.equal(g.StudentAttemptStartResponse.safeParse(started).success, true);
  // A replay must return its original small receipt even when current state is
  // finalized; mutable/current state belongs exclusively to the resume route.
  internal.lock = async () => ({ ...a, status: "AUTO_SUBMITTED", submittedAt: now, effectiveSubmittedAt: now, finalizationReason: "time_limit" });
  assert.deepEqual(await service.start(req, "courses", other, id, startBody), started);
  internal.lock = async () => a;
  const detail = await service.quiz(req, "courses", other, id, { locale: "en" });
  assert.equal(g.StudentQuizGetResponse.safeParse(detail).success, true);
  assert.equal(detail.locale, "ar");
  assert.equal(detail.resumableAttemptId, id);
  assert.equal(g.StudentQuizListResponse.safeParse(await service.listQuizzes(req, "courses", other, {})).success, true);
  assert.equal(g.StudentAttemptHistoryResponse.safeParse(await service.history(req, {})).success, true);
  assert.doesNotMatch(JSON.stringify(detail), /"questions"|"correctValue"|"gradingDefinition"|"explanation"|"checksum"/);

  // Persisted engine presentation is already whitelisted; the hostile upstream
  // fields above solely exercise the read projection.
  a.questions[0].presentation = ("questions" in active ? active.questions[0] : {}) as typeof presentation;
  internal.interactive = async (_req: unknown, _id: string, work: (value: unknown, attempt: unknown, time: Date) => unknown) => work(tx, a, now);
  const saved = await service.save(req, id, { clientMutationId: id,
    changes: [{ attemptQuestionId: other, expectedAnswerRevision: 0, answer: { type: "true_false", value: false } }] });
  assert.equal(g.StudentAttemptSaveAnswersResponse.safeParse(saved).success, true);
  const flag = await service.flag(req, id, other, { clientMutationId: id, expectedFlagRevision: 0, isFlagged: true });
  assert.equal(g.StudentAttemptSetFlagResponse.safeParse(flag).success, true);
  internal.finalize = async () => ({ ...a, status: "SUBMITTED", submittedAt: now, effectiveSubmittedAt: now, finalizationReason: "voluntary" });
  const submitted = await service.submit(req, id, { clientMutationId: id });
  assert.equal(g.StudentAttemptSubmitResponse.safeParse(submitted).success, true);
  for (const receipt of [saved, flag, submitted]) assert.doesNotMatch(JSON.stringify(receipt), /"correctValue"|"gradingDefinition"|"score"|"grade"|"explanation"/);
});
