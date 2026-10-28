import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { AssessmentWorkspace } from "../../../src/components/lms/assessments/workspace";
import { parseRoute } from "../../../src/components/lms/assessments/model";
import { Shell } from "../../../src/components/Shell";
import "../../../src/app/globals.css";
const parts = location.pathname.split("/").filter(Boolean);
const locale = parts[0] === "ar" ? "ar" : "en";
const route = parseRoute(parts.slice(3));
document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell locale={locale}>
      {route && <AssessmentWorkspace locale={locale} route={route} />}
    </Shell>
  </StrictMode>,
);
