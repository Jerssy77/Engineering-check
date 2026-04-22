import {
  AIReviewResult,
  AdvisoryRecommendation,
  Attachment,
  AttachmentParseResult,
  BudgetSummary,
  CostEstimateRange,
  CostMatrixRow,
  CostSheetParsedRow,
  CostSheetSection,
  HumanDecision,
  InternalControlRequirement,
  MandatoryRequirement,
  NormCitation,
  Organization,
  Priority,
  Project,
  ProjectCategory,
  ProjectStatus,
  ProjectVersion,
  ReviewSection,
  ReviewSeverity,
  ReviewVerdict,
  SchemeWritebackCandidate,
  VersionAttachmentSlot,
  calculateCostLineTotal,
  summarizeLocation
} from "@property-review/shared";
import type { PdfDocumentDefinition, PdfSectionBlock, PdfSummaryItem } from "../shared/pdf.service";

const CATEGORY_LABELS: Record<ProjectCategory, string> = {
  mep_upgrade: "机电改造",
  fire_safety: "消防安全",
  energy_retrofit: "节能改造",
  civil_upgrade: "土建改造",
  plumbing_drainage: "给排水改造"
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高"
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "草稿",
  submitted: "已提交",
  ai_reviewing: "AI 审核中",
  ai_returned: "AI 退回",
  ai_recommended_pass: "AI 建议通过",
  ai_conditionally_passed: "AI 有条件通过",
  human_approved: "人工审核通过",
  human_returned: "人工审核退回"
};

const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  pass: "通过",
  conditional_pass: "有条件通过",
  fail: "不通过"
};

const COST_TYPE_LABELS = {
  engineering: "工程项",
  other_fee: "其他费用"
} as const;

const ISSUE_SOURCE_LABELS: Record<string, string> = {
  inspection: "巡检发现",
  complaint: "客户投诉",
  work_order: "工单/报修",
  safety_hazard: "安全隐患",
  energy_optimization: "节能优化",
  repair_renewal: "设施更新",
  other: "其他"
};

const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export interface ReviewerSummary {
  id: string;
  displayName: string;
  role: string;
  organizationName: string;
}

export interface ReportContext {
  project: Project;
  version: ProjectVersion;
  review?: AIReviewResult;
  decision?: HumanDecision;
  attachments: Attachment[];
  parseResults: AttachmentParseResult[];
  attachmentSlots: VersionAttachmentSlot[];
  budgetSummary: BudgetSummary;
  organization?: Organization;
  reviewer?: ReviewerSummary;
}

export interface FinalReviewReportPayload {
  reportType: "final-review";
  project: {
    id: string;
    title: string;
    status: ProjectStatus;
    statusLabel: string;
    organizationName: string;
  };
  version: {
    id: string;
    versionNumber: number;
    status: ProjectStatus;
    statusLabel: string;
    createdAt: string;
    submittedAt?: string;
    aiReviewedAt?: string;
  };
  summary: {
    categoryLabel: string;
    priorityLabel: string;
    locationSummary: string;
    expectedWindow: string;
    declaredBudget: number;
    calculatedBudget: number;
    budgetGap: number;
  };
  finalDecision: {
    status: "pending" | "approved" | "returned";
    label: string;
    reviewerName?: string;
    reviewerRole?: string;
    decidedAt?: string;
    comment?: string;
    selectedWritebackIds: string[];
  };
  aiSummary: {
    verdict?: ReviewVerdict;
    verdictLabel: string;
    overallScore?: number;
    conclusion: string;
    modelName?: string;
    generatedAt?: string;
    missingMaterials: string[];
    requiredActions: string[];
    attachmentReadSummary: string[];
    citations: NormCitation[];
    mandatoryRequirements: MandatoryRequirement[];
    internalControlRequirements: InternalControlRequirement[];
    advisoryRecommendations: AdvisoryRecommendation[];
    advisoryWritebackCandidates: SchemeWritebackCandidate[];
    schemeWritebacks: SchemeWritebackCandidate[];
    costEstimateRanges: CostEstimateRange[];
    skillPackVersion?: string;
  };
  sections: {
    compliance?: AIReviewResult["complianceReview"];
    cost?: AIReviewResult["costReview"];
    technical?: AIReviewResult["technicalReview"];
    duplicate?: AIReviewResult["duplicateReview"];
  };
  problemContext: {
    issueSourceType: string;
    issueSourceDescription: string;
    issueDescription: string;
    currentCondition: string;
    temporaryMeasures: string;
  };
  budgetSummary: BudgetSummary;
  attachmentSlots: VersionAttachmentSlot[];
  analysis: {
    costMustKeepItems: string[];
    costQuestions: string[];
    technicalAlternativePaths: AdvisoryRecommendation[];
    adoptedWritebacks: SchemeWritebackCandidate[];
  };
}

export interface FeasibilityReportPayload {
  reportType: "feasibility";
  project: {
    id: string;
    title: string;
    organizationName: string;
    versionNumber: number;
    categoryLabel: string;
    priorityLabel: string;
    statusLabel: string;
  };
  overview: {
    projectName: string;
    locationSummary: string;
    expectedWindow: string;
    objective: string;
    expectedBenefits: string;
    issueSourceType: string;
  };
  problemBackground: {
    issueDescription: string;
    currentCondition: string;
    temporaryMeasures: string;
    issueSourceDescription: string;
    impactScope: string;
  };
  solutionSummary: {
    implementationScope: string;
    feasibilitySummary: string;
    keyProcess: string;
    materialSelection: string;
    acceptancePlan: string;
    maintenancePlan: string;
    preliminaryPlan: string;
    implementationRequirements: string[];
  };
  budgetSummary: BudgetSummary;
  topCostItems: Array<{ itemName: string; specification: string; lineTotal: number }>;
  riskAndControl: string[];
  mandatoryRequirements: MandatoryRequirement[];
  internalControlRequirements: InternalControlRequirement[];
  citations: NormCitation[];
  schemeWritebacks: SchemeWritebackCandidate[];
  adoptedWritebacks: SchemeWritebackCandidate[];
  costInsights: {
    mustKeepItems: string[];
    optimizationCandidates: AdvisoryRecommendation[];
    costQuestions: string[];
  };
  technicalInsights: {
    alternativePaths: AdvisoryRecommendation[];
    schemeCandidates: SchemeWritebackCandidate[];
  };
  conclusion: {
    title: string;
    body: string;
    humanComment?: string;
  };
  attachmentSlots: VersionAttachmentSlot[];
}

export interface BoqLineItem {
  id: string;
  type: "engineering" | "other_fee";
  typeLabel: string;
  itemName: string;
  specification: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  remark: string;
}

export interface BillOfQuantitiesPayload {
  reportType: "bill-of-quantities";
  sourceMode: "online" | "upload";
  project: {
    id: string;
    title: string;
    organizationName: string;
    versionNumber: number;
    categoryLabel: string;
    locationSummary: string;
    expectedWindow: string;
  };
  rows: BoqLineItem[];
  engineeringRows: BoqLineItem[];
  otherFeeRows: BoqLineItem[];
  budgetSummary: BudgetSummary;
  declaredBudgetNote: string;
  uploadedSheetSummary?: {
    attachmentId: string;
    fileName: string;
    parsedAt: string;
    totalAmount?: number;
    totalLabel?: string;
    totalCell?: string;
    totalSheetName?: string;
    parsedSheetNames: string[];
    detailRowCount: number;
    sections: CostSheetSection[];
    rows: CostSheetParsedRow[];
    notes: string[];
    warnings: string[];
  };
  originalAttachment?: Pick<Attachment, "id" | "fileName" | "mimeType" | "size">;
}

export interface ConstructionPlanPayload {
  reportType: "construction-plan";
  project: {
    id: string;
    title: string;
    organizationName: string;
    versionNumber: number;
    categoryLabel: string;
    priorityLabel: string;
    locationSummary: string;
    expectedWindow: string;
  };
  scope: string;
  preparation: string[];
  procedures: string[];
  schedule: string;
  qualityControl: string[];
  safetyControl: string[];
  riskAndEmergency: string[];
  acceptanceAndHandover: string[];
  mandatoryRequirements: MandatoryRequirement[];
  internalControlRequirements: InternalControlRequirement[];
  adoptedWritebacks: SchemeWritebackCandidate[];
  citations: NormCitation[];
  attachmentSlots: VersionAttachmentSlot[];
}

function formatCurrency(value: number): string {
  return `${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)} 元`;
}

function formatDateOrFallback(value?: string): string {
  if (!value) return "待补充";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
    hour12: false
  }).format(new Date(value));
}

function formatDateRange(start?: string, end?: string): string {
  if (!start && !end) return "待补充";
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: "Asia/Shanghai"
  });
  const startLabel = start ? formatter.format(new Date(start)) : "待定";
  const endLabel = end ? formatter.format(new Date(end)) : "待定";
  return `${startLabel} - ${endLabel}`;
}

function withFallback(value?: string, fallback = "待补充"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function issueSourceLabel(value?: string): string {
  return value ? ISSUE_SOURCE_LABELS[value] ?? value : "待补充";
}

function nonEmptyLines(values: Array<string | undefined | null>): string[] {
  return values.map((item) => item?.trim() ?? "").filter(Boolean);
}

function normalizeSentence(value?: string, fallback = "待补充"): string {
  const text = withFallback(value, fallback).replace(/\s+/g, " ").trim();
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function projectLocation(snapshot: ProjectVersion["snapshot"]): string {
  return summarizeLocation(snapshot.location) || "项目现场";
}

function buildFeasibilityProblemStatement(snapshot: ProjectVersion["snapshot"]): string {
  const location = projectLocation(snapshot);
  const source = issueSourceLabel(snapshot.issueSourceType);
  const issue = normalizeSentence(snapshot.issueDescription, "申报材料尚未充分说明具体问题");
  const condition = normalizeSentence(snapshot.currentCondition, "现场状态仍需进一步复核");
  const impact = withFallback(snapshot.location.impactScope, "项目相关区域");
  const temporary = snapshot.temporaryMeasures?.trim()
    ? `目前已采取的临时措施为：${normalizeSentence(snapshot.temporaryMeasures)}`
    : "目前尚未形成长期有效的系统性处置措施。";

  return `本项目位于${location}，问题来源为${source}。现场主要问题为：${issue}当前状态为：${condition}影响范围涉及${impact}。${temporary}综合判断，该问题已具备立项论证和专项处置的必要性，如继续延后处理，可能导致设备可靠性下降、维修频次增加、运营扰动扩大或后续处置成本上升。`;
}

function buildFeasibilityObjective(snapshot: ProjectVersion["snapshot"]): string {
  const location = projectLocation(snapshot);
  const objective = normalizeSentence(snapshot.objective, "恢复系统稳定运行、降低故障风险并满足后续运维要求");
  return `本项目拟围绕${location}的实际问题开展专项整改，目标为${objective}同时通过边界清晰的实施组织、验收控制和资料归档，形成可追溯、可交付、可维护的工程成果。`;
}

function buildFeasibilityBenefits(snapshot: ProjectVersion["snapshot"]): string {
  const benefits = normalizeSentence(snapshot.expectedBenefits, "提升系统运行稳定性，降低重复维修和运营投诉风险");
  return `项目实施后预计可实现以下效果：${benefits}收益评价以运行稳定性、故障复发率、现场投诉变化、能耗或维护便利性等指标作为后续复盘依据。`;
}

function buildFeasibilityScope(snapshot: ProjectVersion["snapshot"]): string {
  const scope = normalizeSentence(snapshot.implementationScope, "实施范围尚需结合现场复核进一步明确");
  return `本次实施范围为：${scope}实施边界应限定在审批通过的项目版本、工程量清单和现场确认范围内，不得擅自扩大至与本次问题无直接关系的新增改造内容。`;
}

function buildFeasibilitySummary(snapshot: ProjectVersion["snapshot"]): string {
  const feasibility = normalizeSentence(snapshot.feasibilitySummary, "从施工组织和运维配合角度看，项目具备实施条件");
  return `${feasibility}后续实施应重点确认施工窗口、停复机或切换条件、材料到场周期、运营告知和验收资料准备，确保施工安排不影响物业核心服务连续性。`;
}

function buildFeasibilityProcess(snapshot: ProjectVersion["snapshot"]): string {
  const process = normalizeSentence(snapshot.keyProcess, "按现场复核、材料进场、专项施工、联调测试和验收移交的顺序组织实施");
  return `关键工艺建议按以下原则控制：${process}施工过程中应对关键节点进行旁站或复核，涉及隐蔽、联动、切换、调试的环节应保留影像和记录。`;
}

function buildFeasibilityMaterial(snapshot: ProjectVersion["snapshot"]): string {
  const material = normalizeSentence(snapshot.materialSelection, "材料和设备应满足原系统兼容性、耐久性和后续维护要求");
  return `材料与设备选型原则为：${material}采购和进场验收应核对品牌型号、规格参数、合格证明、检测报告或质保文件，避免因低适配或低耐久材料造成返工。`;
}

function buildFeasibilityAcceptance(snapshot: ProjectVersion["snapshot"]): string {
  const acceptance = normalizeSentence(snapshot.acceptancePlan, "完工后按功能恢复、质量观感、资料完整性和运行稳定性进行验收");
  return `验收安排为：${acceptance}验收资料应至少包括施工记录、关键节点照片、材料证明、调试或检测记录、问题整改闭环记录及移交清单。`;
}

function buildFeasibilityRiskControls(
  snapshot: ProjectVersion["snapshot"],
  review: AIReviewResult | undefined,
  mandatoryRequirements: MandatoryRequirement[],
  internalControlRequirements: InternalControlRequirement[] = [],
  adoptedWritebacks: SchemeWritebackCandidate[] = []
): string[] {
  return nonEmptyLines([
    "实施前应完成现场复核，确认施工边界、影响范围、作业窗口、运营告知和应急联系人。",
    snapshot.hiddenWorksRequirement
      ? `隐蔽工程控制：${normalizeSentence(snapshot.hiddenWorksRequirement)}`
      : "涉及隐蔽工程或封闭后难以复核的部位，应在隐蔽前完成验收、拍照和记录归档。",
    snapshot.sampleFirstRequirement
      ? `样板先行控制：${normalizeSentence(snapshot.sampleFirstRequirement)}`
      : "同类重复施工内容宜先完成样板或首件确认，再组织批量实施。",
    snapshot.detailDrawingRequirement
      ? `关键节点深化安排：${normalizeSentence(snapshot.detailDrawingRequirement)}`
      : "立项阶段不强制提供招标深度施工图或详细节点大样；涉及接口、管线、设备基础、联动控制或防火封堵等关键节点的，应在招采或施工深化阶段形成做法确认、现场照片和验收记录。",
    snapshot.thirdPartyTestingRequirement
      ? `检测要求：${normalizeSentence(snapshot.thirdPartyTestingRequirement)}`
      : "如涉及消防、承压、用电安全、结构安全或系统性能验证，应按审批意见确定是否委托第三方检测。",
    ...mandatoryRequirements.map((item) => `强制规范落实：${normalizeSentence(item.writebackText || item.requirement)}`),
    ...internalControlRequirements.map((item) => `审批硬性要求：${normalizeSentence(item.writebackText || item.action || item.requirement)}`),
    ...adoptedWritebacks.map((item) => `已采纳优化建议：${normalizeSentence(item.text)}`),
    ...(review?.requiredActions ?? []).map((item) => `审核后续动作：${normalizeSentence(item)}`)
  ]);
}

function buildFeasibilityConclusion(context: ReportContext): FeasibilityReportPayload["conclusion"] {
  const approved = context.decision?.decision === "approved";
  const humanComment = context.decision?.comment?.trim();
  const verdict = context.review ? VERDICT_LABELS[context.review.verdict] : "待审核";

  if (approved) {
    return {
      title: "具备立项实施条件，建议按审批通过版本组织实施",
      body: `经综合项目必要性、技术可行性、预算测算、AI 审核意见和人工终审意见，本项目具备按审批版本推进的条件。后续应以已审批工程量清单、强制规范要求和现场施工方案作为执行边界，严格控制范围变更、材料验收、关键节点记录和完工移交。人工最终意见：${humanComment || "同意按审批通过版本组织实施。"}`,
      humanComment
    };
  }

  return {
    title: `暂以 AI 预审结论作为论证参考：${verdict}`,
    body: `当前版本尚未形成人工最终通过结论，可行性报告仅作为内部论证草稿。正式实施前仍需完成人工终审、补齐必要材料，并确认工程量清单、施工边界和强制规范要求。`,
    humanComment
  };
}

function buildConstructionScope(snapshot: ProjectVersion["snapshot"], projectName: string): string {
  return `本施工方案适用于“${projectName}”审批通过范围内的现场实施工作。施工内容以项目申请表、工程量清单、审批意见及现场复核结果为边界，重点覆盖${normalizeSentence(snapshot.implementationScope, "审批范围内的专项整改内容")}未经审批确认，不得扩大施工范围、调整主要材料设备规格或新增与本次问题无直接关系的工程内容。`;
}

function buildConstructionProcedures(snapshot: ProjectVersion["snapshot"]): string[] {
  return nonEmptyLines([
    "施工交底与现场复核：组织申报单位、施工单位、物业运营和必要供应商进行现场交底，核实施工边界、设备点位、成品保护、作业窗口和影响范围。",
    "临时防护与运营告知：按现场管理要求设置围挡、警示、通行引导和成品保护；涉及停机、切换、噪声或临时占用的，应提前完成告知和审批。",
    snapshot.keyProcess
      ? `关键工序实施：${normalizeSentence(snapshot.keyProcess)}`
      : "关键工序实施：按批准方案完成拆除、安装、修复、改造、联动或调试等作业，关键节点应留存影像记录。",
    snapshot.preliminaryPlan
      ? `分阶段组织：${normalizeSentence(snapshot.preliminaryPlan)}`
      : "分阶段组织：按材料到场、现场条件、施工窗口和运营配合情况分阶段推进，避免集中扰动正常运营。",
    "联调试运行：完工后对系统功能、联动关系、运行参数、异常报警和使用效果进行复核，必要时安排连续观察。",
    "验收移交：完成质量验收、资料归档、问题整改闭环和运维交底后，办理移交手续。"
  ]);
}

function summarizeAttachments(slots: VersionAttachmentSlot[]): PdfSummaryItem[] {
  return slots.map((slot) => ({
    label: slot.label,
    value: slot.attachments.length
      ? slot.attachments.map((attachment) => attachment.fileName).join("、")
      : "未上传"
  }));
}

function formatCitationLabel(citation: NormCitation): string {
  return `${citation.code} ${citation.title} ${citation.clause}`;
}

function resolveCitationLabels(citations: NormCitation[], citationIds: string[]): string {
  const labels = citationIds
    .map((citationId) => citations.find((citation) => citation.id === citationId))
    .filter((citation): citation is NormCitation => Boolean(citation))
    .map((citation) => formatCitationLabel(citation));
  return labels.length ? labels.join("；") : "待补充明确条款";
}

function buildBoqRows(rows: CostMatrixRow[]): BoqLineItem[] {
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    typeLabel: COST_TYPE_LABELS[row.type],
    itemName: row.itemName,
    specification: row.specification,
    unit: row.unit,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: calculateCostLineTotal(row),
    remark: row.remark
  }));
}

function buildDecisionSummary(context: ReportContext): FinalReviewReportPayload["finalDecision"] {
  if (!context.decision) {
    return {
      status: "pending",
      label: "待人工审核",
      selectedWritebackIds: []
    };
  }

  return {
    status: context.decision.decision,
    label: context.decision.decision === "approved" ? "人工审核通过" : "人工审核退回",
    reviewerName: context.reviewer?.displayName,
    reviewerRole: context.reviewer?.organizationName,
    decidedAt: context.decision.decidedAt,
    comment: context.decision.comment,
    selectedWritebackIds: context.decision.selectedWritebackIds ?? []
  };
}

function getAdoptedWritebacks(context: ReportContext): SchemeWritebackCandidate[] {
  const selectedIds = new Set(context.decision?.selectedWritebackIds ?? []);
  if (!selectedIds.size || context.decision?.decision !== "approved") {
    return [];
  }

  return (context.review?.advisoryWritebackCandidates ?? []).filter((item) => selectedIds.has(item.id));
}

function buildAiSummary(context: ReportContext): FinalReviewReportPayload["aiSummary"] {
  if (!context.review) {
    return {
      verdictLabel: "待生成 AI 结论",
      conclusion: "当前版本尚未生成 AI 审核结果。",
      missingMaterials: [],
      requiredActions: [],
      attachmentReadSummary: [],
      citations: [],
      mandatoryRequirements: [],
      internalControlRequirements: [],
      advisoryRecommendations: [],
      advisoryWritebackCandidates: [],
      schemeWritebacks: [],
      costEstimateRanges: []
    };
  }

  return {
    verdict: context.review.verdict,
    verdictLabel: VERDICT_LABELS[context.review.verdict],
    overallScore: context.review.overallScore,
    conclusion: context.review.conclusion,
    modelName: context.review.modelName,
    generatedAt: context.review.generatedAt,
    missingMaterials: context.review.missingMaterials,
    requiredActions: context.review.requiredActions,
    attachmentReadSummary: context.review.attachmentReadSummary,
    citations: context.review.citations ?? [],
    mandatoryRequirements: context.review.mandatoryRequirements ?? [],
    internalControlRequirements: context.review.internalControlRequirements ?? [],
    advisoryRecommendations: context.review.advisoryRecommendations ?? [],
    advisoryWritebackCandidates: context.review.advisoryWritebackCandidates ?? [],
    schemeWritebacks: context.review.schemeWritebacks ?? [],
    costEstimateRanges: context.review.costEstimateRanges ?? [],
    skillPackVersion: context.review.skillPackVersion
  };
}

function sectionConclusion(section?: ReviewSection, fallback = "当前版本暂无结构化结论。"): string {
  return withFallback(section?.summary ?? section?.conclusion, fallback);
}

function buildReviewSectionBlocks(sectionName: string, section?: ReviewSection): PdfSectionBlock[] {
  if (!section) {
    return [{ type: "paragraph", text: `${sectionName}暂无 AI 结构化结论。` }];
  }

  const requiredMaterials = Array.from(
    new Set(section.findings.flatMap((item) => item.requiredMaterials).map((item) => item.trim()).filter(Boolean))
  );

  return [
    { type: "paragraph", text: sectionConclusion(section) },
    {
      type: "table",
      table: {
        headers: ["风险级别", "问题标题", "当前情况", "建议动作"],
        rows: section.findings.map((item) => [
          SEVERITY_LABELS[item.severity],
          item.title,
          item.currentState,
          item.action
        ]),
        columnWidths: [12, 24, 30, 34],
        fontSize: 9
      }
    },
    {
      type: "bullets",
      items: requiredMaterials.length
        ? requiredMaterials.map((item) => `需补材料：${item}`)
        : ["本模块无额外需补材料。"]
    }
  ];
}

function buildMandatoryRequirementBlocks(
  citations: NormCitation[],
  requirements: MandatoryRequirement[]
): PdfSectionBlock[] {
  if (!requirements.length) {
    return [{ type: "paragraph", text: "当前版本未形成可直接写回方案的强制规范要求。" }];
  }

  return [
    {
      type: "table",
      table: {
        headers: ["强制项", "规范依据", "落实要求", "需补材料"],
        rows: requirements.map((item) => [
          item.title,
          resolveCitationLabels(citations, item.citationIds),
          item.writebackText || item.requirement,
          item.requiredMaterials.length ? item.requiredMaterials.join("、") : "无"
        ]),
        columnWidths: [22, 26, 34, 18],
        fontSize: 8.5
      }
    }
  ];
}

function buildInternalControlBlocks(requirements: InternalControlRequirement[]): PdfSectionBlock[] {
  if (!requirements.length) {
    return [{ type: "paragraph", text: "当前版本未形成额外平台审批硬性要求。" }];
  }

  return [
    {
      type: "table",
      table: {
        headers: ["级别", "审批要求", "触发原因", "整改动作"],
        rows: requirements.map((item) => [
          SEVERITY_LABELS[item.severity],
          item.title,
          item.reason || item.requirement,
          item.action
        ]),
        columnWidths: [10, 24, 32, 34],
        fontSize: 8.5
      }
    }
  ];
}

function buildWritebackBlocks(title: string, items: SchemeWritebackCandidate[]): PdfSectionBlock[] {
  if (!items.length) {
    return [{ type: "paragraph", text: `${title}暂无已采纳内容。` }];
  }

  return [
    {
      type: "bullets",
      items: items.map((item) => `${item.title}：${item.text}`)
    }
  ];
}

function buildAdvisoryBlocks(title: string, items: AdvisoryRecommendation[]): PdfSectionBlock[] {
  if (!items.length) {
    return [{ type: "paragraph", text: `${title}暂无新增建议。` }];
  }

  return [
    {
      type: "bullets",
      items: items.map((item) => `${item.title}：${item.recommendation}${item.reason ? `；理由：${item.reason}` : ""}`)
    }
  ];
}

export function buildFinalReviewReport(context: ReportContext): FinalReviewReportPayload {
  const { snapshot } = context.version;
  const costReview = context.review?.costReview;
  const technicalReview = context.review?.technicalReview;
  const adoptedWritebacks = getAdoptedWritebacks(context);

  return {
    reportType: "final-review",
    project: {
      id: context.project.id,
      title: context.project.title,
      status: context.project.status,
      statusLabel: STATUS_LABELS[context.project.status],
      organizationName: context.organization?.name ?? "未分配组织"
    },
    version: {
      id: context.version.id,
      versionNumber: context.version.versionNumber,
      status: context.version.status,
      statusLabel: STATUS_LABELS[context.version.status],
      createdAt: context.version.createdAt,
      submittedAt: context.version.submittedAt,
      aiReviewedAt: context.version.aiReviewedAt
    },
    summary: {
      categoryLabel: CATEGORY_LABELS[snapshot.projectCategory],
      priorityLabel: PRIORITY_LABELS[snapshot.priority],
      locationSummary: summarizeLocation(snapshot.location),
      expectedWindow: formatDateRange(snapshot.expectedStartDate, snapshot.expectedEndDate),
      declaredBudget: context.budgetSummary.declaredBudget,
      calculatedBudget: context.budgetSummary.calculatedBudget,
      budgetGap: context.budgetSummary.budgetGap
    },
    finalDecision: buildDecisionSummary(context),
    aiSummary: buildAiSummary(context),
    sections: {
      compliance: context.review?.complianceReview,
      cost: context.review?.costReview,
      technical: context.review?.technicalReview,
      duplicate: context.review?.duplicateReview
    },
    problemContext: {
      issueSourceType: issueSourceLabel(snapshot.issueSourceType),
      issueSourceDescription: withFallback(snapshot.issueSourceDescription),
      issueDescription: withFallback(snapshot.issueDescription),
      currentCondition: withFallback(snapshot.currentCondition),
      temporaryMeasures: withFallback(snapshot.temporaryMeasures, "无")
    },
    budgetSummary: context.budgetSummary,
    attachmentSlots: context.attachmentSlots,
    analysis: {
      costMustKeepItems: costReview?.mustKeepItems ?? [],
      costQuestions: costReview?.costQuestions ?? [],
      technicalAlternativePaths: technicalReview?.alternativePaths ?? [],
      adoptedWritebacks
    }
  };
}

export function buildFeasibilityReport(context: ReportContext): FeasibilityReportPayload {
  const { snapshot } = context.version;
  const mandatoryRequirements = context.review?.mandatoryRequirements ?? [];
  const internalControlRequirements = context.review?.internalControlRequirements ?? [];
  const adoptedWritebacks = getAdoptedWritebacks(context);
  const schemeWritebacks = context.review?.schemeWritebacks?.filter((item) => item.autoApplied) ?? [];
  const locationSummary = projectLocation(snapshot);
  const projectName = withFallback(snapshot.projectName, context.project.title);
  const riskAndControl = buildFeasibilityRiskControls(
    snapshot,
    context.review,
    mandatoryRequirements,
    internalControlRequirements,
    adoptedWritebacks
  );

  return {
    reportType: "feasibility",
    project: {
      id: context.project.id,
      title: context.project.title,
      organizationName: context.organization?.name ?? "未分配组织",
      versionNumber: context.version.versionNumber,
      categoryLabel: CATEGORY_LABELS[snapshot.projectCategory],
      priorityLabel: PRIORITY_LABELS[snapshot.priority],
      statusLabel: STATUS_LABELS[context.version.status]
    },
    overview: {
      projectName,
      locationSummary,
      expectedWindow: formatDateRange(snapshot.expectedStartDate, snapshot.expectedEndDate),
      objective: buildFeasibilityObjective(snapshot),
      expectedBenefits: buildFeasibilityBenefits(snapshot),
      issueSourceType: issueSourceLabel(snapshot.issueSourceType)
    },
    problemBackground: {
      issueDescription: buildFeasibilityProblemStatement(snapshot),
      currentCondition: normalizeSentence(snapshot.currentCondition, "现场状态仍需进一步复核"),
      temporaryMeasures: normalizeSentence(snapshot.temporaryMeasures, "当前暂无长期替代措施，应通过本项目形成正式整改闭环"),
      issueSourceDescription: withFallback(snapshot.issueSourceDescription),
      impactScope: withFallback(snapshot.location.impactScope, "项目相关区域")
    },
    solutionSummary: {
      implementationScope: buildFeasibilityScope(snapshot),
      feasibilitySummary: buildFeasibilitySummary(snapshot),
      keyProcess: buildFeasibilityProcess(snapshot),
      materialSelection: buildFeasibilityMaterial(snapshot),
      acceptancePlan: buildFeasibilityAcceptance(snapshot),
      maintenancePlan: normalizeSentence(snapshot.maintenancePlan, "完工后纳入物业日常巡检和维保计划，重点跟踪运行状态、故障复发和使用反馈"),
      preliminaryPlan: normalizeSentence(snapshot.preliminaryPlan, "按现场复核、材料准备、专项施工、联调验收和资料移交的顺序组织实施"),
      implementationRequirements: [...schemeWritebacks, ...adoptedWritebacks].map((item) => item.text)
    },
    budgetSummary: context.budgetSummary,
    topCostItems: context.budgetSummary.topCostItems,
    riskAndControl,
    mandatoryRequirements,
    internalControlRequirements,
    citations: context.review?.citations ?? [],
    schemeWritebacks,
    adoptedWritebacks,
    costInsights: {
      mustKeepItems: context.review?.costReview.mustKeepItems ?? [],
      optimizationCandidates: context.review?.costReview.optimizationCandidates ?? [],
      costQuestions: context.review?.costReview.costQuestions ?? []
    },
    technicalInsights: {
      alternativePaths: context.review?.technicalReview.alternativePaths ?? [],
      schemeCandidates: context.review?.technicalReview.schemeCandidates ?? []
    },
    conclusion: buildFeasibilityConclusion(context),
    attachmentSlots: context.attachmentSlots
  };
}

export function buildBillOfQuantities(context: ReportContext): BillOfQuantitiesPayload {
  const { snapshot } = context.version;
  const rows = buildBoqRows(snapshot.costMatrixRows);
  const sourceMode = snapshot.costInputMode === "upload" && snapshot.uploadedCostSheet ? "upload" : "online";
  const uploadedSheet = sourceMode === "upload" ? snapshot.uploadedCostSheet : undefined;
  const originalAttachment = uploadedSheet
    ? context.attachments.find((item) => item.id === uploadedSheet.attachmentId)
    : undefined;

  return {
    reportType: "bill-of-quantities",
    sourceMode,
    project: {
      id: context.project.id,
      title: context.project.title,
      organizationName: context.organization?.name ?? "未分配组织",
      versionNumber: context.version.versionNumber,
      categoryLabel: CATEGORY_LABELS[snapshot.projectCategory],
      locationSummary: summarizeLocation(snapshot.location),
      expectedWindow: formatDateRange(
        snapshot.expectedStartDate,
        snapshot.expectedEndDate
      )
    },
    rows,
    engineeringRows: rows.filter((row) => row.type === "engineering"),
    otherFeeRows: rows.filter((row) => row.type === "other_fee"),
    budgetSummary: context.budgetSummary,
    declaredBudgetNote:
      sourceMode === "upload"
        ? "申报预算已按上传工程量清单识别总计同步，原始 Excel 为正式详细清单。"
        : context.budgetSummary.budgetGap === 0
          ? "申报总预算与矩阵测算一致。"
          : `申报总预算与矩阵测算存在 ${formatCurrency(context.budgetSummary.budgetGap)} 差额，正式执行前需复核。`,
    uploadedSheetSummary: uploadedSheet
      ? {
          attachmentId: uploadedSheet.attachmentId,
          fileName: uploadedSheet.fileName,
          parsedAt: uploadedSheet.parsedAt,
          totalAmount: uploadedSheet.totalAmount,
          totalLabel: uploadedSheet.totalLabel,
          totalCell: uploadedSheet.totalCell,
          totalSheetName: uploadedSheet.totalSheetName,
          parsedSheetNames: uploadedSheet.parsedSheetNames,
          detailRowCount: uploadedSheet.detailRowCount,
          sections: uploadedSheet.sections,
          rows: uploadedSheet.rows,
          notes: uploadedSheet.notes,
          warnings: uploadedSheet.warnings
        }
      : undefined,
    originalAttachment: originalAttachment
      ? {
          id: originalAttachment.id,
          fileName: originalAttachment.fileName,
          mimeType: originalAttachment.mimeType,
          size: originalAttachment.size
        }
      : undefined
  };
}

export function buildConstructionPlan(context: ReportContext): ConstructionPlanPayload {
  const { snapshot } = context.version;
  const mandatoryRequirements = context.review?.mandatoryRequirements ?? [];
  const internalControlRequirements = context.review?.internalControlRequirements ?? [];
  const adoptedWritebacks = getAdoptedWritebacks(context);
  const projectName = withFallback(snapshot.projectName, context.project.title);
  const procedures = buildConstructionProcedures(snapshot);

  const qualityControl = nonEmptyLines([
    "材料、设备和构配件进场前应完成规格型号、数量、质量证明文件和外观质量核验，未经验收不得投入使用。",
    snapshot.acceptancePlan ? `验收标准：${normalizeSentence(snapshot.acceptancePlan)}` : "验收标准应覆盖功能恢复、施工质量、观感质量、运行稳定性和资料完整性。",
    snapshot.hiddenWorksRequirement ? `隐蔽工程：${normalizeSentence(snapshot.hiddenWorksRequirement)}` : "隐蔽工程应执行隐蔽前检查确认，留存照片和验收记录后方可封闭。",
    snapshot.sampleFirstRequirement ? `样板先行：${normalizeSentence(snapshot.sampleFirstRequirement)}` : "同类重复作业宜执行首件确认或样板先行，确认后再批量展开。",
    snapshot.detailDrawingRequirement ? `关键节点深化安排：${normalizeSentence(snapshot.detailDrawingRequirement)}` : "立项阶段不以完整施工图或详细节点大样作为前置条件；开工前应由中标单位或专业单位完善关键节点做法确认、现场记录和验收留档要求。",
    ...mandatoryRequirements.map((item) => item.writebackText || item.requirement),
    ...internalControlRequirements.map((item) => item.writebackText || item.action),
    ...adoptedWritebacks.map((item) => item.text)
  ]);

  const safetyControl = nonEmptyLines([
    "开工前完成安全技术交底，明确作业边界、人员分工、应急联系人、材料堆放区和现场负责人。",
    "涉及停机、切换、动火、临电、高处、有限空间或夜间作业时，应按公司安全管理制度办理审批，并落实现场监护。",
    "施工区域应设置围挡、警示标识和通行引导，避免影响业主通行、设备运行和消防疏散。",
    snapshot.thirdPartyTestingRequirement ? `专项检测或复核：${normalizeSentence(snapshot.thirdPartyTestingRequirement)}` : undefined
  ]);

  const riskAndEmergency = nonEmptyLines([
    snapshot.temporaryMeasures ? `延续或优化临时措施：${normalizeSentence(snapshot.temporaryMeasures)}` : "开工前应确认临时保障措施，避免施工期间服务中断或风险扩大。",
    "施工过程中如发现现场条件、设备状态、隐蔽情况与申报资料不一致，应暂停相关作业并完成变更确认。",
    "对可能影响运营的停机、噪声、扬尘、渗漏、断电或动线调整，应提前制定应急恢复和告知机制。",
    ...(context.review?.requiredActions ?? []).map((item) => `审核要求落实：${normalizeSentence(item)}`),
    ...(context.review?.missingMaterials ?? []).map((item) => `开工前补齐：${normalizeSentence(item)}`)
  ]);

  return {
    reportType: "construction-plan",
    project: {
      id: context.project.id,
      title: context.project.title,
      organizationName: context.organization?.name ?? "未分配组织",
      versionNumber: context.version.versionNumber,
      categoryLabel: CATEGORY_LABELS[snapshot.projectCategory],
      priorityLabel: PRIORITY_LABELS[snapshot.priority],
      locationSummary: summarizeLocation(snapshot.location),
      expectedWindow: formatDateRange(snapshot.expectedStartDate, snapshot.expectedEndDate)
    },
    scope: buildConstructionScope(snapshot, projectName),
    preparation: nonEmptyLines([
      "组织施工单位、申报单位、物业运营和必要供应商完成现场踏勘，确认施工边界、作业窗口和影响范围。",
      "复核审批通过的工程量清单、材料设备规格、关键节点做法和后续深化资料，形成开工前确认记录。",
      "完成材料设备进场计划、堆放区域、运输路线、垃圾清运和成品保护方案。",
      "向受影响区域完成施工告知，明确施工时间、影响事项、应急联系人和投诉响应方式。",
      snapshot.issueSourceDescription ? `问题来源补充说明：${normalizeSentence(snapshot.issueSourceDescription)}` : undefined
    ]),
    procedures,
    schedule: snapshot.preliminaryPlan?.trim()
      ? `施工进度按以下实施路径组织：${normalizeSentence(snapshot.preliminaryPlan)}实际排期应结合材料到场、运营窗口和现场审批情况滚动校准，关键切换或联调环节应预留恢复时间。`
      : "施工进度应按“开工准备、材料进场、现场施工、联调测试、验收移交”五个阶段组织，关键切换或停复机环节应结合运营窗口单独确认。",
    qualityControl: qualityControl.length ? qualityControl : ["按验收方案和公司工程质量要求执行。"],
    safetyControl,
    riskAndEmergency,
    acceptanceAndHandover: nonEmptyLines([
      snapshot.acceptancePlan ? `验收执行：${normalizeSentence(snapshot.acceptancePlan)}` : "完工后应按功能、质量、运行和资料四类要求组织验收。",
      snapshot.maintenancePlan ? `后续维护：${normalizeSentence(snapshot.maintenancePlan)}` : "移交后纳入物业日常巡检和维保计划，重点跟踪运行状态和问题复发情况。",
      "完工后应移交验收记录、隐蔽工程照片、调试记录、材料合格证明、问题整改闭环记录、竣工或节点资料及后续维保要求。"
    ]),
    mandatoryRequirements,
    internalControlRequirements,
    adoptedWritebacks,
    citations: context.review?.citations ?? [],
    attachmentSlots: context.attachmentSlots
  };
}

export function buildAiReviewPdfDocument(context: ReportContext): PdfDocumentDefinition {
  const report = buildFinalReviewReport(context);
  return {
    ...buildFinalReviewPdfDocument(report),
    title: "工程立项 AI 预审报告",
    subtitle: "AI 预审结论与风险提示"
  };
}

export function buildFinalReviewPdfDocument(payload: FinalReviewReportPayload): PdfDocumentDefinition {
  const duplicateMatches = payload.sections.duplicate?.matches ?? [];

  return {
    title: "工程立项最终审核报告",
    subtitle: "人工最终结论、AI 判断与预算摘要",
    headerRight: `${payload.project.title} · V${payload.version.versionNumber}`,
    coverSummary: [
      { label: "项目", value: payload.project.title },
      { label: "组织", value: payload.project.organizationName },
      { label: "版本", value: `V${payload.version.versionNumber}` },
      { label: "人工最终结论", value: payload.finalDecision.label },
      { label: "审核人", value: payload.finalDecision.reviewerName ?? "待人工审核" },
      { label: "审核时间", value: formatDateOrFallback(payload.finalDecision.decidedAt) },
      { label: "申报预算", value: formatCurrency(payload.summary.declaredBudget) },
      { label: "预算差额", value: formatCurrency(payload.summary.budgetGap) }
    ],
    sections: [
      {
        title: "一、人工最终结论",
        blocks: [
          {
            type: "key-values",
            columns: 2,
            items: [
              { label: "审核结果", value: payload.finalDecision.label },
              { label: "审核人", value: payload.finalDecision.reviewerName ?? "待人工审核" },
              { label: "审核时间", value: formatDateOrFallback(payload.finalDecision.decidedAt) },
              { label: "版本状态", value: payload.version.statusLabel }
            ]
          },
          { type: "paragraph", text: `人工审核意见：${payload.finalDecision.comment ?? "暂无人工审核意见。"}` }
        ]
      },
      {
        title: "二、预算与版本摘要",
        blocks: [
          {
            type: "key-values",
            columns: 2,
            items: [
              { label: "改造类别", value: payload.summary.categoryLabel },
              { label: "优先级", value: payload.summary.priorityLabel },
              { label: "实施位置", value: payload.summary.locationSummary },
              { label: "实施窗口", value: payload.summary.expectedWindow },
              { label: "申报预算", value: formatCurrency(payload.summary.declaredBudget) },
              { label: "矩阵测算", value: formatCurrency(payload.summary.calculatedBudget) },
              { label: "预算差额", value: formatCurrency(payload.summary.budgetGap) }
            ]
          }
        ]
      },
      {
        title: "三、AI 审核摘要",
        blocks: [
          {
            type: "key-values",
            columns: 2,
            items: [
              { label: "AI 结论", value: payload.aiSummary.verdictLabel },
              { label: "AI 评分", value: payload.aiSummary.overallScore ? `${payload.aiSummary.overallScore} 分` : "无" },
              { label: "模型", value: payload.aiSummary.modelName ?? "未记录" },
              { label: "生成时间", value: formatDateOrFallback(payload.aiSummary.generatedAt) }
            ]
          },
          { type: "paragraph", text: payload.aiSummary.conclusion }
        ]
      },
      {
        title: "四、核心风险与处理建议",
        blocks: [
          {
            type: "bullets",
            items: nonEmptyLines([
              ...payload.aiSummary.requiredActions.map((item) => `必改动作：${item}`),
              ...payload.aiSummary.missingMaterials.map((item) => `需补材料：${item}`),
              ...payload.analysis.costQuestions.map((item) => `成本问题：${item}`)
            ]).length
              ? nonEmptyLines([
                  ...payload.aiSummary.requiredActions.map((item) => `必改动作：${item}`),
                  ...payload.aiSummary.missingMaterials.map((item) => `需补材料：${item}`),
                  ...payload.analysis.costQuestions.map((item) => `成本问题：${item}`)
                ])
              : ["当前版本无强制整改项。"]
          }
        ]
      },
      {
        title: "五、强制规范要求",
        blocks: buildMandatoryRequirementBlocks(payload.aiSummary.citations, payload.aiSummary.mandatoryRequirements)
      },
      {
        title: "六、平台审批硬性要求",
        blocks: buildInternalControlBlocks(payload.aiSummary.internalControlRequirements)
      },
      {
        title: "七、已采纳 AI 优化建议",
        blocks: buildWritebackBlocks("已采纳 AI 优化建议", payload.analysis.adoptedWritebacks)
      },
      {
        title: "八、合规与实施约束",
        blocks: buildReviewSectionBlocks("合规与实施约束", payload.sections.compliance)
      },
      {
        title: "九、成本与预算核查",
        blocks: [
          ...buildReviewSectionBlocks("成本与预算核查", payload.sections.cost),
          ...buildAdvisoryBlocks("成本优化建议", payload.sections.cost?.optimizationCandidates ?? []),
          ...buildAdvisoryBlocks(
            "经验估价复核",
            payload.aiSummary.costEstimateRanges.map((item) => ({
              id: item.id,
              title: item.itemName,
              recommendation: `${item.optimizationSpace}${item.suggestedMin && item.suggestedMax ? `；建议复核区间：${formatCurrency(item.suggestedMin)} - ${formatCurrency(item.suggestedMax)}` : ""}`,
              reason: item.basis,
              requiredMaterials: [],
              kind: "optimization",
              priority: "medium",
              moduleHints: ["cost"]
            }))
          )
        ]
      },
      {
        title: "十、技术与交付风险",
        blocks: [
          ...buildReviewSectionBlocks("技术与交付风险", payload.sections.technical),
          ...buildAdvisoryBlocks("技术替代路径建议", payload.analysis.technicalAlternativePaths)
        ]
      },
      {
        title: "十一、重复改造识别",
        blocks: payload.sections.duplicate
          ? duplicateMatches.length
            ? [
                { type: "paragraph", text: payload.sections.duplicate.conclusion },
                {
                  type: "table",
                  table: {
                    headers: ["项目", "版本", "位置摘要", "命中原因"],
                    rows: duplicateMatches.map((item) => [
                      item.projectTitle,
                      `V${item.versionNumber}`,
                      item.locationSummary,
                      item.matchReason
                    ]),
                    columnWidths: [24, 10, 30, 36],
                    fontSize: 9
                  }
                }
              ]
            : [{ type: "paragraph", text: payload.sections.duplicate.conclusion }]
          : [{ type: "paragraph", text: "当前版本暂无重复改造识别结果。" }]
      },
      {
        title: "十二、原始附件",
        blocks: [{ type: "key-values", columns: 2, items: summarizeAttachments(payload.attachmentSlots) }]
      }
    ]
  };
}

export function buildFeasibilityPdfDocument(payload: FeasibilityReportPayload): PdfDocumentDefinition {
  return {
    title: "工程立项可行性报告",
    subtitle: "建设必要性、实施条件与投资估算",
    headerRight: `${payload.project.title} · V${payload.project.versionNumber}`,
    coverSummary: [
      { label: "项目", value: payload.project.title },
      { label: "组织", value: payload.project.organizationName },
      { label: "分类/优先级", value: `${payload.project.categoryLabel} / ${payload.project.priorityLabel}` },
      { label: "计划周期", value: payload.overview.expectedWindow },
      { label: "申报预算", value: formatCurrency(payload.budgetSummary.declaredBudget) },
      { label: "测算预算", value: formatCurrency(payload.budgetSummary.calculatedBudget) },
      { label: "预算差额", value: formatCurrency(payload.budgetSummary.budgetGap) },
      { label: "结论建议", value: payload.conclusion.title }
    ],
    sections: [
      {
        title: "一、项目概况",
        blocks: [
          {
            type: "key-values",
            columns: 2,
            items: [
              { label: "项目名称", value: payload.overview.projectName },
              { label: "实施位置", value: payload.overview.locationSummary },
              { label: "问题来源", value: payload.overview.issueSourceType },
              { label: "计划周期", value: payload.overview.expectedWindow }
            ]
          },
          { type: "paragraph", text: `立项目标：${payload.overview.objective}` },
          { type: "paragraph", text: `预期收益：${payload.overview.expectedBenefits}` }
        ]
      },
      {
        title: "二、建设必要性",
        blocks: [
          { type: "paragraph", text: `问题描述：${payload.problemBackground.issueDescription}` },
          { type: "paragraph", text: `当前状态：${payload.problemBackground.currentCondition}` },
          { type: "paragraph", text: `影响范围：${payload.problemBackground.impactScope}` },
          { type: "paragraph", text: `临时措施：${payload.problemBackground.temporaryMeasures}` }
        ]
      },
      {
        title: "三、实施条件与技术方案",
        blocks: [
          { type: "paragraph", text: `实施范围：${payload.solutionSummary.implementationScope}` },
          { type: "paragraph", text: `可行性说明：${payload.solutionSummary.feasibilitySummary}` },
          { type: "paragraph", text: `关键工艺：${payload.solutionSummary.keyProcess}` },
          { type: "paragraph", text: `材料选型：${payload.solutionSummary.materialSelection}` },
          { type: "paragraph", text: `实施路径：${payload.solutionSummary.preliminaryPlan}` }
        ]
      },
      {
        title: "四、强制规范要求",
        blocks: buildMandatoryRequirementBlocks(payload.citations, payload.mandatoryRequirements)
      },
      {
        title: "五、平台审批硬性要求",
        blocks: buildInternalControlBlocks(payload.internalControlRequirements)
      },
      {
        title: "六、已采纳 AI 优化建议",
        blocks: buildWritebackBlocks("已采纳 AI 优化建议", payload.adoptedWritebacks)
      },
      {
        title: "七、投资估算",
        blocks: [
          {
            type: "key-values",
            columns: 2,
            items: [
              { label: "工程项小计", value: formatCurrency(payload.budgetSummary.engineeringSubtotal) },
              { label: "其他费用小计", value: formatCurrency(payload.budgetSummary.otherFeeSubtotal) },
              { label: "测算总价", value: formatCurrency(payload.budgetSummary.calculatedBudget) },
              { label: "申报总预算", value: formatCurrency(payload.budgetSummary.declaredBudget) },
              { label: "预算差额", value: formatCurrency(payload.budgetSummary.budgetGap) }
            ]
          },
          {
            type: "table",
            table: {
              headers: ["重点成本项", "规格", "金额"],
              rows: payload.topCostItems.length
                ? payload.topCostItems.map((item) => [
                    item.itemName,
                    item.specification || "-",
                    formatCurrency(item.lineTotal)
                  ])
                : [["暂无重点成本项", "-", "-"]],
              columnWidths: [38, 38, 24],
              fontSize: 9
            }
          }
        ]
      },
      {
        title: "八、风险与控制",
        blocks: [
          { type: "bullets", items: payload.riskAndControl.length ? payload.riskAndControl : ["无"] },
          ...buildAdvisoryBlocks("成本优化建议", payload.costInsights.optimizationCandidates),
          ...buildAdvisoryBlocks("技术替代路径建议", payload.technicalInsights.alternativePaths)
        ]
      },
      {
        title: "九、结论建议",
        blocks: [
          { type: "paragraph", text: payload.conclusion.title },
          { type: "paragraph", text: payload.conclusion.body }
        ]
      },
      {
        title: "十、附件清单",
        blocks: [{ type: "key-values", columns: 2, items: summarizeAttachments(payload.attachmentSlots) }]
      }
    ]
  };
}

export function buildBillOfQuantitiesPdfDocument(payload: BillOfQuantitiesPayload): PdfDocumentDefinition {
  const uploadedSheet = payload.uploadedSheetSummary;
  const uploadSections: PdfDocumentDefinition["sections"] =
    payload.sourceMode === "upload" && uploadedSheet
      ? [
          {
            title: "一、上传清单识别摘要",
            blocks: [
              {
                type: "key-values" as const,
                columns: 2,
                items: [
                  { label: "原始文件", value: uploadedSheet.fileName },
                  { label: "识别工作表", value: uploadedSheet.parsedSheetNames?.join("、") ?? payload.project.title },
                  { label: "明细行数", value: `${uploadedSheet.detailRowCount} 行` },
                  { label: "识别总价", value: formatCurrency(uploadedSheet.totalAmount ?? 0) },
                  { label: "总价位置", value: `${uploadedSheet.totalSheetName ?? "-"} ${uploadedSheet.totalCell ?? "-"}` },
                  { label: "解析时间", value: formatDateOrFallback(uploadedSheet.parsedAt) }
                ]
              },
              { type: "paragraph" as const, text: payload.declaredBudgetNote }
            ]
          },
          {
            title: "二、分组汇总",
            blocks: [
              {
                type: "table" as const,
                table: {
                  headers: ["分组", "工作表", "行区间", "小计", "税费", "总计"],
                  rows: uploadedSheet.sections.length
                    ? uploadedSheet.sections.map((section) => [
                        section.name,
                        section.sheetName,
                        `${section.startRow}-${section.endRow ?? section.startRow}`,
                        section.subtotal === undefined ? "-" : formatCurrency(section.subtotal),
                        section.tax === undefined ? "-" : formatCurrency(section.tax),
                        section.total === undefined ? "-" : formatCurrency(section.total)
                      ])
                    : [["未识别到分组", "-", "-", "-", "-", "-"]],
                  columnWidths: [30, 14, 12, 14, 14, 16],
                  fontSize: 8
                }
              }
            ]
          },
          {
            title: "三、解析提示与原表说明",
            blocks: [
              {
                type: "bullets" as const,
                items: uploadedSheet.warnings.length
                  ? uploadedSheet.warnings
                  : ["清单已完成结构化解析，未发现影响总价识别的异常提示。"]
              },
              {
                type: "bullets" as const,
                items: uploadedSheet.notes.length ? uploadedSheet.notes : ["原始 Excel 作为正式详细工程量清单留存和下载。"]
              }
            ]
          }
        ]
      : [
          {
            title: "一、工程量清单明细",
            blocks: [
              {
                type: "table" as const,
                table: {
                  headers: ["序号", "分类", "项目名称", "规格型号", "单位", "工程量", "单价", "合价", "备注"],
                  rows: payload.rows.map((item, index) => [
                    `${index + 1}`,
                    item.typeLabel,
                    item.itemName,
                    item.specification || "-",
                    item.unit || "-",
                    `${item.quantity}`,
                    formatCurrency(item.unitPrice),
                    formatCurrency(item.lineTotal),
                    item.remark || "-"
                  ]),
                  columnWidths: [6, 10, 20, 18, 8, 10, 12, 12, 14],
                  fontSize: 8
                }
              }
            ]
          },
          {
            title: "二、费用汇总",
            blocks: [
              {
                type: "key-values" as const,
                columns: 2,
                items: [
                  { label: "工程项小计", value: formatCurrency(payload.budgetSummary.engineeringSubtotal) },
                  { label: "其他费用小计", value: formatCurrency(payload.budgetSummary.otherFeeSubtotal) },
                  { label: "测算总价", value: formatCurrency(payload.budgetSummary.calculatedBudget) },
                  { label: "申报预算", value: formatCurrency(payload.budgetSummary.declaredBudget) },
                  { label: "预算差额", value: formatCurrency(payload.budgetSummary.budgetGap) }
                ]
              },
              { type: "paragraph" as const, text: payload.declaredBudgetNote }
            ]
          }
        ];

  return {
    title: "工程量清单",
    subtitle: "执行与招采参考版本",
    headerRight: `${payload.project.title} · V${payload.project.versionNumber}`,
    coverSummary: [
      { label: "项目", value: payload.project.title },
      { label: "组织", value: payload.project.organizationName },
      { label: "分类", value: payload.project.categoryLabel },
      { label: "实施周期", value: payload.project.expectedWindow },
      { label: "申报预算", value: formatCurrency(payload.budgetSummary.declaredBudget) },
      { label: "测算总价", value: formatCurrency(payload.budgetSummary.calculatedBudget) },
      { label: "预算差额", value: formatCurrency(payload.budgetSummary.budgetGap) },
      { label: "说明", value: payload.declaredBudgetNote }
    ],
    sections: uploadSections
  };
}

export function buildConstructionPlanPdfDocument(payload: ConstructionPlanPayload): PdfDocumentDefinition {
  return {
    title: "工程施工方案",
    subtitle: "现场执行版",
    headerRight: `${payload.project.title} · V${payload.project.versionNumber}`,
    coverSummary: [
      { label: "项目", value: payload.project.title },
      { label: "组织", value: payload.project.organizationName },
      { label: "分类/优先级", value: `${payload.project.categoryLabel} / ${payload.project.priorityLabel}` },
      { label: "实施位置", value: payload.project.locationSummary },
      { label: "计划周期", value: payload.project.expectedWindow }
    ],
    sections: [
      {
        title: "一、工程概况",
        blocks: [
          { type: "paragraph", text: `工程名称：${payload.project.title}` },
          { type: "paragraph", text: `实施位置：${payload.project.locationSummary}` },
          { type: "paragraph", text: `工程类别：${payload.project.categoryLabel}` },
          { type: "paragraph", text: `计划周期：${payload.project.expectedWindow}` }
        ]
      },
      { title: "二、施工范围", blocks: [{ type: "paragraph", text: payload.scope }] },
      { title: "三、施工准备", blocks: [{ type: "bullets", items: payload.preparation }] },
      { title: "四、主要施工工序", blocks: [{ type: "bullets", items: payload.procedures }] },
      { title: "五、进度安排", blocks: [{ type: "paragraph", text: payload.schedule }] },
      { title: "六、质量控制", blocks: [{ type: "bullets", items: payload.qualityControl }] },
      { title: "七、安全文明施工", blocks: [{ type: "bullets", items: payload.safetyControl }] },
      { title: "八、风险与应急", blocks: [{ type: "bullets", items: payload.riskAndEmergency }] },
      { title: "九、验收交付", blocks: [{ type: "bullets", items: payload.acceptanceAndHandover }] },
      {
        title: "十、强制规范要求",
        blocks: buildMandatoryRequirementBlocks(payload.citations, payload.mandatoryRequirements)
      },
      {
        title: "十一、平台审批硬性要求",
        blocks: buildInternalControlBlocks(payload.internalControlRequirements)
      },
      {
        title: "十二、已采纳 AI 优化建议",
        blocks: buildWritebackBlocks("已采纳 AI 优化建议", payload.adoptedWritebacks)
      },
      {
        title: "十三、附件清单",
        blocks: [{ type: "key-values", columns: 2, items: summarizeAttachments(payload.attachmentSlots) }]
      }
    ]
  };
}
