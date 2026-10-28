export const requiredAuthKeys = [
  "AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET", "AUTH0_AUDIENCE", "APP_BASE_URL",
] as const;

export function authIsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return requiredAuthKeys.every((key) => Boolean(env[key]));
}
