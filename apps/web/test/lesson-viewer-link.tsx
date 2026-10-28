import type { AnchorHTMLAttributes } from "react";
/** Next routing boundary only in the isolated browser fixture. */
export default function FixtureLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
