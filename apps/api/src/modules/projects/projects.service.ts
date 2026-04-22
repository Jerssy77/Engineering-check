import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit
} from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AIReviewResult,
  Attachment,
  AttachmentParseResult,
  CostMatrixRow,
  DuplicateComparisonRecord,
  FormSnapshot,
  HumanDecision,
  Organization,
  ProjectAggregate,
  ProjectVersion,
  ReviewVerdict,
  SessionUser,
  VERDICT_LABELS,
  VersionAttachmentSlot,
  buildVersionAttachmentSlots,
  calculateBudgetSummary,
  calculateSubmissionEligibility,
  createEmptyFormSnapshot,
  createEmptyRiskFlags,
  createId,
  findDuplicateProjects,
  formatChinaDateTime,
  summarizeLocation
} from "@property-review/shared";
import ExcelJS from "exceljs";

import { AiReviewService } from "../shared/ai-review.service";
import { DemoDataService } from "../shared/demo-data.service";
import { PdfService } from "../shared/pdf.service";
import { normalizeAiReview } from "../shared/review-normalization";
import { resolveUploadDirPath } from "../shared/storage-paths";
import { CreateProjectDto } from "./dto/create-project.dto";
import { HumanDecisionDto } from "./dto/human-decision.dto";
import {
  BillOfQuantitiesPayload,
  ConstructionPlanPayload,
  FinalReviewReportPayload,
  FeasibilityReportPayload,
  ReportContext,
  ReviewerSummary,
  buildAiReviewPdfDocument,
  buildBillOfQuantities,
  buildBillOfQuantitiesPdfDocument,
  buildConstructionPlan,
  buildConstructionPlanPdfDocument,
  buildFeasibilityReport,
  buildFeasibilityPdfDocument,
  buildFinalReviewPdfDocument,
  buildFinalReviewReport
} from "./report-builders";
import { SubmitProjectDto } from "./dto/submit-project.dto";
import { UpdateVersionDto } from "./dto/update-version.dto";

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function normalizeCostMatrixRows(items: Array<Record<string, unknown>>): FormSnapshot["costMatrixRows"] {
  return items.map((item) => {
    const normalizedType = toText(item.type) === "other_fee" ? "other_fee" : "engineering";
    return {
      id: toText(item.id) || createId("cost"),
      type: normalizedType,
      itemName: toText(item.itemName),
      specification: toText(item.specification),
      unit: toText(item.unit),
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      remark: toText(item.remark)
    } satisfies CostMatrixRow;
  });
}

function mergeSnapshot(snapshot: FormSnapshot, dto: UpdateVersionDto): FormSnapshot {
  const costInputMode = dto.costInputMode ?? snapshot.costInputMode ?? "online";
  const uploadedCostSheet = snapshot.uploadedCostSheet;
  const syncedUploadBudget =
    costInputMode === "upload" &&
    uploadedCostSheet?.status === "completed" &&
    typeof uploadedCostSheet.totalAmount === "number"
      ? uploadedCostSheet.totalAmount
      : undefined;

  return {
    ...snapshot,
    ...dto,
    projectName: dto.projectName ?? snapshot.projectName,
    projectCategory: dto.projectCategory ?? snapshot.projectCategory,
    priority: dto.priority ?? snapshot.priority,
    budgetAmount: syncedUploadBudget ?? dto.budgetAmount ?? snapshot.budgetAmount,
    expectedStartDate: dto.expectedStartDate ?? snapshot.expectedStartDate,
    expectedEndDate: dto.expectedEndDate ?? snapshot.expectedEndDate,
    issueSourceType: dto.issueSourceType ?? snapshot.issueSourceType,
    urgencyLevel: dto.urgencyLevel ?? snapshot.urgencyLevel,
    location: {
      ...snapshot.location,
      ...(dto.location ?? {})
    },
    riskFlags: {
      ...createEmptyRiskFlags(),
      ...(snapshot.riskFlags ?? {}),
      ...(dto.riskFlags ?? {})
    },
    categorySpecificFields: {
      ...(snapshot.categorySpecificFields ?? {}),
      ...(dto.categorySpecificFields ?? {})
    },
    costInputMode,
    uploadedCostSheet,
    costMatrixRows: dto.costMatrixRows ? normalizeCostMatrixRows(dto.costMatrixRows) : snapshot.costMatrixRows
  };
}

function calculateSnapshotBudgetSummary(snapshot: FormSnapshot) {
  return calculateBudgetSummary({
    costMatrixRows: snapshot.costMatrixRows,
    declaredBudget: snapshot.budgetAmount,
    costInputMode: snapshot.costInputMode,
    uploadedCostSheet: snapshot.uploadedCostSheet
  });
}

interface PendingAiReviewJob {
  actorId: string;
  organizationId: string;
  overrideId?: string;
  projectId: string;
  submittedAt: string;
  versionId: string;
}

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly activeAiReviewJobs = new Set<string>();

  constructor(
    @Inject(DemoDataService) private readonly data: DemoDataService,
    @Inject(AiReviewService) private readonly aiReviewService: AiReviewService,
    @Inject(PdfService) private readonly pdfService: PdfService
  ) {}

  onModuleInit(): void {
    this.resumePendingAiReviews();
  }

  listProjects(user: SessionUser) {
    const organizations = this.data.getOrganizations();
    return this.data
      .listProjects()
      .filter((item) => this.canAccessProject(user, item.organizationId))
      .map((project) => {
        const versions = this.data
          .listVersions(project.id)
          .sort((left, right) => right.versionNumber - left.versionNumber);
        const currentVersion = versions.find((item) => item.id === project.currentVersionId) ?? versions[0];
        const organization = organizations.find((item) => item.id === project.organizationId);
        const review = this.data.getAggregate(project.id).aiReviews.find((item) => item.versionId === currentVersion?.id);

        return {
          id: project.id,
          title: project.title,
          category: project.category,
          status: project.status,
          organizationName: organization?.name ?? "-",
          currentVersionNumber: currentVersion?.versionNumber ?? 0,
          updatedAt: project.updatedAt,
          budgetAmount: currentVersion?.snapshot.budgetAmount ?? 0,
          locationSummary: currentVersion ? summarizeLocation(currentVersion.snapshot.location) : "-",
          duplicateFlag: (review?.duplicateReview.matches.length ?? 0) > 0
        };
      });
  }

  getProjectDetail(projectId: string, user: SessionUser) {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    const currentVersion = this.getCurrentVersion(aggregate);
    const currentAttachments = aggregate.attachments.filter((item) => item.versionId === currentVersion.id);

    return {
      ...aggregate,
      versions: [...aggregate.versions].sort((left, right) => right.versionNumber - left.versionNumber),
      eligibility: this.calculateEligibility(aggregate),
      auditLogs: this.data
        .listAuditLogs(projectId)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
      currentBudgetSummary: calculateSnapshotBudgetSummary(currentVersion.snapshot),
      currentAttachmentSlots: buildVersionAttachmentSlots({
        category: currentVersion.snapshot.projectCategory,
        sourceType: currentVersion.snapshot.issueSourceType,
        attachments: currentAttachments
      })
    };
  }

  createProject(user: SessionUser, dto: CreateProjectDto) {
    this.ensureSubmitter(user);
    const now = new Date().toISOString();
    const snapshot = {
      ...createEmptyFormSnapshot(),
      projectName: dto.projectName,
      projectCategory: dto.projectCategory,
      priority: dto.priority,
      budgetAmount: dto.budgetAmount,
      expectedStartDate: dto.expectedStartDate,
      expectedEndDate: dto.expectedEndDate,
      issueSourceType: dto.issueSourceType,
      issueDescription: dto.issueDescription ?? "",
      location: {
        propertyName: dto.propertyName,
        building: dto.building ?? "",
        floor: dto.floor ?? "",
        area: dto.area ?? "",
        room: dto.room ?? "",
        equipmentPoint: dto.equipmentPoint ?? "",
        impactScope: ""
      }
    } satisfies FormSnapshot;

    const project = this.data.createProject({
      organizationId: user.organizationId,
      ownerId: user.id,
      currentVersionId: "",
      title: dto.projectName,
      category: dto.projectCategory,
      status: "draft",
      createdAt: now,
      updatedAt: now
    });

    const version = this.data.createVersion({
      projectId: project.id,
      versionNumber: 1,
      status: "draft",
      snapshot,
      createdBy: user.id,
      createdAt: now
    });

    this.data.updateProject(project.id, (current) => ({ ...current, currentVersionId: version.id }));
    this.data.addAuditLog({
      actorId: user.id,
      projectId: project.id,
      versionId: version.id,
      action: "create_project",
      detail: "已创建立项草稿。",
      createdAt: now
    });

    return this.getProjectDetail(project.id, user);
  }

  createNextVersion(projectId: string, user: SessionUser) {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    const currentVersion = this.getCurrentVersion(aggregate);
    const now = new Date().toISOString();
    const nextVersion = this.data.createVersion({
      projectId,
      versionNumber: Math.max(...aggregate.versions.map((item) => item.versionNumber)) + 1,
      status: "draft",
      snapshot: {
        ...currentVersion.snapshot,
        location: { ...currentVersion.snapshot.location },
        riskFlags: { ...(currentVersion.snapshot.riskFlags ?? {}) },
        categorySpecificFields: JSON.parse(JSON.stringify(currentVersion.snapshot.categorySpecificFields ?? {})) as FormSnapshot["categorySpecificFields"],
        costMatrixRows: currentVersion.snapshot.costMatrixRows.map((item) => ({ ...item }))
      },
      createdBy: user.id,
      createdAt: now
    });

    this.data.updateProject(projectId, (current) => ({
      ...current,
      currentVersionId: nextVersion.id,
      status: "draft",
      updatedAt: now
    }));

    this.data.addAuditLog({
      actorId: user.id,
      projectId,
      versionId: nextVersion.id,
      action: "create_version",
      detail: `已生成 V${nextVersion.versionNumber} 新版本。`,
      createdAt: now
    });

    return this.getProjectDetail(projectId, user);
  }

  updateVersion(projectId: string, versionId: string, user: SessionUser, dto: UpdateVersionDto) {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    const version = aggregate.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new NotFoundException("版本不存在");
    }
    if (version.status !== "draft") {
      throw new BadRequestException("只有草稿版本可以编辑");
    }

    const updated = this.data.updateVersion(versionId, (current) => ({
      ...current,
      snapshot: mergeSnapshot(current.snapshot, dto)
    }));

    this.data.updateProject(projectId, (current) => ({
      ...current,
      title: updated.snapshot.projectName,
      category: updated.snapshot.projectCategory,
      updatedAt: new Date().toISOString()
    }));

    this.data.addAuditLog({
      actorId: user.id,
      projectId,
      versionId,
      action: "update_version",
      detail: "已更新立项草稿内容。",
      createdAt: new Date().toISOString()
    });

    return this.getProjectDetail(projectId, user);
  }

  getSubmissionEligibility(projectId: string, user: SessionUser) {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    return this.calculateEligibility(aggregate);
  }

  async submitProject(projectId: string, user: SessionUser, dto: SubmitProjectDto) {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureSubmitter(user);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    const version = this.resolveDraftVersion(aggregate, dto.versionId);
    const eligibility = this.calculateEligibility(aggregate);
    if (!eligibility.allowed) {
      throw new BadRequestException(
        eligibility.reason === "weekly_quota_reached"
          ? "城市公司本周 AI 送审额度已用完"
          : eligibility.reason === "cooldown_active"
            ? `该立项需在 ${formatChinaDateTime(eligibility.blockedUntil)} 后才能再次提交`
            : "当前状态下不允许提交 AI 预审"
      );
    }

    const draftAttachments = aggregate.attachments.filter((item) => item.versionId === version.id);
    const validationErrors = this.validateBeforeSubmit(version, draftAttachments);
    if (validationErrors.length) {
      throw new BadRequestException(validationErrors.join("；"));
    }

    const now = new Date().toISOString();
    const job: PendingAiReviewJob = {
      actorId: user.id,
      organizationId: aggregate.project.organizationId,
      overrideId: eligibility.availableOverrideId,
      projectId,
      submittedAt: now,
      versionId: version.id
    };
    this.reserveAiSubmissionResources(job);
    const submitted = this.data.updateVersion(version.id, (current) => ({
      ...current,
      status: "ai_reviewing",
      submittedAt: now
    }));

    this.data.updateProject(projectId, (current) => ({
      ...current,
      status: "ai_reviewing",
      currentVersionId: submitted.id,
      updatedAt: now
    }));

    this.data.addAuditLog({
      actorId: user.id,
      projectId,
      versionId: submitted.id,
      action: "submit_project",
      detail: eligibility.availableOverrideId ? "已使用特批发起 AI 预审。" : "已发起 AI 预审。",
      createdAt: now
    });
    this.scheduleAiReview({ ...job, versionId: submitted.id });

    return this.getProjectDetail(projectId, user);
  }

  async retryAiReview(projectId: string, user: SessionUser) {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureSubmitter(user);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    const current = this.getCurrentVersion(aggregate);

    if (current.status === "draft") {
      return this.submitProject(projectId, user, { versionId: current.id });
    }

    if (current.status === "ai_returned" || current.status === "human_returned") {
      this.createNextVersion(projectId, user);
      const refreshed = this.data.getAggregate(projectId);
      return this.submitProject(projectId, user, { versionId: refreshed.project.currentVersionId });
    }

    throw new BadRequestException("当前状态无需重新发起 AI 预审");
  }

  getReport(projectId: string, versionId: string, user: SessionUser) {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    const version = aggregate.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new NotFoundException("版本不存在");
    }
    const attachments = aggregate.attachments.filter((item) => item.versionId === versionId);
    const parseResults = aggregate.attachmentParseResults.filter((item) =>
      attachments.some((attachment) => attachment.id === item.attachmentId)
    );
    const review = normalizeAiReview(aggregate.aiReviews.find((item) => item.versionId === versionId));
    const decision = aggregate.humanDecisions.find((item) => item.versionId === versionId);

    return {
      project: aggregate.project,
      version,
      review,
      decision,
      attachments,
      parseResults,
      attachmentSlots: buildVersionAttachmentSlots({
        category: version.snapshot.projectCategory,
        sourceType: version.snapshot.issueSourceType,
        attachments
      }),
      budgetSummary: calculateSnapshotBudgetSummary(version.snapshot),
      organization: this.data.getOrganizations().find((item) => item.id === aggregate.project.organizationId)
    };
  }

  async downloadReportPdf(projectId: string, versionId: string, user: SessionUser) {
    const context = this.getReportContext(projectId, versionId, user);
    if (!context.review) {
      throw new NotFoundException("该版本暂无 AI 结论");
    }

    return this.pdfService.createReportPdf(buildAiReviewPdfDocument(context));
  }

  getFinalReviewReport(projectId: string, versionId: string, user: SessionUser): FinalReviewReportPayload {
    return buildFinalReviewReport(this.getReportContext(projectId, versionId, user));
  }

  getFeasibilityReport(projectId: string, versionId: string, user: SessionUser): FeasibilityReportPayload {
    const context = this.getReportContext(projectId, versionId, user);
    this.ensureApprovedOutput(context.version);
    return buildFeasibilityReport(context);
  }

  getBillOfQuantities(projectId: string, versionId: string, user: SessionUser): BillOfQuantitiesPayload {
    const context = this.getReportContext(projectId, versionId, user);
    this.ensureApprovedOutput(context.version);
    return buildBillOfQuantities(context);
  }

  getConstructionPlan(projectId: string, versionId: string, user: SessionUser): ConstructionPlanPayload {
    const context = this.getReportContext(projectId, versionId, user);
    this.ensureApprovedOutput(context.version);
    return buildConstructionPlan(context);
  }

  async downloadFinalReviewReportPdf(projectId: string, versionId: string, user: SessionUser) {
    const report = this.getFinalReviewReport(projectId, versionId, user);
    return this.pdfService.createReportPdf(buildFinalReviewPdfDocument(report));
  }

  async downloadFeasibilityReportPdf(projectId: string, versionId: string, user: SessionUser) {
    const report = this.getFeasibilityReport(projectId, versionId, user);
    return this.pdfService.createReportPdf(buildFeasibilityPdfDocument(report));
  }

  async downloadBillOfQuantitiesPdf(projectId: string, versionId: string, user: SessionUser) {
    const report = this.getBillOfQuantities(projectId, versionId, user);
    return this.pdfService.createReportPdf(buildBillOfQuantitiesPdfDocument(report));
  }

  async downloadConstructionPlanPdf(projectId: string, versionId: string, user: SessionUser) {
    const report = this.getConstructionPlan(projectId, versionId, user);
    return this.pdfService.createReportPdf(buildConstructionPlanPdfDocument(report));
  }

  async downloadBillOfQuantitiesExcel(projectId: string, versionId: string, user: SessionUser) {
    const report = this.getBillOfQuantities(projectId, versionId, user);
    if (report.sourceMode === "upload" && report.originalAttachment) {
      const attachment = this.data.getAttachment(report.originalAttachment.id);
      const absolutePath = path.join(resolveUploadDirPath(), attachment.storageKey);
      if (!existsSync(absolutePath)) {
        throw new NotFoundException("原始工程量清单文件不存在");
      }
      return readFileSync(absolutePath);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "工程立项审批平台";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("工程量清单", {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    const headers = ["序号", "分类", "项目名称", "规格型号", "单位", "工程量", "单价（元）", "合价（元）", "备注"];
    const headerRow = sheet.addRow(headers);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFBFDBFE" } },
        left: { style: "thin", color: { argb: "FFBFDBFE" } },
        bottom: { style: "thin", color: { argb: "FFBFDBFE" } },
        right: { style: "thin", color: { argb: "FFBFDBFE" } }
      };
    });

    report.rows.forEach((row, index) => {
      const dataRow = sheet.addRow([
        index + 1,
        row.typeLabel,
        row.itemName,
        row.specification || "",
        row.unit || "",
        row.quantity,
        row.unitPrice,
        row.lineTotal,
        row.remark || ""
      ]);

      dataRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD1D5DB" } },
          left: { style: "thin", color: { argb: "FFD1D5DB" } },
          bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
          right: { style: "thin", color: { argb: "FFD1D5DB" } }
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber >= 6 && colNumber <= 8 ? "right" : colNumber === 1 ? "center" : "left",
          wrapText: true
        };
        cell.font = { size: 10, color: { argb: "FF1F2937" } };
      });
    });

    const summaryStart = sheet.rowCount + 2;
    const summaryRows: Array<[string, number]> = [
      ["工程项小计", report.budgetSummary.engineeringSubtotal],
      ["其他费用小计", report.budgetSummary.otherFeeSubtotal],
      ["矩阵测算总价", report.budgetSummary.calculatedBudget],
      ["申报总预算", report.budgetSummary.declaredBudget],
      ["预算差额", report.budgetSummary.budgetGap]
    ];

    summaryRows.forEach(([label, value], index) => {
      const row = sheet.getRow(summaryStart + index);
      row.getCell(7).value = label;
      row.getCell(8).value = value;
      row.getCell(7).font = { bold: true, size: 10, color: { argb: "FF1E3A8A" } };
      row.getCell(8).font = { bold: true, size: 10, color: { argb: "FF1E3A8A" } };
      row.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
      row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
      row.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
      row.getCell(8).alignment = { horizontal: "right", vertical: "middle" };
    });

    const noteRow = summaryStart + summaryRows.length;
    sheet.getCell(`G${noteRow}`).value = "说明";
    sheet.getCell(`H${noteRow}`).value = report.declaredBudgetNote;
    sheet.getCell(`G${noteRow}`).font = { bold: true, size: 10, color: { argb: "FF1E3A8A" } };
    sheet.getCell(`H${noteRow}`).font = { size: 10, color: { argb: "FF1E3A8A" } };
    sheet.getCell(`H${noteRow}`).alignment = { wrapText: true, horizontal: "left" };

    sheet.columns = [
      { width: 8 },
      { width: 12 },
      { width: 24 },
      { width: 22 },
      { width: 12 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
      { width: 24 }
    ];

    sheet.getColumn(6).numFmt = "#,##0.###";
    sheet.getColumn(7).numFmt = "#,##0.00";
    sheet.getColumn(8).numFmt = "#,##0.00";

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }

  private getReportContext(projectId: string, versionId: string, user: SessionUser): ReportContext {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureProjectAccess(user, aggregate.project.organizationId);
    const version = aggregate.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new NotFoundException("版本不存在");
    }

    const attachments = aggregate.attachments.filter((item) => item.versionId === versionId);
    const parseResults = aggregate.attachmentParseResults.filter((item) =>
      attachments.some((attachment) => attachment.id === item.attachmentId)
    );
    const review = normalizeAiReview(aggregate.aiReviews.find((item) => item.versionId === versionId));
    const decision = aggregate.humanDecisions.find((item) => item.versionId === versionId);
    const organization = this.data.getOrganizations().find((item) => item.id === aggregate.project.organizationId);
    const reviewer = decision ? this.getReviewerSummary(decision, organization) : undefined;

    return {
      project: aggregate.project,
      version,
      review,
      decision,
      attachments,
      parseResults,
      attachmentSlots: buildVersionAttachmentSlots({
        category: version.snapshot.projectCategory,
        sourceType: version.snapshot.issueSourceType,
        attachments
      }),
      budgetSummary: calculateSnapshotBudgetSummary(version.snapshot),
      organization,
      reviewer
    };
  }

  private getReviewerSummary(
    decision: HumanDecision,
    organization?: Organization
  ): ReviewerSummary {
    const reviewer = this.data.getUsers().find((item) => item.id === decision.reviewerId);
    if (!reviewer) {
      return {
        id: decision.reviewerId,
        displayName: "未知审核人",
        role: "reviewer",
        organizationName: organization?.name ?? "未分配组织"
      };
    }

    const reviewerOrganization =
      this.data.getOrganizations().find((item) => item.id === reviewer.organizationId) ?? organization;

    return {
      id: reviewer.id,
      displayName: reviewer.displayName,
      role: reviewer.role,
      organizationName: reviewerOrganization?.name ?? "未分配组织"
    };
  }

  private ensureApprovedOutput(version: ProjectVersion): void {
    if (version.status !== "human_approved") {
      throw new BadRequestException("仅人工审核通过的版本可生成正式成果物。");
    }
  }

  private resumePendingAiReviews(): void {
    this.data
      .listProjects()
      .filter((project) => project.status === "ai_reviewing")
      .forEach((project) => {
        const version = this.data
          .listVersions(project.id)
          .find((item) => item.id === project.currentVersionId && item.status === "ai_reviewing");
        if (!version) {
          return;
        }

        const resumedSubmittedAt = version.submittedAt ?? project.updatedAt;
        const overrideId = this.data
          .listOverrides(project.id)
          .find((item) => item.used && item.usedAt === resumedSubmittedAt)
          ?.id;
        this.scheduleAiReview({
          actorId: version.createdBy,
          organizationId: project.organizationId,
          overrideId,
          projectId: project.id,
          submittedAt: resumedSubmittedAt,
          versionId: version.id
        });
      });
  }

  private scheduleAiReview(job: PendingAiReviewJob): void {
    const jobKey = `${job.projectId}:${job.versionId}`;
    if (this.activeAiReviewJobs.has(jobKey)) {
      return;
    }

    this.activeAiReviewJobs.add(jobKey);
    setImmediate(() => {
      void this.runAiReviewJob(job).finally(() => {
        this.activeAiReviewJobs.delete(jobKey);
      });
    });
  }

  private async runAiReviewJob(job: PendingAiReviewJob): Promise<void> {
    const aggregate = this.data.getAggregate(job.projectId);
    const version = aggregate.versions.find((item) => item.id === job.versionId);
    if (!version || version.status !== "ai_reviewing" || aggregate.project.currentVersionId !== job.versionId) {
      return;
    }

    try {
      this.reserveAiSubmissionResources(job);
      const existingReview = aggregate.aiReviews.find((item) => item.versionId === job.versionId);
      if (existingReview) {
        this.finalizeAiReview(job.projectId, version, existingReview);
      } else {
        await this.processAiReview(job.projectId, version);
      }
    } catch (error) {
      this.resetFailedAiReview(job, error);
    }
  }

  private reserveAiSubmissionResources(job: PendingAiReviewJob): void {
    const alreadyConsumed = this.data
      .listQuotaLedger()
      .some((entry) => entry.projectId === job.projectId && entry.versionId === job.versionId);
    if (!alreadyConsumed) {
      this.data.addQuotaUsage({
        organizationId: job.organizationId,
        projectId: job.projectId,
        versionId: job.versionId,
        consumedAt: job.submittedAt
      });
    }

    if (!job.overrideId) {
      return;
    }

    const override = this.data.listOverrides().find((item) => item.id === job.overrideId);
    if (override && !override.used) {
      this.data.markOverrideUsed(job.overrideId, job.submittedAt);
    }
  }

  private releaseAiSubmissionResources(job: PendingAiReviewJob): void {
    this.data.removeQuotaUsage(job.projectId, job.versionId);

    if (!job.overrideId) {
      return;
    }

    const override = this.data.listOverrides().find((item) => item.id === job.overrideId);
    if (override?.used) {
      this.data.releaseOverride(job.overrideId);
    }
  }

  private resetFailedAiReview(job: PendingAiReviewJob, error: unknown): void {
    const aggregate = this.data.getAggregate(job.projectId);
    const version = aggregate.versions.find((item) => item.id === job.versionId);
    if (!version || version.status !== "ai_reviewing") {
      return;
    }

    const now = new Date().toISOString();
    this.releaseAiSubmissionResources(job);
    this.data.updateVersion(job.versionId, (current) => ({
      ...current,
      status: "draft",
      submittedAt: undefined
    }));
    this.data.updateProject(job.projectId, (current) => ({
      ...current,
      status: "draft",
      currentVersionId: job.versionId,
      updatedAt: now
    }));
    this.data.addAuditLog({
      actorId: job.actorId,
      projectId: job.projectId,
      versionId: job.versionId,
      action: "ai_review_failed",
      detail: error instanceof Error ? error.message : "AI review failed.",
      createdAt: now
    });
  }

  humanDecision(projectId: string, versionId: string, user: SessionUser, dto: HumanDecisionDto) {
    if (user.role === "submitter") {
      throw new ForbiddenException("只有终审人或管理员才能执行终审");
    }
    const report = this.getReport(projectId, versionId, user);
    if (!report.review) {
      throw new BadRequestException("请先生成 AI 结论，再进行人工终审");
    }
    if (!["ai_recommended_pass", "ai_conditionally_passed"].includes(report.version.status)) {
      throw new BadRequestException("当前版本状态不支持人工终审");
    }
    if (dto.decision === "approved" && report.review.verdict === "fail") {
      throw new BadRequestException("AI 当前结论为不通过，不可直接批准");
    }

    const now = new Date().toISOString();
    const nextStatus = dto.decision === "approved" ? "human_approved" : "human_returned";
    const allowedWritebackIds = new Set(
      (report.review.advisoryWritebackCandidates ?? []).map((item) => item.id)
    );
    const selectedWritebackIds =
      dto.decision === "approved"
        ? (dto.selectedWritebackIds ?? []).filter((item) => allowedWritebackIds.has(item))
        : [];
    this.data.updateVersion(versionId, (current) => ({
      ...current,
      status: nextStatus,
      returnedAt: dto.decision === "returned" ? now : current.returnedAt
    }));
    this.data.updateProject(projectId, (current) => ({
      ...current,
      status: nextStatus,
      currentVersionId: versionId,
      updatedAt: now
    }));
    this.data.addDecision({
      projectId,
      versionId,
      reviewerId: user.id,
      decision: dto.decision,
      comment: dto.comment,
      selectedWritebackIds,
      decidedAt: now
    });
    this.data.addAuditLog({
      actorId: user.id,
      projectId,
      versionId,
      action: "human_decision",
      detail: dto.decision === "approved" ? "人工终审已通过该版本。" : "人工终审已退回该版本。",
      createdAt: now
    });

    return this.getProjectDetail(projectId, user);
  }

  private async processAiReview(projectId: string, version: ProjectVersion): Promise<AIReviewResult> {
    const attachments = this.data.listAttachments(projectId, version.id);
    const parseResults = attachments.flatMap((attachment) => this.data.listParseResults(attachment.id));
    const duplicateMatches = findDuplicateProjects({
      currentProjectId: projectId,
      snapshot: version.snapshot,
      records: this.buildDuplicateRecords(projectId)
    });
    const review = this.data.addAiReview(
      await this.aiReviewService.generateReview({
        projectId,
        versionId: version.id,
        snapshot: version.snapshot,
        attachments,
        parseResults,
        duplicateMatches
      })
    );

    const now = new Date().toISOString();
    const nextStatus = this.mapVerdictToStatus(review.verdict);
    this.data.updateVersion(version.id, (current) => ({
      ...current,
      status: nextStatus,
      aiReviewedAt: now,
      returnedAt: nextStatus === "ai_returned" ? now : current.returnedAt
    }));
    this.data.updateProject(projectId, (current) => ({
      ...current,
      status: nextStatus,
      updatedAt: now
    }));
    this.data.addAuditLog({
      actorId: version.createdBy,
      projectId,
      versionId: version.id,
      action: "ai_review_complete",
      detail: `AI 结论：${VERDICT_LABELS[review.verdict]}。`,
      createdAt: now
    });

    return review;
  }

  private finalizeAiReview(projectId: string, version: ProjectVersion, review: AIReviewResult): AIReviewResult {
    const now = new Date().toISOString();
    const nextStatus = this.mapVerdictToStatus(review.verdict);
    this.data.updateVersion(version.id, (current) => ({
      ...current,
      status: nextStatus,
      aiReviewedAt: current.aiReviewedAt ?? review.generatedAt ?? now,
      returnedAt: nextStatus === "ai_returned" ? current.returnedAt ?? now : current.returnedAt
    }));
    this.data.updateProject(projectId, (current) => ({
      ...current,
      status: nextStatus,
      updatedAt: now
    }));
    this.data.addAuditLog({
      actorId: version.createdBy,
      projectId,
      versionId: version.id,
      action: "ai_review_complete",
      detail: `AI review completed: ${VERDICT_LABELS[review.verdict]}`,
      createdAt: now
    });

    return review;
  }

  private calculateEligibility(aggregate: ProjectAggregate) {
    return calculateSubmissionEligibility({
      policy: this.data.getQuotaPolicy(),
      ledger: this.data.listQuotaLedger(),
      overrides: aggregate.overrides,
      versions: aggregate.versions,
      organizationId: aggregate.project.organizationId,
      currentStatus: aggregate.project.status
    });
  }

  private validateBeforeSubmit(version: ProjectVersion, attachments: Attachment[]): string[] {
    const issues: string[] = [];
    const snapshot = version.snapshot;
    const slots = buildVersionAttachmentSlots({
      category: snapshot.projectCategory,
      sourceType: snapshot.issueSourceType,
      attachments
    });

    const requiredTextFields: Array<[string, string]> = [
      [snapshot.location.propertyName, "未填写楼盘/项目"],
      [snapshot.issueDescription, "未填写问题描述"],
      [snapshot.currentCondition, "未填写现状判断"],
      [snapshot.objective, "未填写改造目标"],
      [snapshot.implementationScope, "未填写实施范围"],
      [snapshot.feasibilitySummary, "未填写可行性说明"],
      [snapshot.keyProcess, "未填写关键工艺"],
      [snapshot.materialSelection, "未填写材料选型"],
      [snapshot.acceptancePlan, "未填写验收方案"],
      [snapshot.preliminaryPlan, "未填写初步方案"],
      [snapshot.initialBudgetExplanation, "未填写预算依据"],
      [snapshot.expectedBenefits, "未填写预期效果"]
    ];

    requiredTextFields.forEach(([value, message]) => {
      if (!value.trim()) {
        issues.push(message);
      }
    });

    if (slots.some((item) => item.status === "missing")) {
      const missingSlotLabels = slots.filter((item) => item.status === "missing").map((item) => item.label);
      issues.push(`以下固定材料缺失：${missingSlotLabels.join("、")}`);
    }

    const costInputMode = snapshot.costInputMode ?? "online";
    if (costInputMode === "upload") {
      if (
        snapshot.uploadedCostSheet?.status !== "completed" ||
        typeof snapshot.uploadedCostSheet.totalAmount !== "number" ||
        snapshot.uploadedCostSheet.totalAmount <= 0
      ) {
        issues.push("请上传并成功解析工程量清单 Excel，系统需要识别最终总价后才能提交 AI 预审");
      }
    } else {
      if (!snapshot.costMatrixRows.length) {
        issues.push("请至少填写 1 行费用测算矩阵");
      }

      if (
        snapshot.costMatrixRows.some(
          (item) => !item.itemName.trim() || item.quantity <= 0 || item.unitPrice <= 0
        )
      ) {
        issues.push("费用测算矩阵必须填写完整，数量和单价需为正数");
      }
    }

    const budgetSummary = calculateSnapshotBudgetSummary(snapshot);
    if (budgetSummary.budgetGap !== 0) {
      issues.push(`申报总预算需与自动总价一致，当前差额 ${budgetSummary.budgetGap} 元`);
    }

    return issues;
  }

  private buildDuplicateRecords(projectId: string): DuplicateComparisonRecord[] {
    return this.data
      .listProjects()
      .flatMap((project) =>
        this.data.listVersions(project.id).map((version) => ({
          projectId: project.id,
          projectTitle: project.title,
          projectCategory: project.category,
          versionId: version.id,
          versionNumber: version.versionNumber,
          status: version.status,
          createdAt: version.createdAt,
          snapshot: version.snapshot
        }))
      )
      .filter((record) => record.projectId !== projectId);
  }

  private mapVerdictToStatus(verdict: ReviewVerdict): ProjectVersion["status"] {
    if (verdict === "pass") {
      return "ai_recommended_pass";
    }
    if (verdict === "conditional_pass") {
      return "ai_conditionally_passed";
    }
    return "ai_returned";
  }

  private resolveDraftVersion(aggregate: ProjectAggregate, versionId?: string): ProjectVersion {
    const version =
      aggregate.versions.find((item) => item.id === (versionId ?? aggregate.project.currentVersionId)) ??
      aggregate.versions[0];
    if (!version) {
      throw new NotFoundException("当前无可提交版本");
    }
    if (version.status !== "draft") {
      throw new BadRequestException("只有草稿版本可以提交");
    }
    return version;
  }

  private getCurrentVersion(aggregate: ProjectAggregate): ProjectVersion {
    const version = aggregate.versions.find((item) => item.id === aggregate.project.currentVersionId);
    if (!version) {
      throw new NotFoundException("当前版本不存在");
    }
    return version;
  }

  private ensureSubmitter(user: SessionUser): void {
    if (user.role !== "submitter") {
      throw new ForbiddenException("只有申报人可提交立项草稿");
    }
  }

  private ensureProjectAccess(user: SessionUser, organizationId: string): void {
    if (!this.canAccessProject(user, organizationId)) {
      throw new ForbiddenException("你无权访问该立项");
    }
  }

  private canAccessProject(user: SessionUser, organizationId: string): boolean {
    return user.role !== "submitter" || user.organizationId === organizationId;
  }
}
