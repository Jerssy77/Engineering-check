import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { BadGatewayException, BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { AIProviderConfigView, ProjectCostBoardRow, SessionUser, StoredAIProviderConfig, findDuplicateProjects, summarizeLocation } from "@property-review/shared";

import { FileBackedDataService } from "../shared/file-backed-data.service";
import { postJson } from "../shared/json-http-client";
import { UpdateAIConfigDto } from "./dto/ai-config.dto";

@Injectable()
export class AdminService {
  constructor(@Inject(FileBackedDataService) private readonly data: FileBackedDataService) {}

  getDashboard(user: SessionUser) {
    if (user.role === "submitter") {
      throw new ForbiddenException("\u53ea\u6709\u7ec8\u5ba1\u4eba\u548c\u7ba1\u7406\u5458\u53ef\u4ee5\u67e5\u770b\u7ba1\u7406\u770b\u677f");
    }

    return {
      organizations: this.data.getOrganizations(),
      users: this.data.getUsers().map((userItem) => ({
        id: userItem.id,
        username: userItem.username,
        displayName: userItem.displayName,
        role: userItem.role,
        organizationId: userItem.organizationId
      })),
      quotaPolicy: this.data.getQuotaPolicy(),
      projectCostBoard: this.buildProjectCostBoard(),
      investmentSummary: this.buildInvestmentSummary(),
      auditLogs: this.data
        .listAuditLogs()
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 30),
      aiUsage: this.buildAIUsageSummary()
    };
  }

  getAIUsage(user: SessionUser) {
    this.ensureAdmin(user);
    return this.buildAIUsageSummary();
  }

  getAIConfig(user: SessionUser): AIProviderConfigView {
    this.ensureAdmin(user);
    const stored = this.data.getAIProviderConfig();
    const hasApiKey = Boolean(stored?.encryptedApiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
    return {
      enabled: stored?.enabled ?? false,
      provider: stored?.provider ?? "demo",
      baseUrl: stored?.baseUrl ?? process.env.AI_API_BASE_URL ?? "https://api.openai.com/v1",
      stageModel: stored?.stageModel ?? "gpt-5.6-luna",
      schemeModel: stored?.schemeModel ?? "gpt-5.6-terra",
      decisionModel: stored?.decisionModel ?? "gpt-5.6-sol",
      blueprintModel: stored?.blueprintModel ?? "gpt-5.6-sol",
      routeModel: stored?.routeModel ?? "gpt-5.6-sol",
      reviewModel: stored?.reviewModel ?? "gpt-5.6-sol",
      reasoning: stored?.reasoning ?? { fingerprint: "low", blueprint: "medium", necessity: "medium", feasibility: "medium", route: "medium", scheme: "medium", review: "low", decision: "low" },
      embeddingModel: stored?.embeddingModel ?? "text-embedding-3-small",
      hasApiKey,
      maskedApiKey: hasApiKey ? "••••••••" : undefined,
      updatedBy: stored?.updatedBy,
      updatedAt: stored?.updatedAt
    };
  }

  updateAIConfig(user: SessionUser, dto: UpdateAIConfigDto): AIProviderConfigView {
    this.ensureAdmin(user);
    const current = this.data.getAIProviderConfig();
    const now = new Date().toISOString();
    let keyFields = current ? {
      encryptedApiKey: current.encryptedApiKey,
      apiKeyIv: current.apiKeyIv,
      apiKeyTag: current.apiKeyTag
    } : {};
    if (dto.apiKey?.trim()) keyFields = this.encryptApiKey(dto.apiKey.trim());
    if (dto.enabled && dto.provider !== "demo" && !keyFields.encryptedApiKey && !process.env.AI_API_KEY && !process.env.OPENAI_API_KEY) {
      throw new BadRequestException("启用真实模型前请填写 API 密钥");
    }
    this.data.setAIProviderConfig({
      enabled: dto.enabled,
      provider: dto.provider,
      baseUrl: dto.baseUrl.replace(/\/$/, ""),
      stageModel: dto.stageModel.trim(),
      schemeModel: dto.schemeModel.trim(),
      decisionModel: dto.decisionModel.trim(),
      blueprintModel: dto.blueprintModel?.trim() || "gpt-5.6-sol",
      routeModel: dto.routeModel?.trim() || "gpt-5.6-sol",
      reviewModel: dto.reviewModel?.trim() || "gpt-5.6-sol",
      reasoning: dto.reasoning ?? current?.reasoning ?? { fingerprint: "low", blueprint: "medium", necessity: "medium", feasibility: "medium", route: "medium", scheme: "medium", review: "low", decision: "low" },
      embeddingModel: dto.embeddingModel.trim(),
      updatedBy: user.id,
      updatedAt: now,
      ...keyFields
    });
    this.data.addAuditLog({ actorId: user.id, projectId: "platform", action: "ai_config_updated", detail: `AI配置已更新：${dto.provider} / ${dto.decisionModel}`, createdAt: now });
    return this.getAIConfig(user);
  }

  async testAIConfig(user: SessionUser) {
    this.ensureAdmin(user);
    const config = this.data.getAIProviderConfig();
    if (!config?.enabled || config.provider === "demo") return { ok: true, message: "当前为演示规则引擎，不会调用外部 API" };
    const apiKey = this.decryptApiKey(config) || process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException("未配置 API 密钥");
    try {
      const response = await postJson(
        `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        {
          model: config.decisionModel,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "只返回 JSON 对象。" },
            { role: "user", content: "返回 {\"ok\":true}，不要添加其他字段。" }
          ]
        },
        60000
      );
      if (!response.ok) throw new Error(`上游返回 ${response.status}`);
      const payload = JSON.parse(response.text) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
      if (!payload.choices?.[0]?.message?.content) throw new Error("上游未返回模型内容");
      return { ok: true, message: `连接正常，模型 ${payload.model || config.decisionModel} 可调用` };
    } catch (error) {
      throw new BadGatewayException(`连接测试失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  private buildAIUsageSummary() {
    const records = this.data.listAIUsageRecords();
    const today = new Date().toISOString().slice(0, 10);
    const todayRecords = records.filter((record) => record.createdAt.startsWith(today));
    const totals = todayRecords.reduce((sum, record) => ({
      requests: sum.requests + 1,
      failedRequests: sum.failedRequests + (record.status === "failed" ? 1 : 0),
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      reasoningTokens: sum.reasoningTokens + record.reasoningTokens,
      cachedInputTokens: sum.cachedInputTokens + record.cachedInputTokens,
      totalTokens: sum.totalTokens + record.totalTokens
    }), { requests: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, totalTokens: 0 });
    const byOperation = Object.values(todayRecords.reduce<Record<string, { operation: string; requests: number; failedRequests: number; totalTokens: number }>>((grouped, record) => {
      const row = grouped[record.operation] ?? { operation: record.operation, requests: 0, failedRequests: 0, totalTokens: 0 };
      row.requests += 1;
      row.failedRequests += record.status === "failed" ? 1 : 0;
      row.totalTokens += record.totalTokens;
      grouped[record.operation] = row;
      return grouped;
    }, {})).sort((a, b) => b.totalTokens - a.totalTokens);
    return { date: today, totals, byOperation, recent: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50) };
  }

  private ensureAdmin(user: SessionUser): void {
    if (user.role !== "admin") throw new ForbiddenException("只有管理员可以配置 AI 模型和密钥");
  }

  private encryptionKey(): Buffer {
    const secret = process.env.AI_CONFIG_MASTER_KEY || process.env.APP_SESSION_SECRET;
    if (!secret && process.env.NODE_ENV === "production") throw new BadRequestException("生产环境必须配置 AI_CONFIG_MASTER_KEY");
    return createHash("sha256").update(secret || "local-test-ai-config-key-change-before-production").digest();
  }

  private encryptApiKey(apiKey: string): Pick<StoredAIProviderConfig, "encryptedApiKey" | "apiKeyIv" | "apiKeyTag"> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    return { encryptedApiKey: encrypted.toString("base64"), apiKeyIv: iv.toString("base64"), apiKeyTag: cipher.getAuthTag().toString("base64") };
  }

  private decryptApiKey(config: StoredAIProviderConfig): string | undefined {
    if (!config.encryptedApiKey || !config.apiKeyIv || !config.apiKeyTag) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), Buffer.from(config.apiKeyIv, "base64"));
    decipher.setAuthTag(Buffer.from(config.apiKeyTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(config.encryptedApiKey, "base64")), decipher.final()]).toString("utf8");
  }

  private buildInvestmentSummary() {
    const organizations = this.data.getOrganizations();
    const rows = this.buildProjectCostBoard();
    const decisions = this.data.listGuidedDecisions();
    const sessions = this.data.listInterviewSessions();
    const valueOf = (projectId: string) => rows.find((item) => item.projectId === projectId)?.currentBudget ?? 0;
    const group = (keyOf: (row: ProjectCostBoardRow) => string) => Object.entries(
      rows.reduce<Record<string, number>>((result, row) => {
        const key = keyOf(row);
        result[key] = (result[key] ?? 0) + row.currentBudget;
        return result;
      }, {})
    ).map(([name, amount]) => ({ name, amount }));
    const costItems = this.data.listProjects().flatMap((project) => {
      const version = this.data.listVersions(project.id).find((item) => item.id === project.currentVersionId);
      return version?.snapshot.costMatrixRows.map((item) => ({ name: item.itemName, amount: item.quantity * item.unitPrice })) ?? [];
    });
    const topCostItems = Object.entries(costItems.reduce<Record<string, number>>((result, item) => {
      result[item.name] = (result[item.name] ?? 0) + item.amount;
      return result;
    }, {})).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8);
    const projectIdOfDecision = (decisionId: string) => sessions.find((session) => session.decisionId === decisionId)?.projectId;
    return {
      totalInvestment: rows.reduce((sum, row) => sum + row.currentBudget, 0),
      approvedInvestment: rows.filter((row) => row.status === "human_approved").reduce((sum, row) => sum + (row.finalBudget ?? row.currentBudget), 0),
      automaticApprovedInvestment: decisions.filter((item) => item.route === "automatic" && item.status === "effective").reduce((sum, item) => sum + valueOf(projectIdOfDecision(item.id) ?? ""), 0),
      humanPendingInvestment: decisions.filter((item) => item.status === "pending").reduce((sum, item) => sum + valueOf(projectIdOfDecision(item.id) ?? ""), 0),
      budgetChange: rows.reduce((sum, row) => sum + row.budgetDelta, 0),
      duplicateInvestment: rows.filter((row) => row.duplicateFlag).reduce((sum, row) => sum + row.currentBudget, 0),
      byCategory: group((row) => row.projectCategory),
      byCity: group((row) => organizations.find((item) => item.id === row.organizationId)?.name ?? "其他"),
      budgetBuckets: [
        { name: "20万元以内", amount: rows.filter((row) => row.currentBudget <= 200000).reduce((sum, row) => sum + row.currentBudget, 0), count: rows.filter((row) => row.currentBudget <= 200000).length },
        { name: "20万至100万元", amount: rows.filter((row) => row.currentBudget > 200000 && row.currentBudget <= 1000000).reduce((sum, row) => sum + row.currentBudget, 0), count: rows.filter((row) => row.currentBudget > 200000 && row.currentBudget <= 1000000).length },
        { name: "100万元以上", amount: rows.filter((row) => row.currentBudget > 1000000).reduce((sum, row) => sum + row.currentBudget, 0), count: rows.filter((row) => row.currentBudget > 1000000).length }
      ],
      topCostItems
    };
  }

  private buildProjectCostBoard(): ProjectCostBoardRow[] {
    const organizations = this.data.getOrganizations();
    const allProjects = this.data.listProjects();
    const duplicateRecords = allProjects.flatMap((project) =>
      this.data.listVersions(project.id).map((version) => ({
        projectId: project.id,
        projectTitle: project.title,
        projectCategory: project.category,
        versionId: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        createdAt: version.createdAt,
        snapshot: version.snapshot
      }))
    );

    return allProjects
      .map((project) => {
        const versions = this.data.listVersions(project.id).sort((left, right) => left.versionNumber - right.versionNumber);
        const currentVersion = versions.find((item) => item.id === project.currentVersionId) ?? versions[versions.length - 1];
        const approvedVersion = [...versions]
          .reverse()
          .find((item) => item.status === "human_approved");
        const initialBudget = versions[0]?.snapshot.budgetAmount ?? 0;
        const currentBudget = currentVersion?.snapshot.budgetAmount ?? initialBudget;
        const finalBudget = approvedVersion?.snapshot.budgetAmount;
        const comparisonTarget = currentVersion?.snapshot;
        const duplicateFlag = comparisonTarget
          ? findDuplicateProjects({
              currentProjectId: project.id,
              snapshot: comparisonTarget,
              records: duplicateRecords
            }).length > 0
          : false;

        return {
          projectId: project.id,
          organizationId: project.organizationId,
          organizationName: organizations.find((item) => item.id === project.organizationId)?.name ?? "-",
          projectName: project.title,
          projectCategory: project.category,
          locationSummary: currentVersion ? summarizeLocation(currentVersion.snapshot.location) : "-",
          status: project.status,
          initialBudget,
          currentBudget,
          finalBudget,
          budgetDelta: (finalBudget ?? currentBudget) - initialBudget,
          submissionCount: this.data.listQuotaLedger().filter((item) => item.projectId === project.id).length,
          updatedAt: project.updatedAt,
          duplicateFlag
        } satisfies ProjectCostBoardRow;
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }
}
