import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";

import { AuthService } from "../auth/auth.service";
import { AnswerInterviewDto } from "./dto/answer-interview.dto";
import { ConfirmSchemeDto } from "./dto/confirm-scheme.dto";
import { ConfirmUnderstandingDto } from "./dto/confirm-understanding.dto";
import { GuidedDecisionDto } from "./dto/guided-decision.dto";
import { LinkEvidenceDto } from "./dto/link-evidence.dto";
import { UpdateKnowledgeReleaseDto } from "./dto/knowledge-release.dto";
import { UpdateInterviewCostsDto } from "./dto/update-costs.dto";
import { SaveAnswerDraftDto } from "./dto/save-answer-draft.dto";
import { SaveStageSupplementDto } from "./dto/stage-supplement.dto";
import { ConfirmFingerprintDto } from "./dto/confirm-fingerprint.dto";
import { ConfirmScopeCalibrationDto } from "./dto/scope-calibration.dto";
import { InterviewsService } from "./interviews.service";

@Controller()
export class InterviewsController {
  constructor(
    @Inject(InterviewsService) private readonly interviews: InterviewsService,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}

  @Get("projects/:projectId/interview")
  getInterview(@Headers("x-user-id") userId: string | undefined, @Param("projectId") projectId: string) {
    return this.interviews.getInterview(projectId, this.auth.requireSession(userId));
  }

  @Post("projects/:projectId/interview/fingerprint")
  confirmFingerprint(@Headers("x-user-id") userId: string | undefined, @Param("projectId") projectId: string, @Body() body: ConfirmFingerprintDto) {
    return this.interviews.confirmFingerprint(projectId, this.auth.requireSession(userId), body);
  }

  @Post("projects/:projectId/interview/answers")
  answer(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: AnswerInterviewDto
  ) {
    return this.interviews.answer(projectId, this.auth.requireSession(userId), body);
  }

  @Patch("projects/:projectId/interview/answer-draft")
  saveAnswerDraft(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: SaveAnswerDraftDto
  ) {
    return this.interviews.saveAnswerDraft(projectId, this.auth.requireSession(userId), body);
  }

  @Patch("projects/:projectId/interview/stage-supplement/draft")
  saveStageSupplementDraft(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: SaveStageSupplementDto
  ) {
    return this.interviews.saveStageSupplementDraft(projectId, this.auth.requireSession(userId), body);
  }

  @Post("projects/:projectId/interview/stage-supplement")
  submitStageSupplement(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: SaveStageSupplementDto
  ) {
    return this.interviews.submitStageSupplement(projectId, this.auth.requireSession(userId), body);
  }

  @Get("projects/:projectId/interview/stage-supplement/template.xlsx")
  async downloadStageSupplementTemplate(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Res() response: Response
  ) {
    const file = await this.interviews.downloadStageDataCollectionTemplate(projectId, this.auth.requireSession(userId));
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    response.setHeader("Content-Length", String(file.buffer.length));
    response.send(file.buffer);
  }

  @Post("projects/:projectId/interview/stage-supplement/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 512 * 1024, files: 1 } }))
  uploadStageSupplementTemplate(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @UploadedFile() file?: Express.Multer.File
  ) {
    return this.interviews.uploadStageDataCollection(projectId, this.auth.requireSession(userId), file);
  }

  @Post("projects/:projectId/interview/scope-calibration")
  confirmScopeCalibration(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: ConfirmScopeCalibrationDto
  ) {
    return this.interviews.confirmScopeCalibration(projectId, this.auth.requireSession(userId), body);
  }

  @Post("projects/:projectId/interview/reassess")
  reassess(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string
  ) {
    return this.interviews.reassess(projectId, this.auth.requireSession(userId));
  }

  @Post("projects/:projectId/interview/scheme/regenerate")
  regenerateScheme(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string
  ) {
    return this.interviews.regenerateScheme(projectId, this.auth.requireSession(userId));
  }

  @Post("projects/:projectId/interview/evidence")
  linkEvidence(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: LinkEvidenceDto
  ) {
    return this.interviews.linkEvidence(projectId, this.auth.requireSession(userId), body);
  }

  @Post("projects/:projectId/interview/scheme/confirm")
  confirmScheme(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: ConfirmSchemeDto
  ) {
    return this.interviews.confirmScheme(projectId, this.auth.requireSession(userId), body);
  }

  @Post("projects/:projectId/interview/necessity/understanding")
  confirmUnderstanding(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: ConfirmUnderstandingDto
  ) {
    return this.interviews.confirmUnderstanding(projectId, this.auth.requireSession(userId), body);
  }

  @Patch("projects/:projectId/interview/costs")
  updateCosts(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: UpdateInterviewCostsDto
  ) {
    return this.interviews.updateCosts(projectId, this.auth.requireSession(userId), body);
  }

  @Post("projects/:projectId/interview/submit")
  submit(@Headers("x-user-id") userId: string | undefined, @Param("projectId") projectId: string) {
    return this.interviews.submit(projectId, this.auth.requireSession(userId));
  }

  @Post("projects/:projectId/interview/decision")
  decide(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: GuidedDecisionDto
  ) {
    return this.interviews.decide(projectId, this.auth.requireSession(userId), body);
  }

  @Get("admin/knowledge/releases")
  listKnowledge(@Headers("x-user-id") userId: string | undefined) {
    return this.interviews.listKnowledge(this.auth.requireSession(userId));
  }

  @Post("admin/knowledge/releases")
  createKnowledgeDraft(@Headers("x-user-id") userId: string | undefined) {
    return this.interviews.createKnowledgeDraft(this.auth.requireSession(userId));
  }

  @Patch("admin/knowledge/releases/:releaseId")
  updateKnowledge(
    @Headers("x-user-id") userId: string | undefined,
    @Param("releaseId") releaseId: string,
    @Body() body: UpdateKnowledgeReleaseDto
  ) {
    return this.interviews.updateKnowledge(releaseId, this.auth.requireSession(userId), body);
  }

  @Post("admin/knowledge/releases/:releaseId/publish")
  publishKnowledge(@Headers("x-user-id") userId: string | undefined, @Param("releaseId") releaseId: string) {
    return this.interviews.publishKnowledge(releaseId, this.auth.requireSession(userId));
  }

  @Post("admin/knowledge/releases/:releaseId/rollback")
  rollbackKnowledge(@Headers("x-user-id") userId: string | undefined, @Param("releaseId") releaseId: string) {
    return this.interviews.rollbackKnowledge(releaseId, this.auth.requireSession(userId));
  }

  @Post("admin/knowledge/releases/:releaseId/replay")
  replayKnowledge(@Headers("x-user-id") userId: string | undefined, @Param("releaseId") releaseId: string) {
    return this.interviews.replayKnowledge(releaseId, this.auth.requireSession(userId));
  }
}
