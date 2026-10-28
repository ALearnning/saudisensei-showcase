import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@workspace/saudisensei-database";
import type { ProductionProfile } from "@workspace/saudisensei-runtime-config";
import { verifyProductionData } from "../src/config/production-data.js";
import { processingKey } from "../src/modules/media/processing-s3.store.js";
import { S3MediaStore } from "../src/modules/media/s3-media.store.js";

const profile = {
  database: { name: "isolated" }, auth0: { domain: "production.example.invalid" },
  development: { streamReferences: ["synthetic-provider-reference"] },
} as ProductionProfile;
function database(environment: string | null = "production", dirty = false) {
  let queries = 0;
  const issuers: string[] = [];
  const count = async () => { queries++; return dirty ? 1 : 0; };
  return {
    client: {
      $queryRaw: async () => [{ environment, database: "isolated" }],
      course: { count }, mediaAsset: { count }, videoPilotAsset: { count },
      mediaRevision: { count }, userIdentity: { count: async (args: { where: { issuer: { not: string } } }) => {
        issuers.push(args.where.issuer.not); return count();
      } },
      mediaRendition: { count }, mediaProcessingUpload: { count },
    } as unknown as PrismaClient,
    queries: () => queries,
    issuers: () => issuers,
  };
}
test("unmarked database is rejected before fixture queries", async () => {
  const db = database(null);
  await assert.rejects(verifyProductionData(db.client, profile), { message: "PRODUCTION_DATA_ISOLATION_INVALID" });
  assert.equal(db.queries(), 0);
});
test("data preflight normalizes issuer casing and trailing slash consistently", async () => {
  const db = database();
  await verifyProductionData(db.client, { ...profile, auth0: {
    ...profile.auth0, domain: "https://PRODUCTION.EXAMPLE.INVALID/",
  } });
  assert.deepEqual(db.issuers(), ["https://production.example.invalid/"]);
});
test("clean marked database preflight is read-only", async () => {
  const db = database();
  await assert.doesNotReject(verifyProductionData(db.client, profile));
  assert.equal(db.queries(), 7);
});
test("marked database containing fixtures still fails closed", async () => {
  await assert.rejects(verifyProductionData(database("production", true).client, profile),
    { message: "PRODUCTION_DATA_ISOLATION_INVALID" });
});
test("database diagnostics cannot escape through the preflight", async () => {
  const db = { $queryRaw: async () => { throw new Error("DO_NOT_PRINT_CONNECTION_OR_QUERY"); } } as unknown as PrismaClient;
  await assert.rejects(verifyProductionData(db, profile), { message: "PRODUCTION_DATA_ISOLATION_INVALID" });
});
test("S3 production namespace rejects development keys and legacy pilot storage", async () => {
  const before = process.env.NODE_ENV;
  const ids = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/source";
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => processingKey(`pilot/library/${ids}`));
    assert.equal(processingKey(`production/library/${ids}`), `production/library/${ids}`);
    await assert.rejects(new S3MediaStore().upload(`pilot/media/${ids}`, 10, 120));
    process.env.NODE_ENV = "development";
    assert.equal(processingKey(`pilot/library/${ids}`), `pilot/library/${ids}`);
    assert.throws(() => processingKey(`production/library/${ids}`));
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
test("API refuses missing production configuration before connecting or listening", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../src/main.js", import.meta.url))], {
    env: { NODE_ENV: "production", AUTH0_SECRET: "DO_NOT_PRINT" }, encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("API startup failed") || result.stderr.includes("API startup failed"));
  assert.equal((result.stdout + result.stderr).includes("DO_NOT_PRINT"), false);
  assert.equal((result.stdout + result.stderr).includes("listening"), false);
});
