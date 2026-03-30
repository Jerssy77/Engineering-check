import {
  AIReviewResult,
  ATTACHMENT_SLOT_LABELS,
  Attachment,
  AttachmentParseResult,
  DuplicateRemodelingMatch,
  FormSnapshot,
  PROJECT_CATEGORY_LABELS,
  ReviewFinding,
  ReviewSection,
  buildVersionAttachmentSlots,
  calculateBudgetSummary,
  calculateCostLineTotal
} from "@property-review/shared";

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

function summarizeSection(
  title: string,
  findings: ReviewFinding[],
  goodText: string,
  riskyText: string
): ReviewSection {
  const hasHigh = findings.some((item) => item.severity === "high");
  const hasAny = findings.length > 0;

  return {
    title,
    conclusion: hasHigh ? riskyText : hasAny ? `基本可行，但${riskyText}` : goodText,
    findings
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
    ["消防", ["消防", "泵", "喷淋", "报警", "联动"]],
    ["结构", ["结构", "裂缝", "加固", "荷载", "基层"]],
    ["安全用电", ["电", "配电", "控制柜", "机电", "联调"]],
    ["高处作业", ["高处", "吊装", "吊顶", "脚手"]],
    ["动火", ["焊接", "切割", "动火"]],
    ["特种设备", ["机组", "泵", "压力", "吊装", "锅炉"]],
    ["占道", ["围挡", "道路", "通道", "物流"]],
    ["夜间施工", ["夜间", "停机窗口", "夜班"]],
    ["扬尘噪声", ["扬尘", "噪声", "拆除", "土建"]],
    ["燃气", ["燃气"]],
    ["防水", ["渗漏", "防水", "给排水", "漏水"]]
  ];

  return topics
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword.toLowerCase())))
    .map(([label]) => label);
}

export function buildRuleBasedReview(params: ReviewGenerationParams): Omit<AIReviewResult, "id"> {
  const { snapshot, attachments, parseResults, duplicateMatches } = params;
  const attachmentSlots = buildVersionAttachmentSlots({
    category: snapshot.projectCategory,
    sourceType: snapshot.issueSourceType,
    attachments
  });
  const missingMaterials = attachmentSlots
    .filter((slot) => slot.status === "missing")
    .map((slot) => slot.label);
  const budgetSummary = calculateBudgetSummary({
    costMatrixRows: snapshot.costMatrixRows,
    declaredBudget: snapshot.budgetAmount
  });

  const complianceFindings: ReviewFinding[] = [];
  const costFindings: ReviewFinding[] = [];
  const technicalFindings: ReviewFinding[] = [];

  const complianceTopics = inferComplianceTopics(snapshot);
  if (!complianceTopics.length) {
    pushFinding(complianceFindings, {
      severity: "medium",
      title: "合规边界说明不足",
      basis: "工程改造需结合施工场景判断消防、结构、用电、动火、防水等规范边界。",
      currentState: "方案中未清楚说明涉及哪些重点合规事项，AI 只能基于有限信息初步判断。",
      action: "补充施工边界、停复机安排、安全隔离措施及是否涉及许可审批；未涉及的事项也请明确说明。",
      requiredMaterials: ["图纸", "补充材料"]
    });
  } else {
    pushFinding(complianceFindings, {
      severity: complianceTopics.length >= 3 ? "high" : "medium",
      title: "存在需重点核查的合规事项",
      basis: "基于工程改造常识和国家/地方技术规范，相关作业前需明确作业条件与控制措施。",
      currentState: `当前方案涉及或疑似涉及：${complianceTopics.join("、")}。`,
      action: "逐项说明是否需要审批、隔离、防护、监测、恢复验证和第三方确认，未提供内容需补充。",
      requiredMaterials: missingMaterials.length ? missingMaterials : ["图纸", "补充材料"]
    });
  }

  if (!snapshot.costMatrixRows.length) {
    pushFinding(costFindings, {
      severity: "high",
      title: "未提供费用测算矩阵",
      basis: "成本审核需基于完整清单、数量、单价与测算依据进行。",
      currentState: "当前仅有总预算，缺少矩阵化成本明细。",
      action: "按统一矩阵补充费用项/清单项、数量、单价、规格及测算依据后再提交。",
      requiredMaterials: ["故障点位台账", "补充材料"]
    });
  }

  if (budgetSummary.budgetGap !== 0) {
    pushFinding(costFindings, {
      severity: "high",
      title: "申报总预算与矩阵汇总不一致",
      basis: "总预算应与成本矩阵汇总口径保持一致。",
      currentState: `申报 ${budgetSummary.declaredBudget} 元，矩阵汇总 ${budgetSummary.calculatedBudget} 元。`,
      action: "复核数量、单价和其他费用行，确保总预算与矩阵合价完全一致。",
      requiredMaterials: ["故障点位台账"]
    });
  }

  const abnormalRows = snapshot.costMatrixRows.filter((item) => {
    const lineTotal = calculateCostLineTotal(item);
    return item.unitPrice >= 100000 || lineTotal >= budgetSummary.calculatedBudget * 0.6;
  });
  if (abnormalRows.length) {
    pushFinding(costFindings, {
      severity: "medium",
      title: "存在需重点复核的高价或高占比费用项",
      basis: "成本节约与费用合理性审核需关注异常单价、工程量偏大和费用集中度过高的情况。",
      currentState: `需重点复核的费用项包括：${abnormalRows
        .slice(0, 3)
        .map((item) => item.itemName || "未命名费用项")
        .join("、")}。`,
      action: "补充对标报价或测算依据，并说明是否可通过替代材料、工艺优化、分阶段实施或招采优化降本。",
      requiredMaterials: ["故障点位台账", "补充材料"]
    });
  }

  if (budgetSummary.otherFeeSubtotal > budgetSummary.engineeringSubtotal * 0.3 && budgetSummary.engineeringSubtotal > 0) {
    pushFinding(costFindings, {
      severity: "medium",
      title: "其他费用占比偏高",
      basis: "措施费、检测费、管理费等需有清晰口径，避免重复计取或边界不清。",
      currentState: `其他费用合计 ${budgetSummary.otherFeeSubtotal} 元，占工程量费用比例较高。`,
      action: "逐项说明其他费用的计取依据，拆分含糊项，避免将低效但高价做法打包计取。",
      requiredMaterials: ["补充材料"]
    });
  }

  if (!hasText(snapshot.objective) || !hasText(snapshot.implementationScope) || !hasText(snapshot.keyProcess)) {
    pushFinding(technicalFindings, {
      severity: "high",
      title: "技术路线描述不完整",
      basis: "施工可实施性需要明确目标、范围和关键工艺，确保方案闭合。",
      currentState: "技术方案缺少目标、实施范围或关键工艺中的关键信息。",
      action: "补齐改造目标、实施范围、关键工艺步骤和现场切换/恢复逻辑。",
      requiredMaterials: ["图纸", "补充材料"]
    });
  }

  if (!hasText(snapshot.materialSelection) || !hasText(snapshot.acceptancePlan)) {
    pushFinding(technicalFindings, {
      severity: "medium",
      title: "材料选型或验收方案不够落地",
      basis: "材料选型应匹配场景、寿命和维护要求，验收方案应具有可执行的测试标准。",
      currentState: "当前方案尚未清楚说明材料型号适配性，或验收方式、指标不明确。",
      action: "补充主要材料/设备型号、适用场景、寿命要求及测试验收标准。",
      requiredMaterials: ["图纸"]
    });
  }

  if (!hasText(snapshot.hiddenWorksRequirement) || !hasText(snapshot.detailDrawingRequirement)) {
    pushFinding(technicalFindings, {
      severity: "medium",
      title: "隐蔽工程或节点做法说明不足",
      basis: "涉及隐蔽工程、节点详图、样板先行和第三方检测的项目，需提前明确控制点。",
      currentState: "当前未充分说明隐蔽工程留档方式或节点做法细节。",
      action: "明确哪些部位需要隐蔽验收、节点详图、样板先行或第三方检测，并写入实施方案。",
      requiredMaterials: ["图纸", "补充材料"]
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
    parseSummaries.push("未提供可读取材料，AI 只能基于表单内容进行判断。");
  }

  const duplicateConclusion = duplicateMatches.length
    ? `本应用内检出 ${duplicateMatches.length} 条疑似重复改造记录，需说明是否属于重复立项或同位置重复投入。`
    : "未命中疑似重复改造。";

  const allFindings = [...complianceFindings, ...costFindings, ...technicalFindings];
  const highCount = allFindings.filter((item) => item.severity === "high").length;
  const mediumCount = allFindings.filter((item) => item.severity === "medium").length;
  const overallScore = Math.max(35, 92 - highCount * 12 - mediumCount * 6 - missingMaterials.length * 3);

  const verdict =
    highCount >= 3 || budgetSummary.budgetGap !== 0 || missingMaterials.length >= 2
      ? "fail"
      : highCount > 0 || mediumCount >= 3 || duplicateMatches.length > 0
        ? "conditional_pass"
        : "pass";

  const dedupedRequiredActions = [...new Set(allFindings.map((item) => item.action))];
  const dedupedMissingMaterials = [
    ...new Set([
      ...missingMaterials,
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
        : `结论：不通过。${PROJECT_CATEGORY_LABELS[snapshot.projectCategory]}方案在合规、成本或技术闭合性上仍存在明显缺口。`;

  return {
    projectId: params.projectId,
    versionId: params.versionId,
    verdict,
    overallScore,
    conclusion: verdictText,
    attachmentReadSummary: parseSummaries,
    missingMaterials: dedupedMissingMaterials.length ? dedupedMissingMaterials : ["未提供/需补充"],
    requiredActions: dedupedRequiredActions.length ? dedupedRequiredActions : ["未提供/需补充"],
    complianceReview: summarizeSection(
      "合规合法性审核",
      complianceFindings,
      "未发现需要立即阻断的合规问题，但仍需按实施场景落实许可与安全措施。",
      "仍需补充规范依据、作业边界和安全控制说明。"
    ),
    costReview: summarizeSection(
      "成本节约与费用合理性分析",
      costFindings,
      "费用构成基本完整，矩阵口径与总预算基本匹配。",
      "仍需复核费用口径、异常单价及成本优化空间。"
    ),
    technicalReview: summarizeSection(
      "技术审核与专业建议",
      technicalFindings,
      "技术路线基本合理，方案具备落地条件。",
      "技术路线基本可行，但关键工艺、材料选型或验收闭合仍需优化。"
    ),
    duplicateReview: {
      title: "重复改造识别",
      conclusion: duplicateConclusion,
      matches: duplicateMatches
    },
    modelName: "demo-structured-reviewer",
    promptVersion: "v3.0.0-rule-based",
    generatedAt: new Date().toISOString()
  };
}
