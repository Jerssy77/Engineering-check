import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  AIReviewResult,
  AdvisoryRecommendation,
  Attachment,
  AttachmentParseResult,
  CostEstimateRange,
  DuplicateRemodelingMatch,
  FormSnapshot,
  InternalControlRequirement,
  MandatoryRequirement,
  NormCitation,
  ReviewFinding,
  ReviewModule,
  ReviewSection,
  SchemeWritebackCandidate,
  createStableId,
  summarizeLocation
} from "@property-review/shared";

import {
  ENGINEERING_REVIEW_SKILL_PACK_VERSION,
  formatSkillPackContext,
  selectEngineeringScenarioCards
} from "./engineering-review-skill-pack";
import { formatNormContext, selectNationalNormCitations } from "./national-norm-pack";
import { normalizeAiReview } from "./review-normalization";
import { buildRuleBasedReview, ReviewGenerationParams } from "./rule-based-review";

type ExternalReviewPayload = Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function clampScore(value: unknown, fallback: number): number {
  const normalized = asNumber(value, fallback);
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

const MIN_AI_REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

function normalizeSeverity(
  value: unknown,
  fallback: ReviewFinding["severity"] = "medium"
): ReviewFinding["severity"] {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

function normalizeVerdict(
  value: unknown,
  fallback: AIReviewResult["verdict"]
): AIReviewResult["verdict"] {
  return value === "pass" || value === "conditional_pass" || value === "fail" ? value : fallback;
}

function normalizeFinding(value: unknown, fallback?: ReviewFinding): ReviewFinding | null {
  if (!value || typeof value !== "object") {
    return fallback ?? null;
  }

  const record = value as Record<string, unknown>;
  return {
    severity: normalizeSeverity(record.severity, fallback?.severity ?? "medium"),
    title: asString(record.title, fallback?.title ?? "待补充问题"),
    basis: asString(record.basis, fallback?.basis ?? "待补充依据"),
    currentState: asString(record.currentState, fallback?.currentState ?? "待补充现状"),
    action: asString(record.action, fallback?.action ?? "待补充动作"),
    requiredMaterials: asStringArray(record.requiredMaterials, fallback?.requiredMaterials ?? [])
  };
}

function normalizeCitation(value: unknown): NormCitation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const code = asString(record.code);
  const title = asString(record.title);
  if (!id || !code || !title) {
    return null;
  }

  return {
    id,
    packId: asString(record.packId) || undefined,
    code,
    title,
    clause: asString(record.clause),
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
  const requirement = asString(record.requirement);
  if (!title || !requirement) {
    return null;
  }

  return {
    severity: normalizeSeverity(record.severity),
    title,
    requirement,
    reason: asString(record.reason),
    citationIds: asStringArray(record.citationIds),
    writebackText: asString(record.writebackText, requirement),
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
  if (!title || !requirement) {
    return null;
  }

  return {
    id: asString(record.id, createStableId("icr", [asString(record.ruleId), title, requirement])),
    severity: normalizeSeverity(record.severity),
    title,
    requirement,
    reason: asString(record.reason),
    action: asString(record.action, requirement),
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
    priority: normalizeSeverity(record.priority),
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

function hasAllowedCitation(
  item: MandatoryRequirement | SchemeWritebackCandidate | NormCitation,
  allowedCitationIds: Set<string>
): boolean {
  if ("citationIds" in item) {
    return item.citationIds.some((id) => allowedCitationIds.has(id));
  }

  return allowedCitationIds.has(item.id);
}

function restrictSectionMandatoryItems(section: ReviewSection, allowedCitationIds: Set<string>): ReviewSection {
  return {
    ...section,
    mandatoryItems: (section.mandatoryItems ?? []).filter((item) => hasAllowedCitation(item, allowedCitationIds))
  };
}

function normalizeSection(value: unknown, fallback: ReviewSection): ReviewSection {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const findings = Array.isArray(record.findings)
    ? record.findings
        .map((item, index) => normalizeFinding(item, fallback.findings[index]))
        .filter((item): item is ReviewFinding => Boolean(item))
    : fallback.findings;

  const mandatoryItems = Array.isArray(record.mandatoryItems)
    ? record.mandatoryItems
        .map((item) => normalizeMandatoryItem(item))
        .filter((item): item is MandatoryRequirement => Boolean(item))
    : fallback.mandatoryItems ?? [];

  const advisoryItems = Array.isArray(record.advisoryItems)
    ? record.advisoryItems
        .map((item) => normalizeAdvisoryItem(item))
        .filter((item): item is AdvisoryRecommendation => Boolean(item))
    : fallback.advisoryItems ?? [];

  const schemeCandidates = Array.isArray(record.schemeCandidates)
    ? record.schemeCandidates
        .map((item) => normalizeSchemeCandidate(item))
        .filter((item): item is SchemeWritebackCandidate => Boolean(item))
    : fallback.schemeCandidates ?? [];

  return {
    title: asString(record.title, fallback.title),
    summary: asString(record.summary, fallback.summary ?? fallback.conclusion),
    conclusion: asString(record.conclusion, fallback.conclusion),
    findings: findings.length ? findings : fallback.findings,
    mandatoryItems,
    advisoryItems,
    schemeCandidates,
    mustKeepItems: asStringArray(record.mustKeepItems, fallback.mustKeepItems ?? []),
    optimizationCandidates: Array.isArray(record.optimizationCandidates)
      ? record.optimizationCandidates
          .map((item) => normalizeAdvisoryItem(item))
          .filter((item): item is AdvisoryRecommendation => Boolean(item))
      : fallback.optimizationCandidates ?? [],
    costQuestions: asStringArray(record.costQuestions, fallback.costQuestions ?? []),
    alternativePaths: Array.isArray(record.alternativePaths)
      ? record.alternativePaths
          .map((item) => normalizeAdvisoryItem(item))
          .filter((item): item is AdvisoryRecommendation => Boolean(item))
      : fallback.alternativePaths ?? []
  };
}

function normalizeDuplicateMatches(
  value: unknown,
  fallback: DuplicateRemodelingMatch[]
): DuplicateRemodelingMatch[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .map((item, index) => {
      const fallbackItem = fallback[index];
      if (!item || typeof item !== "object") {
        return fallbackItem;
      }
      const record = item as Record<string, unknown>;
      return {
        projectId: asString(record.projectId, fallbackItem?.projectId ?? ""),
        projectTitle: asString(record.projectTitle, fallbackItem?.projectTitle ?? "待补充项目"),
        versionId: asString(record.versionId, fallbackItem?.versionId ?? ""),
        versionNumber: asNumber(record.versionNumber, fallbackItem?.versionNumber ?? 0),
        status: (record.status as DuplicateRemodelingMatch["status"]) ?? fallbackItem?.status ?? "draft",
        createdAt: asString(record.createdAt, fallbackItem?.createdAt ?? ""),
        locationSummary: asString(record.locationSummary, fallbackItem?.locationSummary ?? "待补充位置"),
        matchReason: asString(record.matchReason, fallbackItem?.matchReason ?? "待补充原因"),
        similarityScore: asNumber(record.similarityScore, fallbackItem?.similarityScore ?? 0)
      } satisfies DuplicateRemodelingMatch;
    })
    .filter((item): item is DuplicateRemodelingMatch => Boolean(item));
}

function extractJsonBlock(raw: string): ExternalReviewPayload {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fencedMatch ? fencedMatch[1] : trimmed;
  const firstBrace = jsonCandidate.indexOf("{");
  const lastBrace = jsonCandidate.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("模型未返回可解析的 JSON 对象");
  }

  return JSON.parse(jsonCandidate.slice(firstBrace, lastBrace + 1)) as ExternalReviewPayload;
}

function mergeExternalReview(
  fallback: Omit<AIReviewResult, "id">,
  payload: ExternalReviewPayload,
  modelName: string
): Omit<AIReviewResult, "id"> {
  const duplicateReview =
    payload.duplicateReview && typeof payload.duplicateReview === "object"
      ? (payload.duplicateReview as Record<string, unknown>)
      : undefined;
  const allowedCitationIds = new Set((fallback.citations ?? []).map((item) => item.id));
  const citations = Array.isArray(payload.citations)
    ? payload.citations
        .map((item) => normalizeCitation(item))
        .filter((item): item is NormCitation => item !== null && hasAllowedCitation(item, allowedCitationIds))
    : [];
  const mandatoryRequirements = Array.isArray(payload.mandatoryRequirements)
    ? payload.mandatoryRequirements
        .map((item) => normalizeMandatoryItem(item))
        .filter((item): item is MandatoryRequirement => item !== null && hasAllowedCitation(item, allowedCitationIds))
    : [];
  const internalControlRequirements = Array.isArray(payload.internalControlRequirements)
    ? payload.internalControlRequirements
        .map((item) => normalizeInternalControlItem(item))
        .filter((item): item is InternalControlRequirement => Boolean(item))
    : [];
  const advisoryRecommendations = Array.isArray(payload.advisoryRecommendations)
    ? payload.advisoryRecommendations
        .map((item) => normalizeAdvisoryItem(item))
        .filter((item): item is AdvisoryRecommendation => Boolean(item))
    : [];
  const advisoryWritebackCandidates = Array.isArray(payload.advisoryWritebackCandidates)
    ? payload.advisoryWritebackCandidates
        .map((item) => normalizeSchemeCandidate(item))
        .filter((item): item is SchemeWritebackCandidate => Boolean(item))
    : [];
  const schemeWritebacks = Array.isArray(payload.schemeWritebacks)
    ? payload.schemeWritebacks
        .map((item) => normalizeSchemeCandidate(item))
        .filter((item): item is SchemeWritebackCandidate => item !== null && hasAllowedCitation(item, allowedCitationIds))
    : [];
  const costEstimateRanges = Array.isArray(payload.costEstimateRanges)
    ? payload.costEstimateRanges
        .map((item) => normalizeCostEstimateRange(item))
        .filter((item): item is CostEstimateRange => Boolean(item))
    : [];

  const merged = {
    ...fallback,
    verdict: normalizeVerdict(payload.verdict, fallback.verdict),
    overallScore: clampScore(payload.overallScore, fallback.overallScore),
    conclusion: asString(payload.conclusion, fallback.conclusion),
    attachmentReadSummary: asStringArray(payload.attachmentReadSummary, fallback.attachmentReadSummary),
    missingMaterials: asStringArray(payload.missingMaterials, fallback.missingMaterials),
    requiredActions: asStringArray(payload.requiredActions, fallback.requiredActions),
    citations: dedupeBy([...(fallback.citations ?? []), ...citations], (item) => item.id),
    mandatoryRequirements: dedupeBy(
      [...(fallback.mandatoryRequirements ?? []), ...mandatoryRequirements],
      (item) => `${item.title}:${item.requirement}`
    ),
    internalControlRequirements: dedupeBy(
      [...(fallback.internalControlRequirements ?? []), ...internalControlRequirements],
      (item) => item.id
    ),
    advisoryRecommendations: dedupeBy(
      [...(fallback.advisoryRecommendations ?? []), ...advisoryRecommendations],
      (item) => item.id
    ),
    advisoryWritebackCandidates: dedupeBy(
      [...(fallback.advisoryWritebackCandidates ?? []), ...advisoryWritebackCandidates],
      (item) => item.id
    ),
    schemeWritebacks: dedupeBy(
      [...(fallback.schemeWritebacks ?? []), ...schemeWritebacks],
      (item) => item.id
    ),
    costEstimateRanges: dedupeBy(
      [...(fallback.costEstimateRanges ?? []), ...costEstimateRanges],
      (item) => item.id
    ),
    skillPackVersion: asString(payload.skillPackVersion, fallback.skillPackVersion ?? ENGINEERING_REVIEW_SKILL_PACK_VERSION),
    complianceReview: restrictSectionMandatoryItems(
      normalizeSection(payload.complianceReview, fallback.complianceReview),
      allowedCitationIds
    ),
    costReview: restrictSectionMandatoryItems(
      normalizeSection(payload.costReview, fallback.costReview),
      allowedCitationIds
    ),
    technicalReview: restrictSectionMandatoryItems(
      normalizeSection(payload.technicalReview, fallback.technicalReview),
      allowedCitationIds
    ),
    duplicateReview: {
      title: asString(duplicateReview?.title, fallback.duplicateReview.title),
      conclusion: asString(duplicateReview?.conclusion, fallback.duplicateReview.conclusion),
      matches: normalizeDuplicateMatches(duplicateReview?.matches, fallback.duplicateReview.matches)
    },
    modelName,
    promptVersion: "v5.0.0-normative-engineering-review",
    generatedAt: new Date().toISOString()
  } satisfies Omit<AIReviewResult, "id">;

  return normalizeAiReview(merged) ?? merged;
}

function stringifyPromptInput(params: ReviewGenerationParams, normContext: string, skillPackContext: string): string {
  const duplicateCandidates = params.duplicateMatches.map((item) => ({
    projectTitle: item.projectTitle,
    versionNumber: item.versionNumber,
    status: item.status,
    createdAt: item.createdAt,
    locationSummary: item.locationSummary,
    matchReason: item.matchReason,
    similarityScore: item.similarityScore
  }));

  return JSON.stringify(
    {
      category: params.snapshot.projectCategory,
      locationSummary: summarizeLocation(params.snapshot.location),
      snapshot: params.snapshot,
      attachmentSummaries: params.parseResults.map((item) => ({
        status: item.status,
        summary: item.summary ?? item.failureReason ?? "未提供可读摘要"
      })),
      duplicateCandidates,
      normContext,
      skillPackContext,
      skillPackVersion: ENGINEERING_REVIEW_SKILL_PACK_VERSION
    },
    null,
    2
  );
}

@Injectable()
export class AiReviewService {
  async generateReview(params: {
    projectId: string;
    versionId: string;
    snapshot: FormSnapshot;
    attachments: Attachment[];
    parseResults: AttachmentParseResult[];
    duplicateMatches: DuplicateRemodelingMatch[];
  }): Promise<Omit<AIReviewResult, "id">> {
    const fallback = buildRuleBasedReview(params);
    const provider = this.getProvider();

    if (provider === "demo" || provider === "mock") {
      return normalizeAiReview(fallback) ?? fallback;
    }

    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException("未配置 AI_API_KEY，无法调用真实模型。");
    }

    try {
      const upstream = await this.requestOpenAiCompatibleReview(params, apiKey);
      const payload = extractJsonBlock(upstream.content);
      return mergeExternalReview(fallback, payload, upstream.modelName);
    } catch (error) {
      const isAbort =
        error instanceof Error && (error.name === "AbortError" || /aborted|abort/i.test(error.message));
      if (isAbort) {
        throw new BadGatewayException(
          `AI 调用超时（${this.getTimeoutMs()}ms），请求已被中止，请重试或提高 AI_API_TIMEOUT_MS`
        );
      }
      if (this.allowDemoFallback()) {
        const fallbackResult = normalizeAiReview(fallback) ?? fallback;
        return {
          ...fallbackResult,
          modelName: `${fallbackResult.modelName} (fallback)`,
          promptVersion: "v5.0.0-fallback",
          attachmentReadSummary: [
            `真实模型调用失败，已回退规则引擎：${error instanceof Error ? error.message : "未知错误"}`,
            ...fallbackResult.attachmentReadSummary
          ]
        };
      }

      throw new BadGatewayException(
        `真实模型审核调用失败：${error instanceof Error ? error.message : "未知错误"}`
      );
    }
  }

  private getProvider(): string {
    const configured = (process.env.AI_PROVIDER ?? "auto").trim().toLowerCase();
    if (!configured || configured === "auto") {
      return this.hasRealModelCredentials() ? "openai" : "demo";
    }
    return configured;
  }

  private allowDemoFallback(): boolean {
    return (process.env.AI_ALLOW_DEMO_FALLBACK ?? "false").trim().toLowerCase() === "true";
  }

  private hasRealModelCredentials(): boolean {
    return Boolean((process.env.AI_API_KEY || process.env.OPENAI_API_KEY)?.trim());
  }

  private getBaseUrl(): string {
    return (process.env.AI_API_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
      /\/$/,
      ""
    );
  }

  private getApiPath(): string {
    const path = process.env.AI_API_PATH || "/chat/completions";
    return path.startsWith("/") ? path : `/${path}`;
  }

  private getModelName(): string {
    return process.env.AI_MODEL_NAME || "gpt-5.4";
  }

  private getTimeoutMs(): number {
    const configuredTimeout = Number(process.env.AI_API_TIMEOUT_MS || MIN_AI_REVIEW_TIMEOUT_MS);
    const safeTimeout =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : MIN_AI_REVIEW_TIMEOUT_MS;

    return Math.max(safeTimeout, MIN_AI_REVIEW_TIMEOUT_MS);
  }

  private async requestOpenAiCompatibleReview(
    params: ReviewGenerationParams,
    apiKey: string
  ): Promise<{ content: string; modelName: string }> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.getTimeoutMs());

    const citations = selectNationalNormCitations({
      snapshot: params.snapshot,
      parseResults: params.parseResults,
      limit: 8
    });
    const normContext = formatNormContext(citations);
    const scenarioCards = selectEngineeringScenarioCards({
      snapshot: params.snapshot,
      parseResults: params.parseResults,
      limit: 10
    });
    const skillPackContext = formatSkillPackContext(scenarioCards);

    try {
      const response = await fetch(`${this.getBaseUrl()}${this.getApiPath()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: this.getModelName(),
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "你是物业工程立项审核助手，目标是输出可追溯、可落地、能写回正式方案的结构化结论。",
                "你的输出必须区分强制规范要求与建议项。",
                "平台内控硬性要求必须放入 internalControlRequirements，不得伪装成国家规范条文。",
                "只有命中输入规范片段且能明确给出 citationIds 的内容，才允许进入 mandatoryRequirements 或各模块 mandatoryItems。",
                "不得仅因为规范片段出现在上下文中就生成强制项；每条强制项必须能对应到本项目的类别、风险勾选、文本描述、附件摘要或专项字段。",
                "没有明确规范依据的风险、优化建议或补充问题，一律降级为 advisoryRecommendations 或 advisoryItems。",
                "成本审核不能只说参考市场价或历史价，要先理解方案意图，再识别冗余、过度配置、重复投入、可替代路径和施工组织优化空间；允许给经验区间，但必须标注需人工复核。",
                "技术审核要判断路线是否闭环、是否过度、是否缺关键实施约束，并允许生成候选改写段落。",
                "当前审核阶段是工程立项预审，不是招标后深化设计审查；不得仅因缺少完整施工图、招标深度施工图或详细节点大样判定不通过。",
                "立项阶段可以要求现状照片、范围示意、关键点位清单、边界说明、隐蔽验收和后续深化安排；详细节点做法应作为通过立项后的招采/施工深化要求。",
                "国家规范强制项自动写回；建议项只能进入 advisoryWritebackCandidates，并明确需要人工勾选确认后才写入成果物。",
                "AI 作为专家预审应从严判断：安全/合规缺口、预算不一致、关键材料缺失、技术路线不闭环时可直接 verdict=fail。",
                "只输出 JSON，不要输出 Markdown，不要输出解释性前缀。"
              ].join("\n")
            },
            {
              role: "user",
              content: [
                "请根据以下输入生成结构化审核结果。",
                "输出 JSON 须包含字段：",
                "verdict, overallScore, conclusion, attachmentReadSummary, missingMaterials, requiredActions, citations, mandatoryRequirements, internalControlRequirements, advisoryRecommendations, advisoryWritebackCandidates, schemeWritebacks, costEstimateRanges, skillPackVersion, complianceReview, costReview, technicalReview, duplicateReview。",
                "citations[] 每项包含 id, code, title, clause, summary, applicableModules。",
                "mandatoryRequirements[] 每项包含 severity, title, requirement, reason, citationIds, writebackText, requiredMaterials。",
                "internalControlRequirements[] 每项包含 id, severity, title, requirement, reason, action, requiredMaterials, source, ruleId, writebackText。",
                "advisoryRecommendations[] 每项包含 title, recommendation, reason, requiredMaterials, kind, priority, moduleHints。",
                "advisoryWritebackCandidates[] 每项包含 id, title, targetSection, text, basis, citationIds, autoApplied=false, sourceModule。",
                "schemeWritebacks[] 每项包含 title, targetSection, text, basis, citationIds, autoApplied, sourceModule。",
                "costEstimateRanges[] 每项包含 id, itemName, basis, currentAmount, suggestedMin, suggestedMax, optimizationSpace, requiresManualReview, relatedRuleIds。",
                "complianceReview / costReview / technicalReview 均包含：title, summary, conclusion, findings, mandatoryItems, advisoryItems, schemeCandidates。",
                "costReview 额外包含 mustKeepItems, optimizationCandidates, costQuestions。",
                "technicalReview 额外包含 alternativePaths。",
                "findings[] 继续保留旧结构：severity, title, basis, currentState, action, requiredMaterials。",
                "costReview.mustKeepItems 应写必须保留、不能轻易压缩的必要投入。",
                "costReview.optimizationCandidates 只写有明确优化空间的项。",
                "costReview.costQuestions 只写需要申报人补充说明的成本合理性问题。",
                "当 costInputMode=upload 且 uploadedCostSheet 存在时，成本审核必须基于 uploadedCostSheet.rows 的全部有效明细、分组汇总、税费和最终总价判断；不要说“缺少在线矩阵”，也不要脱离上传清单泛泛要求市场询价。",
                "上传清单模式下，重点识别高金额项、重复检测/重复保障、税费或汇总异常、规格过度、可替代做法和施工组织优化空间。",
                "technicalReview.alternativePaths 只写更轻、更稳或更低扰动的替代路径建议。",
                "duplicateReview.matches 只能基于输入 duplicateCandidates，不得虚构新项目。",
                "如果没有明确 citationIds，不得生成 mandatoryItems，也不得把内容写进 schemeWritebacks。",
                "平台审批口径、预算一致性、资料完整性、技术闭环等内容只能放入 internalControlRequirements 或 advisoryRecommendations。",
                "缺少详细施工图、节点详图、招标深度大样图本身不能作为 internalControlRequirements 或 fail 的理由；如确需提示，只能写成后续深化建议或施工前控制要求。",
                "",
                stringifyPromptInput(params, normContext, skillPackContext)
              ].join("\n")
            }
          ]
        }),
        signal: controller.signal
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(`上游返回 ${response.status}: ${rawText}`);
      }

      const data = JSON.parse(rawText) as {
        model?: string;
        choices?: Array<{
          message?: {
            content?: string | Array<{ type?: string; text?: string }>;
          };
        }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return {
          content,
          modelName: data.model || this.getModelName()
        };
      }

      if (Array.isArray(content)) {
        const joined = content
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .join("")
          .trim();
        if (joined) {
          return {
            content: joined,
            modelName: data.model || this.getModelName()
          };
        }
      }

      throw new Error("上游未返回有效的文本内容");
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
