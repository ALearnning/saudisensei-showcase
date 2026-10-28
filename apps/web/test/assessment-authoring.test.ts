import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  acknowledge,
  assessmentTimestamp,
  mergePinnedPresentations,
  addQuestionLocale,
  basisPoints,
  defaultPolicy,
  dirtySections,
  draftDiffers,
  emptyQuestion,
  itemsValid,
  parseRoute,
  policyIssues,
  publicationState,
  questionIssues,
  quizBlocked,
  quizState,
  removeQuestionLocale,
  riyadhInput,
  riyadhInstant,
  saveBody,
  visibility,
  type Locale,
} from "../src/components/lms/assessments/model";
import {
  AssessmentTransport,
  writeFailureKind,
} from "../src/components/lms/assessments/transport";
import { ids, quiz, revision, preview } from "./fixtures/q7-authoring/data";

test("authoring routes are closed, typed and parent-scoped", () => {
  assert.deepEqual(parseRoute([]), { kind: "home" });
  assert.deepEqual(parseRoute(["question-bank", "new"]), {
    kind: "question",
    id: "new",
  });
  for (const scope of ["courses", "chapters", "lessons"])
    assert.deepEqual(parseRoute(["quizzes", scope, ids.course, ids.quiz]), {
      kind: "quiz",
      scope,
      parent: ids.course,
      id: ids.quiz,
    });
  for (const segments of [
    ["attempts"],
    ["quizzes", ids.quiz],
    ["quizzes", "students", ids.course, ids.quiz],
    ["question-bank", ".."],
    ["skills", "new"],
    ["quizzes", "courses", "%2f", "new"],
  ])
    assert.equal(parseRoute(segments), null);
});

test("independent saves use the latest acknowledgement and preserve unsent sections and AI flag", () => {
  let s = quizState(quiz());
  s.info = {
    ...s.info,
    content: { en: { title: "Unsent title", instructions: "" } },
  };
  s.policy = { ...s.policy, maxAttempts: 3 };
  s.items = s.items.map((i) => ({ ...i, points: 7 }));
  assert.equal(quizBlocked(s), true);
  const body = saveBody(s, "info");
  assert.ok(body.draft);
  assert.equal(body.expectedRevision, 4);
  assert.equal(body.draft.policy.maxAttempts, 1);
  assert.equal(body.draft.policy.aiAnalysisEnabled, true);
  const saved = { ...s.ack, editRevision: 5, draft: body.draft };
  s = acknowledge(s, saved, "info");
  assert.deepEqual(dirtySections(s), {
    info: false,
    policy: true,
    items: true,
  });
  const policy = saveBody(s, "policy");
  assert.ok(policy.draft);
  assert.equal(policy.expectedRevision, 5);
  assert.equal(policy.draft.content.en?.title, "Unsent title");
  assert.equal(policy.draft.policy.timeLimitSeconds, 125);
  assert.equal(saveBody(s, "items").expectedRevision, 5);
});

test("visibility validates all 64 combinations as nonordinal prerequisites", () => {
  const allowed = {
    after_grading: visibility,
    after_attempt_limit: ["after_attempt_limit", "never"],
    manual_release: ["manual_release", "never"],
    never: ["never"],
  };
  for (const scoreVisibility of visibility)
    for (const reviewVisibility of visibility)
      for (const explanationVisibility of visibility) {
        const valid =
          (allowed[scoreVisibility] as readonly string[]).includes(
            reviewVisibility,
          ) &&
          (allowed[reviewVisibility] as readonly string[]).includes(
            explanationVisibility,
          );
        assert.equal(
          policyIssues({
            ...defaultPolicy(),
            scoreVisibility,
            reviewVisibility,
            explanationVisibility,
          }).includes("visibility"),
          !valid,
        );
      }
  assert.ok(
    policyIssues({
      ...defaultPolicy("practice"),
      scoreVisibility: "after_attempt_limit",
    }).includes("finite"),
  );
  assert.equal(defaultPolicy("practice").reviewVisibility, "after_grading");
});

test("threshold and Riyadh conversions preserve exact values without grading", () => {
  assert.equal(basisPoints("66.67"), 6667);
  assert.equal(basisPoints("0.01"), 1);
  assert.ok(Number.isNaN(basisPoints("66.667")));
  const instant = "2026-10-24T07:50:13.000Z";
  assert.equal(riyadhInput(instant), "2026-10-24T10:50:13");
  assert.equal(riyadhInstant(riyadhInput(instant)), instant);
  assert.equal(riyadhInstant(""), null);
  assert.ok(
    policyIssues({
      ...defaultPolicy(),
      opensAt: instant,
      closesAt: instant,
    }).includes("window"),
  );
});

test("all five complete question drafts validate; bilingual IDs and locale removal remain consistent", () => {
  for (const type of [
    "single_choice",
    "multiple_choice",
    "true_false",
    "ordering",
    "short_text",
  ] as const) {
    let n = 0;
    let d = emptyQuestion(
      type,
      "ar",
      () => [ids.option, ids.secondOption][n++],
    );
    d.content.ar!.prompt = "سؤال";
    for (const item of d.content.ar!.options ?? d.content.ar!.items ?? [])
      item.label = item.id;
    if (d.gradingDefinition.type === "multiple_choice")
      d.gradingDefinition.correctOptionIds = [ids.option];
    if (d.gradingDefinition.type === "short_text")
      d.gradingDefinition.acceptedByLocale.ar = ["جواب"];
    assert.deepEqual(questionIssues(d), [], type);
    d = addQuestionLocale(d, "en");
    d.content.en!.prompt = "Question";
    for (const item of d.content.en!.options ?? d.content.en!.items ?? [])
      item.label = "Translated " + item.id;
    if (d.gradingDefinition.type === "short_text")
      d.gradingDefinition.acceptedByLocale.en = ["Answer"];
    assert.deepEqual(questionIssues(d), [], type);
    d.explanation.ar = "تفسير";
    d = removeQuestionLocale(d, "ar");
    assert.equal(d.defaultContentLocale, "en");
    assert.equal(d.explanation.ar, undefined);
    assert.deepEqual(questionIssues(d), [], type);
  }
});

test("duplicate normalized variants, invalid keys, unsafe content and size limits block a save", () => {
  const d = emptyQuestion("short_text", "en");
  d.content.en!.prompt = "Question";
  assert.ok(d.gradingDefinition.type === "short_text");
  d.gradingDefinition.acceptedByLocale.en = ["A", "a"];
  d.gradingDefinition.normalizer.caseFold = true;
  assert.ok(questionIssues(d).includes("variants"));
  for (const prompt of [
    "<script>bad</script>",
    "[link](https://invalid.example)",
    "![image](x)",
  ])
    assert.ok(
      questionIssues({ ...d, content: { en: { prompt } } }).includes("content"),
    );
  assert.ok(questionIssues({ ...d, defaultPoints: 1.1 }).includes("points"));
  assert.equal(itemsValid([...quiz().items, ...quiz().items]), false);
  assert.equal(itemsValid([]), true);
  assert.equal(quizBlocked(quizState({ ...quiz(), items: [] })), true);
});

test("publication state distinguishes first draft, unpublished history and newer saved edits", () => {
  const q = quiz();
  assert.equal(draftDiffers(q, revision(q)), false);
  q.draft.content.en!.title = "Newer title";
  assert.equal(draftDiffers(q, revision()), true);
  q.currentRevisionId = null;
  q.status = "draft";
  assert.equal(publicationState(q), "unknown");
  assert.equal(publicationState(q, 0), "first");
  assert.equal(publicationState(q, 2), "unpublished");
});

test("transport deduplicates reads but never retries a mutation or caches private responses", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  let finish!: () => void;
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  const api = new AssessmentTransport(undefined, (async (path, init) => {
    calls.push({ path: String(path), init });
    await gate;
    return Response.json({ ok: true });
  }) as typeof fetch);
  const a = api.request("admin/skills"),
    b = api.request("admin/skills");
  assert.equal(a, b);
  finish();
  await a;
  await api.request("admin/skills");
  await api.request("admin/courses/test/preview", "POST", { locale: "en" });
  await api.request("admin/courses/test/answer-preview", "POST", {
    locale: "en",
  });
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(
      (c) =>
        c.path.startsWith("/lms-api/admin/") &&
        c.init?.cache === "no-store" &&
        c.init.credentials === "same-origin",
    ),
  );
  let writes = 0;
  const failing = new AssessmentTransport(undefined, (async () => {
    writes++;
    throw new Error("private data must not escape");
  }) as typeof fetch);
  assert.deepEqual(await failing.request("admin/skills", "POST", {}), {
    ok: false,
    error: { status: 0, code: "NETWORK" },
  });
  assert.equal(writes, 1);
});

test("transport budgets, Retry-After and UTF-8 body limits fail without extra requests", async () => {
  let now = 0,
    calls = 0;
  const api = new AssessmentTransport(
    undefined,
    (async () => {
      calls++;
      return Response.json({});
    }) as typeof fetch,
    () => now,
  );
  for (let i = 0; i < 40; i++)
    assert.equal((await api.request(`admin/skills?page=${i}`)).ok, true);
  const limited = await api.request("admin/skills");
  assert.ok(!limited.ok);
  assert.equal(limited.error.status, 429);
  assert.equal(limited.error.rateLimitSource, "client");
  assert.equal(calls, 40);
  now = 60001;
  assert.equal((await api.request("admin/skills")).ok, true);
  const oversized = await api.request("admin/skills", "POST", {
    text: "س".repeat(100000),
  });
  assert.ok(!oversized.ok);
  assert.equal(oversized.error.status, 413);
  assert.equal(calls, 41);
  let retries = 0;
  const rate = new AssessmentTransport(
    undefined,
    (async () => {
      retries++;
      return Response.json(
        { code: "RATE_LIMITED" },
        { status: 429, headers: { "retry-after": "2" } },
      );
    }) as typeof fetch,
    () => now,
  );
  await rate.request("admin/skills");
  await rate.request("admin/skills");
  assert.equal(retries, 1);
  now += 2001;
  await rate.request("admin/skills");
  assert.equal(retries, 2);
});

test("write outcomes distinguish definite rejection, conflict, denial and uncertain outcomes", () => {
  for (const status of [400, 413, 422, 429])
    assert.equal(writeFailureKind({ status, code: "REJECTED" }), "rejected");
  for (const status of [401, 403])
    assert.equal(writeFailureKind({ status, code: "DENIED" }), "denied");
  assert.equal(
    writeFailureKind({ status: 409, code: "QUIZ_CHANGED" }),
    "conflict",
  );
  for (const status of [0, 404, 408, 500, 502, 503])
    assert.equal(writeFailureKind({ status, code: "UNKNOWN" }), "uncertain");
});

test("the client budget outlasts a shorter server Retry-After and cannot be bypassed by another save path", async () => {
  let now = 0,
    calls = 0;
  const api = new AssessmentTransport(
    undefined,
    (async () => {
      calls++;
      return calls === 40
        ? Response.json(
            { code: "RATE_LIMITED" },
            { status: 429, headers: { "retry-after": "2" } },
          )
        : Response.json({});
    }) as typeof fetch,
    () => now,
  );
  for (let i = 0; i < 39; i++) await api.request("admin/skills");
  const r = await api.request("admin/quiz", "PATCH", {});
  assert.ok(!r.ok);
  assert.equal(r.error.retryAfter, 60);
  assert.equal(r.error.rateLimitSource, "server");
  now = 2000;
  assert.equal(api.retryAfter(), 58);
  await api.request("admin/quiz/items", "PUT", {});
  now = 59999;
  await api.request("admin/quiz", "PATCH", {});
  assert.equal(calls, 40);
  assert.equal(api.retryAfter(), 1);
  now = 60000;
  assert.equal(api.retryAfter(), 0);
  assert.equal((await api.request("admin/quiz", "PATCH", {})).ok, true);
  assert.equal(calls, 41);
});

test("later concurrent 429 responses cannot shorten an already required cooldown", async () => {
  let now = 0,
    calls = 0;
  const finish: ((response: Response) => void)[] = [];
  const api = new AssessmentTransport(
    undefined,
    (async () => {
      calls++;
      return calls <= 2
        ? new Promise<Response>((resolve) => finish.push(resolve))
        : Response.json({});
    }) as typeof fetch,
    () => now,
  );
  const first = api.request("admin/quiz", "PATCH", {});
  const second = api.request("admin/quiz/items", "PUT", {});
  finish[0](
    Response.json({}, { status: 429, headers: { "retry-after": "10" } }),
  );
  await first;
  now = 1000;
  finish[1](
    Response.json({}, { status: 429, headers: { "retry-after": "2" } }),
  );
  const r = await second;
  assert.ok(!r.ok);
  assert.equal(r.error.retryAfter, 9);
  now = 9999;
  await api.request("admin/quiz", "PATCH", {});
  assert.equal(calls, 2);
  now = 10000;
  assert.equal((await api.request("admin/quiz/items", "PUT", {})).ok, true);
});

test("401 denial suppresses a late successful section-save acknowledgement", async () => {
  let finish!: (response: Response) => void,
    deniedStatus = 0,
    calls = 0;
  const api = new AssessmentTransport(
    (error) => {
      deniedStatus = error.status;
    },
    (async () => {
      calls++;
      return calls === 1
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
    }) as typeof fetch,
  );
  const save = api.request("admin/quiz", "PATCH", {});
  await api.request("admin/quiz/revisions");
  finish(Response.json(quiz()));
  assert.equal((await save).ok, false);
  assert.equal((await api.request("admin/quiz/items", "PUT", {})).ok, false);
  assert.equal(deniedStatus, 401);
  assert.equal(calls, 2);
});

test("authorization denial clears the workspace and suppresses late private responses", async () => {
  let done!: (r: Response) => void,
    denial = 0,
    calls = 0;
  const api = new AssessmentTransport(
    () => {
      denial++;
    },
    (async () => {
      calls++;
      if (calls === 1)
        return new Promise<Response>((r) => {
          done = r;
        });
      return Response.json(
        { code: "FORBIDDEN", privateDefinition: "must not escape" },
        { status: 403 },
      );
    }) as typeof fetch,
  );
  const pending = api.request("admin/quiz/answer-preview", "POST", {});
  await api.request("admin/skills");
  done(Response.json({ privateDefinition: "must not escape" }));
  assert.deepEqual(await pending, {
    ok: false,
    error: { status: 403, code: "FORBIDDEN" },
  });
  assert.equal((await api.request("admin/skills")).ok, false);
  assert.equal(calls, 2);
  assert.equal(denial, 1);
});

test("an invalid success response cannot acknowledge a save", async () => {
  const api = new AssessmentTransport(
    undefined,
    (async () => new Response("not JSON")) as typeof fetch,
  );
  assert.deepEqual(await api.request("admin/skills", "POST", {}), {
    ok: false,
    error: { status: 502, code: "INVALID_RESPONSE" },
  });
});

test("Admin page remains behind existing session and role/MFA authority", async () => {
  const page = await readFile(
    new URL(
      "../src/app/[locale]/admin/assessments/[[...segments]]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const layout = await readFile(
    new URL("../src/app/[locale]/admin/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /await gate\(locale, "admin"\)/);
  assert.match(layout, /await getProtectedPage\(locale, "admin"\)/);
  assert.doesNotMatch(page, /draft=|gradingDefinition|answer-preview|fetch\(/);
});

test("revision timestamps use Riyadh Gregorian date and time in both UI languages", () => {
  const iso = "2026-10-24T22:15:30.000Z";
  assert.equal(assessmentTimestamp(iso, "en"), "25 Oct 2026, 01:15:30 GMT+3");
  const ar = assessmentTimestamp(iso, "ar");
  assert.match(ar, /٢٥/);
  assert.match(ar, /٠١:١٥:٣٠/);
  assert.equal(assessmentTimestamp("invalid", "en"), "—");
});

test("pinned cache merges exact references, retains known revision numbers and prunes removed or mismatched identities", () => {
  const q = quiz();
  const old = preview(q).questions[0];
  const pending = {
    ...old,
    questionId: ids.secondOption,
    questionRevisionId: ids.option,
    prompt: "Unsaved pinned revision",
    revisionNumber: 7,
  };
  const items = [
    ...q.items,
    {
      ...q.items[0],
      questionId: pending.questionId,
      questionRevisionId: pending.questionRevisionId,
      position: 1,
    },
  ];
  const merged = mergePinnedPresentations(
    { [pending.questionRevisionId]: pending },
    [old],
    items,
  );
  assert.equal(merged[pending.questionRevisionId].prompt, pending.prompt);
  assert.equal(merged[pending.questionRevisionId].revisionNumber, 7);
  assert.equal(
    mergePinnedPresentations(
      merged,
      [{ ...pending, revisionNumber: undefined, prompt: "Safe preview" }],
      q.items,
    )[pending.questionRevisionId],
    undefined,
  );
  assert.deepEqual(
    mergePinnedPresentations(
      {},
      [{ ...old, questionId: ids.secondOption }],
      q.items,
    ),
    {},
  );
  const refreshed = mergePinnedPresentations(
    merged,
    [{ ...old, prompt: "Exact saved presentation" }],
    items,
  );
  assert.equal(refreshed[pending.questionRevisionId].revisionNumber, 7);
  const known = mergePinnedPresentations(
    { [old.questionRevisionId]: { ...old, revisionNumber: 1 } },
    [old],
    q.items,
  );
  assert.equal(known[old.questionRevisionId].revisionNumber, 1);
});
