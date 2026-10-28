import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { authIsConfigured } from "./auth-config";
import { NextResponse } from "next/server";
import { resolveCallbackReturnTo } from "./auth-navigation";

let client: Auth0Client | undefined;
export function getAuth0(): Auth0Client | null {
  if (!authIsConfigured()) return null;
  client ??= new Auth0Client({
    enableAccessTokenEndpoint: false,
    onCallback: async (error, context) => {
      if (error) {
        // Never render provider diagnostics: they can contain configured claims/URLs.
        return NextResponse.json({ code: "AUTH_CALLBACK_FAILED" }, {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return NextResponse.redirect(resolveCallbackReturnTo(context.returnTo, process.env.APP_BASE_URL!));
    },
    authorizationParameters: {
      audience: process.env.AUTH0_AUDIENCE,
      scope: "openid profile email offline_access",
    },
    session: {
      absoluteDuration: 60 * 60 * 8,
      inactivityDuration: 60 * 30,
      cookie: { secure: process.env.NODE_ENV === "production", sameSite: "lax" },
    },
  });
  return client;
}
