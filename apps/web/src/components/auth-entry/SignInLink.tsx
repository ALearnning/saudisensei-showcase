"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { ArrowUpLeft, ArrowUpRight } from "lucide-react";
import type { Locale } from "@/i18n/config";

/** Normal document navigation: no interception, token handling or animation delay. */
export function SignInLink({ locale }: { locale: Locale }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const returned = () => setPending(false);
    window.addEventListener("pageshow", returned);
    return () => window.removeEventListener("pageshow", returned);
  }, []);
  function start(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && event.button === 0 &&
        !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setPending(true);
  }
  const ar = locale === "ar";
  return <>
    <a href={`/auth/login?returnTo=/${locale}/student`} className="sslg-primary"
      data-testid="link-login" onClick={start} aria-busy={pending}>
      <span className="sslg-button-label">{ar ? "تسجيل الدخول" : "Sign in"}</span>
      {pending ? <span className="sslg-progress-mark" aria-hidden="true" />
        : ar ? <ArrowUpLeft size={19} aria-hidden="true" /> : <ArrowUpRight size={19} aria-hidden="true" />}
    </a>
    <p className="sslg-transition" role="status" aria-live="polite">
      {pending ? (ar ? "جارٍ فتح صفحة تسجيل الدخول…" : "Opening sign-in…") : ""}
    </p>
  </>;
}
