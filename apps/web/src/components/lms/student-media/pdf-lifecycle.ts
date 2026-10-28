type LoadingOwner = { destroy(): void | Promise<void> };

/** Only the loading task owns disposal; document proxies are not destroyed twice. */
export function pdfTaskCleanup(owner: () => LoadingOwner | null): () => void {
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    try { void Promise.resolve(owner()?.destroy()).catch(() => undefined); }
    catch { /* teardown must not crash the page or expose worker errors */ }
  };
}
