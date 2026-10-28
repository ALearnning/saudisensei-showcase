import { Module } from "@nestjs/common";
import { prisma } from "@workspace/saudisensei-database";
import { LMS_DATABASE, LmsStore } from "../courses/lms.store.js";
import { MEDIA_STORAGE, S3MediaStore } from "./s3-media.store.js";
import { MEDIA_SCANNER, ClamAvScanner } from "./clamav.scanner.js";
import { MediaService } from "./media.service.js";
import { MediaAdminController, MediaStudentController } from "./media.controller.js";
import { VIDEO_PILOT_SIGNER, VideoPilotService, type VideoPilotSigner } from "./video-pilot.service.js";
import { CloudflareStreamPilot } from "./cloudflare-stream.pilot.js";
import { VideoPilotAdminController, VideoPilotStudentController } from "./video-pilot.controller.js";
import { MediaLibraryService } from "./library.service.js";
import { MediaLibraryAdminController, MediaLibraryStudentController } from "./library.controller.js";
import { MediaProcessingController } from "./processing.controller.js";
import { MediaProcessingService } from "./processing.service.js";
import { ProcessingJobsStore } from "./processing-jobs.store.js";
import { MediaProcessingWorker } from "./processing-worker.js";
import { PROCESSING_STORAGE, PROCESSING_SCANNER, PROCESSING_VIDEO } from "./processing.ports.js";
import { ProcessingS3Store } from "./processing-s3.store.js";
import { ProcessingClamAvScanner } from "./processing-clamav.scanner.js";
import { ProcessingCloudflareVideo } from "./processing-video.adapter.js";
import { MediaRenditionService } from "./rendition.service.js";
import { MediaAdminVideoService } from "./admin-video.service.js";
import { MediaStudentVideoService } from "./student-video.service.js";
import { MediaRenditionAdminController, MediaRenditionStudentController } from "./rendition.controller.js";
@Module({
  controllers: [MediaAdminController, MediaStudentController, VideoPilotAdminController, VideoPilotStudentController, MediaLibraryAdminController, MediaLibraryStudentController, MediaProcessingController, MediaRenditionAdminController, MediaRenditionStudentController],
  providers: [
    { provide: LMS_DATABASE, useValue: prisma }, LmsStore, MediaService, VideoPilotService, MediaLibraryService,
    { provide: MEDIA_STORAGE, useClass: S3MediaStore },
    { provide: MEDIA_SCANNER, useClass: ClamAvScanner },
    MediaProcessingService, ProcessingJobsStore, MediaProcessingWorker, MediaRenditionService, MediaAdminVideoService, MediaStudentVideoService,
    { provide: PROCESSING_STORAGE, useClass: ProcessingS3Store },
    { provide: PROCESSING_SCANNER, useClass: ProcessingClamAvScanner },
    { provide: PROCESSING_VIDEO, useFactory: () => new ProcessingCloudflareVideo() },
    { provide: VIDEO_PILOT_SIGNER, useFactory: (): VideoPilotSigner => ({
      playback: (reference, host, expiresAt) => new CloudflareStreamPilot({
        accountId: process.env.CLOUDFLARE_STREAM_ACCOUNT_ID ?? "",
        apiToken: process.env.CLOUDFLARE_STREAM_API_TOKEN ?? "",
        keyId: process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID ?? "",
        encodedJwk: process.env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK ?? "",
        origin: process.env.APP_BASE_URL ?? "",
      }).playback(reference, host, expiresAt),
    }) },
  ],
  exports: [MediaProcessingWorker],
})
export class MediaModule {}
