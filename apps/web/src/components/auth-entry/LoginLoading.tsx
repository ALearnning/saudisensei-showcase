"use client";
import { useParams } from "next/navigation";
import { LoginGateway } from "./LoginGateway";

export function LoginLoading() {
  const params = useParams<{ locale: string }>();
  return <LoginGateway locale={params.locale === "en" ? "en" : "ar"} state="loading" />;
}
