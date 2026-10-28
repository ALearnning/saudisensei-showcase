import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { questionCreateSchema, questionEditSchema, questionRevisionInputSchema } from "../src/modules/assessments/question-bank/question-bank.schemas.js";
import { skillCreate, skillEdit, skillMove } from "../src/modules/assessments/skills/skill.schemas.js";
import { projectStudentQuestion } from "../src/modules/assessments/contracts/questions.js";

const root = resolve(process.cwd(), process.cwd().endsWith("/apps/api") ? "../.." : ".");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const requireSpec = createRequire(resolve(root, "lib/api-spec/package.json"));
const { parse } = requireSpec("yaml") as { parse: (source: string) => Spec };
type Schema = { $ref?: string; [key: string]: unknown };
type Operation = { operationId: string; security: { bearerAuth: never[] }[]; responses: Record<string, Schema>; requestBody?: Schema };
type Spec = {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Schema>; responses: Record<string, Schema> };
};
const spec = parse(read("lib/api-spec/question-bank.yaml"));
const operations = [
  "adminQuestionBankList", "adminQuestionBankCreate", "adminQuestionBankGet", "adminQuestionBankEdit",
  "adminQuestionBankRevisionList", "adminQuestionBankSeal", "adminQuestionBankRevisionGet", "adminQuestionBankArchive",
  "adminSkillList", "adminSkillCreate", "adminSkillGet", "adminSkillEdit", "adminSkillMove", "adminSkillArchive",
];
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const normalizer = { version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false };
function payload(type: string, locale: "ar" | "en" = "ar", bilingual = false) {
  const localized = {
    prompt: locale === "ar" ? "اختر الإجابة" : "Select an answer",
    code: { language: "java", source: "System.out.println(1);" },
    ...(["single_choice", "multiple_choice"].includes(type) ? { options: ids.slice(0, 2).map(id => ({ id, label: id === ids[0] ? "أ" : "ب" })) } : {}),
    ...(type === "ordering" ? { items: ids.slice(0, 2).map(id => ({ id, label: "عنصر" })) } : {}),
  };
  const gradingDefinition = type === "single_choice" ? { type, correctOptionId: ids[0] }
    : type === "multiple_choice" ? { type, correctOptionIds: [ids[1]] }
      : type === "true_false" ? { type, correctValue: false }
        : type === "ordering" ? { type, correctOrderedItemIds: [ids[1], ids[0]] }
          : { type, normalizer, acceptedByLocale: bilingual ? { ar: ["نعم"], en: ["yes"] } : { [locale]: [locale === "ar" ? "نعم" : "yes"] } };
  return { draft: {
    type, defaultContentLocale: locale, content: bilingual ? { ar: localized, en: localized } : { [locale]: localized },
    gradingDefinition, explanation: { [locale]: "تفسير" }, defaultPoints: 1, difficulty: "medium",
    primarySkillId: null, secondarySkillIds: [], cognitiveTags: ["concept", "code_tracing"],
  } };
}
const generated = () => import(pathToFileURL(resolve(root, "lib/api-zod/src/generated/api.ts")).href);

test("Q3 OpenAPI operations are exact Admin-only routes, registered in merge and root with explicit errors", () => {
  const found: string[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    assert.match(path, /^\/admin\/(?:question-bank\/questions|skills)(?:\/|$)/);
    assert.ok(read("lib/api-spec/openapi.yaml").includes(`/v1${path}:`), path);
    for (const [method, operation] of Object.entries(item)) {
      if (method === "parameters") continue;
      assert.ok(["get", "post", "patch"].includes(method));
      found.push(operation.operationId);
      assert.deepEqual(operation.security, [{ bearerAuth: [] }], operation.operationId);
      for (const status of ["400", "401", "403"]) assert.ok(operation.responses[status], `${operation.operationId}:${status}`);
      if (path.includes("{")) assert.ok(operation.responses["404"], operation.operationId);
      if (method === "post" || method === "patch") {
        assert.ok(operation.responses["409"], operation.operationId);
        assert.ok(operation.requestBody, operation.operationId);
      }
      assert.ok(operation.responses[method === "post" ? "201" : "200"], operation.operationId);
    }
  }
  assert.deepEqual(found.sort(), operations.slice().sort());
  assert.equal(new Set(found).size, 14);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref") {
        const [prefix, section, name] = String(value).split("/").slice(1);
        assert.equal(prefix, "components");
        assert.ok((spec.components[section as keyof Spec["components"]] as Record<string, unknown>)[name], String(value));
      } else visit(value);
    }
  };
  visit(spec);
  const config = read("lib/api-spec/orval.config.ts");
  assert.match(config, /Object\.entries\(questionBank\.paths\)/);
  for (const part of ["schemas", "parameters", "responses"]) assert.ok(config.includes(`questionBank.components.${part}`));
});

test("emitted operations, request/response types, five private definition union and optional locales exist", () => {
  const client = read("lib/api-client-react/src/generated/api.ts");
  const runtime = read("lib/api-zod/src/generated/api.ts");
  const types = read("lib/api-client-react/src/generated/api.schemas.ts");
  for (const operation of operations) {
    assert.match(client, new RegExp(`export const ${operation} = async \\(`), operation);
    const name = operation[0].toUpperCase() + operation.slice(1);
    assert.match(runtime, new RegExp(`export const ${name}Response =`), operation);
  }
  assert.match(types, /export type AdminQuestionGradingDefinition = [^;]*AdminSingleChoiceDefinition[^;]*AdminMultipleChoiceDefinition[^;]*AdminTrueFalseDefinition[^;]*AdminShortTextDefinition[^;]*AdminOrderingDefinition/);
  for (const name of ["AdminQuestionCreateInput", "AdminQuestionEditInput", "AdminQuestionDetail", "AdminQuestionRevision", "AdminQuestionSealResult", "AdminSkillCreateInput", "AdminSkillEditInput", "AdminSkillMoveInput", "AdminSkillDetail", "AdminBankError"]) {
    assert.match(types, new RegExp(`export (?:interface|type) ${name}\\b`));
    assert.ok(read("packages/api-client/src/index.ts").includes(name));
  }
  assert.match(types, /export interface AdminQuestionContent \{\s*ar\?: AdminQuestionLocalizedContent;\s*en\?: AdminQuestionLocalizedContent;/);
  assert.match(types.replace(/\/\*[\s\S]*?\*\//g, ""), /export interface AdminQuestionRevisionContent \{\s*defaultPoints: number;\s*ar\?: AdminQuestionLocalizedContent;/);
  assert.match(types, /export interface AdminQuestionRevision \{[\s\S]*?skillSnapshot: AdminQuestionSkillSnapshot\[\];[\s\S]*?checksum: string;/);
  assert.doesNotMatch(client, /adminQuestionBankValidate|\/student\/question-bank|\/assessment-attempts\/[^`]*\/(?:results|grade)/);
});

test("generated Q3 request validators accept all five actual draft shapes in Arabic, English and bilingual form", async () => {
  const g = await generated();
  for (const type of ["single_choice", "multiple_choice", "true_false", "short_text", "ordering"]) {
    for (const [locale, bilingual] of [["ar", false], ["en", false], ["ar", true]] as const) {
      const input = payload(type, locale, bilingual);
      assert.equal(questionCreateSchema.safeParse(input).success, true, `${type}:${locale}:${bilingual}`);
      assert.equal(g.AdminQuestionBankCreateBody.safeParse(input).success, true, `${type}:${locale}:${bilingual}`);
      assert.equal(g.AdminQuestionBankEditBody.safeParse({ ...input, expectedRevision: 0 }).success, true);
    }
  }
  for (const expectedRevision of [-1, 1.5, 2147483647]) {
    const input = { ...payload("true_false"), expectedRevision };
    assert.equal(questionEditSchema.safeParse(input).success, false);
    assert.equal(g.AdminQuestionBankEditBody.safeParse(input).success, false);
    assert.equal(questionRevisionInputSchema.safeParse({ expectedRevision }).success, false);
    assert.equal(g.AdminQuestionBankSealBody.safeParse({ expectedRevision }).success, false);
  }
  for (const defaultPoints of [0, 1001]) {
    const input = payload("true_false"); input.draft.defaultPoints = defaultPoints;
    assert.equal(g.AdminQuestionBankCreateBody.safeParse(input).success, false);
  }
  const invalid = payload("single_choice");
  invalid.draft.gradingDefinition = { type: "single_choice" } as typeof invalid.draft.gradingDefinition;
  assert.equal(g.AdminQuestionBankCreateBody.safeParse(invalid).success, false);
  // Cross-field membership/localization/Markdown validation remains server-side,
  // not falsely claimed to be enforced by Orval's structural Zod generation.
  const mismatched = payload("single_choice");
  mismatched.draft.gradingDefinition = { type: "single_choice", correctOptionId: ids[2] };
  assert.equal(questionCreateSchema.safeParse(mismatched).success, false);
});

test("generated private detail/revision and public list responses match the actual service DTOs", async () => {
  const g = await generated();
  const { draft } = payload("true_false");
  const summary = { id: ids[0], status: "active", editRevision: 0, currentRevisionId: null, createdAt: "2026-01-01T00:00:00.000Z" };
  const detail = { ...summary, draft };
  for (const name of ["AdminQuestionBankCreateResponse", "AdminQuestionBankGetResponse", "AdminQuestionBankEditResponse", "AdminQuestionBankArchiveResponse"]) {
    assert.equal(g[name].safeParse(detail).success, true, name);
  }
  const listItem = { ...summary, type: draft.type, difficulty: draft.difficulty,
    defaultContentLocale: draft.defaultContentLocale, locales: ["ar"], primarySkillId: null, cognitiveTags: draft.cognitiveTags };
  assert.equal(g.AdminQuestionBankListResponse.safeParse({ items: [listItem], page: 1, pageSize: 20, total: 1 }).success, true);
  const revision = {
    id: ids[1], questionId: ids[0], number: 1, type: draft.type, defaultContentLocale: draft.defaultContentLocale,
    content: { ...draft.content, defaultPoints: draft.defaultPoints }, gradingDefinition: draft.gradingDefinition,
    explanation: draft.explanation, difficulty: draft.difficulty,
    skillSnapshot: [{ skillId: ids[2], role: "primary", slug: "java", parentId: null, labels: { ar: "جافا" },
      path: [{ skillId: ids[2], slug: "java", labels: { ar: "جافا" } }], ancestorIds: [] }],
    cognitiveTags: draft.cognitiveTags, schemaVersion: 1, graderVersion: "deterministic-v1", checksum: "a".repeat(64),
    createdAt: summary.createdAt,
  };
  assert.equal(g.AdminQuestionBankRevisionGetResponse.safeParse(revision).success, true);
  assert.equal(g.AdminQuestionBankSealResponse.safeParse({ revision, editRevision: 1 }).success, true);
  const revisionSummary = { id: revision.id, questionId: revision.questionId, number: 1, type: draft.type,
    defaultContentLocale: draft.defaultContentLocale, createdAt: summary.createdAt };
  assert.equal(g.AdminQuestionBankRevisionListResponse.safeParse({ items: [revisionSummary], page: 1, pageSize: 20, total: 1 }).success, true);
  assert.equal(g.AdminQuestionBankRevisionGetResponse.safeParse({ ...revision, checksum: "not-a-sha256" }).success, false);
  assert.equal(g.AdminQuestionBankRevisionGetResponse.safeParse({ ...revision, content: draft.content }).success, false);
  assert.equal(g.AdminQuestionBankRevisionGetResponse.safeParse({ ...revision, gradingDefinition: undefined }).success, false);
});

test("Skill generated contracts preserve optional authored locales, explicit null move and bounded hierarchy", async () => {
  const g = await generated();
  for (const translations of [{ ar: { label: "جافا" } }, { en: { label: "Java", description: "" } }, { ar: { label: "جافا" }, en: { label: "Java" } }]) {
    const input = { slug: "java", translations };
    assert.equal(skillCreate.safeParse(input).success, true);
    assert.equal(g.AdminSkillCreateBody.safeParse(input).success, true);
    const edit = { expectedRevision: 0, translations };
    assert.equal(skillEdit.safeParse(edit).success, true);
    assert.equal(g.AdminSkillEditBody.safeParse(edit).success, true);
  }
  assert.equal(skillCreate.safeParse({ slug: "java", translations: {} }).success, false);
  assert.equal(skillEdit.safeParse({ expectedRevision: 0 }).success, false);
  for (const parentId of [null, ids[0]]) {
    assert.equal(skillMove.safeParse({ expectedRevision: 0, parentId }).success, true);
    assert.equal(g.AdminSkillMoveBody.safeParse({ expectedRevision: 0, parentId }).success, true);
  }
  assert.equal(g.AdminSkillMoveBody.safeParse({ expectedRevision: 0 }).success, false);
  const skill = { id: ids[2], slug: "java", parentId: null, status: "active", editRevision: 0,
    createdAt: "2026-01-01T00:00:00.000Z", translations: { ar: { label: "جافا", description: "" } } };
  for (const name of ["AdminSkillCreateResponse", "AdminSkillEditResponse", "AdminSkillMoveResponse", "AdminSkillArchiveResponse"]) {
    assert.equal(g[name].safeParse(skill).success, true, name);
  }
  assert.equal(g.AdminSkillGetResponse.safeParse({ ...skill, ancestors: Array(7).fill(skill) }).success, true);
  assert.equal(g.AdminSkillGetResponse.safeParse({ ...skill, ancestors: Array(8).fill(skill) }).success, false);
  assert.equal(g.AdminSkillListResponse.safeParse({ items: [skill], page: 1, pageSize: 20, total: 1 }).success, true);
});

test("Q2 public schema graph and nested Student projections remain separate from Admin authoring keys", async () => {
  const publicSpec = parse(read("lib/api-spec/assessments.yaml"));
  assert.deepEqual(publicSpec.paths, {});
  for (const [name, schema] of Object.entries(publicSpec.components.schemas)) {
    assert.match(name, /^Assessment/);
    assert.doesNotMatch(JSON.stringify(schema), /AdminQuestion|"(?:gradingDefinition|correctOptionIds?|acceptedByLocale|explanation|checksum)"\s*:/);
  }
  const source = {
    attemptQuestionId: ids[0], type: "single_choice" as const, locale: "ar" as const, prompt: "اختر", position: 0, points: 1,
    options: [{ id: ids[1], label: "أ", isCorrect: true }, { id: ids[2], label: "ب", correct: false }],
    gradingDefinition: { type: "single_choice", correctOptionId: ids[1] }, explanation: { ar: "خاص" }, checksum: "private",
  };
  const projected = projectStudentQuestion(source);
  assert.doesNotMatch(JSON.stringify(projected), /gradingDefinition|correctOptionId|explanation|checksum|isCorrect|"correct"/);
  const publicGenerated = await import(pathToFileURL(resolve(root, "lib/api-zod/src/assessment-contracts.ts")).href);
  const parsed = publicGenerated.AssessmentStudentQuestion.parse(source);
  assert.doesNotMatch(JSON.stringify(parsed), /gradingDefinition|correctOptionId|explanation|checksum|isCorrect|"correct"/);
});
