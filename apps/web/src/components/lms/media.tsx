"use client";
import { useEffect, useRef, useState } from "react";
import { lms, useLms } from "@/lib/lms-client";
import type { Locale } from "@/i18n/config";

type Asset = { id: string; title: string; bytes: number; status: string; scanState: string; downloadsAllowed: boolean };
type Capability = { url: string; expiresAt: string; expiresIn: number };
const labels = {
  ar: {
    title: "مواد الدرس — تجربة الملفات الخاصة", upload: "رفع ملف نصي تجريبي", choose: "ملف TXT تجريبي فقط (حتى 6 ميبيبايت)",
    quarantine: "يبقى الملف محجوراً وغير منشور حتى اكتمال الفحص الحقيقي.", scan: "فحص الملف", publish: "نشر الملف",
    preview: "معاينة محمية", download: "تنزيل", close: "إغلاق", renew: "تجديد الوصول",
    empty: "لا توجد مواد متاحة.", error: "تعذّر إكمال العملية. قد يكون الوصول غير مسموح أو خدمة الفحص غير جاهزة.",
    uploading: "جارٍ الرفع…", ready: "اكتملت العملية.", private: "صلاحية الوصول حتى ١٢٠ ثانية؛ يُعاد التحقق عند كل تجديد.",
    states: { pending: "بانتظار الفحص", scanning: "جارٍ الفحص", clean: "سليم", rejected: "مرفوض", failed: "تعذّر الفحص", draft: "غير منشور", published: "منشور" } as Record<string, string>,
  },
  en: {
    title: "Lesson materials — private-file pilot", upload: "Upload a synthetic text file", choose: "Synthetic TXT only (up to 6 MiB)",
    quarantine: "Files remain quarantined and unpublished until a genuine scan succeeds.", scan: "Scan file", publish: "Publish file",
    preview: "Protected preview", download: "Download", close: "Close", renew: "Renew access",
    empty: "No materials available.", error: "The operation could not complete. Access may be denied or the scanner may be unavailable.",
    uploading: "Uploading…", ready: "Operation completed.", private: "Access lasts at most 120 seconds; every renewal rechecks authorization.",
    states: { pending: "Awaiting scan", scanning: "Scanning", clean: "Clean", rejected: "Rejected", failed: "Scan unavailable", draft: "Unpublished", published: "Published" } as Record<string, string>,
  },
};

async function privatePut(url: string, bytes: Blob) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== "saudisensei-dev-media-pilot-2026.s3.eu-north-1.amazonaws.com") throw new Error("UPLOAD_FAILED");
  const r = await fetch(url, { method: "PUT", body: bytes, credentials: "omit",
    headers: { "Content-Type": "text/plain" } });
  if (!r.ok) throw new Error("UPLOAD_FAILED");
  return r.headers.get("ETag");
}
export function AdminLessonMedia({ locale, lessonId, readOnly }: { locale: Locale; lessonId: string; readOnly: boolean }) {
  const t = labels[locale], query = useLms<{ items: Asset[] }>(`admin/lessons/${lessonId}/media`);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function action(asset: Asset, kind: "scan" | "publish") {
    setBusy(true); setMessage("");
    try {
      const result = await lms(`admin/media/${asset.id}/${kind}`, { method: "POST", body: {} });
      setMessage(result.ok ? t.ready : t.error);
    } finally { setBusy(false); await query.reload(); }
  }
  async function upload() {
    if (!file || busy) return;
    setBusy(true); setMessage("");
    try {
      if (!file.name.toLowerCase().endsWith(".txt") || !file.size || file.size > 6 * 1024 * 1024) throw new Error("INVALID_FILE");
      const multipart = file.size > 5 * 1024 * 1024;
      const issued = await lms<{ sessionId: string; uploadUrl?: string }>(`admin/lessons/${lessonId}/media/uploads`, {
        method: "POST", body: { title: file.name, bytes: file.size, mimeType: "text/plain", method: multipart ? "multipart" : "single" },
      });
      if (!issued.ok) throw new Error("UPLOAD_DENIED");
      const parts: { partNumber: number; etag: string }[] = [];
      if (!multipart) {
        if (!issued.data.uploadUrl) throw new Error("UPLOAD_DENIED");
        await privatePut(issued.data.uploadUrl, file);
      } else {
        for (let partNumber = 1; partNumber <= 2; partNumber++) {
          const signed = await lms<{ uploadUrl: string }>(`admin/media/uploads/${issued.data.sessionId}/parts`, {
            method: "POST", body: { partNumber },
          });
          if (!signed.ok) throw new Error("UPLOAD_DENIED");
          const start = (partNumber - 1) * 5 * 1024 * 1024;
          const etag = await privatePut(signed.data.uploadUrl, file.slice(start, Math.min(start + 5 * 1024 * 1024, file.size)));
          if (!etag) throw new Error("UPLOAD_FAILED");
          parts.push({ partNumber, etag });
        }
      }
      const completed = await lms(`admin/media/uploads/${issued.data.sessionId}/complete`, {
        method: "POST", body: multipart ? { parts } : {},
      });
      if (!completed.ok) throw new Error("UPLOAD_FAILED");
      setFile(undefined); if (input.current) input.current.value = "";
      setMessage(t.ready);
    } catch { setMessage(t.error); }
    finally { setBusy(false); await query.reload(); }
  }
  return <section className="panel stack" data-testid="admin-lesson-media">
    <h2 className="panel-title">{t.title}</h2><p>{t.quarantine}</p>
    {!readOnly && <div className="stack">
      <label>{t.choose}<input ref={input} data-testid="media-file" type="file" accept=".txt,text/plain" disabled={busy} onChange={e => setFile(e.target.files?.[0])} /></label>
      <button className="btn primary" data-testid="media-upload" disabled={!file || busy} onClick={() => void upload()}>{busy ? t.uploading : t.upload}</button>
    </div>}
    <p role="status" aria-live="polite">{message || (query.error ? t.error : "")}</p>
    {query.data?.items.length === 0 && <p>{t.empty}</p>}
    {query.data?.items.map(asset => <div className="stack" key={asset.id} data-testid="media-admin-item">
      <strong dir="auto">{asset.title}</strong>
      <span>{t.states[asset.status]} — {t.states[asset.scanState]}</span>
      {!readOnly && asset.status === "draft" && <div className="actions">
        {["pending", "failed"].includes(asset.scanState) && <button className="btn" data-testid="media-scan" disabled={busy} onClick={() => void action(asset, "scan")}>{t.scan}</button>}
        {asset.scanState === "clean" && <button className="btn primary" data-testid="media-publish" disabled={busy} onClick={() => void action(asset, "publish")}>{t.publish}</button>}
      </div>}
    </div>)}
  </section>;
}
export function StudentLessonMedia({ locale, lessonId }: { locale: Locale; lessonId: string }) {
  const t = labels[locale], query = useLms<{ items: Asset[] }>(`lessons/${lessonId}/media`);
  const [selected, setSelected] = useState<Asset>(), [text, setText] = useState(""), [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedRef = useRef<Asset | undefined>(undefined);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function clearPreview() {
    sequence.current++; clearTimeout(timer.current); clearTimeout(expiryTimer.current);
    selectedRef.current = undefined; setSelected(undefined); setText(""); setBusy(false);
  }
  async function preview(asset: Asset) {
    const mine = ++sequence.current;
    clearTimeout(timer.current); clearTimeout(expiryTimer.current);
    selectedRef.current = asset; setSelected(asset); setBusy(true); setError(false);
    // Never keep previously fetched material visible across a failed renewal.
    setText("");
    try {
      const access = await lms<Capability>(`media/${asset.id}/access`, { method: "POST", body: { mode: "preview" } });
      if (!access.ok) throw new Error("ACCESS_DENIED");
      const response = await fetch(access.data.url, { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error("ACCESS_DENIED");
      const body = await response.text();
      if (mine !== sequence.current) return;
      setText(body);
      const remaining = Date.parse(access.data.expiresAt) - Date.now();
      if (remaining <= 0) throw new Error("ACCESS_EXPIRED");
      expiryTimer.current = setTimeout(() => { if (mine === sequence.current) setText(""); }, remaining);
      timer.current = setTimeout(() => { if (mine === sequence.current) void preview(asset); }, Math.max(1000, remaining - 20000));
    } catch {
      if (mine === sequence.current) { clearPreview(); setError(true); }
    } finally { if (mine === sequence.current) setBusy(false); }
  }
  async function download(asset: Asset) {
    setError(false);
    const result = await lms<Capability>(`media/${asset.id}/access`, { method: "POST", body: { mode: "download" } });
    if (!result.ok) { setError(true); return; }
    const a = document.createElement("a");
    a.href = result.data.url; a.rel = "noreferrer"; a.referrerPolicy = "no-referrer";
    a.click(); // Capability never persisted in localStorage or rendered as text.
  }
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && selectedRef.current) void preview(selectedRef.current); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => {
      sequence.current++; clearTimeout(timer.current); clearTimeout(expiryTimer.current);
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  // A lesson change invalidates all in-flight fetches and capabilities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);
  useEffect(() => { clearPreview(); setError(false); }, [lessonId]);
  return <section className="panel stack" data-testid="student-lesson-media">
    <h2 className="panel-title">{t.title}</h2><p>{t.private}</p>
    {(error || query.error) && <p role="alert">{t.error}</p>}
    {query.data?.items.length === 0 && <p>{t.empty}</p>}
    {query.data?.items.map(asset => <div className="actions" key={asset.id} data-testid="media-student-item">
      <strong dir="auto">{asset.title}</strong>
      <button className="btn" data-testid="media-preview" disabled={busy} onClick={() => void preview(asset)}>{t.preview}</button>
      {asset.downloadsAllowed && <button className="btn" data-testid="media-download" onClick={() => void download(asset)}>{t.download}</button>}
    </div>)}
    {selected && <div className="stack">
      <div className="actions"><button className="btn" data-testid="media-renew" disabled={busy} onClick={() => void preview(selected)}>{t.renew}</button>
        <button className="btn" onClick={clearPreview}>{t.close}</button></div>
      <pre dir="auto" data-testid="media-preview-text" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</pre>
    </div>}
  </section>;
}
