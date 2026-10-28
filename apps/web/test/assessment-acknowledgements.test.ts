import test from "node:test";
import assert from "node:assert/strict";
import {
  isQuestionDetail,
  isQuestionDraft,
  isSkillView,
  isSkillDetail,
  isCreatedQuiz,
  isSealedQuestion,
  isPublishedQuiz,
  isReleaseReceipt,
  isReleaseStatus,
} from "../src/components/lms/assessments/acknowledgements";
import {
  emptyQuestion,
  questionTypes,
} from "../src/components/lms/assessments/model";
import { ids, quiz, revision, timestamp } from "./fixtures/q7-authoring/data";
const question = (type: (typeof questionTypes)[number] = "single_choice") => {
  let i = 0;
  const draft = emptyQuestion(
    type,
    "en",
    () => [ids.option, ids.secondOption][i++],
  );
  draft.content.en!.prompt = "Synthetic prompt";
  for (const option of draft.content.en!.options ??
    draft.content.en!.items ??
    [])
    option.label = "Synthetic option";
  if (draft.gradingDefinition.type === "multiple_choice")
    draft.gradingDefinition.correctOptionIds = [ids.option];
  if (draft.gradingDefinition.type === "short_text")
    draft.gradingDefinition.acceptedByLocale.en = ["answer"];
  return {
    id: ids.question,
    status: "active" as const,
    editRevision: 3,
    currentRevisionId: ids.questionRevision,
    createdAt: timestamp,
    draft,
  };
};
const skill = () => ({
  id: ids.skill,
  slug: "synthetic-skill",
  status: "active" as const,
  parentId: null,
  editRevision: 3,
  createdAt: timestamp,
  translations: { en: { label: "Skill", description: "" } },
  ancestors: [],
});

test("question detail accepts all five valid draft shapes and scoped revision acknowledgements", () => {
  for (const type of questionTypes) {
    const q = question(type);
    assert.equal(isQuestionDetail({ ...q, editRevision: 4 }, q, true), true);
    assert.equal(isQuestionDetail({ ...q, editRevision: 8 }, q), true);
    assert.equal(
      isQuestionDetail({ ...q, editRevision: 0 }, undefined, true),
      true,
    );
    assert.equal(isQuestionDetail({ ...q, editRevision: 3 }, q, true), false);
    assert.equal(
      isQuestionDetail({ ...q, id: ids.skill, editRevision: 4 }, q, true),
      false,
    );
    assert.equal(isQuestionDetail({ ...q, draft: {} }, q), false);
    assert.equal(
      isQuestionDetail({ ...q, draft: { ...q.draft, content: { en: {} } } }, q),
      false,
    );
  }
});
test("malformed nested question fields fail safely instead of losing prompt, options or key", () => {
  const q = question();
  for (const patch of [
    { content: null },
    { cognitiveTags: ["unknown"] },
    { gradingDefinition: {} },
    { secondarySkillIds: null },
    { explanation: [] },
    { defaultContentLocale: "fr" },
    { content: { en: { prompt: "Only prompt" } } },
    { gradingDefinition: { type: "single_choice", correctOptionId: 12 } },
  ])
    assert.equal(isQuestionDraft({ ...q.draft, ...patch }), false);
  const t = question("short_text");
  assert.equal(
    isQuestionDraft({
      ...t.draft,
      gradingDefinition: {
        type: "short_text",
        normalizer: {},
        acceptedByLocale: null,
      },
    }),
    false,
  );
});
test("skill view and recovery detail validate identity, revision, translations and ancestor shape", () => {
  const s = skill();
  assert.equal(isSkillView({ ...s, editRevision: 4 }, s, true), true);
  assert.equal(isSkillDetail({ ...s, editRevision: 8 }, s), true);
  assert.equal(isSkillDetail({ ...s, ancestors: [s] }, s), true);
  for (const v of [
    {},
    { ...s, id: ids.quiz },
    { ...s, editRevision: 2 },
    { ...s, translations: {} },
    { ...s, translations: { en: {} } },
    { ...s, ancestors: [null] },
  ])
    assert.equal(isSkillDetail(v, s), false);
});
test("quiz creation validates new identity, fixed parent and usable draft before navigation", () => {
  const q = {
    ...quiz(),
    editRevision: 0,
    status: "draft",
    currentRevisionId: null,
    items: [],
  };
  assert.equal(isCreatedQuiz(q, "courses", ids.course), true);
  assert.equal(
    isCreatedQuiz(
      {
        ...q,
        parentType: "chapter",
        parentId: ids.skill,
        chapterId: ids.skill,
      },
      "chapters",
      ids.skill,
    ),
    true,
  );
  assert.equal(
    isCreatedQuiz(
      { ...q, parentType: "lesson", parentId: ids.skill, lessonId: ids.skill },
      "lessons",
      ids.skill,
    ),
    true,
  );
  for (const v of [
    {},
    { ...q, id: undefined },
    { ...q, draft: {} },
    { ...q, parentId: ids.skill },
    { ...q, editRevision: 4 },
    { ...q, status: "published" },
  ])
    assert.equal(isCreatedQuiz(v, "courses", ids.course), false);
});
test("seal and publish adopt only validated identity and revision receipts", () => {
  const q = question(),
    quizDetail = quiz();
  const seal = {
    editRevision: 4,
    revision: {
      id: ids.questionRevision,
      questionId: ids.question,
      number: 2,
      createdAt: timestamp,
    },
  };
  const publish = { editRevision: 5, revision: revision() };
  assert.equal(isSealedQuestion(seal, q), true);
  assert.equal(isPublishedQuiz(publish, quizDetail), true);
  for (const v of [
    {},
    [],
    { editRevision: 4, revision: {} },
    { ...seal, editRevision: 3 },
    { ...seal, revision: { ...seal.revision, questionId: ids.skill } },
  ])
    assert.equal(isSealedQuestion(v, q), false);
  for (const v of [
    {},
    { editRevision: 5, revision: {} },
    { ...publish, editRevision: 4 },
    { ...publish, revision: { ...publish.revision, quizId: ids.skill } },
    { ...publish, revision: { ...publish.revision, courseId: ids.skill } },
  ])
    assert.equal(isPublishedQuiz(v, quizDetail), false);
});
test("release receipt and status read cannot silently accept missing or foreign completion evidence", () => {
  const receipt = { quizRevisionId: ids.revision, releasedAt: timestamp };
  assert.equal(isReleaseReceipt(receipt, ids.revision), true);
  assert.equal(
    isReleaseStatus({ id: ids.revision, reviewRelease: receipt }, ids.revision),
    true,
  );
  assert.equal(
    isReleaseStatus({ id: ids.revision, reviewRelease: null }, ids.revision),
    true,
  );
  for (const v of [
    {},
    { ...receipt, releasedAt: undefined },
    { ...receipt, quizRevisionId: ids.skill },
  ])
    assert.equal(isReleaseReceipt(v, ids.revision), false);
  for (const v of [
    {},
    { id: ids.revision },
    { id: ids.skill, reviewRelease: null },
    { id: ids.revision, reviewRelease: {} },
  ])
    assert.equal(isReleaseStatus(v, ids.revision), false);
});
