import { initDraft, syncDraft, type Draft, type DraftValues } from "@/lib/draft";
export const acknowledgeMediaSave = <T extends DraftValues>(values: T, revision: number) => initDraft(values, revision);
export function syncMediaDraft<T extends DraftValues>(current: Draft<T>, values: T, revision: number) {
  return revision < current.revision ? current : syncDraft(current, values, revision);
}
