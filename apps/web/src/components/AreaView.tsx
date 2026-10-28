import { ShieldCheck, LogOut } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import type { AuthPageState } from "@/lib/protected-page";
import { LoginGateway } from "./auth-entry/LoginGateway";
import "./auth-entry/login.css";

export function AreaView({ locale, area, state }: { locale: Locale; area: "student" | "admin"; state: AuthPageState }) {
  const t = getCatalog(locale);
  const a = t.area;
  if (state.kind !== "authorized") {
    return <LoginGateway locale={locale} area={area} state={state.kind} />;
  }
  const { user } = state.data;
  const rows: [string, React.ReactNode, string][] = [
    [a.fields.name, user.displayName, "text-name"],
    [a.fields.email, <bdi key="e">{user.email}</bdi>, "text-email"],
    [a.fields.status, user.status, "text-status"],
    [a.fields.locale, user.preferredLocale, "text-locale"],
    [a.fields.roles, <span key="r" className="chips">{user.roles.map((r) => <span className="chip" key={r}>{r}</span>)}</span>, "text-roles"],
    [a.fields.id, <bdi key="i" className="mono">{user.id}</bdi>, "text-user-id"],
  ];
  return (
    <section className="card rise" data-testid={`status-authorized-${area}`}>
      <span className="pill ok"><ShieldCheck size={14} aria-hidden="true" />{a.verified} · {state.data.area}</span>
      <h1>{a[area].title}</h1>
      <p className="lead">{a[area].lead}</p>
      <dl className="facts">
        {rows.map(([k, v, id]) => (
          <div key={id} className="fact"><dt>{k}</dt><dd data-testid={id}>{v}</dd></div>
        ))}
      </dl>
      <div className="actions">
        <a href={`/auth/logout?returnTo=/${locale}/login`} className="btn ghost" data-testid="link-logout"><LogOut size={16} aria-hidden="true" />{t.login.signOut}</a>
      </div>
    </section>
  );
}
