import type { AnchorHTMLAttributes } from "react";
import type { Locale } from "./config";
import { getLms } from "./lms";
export type LmsLesson = { id: string; courseId: string; chapterId: string; position: number; title: string; body: string; completed: boolean; isRequired: boolean };
export type LmsCourse = { id: string; title: string; chapters: {id: string; title: string; position: number; lessons: LmsLesson[]}[] };
export type LmsProgress = { percentage: number; completedRequired: number; totalRequired: number; isCompleted: boolean };
export type ApiFailure = { status: number; code?: string };
export function Link({href, ...props}: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} href={href?.startsWith("#") ? href : "#preview"} onClick={e=>{if(!href?.startsWith("#")) e.preventDefault();}} />; }
export const getCatalog = (_locale: Locale) => ({brand:"SaudiSensei"});
export const fmt = (text: string, values: Record<string, number>) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key));
export const paths = {lesson: (_locale:Locale,_course:string,id:string)=>`#${id}`,student:(_locale:Locale)=>"#preview",myCourses:(_locale:Locale)=>"#preview",course:(_locale:Locale,_id:string)=>"#preview"};
export function ReqTag({required, locale}:{required:boolean;locale:Locale}) {const t=getLms(locale).common;return <span className={`tag ${required?"req":"opt"}`}>{required?t.required:t.optional}</span>;}
export function ProgressBar({percentage,isCompleted,label,testId}:{percentage:number;isCompleted:boolean;label?:string;testId?:string}) {const p=isCompleted?100:Math.min(99,Math.floor(percentage));return <div className="progress" data-testid={testId}><div className="progress-row"><strong className="progress-num"><bdi>{p}%</bdi></strong>{label&&<span className="progress-label">{label}</span>}</div><div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}><span className={`fill${isCompleted?" done":""}`} style={{transform:`scaleX(${p/100})`}} /></div></div>;}
export function Skeleton({rows=3}:{rows?:number}) {return <div aria-busy="true">{Array.from({length:rows},(_,i)=><div className="skeleton" key={i}/>)}</div>;}
export function ErrorState({error,locale,onRetry}:{error:ApiFailure;locale:Locale;onRetry?:()=>void}) {return <p role="alert">{error.status}<button onClick={onRetry}>{getLms(locale).common.retry}</button></p>;}
export function MutationError({error}:{error:ApiFailure|null;locale:Locale}) {return error?<p role="alert">{error.status}</p>:null;}
