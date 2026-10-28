import type { PrismaClient } from "@workspace/saudisensei-database";
import { assertProductionData, type ProductionProfile } from "@workspace/saudisensei-runtime-config";

/** Read-only startup preflight. No migrations, grants, data repair or deletion. */
export async function verifyProductionData(db: PrismaClient, profile: ProductionProfile): Promise<void> {
  try {
    const identityIssuer = `${new URL(profile.auth0.domain.startsWith("https://")
      ? profile.auth0.domain : `https://${profile.auth0.domain}`).origin}/`;
    const [marker] = await db.$queryRaw<{ environment: string | null; database: string }[]>`
      SELECT current_setting('saudisensei.environment', true) AS environment,
             current_database() AS database`;
    if (!marker || marker.environment !== "production") throw new Error();
    const [fixtureCourses, legacyMedia, pilotVideos, pilotRevisions, foreignIdentities, renditions, uploads] = await Promise.all([
      db.course.count({ where: { title: { contains: "TEST ONLY", mode: "insensitive" } } }),
      db.mediaAsset.count(),
      db.videoPilotAsset.count(),
      db.mediaRevision.count({ where: { OR: [
        { AND: [{ objectKey: { not: null } }, { NOT: { objectKey: { startsWith: "production/library/" } } }] },
        { providerRef: { in: profile.development.streamReferences } },
      ] } }),
      db.userIdentity.count({ where: { issuer: { not: identityIssuer } } }),
      db.mediaRendition.count({ where: { locator: { startsWith: "pilot/" } } }),
      db.mediaProcessingUpload.count({ where: { OR: [
        { sourceKey: { startsWith: "pilot/" } }, { stagingKey: { startsWith: "pilot/" } },
      ] } }),
    ]);
    assertProductionData(profile, { ...marker, fixtureCourses, legacyMedia, pilotVideos, pilotRevisions,
      foreignIdentities, foreignMedia: renditions + uploads });
  } catch { throw new Error("PRODUCTION_DATA_ISOLATION_INVALID"); }
}
