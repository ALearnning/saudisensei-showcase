"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen, ListChecks, Network } from "lucide-react";
import { Context, FailureView, Head } from "./common";
import { AssessmentTransport, type Failure } from "./transport";
import { href, type Locale, type Route } from "./model";
import { QuestionBank } from "./bank";
import { QuestionEditor } from "./question";
import { Skills } from "./skills";
import { Quizzes } from "./quizzes";
import { QuizEditor } from "./builder";
import "./assessments.css";

export function AssessmentWorkspace({
  locale,
  route,
}: {
  locale: Locale;
  route: Route;
}) {
  const [denied, setDenied] = useState<Failure | null>(null);
  const [api] = useState(() => new AssessmentTransport(setDenied));
  const value = useMemo(
    () => ({
      locale,
      api,
      t: (ar: string, en: string) => (locale === "ar" ? ar : en),
    }),
    [locale, api],
  );
  const { t } = value;
  const areas = [
    {
      path: "question-bank",
      title: t("بنك الأسئلة", "Question Bank"),
      detail: t(
        "محتوى موثوق، وإصدارات محددة لكل سؤال.",
        "Author reusable questions with precise revision history.",
      ),
      Icon: BookOpen,
    },
    {
      path: "skills",
      title: t("المهارات", "Skills"),
      detail: t(
        "نظّم المعرفة في هيكل واضح للمؤلفين.",
        "Organize the taxonomy behind your question bank.",
      ),
      Icon: Network,
    },
    {
      path: "quizzes",
      title: t("الاختبارات", "Quizzes"),
      detail: t(
        "كوّن الاختبار وراجع سياسته قبل نشره.",
        "Compose, review policy and deliberately publish.",
      ),
      Icon: ListChecks,
    },
  ];
  const section =
    route.kind === "question" || route.kind === "bank"
      ? "question-bank"
      : route.kind === "quiz" || route.kind === "quizzes"
        ? "quizzes"
        : route.kind;
  return (
    <Context.Provider value={value}>
      <div
        className="assessment-workspace"
        dir={locale === "ar" ? "rtl" : "ltr"}
        lang={locale}
      >
        <a className="aa-skip" href="#assessment-content">
          {t("تجاوز إلى محتوى التقييمات", "Skip to assessment content")}
        </a>
        <nav
          className="aa-subnav"
          aria-label={t("مساحة التقييمات", "Assessment workspace")}
        >
          <Link
            href={href(locale)}
            aria-current={route.kind === "home" ? "page" : undefined}
          >
            {t("التقييمات", "Assessments")}
          </Link>
          {areas.map(({ path, title, Icon }) => (
            <Link
              key={path}
              href={href(locale, path)}
              aria-current={section === path ? "page" : undefined}
            >
              <Icon size={17} aria-hidden="true" />
              {title}
            </Link>
          ))}
        </nav>
        <div id="assessment-content" tabIndex={-1}>
          {denied ? (
            <FailureView error={denied} />
          ) : route.kind === "home" ? (
            <>
              <div className="aa-hero">
                <Head
                  title={t(
                    "تأليف التقييمات، بثقة.",
                    "Author assessments with confidence.",
                  )}
                  lead={t(
                    "ابدأ بالسؤال، اربطه بالمهارة، ثم انشر اختبارًا بعد مراجعة إصداره وسياساته.",
                    "Start with a question, connect it to a skill, then review the revision and policies before publication.",
                  )}
                />
              </div>
              <div className="aa-grid three aa-landing">
                {areas.map(({ path, title, detail, Icon }) => (
                  <Link
                    className="aa-panel"
                    key={path}
                    href={href(locale, path)}
                  >
                    <Icon aria-hidden="true" />
                    <div>
                      <h2>{title}</h2>
                      <p>{detail}</p>
                    </div>
                    <span>{t("فتح المساحة", "Open workspace")} →</span>
                  </Link>
                ))}
              </div>
            </>
          ) : route.kind === "bank" ? (
            <QuestionBank />
          ) : route.kind === "question" ? (
            <QuestionEditor key={route.id} id={route.id} />
          ) : route.kind === "skills" ? (
            <Skills />
          ) : route.kind === "quizzes" ? (
            <Quizzes />
          ) : (
            <QuizEditor
              key={`${route.scope}/${route.parent}/${route.id}`}
              id={route.id}
              scope={route.scope}
              parent={route.parent}
            />
          )}
        </div>
      </div>
    </Context.Provider>
  );
}
