export type Role = "submitter" | "reviewer" | "admin";

export type ProjectCategory =
  | "mep_upgrade"
  | "fire_safety"
  | "energy_retrofit"
  | "civil_upgrade"
  | "plumbing_drainage";

export type Priority = "low" | "medium" | "high";

export type ProjectStatus =
  | "draft"
  | "submitted"
  | "ai_reviewing"
  | "ai_returned"
  | "ai_recommended_pass"
  | "ai_conditionally_passed"
  | "human_approved"
  | "human_returned";

export type ReviewVerdict = "pass" | "conditional_pass" | "fail";

export type AttachmentKind = "pdf" | "word" | "image" | "spreadsheet" | "other";

export type IssueSourceType =
  | "inspection"
  | "complaint"
  | "work_order"
  | "safety_hazard"
  | "energy_optimization"
  | "repair_renewal"
  | "other";

export type UrgencyLevel = "low" | "medium" | "high" | "critical";

export type AttachmentSlotKey = "issue_photos" | "fault_registry" | "drawings" | "supplementary";

export type ReviewSeverity = "high" | "medium" | "low";
export type ReviewModule = "compliance" | "cost" | "technical" | "general";
export type AdvisoryRecommendationKind =
  | "general"
  | "optimization"
  | "question"
  | "must_keep"
  | "alternative_path";

export type SubmissionBlockReason =
  | "weekly_quota_reached"
  | "cooldown_active"
  | "project_locked"
  | "already_submitted";

export type CostRowType = "engineering" | "other_fee";

export type RiskFlagKey =
  | "powerOrWaterShutdown"
  | "fireSystemImpact"
  | "hotWork"
  | "workingAtHeight"
  | "concealedWork"
  | "nightWork"
  | "occupiedAreaImpact"
  | "thirdPartyTesting";

export type RiskFlags = Partial<Record<RiskFlagKey, boolean>>;

export type CategorySpecificFields = Partial<
  Record<ProjectCategory, Record<string, string | number | boolean>>
>;

export interface QuotaPolicy {
  weeklyQuotaPerCity: number;
  resubmitCooldownDays: number;
  allowOverride: boolean;
}

export interface Organization {
  id: string;
  name: string;
  kind: "city_company" | "regional_hq" | "group_hq";
}

export interface User {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: Role;
  organizationId: string;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  organizationId: string;
}

export interface LocationInfo {
  propertyName: string;
  building: string;
  floor: string;
  area: string;
  room: string;
  equipmentPoint: string;
  impactScope: string;
}

export interface CostMatrixRow {
  id: string;
  type: CostRowType;
  itemName: string;
  specification: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  remark: string;
}

export interface BudgetSummary {
  engineeringSubtotal: number;
  otherFeeSubtotal: number;
  calculatedBudget: number;
  declaredBudget: number;
  budgetGap: number;
  topCostItems: Array<{ itemName: string; specification: string; lineTotal: number }>;
}

export interface Attachment {
  id: string;
  projectId: string;
  versionId: string;
  slotKey: AttachmentSlotKey;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  kind: AttachmentKind;
  uploadedAt: string;
}

export interface AttachmentParseResult {
  id: string;
  attachmentId: string;
  status: "pending" | "completed" | "failed";
  extractedText?: string;
  summary?: string;
  failureReason?: string;
}

export interface AttachmentSlotDefinition {
  key: AttachmentSlotKey;
  label: string;
  description: string;
  required: boolean;
  maxFiles: number;
  acceptedKinds: AttachmentKind[];
}

export interface VersionAttachmentSlot extends AttachmentSlotDefinition {
  status: "provided" | "missing" | "optional" | "not_applicable";
  attachments: Attachment[];
}

export interface FormSnapshot {
  projectName: string;
  projectCategory: ProjectCategory;
  priority: Priority;
  budgetAmount: number;
  expectedStartDate: string;
  expectedEndDate: string;
  location: LocationInfo;
  issueSourceType: IssueSourceType;
  issueSourceDescription: string;
  issueDescription: string;
  currentCondition: string;
  temporaryMeasures: string;
  complaintCount: number;
  workOrderCount: number;
  urgencyLevel: UrgencyLevel;
  objective: string;
  implementationScope: string;
  feasibilitySummary: string;
  keyProcess: string;
  materialSelection: string;
  maintenancePlan: string;
  acceptancePlan: string;
  hiddenWorksRequirement: string;
  sampleFirstRequirement: string;
  detailDrawingRequirement: string;
  thirdPartyTestingRequirement: string;
  preliminaryPlan: string;
  initialBudgetExplanation: string;
  expectedBenefits: string;
  supplementaryNotes: string;
  costMatrixRows: CostMatrixRow[];
  riskFlags?: RiskFlags;
  categorySpecificFields?: CategorySpecificFields;
}

export interface ReviewFinding {
  severity: ReviewSeverity;
  title: string;
  basis: string;
  currentState: string;
  action: string;
  requiredMaterials: string[];
}

export interface NormCitation {
  id: string;
  packId?: string;
  code: string;
  title: string;
  clause: string;
  summary: string;
  applicableModules: ReviewModule[];
}

export interface MandatoryRequirement {
  severity: ReviewSeverity;
  title: string;
  requirement: string;
  reason: string;
  citationIds: string[];
  writebackText: string;
  requiredMaterials: string[];
}

export interface InternalControlRequirement {
  id: string;
  severity: ReviewSeverity;
  title: string;
  requirement: string;
  reason: string;
  action: string;
  requiredMaterials: string[];
  source: "platform_policy" | "skill_pack";
  ruleId?: string;
  writebackText?: string;
}

export interface AdvisoryRecommendation {
  id: string;
  title: string;
  recommendation: string;
  reason: string;
  requiredMaterials: string[];
  kind?: AdvisoryRecommendationKind;
  priority?: ReviewSeverity;
  moduleHints?: ReviewModule[];
}

export interface SchemeWritebackCandidate {
  id: string;
  title: string;
  targetSection: string;
  text: string;
  basis: string;
  citationIds: string[];
  autoApplied: boolean;
  sourceModule?: ReviewModule;
}

export interface CostEstimateRange {
  id: string;
  itemName: string;
  basis: string;
  currentAmount?: number;
  suggestedMin?: number;
  suggestedMax?: number;
  optimizationSpace: string;
  requiresManualReview: boolean;
  relatedRuleIds: string[];
}

export interface ReviewSection {
  title: string;
  summary?: string;
  conclusion: string;
  findings: ReviewFinding[];
  mandatoryItems?: MandatoryRequirement[];
  advisoryItems?: AdvisoryRecommendation[];
  schemeCandidates?: SchemeWritebackCandidate[];
  mustKeepItems?: string[];
  optimizationCandidates?: AdvisoryRecommendation[];
  costQuestions?: string[];
  alternativePaths?: AdvisoryRecommendation[];
}

export interface DuplicateRemodelingMatch {
  projectId: string;
  projectTitle: string;
  versionId: string;
  versionNumber: number;
  status: ProjectStatus;
  createdAt: string;
  locationSummary: string;
  matchReason: string;
  similarityScore: number;
}

export interface AIReviewResult {
  id: string;
  projectId: string;
  versionId: string;
  verdict: ReviewVerdict;
  overallScore: number;
  conclusion: string;
  attachmentReadSummary: string[];
  missingMaterials: string[];
  requiredActions: string[];
  complianceReview: ReviewSection;
  costReview: ReviewSection;
  technicalReview: ReviewSection;
  citations?: NormCitation[];
  mandatoryRequirements?: MandatoryRequirement[];
  internalControlRequirements?: InternalControlRequirement[];
  advisoryRecommendations?: AdvisoryRecommendation[];
  advisoryWritebackCandidates?: SchemeWritebackCandidate[];
  schemeWritebacks?: SchemeWritebackCandidate[];
  costEstimateRanges?: CostEstimateRange[];
  skillPackVersion?: string;
  duplicateReview: {
    title: string;
    conclusion: string;
    matches: DuplicateRemodelingMatch[];
  };
  modelName: string;
  promptVersion: string;
  generatedAt: string;
}

export interface HumanDecision {
  id: string;
  projectId: string;
  versionId: string;
  reviewerId: string;
  decision: "approved" | "returned";
  comment: string;
  selectedWritebackIds?: string[];
  decidedAt: string;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  status: ProjectStatus;
  snapshot: FormSnapshot;
  submittedAt?: string;
  aiReviewedAt?: string;
  returnedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface OverrideGrant {
  id: string;
  projectId: string;
  grantedBy: string;
  scope: "weekly_quota" | "cooldown" | "both";
  reason: string;
  used: boolean;
  createdAt: string;
  usedAt?: string;
}

export interface QuotaUsageLedger {
  id: string;
  organizationId: string;
  projectId: string;
  versionId: string;
  consumedAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  projectId: string;
  versionId?: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  ownerId: string;
  currentVersionId: string;
  title: string;
  category: ProjectCategory;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAggregate {
  project: Project;
  versions: ProjectVersion[];
  attachments: Attachment[];
  attachmentParseResults: AttachmentParseResult[];
  aiReviews: AIReviewResult[];
  humanDecisions: HumanDecision[];
  overrides: OverrideGrant[];
}

export interface SubmissionEligibility {
  allowed: boolean;
  remainingWeeklyQuota: number;
  weeklyQuota: number;
  reason?: SubmissionBlockReason;
  blockedUntil?: string;
  overrideAvailable: boolean;
  availableOverrideId?: string;
}

export interface ProjectCostBoardRow {
  projectId: string;
  organizationId: string;
  organizationName: string;
  projectName: string;
  projectCategory: ProjectCategory;
  locationSummary: string;
  status: ProjectStatus;
  initialBudget: number;
  currentBudget: number;
  finalBudget?: number;
  budgetDelta: number;
  submissionCount: number;
  updatedAt: string;
  duplicateFlag: boolean;
}

export interface AuthResponse {
  token: string;
  user: SessionUser;
}

export interface DuplicateComparisonRecord {
  projectId: string;
  projectTitle: string;
  projectCategory: ProjectCategory;
  versionId: string;
  versionNumber: number;
  status: ProjectStatus;
  createdAt: string;
  snapshot: FormSnapshot;
}

export interface TechnicalSchemeTemplate {
  objective: string;
  implementationScope: string;
  feasibilitySummary: string;
  keyProcess: string;
  materialSelection: string;
  maintenancePlan: string;
  acceptancePlan: string;
  hiddenWorksRequirement: string;
  sampleFirstRequirement: string;
  detailDrawingRequirement: string;
  thirdPartyTestingRequirement: string;
  preliminaryPlan: string;
}

export const DEFAULT_QUOTA_POLICY: QuotaPolicy = {
  weeklyQuotaPerCity: 3,
  resubmitCooldownDays: 3,
  allowOverride: true
};

export const PROJECT_CATEGORY_LABELS: Record<ProjectCategory, string> = {
  mep_upgrade: "机电改造",
  fire_safety: "消防安全",
  energy_retrofit: "节能改造",
  civil_upgrade: "土建改造",
  plumbing_drainage: "给排水改造"
};

export const ISSUE_SOURCE_LABELS: Record<IssueSourceType, string> = {
  inspection: "巡检发现",
  complaint: "客户投诉",
  work_order: "工单/报修",
  safety_hazard: "安全隐患",
  energy_optimization: "节能优化",
  repair_renewal: "设施更新",
  other: "其他"
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高"
};

export const URGENCY_LEVEL_LABELS: Record<UrgencyLevel, string> = {
  low: "一般",
  medium: "较紧急",
  high: "紧急",
  critical: "特紧急"
};

export const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  pass: "通过",
  conditional_pass: "有条件通过",
  fail: "不通过"
};

export const COST_ROW_TYPE_LABELS: Record<CostRowType, string> = {
  engineering: "工程量",
  other_fee: "其他费用"
};

export const ATTACHMENT_SLOT_LABELS: Record<AttachmentSlotKey, string> = {
  issue_photos: "问题照片",
  fault_registry: "故障点位台账",
  drawings: "图纸",
  supplementary: "补充材料"
};

export const TECHNICAL_FIELD_LABELS: Record<keyof TechnicalSchemeTemplate, string> = {
  objective: "改造目标",
  implementationScope: "实施范围",
  feasibilitySummary: "可行性说明",
  keyProcess: "关键工艺",
  materialSelection: "材料选型",
  maintenancePlan: "运维要求",
  acceptancePlan: "验收方案",
  hiddenWorksRequirement: "隐蔽工程要求",
  sampleFirstRequirement: "样板先行要求",
  detailDrawingRequirement: "节点详图要求",
  thirdPartyTestingRequirement: "第三方检测要求",
  preliminaryPlan: "初步方案"
};

export const TECHNICAL_SCHEME_TEMPLATES: Record<ProjectCategory, TechnicalSchemeTemplate> = {
  mep_upgrade: {
    objective: "围绕 xxx 设备/系统存在的故障、老化或能效问题，完成 xxx 部位改造，确保运行稳定并降低后续停机风险。",
    implementationScope: "实施范围包括 xxx 设备本体、xxx 配套管线/电控、xxx 辅助设施，不涉及 xxx 范围内其他系统改造。",
    feasibilitySummary: "现场具备施工条件，xxx 时间窗口可安排停机/切换；关键风险为 xxx，拟通过 xxx 措施控制。",
    keyProcess: "主要工艺为：1. xxx 拆除或隔离；2. xxx 安装/更换；3. xxx 接线接管；4. xxx 联调试运行。",
    materialSelection: "拟选用 xxx 品牌/型号材料，满足 xxx 场景、寿命和维护要求，并与现有 xxx 系统兼容。",
    maintenancePlan: "改造完成后由 xxx 单位负责质保与维保，质保期 xxx，日常点检频次 xxx。",
    acceptancePlan: "按照 xxx 指标进行到货验收、安装验收、联调试运行和 xxx 小时带载/联动验证。",
    hiddenWorksRequirement: "涉及隐蔽工程的部位包括 xxx，施工前后需拍照留档并形成验收记录。",
    sampleFirstRequirement: "对 xxx 节点先做样板，确认做法、尺寸和质量标准后再全面展开。",
    detailDrawingRequirement: "需补充 xxx 节点详图、接线/接管示意及 xxx 平面定位图。",
    thirdPartyTestingRequirement: "如涉及 xxx 性能或安全验证，需安排第三方检测并出具报告。",
    preliminaryPlan: "实施计划分为 xxx 阶段：前期复核、材料采购、现场施工、联调试运行、交付验收。"
  },
  fire_safety: {
    objective: "围绕 xxx 消防系统故障或隐患，完成 xxx 改造，恢复系统完整性和联动可靠性。",
    implementationScope: "实施范围包括 xxx 设备/管网/控制柜/末端点位，不涉及 xxx 区域其他系统更换。",
    feasibilitySummary: "现场施工条件基本具备，可利用 xxx 时段组织施工；需重点协调 xxx，避免影响现有消防值守。",
    keyProcess: "主要工艺为：1. xxx 隔离与保护；2. xxx 拆除更换；3. xxx 联动接入；4. xxx 功能测试与恢复。",
    materialSelection: "拟选用满足 xxx 消防规范和现行产品标准的 xxx 型号材料/设备。",
    maintenancePlan: "交付后由 xxx 维保单位纳入年度维保计划，维保频次 xxx，故障响应时限 xxx。",
    acceptancePlan: "按 xxx 规范执行安装验收、联动测试、报警/启停验证和资料移交。",
    hiddenWorksRequirement: "涉及隐蔽布线、埋地/吊顶管线等部位时，需形成隐蔽验收记录并留存影像。",
    sampleFirstRequirement: "对 xxx 节点或典型点位先做样板，经确认后再批量实施。",
    detailDrawingRequirement: "需补充 xxx 系统图、回路图、点位图和节点详图。",
    thirdPartyTestingRequirement: "涉及消防功能恢复或整改闭环的，需由 xxx 第三方检测/维保单位确认。",
    preliminaryPlan: "实施分为 xxx 阶段：复核诊断、方案细化、现场施工、联动测试、整改销项。"
  },
  energy_retrofit: {
    objective: "针对 xxx 系统能耗偏高问题，实施 xxx 节能改造，在保证使用品质前提下降低能耗与维护成本。",
    implementationScope: "实施范围包括 xxx 设备、xxx 控制逻辑、xxx 末端优化，不涉及 xxx 土建改造。",
    feasibilitySummary: "现场具备实施条件，xxx 数据和运行窗口可满足改造验证；主要风险为 xxx，拟通过 xxx 控制。",
    keyProcess: "主要工艺为：1. xxx 基线复核；2. xxx 设备/控制改造；3. xxx 参数整定；4. xxx 试运行与节能验证。",
    materialSelection: "拟选用 xxx 高效设备/材料，兼顾节能效果、寿命周期和现有系统兼容性。",
    maintenancePlan: "改造后由 xxx 团队维护，重点关注 xxx 参数巡检和 xxx 周期保养。",
    acceptancePlan: "按照 xxx 指标对节能效果、运行稳定性和舒适性进行联合验收。",
    hiddenWorksRequirement: "涉及隐蔽安装部位时需拍照留档，并记录 xxx 参数和定位信息。",
    sampleFirstRequirement: "先在 xxx 区域做试点样板，验证效果后再分阶段推广。",
    detailDrawingRequirement: "需补充 xxx 系统图、控制逻辑图及关键节点做法说明。",
    thirdPartyTestingRequirement: "必要时安排 xxx 第三方进行能耗对比、性能验证或专项检测。",
    preliminaryPlan: "计划分为 xxx 阶段：基线确认、样板验证、分批实施、节能复盘。"
  },
  civil_upgrade: {
    objective: "针对 xxx 部位出现的裂缝/渗漏/空鼓/破损问题，完成 xxx 土建修复改造，恢复使用功能并降低二次返修风险。",
    implementationScope: "实施范围包括 xxx 区域基层处理、xxx 节点修复、xxx 面层恢复，不涉及 xxx 区域扩建。",
    feasibilitySummary: "现场施工条件基本具备，xxx 时段可组织围挡和作业；主要风险为 xxx，拟采取 xxx 保护措施。",
    keyProcess: "主要工艺为：1. xxx 病害复核；2. xxx 基层处理；3. xxx 修复/防水/加固；4. xxx 面层恢复与养护。",
    materialSelection: "拟选用适用于 xxx 场景的 xxx 材料，满足强度、耐久和后期维护要求。",
    maintenancePlan: "交付后由 xxx 单位进行巡检，观察期 xxx，重点关注 xxx 部位复发情况。",
    acceptancePlan: "按 xxx 标准执行基层、节点、防水/修补效果和成品观感验收。",
    hiddenWorksRequirement: "涉及基层修补、防水附加层、加固等隐蔽部位时，需留存完整影像和验收记录。",
    sampleFirstRequirement: "先对 xxx 典型节点做样板，确认工艺和观感后再大面积展开。",
    detailDrawingRequirement: "需补充 xxx 节点详图、分层做法图和施工范围平面示意。",
    thirdPartyTestingRequirement: "如涉及结构、渗漏或材料性能争议，需安排 xxx 第三方检测。",
    preliminaryPlan: "实施计划包括 xxx 阶段：现场复核、样板确认、分区施工、养护验收。"
  },
  plumbing_drainage: {
    objective: "围绕 xxx 给排水系统存在的漏水、堵塞、异味或供排水能力不足问题，实施 xxx 改造并恢复稳定运行。",
    implementationScope: "实施范围包括 xxx 管线、xxx 阀门/泵组/末端点位和 xxx 附属构件，不涉及 xxx 系统整体重建。",
    feasibilitySummary: "现场具备施工条件，可利用 xxx 停水/切换窗口实施；主要风险为 xxx，拟通过 xxx 方案控制。",
    keyProcess: "主要工艺为：1. xxx 漏点/堵点定位；2. xxx 管线拆改；3. xxx 试压/通水/通球；4. xxx 恢复与验证。",
    materialSelection: "拟选用适用于 xxx 场景的 xxx 管材及配件，满足寿命、防腐和维护需求。",
    maintenancePlan: "改造完成后由 xxx 团队纳入日常点检，重点关注 xxx 部位和 xxx 指标。",
    acceptancePlan: "按照 xxx 要求执行试压、通水、排水、密封及恢复效果验收。",
    hiddenWorksRequirement: "涉及埋地、吊顶或封闭空间内管线时，需留存定位照片和隐蔽验收记录。",
    sampleFirstRequirement: "先在 xxx 典型点位做样板，确认做法后分区域实施。",
    detailDrawingRequirement: "需补充 xxx 管网示意图、节点详图和停水切换流程图。",
    thirdPartyTestingRequirement: "必要时安排 xxx 第三方进行漏损、通水或水质专项检测。",
    preliminaryPlan: "实施计划分为 xxx 阶段：复核定位、材料准备、分区施工、试压通水、恢复交付。"
  }
};

export const FAULT_REGISTRY_TEMPLATE_HEADERS = [
  "楼盘/项目",
  "楼栋",
  "楼层",
  "区域/房间",
  "设备/点位",
  "故障/缺陷现象",
  "影响范围",
  "首次发现时间",
  "当前状态",
  "临时措施",
  "对应照片编号"
];

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createStableId(prefix: string, parts: Array<string | number | boolean | undefined | null>): string {
  const raw = parts.map((part) => String(part ?? "")).join("|").toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function createEmptyLocation(): LocationInfo {
  return {
    propertyName: "",
    building: "",
    floor: "",
    area: "",
    room: "",
    equipmentPoint: "",
    impactScope: ""
  };
}

export function createEmptyCostMatrixRow(type: CostRowType = "engineering"): CostMatrixRow {
  return {
    id: createId("cost"),
    type,
    itemName: "",
    specification: "",
    unit: "",
    quantity: type === "other_fee" ? 1 : 0,
    unitPrice: 0,
    remark: ""
  };
}

export function createEmptyRiskFlags(): RiskFlags {
  return {
    powerOrWaterShutdown: false,
    fireSystemImpact: false,
    hotWork: false,
    workingAtHeight: false,
    concealedWork: false,
    nightWork: false,
    occupiedAreaImpact: false,
    thirdPartyTesting: false
  };
}

export function createEmptyFormSnapshot(): FormSnapshot {
  return {
    projectName: "",
    projectCategory: "mep_upgrade",
    priority: "medium",
    budgetAmount: 0,
    expectedStartDate: "",
    expectedEndDate: "",
    location: createEmptyLocation(),
    issueSourceType: "inspection",
    issueSourceDescription: "",
    issueDescription: "",
    currentCondition: "",
    temporaryMeasures: "",
    complaintCount: 0,
    workOrderCount: 0,
    urgencyLevel: "medium",
    objective: "",
    implementationScope: "",
    feasibilitySummary: "",
    keyProcess: "",
    materialSelection: "",
    maintenancePlan: "",
    acceptancePlan: "",
    hiddenWorksRequirement: "",
    sampleFirstRequirement: "",
    detailDrawingRequirement: "",
    thirdPartyTestingRequirement: "",
    preliminaryPlan: "",
    initialBudgetExplanation: "",
    expectedBenefits: "",
    supplementaryNotes: "",
    costMatrixRows: [],
    riskFlags: createEmptyRiskFlags(),
    categorySpecificFields: {}
  };
}

export function calculateCostLineTotal(row: Pick<CostMatrixRow, "quantity" | "unitPrice">): number {
  return roundMoney(Number(row.quantity ?? 0) * Number(row.unitPrice ?? 0));
}

export function calculateBudgetSummary(params: {
  costMatrixRows: CostMatrixRow[];
  declaredBudget: number;
}): BudgetSummary {
  const engineeringSubtotal = roundMoney(
    params.costMatrixRows
      .filter((item) => item.type === "engineering")
      .reduce((sum, item) => sum + calculateCostLineTotal(item), 0)
  );
  const otherFeeSubtotal = roundMoney(
    params.costMatrixRows
      .filter((item) => item.type === "other_fee")
      .reduce((sum, item) => sum + calculateCostLineTotal(item), 0)
  );
  const calculatedBudget = roundMoney(engineeringSubtotal + otherFeeSubtotal);
  const declaredBudget = roundMoney(Number(params.declaredBudget ?? 0));
  const budgetGap = roundMoney(declaredBudget - calculatedBudget);
  const topCostItems = [...params.costMatrixRows]
    .map((item) => ({
      itemName: item.itemName,
      specification: item.specification,
      lineTotal: calculateCostLineTotal(item)
    }))
    .sort((left, right) => right.lineTotal - left.lineTotal)
    .slice(0, 3);

  return {
    engineeringSubtotal,
    otherFeeSubtotal,
    calculatedBudget,
    declaredBudget,
    budgetGap,
    topCostItems
  };
}

export function getAttachmentSlotDefinitions(
  _category: ProjectCategory,
  _sourceType: IssueSourceType
): AttachmentSlotDefinition[] {
  return [
    {
      key: "issue_photos",
      label: "问题照片",
      description: "上传现场问题照片，建议包含近景、远景和关键点位。",
      required: true,
      maxFiles: 6,
      acceptedKinds: ["image"]
    },
    {
      key: "fault_registry",
      label: "故障点位台账",
      description: "请上传系统模板整理的点位台账，便于 AI 按位置、现象和影响范围审核。",
      required: true,
      maxFiles: 1,
      acceptedKinds: ["spreadsheet"]
    },
    {
      key: "drawings",
      label: "图纸",
      description: "可上传 PDF 或图片格式的平面图、系统图、节点图等辅助资料。",
      required: false,
      maxFiles: 5,
      acceptedKinds: ["pdf", "image"]
    },
    {
      key: "supplementary",
      label: "补充材料",
      description: "其他补充说明材料，非必传。",
      required: false,
      maxFiles: 5,
      acceptedKinds: ["pdf", "word", "image", "spreadsheet", "other"]
    }
  ];
}

export function buildVersionAttachmentSlots(params: {
  category: ProjectCategory;
  sourceType: IssueSourceType;
  attachments: Attachment[];
}): VersionAttachmentSlot[] {
  return getAttachmentSlotDefinitions(params.category, params.sourceType).map((slot) => {
    const slotAttachments = params.attachments.filter((item) => item.slotKey === slot.key);
    const status = slot.required
      ? slotAttachments.length
        ? "provided"
        : "missing"
      : slotAttachments.length
        ? "provided"
        : "optional";

    return {
      ...slot,
      status,
      attachments: slotAttachments
    };
  });
}

export function summarizeLocation(location: LocationInfo): string {
  const parts = [
    location.propertyName,
    location.building,
    location.floor,
    location.area,
    location.room,
    location.equipmentPoint
  ].filter((item) => item.trim().length > 0);

  return parts.length ? parts.join(" / ") : "未填写位置";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function textLooksSimilar(left: string, right: string): boolean {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return true;
  }
  const shortSeed = normalizedLeft.slice(0, 4);
  return shortSeed.length >= 4 && normalizedRight.includes(shortSeed);
}

export function findDuplicateProjects(params: {
  currentProjectId?: string;
  snapshot: FormSnapshot;
  records: DuplicateComparisonRecord[];
}): DuplicateRemodelingMatch[] {
  const currentLocation = params.snapshot.location;

  return params.records
    .filter((record) => record.projectId !== params.currentProjectId)
    .map((record) => {
      let similarityScore = 0;
      const reasons: string[] = [];
      const recordLocation = record.snapshot.location;

      if (
        normalizeText(currentLocation.propertyName) &&
        normalizeText(currentLocation.propertyName) === normalizeText(recordLocation.propertyName)
      ) {
        similarityScore += 3;
        reasons.push("同楼盘/项目");
      }
      if (
        normalizeText(currentLocation.building) &&
        normalizeText(currentLocation.building) === normalizeText(recordLocation.building)
      ) {
        similarityScore += 2;
        reasons.push("同楼栋");
      }
      if (
        normalizeText(currentLocation.floor) &&
        normalizeText(currentLocation.floor) === normalizeText(recordLocation.floor)
      ) {
        similarityScore += 1;
        reasons.push("同楼层");
      }
      if (
        textLooksSimilar(currentLocation.area || currentLocation.room, recordLocation.area || recordLocation.room)
      ) {
        similarityScore += 2;
        reasons.push("区域/房间近似");
      }
      if (
        textLooksSimilar(currentLocation.equipmentPoint, recordLocation.equipmentPoint) &&
        normalizeText(currentLocation.equipmentPoint).length > 0
      ) {
        similarityScore += 2;
        reasons.push("设备/点位近似");
      }
      if (params.snapshot.projectCategory === record.projectCategory) {
        similarityScore += 1;
        reasons.push("同改造类型");
      }
      if (
        textLooksSimilar(params.snapshot.projectName, record.projectTitle) ||
        textLooksSimilar(params.snapshot.issueDescription, record.snapshot.issueDescription)
      ) {
        similarityScore += 1;
        reasons.push("项目名称/问题描述近似");
      }

      return {
        projectId: record.projectId,
        projectTitle: record.projectTitle,
        versionId: record.versionId,
        versionNumber: record.versionNumber,
        status: record.status,
        createdAt: record.createdAt,
        locationSummary: summarizeLocation(record.snapshot.location),
        matchReason: reasons.join("、"),
        similarityScore
      };
    })
    .filter((record) => record.similarityScore >= 6)
    .sort((left, right) => right.similarityScore - left.similarityScore)
    .slice(0, 5);
}

export function isProjectTerminal(status: ProjectStatus): boolean {
  return status === "human_approved";
}

export function calculateSubmissionEligibility(params: {
  policy?: QuotaPolicy;
  ledger: QuotaUsageLedger[];
  overrides: OverrideGrant[];
  versions: ProjectVersion[];
  organizationId: string;
  now?: Date;
  currentStatus: ProjectStatus;
}): SubmissionEligibility {
  const policy = params.policy ?? DEFAULT_QUOTA_POLICY;
  const now = params.now ?? new Date();
  const { start, end } = getWeekWindow(now);

  const weeklyUsage = params.ledger.filter((item) => {
    const consumedAt = new Date(item.consumedAt);
    return item.organizationId === params.organizationId && consumedAt >= start && consumedAt <= end;
  }).length;

  const remainingWeeklyQuota = Math.max(policy.weeklyQuotaPerCity - weeklyUsage, 0);
  const availableOverride = params.overrides.find((item) => !item.used);

  if (
    ["submitted", "ai_reviewing", "ai_recommended_pass", "ai_conditionally_passed"].includes(
      params.currentStatus
    )
  ) {
    return {
      allowed: false,
      remainingWeeklyQuota,
      weeklyQuota: policy.weeklyQuotaPerCity,
      reason: "already_submitted",
      overrideAvailable: false
    };
  }

  if (isProjectTerminal(params.currentStatus)) {
    return {
      allowed: false,
      remainingWeeklyQuota,
      weeklyQuota: policy.weeklyQuotaPerCity,
      reason: "project_locked",
      overrideAvailable: false
    };
  }

  const latestReturnedVersion = [...params.versions]
    .filter((item) => item.status === "ai_returned" || item.status === "human_returned")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

  if (latestReturnedVersion?.returnedAt) {
    const blockedUntil = new Date(latestReturnedVersion.returnedAt);
    blockedUntil.setUTCDate(blockedUntil.getUTCDate() + policy.resubmitCooldownDays);
    if (now < blockedUntil) {
      const overrideAvailable =
        policy.allowOverride &&
        (availableOverride?.scope === "cooldown" || availableOverride?.scope === "both");

      return {
        allowed: overrideAvailable,
        remainingWeeklyQuota,
        weeklyQuota: policy.weeklyQuotaPerCity,
        reason: overrideAvailable ? undefined : "cooldown_active",
        blockedUntil: blockedUntil.toISOString(),
        overrideAvailable,
        availableOverrideId: overrideAvailable ? availableOverride?.id : undefined
      };
    }
  }

  if (remainingWeeklyQuota <= 0) {
    const overrideAvailable =
      policy.allowOverride &&
      (availableOverride?.scope === "weekly_quota" || availableOverride?.scope === "both");

    return {
      allowed: overrideAvailable,
      remainingWeeklyQuota,
      weeklyQuota: policy.weeklyQuotaPerCity,
      reason: overrideAvailable ? undefined : "weekly_quota_reached",
      overrideAvailable,
      availableOverrideId: overrideAvailable ? availableOverride?.id : undefined
    };
  }

  return {
    allowed: true,
    remainingWeeklyQuota,
    weeklyQuota: policy.weeklyQuotaPerCity,
    overrideAvailable: false
  };
}

export function getWeekWindow(now: Date): { start: Date; end: Date } {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaNow = new Date(now.getTime() + chinaOffsetMs);
  const day = chinaNow.getUTCDay() || 7;

  const chinaWeekStart = new Date(
    Date.UTC(
      chinaNow.getUTCFullYear(),
      chinaNow.getUTCMonth(),
      chinaNow.getUTCDate() - day + 1,
      0,
      0,
      0,
      0
    )
  );
  const chinaWeekEnd = new Date(chinaWeekStart);
  chinaWeekEnd.setUTCDate(chinaWeekStart.getUTCDate() + 6);
  chinaWeekEnd.setUTCHours(23, 59, 59, 999);

  return {
    start: new Date(chinaWeekStart.getTime() - chinaOffsetMs),
    end: new Date(chinaWeekEnd.getTime() - chinaOffsetMs)
  };
}

export function formatChinaDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}
