"use client";
import { useId, useState } from "react";
import type {
  AdminSkillDetail,
  AdminSkillPage,
  AdminSkillView,
  AdminSkillTranslations,
} from "@workspace/saudisensei-api-client";
import {
  invalidAcknowledgement,
  isSkillView,
  isSkillDetail,
} from "./acknowledgements";
import { skillLabel, skillPath, same, localesOf } from "./model";
import {
  useAssessment,
  useRead,
  useAction,
  useLeaving,
  Head,
  Panel,
  Field,
  FailureView,
  Skeleton,
  Pager,
  Empty,
  Status,
  Modal,
  Note,
  label,
  UncertainCreate,
} from "./common";
/** Paged roots/direct children and separately scoped search; never eagerly hydrates a tree. */
export function SkillBrowser({
  onSelect,
  activeOnly = false,
  exclude = [],
}: {
  onSelect: (s: AdminSkillView) => void;
  activeOnly?: boolean;
  exclude?: string[];
}) {
  const { locale, t } = useAssessment();
  const controlId = useId();
  const [parent, setParent] = useState("root"),
    [trail, setTrail] = useState<AdminSkillView[]>([]),
    [page, setPage] = useState(1),
    [input, setInput] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(activeOnly ? "active" : "");
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    ...(search ? { search } : { parentId: parent }),
    ...(status ? { status } : {}),
  });
  const q = useRead<AdminSkillPage>(`admin/skills?${params}`);
  return (
    <div className="aa-stack">
      <form
        className="aa-actions"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(input.trim());
          setPage(1);
        }}
      >
        <Field
          id={`${controlId}-search`}
          label={t("البحث في المهارات", "Search skills")}
        >
          <input
            id={`${controlId}-search`}
            type="search"
            maxLength={120}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </Field>
        <button>{t("بحث", "Search")}</button>
      </form>
      {!activeOnly && (
        <Field id={`${controlId}-status`} label={t("الحالة", "Status")}>
          <select
            id={`${controlId}-status`}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("الكل", "All")}</option>
            <option value="active">{t("نشط", "Active")}</option>
            <option value="archived">{t("مؤرشف", "Archived")}</option>
          </select>
        </Field>
      )}
      <div className="aa-trail">
        <button
          onClick={() => {
            setParent("root");
            setTrail([]);
            setSearch("");
            setInput("");
            setPage(1);
          }}
        >
          {t("الجذور", "Roots")}
        </button>
        {trail.map((s, i) => (
          <span key={s.id}>
            {" "}
            /{" "}
            <button
              onClick={() => {
                setParent(s.id);
                setTrail(trail.slice(0, i + 1));
                setSearch("");
                setPage(1);
              }}
            >
              {skillLabel(s, locale)}
            </button>
          </span>
        ))}
      </div>
      {q.loading ? (
        <Skeleton rows={3} />
      ) : q.error ? (
        <FailureView error={q.error} retry={q.reload} />
      ) : (
        q.data && (
          <>
            <ul className="aa-tree">
              {q.data.items.map((s) => (
                <li key={s.id}>
                  <div className="aa-actions">
                    <button
                      disabled={exclude.includes(s.id)}
                      onClick={() => onSelect(s)}
                    >
                      {skillLabel(s, locale)}
                    </button>
                    <Status value={s.status} />
                    <button
                      aria-label={`${t("المهارات الفرعية", "Children")}: ${skillLabel(s, locale)}`}
                      onClick={() => {
                        setParent(s.id);
                        setTrail([...trail, s]);
                        setSearch("");
                        setInput("");
                        setPage(1);
                      }}
                    >
                      {t("فتح الفرع", "Open branch")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {!q.data.items.length && (
              <Empty>
                {t(
                  "لا مهارات مطابقة في هذا الفرع.",
                  "No matching skills in this branch.",
                )}
              </Empty>
            )}
            <Pager {...q.data} locale={locale} onPage={setPage} />
          </>
        )
      )}
      <small>
        {t(
          "يُحمّل كل فرع عند فتحه. الحد الأقصى 8 مستويات.",
          "Each branch loads when opened. Maximum depth: 8.",
        )}
      </small>
    </div>
  );
}
export function SkillPicker({
  onChoose,
  onClose,
  exclude = [],
}: {
  onChoose: (s: AdminSkillDetail) => void;
  onClose: () => void;
  exclude?: string[];
}) {
  const { api, t } = useAssessment();
  const m = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t("اختيار مهارة", "Choose a skill")}
      onClose={onClose}
      busy={busy}
    >
      <FailureView error={m.error} />
      <SkillBrowser
        activeOnly
        exclude={exclude}
        onSelect={(s) => {
          setBusy(true);
          void api
            .request<AdminSkillDetail>(`admin/skills/${s.id}`)
            .then((r) => {
              setBusy(false);
              if (!r.ok) {
                m.setError(r.error);
                return;
              }
              if (
                r.data.status !== "active" ||
                exclude.includes(r.data.id) ||
                r.data.ancestors.some((a) => a.status !== "active") ||
                r.data.ancestors.some((a) => exclude.includes(a.id))
              ) {
                m.setError({ status: 400, code: "SKILL_NOT_ACTIVE" });
                return;
              }
              onChoose(r.data);
            });
        }}
      />
    </Modal>
  );
}
export function Skills() {
  const { t } = useAssessment();
  const [id, setId] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [treeRefresh, setTreeRefresh] = useState(0),
    [dirty, setDirty] = useState(false);
  const q = useRead<AdminSkillDetail>(
    id && id !== "new" ? `admin/skills/${id}` : null,
    refresh,
  );
  const choose = (next: string) => {
    if (
      dirty &&
      !window.confirm(
        t(
          "ستفقد التعديلات غير المحفوظة. متابعة؟",
          "Discard unsaved edits and continue?",
        ),
      )
    )
      return;
    setDirty(false);
    setId(next);
  };
  return (
    <>
      <Head
        title={t("المهارات", "Skills")}
        lead={t(
          "تصنيف واضح بسياق تاريخي محفوظ.",
          "A clear taxonomy with preserved historical context.",
        )}
        actions={
          <button className="primary" onClick={() => choose("new")}>
            {t("إنشاء مهارة", "Create skill")}
          </button>
        }
      />
      <div className="aa-columns">
        <Panel>
          {id === "new" ? (
            <SkillForm
              key="new"
              onDirty={setDirty}
              onSaved={(s) => {
                setDirty(false);
                setId(s.id);
                setRefresh((n) => n + 1);
              }}
            />
          ) : q.loading ? (
            <Skeleton />
          ) : q.error ? (
            <FailureView error={q.error} retry={q.reload} />
          ) : q.data ? (
            <SkillForm
              key={`${q.data.id}-${q.data.editRevision}`}
              data={q.data}
              onRecovered={() => setTreeRefresh((n) => n + 1)}
              onDirty={setDirty}
              onSaved={() => {
                setDirty(false);
                setRefresh((n) => n + 1);
              }}
            />
          ) : (
            <Empty>
              {t(
                "اختر مهارة لعرض تفاصيلها.",
                "Select a skill to view its details.",
              )}
            </Empty>
          )}
        </Panel>
        <Panel title={t("شجرة المهارات", "Skill hierarchy")}>
          <SkillBrowser
            key={`${refresh}-${treeRefresh}`}
            onSelect={(s) => choose(s.id)}
          />
        </Panel>
      </div>
    </>
  );
}
function SkillForm({
  data: initialData,
  onRecovered,
  onSaved,
  onDirty,
}: {
  data?: AdminSkillDetail;
  onRecovered?: () => void;
  onSaved: (s: AdminSkillView) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { locale, t, api } = useAssessment(),
    m = useAction();
  const [data, setData] = useState(initialData),
    [fresh, setFresh] = useState<AdminSkillDetail | null>(null),
    [unconfirmed, setUnconfirmed] = useState(false);
  const [slug, setSlug] = useState(data?.slug ?? ""),
    [translations, setTranslations] = useState<AdminSkillTranslations>(
      data?.translations ?? { ar: { label: "", description: "" } },
    ),
    [parent, setParent] = useState<AdminSkillDetail | null>(null),
    [picker, setPicker] = useState<"create" | "move" | null>(null),
    [confirm, setConfirm] = useState<"archive" | "move" | "reload" | null>(
      null,
    );
  const dirty =
    !same(
      { slug, translations },
      {
        slug: data?.slug ?? "",
        translations: data?.translations ?? {
          ar: { label: "", description: "" },
        },
      },
    ) ||
    (!data && !!parent);
  useLeaving(dirty);
  const locked =
      data?.status === "archived" ||
      data?.ancestors.some((s) => s.status === "archived"),
    conflict =
      unconfirmed ||
      (!!m.error &&
        (m.error.status === 409 ||
          m.error.status === 0 ||
          m.error.status >= 500));
  const valid =
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    slug.length <= 160 &&
    localesOf(translations).length > 0 &&
    localesOf(translations).every((l) => translations[l]!.label.trim());
  const change = (s: string, tr: AdminSkillTranslations) => {
    setSlug(s);
    setTranslations(tr);
    onDirty(true);
  };
  async function save() {
    const r = await m.run<unknown>(
      data ? `admin/skills/${data.id}` : "admin/skills",
      data ? "PATCH" : "POST",
      data
        ? { expectedRevision: data.editRevision, slug, translations }
        : { slug, translations, parentId: parent?.id ?? null },
    );
    if (r) {
      if (
        isSkillView(r, data, true) &&
        r.status === "active" &&
        r.parentId === (data ? data.parentId : (parent?.id ?? null))
      )
        onSaved(r);
      else {
        setUnconfirmed(true);
        m.setError(invalidAcknowledgement);
      }
    }
  }
  return (
    <>
      <h2>{data ? skillPath(data, locale) : t("مهارة جديدة", "New skill")}</h2>
      {data && <Status value={data.status} />}
      <FailureView error={m.error} />
      {conflict && !data && <UncertainCreate />}
      {conflict && data && (
        <button
          onClick={() => {
            setUnconfirmed(true);
            void api.request<unknown>(`admin/skills/${data.id}`).then((r) => {
              if (!r.ok) {
                m.setError(r.error);
                return;
              }
              if (!isSkillDetail(r.data, data)) {
                setFresh(null);
                m.setError(invalidAcknowledgement);
                return;
              }
              setFresh(r.data);
              setConfirm("reload");
            });
          }}
        >
          {t("إعادة تحميل النسخة الحالية", "Reload current version")}
        </button>
      )}
      <fieldset disabled={locked || m.busy || conflict}>
        <div className="aa-actions">
          {(["ar", "en"] as const).map((l) => (
            <label className="aa-check" key={l}>
              <input
                type="checkbox"
                checked={!!translations[l]}
                onChange={(e) => {
                  const tr = { ...translations };
                  if (e.target.checked) tr[l] = { label: "", description: "" };
                  else delete tr[l];
                  change(slug, tr);
                }}
              />
              {l === "ar" ? "العربية" : "English"}
            </label>
          ))}
        </div>
        {localesOf(translations).map((l) => (
          <div key={l} lang={l} dir={l === "ar" ? "rtl" : "ltr"}>
            <Field
              id={`skill-label-${l}`}
              label={`${t("الاسم", "Label")} · ${label(l, t)}`}
            >
              <input
                id={`skill-label-${l}`}
                maxLength={255}
                value={translations[l]!.label}
                onChange={(e) =>
                  change(slug, {
                    ...translations,
                    [l]: { ...translations[l]!, label: e.target.value },
                  })
                }
              />
            </Field>
            <Field
              id={`skill-description-${l}`}
              label={`${t("الوصف", "Description")} · ${label(l, t)}`}
            >
              <textarea
                id={`skill-description-${l}`}
                rows={3}
                maxLength={2000}
                value={translations[l]!.description}
                onChange={(e) =>
                  change(slug, {
                    ...translations,
                    [l]: { ...translations[l]!, description: e.target.value },
                  })
                }
              />
            </Field>
          </div>
        ))}
        <Field id="skill-slug" label={t("المعرّف النصي", "Slug")}>
          <input
            id="skill-slug"
            dir="ltr"
            maxLength={160}
            value={slug}
            onChange={(e) => change(e.target.value, translations)}
          />
        </Field>
        {!data && (
          <div className="aa-actions">
            <button onClick={() => setPicker("create")}>
              {parent
                ? skillPath(parent, locale)
                : t(
                    "اختيار المهارة الأم (اختياري)",
                    "Choose parent (optional)",
                  )}
            </button>
            {parent && (
              <button onClick={() => setParent(null)}>
                {t("جعلها جذرًا", "Use root")}
              </button>
            )}
          </div>
        )}
        <button
          className="primary"
          disabled={!valid || (!dirty && !!data)}
          onClick={() => void save()}
        >
          {t("حفظ التفاصيل", "Save details")}
        </button>
      </fieldset>
      <Note>
        {t(
          "التعديل لا يعيد كتابة تصنيف الأسئلة المثبّتة. الأرشفة تتطلب عدم وجود أبناء نشطين؛ النقل يمنع الدورات وتجاوز العمق والآباء المؤرشفين.",
          "Edits do not rewrite sealed question taxonomy. Archive requires no active children; moves reject cycles, excessive depth and archived ancestors.",
        )}
      </Note>
      {data && !locked && (
        <div className="aa-actions">
          <button
            disabled={dirty || m.busy || conflict}
            onClick={() => setPicker("move")}
          >
            {t("نقل", "Move")}
          </button>
          <button
            disabled={dirty || m.busy || conflict || !data.parentId}
            onClick={() => {
              setParent(null);
              setConfirm("move");
            }}
          >
            {t("نقل إلى الجذر", "Move to root")}
          </button>
          <button
            className="danger"
            disabled={dirty || m.busy || conflict}
            onClick={() => setConfirm("archive")}
          >
            {t("أرشفة", "Archive")}
          </button>
        </div>
      )}
      {picker && (
        <SkillPicker
          exclude={data ? [data.id] : []}
          onClose={() => setPicker(null)}
          onChoose={(s) => {
            if (s.ancestors.length >= 7) {
              m.setError({ status: 400, code: "SKILL_DEPTH_EXCEEDED" });
              setPicker(null);
              return;
            }
            setParent(s);
            if (picker === "move") setConfirm("move");
            else onDirty(true);
            setPicker(null);
          }}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === "reload"
              ? t("استبدال التعديلات المحلية؟", "Replace local edits?")
              : confirm === "archive"
                ? t("أرشفة المهارة؟", "Archive skill?")
                : t("نقل المهارة؟", "Move skill?")
          }
          onClose={() => setConfirm(null)}
          busy={m.busy}
          action={t("تأكيد", "Confirm")}
          danger
          onConfirm={() => {
            if (confirm === "reload") {
              if (!fresh) return;
              setData(fresh);
              setSlug(fresh.slug);
              setTranslations(fresh.translations);
              setParent(null);
              onDirty(false);
              onRecovered?.();
              m.setError(null);
              setUnconfirmed(false);
              setConfirm(null);
              return;
            }
            void m
              .run<unknown>(`admin/skills/${data!.id}/${confirm}`, "POST", {
                expectedRevision: data!.editRevision,
                ...(confirm === "move" ? { parentId: parent?.id ?? null } : {}),
              })
              .then((r) => {
                if (r) {
                  if (
                    isSkillView(r, data, true) &&
                    (confirm === "archive"
                      ? r.status === "archived" && r.parentId === data!.parentId
                      : r.status === "active" &&
                        r.parentId === (parent?.id ?? null))
                  )
                    onSaved(r);
                  else {
                    setUnconfirmed(true);
                    m.setError(invalidAcknowledgement);
                  }
                }
                setConfirm(null);
              });
          }}
        >
          <p>
            {confirm === "reload"
              ? t(
                  "ستفقد التعديلات المحلية. راجعها أو انسخها قبل المتابعة.",
                  "Local edits will be lost. Review or copy them before continuing.",
                )
              : confirm === "archive"
                ? t(
                    "ستصبح المهارة للقراءة فقط. عناصر مسودات الاختبارات التي تثبّت إصدارات تتضمن هذه المهارة ضمن تصنيفها المثبّت أو كأحد أسلافه ستصبح غير مؤهلة لحفظ التكوين والنشر الجديد. لن تُحذف أو تُستبدل تلقائيًا؛ افحص الإصدارات المتأثرة واختر إزالتها أو استبدالها. لا يتيح العقد الحالي قائمة بالمسودات المتأثرة أو عددها. لا استعادة؛ يبقى التاريخ محفوظًا.",
                    "The skill becomes read only. Draft quiz items pinning revisions that depend on this skill, including it as a snapshotted ancestor, become ineligible for composition saves and new publication. They are not removed or replaced automatically; inspect affected revisions and explicitly remove or replace them. The current API cannot list or count affected drafts. No restore; history is retained.",
                  )
                : parent
                  ? skillPath(parent, locale)
                  : t("الجذر", "Root")}
          </p>
        </Modal>
      )}
    </>
  );
}
