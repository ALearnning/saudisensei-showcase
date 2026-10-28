import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  quizCreateSchema, quizEditSchema, quizItemsSchema, quizPreviewSchema, quizMutationSchema,
  quizReleaseSchema, quizPolicyInputSchema, quizScopeSchema, quizListSchema,
} from "../src/modules/assessments/quizzes/quizzes.schemas.js";
import { QuizzesService } from "../src/modules/assessments/quizzes/quizzes.service.js";

const root = resolve(process.cwd(), process.cwd().endsWith("/apps/api") ? "../.." : ".");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const requireSpec = createRequire(resolve(root, "lib/api-spec/package.json"));
type SpecNode = { [key: string]: any };
const { parse } = requireSpec("yaml") as { parse: (source: string) => SpecNode };
const spec = parse(read("lib/api-spec/quiz-composition.yaml"));
const operations = [
  "adminQuizList", "adminQuizCreate", "adminQuizGet", "adminQuizEdit", "adminQuizReplaceItems",
  "adminQuizPreview", "adminQuizAnswerPreview", "adminQuizPublish", "adminQuizUnpublish",
  "adminQuizArchive", "adminQuizRevisionList", "adminQuizRevisionGet", "adminQuizReviewRelease",
];
const generated = () => import(pathToFileURL(resolve(root, "lib/api-zod/src/generated/api.ts")).href);
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
function draft(locale: "ar" | "en" = "ar", bilingual = false, mode: "practice" | "graded" = "practice") {
  const text = { title: locale === "ar" ? "اختبار" : "Quiz", instructions: "Read carefully" };
  return { defaultContentLocale: locale, content: bilingual ? { ar: text, en: text } : { [locale]: text }, policy: { mode } };
}

test("Q4 exact Admin-only operations, closed scopes, errors, references and root merge", () => {
  const found: string[] = [];
  for (const [path, item] of Object.entries(spec.paths) as [string, SpecNode][]) {
    assert.match(path, /^\/admin\/\{scope\}\/\{parentId\}\/quizzes(?:\/|$)/);
    assert.ok(read("lib/api-spec/openapi.yaml").includes(`/v1${path}:`), path);
    for (const [method, operation] of Object.entries(item) as [string, SpecNode][]) {
      if (method === "parameters") continue;
      found.push(operation.operationId);
      assert.ok(["get", "post", "patch", "put"].includes(method));
      assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
      for (const status of ["400", "401", "403", "404"]) assert.ok(operation.responses[status], `${operation.operationId}:${status}`);
      assert.ok(operation.responses[method === "post" ? "201" : "200"]);
      if (method !== "get") {
        assert.ok(operation.responses["409"], operation.operationId);
        assert.ok(operation.requestBody?.required, operation.operationId);
      }
    }
  }
  assert.deepEqual(found.sort(), operations.slice().sort());
  assert.equal(new Set(found).size, 13);
  assert.deepEqual(spec.components.parameters.AdminQuizScope.schema.enum, ["courses", "chapters", "lessons"]);
  const config = read("lib/api-spec/orval.config.ts");
  assert.match(config, /Object\.entries\(quizzes\.paths\)/);
  for (const part of ["schemas", "parameters", "responses"]) assert.ok(config.includes(`quizzes.components.${part}`));
  const components: SpecNode = {};
  for (const name of ["openapi", "lms", "media", "media-library", "media-processing", "media-renditions", "assessments", "question-bank", "quiz-composition"]) {
    const fragment = parse(read(`lib/api-spec/${name}.yaml`));
    for (const [section, entries] of Object.entries(fragment.components ?? {})) {
      components[section] = { ...components[section], ...(entries as SpecNode) };
    }
  }
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref") {
        const [file, pointer] = String(value).split("#/components/");
        const [section, name] = pointer.split("/");
        const target = file ? parse(read(`lib/api-spec/${file.replace("./", "")}`)).components : components;
        assert.ok(target[section]?.[name], String(value));
      } else visit(value);
    }
  }
  visit(spec);
});

test("emitted Q4 SDK operations and all existing Q1-Q3 operations are preserved", () => {
  const client = read("lib/api-client-react/src/generated/api.ts");
  const runtime = read("lib/api-zod/src/generated/api.ts");
  const types = read("lib/api-client-react/src/generated/api.schemas.ts");
  const existing: string[] = [];
  for (const fragment of ["openapi", "lms", "media", "media-library", "media-processing", "media-renditions", "question-bank"]) {
    for (const item of Object.values(parse(read(`lib/api-spec/${fragment}.yaml`)).paths) as SpecNode[]) {
      for (const operation of Object.values(item) as SpecNode[]) {
        if (operation && typeof operation === "object" && operation.operationId) existing.push(operation.operationId);
      }
    }
  }
  for (const operation of [...existing, ...operations]) {
    assert.match(client, new RegExp(`export const ${operation} = async \\(`), operation);
    const name = operation[0].toUpperCase() + operation.slice(1);
    assert.match(runtime, new RegExp(`export const ${name}Response =`), operation);
  }
  assert.ok(existing.length > 80);
  for (const name of [
    "AdminQuizCreateInput", "AdminQuizEditInput", "AdminQuizItemsInput", "AdminQuizPreviewInput",
    "AdminQuizMutationInput", "AdminQuizReleaseInput", "AdminQuizDetail", "AdminQuizPage",
    "AdminQuizSafePreview", "AdminQuizAnswerPreview", "AdminQuizPublishResult", "AdminQuizRevision",
    "AdminQuizRevisionPage", "AdminQuizReviewRelease", "AdminQuizPolicyInput",
  ]) {
    assert.match(types, new RegExp(`export (?:interface|type) ${name}\\b`));
    assert.ok(read("packages/api-client/src/index.ts").includes(name), name);
  }
  assert.doesNotMatch(client, /\/assessment-attempts\/[^`]*\/(?:results|grade)|\/student\/quizzes/);
});

test("Q4 emitted request schemas accept actual localized drafts, exact revision items and release input", async () => {
  const g = await generated();
  for (const mode of ["practice", "graded"] as const) {
    for (const [locale, bilingual] of [["ar", false], ["en", false], ["ar", true]] as const) {
      const input = { draft: draft(locale, bilingual, mode) };
      assert.equal(quizCreateSchema.safeParse(input).success, true);
      assert.equal(g.AdminQuizCreateBody.safeParse(input).success, true);
      assert.equal(g.AdminQuizEditBody.safeParse({ ...input, expectedRevision: 0 }).success, true);
    }
  }
  const items = { expectedRevision: 1, items: [{ questionId: ids[0], questionRevisionId: ids[1], position: 0, points: 1000 }] };
  assert.equal(quizItemsSchema.safeParse(items).success, true);
  assert.equal(g.AdminQuizReplaceItemsBody.safeParse(items).success, true);
  for (const points of [0, 1001]) {
    const invalid = { ...items, items: [{ ...items.items[0], points }] };
    assert.equal(quizItemsSchema.safeParse(invalid).success, false);
    assert.equal(g.AdminQuizReplaceItemsBody.safeParse(invalid).success, false);
  }
  assert.equal(g.AdminQuizReplaceItemsBody.safeParse({ expectedRevision: 0, items: Array(101).fill(items.items[0]) }).success, false);
  for (const expectedRevision of [-1, 1.5, 2147483647]) {
    assert.equal(quizEditSchema.safeParse({ expectedRevision, draft: draft() }).success, false);
    assert.equal(g.AdminQuizEditBody.safeParse({ expectedRevision, draft: draft() }).success, false);
    assert.equal(quizMutationSchema.safeParse({ expectedRevision }).success, false);
    assert.equal(g.AdminQuizPublishBody.safeParse({ expectedRevision }).success, false);
  }
  const preview = { expectedRevision: 0, locale: "ar" };
  assert.equal(quizPreviewSchema.safeParse(preview).success, true);
  assert.equal(g.AdminQuizPreviewBody.safeParse(preview).success, true);
  assert.equal(g.AdminQuizAnswerPreviewBody.safeParse(preview).success, true);
  assert.equal(quizReleaseSchema.safeParse({ clientMutationId: ids[0] }).success, true);
  assert.equal(g.AdminQuizReviewReleaseBody.safeParse({ clientMutationId: ids[0] }).success, true);
  assert.equal(g.AdminQuizReviewReleaseBody.safeParse({ clientMutationId: "bad" }).success, false);
  assert.equal(quizScopeSchema.safeParse("students").success, false);
  for (const scope of ["courses", "chapters", "lessons"]) {
    assert.equal(g.AdminQuizListParams.safeParse({ scope, parentId: ids[0] }).success, true);
  }
  assert.equal(g.AdminQuizListParams.safeParse({ scope: "students", parentId: ids[0] }).success, false);
});

test("Q4 server policy enforces defaults and cross-field rules beyond structural generation", () => {
  for (const mode of ["practice", "graded"] as const) {
    const p = quizPolicyInputSchema.parse({ mode });
    assert.equal(p.required, false); assert.equal(p.timeLimitSeconds, null);
    assert.equal(p.passBasisPoints, 7000); assert.equal(p.maxAttempts, mode === "practice" ? null : 1);
    assert.equal(p.shuffleQuestions, false); assert.equal(p.shuffleOptions, false); assert.equal(p.aiAnalysisEnabled, false);
  }
  for (const policy of [
    { mode: "practice", scoreVisibility: "after_attempt_limit" },
    { mode: "graded", opensAt: "2028-01-02T00:00:00.000Z", closesAt: "2028-01-01T00:00:00.000Z" },
    { mode: "graded", reviewVisibility: "manual_release", explanationVisibility: "after_grading" },
  ]) assert.equal(quizPolicyInputSchema.safeParse(policy).success, false);
  const duplicate = { expectedRevision: 0, items: [0, 1].map(position => ({ questionId: ids[0], questionRevisionId: ids[1], position })) };
  assert.equal(quizItemsSchema.safeParse(duplicate).success, false);
  assert.equal(quizCreateSchema.safeParse({ draft: { ...draft("ar"), content: { en: { title: "Quiz", instructions: "" } } } }).success, false);
  assert.equal(quizListSchema.safeParse({ status: "draft", mode: "graded", required: "false", locale: "ar" }).success, true);
});

test("actual Q4 service DTOs match emitted responses and safe preview never carries private answers", async () => {
  const g = await generated();
  const now = new Date("2028-01-01T00:00:00.000Z");
  const policy = quizPolicyInputSchema.parse({ mode: "practice" });
  const authored = draft("ar");
  const item = { id: ids[1], questionId: ids[0], questionRevisionId: ids[1], position: 0, points: 4 };
  const q = {
    id: ids[0], courseId: ids[1], parentType: "course", parentId: ids[1], chapterId: null, lessonId: null,
    status: "published", editRevision: 2, currentRevisionId: ids[1], createdAt: now,
    draft: { ...authored, policy, schemaVersion: 1, items: [item] },
  };
  const question = {
    id: ids[1], questionId: ids[0], type: "true_false", defaultContentLocale: "ar",
    content: { defaultPoints: 2, ar: { prompt: "هل هذا صحيح؟" } },
    gradingDefinition: { type: "true_false", correctValue: true },
    explanation: { ar: "تفسير خاص" }, difficulty: "medium", cognitiveTags: ["concept"],
    skillSnapshot: [{ skillId: ids[0], role: "primary", path: [{ skillId: ids[0] }] }],
    schemaVersion: 1, graderVersion: "deterministic-v1",
  };
  const { version: _version, opensAt: _opensAt, closesAt: _closesAt, ...frozenPolicy } = policy;
  const publication = {
    id: ids[1], quizId: ids[0], courseId: ids[1], number: 1, ...frozenPolicy,
    opensAt: null, closesAt: null, defaultContentLocale: "ar", content: authored.content,
    totalPoints: 4, schemaVersion: 1, graderVersion: "deterministic-v1", createdAt: now,
    items: [item], reviewRelease: null, assemblyTransaction: 123n,
  };
  // Read-only fixture port: any unexpected model access/write throws. It
  // intentionally offers no attempts, grades, evidence or progress delegates.
  const tx = {
    quiz: { findFirst: async () => q, findMany: async () => [q], count: async () => 1 },
    questionRevision: { findMany: async () => [question] },
    quizRevision: { findFirst: async () => publication },
  };
  const service = new QuizzesService({ transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
    { admin: async () => ({ courseId: ids[1], chapterId: null, lessonId: null }) } as never);
  const req = {} as never;
  const detail = await service.get(req, "courses", ids[1], ids[0]);
  assert.equal(g.AdminQuizGetResponse.safeParse(detail).success, true);
  const page = await service.list(req, "courses", ids[1], {});
  assert.equal(g.AdminQuizListResponse.safeParse(page).success, true);
  const preview = await service.preview(req, "courses", ids[1], ids[0], { expectedRevision: 2, locale: "en" });
  assert.equal(g.AdminQuizPreviewResponse.safeParse(preview).success, true);
  assert.equal(preview.requestedLocale, "en"); assert.equal(preview.locale, "ar");
  assert.equal(preview.questions[0].locale, "ar"); assert.equal(preview.questions[0].points, 4);
  assert.doesNotMatch(JSON.stringify(preview), /"gradingDefinition"|"correctValue"|"explanation"|"skillSnapshot"|"checksum"|"assemblyTransaction"/);
  const answers = await service.answerPreview(req, "courses", ids[1], ids[0], { expectedRevision: 2, locale: "en" });
  assert.equal(g.AdminQuizAnswerPreviewResponse.safeParse(answers).success, true);
  assert.deepEqual(answers.questions[0].gradingDefinition, { type: "true_false", correctValue: true });
  assert.equal(answers.questions[0].explanation, "تفسير خاص");
  const revision = await service.revision(req, "courses", ids[1], ids[0], ids[1]);
  assert.equal(g.AdminQuizRevisionGetResponse.safeParse(revision).success, true);
  assert.equal(g.AdminQuizPublishResponse.safeParse({ revision, editRevision: 3 }).success, true);
  assert.doesNotMatch(JSON.stringify(revision), /assemblyTransaction|gradingDefinition|correctValue|evidenceSnapshot/);
  assert.equal(g.AdminQuizReviewReleaseResponse.safeParse({ quizRevisionId: ids[1], releasedAt: now.toISOString() }).success, true);
});

test("safe Q4 preview OpenAPI schema graph cannot reference private grading definitions", () => {
  const visited = new Set<string>();
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const object = node as SpecNode;
    if (object.properties) {
      for (const key of Object.keys(object.properties)) {
        assert.doesNotMatch(key, /^(gradingDefinition|correct.*|explanation|explanations|evidenceSnapshot|skillSnapshot|checksum)$/i);
      }
    }
    if (object.$ref && !visited.has(object.$ref)) {
      visited.add(object.$ref);
      const [file, pointer] = object.$ref.split("#/components/schemas/");
      const source = file ? parse(read(`lib/api-spec/${file.replace("./", "")}`)) : spec;
      visit(source.components.schemas[pointer]);
    }
    for (const value of Object.values(object)) visit(value);
  }
  visit(spec.components.schemas.AdminQuizSafePreview);
  assert.ok(visited.has("#/components/schemas/AdminQuizPreviewQuestion"));
  assert.equal([...visited].some(ref => ref.includes("GradingDefinition")), false);
});
