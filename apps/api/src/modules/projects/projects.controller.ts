import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Res
} from "@nestjs/common";
import { Response } from "express";

import { AuthService } from "../auth/auth.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { HumanDecisionDto } from "./dto/human-decision.dto";
import { SubmitProjectDto } from "./dto/submit-project.dto";
import { UpdateVersionDto } from "./dto/update-version.dto";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projectsService: ProjectsService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  @Get()
  list(@Headers("x-user-id") userId?: string) {
    return this.projectsService.listProjects(this.authService.requireSession(userId));
  }

  @Post()
  create(@Headers("x-user-id") userId: string | undefined, @Body() body: CreateProjectDto) {
    return this.projectsService.createProject(this.authService.requireSession(userId), body);
  }

  @Get(":projectId")
  detail(@Headers("x-user-id") userId: string | undefined, @Param("projectId") projectId: string) {
    return this.projectsService.getProjectDetail(projectId, this.authService.requireSession(userId));
  }

  @Post(":projectId/versions")
  createVersion(@Headers("x-user-id") userId: string | undefined, @Param("projectId") projectId: string) {
    return this.projectsService.createNextVersion(projectId, this.authService.requireSession(userId));
  }

  @Patch(":projectId/versions/:versionId")
  updateVersion(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
    @Body() body: UpdateVersionDto
  ) {
    return this.projectsService.updateVersion(
      projectId,
      versionId,
      this.authService.requireSession(userId),
      body
    );
  }

  @Get(":projectId/submission-eligibility")
  getEligibility(@Headers("x-user-id") userId: string | undefined, @Param("projectId") projectId: string) {
    return this.projectsService.getSubmissionEligibility(projectId, this.authService.requireSession(userId));
  }

  @Post(":projectId/submit")
  async submit(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: SubmitProjectDto
  ) {
    return this.projectsService.submitProject(projectId, this.authService.requireSession(userId), body);
  }

  @Post(":projectId/ai-review/retry")
  async retry(@Headers("x-user-id") userId: string | undefined, @Param("projectId") projectId: string) {
    return this.projectsService.retryAiReview(projectId, this.authService.requireSession(userId));
  }

  @Get(":projectId/versions/:versionId/report")
  report(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string
  ) {
    return this.projectsService.getReport(projectId, versionId, this.authService.requireSession(userId));
  }

  @Get(":projectId/versions/:versionId/report.pdf")
  async reportPdf(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
    @Res() response: Response
  ) {
    const buffer = await this.projectsService.downloadReportPdf(
      projectId,
      versionId,
      this.authService.requireSession(userId)
    );

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(`ai-review-${versionId}.pdf`)}"`
    );
    response.send(buffer);
  }

  @Post(":projectId/versions/:versionId/human-decision")
  humanDecision(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
    @Body() body: HumanDecisionDto
  ) {
    return this.projectsService.humanDecision(
      projectId,
      versionId,
      this.authService.requireSession(userId),
      body
    );
  }
}
