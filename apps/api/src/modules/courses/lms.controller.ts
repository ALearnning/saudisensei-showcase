import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { RequireRoles } from "../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { CoursesService } from "./courses.service.js";
import { StructureService } from "./structure.service.js";
import { LmsQueries } from "../dashboards/lms.queries.js";
import { EnrollmentsService } from "../enrollments/enrollments.service.js";
import { LearningService } from "../progress/learning.service.js";
import * as s from "./lms.schemas.js";

@Controller("admin")
@RequireRoles("admin")
export class LmsAdminController {
  constructor(@Inject(CoursesService) private readonly courses: CoursesService,
    @Inject(StructureService) private readonly structure: StructureService,
    @Inject(LmsQueries) private readonly queries: LmsQueries,
    @Inject(EnrollmentsService) private readonly enrollments: EnrollmentsService) {}
  @Get("dashboard") dashboard() { return this.queries.adminDashboard(); }
  @Get("courses") list(@Query() query: unknown) { return this.queries.adminCourses(s.parse(s.listInput, query)); }
  @Post("courses") create(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.courses.create(req, s.parse(s.courseCreate, body)); }
  @Get("courses/:courseId") get(@Param("courseId") id: string) { return this.courses.get(s.parse(s.uuid, id)); }
  @Patch("courses/:courseId") edit(@Req() req: AuthenticatedRequest, @Param("courseId") id: string, @Body() body: unknown) {
    return this.courses.edit(s.parse(s.uuid, id), req, s.parse(s.courseEdit, body));
  }
  @Post("courses/:courseId/publish") publish(@Req() req: AuthenticatedRequest, @Param("courseId") id: string, @Body() body: unknown) {
    return this.courses.transition(s.parse(s.uuid, id), req, s.parse(s.revisionInput, body).expectedRevision, "published");
  }
  @Post("courses/:courseId/unpublish") unpublish(@Req() req: AuthenticatedRequest, @Param("courseId") id: string, @Body() body: unknown) {
    return this.courses.transition(s.parse(s.uuid, id), req, s.parse(s.revisionInput, body).expectedRevision, "draft");
  }
  @Post("courses/:courseId/archive") archive(@Req() req: AuthenticatedRequest, @Param("courseId") id: string, @Body() body: unknown) {
    return this.courses.transition(s.parse(s.uuid, id), req, s.parse(s.revisionInput, body).expectedRevision, "archived");
  }
  @Post("courses/:courseId/chapters") chapterCreate(@Req() req: AuthenticatedRequest, @Param("courseId") id: string, @Body() body: unknown) {
    return this.structure.createChapter(s.parse(s.uuid, id), req, s.parse(s.chapterCreate, body));
  }
  @Get("chapters/:chapterId") chapter(@Param("chapterId") id: string) { return this.structure.chapter(s.parse(s.uuid, id)); }
  @Patch("chapters/:chapterId") chapterEdit(@Req() req: AuthenticatedRequest, @Param("chapterId") id: string, @Body() body: unknown) {
    return this.structure.editChapter(s.parse(s.uuid, id), req, s.parse(s.chapterEdit, body));
  }
  @Post("chapters/:chapterId/lessons") lessonCreate(@Req() req: AuthenticatedRequest, @Param("chapterId") id: string, @Body() body: unknown) {
    return this.structure.createLesson(s.parse(s.uuid, id), req, s.parse(s.lessonCreate, body));
  }
  @Get("lessons/:lessonId") lesson(@Param("lessonId") id: string) { return this.structure.lesson(s.parse(s.uuid, id)); }
  @Patch("lessons/:lessonId") lessonEdit(@Req() req: AuthenticatedRequest, @Param("lessonId") id: string, @Body() body: unknown) {
    return this.structure.editLesson(s.parse(s.uuid, id), req, s.parse(s.lessonEdit, body));
  }
  @Put("courses/:courseId/chapter-order") chapterOrder(@Req() req: AuthenticatedRequest, @Param("courseId") id: string, @Body() body: unknown) {
    return this.structure.reorder("chapter", s.parse(s.uuid, id), req, s.parse(s.orderInput, body));
  }
  @Put("chapters/:chapterId/lesson-order") lessonOrder(@Req() req: AuthenticatedRequest, @Param("chapterId") id: string, @Body() body: unknown) {
    return this.structure.reorder("lesson", s.parse(s.uuid, id), req, s.parse(s.orderInput, body));
  }
  @Get("students") students(@Query() query: unknown) { return this.queries.students(s.parse(s.listInput, query)); }
  @Get("students/:studentId") student(@Param("studentId") id: string) { return this.queries.student(s.parse(s.uuid, id)); }
  @Get("enrollments") enrollmentList(@Query() query: unknown) { return this.queries.enrollments(s.parse(s.listInput, query)); }
  @Post("enrollments") grant(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = s.parse(s.enrollInput, body);
    return this.enrollments.grant(req, input.courseId, input.studentId);
  }
  @Patch("enrollments/:enrollmentId") revoke(@Req() req: AuthenticatedRequest, @Param("enrollmentId") id: string, @Body() body: unknown) {
    return this.enrollments.change(req, s.parse(s.uuid, id), s.parse(s.enrollmentEdit, body).status);
  }
}

@Controller()
@RequireRoles("student")
export class LmsStudentController {
  constructor(@Inject(LmsQueries) private readonly queries: LmsQueries, @Inject(LearningService) private readonly learning: LearningService) {}
  @Get("courses") courses(@Req() req: AuthenticatedRequest, @Query() query: unknown) { return this.queries.myCourses(req.user!.id, s.parse(s.listInput, query)); }
  @Get("courses/:courseId") course(@Req() req: AuthenticatedRequest, @Param("courseId") id: string) { return this.learning.course(req.user!.id, s.parse(s.uuid, id)); }
  @Get("me/enrollments") enrollments(@Req() req: AuthenticatedRequest, @Query() query: unknown) { return this.queries.enrollments(s.parse(s.listInput, query), req.user!.id); }
  @Get("me/courses/:courseId/progress") progress(@Req() req: AuthenticatedRequest, @Param("courseId") id: string) { return this.learning.getProgress(req.user!.id, s.parse(s.uuid, id)); }
  @Get("me/dashboard") dashboard(@Req() req: AuthenticatedRequest) { return this.queries.studentDashboard(req.user!.id); }
  @Get("lessons/:lessonId") lesson(@Req() req: AuthenticatedRequest, @Param("lessonId") id: string) { return this.learning.lesson(req.user!.id, s.parse(s.uuid, id)); }
  @Put("me/lessons/:lessonId/completion") complete(@Req() req: AuthenticatedRequest, @Param("lessonId") id: string, @Body() body: unknown) {
    s.parse(s.courseCreate.pick({}).strict(), body ?? {});
    return this.learning.complete(req.user!.id, s.parse(s.uuid, id));
  }
}
