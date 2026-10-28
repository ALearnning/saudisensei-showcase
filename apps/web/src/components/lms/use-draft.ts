"use client";
import { useEffect, useState } from "react";
import { editDraft, initDraft, isDirty, syncDraft, type Draft, type DraftValues } from "@/lib/draft";

export function useDraft<T extends DraftValues>(server: T, revision: number) {
  const [draft, setDraft] = useState<Draft<T>>(() => initDraft(server, revision));
  const sig = JSON.stringify(server);
  useEffect(() => {
    setDraft((d) => syncDraft(d, JSON.parse(sig) as T, revision));
  }, [sig, revision]);
  return { draft, values: draft.values, dirty: isDirty(draft), edit: (p: Partial<T>) => setDraft((d) => editDraft(d, p)) };
}
