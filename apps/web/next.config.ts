import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants";
import { assertProductionConfiguration } from "@workspace/saudisensei-runtime-config";

const config: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["**.replit.dev", "**.replit.com"],
  transpilePackages: ["@workspace/saudisensei-api-client"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default function nextConfig(phase: string): NextConfig {
  // Framework-supplied phase, not an environment-variable bypass. Builds remain
  // secret-free; actual Next start/dev processes validate before serving.
  if (phase === PHASE_PRODUCTION_SERVER) {
    if (process.env.NODE_ENV !== "production") throw new Error("PRODUCTION_CONFIGURATION_INVALID");
    assertProductionConfiguration("web");
  } else if (phase === PHASE_DEVELOPMENT_SERVER) {
    if (process.env.NODE_ENV === "production") throw new Error("PRODUCTION_CONFIGURATION_INVALID");
    assertProductionConfiguration("web");
  }
  return config;
}
