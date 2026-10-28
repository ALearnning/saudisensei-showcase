import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <section className="card state warn rise" data-testid="status-notfound">
      <span className="icon-badge"><FileQuestion size={22} aria-hidden="true" /></span>
      <h1 lang="ar" dir="rtl">الصفحة غير موجودة</h1>
      <p className="lead" lang="en" dir="ltr">This page doesn&apos;t exist or is no longer available.</p>
      <div className="actions">
        <Link href="/ar/login" className="btn primary" lang="ar" data-testid="link-home-ar">العودة</Link>
        <Link href="/en/login" className="btn ghost" lang="en" data-testid="link-home-en">Go back</Link>
      </div>
    </section>
  );
}
