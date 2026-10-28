import { Module } from "@nestjs/common";
import { prisma } from "@workspace/saudisensei-database";
import { LMS_DATABASE, LmsStore } from "./lms.store.js";
import { CoursesService } from "./courses.service.js";
import { StructureService } from "./structure.service.js";
import { LmsAdminController, LmsStudentController } from "./lms.controller.js";
import { EnrollmentsService } from "../enrollments/enrollments.service.js";
import { ProgressService } from "../progress/progress.service.js";
import { LearningService } from "../progress/learning.service.js";
import { LmsQueries } from "../dashboards/lms.queries.js";
@Module({
  controllers: [LmsAdminController, LmsStudentController],
  providers: [{ provide: LMS_DATABASE, useValue: prisma }, LmsStore, CoursesService, StructureService,
    EnrollmentsService, ProgressService, LearningService, LmsQueries],
  // Narrow shared infrastructure/policy seam; assessments never use mutate()
  // or receive a progress/completion writer through this module.
  exports: [LmsStore, EnrollmentsService],
})
export class LmsModule {}
