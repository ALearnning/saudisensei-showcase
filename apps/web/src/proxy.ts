import { NextRequest, NextResponse } from "next/server";
import { getAuth0 } from "./lib/auth0";
import { isSupportedAuthReturnPath, resolveLogoutReturnTo } from "./lib/auth-navigation";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/") return NextResponse.redirect(new URL("/ar/login", request.url));
  if (path.startsWith("/auth/")) {
    const auth0 = getAuth0();
    if (!auth0) return NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED", message: "Auth0 setup is required. No alternate login is enabled." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
    // Only permit the supported local return targets, never an arbitrary URL.
    const target = request.nextUrl.searchParams.get("returnTo");
    if (target !== null && !isSupportedAuthReturnPath(target)) {
      return NextResponse.json({ code: "INVALID_RETURN_TARGET" }, { status: 400 });
    }
    if (path === "/auth/logout") {
      const logoutRequest = new NextRequest(request);
      logoutRequest.nextUrl.searchParams.set("returnTo", resolveLogoutReturnTo(target, process.env.APP_BASE_URL!));
      return auth0.middleware(logoutRequest);
    }
    return auth0.middleware(request);
  }
  const auth0 = getAuth0();
  return auth0 ? auth0.middleware(request) : NextResponse.next();
}
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
