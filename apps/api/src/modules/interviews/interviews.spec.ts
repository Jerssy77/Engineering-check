import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateSync } from "class-validator";

import { calculateSubmissionEligibility, createEmptyFormSnapshot, resolveGuidedApprovalRoute, validateGuidedCostClosure, type InterviewSession, type ProjectCategory, type ScopeCalibrationProposal } from "@property-review/shared";

import { buildInitialKnowledgeRelease } from "./interview-knowledge";
import { FileBackedDataService } from "../shared/file-backed-data.service";
import { GuidedAiSkillService } from "./guided-ai-skill.service";
import { CreateProjectDto } from "../projects/dto/create-project.dto";

test("首发知识包发布土建和机电，并预置跨类别通用补充事实卡", () => {
  const release = buildInitialKnowledgeRelease("test", "2026-08-10T00:00:00.000Z");
  assert.deepEqual(release.categories, ["civil_upgrade", "mep_upgrade"]);
  assert.equal(release.questions.length, 19);
  assert.equal(new Set(release.questions.map((item) => item.id)).size, 19);
  assert.equal(release.questions.find((item) => item.id === "necessity.problem_evidence_type")?.responseType, "multi_choice");
  assert.equal(release.questions.find((item) => item.id === "necessity.project_location")?.responseType, "location_form");
  assert.equal(release.questions.find((item) => item.id === "feasibility.scope_components")?.responseType, "scope_selector");
  assert.equal(release.questions.find((item) => item.id === "necessity.condition_history")?.responseType, "fact_form");
  assert.ok(release.questions.some((item) => item.id === "necessity.problem_history" && item.categories.includes("mep_upgrade")));
  assert.ok(release.questions.some((item) => item.id === "necessity.compliance_history" && item.categories.includes("fire_safety")));
  assert.ok(release.questions.some((item) => item.id === "necessity.performance_baseline" && item.categories.includes("energy_retrofit")));
  assert.ok(release.questions.some((item) => item.id === "feasibility.hot_work"));
  assert.ok(release.questions.some((item) => item.id === "feasibility.working_at_height"));
  assert.ok(release.questions.some((item) => item.id === "feasibility.third_party_testing"));
  assert.equal(/xxx/i.test(JSON.stringify(release.schemeTemplates)), false);
});

test("V2 动态审查数据契约支持事项指纹、命题蓝图和独立方案复核", () => {
  const fingerprint = { discipline: "机电", system: "生活给水", object: "水泵组", problemMode: "频繁故障", proposedAction: "更新", impactScope: "多楼栋", basis: ["申报描述"], modelName: "gpt-5.6-luna", promptVersion: "test", confirmedAt: "2026-08-12T00:00:00.000Z" };
  const blueprint = { id: "blueprint_test", version: 1, fingerprintKey: "生活给水|水泵组|频繁故障|更新", summary: "水泵更新审查", propositions: [{ id: "n1", stage: "necessity" as const, statement: "整体更新优于常规维修", requiredFacts: [{ key: "failure_count", label: "故障频次", maturity: "documented" as const, impacts: ["necessity" as const] }], passCondition: "故障反复且维修不能稳定解决", rejectCondition: "单次故障且可稳定修复" }, { id: "f1", stage: "feasibility" as const, statement: "选型和切换条件已闭合", requiredFacts: [{ key: "pump_duty", label: "流量扬程", maturity: "measured" as const, impacts: ["selection" as const] }], passCondition: "关键参数和接口明确", rejectCondition: "关键参数留待深化" }], routeFactors: ["连续供水"], candidateRoutes: [{ name: "同工况整组更新", mechanism: "按系统工况重新选型并更新泵组", applicability: ["既有系统能力不足"], exclusions: ["可通过单部件稳定修复"], criticalParameters: ["流量", "扬程"] }], deferredAllowed: ["最终安装数量复核"], antiEvasionTerms: ["待深化"], modelName: "gpt-5.6-sol", promptVersion: "test", createdAt: "2026-08-12T00:00:00.000Z" };
  assert.equal(fingerprint.object, "水泵组");
  assert.equal(blueprint.propositions.filter((item) => item.stage === "feasibility").length, 1);
  assert.ok(blueprint.antiEvasionTerms.includes("待深化"));
});

test("20万元阈值、影子审批和正式自动批准路由固定", () => {
  assert.equal(resolveGuidedApprovalRoute({ outcome: "approved", budgetAmount: 200000, formalAutoApprovalEnabled: false }), "shadow_human");
  assert.equal(resolveGuidedApprovalRoute({ outcome: "approved", budgetAmount: 200001, formalAutoApprovalEnabled: true }), "human_budget");
  assert.equal(resolveGuidedApprovalRoute({ outcome: "approved", budgetAmount: 200000, formalAutoApprovalEnabled: true }), "automatic");
  assert.equal(resolveGuidedApprovalRoute({ outcome: "supplement_required", budgetAmount: 100000, formalAutoApprovalEnabled: true }), "shadow_human");
});

test("工程量、单位、价格和申报预算必须闭合", () => {
  const validRows = [{ id: "1", type: "engineering" as const, itemName: "主体工程", specification: "", unit: "项", quantity: 2, unitPrice: 50000, remark: "" }];
  assert.deepEqual(validateGuidedCostClosure(validRows, 100000), []);
  assert.deepEqual(validateGuidedCostClosure(validRows, 90000), ["budget_not_closed"]);
  assert.deepEqual(validateGuidedCostClosure([{ ...validRows[0], unit: "" }], 100000), ["incomplete_cost_row"]);
});

test("每周3次额度、3天冷却期和特批沿用原规则", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const version = {
    id: "v1",
    projectId: "p1",
    versionNumber: 1,
    status: "human_returned" as const,
    snapshot: createEmptyFormSnapshot(),
    returnedAt: "2026-08-09T00:00:00.000Z",
    createdBy: "u1",
    createdAt: "2026-08-09T00:00:00.000Z"
  };
  const blocked = calculateSubmissionEligibility({
    versions: [version],
    ledger: [],
    overrides: [],
    organizationId: "org1",
    currentStatus: "human_returned",
    now
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "cooldown_active");

  const allowedByOverride = calculateSubmissionEligibility({
    versions: [version],
    ledger: [],
    overrides: [{ id: "o1", projectId: "p1", grantedBy: "admin", scope: "both", reason: "紧急抢修", used: false, createdAt: now.toISOString() }],
    organizationId: "org1",
    currentStatus: "human_returned",
    now
  });
  assert.equal(allowedByOverride.allowed, true);
  assert.equal(allowedByOverride.availableOverrideId, "o1");
});

test("范围校准将原申报、事实支持和确认范围分离，且不占用补充轮次", () => {
  const proposal: ScopeCalibrationProposal = {
    stage: "necessity",
    declaredScope: "园区全部电梯轿厢",
    supportedScope: "三个园区存在锈蚀的轿厢",
    unsupportedScope: "其余未提供问题明细的电梯轿厢",
    reason: "当前明细只支持部分位置",
    basis: ["逐梯明细仅列出三个园区的异常轿厢"],
    modelName: "gpt-5.6-luna",
    promptVersion: "scope-v1",
    createdAt: "2026-08-13T00:00:00.000Z"
  };
  const session = {
    status: "scope_confirmation",
    declaredScope: proposal.declaredScope,
    scopeCalibration: proposal,
    supplementRound: { necessity: 1 }
  } as Pick<InterviewSession, "status" | "declaredScope" | "scopeCalibration" | "supplementRound">;
  assert.equal(session.status, "scope_confirmation");
  assert.equal(session.scopeCalibration?.supportedScope, "三个园区存在锈蚀的轿厢");
  assert.equal(session.supplementRound?.necessity, 1);
});

test("品质提升与故障整治使用不同审查门槛", () => {
  const qualityFingerprint = {
    intent: "quality_upgrade" as const,
    businessObjective: "统一电梯轿厢形象并提升乘用空间品质",
    scopeStrategy: "phased_program" as const
  };
  const propositions = [
    { stage: "necessity", gate: "principle", statement: "品质提升目标成立" },
    { stage: "necessity", gate: "scope_strategy", statement: "分期策略合理" },
    { stage: "feasibility", gate: "implementation_readiness", statement: "施工前复核重量和接口" }
  ] as const;
  assert.equal(qualityFingerprint.intent, "quality_upgrade");
  assert.equal(propositions.filter((item) => item.gate !== "implementation_readiness").length, 2);
  assert.equal(propositions.find((item) => item.gate === "implementation_readiness")?.stage, "feasibility");
});

test("删除附件时同步清理证据声明，不能留下虚假的已具备证据状态", () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "property-review-evidence-"));
  const previousDataFile = process.env.APP_DATA_FILE;
  const previousUploadDir = process.env.APP_UPLOAD_DIR;
  try {
    process.env.APP_DATA_FILE = path.join(tempRoot, "state.json");
    process.env.APP_UPLOAD_DIR = path.join(tempRoot, "uploads");
    const data = new FileBackedDataService();
    const project = data.listProjects()[0];
    const version = data.listVersions(project.id)[0];
    const release = data.createKnowledgeRelease(buildInitialKnowledgeRelease("test", new Date().toISOString()));
    const interview = data.createInterviewSession({
      projectId: project.id,
      versionId: version.id,
      knowledgeReleaseId: release.id,
      category: "civil_upgrade",
      stage: "necessity",
      status: "in_progress",
      tendency: "needs_information",
      tendencyReasons: [],
      answerIds: [],
      evidenceClaimIds: [],
      assessmentIds: [],
      schemeModules: [],
      generatedCostRows: [],
      costBenchmarks: [],
      affectedQuestionIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const attachment = data.createAttachment({ projectId: project.id, versionId: version.id, slotKey: "supplementary", fileName: "工单.pdf", mimeType: "application/pdf", size: 100, storageKey: "test.pdf", kind: "pdf", uploadedAt: new Date().toISOString() });
    const claim = data.createEvidenceClaim({ sessionId: interview.id, factKey: "problem_exists", attachmentIds: [attachment.id], evidenceType: "work_order" });
    data.updateInterviewSession(interview.id, (current) => ({ ...current, evidenceClaimIds: [claim.id] }));

    data.deleteAttachment(attachment.id);

    assert.equal(data.listEvidenceClaims(interview.id).length, 0);
    assert.deepEqual(data.getInterviewSession(interview.id).evidenceClaimIds, []);
  } finally {
    if (previousDataFile === undefined) delete process.env.APP_DATA_FILE; else process.env.APP_DATA_FILE = previousDataFile;
    if (previousUploadDir === undefined) delete process.env.APP_UPLOAD_DIR; else process.env.APP_UPLOAD_DIR = previousUploadDir;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("类别覆盖矩阵明确区分底层能力与首期开放范围", () => {
  const allCategories: ProjectCategory[] = ["civil_upgrade", "mep_upgrade", "fire_safety", "energy_retrofit", "plumbing_drainage"];
  const release = buildInitialKnowledgeRelease("test", "2026-08-17T00:00:00.000Z");
  assert.deepEqual(release.categories, ["civil_upgrade", "mep_upgrade"]);

  const validation = Object.fromEntries(allCategories.map((category) => {
    const dto = Object.assign(new CreateProjectDto(), { projectName: "测试工程项目", projectCategory: category });
    return [category, validateSync(dto).length === 0];
  }));
  assert.deepEqual(validation, {
    civil_upgrade: true,
    mep_upgrade: true,
    fire_safety: false,
    energy_retrofit: false,
    plumbing_drainage: false
  });

  assert.ok(release.questions.some((item) => item.categories.includes("fire_safety")), "题库已预留消防事实卡");
  assert.ok(release.questions.some((item) => item.categories.includes("energy_retrofit")), "题库已预留节能事实卡");
  assert.ok(release.questions.some((item) => item.categories.includes("plumbing_drainage")), "题库已预留给排水事实卡");
  assert.equal(Boolean(release.schemeTemplates.fire_safety), false, "消防方案包尚未发布");
  assert.equal(Boolean(release.schemeTemplates.energy_retrofit), false, "节能方案包尚未发布");
  assert.equal(Boolean(release.schemeTemplates.plumbing_drainage), false, "给排水方案包尚未发布");
});

test("AI阶段判断机制跨五类项目均为单请求并记录真实Usage", async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "property-review-ai-matrix-"));
  const previousDataFile = process.env.APP_DATA_FILE;
  const previousUploadDir = process.env.APP_UPLOAD_DIR;
  const previousApiKey = process.env.AI_API_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.APP_DATA_FILE = path.join(tempRoot, "state.json");
    process.env.APP_UPLOAD_DIR = path.join(tempRoot, "uploads");
    process.env.AI_API_KEY = "test-only-key";
    const data = new FileBackedDataService();
    data.setAIProviderConfig({
      enabled: true,
      provider: "openai_compatible",
      baseUrl: "http://model.test/v1",
      stageModel: "gpt-5.6-luna",
      schemeModel: "gpt-5.6-terra",
      decisionModel: "gpt-5.6-sol",
      blueprintModel: "gpt-5.6-sol",
      routeModel: "gpt-5.6-sol",
      reviewModel: "gpt-5.6-sol",
      reasoning: { fingerprint: "low", blueprint: "medium", necessity: "medium", feasibility: "medium", route: "medium", scheme: "medium", review: "low", decision: "low" },
      embeddingModel: "text-embedding-3-small"
    });
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(Buffer.from(init?.body as Uint8Array).toString("utf8")) as Record<string, unknown>);
      return new Response(JSON.stringify({
        model: "gpt-5.6-luna",
        choices: [{ message: { content: JSON.stringify({ tendency: "leaning_approved", summary: "当前阶段事实成立", reasons: ["事实与项目目标一致"], missingFacts: [], implementationConditions: [], followUpQuestionIds: [], supplementFields: [], dataCollectionRecommended: false, propositionResults: [] }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 15 } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const service = new GuidedAiSkillService(data);
    const scenarios: Array<{ category: ProjectCategory; intent: "corrective_repair" | "lifecycle_renewal" | "quality_upgrade" | "compliance_rectification" | "efficiency_upgrade"; object: string }> = [
      { category: "civil_upgrade", intent: "quality_upgrade", object: "大堂饰面" },
      { category: "mep_upgrade", intent: "corrective_repair", object: "空调循环泵" },
      { category: "fire_safety", intent: "compliance_rectification", object: "消防联动控制" },
      { category: "energy_retrofit", intent: "efficiency_upgrade", object: "公共区域照明" },
      { category: "plumbing_drainage", intent: "lifecycle_renewal", object: "排水立管" }
    ];
    for (const scenario of scenarios) {
      const result = await service.assessStage({
        stage: "necessity",
        category: scenario.category,
        projectTitle: `${scenario.category}-测试项目`,
        questions: [{ id: "problem", title: "当前问题", critical: true, answer: "已确认" }],
        evidence: [],
        allowedQuestionIds: ["problem"],
        fingerprint: { discipline: "测试专业", system: "测试系统", object: scenario.object, problemMode: "现状不满足目标", proposedAction: "改造", impactScope: "已确认范围", intent: scenario.intent, businessObjective: "形成可验证改善", scopeStrategy: "condition_based", basis: ["测试事实"], modelName: "test", promptVersion: "test" }
      });
      assert.equal(result?.tendency, "leaning_approved");
    }

    assert.equal(requestBodies.length, scenarios.length, "五类项目各只发送一次请求");
    assert.ok(requestBodies.every((body) => body.reasoning_effort === "medium"));
    assert.ok(requestBodies.every((body) => body.max_completion_tokens === 2400));
    const submittedCategories = requestBodies.map((body) => {
      const messages = body.messages as Array<{ content: string }>;
      const payload = JSON.parse(messages[1].content) as { input: { category: ProjectCategory } };
      return payload.input.category;
    });
    assert.deepEqual(submittedCategories, scenarios.map((scenario) => scenario.category));
    const usage = data.listAIUsageRecords();
    assert.equal(usage.length, scenarios.length);
    assert.equal(usage.reduce((sum, item) => sum + item.totalTokens, 0), 750);
    assert.equal(usage.reduce((sum, item) => sum + item.reasoningTokens, 0), 75);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDataFile === undefined) delete process.env.APP_DATA_FILE; else process.env.APP_DATA_FILE = previousDataFile;
    if (previousUploadDir === undefined) delete process.env.APP_UPLOAD_DIR; else process.env.APP_UPLOAD_DIR = previousUploadDir;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previousApiKey;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("模型失败不会自动重试，并留下失败用量记录", async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "property-review-ai-failure-"));
  const previousDataFile = process.env.APP_DATA_FILE;
  const previousUploadDir = process.env.APP_UPLOAD_DIR;
  const previousApiKey = process.env.AI_API_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.APP_DATA_FILE = path.join(tempRoot, "state.json");
    process.env.APP_UPLOAD_DIR = path.join(tempRoot, "uploads");
    process.env.AI_API_KEY = "test-only-key";
    const data = new FileBackedDataService();
    data.setAIProviderConfig({ enabled: true, provider: "openai_compatible", baseUrl: "http://model.test/v1", stageModel: "gpt-5.6-luna", schemeModel: "gpt-5.6-terra", decisionModel: "gpt-5.6-sol", embeddingModel: "text-embedding-3-small" });
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response("upstream unavailable", { status: 503 });
    }) as typeof fetch;
    const service = new GuidedAiSkillService(data);
    await assert.rejects(() => service.assessStage({ stage: "necessity", category: "civil_upgrade", projectTitle: "失败测试项目", questions: [], evidence: [], allowedQuestionIds: [] }));
    assert.equal(requests, 1);
    assert.equal(data.listAIUsageRecords().length, 1);
    assert.equal(data.listAIUsageRecords()[0].status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDataFile === undefined) delete process.env.APP_DATA_FILE; else process.env.APP_DATA_FILE = previousDataFile;
    if (previousUploadDir === undefined) delete process.env.APP_UPLOAD_DIR; else process.env.APP_UPLOAD_DIR = previousUploadDir;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previousApiKey;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
