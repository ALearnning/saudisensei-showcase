import { useId } from "react";
import type { Locale } from "@/i18n/config";

/** Approved original artwork, not course/progress data. */
export function LearningPath({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const gradient = useId();
  return <div className="sslg-art" role="img" aria-label={ar ? "مسار تعلّم متدرّج" : "A learning path with milestones"}>
    <div className="sslg-art-topline">
      <span className="sslg-art-kicker">{ar ? "مسار التعلّم" : "LEARNING PATH"}</span>
      <span className="sslg-art-index" dir="ltr">01 — 03</span>
    </div>
    <svg className="sslg-path-svg" viewBox="0 0 500 330" fill="none" aria-hidden="true">
      <path d="M74 248H173V174H291V100H420" stroke="rgba(241,220,184,.68)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M74 248H173V174H291V100H420" stroke={`url(#${gradient})`} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 16" />
      <circle cx="74" cy="248" r="28" fill="#174F4A" stroke="#E8AE7A" strokeWidth="2" />
      <circle cx="74" cy="248" r="8" fill="#E8AE7A" />
      <circle cx="173" cy="174" r="28" fill="#E8AE7A" />
      <path d="M166 174h14M173 167v14" stroke="#174F4A" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="291" cy="100" r="28" fill="#174F4A" stroke="rgba(246,236,212,.72)" strokeWidth="2" />
      <path d="m284 100 5 5 10-11" stroke="#E8AE7A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="420" cy="100" r="35" fill="#F4E5D5" />
      <circle cx="420" cy="100" r="24" fill="#D57A43" />
      <path d="m414 100 5 5 10-11" stroke="#FFF8EA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M35 72h75M395 260h55M344 42h35" stroke="rgba(241,220,184,.23)" strokeWidth="1" />
      <path d="m115 68 6 4-6 4M383 38l6 4-6 4" stroke="#E8AE7A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="137" y="265" width="6" height="6" rx="1.5" transform="rotate(45 137 265)" fill="#D57A43" />
      <rect x="347" y="148" width="6" height="6" rx="1.5" transform="rotate(45 347 148)" fill="#A8B8A8" />
      <defs><linearGradient id={gradient} x1="74" y1="248" x2="420" y2="100" gradientUnits="userSpaceOnUse">
        <stop stopColor="#E8AE7A" /><stop offset="1" stopColor="#E8AE7A" stopOpacity=".15" />
      </linearGradient></defs>
    </svg>
    <div className="sslg-art-foot"><span className="sslg-art-diamond" /><span>{ar ? "تقدّمك يصنع طريقك" : "Progress makes your path"}</span></div>
    <span className="sslg-art-label sslg-art-label-start">{ar ? "البداية" : "BEGIN"}</span>
    <span className="sslg-art-label sslg-art-label-end">{ar ? "إنجاز جديد" : "NEXT MILESTONE"}</span>
  </div>;
}
