import type { AnchorHTMLAttributes } from "react";
// Test harness only: render actual authoring components without Next/Auth0 or an API server.
export default function Link({
  prefetch: _prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
  return <a {...props} />;
}
export const usePathname = () => location.pathname;
export const useRouter = () => ({
  replace: (url: string) => location.replace(url),
  push: (url: string) => location.assign(url),
});
