// Editable draft bound to the course revision its fields were initialized from.
export type DraftValues = Record<string, string | boolean>;
export type Draft<T extends DraftValues> = { base: T; values: T; revision: number };

export function initDraft<T extends DraftValues>(values: T, revision: number): Draft<T> {
  return { base: { ...values }, values: { ...values }, revision };
}
export function isDirty<T extends DraftValues>(d: Draft<T>): boolean {
  return Object.keys(d.values).some((k) => d.values[k] !== d.base[k]);
}
export function editDraft<T extends DraftValues>(d: Draft<T>, patch: Partial<T>): Draft<T> {
  return { ...d, values: { ...d.values, ...patch } };
}
/** Background refresh: a dirty draft keeps its text AND its original revision; a clean one adopts server state. */
export function syncDraft<T extends DraftValues>(d: Draft<T>, server: T, revision: number): Draft<T> {
  if (isDirty(d)) return d;
  if (d.revision === revision && Object.keys(server).every((k) => server[k] === d.base[k])) return d;
  return initDraft(server, revision);
}
/** Explicit refresh (e.g. after a 409) discards local edits and re-binds to the latest revision. */
export const resetDraft = initDraft;
/** Outcome of the draft's own save: success re-binds to the saved server row; failure keeps typed values and baseline. */
export function settleDraft<T extends DraftValues>(d: Draft<T>, ok: boolean, server: T, revision: number): Draft<T> {
  return ok ? initDraft(server, revision) : d;
}
