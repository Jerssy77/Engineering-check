import { Injectable, NotFoundException } from "@nestjs/common";
import { AIReviewResult, Attachment, AttachmentParseResult, AuditLog, DEFAULT_QUOTA_POLICY, FormSnapshot, HumanDecision, Organization, OverrideGrant, Project, ProjectAggregate, ProjectVersion, QuotaPolicy, QuotaUsageLedger, SessionUser, User, createEmptyFormSnapshot, createId } from "@property-review/shared";

interface StoreState {
  organizations: Organization[];
  users: User[];
  projects: Project[];
  versions: ProjectVersion[];
  attachments: Attachment[];
  parseResults: AttachmentParseResult[];
  aiReviews: AIReviewResult[];
  decisions: HumanDecision[];
  overrides: OverrideGrant[];
  quotaLedger: QuotaUsageLedger[];
  auditLogs: AuditLog[];
  quotaPolicy: QuotaPolicy;
}

const CITY_COMPANIES = [
  ["binhu01", "org_city_binhu", "滨湖城市公司", "滨湖申报人"],
  ["beijing01", "org_city_beijing", "北京城市公司", "北京申报人"],
  ["beicheng01", "org_city_beicheng", "北城城市公司", "北城申报人"],
  ["changsha01", "org_city_changsha", "长沙城市公司", "长沙申报人"],
  ["guiyang01", "org_city_guiyang", "贵阳城市公司", "贵阳申报人"],
  ["fuyang01", "org_city_fuyang", "阜阳城市公司", "阜阳申报人"],
  ["ningbo01", "org_city_ningbo", "宁波城市公司", "宁波申报人"],
  ["kunming01", "org_city_kunming", "昆明城市公司", "昆明申报人"],
  ["tengchong01", "org_city_tengchong", "腾冲城市公司", "腾冲申报人"],
  ["banna01", "org_city_banna", "版纳城市公司", "版纳申报人"],
  ["luoyuan01", "org_city_luoyuan", "罗源城市公司", "罗源申报人"],
  ["minjiang01", "org_city_minjiang", "闽江城市公司", "闽江申报人"],
  ["lianjiang01", "org_city_lianjiang", "连江城市公司", "连江申报人"]
] as const;

function buildSnapshot(overrides: Partial<FormSnapshot>): FormSnapshot {
  const base = createEmptyFormSnapshot();
  return { ...base, ...overrides, location: { ...base.location, ...overrides.location }, costMatrixRows: overrides.costMatrixRows ?? base.costMatrixRows };
}

function buildReview(input: Omit<AIReviewResult, "id">): AIReviewResult {
  return { id: createId("review"), ...input };
}

function createStoreState(): StoreState {
  const organizations: Organization[] = [
    ...CITY_COMPANIES.map(([_, orgId, orgName]) => ({ id: orgId, name: orgName, kind: "city_company" as const })),
    { id: "org_region_engineering", name: "区域工程中心", kind: "regional_hq" },
    { id: "org_group", name: "集团工程管理部", kind: "group_hq" }
  ];

  const users: User[] = [
    ...CITY_COMPANIES.map(([username, orgId, _, displayName]) => ({ id: `user_submitter_${username}`, username, password: "jinyuan888", displayName, role: "submitter" as const, organizationId: orgId })),
    { id: "user_reviewer_gongcheng01", username: "gongcheng01", password: "jinyuan888", displayName: "区域终审人", role: "reviewer", organizationId: "org_region_engineering" },
    { id: "user_admin", username: "admin", password: "demo123", displayName: "系统管理员", role: "admin", organizationId: "org_group" }
  ];

  const currentV1 = buildSnapshot({
    projectName: "滨湖中心 A 座冷机组更新",
    projectCategory: "mep_upgrade",
    priority: "high",
    budgetAmount: 698000,
    expectedStartDate: "2026-04-08",
    expectedEndDate: "2026-05-28",
    location: { propertyName: "滨湖中心", building: "A座", floor: "B1", area: "冷机房", room: "设备间1", equipmentPoint: "1#冷机组", impactScope: "A座 1-12 层供冷区域" },
    issueSourceType: "inspection",
    issueSourceDescription: "工程巡检发现冷机组振动异常。",
    issueDescription: "机组振动偏大，夏季高峰前需要完成更新。",
    currentCondition: "设备已运行 12 年，能效下降且故障率持续上升。",
    temporaryMeasures: "目前采取降载运行并加强巡检。",
    urgencyLevel: "high",
    objective: "替换 1# 冷机组并确保夏季供冷稳定。",
    implementationScope: "冷机组更换、电控改造以及局部管线修复。",
    feasibilitySummary: "现场运输路径、吊装条件和临时供冷方案已初步确认。",
    keyProcess: "临时供冷接入、旧机拆除、新机就位、联调试运行。",
    materialSelection: "选用高效变频冷机组并兼容现有 BMS 系统。",
    maintenancePlan: "由供应商提供 2 年质保并纳入季度保养计划。",
    acceptancePlan: "完成到货验收、联动调试和 72 小时带载试运行。",
    hiddenWorksRequirement: "局部管线和线缆调整需全程拍照留档。",
    sampleFirstRequirement: "减振节点先做样板后再全面实施。",
    detailDrawingRequirement: "需补充基础和接线接口详图。",
    thirdPartyTestingRequirement: "完工后需开展振动与能效检测。",
    preliminaryPlan: "分为复核、采购、临时供冷、夜间切换、联动调试五个阶段。",
    initialBudgetExplanation: "预算由设备费、吊装费、电控改造费和临时保障费构成。",
    expectedBenefits: "预计能耗下降 10%-12%，并显著降低突发停机风险。",
    supplementaryNotes: "需提前 7 天通知租户并协调夜间施工窗口。",
    complaintCount: 2,
    workOrderCount: 4,
    costMatrixRows: [
      { id: "cost_v1_1", type: "engineering", itemName: "冷机组主机", specification: "650RT", unit: "台", quantity: 1, unitPrice: 468000, remark: "核心设备" },
      { id: "cost_v1_2", type: "engineering", itemName: "吊装拆装", specification: "旧机+新机", unit: "项", quantity: 1, unitPrice: 62000, remark: "含运输与吊装" },
      { id: "cost_v1_3", type: "engineering", itemName: "电控改造", specification: "B1 冷机房", unit: "项", quantity: 1, unitPrice: 86000, remark: "控制柜与联动调试" },
      { id: "cost_v1_4", type: "other_fee", itemName: "临时供冷保障", specification: "夜间切换窗口", unit: "项", quantity: 1, unitPrice: 42000, remark: "切换期间保障" },
      { id: "cost_v1_5", type: "other_fee", itemName: "不可预见费", specification: "项目测算预留", unit: "项", quantity: 1, unitPrice: 40000, remark: "测算预留" }
    ]
  });

  const currentV2 = buildSnapshot({
    ...currentV1,
    budgetAmount: 702000,
    issueDescription: `${currentV1.issueDescription} 近一周又出现 3 起高温投诉。`,
    feasibilitySummary: `${currentV1.feasibilitySummary} 已补充切换顺序、临时供冷和电气隔离安排。`,
    initialBudgetExplanation: `${currentV1.initialBudgetExplanation} 并新增减振节点和第三方检测费用。`,
    complaintCount: 5,
    costMatrixRows: [
      { id: "cost_v2_1", type: "engineering", itemName: "冷机组主机", specification: "650RT", unit: "台", quantity: 1, unitPrice: 468000, remark: "核心设备" },
      { id: "cost_v2_2", type: "engineering", itemName: "吊装拆装", specification: "旧机+新机", unit: "项", quantity: 1, unitPrice: 62000, remark: "含运输与吊装" },
      { id: "cost_v2_3", type: "engineering", itemName: "电控改造", specification: "B1 冷机房", unit: "项", quantity: 1, unitPrice: 86000, remark: "控制柜与联动调试" },
      { id: "cost_v2_4", type: "engineering", itemName: "减振节点改造", specification: "1#机组基础", unit: "项", quantity: 1, unitPrice: 36000, remark: "新增减振优化" },
      { id: "cost_v2_5", type: "other_fee", itemName: "临时供冷保障", specification: "夜间切换窗口", unit: "项", quantity: 1, unitPrice: 42000, remark: "切换期间保障" },
      { id: "cost_v2_6", type: "other_fee", itemName: "第三方检测", specification: "振动与能效复核", unit: "项", quantity: 1, unitPrice: 8000, remark: "完工检测" }
    ]
  });

  const historySnapshot = buildSnapshot({
    projectName: "滨湖中心 B1 冷机房联动优化",
    projectCategory: "mep_upgrade",
    priority: "medium",
    budgetAmount: 248000,
    expectedStartDate: "2025-12-10",
    expectedEndDate: "2026-01-08",
    location: { propertyName: "滨湖中心", building: "A座", floor: "B1", area: "冷机房", room: "设备间1", equipmentPoint: "1#冷机组", impactScope: "A座 1-12 层供冷区域" },
    issueSourceType: "repair_renewal",
    issueSourceDescription: "年度设备更新计划内项目。",
    issueDescription: "针对 1# 冷机组联动控制和减振基础进行专项优化。",
    currentCondition: "控制策略老旧，基础减振材料存在老化。",
    temporaryMeasures: "维保单位维持低负荷运行并每日巡查。",
    urgencyLevel: "medium",
    objective: "优化联动控制并降低机组振动。",
    implementationScope: "联动模块更新、基础减振节点整改和测试。",
    feasibilitySummary: "可在冬季停机窗口内完成，无需额外停业。",
    keyProcess: "控制模块更换、基础整改、联动复核和试运行。",
    materialSelection: "采用原厂控制模块和同等级减振材料。",
    maintenancePlan: "改造后纳入季度巡检台账。",
    acceptancePlan: "以联动测试和振动对比结果作为验收依据。",
    hiddenWorksRequirement: "节点整改过程需拍照存档。",
    sampleFirstRequirement: "先做 1 处减振节点样板。",
    detailDrawingRequirement: "需补充减振节点详图。",
    thirdPartyTestingRequirement: "必要时安排第三方振动测试。",
    preliminaryPlan: "结合冬季停机窗口一次性实施。",
    initialBudgetExplanation: "按控制模块、减振材料和联调费用测算。",
    expectedBenefits: "降低振动并提升系统稳定性。",
    supplementaryNotes: "作为后续主机更新的前置整改项目。",
    workOrderCount: 1,
    costMatrixRows: [
      { id: "cost_dup_1", type: "engineering", itemName: "控制模块更新", specification: "BMS 联动", unit: "项", quantity: 1, unitPrice: 98000, remark: "原厂模块" },
      { id: "cost_dup_2", type: "engineering", itemName: "减振垫更换", specification: "1#机组基础", unit: "项", quantity: 1, unitPrice: 112000, remark: "基础减振" },
      { id: "cost_dup_3", type: "other_fee", itemName: "联调服务", specification: "夜间联调", unit: "项", quantity: 1, unitPrice: 38000, remark: "联动调试" }
    ]
  });

  const projects: Project[] = [
    { id: "project_current", organizationId: "org_city_binhu", ownerId: "user_submitter_binhu01", currentVersionId: "version_current_v2", title: currentV2.projectName, category: currentV2.projectCategory, status: "draft", createdAt: "2026-03-21T02:00:00.000Z", updatedAt: "2026-03-27T08:00:00.000Z" },
    { id: "project_history", organizationId: "org_city_binhu", ownerId: "user_submitter_binhu01", currentVersionId: "version_history_v1", title: historySnapshot.projectName, category: historySnapshot.projectCategory, status: "human_approved", createdAt: "2025-12-02T02:00:00.000Z", updatedAt: "2026-01-09T03:00:00.000Z" }
  ];

  const versions: ProjectVersion[] = [
    { id: "version_current_v1", projectId: "project_current", versionNumber: 1, status: "ai_returned", snapshot: currentV1, submittedAt: "2026-03-23T02:00:00.000Z", aiReviewedAt: "2026-03-23T02:10:00.000Z", returnedAt: "2026-03-23T02:10:00.000Z", createdBy: "user_submitter_binhu01", createdAt: "2026-03-21T02:00:00.000Z" },
    { id: "version_current_v2", projectId: "project_current", versionNumber: 2, status: "draft", snapshot: currentV2, createdBy: "user_submitter_binhu01", createdAt: "2026-03-27T08:00:00.000Z" },
    { id: "version_history_v1", projectId: "project_history", versionNumber: 1, status: "human_approved", snapshot: historySnapshot, submittedAt: "2025-12-15T02:00:00.000Z", aiReviewedAt: "2025-12-15T02:07:00.000Z", createdBy: "user_submitter_binhu01", createdAt: "2025-12-02T02:00:00.000Z" }
  ];

  const attachments: Attachment[] = [
    { id: "att_current_photo", projectId: "project_current", versionId: "version_current_v2", slotKey: "issue_photos", fileName: "问题照片-01.jpg", mimeType: "image/jpeg", size: 260000, storageKey: "demo/binhu/current-photo-01.jpg", kind: "image", uploadedAt: "2026-03-27T08:10:00.000Z" },
    { id: "att_current_registry", projectId: "project_current", versionId: "version_current_v2", slotKey: "fault_registry", fileName: "故障点位台账.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 180000, storageKey: "demo/binhu/current-registry.xlsx", kind: "spreadsheet", uploadedAt: "2026-03-27T08:12:00.000Z" },
    { id: "att_current_drawings", projectId: "project_current", versionId: "version_current_v2", slotKey: "drawings", fileName: "切换图纸.pdf", mimeType: "application/pdf", size: 380000, storageKey: "demo/binhu/current-drawings.pdf", kind: "pdf", uploadedAt: "2026-03-27T08:13:00.000Z" }
  ];

  const parseResults: AttachmentParseResult[] = [
    { id: "parse_current_photo", attachmentId: "att_current_photo", status: "completed", summary: "问题照片显示机房运输通道可达，但设备基础存在明显老化痕迹。" },
    { id: "parse_current_registry", attachmentId: "att_current_registry", status: "completed", summary: "台账已记录 1# 冷机组振动异常、影响范围以及临时降载措施。" },
    { id: "parse_current_drawings", attachmentId: "att_current_drawings", status: "completed", summary: "图纸说明了临时供冷切换路径和主要设备布置关系。" }
  ];

  const aiReviews: AIReviewResult[] = [
    buildReview({
      projectId: "project_current",
      versionId: "version_current_v1",
      verdict: "fail",
      overallScore: 67,
      conclusion: "不通过：当前方案对同位置历史改造说明不足，且缺少完整的节点详图和切换风险控制说明。",
      attachmentReadSummary: ["已读取问题照片和故障点位台账。"],
      missingMaterials: ["节点详图", "切换风险控制说明"],
      requiredActions: ["补充同位置历史改造差异说明。", "补充新增减振与临时供冷的报价依据。", "完善施工节点详图和夜间切换应急预案。"],
      complianceReview: { title: "合规合法性审核", conclusion: "涉及夜间施工和设备切换，需补充过程控制说明。", findings: [{ severity: "high", title: "切换风险控制说明不足", basis: "夜间施工和供冷切换存在运营影响。", currentState: "现有方案缺少详细应急安排。", action: "补充切换前检查、隔离措施和应急预案。", requiredMaterials: ["切换风险控制说明"] }] },
      costReview: { title: "成本节约与费用合理性分析", conclusion: "主机与减振费用可理解，但仍需补充测算依据。", findings: [{ severity: "medium", title: "新增费用依据不足", basis: "第三方检测和减振节点费用缺少佐证。", currentState: "成本矩阵已完整，但报价证明不全。", action: "补充供应商报价、检测费用依据和采购说明。", requiredMaterials: ["报价依据", "检测测算说明"] }] },
      technicalReview: { title: "技术审核与专业建议", conclusion: "技术路线基本可行，但关键节点未闭合。", findings: [{ severity: "medium", title: "节点详图未提供", basis: "冷机更新涉及基础和接线接口。", currentState: "结构化方案已有方向，但实施细节不足。", action: "补充基础详图、接线接口图和夜间切换步骤。", requiredMaterials: ["节点详图"] }] },
      duplicateReview: { title: "重复改造识别", conclusion: "命中 1 条同位置历史改造记录，需要说明本次改造与既有项目的差异化必要性。", matches: [{ projectId: "project_history", projectTitle: historySnapshot.projectName, versionId: "version_history_v1", versionNumber: 1, status: "human_approved", createdAt: "2025-12-02T02:00:00.000Z", locationSummary: "滨湖中心 / A座 / B1 / 冷机房 / 设备间1 / 1#冷机组", matchReason: "同一设备点位且问题描述均涉及 1# 冷机组联动与减振整改。", similarityScore: 0.91 }] },
      modelName: "demo-seed",
      promptVersion: "v2",
      generatedAt: "2026-03-23T02:10:00.000Z"
    }),
    buildReview({
      projectId: "project_history",
      versionId: "version_history_v1",
      verdict: "pass",
      overallScore: 84,
      conclusion: "通过：该历史项目为既有整改事项，可作为本次主机更新的参考基础。",
      attachmentReadSummary: ["该版本已形成历史整改记录。"],
      missingMaterials: [],
      requiredActions: ["保留历史整改验收记录。", "后续同点位立项时补充差异化说明。", "持续跟踪设备振动变化。"],
      complianceReview: { title: "合规合法性审核", conclusion: "未发现明显禁止性事项。", findings: [{ severity: "low", title: "历史整改资料可追溯", basis: "已有完整台账和审批记录。", currentState: "资料可用于后续项目对比。", action: "归档保存。", requiredMaterials: [] }] },
      costReview: { title: "成本节约与费用合理性分析", conclusion: "费用构成较清晰。", findings: [{ severity: "low", title: "预算结构完整", basis: "成本矩阵口径清晰。", currentState: "可作为历史对标项目。", action: "保留作为同类项目参考。", requiredMaterials: [] }] },
      technicalReview: { title: "技术审核与专业建议", conclusion: "整改目标明确。", findings: [{ severity: "low", title: "技术路径已闭合", basis: "联动与减振整改已有验收记录。", currentState: "可复用历史结论。", action: "在新项目中说明与本项目关系。", requiredMaterials: [] }] },
      duplicateReview: { title: "重复改造识别", conclusion: "作为历史项目本身，不触发重复风险提示。", matches: [] },
      modelName: "demo-seed",
      promptVersion: "v2",
      generatedAt: "2025-12-15T02:07:00.000Z"
    })
  ];

  const decisions: HumanDecision[] = [
    { id: "decision_history", projectId: "project_history", versionId: "version_history_v1", reviewerId: "user_reviewer_gongcheng01", decision: "approved", comment: "作为同位置历史整改项目，结论同意归档。", decidedAt: "2026-01-09T03:00:00.000Z" }
  ];

  const quotaLedger: QuotaUsageLedger[] = [
    { id: "quota_current_v1", organizationId: "org_city_binhu", projectId: "project_current", versionId: "version_current_v1", consumedAt: "2026-03-23T02:00:00.000Z" }
  ];

  const auditLogs: AuditLog[] = [
    { id: "audit_current_submit_v1", actorId: "user_submitter_binhu01", projectId: "project_current", versionId: "version_current_v1", action: "submit_project", detail: "已发起 V1 AI 预审。", createdAt: "2026-03-23T02:00:00.000Z" },
    { id: "audit_current_create_v2", actorId: "user_submitter_binhu01", projectId: "project_current", versionId: "version_current_v2", action: "create_version", detail: "基于 V1 退回意见新建 V2 草稿。", createdAt: "2026-03-27T08:00:00.000Z" }
  ];

  return { organizations, users, projects, versions, attachments, parseResults, aiReviews, decisions, overrides: [], quotaLedger, auditLogs, quotaPolicy: { ...DEFAULT_QUOTA_POLICY } };
}

@Injectable()
export class DemoDataService {
  private readonly state = createStoreState();

  getQuotaPolicy(): QuotaPolicy { return this.state.quotaPolicy; }
  getOrganizations(): Organization[] { return this.state.organizations; }
  getUsers(): User[] { return this.state.users; }
  findUserByUsername(username: string): User | undefined { return this.state.users.find((item) => item.username === username); }

  getSessionUser(userId: string): SessionUser {
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) throw new NotFoundException("用户不存在");
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, organizationId: user.organizationId };
  }

  getProject(projectId: string): Project {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) throw new NotFoundException("立项不存在");
    return project;
  }

  getVersion(versionId: string): ProjectVersion {
    const version = this.state.versions.find((item) => item.id === versionId);
    if (!version) throw new NotFoundException("版本不存在");
    return version;
  }

  getAttachment(attachmentId: string): Attachment {
    const attachment = this.state.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new NotFoundException("附件不存在");
    return attachment;
  }

  getAggregate(projectId: string): ProjectAggregate {
    return {
      project: this.getProject(projectId),
      versions: this.state.versions.filter((item) => item.projectId === projectId),
      attachments: this.state.attachments.filter((item) => item.projectId === projectId),
      attachmentParseResults: this.state.parseResults.filter((item) => this.state.attachments.some((attachment) => attachment.id === item.attachmentId && attachment.projectId === projectId)),
      aiReviews: this.state.aiReviews.filter((item) => item.projectId === projectId),
      humanDecisions: this.state.decisions.filter((item) => item.projectId === projectId),
      overrides: this.state.overrides.filter((item) => item.projectId === projectId)
    };
  }

  listProjects(): Project[] { return this.state.projects; }
  listVersions(projectId?: string): ProjectVersion[] { return projectId ? this.state.versions.filter((item) => item.projectId === projectId) : this.state.versions; }
  listAttachments(projectId?: string, versionId?: string): Attachment[] { return this.state.attachments.filter((item) => (!projectId || item.projectId === projectId) && (!versionId || item.versionId === versionId)); }
  listParseResults(attachmentId?: string): AttachmentParseResult[] { return attachmentId ? this.state.parseResults.filter((item) => item.attachmentId === attachmentId) : this.state.parseResults; }
  listQuotaLedger(): QuotaUsageLedger[] { return this.state.quotaLedger; }
  listOverrides(projectId?: string): OverrideGrant[] { return projectId ? this.state.overrides.filter((item) => item.projectId === projectId) : this.state.overrides; }
  listAuditLogs(projectId?: string): AuditLog[] { return projectId ? this.state.auditLogs.filter((item) => item.projectId === projectId) : this.state.auditLogs; }

  createProject(project: Omit<Project, "id">): Project { const created: Project = { ...project, id: createId("project") }; this.state.projects.push(created); return created; }

  updateProject(projectId: string, updater: (current: Project) => Project): Project {
    const index = this.state.projects.findIndex((item) => item.id === projectId);
    if (index < 0) throw new NotFoundException("立项不存在");
    const updated = updater(this.state.projects[index]);
    this.state.projects[index] = updated;
    return updated;
  }

  createVersion(version: Omit<ProjectVersion, "id">): ProjectVersion { const created: ProjectVersion = { ...version, id: createId("version") }; this.state.versions.push(created); return created; }

  updateVersion(versionId: string, updater: (current: ProjectVersion) => ProjectVersion): ProjectVersion {
    const index = this.state.versions.findIndex((item) => item.id === versionId);
    if (index < 0) throw new NotFoundException("版本不存在");
    const updated = updater(this.state.versions[index]);
    this.state.versions[index] = updated;
    return updated;
  }

  createAttachment(attachment: Omit<Attachment, "id">): Attachment { const created: Attachment = { ...attachment, id: createId("attachment") }; this.state.attachments.push(created); return created; }

  deleteAttachment(attachmentId: string): Attachment {
    const attachment = this.getAttachment(attachmentId);
    this.state.attachments = this.state.attachments.filter((item) => item.id !== attachmentId);
    this.state.parseResults = this.state.parseResults.filter((item) => item.attachmentId !== attachmentId);
    return attachment;
  }

  createParseResult(parseResult: Omit<AttachmentParseResult, "id">): AttachmentParseResult { const created: AttachmentParseResult = { ...parseResult, id: createId("parse") }; this.state.parseResults.push(created); return created; }

  addAiReview(review: Omit<AIReviewResult, "id">): AIReviewResult {
    this.state.aiReviews = this.state.aiReviews.filter((item) => item.versionId !== review.versionId);
    const created: AIReviewResult = { ...review, id: createId("review") };
    this.state.aiReviews.push(created);
    return created;
  }

  addDecision(decision: Omit<HumanDecision, "id">): HumanDecision {
    this.state.decisions = this.state.decisions.filter((item) => item.versionId !== decision.versionId);
    const created: HumanDecision = { ...decision, id: createId("decision") };
    this.state.decisions.push(created);
    return created;
  }

  addQuotaUsage(entry: Omit<QuotaUsageLedger, "id">): QuotaUsageLedger { const created: QuotaUsageLedger = { ...entry, id: createId("quota") }; this.state.quotaLedger.push(created); return created; }
  removeQuotaUsage(projectId: string, versionId: string): void {
    this.state.quotaLedger = this.state.quotaLedger.filter(
      (item) => item.projectId !== projectId || item.versionId !== versionId
    );
  }
  removeQuotaUsageByOrganizationAndRange(organizationId: string, startIso: string, endIso: string): number {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const before = this.state.quotaLedger.length;
    this.state.quotaLedger = this.state.quotaLedger.filter((item) => {
      if (item.organizationId !== organizationId) return true;
      const consumedAt = new Date(item.consumedAt);
      return consumedAt < start || consumedAt > end;
    });
    return before - this.state.quotaLedger.length;
  }
  addOverride(overrideRecord: Omit<OverrideGrant, "id">): OverrideGrant { const created: OverrideGrant = { ...overrideRecord, id: createId("override") }; this.state.overrides.push(created); return created; }

  markOverrideUsed(overrideId: string, usedAt: string): OverrideGrant {
    const index = this.state.overrides.findIndex((item) => item.id === overrideId);
    if (index < 0) throw new NotFoundException("特批记录不存在");
    const updated = { ...this.state.overrides[index], used: true, usedAt };
    this.state.overrides[index] = updated;
    return updated;
  }

  releaseOverride(overrideId: string): OverrideGrant {
    const index = this.state.overrides.findIndex((item) => item.id === overrideId);
    if (index < 0) throw new NotFoundException("特批记录不存在");
    const updated = { ...this.state.overrides[index], used: false, usedAt: undefined };
    this.state.overrides[index] = updated;
    return updated;
  }

  addAuditLog(log: Omit<AuditLog, "id">): AuditLog { const created: AuditLog = { ...log, id: createId("audit") }; this.state.auditLogs.push(created); return created; }
}
