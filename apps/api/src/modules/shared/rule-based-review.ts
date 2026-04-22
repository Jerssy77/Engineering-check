import {
  AIReviewResult,
  AdvisoryRecommendation,
  ATTACHMENT_SLOT_LABELS,
  Attachment,
  AttachmentParseResult,
  CostEstimateRange,
  CostMatrixRow,
  DuplicateRemodelingMatch,
  FormSnapshot,
  InternalControlRequirement,
  MandatoryRequirement,
  NormCitation,
  PROJECT_CATEGORY_LABELS,
  RiskFlagKey,
  ReviewFinding,
  ReviewSection,
  SchemeWritebackCandidate,
  buildVersionAttachmentSlots,
  calculateBudgetSummary,
  calculateCostLineTotal,
  createStableId
} from "@property-review/shared";
import {
  ENGINEERING_REVIEW_SKILL_PACK_VERSION,
  EngineeringScenarioCard,
  RISK_FLAG_LABELS,
  getActiveRiskFlags,
  selectEngineeringScenarioCards
} from "./engineering-review-skill-pack";
import { selectNationalNormCitations } from "./national-norm-pack";

export interface ReviewGenerationParams {
  projectId: string;
  versionId: string;
  snapshot: FormSnapshot;
  attachments: Attachment[];
  parseResults: AttachmentParseResult[];
  duplicateMatches: DuplicateRemodelingMatch[];
}

function pushFinding(target: ReviewFinding[], finding: ReviewFinding | null): void {
  if (finding) {
    target.push(finding);
  }
}

function hasText(value?: string): boolean {
  return Boolean(value && value.trim().length > 0);
}

function toAdvisoryRecommendation(
  finding: ReviewFinding,
  module: "compliance" | "cost" | "technical",
  kind: AdvisoryRecommendation["kind"]
): AdvisoryRecommendation {
  return {
    id: createStableId("adv", [module, finding.title, finding.action]),
    title: finding.title,
    recommendation: finding.action,
    reason: `${finding.basis}${finding.currentState ? `；当前情况：${finding.currentState}` : ""}`,
    requiredMaterials: finding.requiredMaterials,
    kind,
    priority: finding.severity,
    moduleHints: [module]
  };
}

function summarizeSection(
  title: string,
  findings: ReviewFinding[],
  module: "compliance" | "cost" | "technical",
  goodText: string,
  riskyText: string,
  extras?: Partial<ReviewSection>
): ReviewSection {
  const hasHigh = findings.some((item) => item.severity === "high");
  const hasAny = findings.length > 0;
  const conclusion = hasHigh ? riskyText : hasAny ? `基本可行，但${riskyText}` : goodText;

  return {
    title,
    summary: conclusion,
    conclusion,
    findings,
    mandatoryItems: [],
    advisoryItems: findings.map((item) =>
      toAdvisoryRecommendation(
        item,
        module,
        module === "cost" ? "optimization" : module === "technical" ? "alternative_path" : "general"
      )
    ),
    schemeCandidates: [],
    ...extras
  };
}

function joinText(values: Array<string | undefined>): string {
  return values.filter((item) => item && item.trim()).join(" ");
}

function inferComplianceTopics(snapshot: FormSnapshot): string[] {
  const text = joinText([
    PROJECT_CATEGORY_LABELS[snapshot.projectCategory],
    snapshot.issueDescription,
    snapshot.currentCondition,
    snapshot.keyProcess,
    snapshot.materialSelection,
    snapshot.preliminaryPlan,
    snapshot.location.impactScope
  ]).toLowerCase();

  const topics: Array<[string, string[]]> = [
    ["消防", ["消防", "喷淋", "报警", "联动", "消火栓"]],
    ["结构与加固", ["结构", "裂缝", "加固", "荷载", "基层"]],
    ["安全用电", ["电", "配电", "控制柜", "机电", "联调"]],
    ["高处与吊装作业", ["高处", "吊装", "吊顶", "脚手"]],
    ["动火作业", ["焊接", "切割", "动火"]],
    ["防水与渗漏", ["渗漏", "防水", "给排水", "漏水", "闭水"]],
    ["噪声扬尘与围挡", ["扬尘", "噪声", "围挡", "拆除", "夜间"]],
    ["给排水压力测试", ["试压", "通水", "排水", "管线"]]
  ];

  return topics
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword.toLowerCase())))
    .map(([label]) => label);
}

function toInternalControlRequirement(params: {
  severity: ReviewFinding["severity"];
  title: string;
  requirement: string;
  reason: string;
  action: string;
  requiredMaterials?: string[];
  source?: InternalControlRequirement["source"];
  ruleId?: string;
  writebackText?: string;
}): InternalControlRequirement {
  return {
    id: createStableId("icr", [params.ruleId, params.title, params.requirement]),
    severity: params.severity,
    title: params.title,
    requirement: params.requirement,
    reason: params.reason,
    action: params.action,
    requiredMaterials: params.requiredMaterials ?? [],
    source: params.source ?? "platform_policy",
    ruleId: params.ruleId,
    writebackText: params.writebackText
  };
}

function citationToMandatoryRequirement(
  citation: NormCitation,
  cards: EngineeringScenarioCard[]
): MandatoryRequirement {
  const relatedMaterials = Array.from(new Set(cards.flatMap((card) => card.requiredMaterials))).slice(0, 4);
  return {
    severity: citation.applicableModules.includes("compliance") ? "high" : "medium",
    title: `${citation.title}${citation.clause ? ` ${citation.clause}` : ""}`,
    requirement: citation.summary,
    reason: `当前项目命中内置国家规范片段 ${citation.code}《${citation.title}》${citation.clause}。`,
    citationIds: [citation.id],
    writebackText: `${citation.summary}实施和验收资料中应体现该要求，并保留可追溯记录。`,
    requiredMaterials: relatedMaterials
  };
}

function mandatoryToWriteback(item: MandatoryRequirement): SchemeWritebackCandidate {
  return {
    id: createStableId("swb", ["mandatory", item.title, item.writebackText]),
    title: item.title,
    targetSection: "强制规范要求",
    text: item.writebackText,
    basis: item.reason,
    citationIds: item.citationIds,
    autoApplied: true,
    sourceModule: "compliance"
  };
}

function cardToAdvisory(card: EngineeringScenarioCard, module: "compliance" | "cost" | "technical"): AdvisoryRecommendation {
  const checks =
    module === "cost"
      ? card.costOptimizationChecks
      : module === "technical"
        ? card.technicalChecks
        : card.complianceChecks;
  const kind: AdvisoryRecommendation["kind"] =
    module === "cost" ? "optimization" : module === "technical" ? "alternative_path" : "general";

  return {
    id: createStableId("adv", [card.id, module, checks.join("|")]),
    title: `${card.scene}${module === "cost" ? "成本优化" : module === "technical" ? "技术闭环" : "合规控制"}`,
    recommendation: checks.join("；"),
    reason: `命中场景规则卡「${card.scene}」。`,
    requiredMaterials: card.requiredMaterials,
    kind,
    priority: module === "compliance" ? "high" : "medium",
    moduleHints: [module]
  };
}

function cardToWritebackCandidates(card: EngineeringScenarioCard): SchemeWritebackCandidate[] {
  return card.writebackTemplates.map((template, index) => ({
    id: createStableId("swb", [card.id, index, template]),
    title: `${card.scene}优化建议`,
    targetSection: "AI优化建议",
    text: template,
    basis: `来自场景规则卡「${card.scene}」，需人工确认后写入。`,
    citationIds: [],
    autoApplied: false,
    sourceModule: "technical"
  }));
}

function riskFlagHasSupport(snapshot: FormSnapshot, flag: RiskFlagKey): boolean {
  const supportingText = joinText([
    snapshot.temporaryMeasures,
    snapshot.preliminaryPlan,
    snapshot.acceptancePlan,
    snapshot.hiddenWorksRequirement,
    snapshot.thirdPartyTestingRequirement,
    snapshot.supplementaryNotes
  ]);

  if (flag === "concealedWork") {
    return hasText(snapshot.hiddenWorksRequirement);
  }
  if (flag === "thirdPartyTesting") {
    return hasText(snapshot.thirdPartyTestingRequirement);
  }
  if (flag === "fireSystemImpact") {
    return hasText(snapshot.acceptancePlan) && hasText(snapshot.thirdPartyTestingRequirement);
  }
  if (flag === "powerOrWaterShutdown") {
    return hasText(snapshot.preliminaryPlan) || hasText(snapshot.temporaryMeasures);
  }

  return hasText(supportingText);
}

function buildRiskFlagInternalControls(snapshot: FormSnapshot): InternalControlRequirement[] {
  return getActiveRiskFlags(snapshot)
    .filter((flag) => !riskFlagHasSupport(snapshot, flag))
    .map((flag) =>
      toInternalControlRequirement({
        severity: ["fireSystemImpact", "hotWork", "workingAtHeight"].includes(flag) ? "high" : "medium",
        title: `${RISK_FLAG_LABELS[flag]}说明不足`,
        requirement: `已勾选“${RISK_FLAG_LABELS[flag]}”，但未形成对应的施工组织、安全隔离、恢复验证或专项检测说明。`,
        reason: "平台审批要求要求专项风险必须有对应控制措施，不能仅靠勾选表达。",
        action: "补充专项风险控制、审批手续、现场监护、恢复验证和资料留档要求。",
        requiredMaterials: ["补充材料"],
        ruleId: `risk-${flag}`,
        writebackText: `针对${RISK_FLAG_LABELS[flag]}，施工前应完成专项交底、审批确认、现场防护和恢复验证，并保留过程记录。`
      })
    );
}

function buildCostEstimateRanges(
  rows: FormSnapshot["costMatrixRows"],
  budgetTotal: number,
  relatedRuleIds: string[]
): CostEstimateRange[] {
  return rows
    .map((row) => ({ row, amount: calculateCostLineTotal(row) }))
    .filter(({ row, amount }) => row.unitPrice >= 100000 || amount >= Math.max(budgetTotal * 0.45, 1))
    .slice(0, 5)
    .map(({ row, amount }) => ({
      id: createStableId("cost_range", [row.id, row.itemName, amount]),
      itemName: row.itemName || "未命名费用项",
      basis: "基于工程经验，高单价或高占比费用项需复核规格、范围、检测/措施费和是否存在重复投入。",
      currentAmount: amount,
      suggestedMin: Math.round(amount * 0.82),
      suggestedMax: Math.round(amount * 0.95),
      optimizationSpace: "疑似存在 5%-18% 的复核或压降空间，需由审核人与造价人员结合现场边界确认。",
      requiresManualReview: true,
      relatedRuleIds
    }));
}

function buildUploadedCostRows(snapshot: FormSnapshot): CostMatrixRow[] {
  if (snapshot.costInputMode !== "upload" || snapshot.uploadedCostSheet?.status !== "completed") return [];
  return snapshot.uploadedCostSheet.rows
    .filter((row) => row.rowType === "detail" && typeof row.lineTotal === "number")
    .map((row) => ({
      id: row.id,
      type: "engineering",
      itemName: row.itemName,
      specification: row.specification ?? row.sectionName ?? "",
      unit: row.unit ?? "项",
      quantity: row.quantity && row.quantity > 0 ? row.quantity : 1,
      unitPrice:
        row.unitPrice && row.unitPrice > 0
          ? row.unitPrice
          : row.lineTotal && row.lineTotal > 0
            ? row.lineTotal
            : 0,
      remark: row.remark ?? `来自上传清单：${row.sheetName} 第 ${row.rowNumber} 行`
    }));
}

export function buildRuleBasedReview(params: ReviewGenerationParams): Omit<AIReviewResult, "id"> {
  const {
    snapshot,
    attachments = [],
    parseResults = [],
    duplicateMatches = []
  } = params;
  const attachmentSlots = buildVersionAttachmentSlots({
    category: snapshot.projectCategory,
    sourceType: snapshot.issueSourceType,
    attachments
  });
  const missingMaterials = attachmentSlots.filter((slot) => slot.status === "missing").map((slot) => slot.label);
  const budgetSummary = calculateBudgetSummary({
    costMatrixRows: snapshot.costMatrixRows,
    declaredBudget: snapshot.budgetAmount,
    costInputMode: snapshot.costInputMode,
    uploadedCostSheet: snapshot.uploadedCostSheet
  });
  const costRowsForHeuristics = snapshot.costInputMode === "upload" ? buildUploadedCostRows(snapshot) : snapshot.costMatrixRows;
  const scenarioCards = selectEngineeringScenarioCards({
    snapshot,
    parseResults,
    limit: 10
  });
  const citations = selectNationalNormCitations({
    snapshot,
    parseResults,
    limit: 8
  });

  const complianceFindings: ReviewFinding[] = [];
  const costFindings: ReviewFinding[] = [];
  const technicalFindings: ReviewFinding[] = [];
  const internalControlRequirements: InternalControlRequirement[] = [
    ...buildRiskFlagInternalControls(snapshot)
  ];

  if (missingMaterials.length) {
    internalControlRequirements.push(
      toInternalControlRequirement({
        severity: missingMaterials.length >= 2 ? "high" : "medium",
        title: "关键附件未补齐",
        requirement: `当前缺少固定材料：${missingMaterials.join("、")}。`,
        reason: "平台审批要求 AI 预审前应具备问题照片、点位台账等基础材料，否则无法判断边界、重复改造和预算合理性。",
        action: "补齐固定附件后重新送审，或在补充材料中说明确实无法提供的原因。",
        requiredMaterials: missingMaterials,
        ruleId: "platform-required-attachments",
        writebackText: "开工前应补齐审批要求的固定附件，并将问题照片、点位台账、图纸或补充说明纳入交付资料。"
      })
    );
  }

  const complianceTopics = inferComplianceTopics(snapshot);
  if (!complianceTopics.length) {
    pushFinding(complianceFindings, {
      severity: "medium",
      title: "合规边界说明不足",
      basis: "工程改造需结合施工场景判断消防、结构、用电、动火、防水等规范边界。",
      currentState: "当前方案未明确涉及哪些重点合规事项，规则引擎只能基于有限信息初步判断。",
      action: "补充施工边界、停复机安排、安全隔离措施以及是否涉及许可审批；未涉及的事项也应明确说明。",
      requiredMaterials: ["图纸", "补充材料"]
    });
  } else {
    pushFinding(complianceFindings, {
      severity: complianceTopics.length >= 3 ? "high" : "medium",
      title: "存在需重点核查的合规事项",
      basis: "基于工程改造常识和国家技术规范，相关作业前需明确作业条件与控制措施。",
      currentState: `当前方案涉及或疑似涉及：${complianceTopics.join("、")}。`,
      action: "逐项说明是否需要审批、隔离、防护、监测、恢复验证和第三方确认，未提供内容需补充。",
      requiredMaterials: missingMaterials.length ? missingMaterials : ["图纸", "补充材料"]
    });
  }

  scenarioCards.slice(0, 4).forEach((card) => {
    pushFinding(complianceFindings, {
      severity: card.riskFlags?.some((flag) => snapshot.riskFlags?.[flag]) ? "high" : "medium",
      title: `命中工程场景：${card.scene}`,
      basis: `来自内置 AI 审核技能包场景规则卡 ${card.id}。`,
      currentState: `该项目与「${card.scene}」场景相似，需按场景卡完成材料、合规、成本和技术闭环复核。`,
      action: card.complianceChecks.join("；"),
      requiredMaterials: card.requiredMaterials
    });
  });

  if (snapshot.costInputMode !== "upload" && !snapshot.costMatrixRows.length) {
    pushFinding(costFindings, {
      severity: "high",
      title: "未提供费用测算矩阵",
      basis: "成本审核需要基于完整清单、数量、单价与测算依据进行。",
      currentState: "当前仅有总预算，缺少矩阵化成本明细。",
      action: "按统一矩阵补充费用项、清单项、数量、单价、规格及测算依据后再提交。",
      requiredMaterials: ["故障点位台账", "补充材料"]
    });
    internalControlRequirements.push(
      toInternalControlRequirement({
        severity: "high",
        title: "费用测算矩阵缺失",
        requirement: "当前版本未提供工程量与费用测算矩阵。",
        reason: "平台审批要求预算必须可拆解到清单、数量、单价和测算依据。",
        action: "补充费用项、工程量、单价、规格和测算依据后再提交。",
        requiredMaterials: ["故障点位台账", "补充材料"],
        ruleId: "platform-cost-matrix-required"
      })
    );
  }

  if (budgetSummary.budgetGap !== 0) {
    pushFinding(costFindings, {
      severity: "high",
      title: "申报总预算与清单汇总不一致",
      basis: "总预算应与当前启用的工程量清单口径保持一致。",
      currentState: `申报 ${budgetSummary.declaredBudget} 元，清单汇总 ${budgetSummary.calculatedBudget} 元。`,
      action: "复核数量、单价、税费和其他费用行，确保申报预算与清单合价完全一致。",
      requiredMaterials: ["故障点位台账"]
    });
    internalControlRequirements.push(
      toInternalControlRequirement({
        severity: "high",
        title: "申报预算与清单测算不一致",
        requirement: `申报 ${budgetSummary.declaredBudget} 元，矩阵汇总 ${budgetSummary.calculatedBudget} 元，差额 ${budgetSummary.budgetGap} 元。`,
        reason: "平台审批要求预算口径必须与工程量清单一致，差额未解释时不得进入人工通过。",
        action: "调整申报预算或修正清单金额，并在预算依据中说明差异来源。",
        requiredMaterials: ["故障点位台账"],
        ruleId: "platform-budget-gap-blocker"
      })
    );
  }

  const abnormalRows = costRowsForHeuristics.filter((item) => {
    const lineTotal = calculateCostLineTotal(item);
    return item.unitPrice >= 100000 || lineTotal >= Math.max(budgetSummary.calculatedBudget * 0.6, 1);
  });

  if (abnormalRows.length) {
    pushFinding(costFindings, {
      severity: "medium",
      title: "存在需重点复核的高价或高占比费用项",
      basis: "成本优化应关注异常单价、工程量偏大和费用集中度过高的情况。",
      currentState: `需重点复核的费用项包括：${abnormalRows
        .slice(0, 3)
        .map((item) => item.itemName || "未命名费用项")
        .join("、")}。`,
      action: "说明是否存在过度配置、重复检测、重复保障措施，或可通过替代材料、工艺优化、范围收敛降低成本。",
      requiredMaterials: ["故障点位台账", "补充材料"]
    });
  }

  if (budgetSummary.otherFeeSubtotal > budgetSummary.engineeringSubtotal * 0.3 && budgetSummary.engineeringSubtotal > 0) {
    pushFinding(costFindings, {
      severity: "medium",
      title: "其他费用占比偏高",
      basis: "措施费、检测费、管理费等需有清晰口径，避免重复计取或边界不清。",
      currentState: `其他费用合计 ${budgetSummary.otherFeeSubtotal} 元，占工程项费用比例较高。`,
      action: "逐项说明其他费用的计取依据，拆分含糊项，避免将非必要费用打包计取。",
      requiredMaterials: ["补充材料"]
    });
  }

  if (!hasText(snapshot.objective) || !hasText(snapshot.implementationScope) || !hasText(snapshot.keyProcess)) {
    pushFinding(technicalFindings, {
      severity: "high",
      title: "技术路线描述不完整",
      basis: "可实施性需明确目标、范围和关键工艺，确保方案闭环。",
      currentState: "技术方案缺少目标、实施范围或关键工艺中的关键信息。",
      action: "补齐改造目标、实施范围、关键工艺步骤和现场切换/恢复逻辑。",
      requiredMaterials: ["图纸", "补充材料"]
    });
    internalControlRequirements.push(
      toInternalControlRequirement({
        severity: "high",
        title: "技术路线未闭环",
        requirement: "改造目标、实施范围或关键工艺缺失，当前无法判断方案是否可执行。",
        reason: "平台审批要求技术方案至少形成目标、范围、工艺、验收和恢复验证闭环。",
        action: "补齐目标、范围、关键工艺、施工切换和恢复验证逻辑后再送审。",
        requiredMaterials: ["范围示意", "现状照片", "补充说明"],
        ruleId: "platform-technical-loop-required",
        writebackText: "最终方案应明确改造目标、实施范围、关键工艺、施工切换、验收方式和恢复验证，形成可执行闭环。"
      })
    );
  }

  if (!hasText(snapshot.materialSelection) || !hasText(snapshot.acceptancePlan)) {
    pushFinding(technicalFindings, {
      severity: "medium",
      title: "材料选型或验收方案不够落地",
      basis: "材料选型应匹配场景、寿命和维护要求，验收方案应具有可执行的测试标准。",
      currentState: "当前方案未清晰说明材料型号适配性，或验收方式、指标不明确。",
      action: "补充主要材料/设备型号、适用场景、寿命要求及测试验收标准。",
      requiredMaterials: ["材料或设备选型说明"]
    });
  }

  if ((snapshot.riskFlags?.concealedWork || hasText(snapshot.hiddenWorksRequirement)) && !hasText(snapshot.hiddenWorksRequirement)) {
    pushFinding(technicalFindings, {
      severity: "medium",
      title: "隐蔽工程留档与验收控制说明不足",
      basis: "立项阶段不要求提供详细施工图或节点大样，但涉及隐蔽工程时应说明过程留档、隐蔽验收和责任边界。",
      currentState: "当前已标记或描述涉及隐蔽工程，但缺少过程留档和隐蔽验收控制说明。",
      action: "补充隐蔽部位范围、过程照片留档、隐蔽验收节点和完工移交资料要求；详细节点做法可在招采或施工深化阶段补充。",
      requiredMaterials: ["现状照片", "范围示意", "补充说明"]
    });
  }

  if (!hasText(snapshot.detailDrawingRequirement) && (snapshot.riskFlags?.concealedWork || snapshot.projectCategory === "civil_upgrade")) {
    pushFinding(technicalFindings, {
      severity: "low",
      title: "后续深化资料安排可进一步说明",
      basis: "立项审批阶段重点判断必要性、范围、预算和风险边界，不应把招标深度施工图或详细节点大样作为硬性前置条件。",
      currentState: "当前未说明后续由设计、施工或供应商深化关键节点做法的安排。",
      action: "可补充一句：通过立项后，由中标单位或专业单位在施工前完善关键节点做法、样板确认和验收留档要求。",
      requiredMaterials: []
    });
  }

  if (!hasText(snapshot.maintenancePlan)) {
    pushFinding(technicalFindings, {
      severity: "low",
      title: "后期运维安排未提供",
      basis: "改造完成后的质保、维护和观察期安排会影响方案完整性。",
      currentState: "暂未提供交付后的维保主体、观察期或巡检要求。",
      action: "补充质保期限、维保责任和后续巡检要点。",
      requiredMaterials: []
    });
  }

  const parseSummaries = parseResults.map(
    (item) => item.summary ?? item.failureReason ?? "附件已上传，但暂未形成可读取摘要。"
  );
  if (!parseSummaries.length) {
    parseSummaries.push("未提供可读取材料，规则引擎仅能基于表单内容进行初步判断。");
  }

  const duplicateConclusion = duplicateMatches.length
    ? `当前命中 ${duplicateMatches.length} 条疑似重复改造记录，需说明是否属于重复立项或同位置重复投入。`
    : "未命中疑似重复改造。";

  const mandatoryRequirements = citations.map((citation) => citationToMandatoryRequirement(citation, scenarioCards));
  const schemeWritebacks = mandatoryRequirements.map((item) => mandatoryToWriteback(item));
  const scenarioAdvisories = scenarioCards.flatMap((card) => [
    cardToAdvisory(card, "compliance"),
    cardToAdvisory(card, "cost"),
    cardToAdvisory(card, "technical")
  ]);
  const advisoryWritebackCandidates = scenarioCards.flatMap((card) => cardToWritebackCandidates(card));
  const costEstimateRanges = buildCostEstimateRanges(
    costRowsForHeuristics,
    budgetSummary.calculatedBudget,
    scenarioCards.map((card) => card.id)
  );

  const allFindings = [...complianceFindings, ...costFindings, ...technicalFindings];
  const highInternalCount = internalControlRequirements.filter((item) => item.severity === "high").length;
  const highCount = allFindings.filter((item) => item.severity === "high").length + highInternalCount;
  const mediumCount = allFindings.filter((item) => item.severity === "medium").length;
  const overallScore = Math.max(
    25,
    92 - highCount * 12 - mediumCount * 5 - missingMaterials.length * 3 - costEstimateRanges.length * 3
  );

  const verdict =
    highInternalCount > 0 || highCount >= 3 || budgetSummary.budgetGap !== 0 || missingMaterials.length >= 2
      ? "fail"
      : highCount > 0 || mediumCount >= 3 || duplicateMatches.length > 0
        ? "conditional_pass"
        : "pass";

  const dedupedRequiredActions = [
    ...new Set([
      ...internalControlRequirements.map((item) => item.action),
      ...allFindings.map((item) => item.action)
    ])
  ];
  const dedupedMissingMaterials = [
    ...new Set([
      ...missingMaterials,
      ...internalControlRequirements.flatMap((item) => item.requiredMaterials),
      ...allFindings.flatMap((item) => item.requiredMaterials),
      ...attachmentSlots
        .filter((slot) => slot.status !== "provided" && slot.required)
        .map((slot) => ATTACHMENT_SLOT_LABELS[slot.key])
    ])
  ];

  const verdictText =
    verdict === "pass"
      ? `结论：通过。${PROJECT_CATEGORY_LABELS[snapshot.projectCategory]}方向基本合理，现有资料足以进入人工终审。`
      : verdict === "conditional_pass"
        ? `结论：有条件通过。${PROJECT_CATEGORY_LABELS[snapshot.projectCategory]}方向基本可行，但仍需按下列问题补充资料并修订关键内容。`
        : `结论：不通过。${PROJECT_CATEGORY_LABELS[snapshot.projectCategory]}方案在合规、成本或技术闭环上仍存在明显缺口。`;

  return {
    projectId: params.projectId,
    versionId: params.versionId,
    verdict,
    overallScore,
    conclusion: verdictText,
    attachmentReadSummary: parseSummaries,
    missingMaterials: dedupedMissingMaterials.length ? dedupedMissingMaterials : ["未提供/需补充"],
    requiredActions: dedupedRequiredActions.length ? dedupedRequiredActions : ["未提供/需补充"],
    citations,
    mandatoryRequirements,
    internalControlRequirements,
    advisoryRecommendations: [
      ...allFindings.map((item) =>
        toAdvisoryRecommendation(
          item,
          complianceFindings.includes(item) ? "compliance" : costFindings.includes(item) ? "cost" : "technical",
          costFindings.includes(item) ? "optimization" : technicalFindings.includes(item) ? "alternative_path" : "general"
        )
      ),
      ...scenarioAdvisories
    ],
    advisoryWritebackCandidates,
    schemeWritebacks,
    costEstimateRanges,
    skillPackVersion: ENGINEERING_REVIEW_SKILL_PACK_VERSION,
    complianceReview: summarizeSection(
      "合规合法性审核",
      complianceFindings,
      "compliance",
      "未发现需要立即阻断的合规问题，但仍需按实施场景落实许可与安全措施。",
      "仍需补充规范依据、作业边界和安全控制说明。"
    ),
    costReview: summarizeSection(
      "成本优化与费用合理性审核",
      costFindings,
      "cost",
      "费用构成基本完整，矩阵口径与总预算基本匹配。",
      "仍需复核费用口径、异常单价及成本优化空间。",
      {
        mustKeepItems: costRowsForHeuristics.length
          ? ["与当前问题直接相关的核心修复工程量", "涉及安全恢复、联调联试和基本验收的必要投入"]
          : [],
        optimizationCandidates: [
          ...costFindings.map((item) => toAdvisoryRecommendation(item, "cost", "optimization")),
          ...scenarioCards.map((card) => cardToAdvisory(card, "cost"))
        ],
        costQuestions: [
          ...costFindings.map((item) => item.title),
          ...costEstimateRanges.map((item) => `${item.itemName}：${item.optimizationSpace}`)
        ]
      }
    ),
    technicalReview: summarizeSection(
      "技术路线与实施闭环审核",
      technicalFindings,
      "technical",
      "技术路线基本合理，方案具备落地条件。",
      "技术路线基本可行，但关键工艺、材料选型或验收闭环仍需优化。",
      {
        alternativePaths: [
          ...technicalFindings.map((item) =>
            toAdvisoryRecommendation(item, "technical", "alternative_path")
          ),
          ...scenarioCards.map((card) => cardToAdvisory(card, "technical"))
        ],
        schemeCandidates: advisoryWritebackCandidates
      }
    ),
    duplicateReview: {
      title: "重复改造识别",
      conclusion: duplicateConclusion,
      matches: duplicateMatches
    },
    modelName: "demo-structured-reviewer",
    promptVersion: "v5.0.0-rule-based",
    generatedAt: new Date().toISOString()
  };
}
