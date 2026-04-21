import {
  AttachmentParseResult,
  FormSnapshot,
  ProjectCategory,
  RiskFlagKey
} from "@property-review/shared";

import skillPackJson from "./engineering-review-skill-pack.json";

export interface EngineeringScenarioCard {
  id: string;
  categories: ProjectCategory[];
  scene: string;
  keywords: string[];
  riskFlags?: RiskFlagKey[];
  requiredMaterials: string[];
  complianceChecks: string[];
  costOptimizationChecks: string[];
  technicalChecks: string[];
  writebackTemplates: string[];
  estimateHints: string[];
}

interface EngineeringReviewSkillPack {
  version: string;
  scenarioCards: EngineeringScenarioCard[];
}

const skillPack = skillPackJson as EngineeringReviewSkillPack;

export const ENGINEERING_REVIEW_SKILL_PACK_VERSION = skillPack.version;

export const RISK_FLAG_LABELS: Record<RiskFlagKey, string> = {
  powerOrWaterShutdown: "涉及停机/停水/停电或系统切换",
  fireSystemImpact: "影响消防系统或消防安全能力",
  hotWork: "涉及动火作业",
  workingAtHeight: "涉及高处作业",
  concealedWork: "涉及隐蔽工程",
  nightWork: "涉及夜间施工",
  occupiedAreaImpact: "影响已使用区域或客户通行",
  thirdPartyTesting: "需要第三方检测或专项复核"
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function flattenValues(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value).flatMap((item) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      return [String(item)];
    }
    return flattenValues(item);
  });
}

export function getActiveRiskFlags(snapshot: FormSnapshot): RiskFlagKey[] {
  const flags = snapshot.riskFlags ?? {};
  return (Object.keys(RISK_FLAG_LABELS) as RiskFlagKey[]).filter((key) => Boolean(flags[key]));
}

function buildSearchText(snapshot: FormSnapshot, parseResults: AttachmentParseResult[] = []): string {
  const activeRiskLabels = getActiveRiskFlags(snapshot).map((key) => RISK_FLAG_LABELS[key]);
  return [
    snapshot.projectName,
    snapshot.issueDescription,
    snapshot.currentCondition,
    snapshot.issueSourceDescription,
    snapshot.temporaryMeasures,
    snapshot.location.impactScope,
    snapshot.objective,
    snapshot.implementationScope,
    snapshot.feasibilitySummary,
    snapshot.keyProcess,
    snapshot.materialSelection,
    snapshot.acceptancePlan,
    snapshot.hiddenWorksRequirement,
    snapshot.sampleFirstRequirement,
    snapshot.detailDrawingRequirement,
    snapshot.thirdPartyTestingRequirement,
    snapshot.preliminaryPlan,
    snapshot.initialBudgetExplanation,
    snapshot.expectedBenefits,
    snapshot.supplementaryNotes,
    ...activeRiskLabels,
    ...flattenValues(snapshot.categorySpecificFields),
    ...parseResults.map((item) => item.summary ?? item.extractedText ?? item.failureReason ?? "")
  ]
    .map((item) => text(item).toLowerCase())
    .join(" ");
}

function scoreScenarioCard(card: EngineeringScenarioCard, snapshot: FormSnapshot, haystack: string): number {
  let score = card.categories.includes(snapshot.projectCategory) ? 8 : 0;
  score += card.keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length * 3;
  score += (card.riskFlags ?? []).filter((flag) => snapshot.riskFlags?.[flag]).length * 4;

  if (!card.categories.includes(snapshot.projectCategory)) {
    score -= 6;
  }

  return score;
}

export function selectEngineeringScenarioCards(params: {
  snapshot: FormSnapshot;
  parseResults?: AttachmentParseResult[];
  limit?: number;
}): EngineeringScenarioCard[] {
  const haystack = buildSearchText(params.snapshot, params.parseResults ?? []);
  const limit = params.limit ?? 10;

  return skillPack.scenarioCards
    .map((card) => ({
      card,
      score: scoreScenarioCard(card, params.snapshot, haystack)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id))
    .slice(0, limit)
    .map((item) => item.card);
}

export function formatSkillPackContext(cards: EngineeringScenarioCard[]): string {
  if (!cards.length) {
    return "当前未命中工程场景规则卡，请仅基于表单和附件作保守审核。";
  }

  return cards
    .map((card, index) =>
      [
        `${index + 1}. [${card.id}] ${card.scene}`,
        `适用类别：${card.categories.join(", ")}`,
        `必查材料：${card.requiredMaterials.join("、") || "无"}`,
        `合规检查：${card.complianceChecks.join("；")}`,
        `成本检查：${card.costOptimizationChecks.join("；")}`,
        `技术检查：${card.technicalChecks.join("；")}`,
        `可写回文本：${card.writebackTemplates.join("；")}`,
        `估价提示：${card.estimateHints.join("；") || "无"}`
      ].join("\n")
    )
    .join("\n\n");
}

export function listSkillPackCards(): EngineeringScenarioCard[] {
  return skillPack.scenarioCards;
}
