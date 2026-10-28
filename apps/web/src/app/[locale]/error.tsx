"use client";
import { CloudOff, RotateCw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card state warn rise" role="alert" data-testid="status-error">
      <span className="icon-badge"><CloudOff size={22} aria-hidden="true" /></span>
      <h1 lang="ar" dir="rtl">تعذّر عرض الصفحة</h1>
      <p className="lead" lang="en" dir="ltr">Something went wrong while showing this page.</p>
      <div className="actions"><button type="button" className="btn primary" onClick={reset} data-testid="button-retry"><RotateCw size={16} aria-hidden="true" />إعادة المحاولة / Try again</button></div>
    </section>
  );
}
