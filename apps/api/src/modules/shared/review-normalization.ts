import {
  AIReviewResult,
  AdvisoryRecommendation,
  CostEstimateRange,
  InternalControlRequirement,
  MandatoryRequirement,
  NormCitation,
  ReviewFinding,
  ReviewModule,
  ReviewSection,
  SchemeWritebackCandidate,
  createStableId
} from "@property-review/shared";

export type AIReviewLike = Omit<AIReviewResult, "id"> & { id?: string };

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeSeverity(value: unknown, fallback: ReviewFinding["severity"] = "medium"): ReviewFinding["severity"] {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeCitation(value: unknown): NormCitation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const code = asString(record.code);
  const title = asString(record.title);
  const clause = asString(record.clause);
  if (!id || !code || !title) {
    return null;
  }

  return {
    id,
    packId: asString(record.packId) || undefined,
    code,
    title,
    clause,
    summary: asString(record.summary),
    applicableModules: Array.isArray(record.applicableModules)
      ? record.applicableModules.filter(
          (item): item is ReviewModule =>
            item === "compliance" || item === "cost" || item === "technical" || item === "general"
        )
      : []
  };
}

function normalizeMandatoryItem(value: unknown): MandatoryRequirement | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = asString(record.title);
  if (!title) {
    return null;
  }

  return {
    severity: normalizeSeverity(record.severity),
    title,
    requirement: asString(record.requirement, title),
    reason: asString(record.reason),
    citationIds: asStringArray(record.citationIds),
    writebackText: asString(record.writebackText, asString(record.requirement, title)),
    requiredMaterials: asStringArray(record.requiredMaterials)
  };
}

function normalizeInternalControlItem(value: unknown): InternalControlRequirement | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = asString(record.title);
  const requirement = asString(record.requirement);
  const action = asString(record.action, requirement);
  if (!title || !requirement) {
    return null;
  }

  return {
    id: asString(record.id, createStableId("icr", [asString(record.ruleId), title, requirement])),
    severity: normalizeSeverity(record.severity),
    title,
    requirement,
    reason: asString(record.reason),
    action,
    requiredMaterials: asStringArray(record.requiredMaterials),
    source: record.source === "skill_pack" ? "skill_pack" : "platform_policy",
    ruleId: asString(record.ruleId) || undefined,
    writebackText: asString(record.writebackText) || undefined
  };
}

function normalizeAdvisoryItem(value: unknown): AdvisoryRecommendation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = asString(record.title);
  const recommendation = asString(record.recommendation);
  if (!title || !recommendation) {
    return null;
  }

  return {
    id: asString(record.id, createStableId("adv", [title, recommendation, asString(record.kind)])),
    title,
    recommendation,
    reason: asString(record.reason),
    requiredMaterials: asStringArray(record.requiredMaterials),
    kind:
      record.kind === "general" ||
      record.kind === "optimization" ||
      record.kind === "question" ||
      record.kind === "must_keep" ||
      record.kind === "alternative_path"
        ? record.kind
        : undefined,
    priority: normalizeSeverity(record.priority, "medium"),
    moduleHints: Array.isArray(record.moduleHints)
      ? record.moduleHints.filter(
          (item): item is ReviewModule =>
            item === "compliance" || item === "cost" || item === "technical" || item === "general"
        )
      : []
  };
}

function normalizeSchemeCandidate(value: unknown): SchemeWritebackCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = asString(record.title);
  const text = asString(record.text);
  if (!title || !text) {
    return null;
  }

  return {
    id: asString(record.id, createStableId("swb", [title, text, asString(record.targetSection)])),
    title,
    targetSection: asString(record.targetSection, "实施要求"),
    text,
    basis: asString(record.basis),
    citationIds: asStringArray(record.citationIds),
    autoApplied: Boolean(record.autoApplied),
    sourceModule:
      record.sourceModule === "compliance" ||
      record.sourceModule === "cost" ||
      record.sourceModule === "technical" ||
      record.sourceModule === "general"
        ? record.sourceModule
        : undefined
  };
}

function normalizeCostEstimateRange(value: unknown): CostEstimateRange | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const itemName = asString(record.itemName);
  const basis = asString(record.basis);
  const optimizationSpace = asString(record.optimizationSpace);
  if (!itemName || !basis || !optimizationSpace) {
    return null;
  }

  const toNumber = (input: unknown): number | undefined => {
    const numeric = typeof input === "number" ? input : Number(input);
    return Number.isFinite(numeric) ? numeric : undefined;
  };

  return {
    id: asString(record.id, createStableId("cost_range", [itemName, basis, optimizationSpace])),
    itemName,
    basis,
    currentAmount: toNumber(record.currentAmount),
    suggestedMin: toNumber(record.suggestedMin),
    suggestedMax: toNumber(record.suggestedMax),
    optimizationSpace,
    requiresManualReview: record.requiresManualReview !== false,
    relatedRuleIds: asStringArray(record.relatedRuleIds)
  };
}

function normalizeFinding(value: unknown): ReviewFinding | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = asString(record.title);
  if (!title) {
    return null;
  }

  return {
    severity: normalizeSeverity(record.severity),
    title,
    basis: asString(record.basis),
    currentState: asString(record.currentState),
    action: asString(record.action),
    requiredMaterials: asStringArray(record.requiredMaterials)
  };
}

function mandatoryToFinding(item: MandatoryRequirement, citations: NormCitation[]): ReviewFinding {
  const citationLabel = item.citationIds
    .map((citationId) => citations.find((citation) => citation.id === citationId))
    .filter((citation): citation is NormCitation => Boolean(citation))
    .map((citation) => `${citation.code} ${citation.clause}`)
    .join("；");

  return {
    severity: item.severity,
    title: item.title,
    basis: citationLabel ? `${item.reason}（依据：${citationLabel}）` : item.reason,
    currentState: item.requirement,
    action: item.writebackText,
    requiredMaterials: item.requiredMaterials
  };
}

function advisoryToFinding(item: AdvisoryRecommendation): ReviewFinding {
  return {
    severity: item.priority ?? "medium",
    title: item.title,
    basis: item.reason,
    currentState: item.reason,
    action: item.recommendation,
    requiredMaterials: item.requiredMaterials
  };
}

function findingToAdvisory(item: ReviewFinding, module: ReviewModule): AdvisoryRecommendation {
  return {
    id: createStableId("adv", [module, item.title, item.action]),
    title: item.title,
    recommendation: item.action,
    reason: `${item.basis}${item.currentState ? `；当前情况：${item.currentState}` : ""}`,
    requiredMaterials: item.requiredMaterials,
    priority: item.severity,
    kind: module === "cost" ? "optimization" : module === "technical" ? "alternative_path" : "general",
    moduleHints: [module]
  };
}

function mandatoryToWriteback(item: MandatoryRequirement, module: ReviewModule): SchemeWritebackCandidate {
  return {
    id: createStableId("swb", [module, item.title, item.writebackText]),
    title: item.title,
    targetSection:
      module === "technical"
        ? "技术方案与实施要求"
        : module === "cost"
          ? "实施边界与成本约束"
          : "强制规范要求",
    text: item.writebackText,
    basis: item.reason,
    citationIds: item.citationIds,
    autoApplied: true,
    sourceModule: module
  };
}

function normalizeSection(
  section: ReviewSection | undefined,
  module: ReviewModule,
  citations: NormCitation[],
  titleFallback: string
): ReviewSection {
  const raw = (section ?? {}) as ReviewSection;
  const mandatoryItems = dedupeBy(
    (Array.isArray(raw.mandatoryItems) ? raw.mandatoryItems : [])
      .map((item) => normalizeMandatoryItem(item))
      .filter((item): item is MandatoryRequirement => Boolean(item)),
    (item) => `${item.title}:${item.requirement}`
  );
  const advisoryItems = dedupeBy(
    (Array.isArray(raw.advisoryItems) ? raw.advisoryItems : [])
      .map((item) => normalizeAdvisoryItem(item))
      .filter((item): item is AdvisoryRecommendation => Boolean(item)),
    (item) => `${item.title}:${item.recommendation}`
  );
  const schemeCandidates = dedupeBy(
    (Array.isArray(raw.schemeCandidates) ? raw.schemeCandidates : [])
      .map((item) => normalizeSchemeCandidate(item))
      .filter((item): item is SchemeWritebackCandidate => Boolean(item)),
    (item) => `${item.title}:${item.text}`
  );
  const findings = dedupeBy(
    (Array.isArray(raw.findings) ? raw.findings : [])
      .map((item) => normalizeFinding(item))
      .filter((item): item is ReviewFinding => Boolean(item)),
    (item) => `${item.title}:${item.action}`
  );

  const derivedAdvisoryItems = advisoryItems.length
    ? advisoryItems
    : findings.map((item) => findingToAdvisory(item, module));
  const derivedFindings = findings.length
    ? findings
    : [
        ...mandatoryItems.map((item) => mandatoryToFinding(item, citations)),
        ...derivedAdvisoryItems.map((item) => advisoryToFinding(item))
      ];
  const derivedSchemeCandidates = schemeCandidates.length
    ? schemeCandidates
    : mandatoryItems.map((item) => mandatoryToWriteback(item, module));

  return {
    title: asString(raw.title, titleFallback),
    summary: asString(raw.summary, asString(raw.conclusion)),
    conclusion: asString(raw.conclusion, asString(raw.summary)),
    findings: derivedFindings,
    mandatoryItems,
    advisoryItems: derivedAdvisoryItems,
    schemeCandidates: derivedSchemeCandidates,
    mustKeepItems: asStringArray(raw.mustKeepItems),
    optimizationCandidates: dedupeBy(
      (Array.isArray(raw.optimizationCandidates) ? raw.optimizationCandidates : raw.advisoryItems ?? [])
        .map((item) => normalizeAdvisoryItem(item))
        .filter((item): item is AdvisoryRecommendation => Boolean(item)),
      (item) => `${item.title}:${item.recommendation}`
    ),
    costQuestions: asStringArray(raw.costQuestions),
    alternativePaths: dedupeBy(
      (Array.isArray(raw.alternativePaths) ? raw.alternativePaths : raw.schemeCandidates ?? [])
        .map((item) => normalizeAdvisoryItem(item))
        .filter((item): item is AdvisoryRecommendation => Boolean(item)),
      (item) => `${item.title}:${item.recommendation}`
    )
  };
}

export function normalizeAiReview<T extends AIReviewLike>(review?: T): T | undefined {
  if (!review) {
    return undefined;
  }

  const citations = dedupeBy(
    (Array.isArray(review.citations) ? review.citations : [])
      .map((item) => normalizeCitation(item))
      .filter((item): item is NormCitation => Boolean(item)),
    (item) => item.id
  );

  const complianceReview = normalizeSection(review.complianceReview, "compliance", citations, "合规合法性审核");
  const costReview = normalizeSection(review.costReview, "cost", citations, "成本优化审核");
  const technicalReview = normalizeSection(review.technicalReview, "technical", citations, "技术路线审核");

  const citationIds = new Set(citations.map((item) => item.id));
  const mandatoryRequirements = dedupeBy(
    (Array.isArray(review.mandatoryRequirements) ? review.mandatoryRequirements : [])
      .map((item) => normalizeMandatoryItem(item))
      .filter((item): item is MandatoryRequirement => Boolean(item))
      .concat(
        complianceReview.mandatoryItems ?? [],
        costReview.mandatoryItems ?? [],
        technicalReview.mandatoryItems ?? []
      )
      .filter((item) => item.citationIds.some((citationId) => citationIds.has(citationId))),
    (item) => `${item.title}:${item.requirement}`
  );

  const internalControlRequirements = dedupeBy(
    (Array.isArray(review.internalControlRequirements) ? review.internalControlRequirements : [])
      .map((item) => normalizeInternalControlItem(item))
      .filter((item): item is InternalControlRequirement => Boolean(item)),
    (item) => item.id
  );

  const advisoryRecommendations = dedupeBy(
    (Array.isArray(review.advisoryRecommendations) ? review.advisoryRecommendations : [])
      .map((item) => normalizeAdvisoryItem(item))
      .filter((item): item is AdvisoryRecommendation => Boolean(item))
      .concat(
        complianceReview.advisoryItems ?? [],
        costReview.advisoryItems ?? [],
        technicalReview.advisoryItems ?? []
      ),
    (item) => `${item.title}:${item.recommendation}`
  );

  const advisoryWritebackCandidates = dedupeBy(
    (Array.isArray(review.advisoryWritebackCandidates) ? review.advisoryWritebackCandidates : [])
      .map((item) => normalizeSchemeCandidate(item))
      .filter((item): item is SchemeWritebackCandidate => Boolean(item))
      .concat(
        ...(contextualAdvisoryWritebacks([costReview, technicalReview, complianceReview]))
      ),
    (item) => item.id
  );

  const schemeWritebacks = dedupeBy(
    (Array.isArray(review.schemeWritebacks) ? review.schemeWritebacks : [])
      .map((item) => normalizeSchemeCandidate(item))
      .filter((item): item is SchemeWritebackCandidate => Boolean(item))
      .concat(
        complianceReview.schemeCandidates ?? [],
        technicalReview.schemeCandidates ?? [],
        mandatoryRequirements.map((item) => mandatoryToWriteback(item, "compliance"))
      ),
    (item) => `${item.title}:${item.text}`
  );

  const costEstimateRanges = dedupeBy(
    (Array.isArray(review.costEstimateRanges) ? review.costEstimateRanges : [])
      .map((item) => normalizeCostEstimateRange(item))
      .filter((item): item is CostEstimateRange => Boolean(item)),
    (item) => item.id
  );

  return {
    ...review,
    attachmentReadSummary: Array.isArray(review.attachmentReadSummary) ? review.attachmentReadSummary : [],
    missingMaterials: Array.isArray(review.missingMaterials) ? review.missingMaterials : [],
    requiredActions: Array.isArray(review.requiredActions) ? review.requiredActions : [],
    citations,
    mandatoryRequirements,
    internalControlRequirements,
    advisoryRecommendations,
    advisoryWritebackCandidates,
    schemeWritebacks,
    costEstimateRanges,
    complianceReview,
    costReview,
    technicalReview,
    duplicateReview: {
      title: asString(review.duplicateReview?.title, "重复改造识别"),
      conclusion: asString(review.duplicateReview?.conclusion, "当前未形成重复改造识别结论。"),
      matches: Array.isArray(review.duplicateReview?.matches) ? review.duplicateReview.matches : []
    }
  } as T;
}

function contextualAdvisoryWritebacks(sections: ReviewSection[]): SchemeWritebackCandidate[] {
  return sections.flatMap((section) =>
    (section.schemeCandidates ?? [])
      .filter((item) => !item.autoApplied)
      .map((item) => normalizeSchemeCandidate(item))
      .filter((item): item is SchemeWritebackCandidate => Boolean(item))
  );
}
