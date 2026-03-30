import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  AIReviewResult,
  Attachment,
  AttachmentParseResult,
  DuplicateRemodelingMatch,
  FormSnapshot,
  ReviewFinding,
  ReviewSection,
  summarizeLocation
} from "@property-review/shared";

import { buildRuleBasedReview, ReviewGenerationParams } from "./rule-based-review";

type ExternalReviewPayload = Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
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
    .filter((item) => item.length > 0);
  return normalized.length ? normalized : fallback;
}

function clampScore(value: unknown, fallback: number): number {
  const normalized = asNumber(value, fallback);
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function normalizeSeverity(value: unknown, fallback: ReviewFinding["severity"]): ReviewFinding["severity"] {
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
    title: asString(record.title, fallback?.title ?? "未提供/需补充"),
    basis: asString(record.basis, fallback?.basis ?? "未提供/需补充"),
    currentState: asString(record.currentState, fallback?.currentState ?? "未提供/需补充"),
    action: asString(record.action, fallback?.action ?? "未提供/需补充"),
    requiredMaterials: asStringArray(record.requiredMaterials, fallback?.requiredMaterials ?? [])
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

  return {
    title: asString(record.title, fallback.title),
    conclusion: asString(record.conclusion, fallback.conclusion),
    findings: findings.length ? findings : fallback.findings
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
        projectTitle: asString(record.projectTitle, fallbackItem?.projectTitle ?? "未提供/需补充"),
        versionId: asString(record.versionId, fallbackItem?.versionId ?? ""),
        versionNumber: asNumber(record.versionNumber, fallbackItem?.versionNumber ?? 0),
        status: (record.status as DuplicateRemodelingMatch["status"]) ?? fallbackItem?.status ?? "draft",
        createdAt: asString(record.createdAt, fallbackItem?.createdAt ?? ""),
        locationSummary: asString(record.locationSummary, fallbackItem?.locationSummary ?? "未提供/需补充"),
        matchReason: asString(record.matchReason, fallbackItem?.matchReason ?? "未提供/需补充"),
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

  return {
    ...fallback,
    verdict: normalizeVerdict(payload.verdict, fallback.verdict),
    overallScore: clampScore(payload.overallScore, fallback.overallScore),
    conclusion: asString(payload.conclusion, fallback.conclusion),
    attachmentReadSummary: asStringArray(payload.attachmentReadSummary, fallback.attachmentReadSummary),
    missingMaterials: asStringArray(payload.missingMaterials, fallback.missingMaterials),
    requiredActions: asStringArray(payload.requiredActions, fallback.requiredActions),
    complianceReview: normalizeSection(payload.complianceReview, fallback.complianceReview),
    costReview: normalizeSection(payload.costReview, fallback.costReview),
    technicalReview: normalizeSection(payload.technicalReview, fallback.technicalReview),
    duplicateReview: {
      title: asString(duplicateReview?.title, fallback.duplicateReview.title),
      conclusion: asString(duplicateReview?.conclusion, fallback.duplicateReview.conclusion),
      matches: normalizeDuplicateMatches(duplicateReview?.matches, fallback.duplicateReview.matches)
    },
    modelName,
    promptVersion: "v4.0.0-openai-compatible",
    generatedAt: new Date().toISOString()
  };
}

function stringifyPromptInput(params: ReviewGenerationParams): string {
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
        summary: item.summary ?? item.failureReason ?? "未提供/需补充"
      })),
      duplicateCandidates
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
      return fallback;
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
      if (this.allowDemoFallback()) {
        return {
          ...fallback,
          modelName: `${fallback.modelName} (fallback)`,
          promptVersion: "v4.0.0-fallback",
          attachmentReadSummary: [
            `真实模型调用失败，已回退规则引擎：${error instanceof Error ? error.message : "未知错误"}`,
            ...fallback.attachmentReadSummary
          ]
        };
      }

      throw new BadGatewayException(
        `真实模型审核调用失败：${error instanceof Error ? error.message : "未知错误"}`
      );
    }
  }

  private getProvider(): string {
    return (process.env.AI_PROVIDER ?? "demo").trim().toLowerCase();
  }

  private allowDemoFallback(): boolean {
    return (process.env.AI_ALLOW_DEMO_FALLBACK ?? "false").trim().toLowerCase() === "true";
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
    return process.env.AI_MODEL_NAME || "gpt-4.1-mini";
  }

  private getTimeoutMs(): number {
    const timeout = Number(process.env.AI_API_TIMEOUT_MS || 60000);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : 60000;
  }

  private async requestOpenAiCompatibleReview(
    params: ReviewGenerationParams,
    apiKey: string
  ): Promise<{ content: string; modelName: string }> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.getTimeoutMs());

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
                "你是物业工程立项 AI 审核专家。",
                "请基于工程改造常识、国家/地方技术规范、企业工程管理常规口径进行审查。",
                "不编造数据；未提供的内容必须明确写“未提供/需补充”。",
                "结论只能是 pass、conditional_pass、fail。",
                "每个问题必须给出 basis、currentState、action、requiredMaterials。",
                "只输出 JSON，不要输出 Markdown，不要输出解释性前缀。"
              ].join("\n")
            },
            {
              role: "user",
              content: [
                "请根据以下输入生成结构化审核结果。",
                "输出 JSON 字段必须包含：",
                "verdict, overallScore, conclusion, attachmentReadSummary, missingMaterials, requiredActions, complianceReview, costReview, technicalReview, duplicateReview。",
                "其中 complianceReview / costReview / technicalReview 都必须是 { title, conclusion, findings[] }。",
                "findings[] 中每一项都必须包含 severity, title, basis, currentState, action, requiredMaterials。",
                "duplicateReview 必须包含 title, conclusion, matches。",
                "matches 只能基于输入中提供的 duplicateCandidates，不得虚构新的重复项目。",
                "",
                stringifyPromptInput(params)
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
