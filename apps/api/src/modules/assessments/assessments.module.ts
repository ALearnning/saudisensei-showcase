import { Module } from "@nestjs/common";
import { LmsModule } from "../courses/lms.module.js";
import { AssessmentAccessService } from "./assessment-access.service.js";
import { SkillsController } from "./skills/skills.controller.js";
import { SkillsService } from "./skills/skills.service.js";
import { QuestionBankController } from "./question-bank/question-bank.controller.js";
import { QuestionBankService } from "./question-bank/question-bank.service.js";
import { QuizzesController } from "./quizzes/quizzes.controller.js";
import { QuizzesService } from "./quizzes/quizzes.service.js";
import { AttemptsController } from "./attempts/attempts.controller.js";
import { StudentQuizzesController } from "./attempts/student-quizzes.controller.js";
import { AttemptsService } from "./attempts/attempts.service.js";
import { AssessmentDeadlineService } from "./attempts/assessment-deadline.service.js";
import { AssessmentRateGuard } from "./assessment-rate.guard.js";
import { AssessmentGradingService } from "./grading/assessment-grading.service.js";
import { AssessmentResultsService } from "./grading/results.service.js";
import { AssessmentResultsController } from "./grading/results.controller.js";

/** Authoring, attempts and deterministic results/review; no telemetry collection or AI. */
@Module({
  imports: [LmsModule],
  controllers: [SkillsController, QuestionBankController, QuizzesController, AttemptsController, StudentQuizzesController, AssessmentResultsController],
  providers: [AssessmentAccessService, SkillsService, QuestionBankService, QuizzesService,
    AttemptsService, AssessmentDeadlineService, AssessmentRateGuard, AssessmentGradingService, AssessmentResultsService],
  exports: [AssessmentAccessService],
})
export class AssessmentsModule {}
