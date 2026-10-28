import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { questionDraftSchema, normalizeShortText, questionCreateSchema, questionEditSchema, questionListSchema } from "../src/modules/assessments/question-bank/question-bank.schemas.js";
import { projectStudentQuestion, studentQuestionSchema } from "../src/modules/assessments/contracts/questions.js";
import type { GradingDefinition } from "../src/modules/assessments/contracts/questions.js";

const ids = [randomUUID(), randomUUID()];
const labels = ids.map((id, n) => ({ id, label: `خيار ${n}` }));
const normalizer = { version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false } as const;
function draft(type: GradingDefinition["type"] = "true_false") {
  const definitions: Record<GradingDefinition["type"], GradingDefinition> = {
    true_false: { type: "true_false", correctValue: false },
    single_choice: { type: "single_choice", correctOptionId: ids[0]! },
    multiple_choice: { type: "multiple_choice", correctOptionIds: ids },
    ordering: { type: "ordering", correctOrderedItemIds: ids.slice().reverse() },
    short_text: { type: "short_text", normalizer, acceptedByLocale: { ar: ["أهلاً"] } },
  };
  return {
    type, defaultContentLocale: "ar" as const, content: { ar: {
      prompt: "ما الناتج؟", code: { language: "java" as const, source: 'System.out.println("مرحبا");' },
      ...(type.includes("choice") ? { options: labels } : {}),
      ...(type === "ordering" ? { items: labels } : {}),
    } },
    gradingDefinition: definitions[type], explanation: { ar: "توضيح **مهم**" },
    defaultPoints: 1, difficulty: "easy" as const, primarySkillId: null,
    secondarySkillIds: [] as string[], cognitiveTags: ["concept"] as const,
  };
}
const valid = (v: unknown) => assert.equal(questionDraftSchema.safeParse(v).success, true);
const invalid = (v: unknown) => assert.equal(questionDraftSchema.safeParse(v).success, false);

test("all five types: Arabic, English, and complete bilingual authoring", () => {
  for (const type of ["true_false", "single_choice", "multiple_choice", "short_text", "ordering"] as const) {
    const d = draft(type);
    valid(d);
    const gradingDefinition = type === "short_text" ? { type, normalizer, acceptedByLocale: { en: ["answer"] } } : d.gradingDefinition;
    valid({ ...d, defaultContentLocale: "en", content: { en: d.content.ar }, explanation: { en: "Explanation" }, gradingDefinition });
    valid({ ...d, content: { ...d.content, en: d.content.ar },
      gradingDefinition: type === "short_text" ? { type, normalizer, acceptedByLocale: { ar: ["أهلاً"], en: ["answer"] } } : d.gradingDefinition });
  }
});
test("strict private definitions reject mismatch, unknown/duplicate IDs and partial ordering", () => {
  for (const type of ["single_choice", "multiple_choice", "ordering"] as const) {
    const d = draft(type);
    invalid({ ...d, gradingDefinition: { type: "true_false", correctValue: false } });
    invalid({ ...d, gradingDefinition: { ...d.gradingDefinition, script: "execute" } });
    const field = type === "ordering" ? "items" : "options";
    invalid({ ...d, content: { ar: { ...d.content.ar, [field]: [labels[0], labels[0]] } } });
    invalid({ ...d, content: { ar: { ...d.content.ar, [field]: labels.map(l => ({ ...l, id: "correct" })) } } });
    invalid({ ...d, content: { ar: { ...d.content.ar, [field]: undefined } } });
  }
  invalid({ ...draft("single_choice"), gradingDefinition: { type: "single_choice", correctOptionId: randomUUID() } });
  for (const optionIds of [[], [ids[0], ids[0]], [randomUUID()]]) {
    invalid({ ...draft("multiple_choice"), gradingDefinition: { type: "multiple_choice", correctOptionIds: optionIds } });
  }
  for (const itemIds of [[ids[0]], [ids[0], ids[0]], [ids[0], randomUUID()]]) {
    invalid({ ...draft("ordering"), gradingDefinition: { type: "ordering", correctOrderedItemIds: itemIds } });
  }
  invalid({ ...draft(), gradingDefinition: { type: "true_false", correctValue: "false" } });
  invalid({ ...draft(), content: { ar: { prompt: "x", options: labels } } });
});
test("locale completeness, skill assignment, tags and strict mutation shapes", () => {
  const d = draft("single_choice");
  invalid({ ...d, defaultContentLocale: "en" });
  invalid({ ...d, content: {} });
  invalid({ ...d, content: { ...d.content, fr: d.content.ar } });
  invalid({ ...d, content: { ...d.content, en: { ...d.content.ar, options: [labels[0], { id: randomUUID(), label: "other" }] } } });
  invalid({ ...d, explanation: { en: "not authored" } });
  invalid({ ...d, secondarySkillIds: [ids[0], ids[0]] });
  invalid({ ...d, primarySkillId: ids[0], secondarySkillIds: [ids[0]] });
  invalid({ ...d, cognitiveTags: ["concept", "concept"] });
  invalid({ ...d, cognitiveTags: ["execution"] });
  assert.equal(questionCreateSchema.safeParse({ draft: d, createdBy: randomUUID() }).success, false);
  assert.equal(questionEditSchema.safeParse({ draft: d }).success, false);
  assert.equal(questionEditSchema.safeParse({ draft: d, expectedRevision: -1 }).success, false);
});
test("explicit bounds: options/items 2–20, strings, points, tags, skills and byte budgets", () => {
  for (const type of ["single_choice", "multiple_choice", "ordering"] as const) {
    const d = draft(type), field = type === "ordering" ? "items" : "options";
    const maxLabels = Array.from({ length: 20 }, () => ({ id: randomUUID(), label: "x" }));
    valid({ ...d, content: { ar: { ...d.content.ar, [field]: maxLabels } },
      gradingDefinition: type === "ordering" ? { type, correctOrderedItemIds: maxLabels.map(l => l.id) }
        : type === "multiple_choice" ? { type, correctOptionIds: maxLabels.map(l => l.id) }
          : { type, correctOptionId: maxLabels[0]!.id } });
    for (const count of [0, 1, 21]) invalid({ ...d, content: { ar: { ...d.content.ar,
      [field]: Array.from({ length: count }, () => ({ id: randomUUID(), label: "x" })) } } });
  }
  const d = draft();
  for (const defaultPoints of [0, 1001, 1.5]) invalid({ ...d, defaultPoints });
  valid({ ...d, defaultPoints: 1000 });
  valid({ ...d, content: { ar: { prompt: "x".repeat(20000) } } });
  invalid({ ...d, difficulty: "impossible" });
  for (const prompt of ["", "  ", "x".repeat(20001)]) invalid({ ...d, content: { ar: { prompt } } });
  invalid({ ...d, content: { ar: { prompt: "x", code: { language: "javascript", source: "x" } } } });
  invalid({ ...d, content: { ar: { prompt: "x", code: { language: "java", source: "x".repeat(20001) } } } });
  invalid({ ...d, secondarySkillIds: Array.from({ length: 21 }, () => randomUUID()) });
  const c = draft("single_choice");
  invalid({ ...c, content: { ar: { prompt: "x", options: Array.from({ length: 20 }, (_, n) => ({
    id: ids[n] ?? randomUUID(), label: "ع".repeat(10000),
  })) } } });
  for (const variants of [[], ["x".repeat(2001)], Array(21).fill("x")]) {
    invalid({ ...draft("short_text"), gradingDefinition: { type: "short_text", normalizer, acceptedByLocale: { ar: variants } } });
  }
});
test("restricted Markdown rejects HTML/scripts/embeds/links; Java is inert bounded plain text", () => {
  const d = draft();
  for (const unsafe of ["<script>alert(1)</script>", "<iframe src='x'>", "<!--x-->", "![x](https://example.test)",
    "[x](javascript:alert(1))", "[x](https://example.test)", "[x][ref]\n[ref]: javascript:alert(1)"]) {
    invalid({ ...d, content: { ar: { prompt: unsafe } } });
    invalid({ ...d, explanation: { ar: unsafe } });
  }
  valid({ ...d, content: { ar: { prompt: "```java\nList<String> values;\n```",
    code: { language: "java", source: 'String html = "<script>";' } } } });
});
test("v1 normalization preserves Arabic, Unicode, punctuation and exact output by default", () => {
  assert.equal(normalizeShortText("e\u0301\r\nأَ ب\r", normalizer), "é\nأَ ب\n");
  for (const text of [" A  b \n", "أَ", "ا", "١", "1", "x;", "x", "Straße", "STRASSE"]) {
    assert.equal(normalizeShortText(text, normalizer), text);
  }
  assert.equal(normalizeShortText(" A \t B\r\n", { ...normalizer, trim: true, collapseWhitespace: true, caseFold: true }), "a b");
  assert.notEqual(normalizeShortText("أَ", normalizer), normalizeShortText("ا", normalizer));
  const d = draft("short_text");
  for (const acceptedByLocale of [{ ar: ["é", "e\u0301"] }, { en: ["x"] }, { ar: ["x"], en: ["x"] }]) {
    invalid({ ...d, gradingDefinition: { type: "short_text", normalizer, acceptedByLocale } });
  }
  invalid({ ...d, gradingDefinition: { type: "short_text", normalizer: { ...normalizer, trim: true }, acceptedByLocale: { ar: [" "] } } });
  invalid({ ...d, gradingDefinition: { type: "short_text", normalizer: { ...normalizer, caseFold: true }, acceptedByLocale: { ar: ["A", "a"] } } });
  invalid({ ...d, gradingDefinition: { type: "short_text", normalizer: { ...normalizer, version: 2 }, acceptedByLocale: { ar: ["x"] } } });
});
test("bounded search schema and explicit Q2 Student projection never carry private fields", () => {
  assert.deepEqual(questionListSchema.parse({}), { page: 1, pageSize: 20 });
  for (const q of [{ pageSize: 51 }, { page: 0 }, { search: "x".repeat(201) }, { sort: "secret" }, { locale: "fr" }]) {
    assert.equal(questionListSchema.safeParse(q).success, false);
  }
  const source = { attemptQuestionId: randomUUID(), type: "true_false" as const, locale: "ar" as const,
    prompt: "x", position: 0, points: 1, gradingDefinition: draft().gradingDefinition, explanation: "secret", checksum: "secret" };
  const projected = projectStudentQuestion(source);
  assert.equal(studentQuestionSchema.safeParse(source).success, false);
  assert.deepEqual(Object.keys(projected).sort(), ["attemptQuestionId", "code", "items", "locale", "options", "points", "position", "prompt", "type"]);
  assert.equal(JSON.stringify(projected).includes("secret"), false);
});
