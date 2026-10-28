const supportedReturnPath = /^\/(ar|en)\/(login|student|admin)$/;

export function isSupportedAuthReturnPath(path: string): boolean {
  return supportedReturnPath.test(path);
}

export function resolveLogoutReturnTo(path: string | null, appBaseUrl: string): string {
  if (path !== null && !isSupportedAuthReturnPath(path)) throw new Error("INVALID_RETURN_TARGET");
  // The SDK forwards logout returnTo verbatim; Auth0 requires an absolute URI.
  return new URL(path ?? "/ar/login", appBaseUrl).toString();
}

export function resolveCallbackReturnTo(path: string | undefined, appBaseUrl: string): string {
  return new URL(path && isSupportedAuthReturnPath(path) ? path : "/ar/student", appBaseUrl).toString();
}
