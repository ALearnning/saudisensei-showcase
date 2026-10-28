"use client";
import { useParams } from "next/navigation";
import { LoginGateway } from "@/components/auth-entry/LoginGateway";
import "@/components/auth-entry/login.css";

/** Only login rendering failures; never prints provider/exception diagnostics. */
export default function LoginError({ reset }: { error: Error; reset: () => void }) {
  const params = useParams<{ locale: string }>();
  return <LoginGateway locale={params.locale === "en" ? "en" : "ar"} state="failure" onRetry={reset} />;
}
