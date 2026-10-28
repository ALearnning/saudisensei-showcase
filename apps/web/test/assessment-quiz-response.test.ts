import test from "node:test";
import assert from "node:assert/strict";
import { isQuizDetailResponse } from "../src/components/lms/assessments/quiz-response";
import { ids, quiz } from "./fixtures/q7-authoring/data";

test("quiz response accepts the existing contract and distinguishes save from recovery revisions", () => {
  const current = quiz();
  const saved = { ...quiz(), editRevision: 5 };
  assert.equal(isQuizDetailResponse(saved, current, 5), true);
  assert.equal(isQuizDetailResponse(current, current), true);
  assert.equal(isQuizDetailResponse(saved, current), true);
  assert.equal(
    isQuizDetailResponse({ ...saved, editRevision: 9 }, current),
    true,
  );
  const optional = quiz();
  optional.draft.defaultContentLocale = "ar";
  delete optional.draft.content.en;
  optional.draft.policy.maxAttempts = null;
  optional.draft.policy.timeLimitSeconds = null;
  optional.draft.policy.opensAt = null;
  delete optional.draft.policy.closesAt;
  optional.currentRevisionId = null;
  optional.status = "draft";
  optional.items = [];
  assert.equal(isQuizDetailResponse(optional, current), true);
});

test("malformed details cannot replace authoring state even with HTTP success", () => {
  const current = quiz();
  const saved = { ...quiz(), editRevision: 5 };
  const invalid = [
    null,
    [],
    {},
    "ok",
    { ...saved, id: ids.question },
    { ...saved, courseId: ids.question },
    { ...saved, parentType: "lesson" },
    { ...saved, parentId: ids.question },
    { ...saved, chapterId: ids.question },
    { ...saved, lessonId: ids.question },
    { ...saved, status: ["published"] },
    { ...saved, currentRevisionId: 42 },
    { ...saved, createdAt: "invalid" },
    { ...saved, editRevision: 4 },
    { ...saved, editRevision: 6 },
    { ...saved, editRevision: "5" },
    { ...saved, draft: null },
    { ...saved, draft: { ...saved.draft, defaultContentLocale: "fr" } },
    { ...saved, draft: { ...saved.draft, content: {} } },
    {
      ...saved,
      draft: { ...saved.draft, content: { en: { title: "Only a title" } } },
    },
    { ...saved, draft: { ...saved.draft, policy: null } },
    ...[
      { version: 2 },
      { required: "false" },
      { passBasisPoints: "7000" },
      { maxAttempts: 0 },
      { timeLimitSeconds: 1 },
      { opensAt: "invalid" },
      { scoreVisibility: "unknown" },
      { aiAnalysisEnabled: undefined },
    ].map((policy) => ({
      ...saved,
      draft: { ...saved.draft, policy: { ...saved.draft.policy, ...policy } },
    })),
    { ...saved, items: undefined },
    { ...saved, items: [null] },
    { ...saved, items: [{ ...saved.items[0], questionRevisionId: null }] },
    { ...saved, items: [{ ...saved.items[0], points: "7" }] },
    { ...saved, items: [{ ...saved.items[0], position: -1 }] },
  ];
  for (const value of invalid)
    assert.equal(
      isQuizDetailResponse(value, current, 5),
      false,
      JSON.stringify(value),
    );
  assert.equal(
    isQuizDetailResponse({ ...saved, editRevision: 3 }, current),
    false,
  );
  assert.equal(
    isQuizDetailResponse({ ...saved, editRevision: 4.5 }, current),
    false,
  );
});
