"use client";
import { useEffect, useState } from "react";
import { editDraft, initDraft, isDirty, type Draft, type DraftValues } from "@/lib/draft";
import { acknowledgeMediaSave, syncMediaDraft } from "./media-draft";
/** Only media editors acknowledge their own successful save. Peer refreshes must
 * still preserve dirty drafts and their original optimistic base revision. */
export function useMediaDraft<T extends DraftValues>(server: T, revision: number) {
  const [draft, setDraft] = useState<Draft<T>>(() => initDraft(server, revision));
  const sig = JSON.stringify(server);
  useEffect(() => { setDraft(d => syncMediaDraft(d, JSON.parse(sig) as T, revision)); }, [sig, revision]);
  return { draft, values: draft.values, dirty: isDirty(draft),
    edit: (p: Partial<T>) => setDraft(d => editDraft(d, p)),
    accept: (v: T, r: number) => setDraft(acknowledgeMediaSave(v, r)) };
}
