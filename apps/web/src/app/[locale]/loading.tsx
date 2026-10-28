export default function Loading() {
  return (
    <div className="sk-wrap" aria-busy="true" data-testid="status-loading">
      <div className="skeleton" style={{ height: 56, maxWidth: 420 }} />
      <div className="skeleton tall" />
      <div className="skeleton tall" />
    </div>
  );
}
