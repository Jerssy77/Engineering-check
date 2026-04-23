import {
  AttachmentParseResult,
  FormSnapshot,
  NormCitation,
  ProjectCategory,
  ReviewModule
} from "@property-review/shared";

interface BuiltInNormCitation extends NormCitation {
  categories?: ProjectCategory[];
  keywords?: string[];
  riskFlags?: string[];
}

const NATIONAL_PACK_ID = "national-starter-pack";

const NATIONAL_NORM_PACK: BuiltInNormCitation[] = [
  {
    id: "gb55022-survey",
    packId: NATIONAL_PACK_ID,
    code: "GB 55022-2021",
    title: "既有建筑维护与改造通用规范",
    clause: "第3.0.2条",
    summary: "既有建筑改造前应结合现状调查、检测和必要鉴定明确改造边界、风险点和实施条件。",
    applicableModules: ["compliance", "technical"],
    keywords: ["调查", "检测", "鉴定", "现状", "改造", "病害", "隐患"]
  },
  {
    id: "gb55022-hidden",
    packId: NATIONAL_PACK_ID,
    code: "GB 55022-2021",
    title: "既有建筑维护与改造通用规范",
    clause: "第4.1.4条",
    summary: "涉及隐蔽部位和关键节点的改造应落实过程记录、验收和必要的节点详图控制。",
    applicableModules: ["compliance", "technical"],
    keywords: ["隐蔽", "节点", "详图", "验收", "样板", "记录"]
  },
  {
    id: "gb55036-fire-integrity",
    packId: NATIONAL_PACK_ID,
    code: "GB 55036-2022",
    title: "消防设施通用规范",
    clause: "第3.0.3条",
    summary: "消防设施改造应保证系统完整性、联动逻辑和恢复后的功能验证，不得削弱原有安全能力。",
    applicableModules: ["compliance", "technical"],
    categories: ["fire_safety"],
    keywords: ["消防", "联动", "喷淋", "报警", "消火栓", "灭火", "火灾"]
  },
  {
    id: "gb55036-testing",
    packId: NATIONAL_PACK_ID,
    code: "GB 55036-2022",
    title: "消防设施通用规范",
    clause: "第10.0.4条",
    summary: "消防系统改造完成后应组织功能测试、联动试验和恢复性验收，确保投入使用前状态闭环。",
    applicableModules: ["compliance", "technical"],
    categories: ["fire_safety"],
    keywords: ["消防", "测试", "联动", "验收", "恢复", "试运行"]
  },
  {
    id: "gb50303-electrical-quality",
    packId: NATIONAL_PACK_ID,
    code: "GB 50303-2015",
    title: "建筑电气工程施工质量验收规范",
    clause: "第3.2.1条",
    summary: "建筑电气改造应落实材料设备合格证明、安装质量控制和通电前检查，涉及切换时应有恢复验证。",
    applicableModules: ["compliance", "technical"],
    categories: ["mep_upgrade", "energy_retrofit"],
    keywords: ["配电", "电气", "电缆", "控制柜", "联调", "切换", "通电"]
  },
  {
    id: "gb50242-plumbing-test",
    packId: NATIONAL_PACK_ID,
    code: "GB 50242-2002",
    title: "建筑给水排水及采暖工程施工质量验收规范",
    clause: "第4.2.1条",
    summary: "给排水改造应明确试压、通水、通球或通水验证要求，并在隐蔽前完成检查记录。",
    applicableModules: ["compliance", "technical"],
    categories: ["plumbing_drainage"],
    keywords: ["给排水", "试压", "通水", "排水", "渗漏", "管线", "隐蔽"]
  },
  {
    id: "gb55030-waterproof",
    packId: NATIONAL_PACK_ID,
    code: "GB 55030-2022",
    title: "建筑与市政工程防水通用规范",
    clause: "第4.1.1条",
    summary: "涉及屋面、卫生间、设备夹层等防水部位改造时，应明确基层处理、节点做法和闭水等验证要求。",
    applicableModules: ["compliance", "technical"],
    categories: ["civil_upgrade", "plumbing_drainage"],
    keywords: ["防水", "渗漏", "屋面", "卫生间", "闭水", "节点"]
  },
  {
    id: "gb50210-finish-protection",
    packId: NATIONAL_PACK_ID,
    code: "GB 50210-2018",
    title: "建筑装饰装修工程质量验收标准",
    clause: "第3.0.6条",
    summary: "装饰装修和土建修复应明确基层、成品保护、样板先行和外观质量控制要求。",
    applicableModules: ["compliance", "technical"],
    categories: ["civil_upgrade"],
    keywords: ["土建", "修复", "装饰", "样板", "成品保护", "基层"]
  },
  {
    id: "gb50300-acceptance",
    packId: NATIONAL_PACK_ID,
    code: "GB 50300-2013",
    title: "建筑工程施工质量验收统一标准",
    clause: "第5.0.4条",
    summary: "施工质量验收应以检验批、分项和必要资料为基础，验收资料、过程记录和实测结果应完整闭环。",
    applicableModules: ["compliance", "technical"],
    keywords: ["验收", "资料", "检验批", "分项", "记录", "闭环"]
  },
  {
    id: "gbt50378-lifecycle",
    packId: NATIONAL_PACK_ID,
    code: "GB/T 50378-2019",
    title: "绿色建筑评价标准",
    clause: "第8.2.7条",
    summary: "节能改造应优先采用与运行场景相匹配的低扰动、可维护和全生命周期成本更优的技术路径。",
    applicableModules: ["cost", "technical"],
    categories: ["energy_retrofit", "mep_upgrade"],
    keywords: ["节能", "低扰动", "维护", "生命周期", "能耗", "优化"]
  }
];

function buildSearchText(snapshot: FormSnapshot, parseResults: AttachmentParseResult[] = []): string {
  const activeRiskFlags = Object.entries(snapshot.riskFlags ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);

  return [
    snapshot.projectName,
    snapshot.issueDescription,
    snapshot.currentCondition,
    snapshot.issueSourceDescription,
    snapshot.implementationScope,
    snapshot.feasibilitySummary,
    snapshot.keyProcess,
    snapshot.materialSelection,
    snapshot.acceptancePlan,
    snapshot.hiddenWorksRequirement,
    snapshot.sampleFirstRequirement,
    snapshot.detailDrawingRequirement,
    snapshot.thirdPartyTestingRequirement,
    ...activeRiskFlags,
    ...flattenObjectValues(snapshot.categorySpecificFields),
    ...parseResults.map((item) => item.summary ?? item.extractedText ?? "")
  ]
    .join(" ")
    .toLowerCase();
}

function flattenObjectValues(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value).flatMap((item) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      return [String(item)];
    }
    return flattenObjectValues(item);
  });
}

function countKeywordHits(citation: BuiltInNormCitation, haystack: string): number {
  return (citation.keywords ?? []).filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
}

function countRiskFlagHits(citation: BuiltInNormCitation, snapshot: FormSnapshot): number {
  const flags = snapshot.riskFlags as Record<string, boolean | undefined> | undefined;
  return (citation.riskFlags ?? []).filter((flag) => Boolean(flags?.[flag])).length;
}

function scoreCitation(
  citation: BuiltInNormCitation,
  snapshot: FormSnapshot,
  haystack: string
): number {
  const keywordHits = countKeywordHits(citation, haystack);
  const riskFlagHits = countRiskFlagHits(citation, snapshot);
  const hasCategoryScope = Boolean(citation.categories?.length);
  const categoryMatches = !hasCategoryScope || citation.categories?.includes(snapshot.projectCategory);

  if (hasCategoryScope && !categoryMatches && riskFlagHits === 0) {
    return 0;
  }

  if (hasCategoryScope) {
    if (riskFlagHits === 0 && keywordHits < 3) {
      return 0;
    }
    if (riskFlagHits > 0 && keywordHits === 0) {
      return 0;
    }

    return (categoryMatches ? 4 : 0) + keywordHits * 3 + riskFlagHits * 4;
  }

  if (keywordHits < 3 && riskFlagHits === 0) {
    return 0;
  }

  let score = keywordHits * 3 + riskFlagHits * 4;

  if (
    citation.applicableModules.includes("cost") &&
    snapshot.projectCategory === "energy_retrofit" &&
    keywordHits > 0
  ) {
    score += 1;
  }

  return score;
}

export function selectNationalNormCitations(params: {
  snapshot: FormSnapshot;
  parseResults?: AttachmentParseResult[];
  module?: ReviewModule;
  limit?: number;
}): NormCitation[] {
  const haystack = buildSearchText(params.snapshot, params.parseResults ?? []);
  const limit = params.limit ?? 5;

  return NATIONAL_NORM_PACK
    .filter((citation) => !params.module || citation.applicableModules.includes(params.module))
    .map((citation) => ({
      citation,
      score: scoreCitation(citation, params.snapshot, haystack)
    }))
    .filter((item) => item.score >= 8)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.citation);
}

export function formatNormContext(citations: NormCitation[]): string {
  if (!citations.length) {
    return "当前没有命中的内置国家规范片段，模型只能把无明确依据的内容降级为建议项。";
  }

  return citations
    .map(
      (citation, index) =>
        `${index + 1}. [${citation.id}] ${citation.code}《${citation.title}》${citation.clause}：${citation.summary}`
    )
    .join("\n");
}
