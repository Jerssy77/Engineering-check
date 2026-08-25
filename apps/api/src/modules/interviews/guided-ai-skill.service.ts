import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { BadGatewayException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  AIUsageOperation,
  DecisionOutcome,
  InterviewAnswerValue,
  LiveDecisionTendency,
  ProjectCategory,
  ProjectIntent,
  ScopeStrategy,
  ItemFingerprint,
  ReviewBlueprint,
  SchemeReview,
  TechnicalRoute,
  SchemeModuleKey,
  StageSupplementField,
  StageDataCollectionTemplate,
  ScopeCalibrationProposal
} from "@property-review/shared";

import { FileBackedDataService } from "../shared/file-backed-data.service";
import { postJson } from "../shared/json-http-client";

type SkillKind = "stage" | "scheme" | "decision" | "blueprint" | "review";

interface SkillCallResult {
  payload: Record<string, unknown>;
  modelName: string;
  promptVersion: string;
}

export interface StageSkillInput {
  stage: "necessity" | "feasibility";
  category: ProjectCategory;
  projectTitle: string;
  questions: Array<{ id: string; title: string; critical: boolean; answer: InterviewAnswerValue }>;
  evidence: Array<{ type: string; fileName: string; mimeType: string }>;
  allowedQuestionIds: string[];
  supplementalFacts?: Array<{ label: string; value: string | number }>;
  blueprint?: ReviewBlueprint;
  fingerprint?: ItemFingerprint;
  declaredScope?: string;
  confirmedScope?: string;
}

export interface StageSkillOutput {
  tendency: LiveDecisionTendency;
  summary: string;
  reasons: string[];
  missingFacts: string[];
  implementationConditions: string[];
  followUpQuestionIds: string[];
  supplementFields: StageSupplementField[];
  dataCollectionRecommended: boolean;
  scopeCalibration?: Omit<ScopeCalibrationProposal, "stage" | "sourceAssessmentId" | "modelName" | "promptVersion" | "createdAt">;
  propositionResults: NonNullable<import("@property-review/shared").StageAssessment["propositionResults"]>;
  modelName: string;
  promptVersion: string;
}

export interface NecessityUnderstandingOutput {
  summary: string;
  facts: string[];
  missingFacts: string[];
  evidenceRequest?: { purpose: string; acceptedTypes: string[]; required: boolean };
  modelName: string;
  promptVersion: string;
}

export interface GeneratedSchemeOption {
  title: string;
  kind: "recommended" | "conditional";
  summary: string;
  applicability: string[];
  tradeoffs: { resolution: string; durability: string; constructionImpact: string; risk: string; costLevel: string };
  modules: SchemeSkillOutput["modules"];
  quantityItems: SchemeSkillOutput["quantityItems"];
}

export interface SchemeSkillInput {
  category: ProjectCategory;
  projectTitle: string;
  facts: Array<{ id: string; title: string; answer: InterviewAnswerValue }>;
  evidence: Array<{ type: string; fileName: string }>;
  assessments: Array<{ stage: string; tendency: LiveDecisionTendency; summary: string; reasons: string[]; implementationConditions?: string[] }>;
  moduleKeys: SchemeModuleKey[];
  fingerprint?: ItemFingerprint;
  blueprint?: ReviewBlueprint;
  reviewDefects?: string[];
}

export interface SchemeSkillOutput {
  modules: Array<{ key: SchemeModuleKey; content: string; basis: string[]; parameters: Array<{ name: string; recommendedValue?: string; allowedRange?: string; confirmationMethod: string; status: "recommended" | "range" | "field_confirm" }> }>;
  quantityItems: Array<{
    itemName: string;
    specification: string;
    unit: string;
    measurementBasis: string;
    sourceModuleKey: SchemeModuleKey;
    referenceUnitPriceLow?: number;
    referenceUnitPriceHigh?: number;
    referencePriceBasis?: string;
  }>;
  modelName: string;
  promptVersion: string;
  alternatives: GeneratedSchemeOption[];
}

export interface DecisionSkillInput {
  category: ProjectCategory;
  projectTitle: string;
  assessments: Array<{ stage: string; tendency: LiveDecisionTendency; summary: string; reasons: string[] }>;
  scheme: Array<{ key: SchemeModuleKey; content: string }>;
  costRows: Array<{ itemName: string; specification: string; unit: string; quantity: number; unitPrice: number; total: number }>;
  budgetAmount: number;
  evidenceTypes: string[];
}

export interface DecisionSkillOutput {
  outcome: DecisionOutcome;
  reasons: string[];
  conditions: string[];
  modelName: string;
  promptVersion: string;
}

export interface V2SchemeOutput extends SchemeSkillOutput {
  routes: TechnicalRoute[];
  review?: SchemeReview;
}

function asStrings(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, limit)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型未返回 JSON 对象");
  return value as Record<string, unknown>;
}

@Injectable()
export class GuidedAiSkillService {
  private readonly inFlight = new Map<string, Promise<SkillCallResult | undefined>>();

  constructor(@Inject(FileBackedDataService) private readonly data: FileBackedDataService) {}

  async identifyItem(input: { category: ProjectCategory; projectTitle: string; facts: Array<{ title: string; answer: InterviewAnswerValue }> }): Promise<ItemFingerprint | undefined> {
    const result = await this.callSkill("compile-review-blueprint", "references/blueprint-contract.md", "stage", "fingerprint", {
      task: "识别工程事项指纹和真实申报动机。必须区分故障整治、生命周期更新、品质形象提升、合规整改、节能提效和扩容升级；不得把以观感、形象统一、品质标准为目标的翻新自动解释为故障整治。判断范围是单体、按状态纳入、统一标准覆盖还是分期计划。",
      outputContract: { discipline: "专业", system: "具体系统", object: "具体对象", problemMode: "问题或业务诉求", proposedAction: "拟采取动作", impactScope: "影响范围", intent: "corrective_repair | lifecycle_renewal | quality_upgrade | compliance_rectification | efficiency_upgrade | capacity_upgrade", businessObjective: "本项目要实现的业务结果", scopeStrategy: "single_object | condition_based | uniform_standard | phased_program", basis: ["输入依据"] },
      input
    });
    if (!result) return undefined;
    const get = (key: string) => typeof result.payload[key] === "string" ? String(result.payload[key]).trim() : "";
    if (!["discipline", "system", "object", "problemMode", "proposedAction", "impactScope", "businessObjective"].every((key) => get(key))) throw new Error("事项指纹不完整");
    const intent = ["corrective_repair", "lifecycle_renewal", "quality_upgrade", "compliance_rectification", "efficiency_upgrade", "capacity_upgrade"].includes(String(result.payload.intent)) ? result.payload.intent as ProjectIntent : "corrective_repair";
    const scopeStrategy = ["single_object", "condition_based", "uniform_standard", "phased_program"].includes(String(result.payload.scopeStrategy)) ? result.payload.scopeStrategy as ScopeStrategy : "condition_based";
    return { discipline: get("discipline"), system: get("system"), object: get("object"), problemMode: get("problemMode"), proposedAction: get("proposedAction"), impactScope: get("impactScope"), intent, businessObjective: get("businessObjective"), scopeStrategy, basis: asStrings(result.payload.basis, 6), modelName: result.modelName, promptVersion: result.promptVersion };
  }

  async compileBlueprint(input: { fingerprint: ItemFingerprint; category: ProjectCategory; projectTitle: string; facts: unknown; reusableBlueprints: ReviewBlueprint[] }): Promise<ReviewBlueprint | undefined> {
    const result = await this.callSkill("compile-review-blueprint", "references/blueprint-contract.md", "blueprint", "blueprint", {
      task: "编译项目专属审查蓝图，并严格分离原则立项、范围策略和实施准备三道门。必要性阶段只允许 principle 与 scope_strategy 命题；重量、接口、净空、材料证明、停机组织和施工参数属于 implementation_readiness，不得用于否定品质提升、生命周期更新等项目的原则立项。品质提升以业务目标、代表性现状、覆盖策略和投资合理性判断，不要求逐台证明故障；统一标准或分期计划可用抽样和类型分组，逐台数量在工程量阶段闭合。",
      outputContract: { summary: "蓝图摘要", propositions: [{ id: "stable_id", stage: "necessity | feasibility", gate: "principle | scope_strategy | implementation_readiness", statement: "可判真的审查命题", requiredFacts: [{ key: "fact_key", label: "所需事实", maturity: "confirmed | measured | documented | estimated | deferred | unknown", impacts: ["necessity | technical_route | selection | safety | quantity | acceptance"] }], passCondition: "通过条件", rejectCondition: "否定条件" }], routeFactors: ["路线选择因子"], candidateRoutes: [{ name: "路线", mechanism: "机理", applicability: ["适用条件"], exclusions: ["排除条件"], criticalParameters: ["关键参数"] }], deferredAllowed: ["允许在方案、工程量或施工前闭合的事实"], antiEvasionTerms: ["只针对当前门槛的规避词"] },
      input
    });
    if (!result) return undefined;
    const propositions = Array.isArray(result.payload.propositions) ? result.payload.propositions.slice(0, 12).flatMap((raw) => {
      const item = asRecord(raw); const stage: "necessity" | "feasibility" | undefined = item.stage === "necessity" ? "necessity" : item.stage === "feasibility" ? "feasibility" : undefined;
      const statement = typeof item.statement === "string" ? item.statement.trim() : "";
      if (!stage || !statement) return [];
      const requiredFacts = Array.isArray(item.requiredFacts) ? item.requiredFacts.slice(0, 6).flatMap((factRaw) => {
        const fact = asRecord(factRaw); const label = typeof fact.label === "string" ? fact.label.trim() : ""; if (!label) return [];
        const maturity = ["confirmed","measured","documented","estimated","deferred","unknown"].includes(String(fact.maturity)) ? fact.maturity as any : "confirmed";
        const impacts = asStrings(fact.impacts, 6).filter((value) => ["necessity","technical_route","selection","safety","quantity","acceptance"].includes(value)) as any;
        return [{ key: typeof fact.key === "string" ? fact.key : `fact_${label.length}`, label, maturity, impacts }];
      }) : [];
      const gate = ["principle", "scope_strategy", "implementation_readiness"].includes(String(item.gate)) ? item.gate as "principle" | "scope_strategy" | "implementation_readiness" : stage === "necessity" ? "principle" : "implementation_readiness";
      return [{ id: typeof item.id === "string" ? item.id : `proposition_${stage}_${Math.random().toString(36).slice(2,7)}`, stage, gate, statement, requiredFacts, passCondition: typeof item.passCondition === "string" ? item.passCondition : "事实支持命题", rejectCondition: typeof item.rejectCondition === "string" ? item.rejectCondition : "事实否定命题" }];
    }) : [];
    if (!propositions.some((item) => item.stage === "necessity") || !propositions.some((item) => item.stage === "feasibility")) throw new Error("蓝图缺少必要性或可行性命题");
    const candidateRoutes = Array.isArray(result.payload.candidateRoutes) ? result.payload.candidateRoutes.slice(0, 4).map((raw) => { const item=asRecord(raw); return { name: String(item.name ?? "").trim(), mechanism: String(item.mechanism ?? "").trim(), applicability: asStrings(item.applicability,5), exclusions: asStrings(item.exclusions,5), criticalParameters: asStrings(item.criticalParameters,6) }; }).filter((item)=>item.name&&item.mechanism) : [];
    return { id: `blueprint_${createHash("sha256").update(JSON.stringify(input.fingerprint)).digest("hex").slice(0,10)}`, version: 1, fingerprintKey: [input.fingerprint.intent,input.fingerprint.scopeStrategy,input.fingerprint.system,input.fingerprint.object,input.fingerprint.problemMode,input.fingerprint.proposedAction].join("|"), summary: String(result.payload.summary ?? "项目专属动态审查蓝图"), propositions, routeFactors: asStrings(result.payload.routeFactors,8), candidateRoutes, deferredAllowed: asStrings(result.payload.deferredAllowed,8), antiEvasionTerms: asStrings(result.payload.antiEvasionTerms,12), modelName: result.modelName, promptVersion: result.promptVersion, createdAt: new Date().toISOString() };
  }

  async understandNecessity(input: StageSkillInput): Promise<NecessityUnderstandingOutput | undefined> {
    const result = await this.callSkill("assess-project-stage", "references/category-judgement.md", "stage", "necessity", {
      task: "根据用户最少输入先复述你对问题的理解；指出下一项最关键缺口，并在需要时提出一种材料请求。不要提前作最终必要性结论。",
      outputContract: {
        summary: "用自然语言复述项目问题、位置和影响",
        facts: ["最多四条已确认事实"],
        missingFacts: ["最多三条最关键未知"],
        evidenceRequest: { purpose: "为什么需要材料", acceptedTypes: ["photo | work_order | inspection | test | complaint | equipment_record | other"], required: "boolean" }
      },
      input
    });
    if (!result) return undefined;
    const summary = typeof result.payload.summary === "string" ? result.payload.summary.trim() : "";
    if (!summary) throw new Error("必要性理解 Skill 缺少事实摘要");
    const request = result.payload.evidenceRequest ? asRecord(result.payload.evidenceRequest) : undefined;
    const allowedEvidence = new Set(["photo", "work_order", "inspection", "test", "complaint", "equipment_record", "other"]);
    const acceptedTypes = request ? asStrings(request.acceptedTypes, 7).filter((item) => allowedEvidence.has(item)) : [];
    return {
      summary,
      facts: asStrings(result.payload.facts, 4),
      missingFacts: asStrings(result.payload.missingFacts, 3),
      evidenceRequest: request && typeof request.purpose === "string" && acceptedTypes.length ? {
        purpose: request.purpose.trim(), acceptedTypes, required: request.required === true
      } : undefined,
      modelName: result.modelName,
      promptVersion: result.promptVersion
    };
  }

  async assessStage(input: StageSkillInput): Promise<StageSkillOutput | undefined> {
    const qualityPrinciple = input.stage === "necessity" && ["quality_upgrade", "lifecycle_renewal"].includes(input.fingerprint?.intent ?? "");
    const stageBlueprint = input.blueprint ? {
      ...input.blueprint,
      propositions: input.blueprint.propositions.filter((item) => item.stage === input.stage && (input.stage !== "necessity" || item.gate !== "implementation_readiness"))
    } : undefined;
    const result = await this.callSkill("assess-project-stage", "references/category-judgement.md", "stage", input.stage, {
      task: input.blueprint ? `严格按当前阶段、当前门槛的命题判断，不得引用已过滤掉的后续实施准备命题。${qualityPrinciple ? "本项目属于品质提升或生命周期更新：观感老旧、品质标准和统一更新目标本身可以成立原则必要性；代表性照片、抽样现状或管理台账足以支持原则立项，不得要求逐台病害、逐台投诉、逐台维修史或逐台安全测量。若采用统一标准或分期计划，逐台对象和精确数量转入工程量阶段。" : "识别影响当前结论的规避表达，真正会改变当前阶段结论的事实未确认时才补充。"} 未闭合但属于重量、接口、净空、材料性能、停机组织、施工测量或专业复核的事项放入 implementationConditions，不得放入 missingFacts。若现有事实只覆盖按状态纳入范围的一部分，优先提出范围校准；品质统一覆盖和分期计划不得仅因证据为抽样而强制缩小范围。已有 confirmedScope 时不得因旧 declaredScope 再次提出相同校准。` : "判断当前阶段并在必要时从允许题目中选择追问；只补充会改变当前阶段结论的事实。",
      outputContract: {
        tendency: "leaning_approved | needs_information | leaning_not_approved",
        summary: "明确结论，一句话",
        reasons: ["最多三条事实或专业依据"],
        missingFacts: ["可执行的缺失事实"],
        implementationConditions: ["不阻断当前阶段、转入方案或施工前闭合的条件"],
        followUpQuestionIds: ["只能来自 allowedQuestionIds；仅用于受控事实映射"],
        supplementFields: [{ id: "英文短标识", label: "直接可填写的问题", inputType: "text | textarea | number | select", placeholder: "简短示例", unit: "可选", required: true, options: [{ value: "选项值", label: "选项名" }] }],
        dataCollectionRecommended: "只有需要多条故障、巡检或多测点/多时段实测数据时为 true；单一事实直接填写为 false",
        scopeCalibration: { required: "现有事实只支持原申报范围的一部分时为true，否则false", declaredScope: "原申报范围", supportedScope: "已有事实支持的可独立审查范围", unsupportedScope: "尚无依据支持的剩余范围", reason: "为何应先校准范围", basis: ["范围差异依据"] },
        propositionResults: [{ propositionId: "蓝图命题ID", status: "established | missing | contradicted", rationale: "事实依据" }]
      },
      input: { ...input, blueprint: stageBlueprint }
    });
    if (!result) return undefined;

    const tendency = result.payload.tendency;
    if (!(["leaning_approved", "needs_information", "leaning_not_approved"] as unknown[]).includes(tendency)) {
      throw new Error("阶段 Skill 返回了非法倾向");
    }
    const allowed = new Set(input.allowedQuestionIds);
    const followUpQuestionIds = asStrings(result.payload.followUpQuestionIds, 3).filter((id) => allowed.has(id));
    const supplementFields = Array.isArray(result.payload.supplementFields)
      ? result.payload.supplementFields.slice(0, 4).flatMap((raw, index) => {
          if (!raw || typeof raw !== "object") return [];
          const field = raw as Record<string, unknown>;
          const label = typeof field.label === "string" ? field.label.trim() : "";
          const inputType = ["text", "textarea", "number", "select"].includes(String(field.inputType)) ? String(field.inputType) as StageSupplementField["inputType"] : "textarea";
          if (!label) return [];
          const options = Array.isArray(field.options) ? field.options.slice(0, 6).flatMap((option) => {
            if (!option || typeof option !== "object") return [];
            const item = option as Record<string, unknown>;
            return typeof item.value === "string" && typeof item.label === "string" ? [{ value: item.value, label: item.label }] : [];
          }) : undefined;
          return [{
            id: typeof field.id === "string" && /^[a-z][a-z0-9_]{1,39}$/i.test(field.id) ? field.id : `fact_${index + 1}`,
            label,
            inputType,
            placeholder: typeof field.placeholder === "string" ? field.placeholder.trim() : undefined,
            unit: typeof field.unit === "string" ? field.unit.trim() : undefined,
            required: field.required !== false,
            options: inputType === "select" && options?.length ? options : undefined
          }];
        })
      : [];
    const summary = typeof result.payload.summary === "string" ? result.payload.summary.trim() : "";
    const reasons = asStrings(result.payload.reasons, 3);
    if (!summary || !reasons.length) throw new Error("阶段 Skill 缺少结论或依据");
    let scopeCalibration: StageSkillOutput["scopeCalibration"];
    if (result.payload.scopeCalibration && typeof result.payload.scopeCalibration === "object") {
      const scope = result.payload.scopeCalibration as Record<string, unknown>;
      if (scope.required === true && typeof scope.declaredScope === "string" && typeof scope.supportedScope === "string" && typeof scope.unsupportedScope === "string" && typeof scope.reason === "string") {
        const declaredScope = scope.declaredScope.trim();
        const supportedScope = scope.supportedScope.trim();
        const unsupportedScope = scope.unsupportedScope.trim();
        const reason = scope.reason.trim();
        if (declaredScope && supportedScope && unsupportedScope && reason && declaredScope !== supportedScope) {
          scopeCalibration = { declaredScope, supportedScope, unsupportedScope, reason, basis: asStrings(scope.basis, 5) };
        }
      }
    }
    return {
      tendency: tendency as LiveDecisionTendency,
      summary,
      reasons,
      missingFacts: asStrings(result.payload.missingFacts, 5),
      implementationConditions: asStrings(result.payload.implementationConditions, 8),
      followUpQuestionIds,
      supplementFields,
      dataCollectionRecommended: !qualityPrinciple && result.payload.dataCollectionRecommended === true,
      scopeCalibration,
      propositionResults: Array.isArray(result.payload.propositionResults) ? result.payload.propositionResults.slice(0, 12).flatMap((raw) => { const item=asRecord(raw); const propositionId=typeof item.propositionId === "string" ? item.propositionId : ""; const status=["established","missing","contradicted"].includes(String(item.status)) ? item.status as "established"|"missing"|"contradicted" : undefined; return propositionId&&status ? [{ propositionId, status, rationale: typeof item.rationale === "string" ? item.rationale.trim() : "" }] : []; }) : [],
      modelName: result.modelName,
      promptVersion: result.promptVersion
    };
  }

  async generateDataCollectionTemplate(input: {
    stage: "necessity" | "feasibility";
    category: ProjectCategory;
    projectTitle: string;
    fingerprint?: ItemFingerprint;
    summary: string;
    missingFacts: string[];
    fields: StageSupplementField[];
  }): Promise<StageDataCollectionTemplate | undefined> {
    const result = await this.callSkill("assess-project-stage", "references/category-judgement.md", "stage", "data_collection", {
      task: "把需要补充的实测或逐条记录信息转成轻量结构化采集表。只收集判断所需数据，不要求照片，不生成自由发挥的报告字段。字段必须有清晰单位和一行一条记录的口径。",
      outputContract: {
        title: "简短采集表名称",
        description: "采集目的，一句话",
        rowLabel: "每行代表什么，如一次故障或一个测点",
        instructions: ["最多四条填写要求"],
        maxRows: 100,
        columns: [{ id: "英文短标识", label: "列名", dataType: "text | number | date | select", unit: "可选", required: true, options: ["仅select填写"] }]
      },
      input
    });
    if (!result) return undefined;
    const title = typeof result.payload.title === "string" ? result.payload.title.trim() : "";
    const description = typeof result.payload.description === "string" ? result.payload.description.trim() : "";
    const rowLabel = typeof result.payload.rowLabel === "string" ? result.payload.rowLabel.trim() : "";
    const columns = Array.isArray(result.payload.columns) ? result.payload.columns.slice(0, 12).flatMap((raw, index) => {
      const column = asRecord(raw);
      const label = typeof column.label === "string" ? column.label.trim() : "";
      if (!label) return [];
      const dataType = ["text", "number", "date", "select"].includes(String(column.dataType)) ? column.dataType as StageDataCollectionTemplate["columns"][number]["dataType"] : "text";
      const options = dataType === "select" ? asStrings(column.options, 10) : undefined;
      return [{
        id: typeof column.id === "string" && /^[a-z][a-z0-9_]{1,39}$/i.test(column.id) ? column.id : `column_${index + 1}`,
        label,
        dataType,
        unit: typeof column.unit === "string" ? column.unit.trim() : undefined,
        required: column.required !== false,
        options: options?.length ? options : undefined
      }];
    }) : [];
    if (!title || !rowLabel || columns.length < 2) throw new Error("数据采集模板字段不足");
    return {
      title,
      description: description || `用于补充${input.stage === "necessity" ? "必要性" : "可行性"}判断所需实测数据`,
      rowLabel,
      instructions: asStrings(result.payload.instructions, 4),
      maxRows: Math.min(200, Math.max(10, Number(result.payload.maxRows) || 100)),
      columns,
      modelName: result.modelName,
      promptVersion: result.promptVersion
    };
  }

  async generateScheme(input: SchemeSkillInput): Promise<SchemeSkillOutput | undefined> {
    const result = await this.callSkill("generate-engineering-scheme", "references/category-scheme.md", "scheme", "scheme", {
      task: "生成主推荐方案和由方案反推的工程量骨架。输入中如有本版本确认工程范围，所有方案模块、备选适用条件和工程量项目必须严格限定在该范围内，并让范围内的对象可逐项计量。阶段判断里的 implementationConditions 必须写入风险措施、样板、施工前复核或验收条件，但不得倒退为必要性补充要求。品质提升或统一标准项目可按代表类型生成清单骨架，精确逐台数量留在工程量确认页闭合。方案必须达到可测量、可询价、可验收的深度：每个模块同时输出关键参数，参数分为建议基准值、允许区间和必须现场确认三类。不得虚构品牌、型号、现场尺寸或法定限值。工程量清单应面向投资估算，只保留决定总投资的核心施工、设备或材料成本项，通常2至5项；测量、样板、保护、一般调试、验收和资料等常规管理动作应并入对应综合单价，不得默认拆项重复计费。只有可能独立发生、对总价影响显著的工作才列条件项。工程量项可依据专业知识给出暂估数量及宽口径含税综合单价参考区间，并写明估算依据；暂估值可由申请人修改，不是供应商报价。",
      outputContract: {
        modules: [{ key: "六个指定 moduleKeys 之一", content: "可执行方案", basis: ["事实依据"], parameters: [{ name: "参数名称", recommendedValue: "有充分专业依据时给建议基准值", allowedRange: "适合用范围表达时填写", confirmationMethod: "如何复核或验收", status: "recommended | range | field_confirm" }] }],
        quantityItems: [{ itemName: "成本项", specification: "可询价规格或待确认边界", unit: "计量单位", measurementBasis: "如何测量", sourceModuleKey: "关联模块", referenceUnitPriceLow: "含税综合单价参考下限，数字", referenceUnitPriceHigh: "含税综合单价参考上限，数字", referencePriceBasis: "地区、时间、材料/人工/机械/管理税费口径及不包含项" }],
        alternatives: [{ title: "条件备选方案", kind: "conditional", summary: "与主方案的实质区别", applicability: ["仅在这些条件成立时可选"], tradeoffs: { resolution: "解决程度", durability: "耐久性", constructionImpact: "施工影响", risk: "风险", costLevel: "成本等级" }, modules: "完整六模块", quantityItems: "对应工程量骨架" }]
      },
      selectionPolicy: "始终明确一个主推荐。只有存在真实技术取舍时才生成1至2个条件备选；信息不足不能用多个方案代替追问。",
      input
    });
    if (!result) return undefined;

    const allowedKeys = new Set(input.moduleKeys);
    const parseParameters = (value: unknown) => Array.isArray(value) ? value.slice(0, 8).flatMap((raw) => {
      const parameter = asRecord(raw);
      const name = typeof parameter.name === "string" ? parameter.name.trim() : "";
      const confirmationMethod = typeof parameter.confirmationMethod === "string" ? parameter.confirmationMethod.trim() : "";
      if (!name || !confirmationMethod) return [];
      const status = ["recommended", "range", "field_confirm"].includes(String(parameter.status))
        ? parameter.status as "recommended" | "range" | "field_confirm"
        : "field_confirm";
      return [{
        name,
        recommendedValue: typeof parameter.recommendedValue === "string" ? parameter.recommendedValue.trim() || undefined : undefined,
        allowedRange: typeof parameter.allowedRange === "string" ? parameter.allowedRange.trim() || undefined : undefined,
        confirmationMethod,
        status
      }];
    }) : [];
    const modules = Array.isArray(result.payload.modules)
      ? result.payload.modules.map(asRecord).map((item) => ({
          key: item.key as SchemeModuleKey,
          content: typeof item.content === "string" ? item.content.trim() : "",
          basis: asStrings(item.basis, 6),
          parameters: parseParameters(item.parameters)
        })).filter((item) => allowedKeys.has(item.key) && item.content)
      : [];
    if (new Set(modules.map((item) => item.key)).size !== input.moduleKeys.length) {
      throw new Error("方案 Skill 未返回完整的六个模块");
    }

    const quantityItems = Array.isArray(result.payload.quantityItems)
      ? result.payload.quantityItems.map(asRecord).map((item) => ({
          itemName: typeof item.itemName === "string" ? item.itemName.trim() : "",
          specification: typeof item.specification === "string" ? item.specification.trim() : "待现场测量/深化",
          unit: typeof item.unit === "string" ? item.unit.trim() : "项",
          measurementBasis: typeof item.measurementBasis === "string" ? item.measurementBasis.trim() : "按现场点位和尺寸复核",
          sourceModuleKey: item.sourceModuleKey as SchemeModuleKey,
          referenceUnitPriceLow: Number(item.referenceUnitPriceLow) > 0 ? Number(item.referenceUnitPriceLow) : undefined,
          referenceUnitPriceHigh: Number(item.referenceUnitPriceHigh) > 0 ? Number(item.referenceUnitPriceHigh) : undefined,
          referencePriceBasis: typeof item.referencePriceBasis === "string" ? item.referencePriceBasis.trim() || undefined : undefined
        })).filter((item) => item.itemName && item.unit && allowedKeys.has(item.sourceModuleKey)).slice(0, 6)
      : [];
    if (!quantityItems.length) throw new Error("方案 Skill 未生成工程量骨架");
    const alternatives = Array.isArray(result.payload.alternatives)
      ? result.payload.alternatives.map(asRecord).map((option) => this.parseSchemeOption(option, allowedKeys, parseParameters)).filter((item): item is GeneratedSchemeOption => Boolean(item)).slice(0, 2)
      : [];
    return { modules, quantityItems, alternatives, modelName: result.modelName, promptVersion: result.promptVersion };
  }

  async reviewScheme(input: { fingerprint: ItemFingerprint; blueprint: ReviewBlueprint; routes: TechnicalRoute[]; modules: Array<{ key: SchemeModuleKey; content: string }>; quantityItems: unknown[]; revision: number }): Promise<SchemeReview | undefined> {
    const result = await this.callSkill("review-engineering-scheme", "references/review-contract.md", "review", "review", {
      task: "作为独立复核方，检查路线是否具体、事实是否支撑、接口和实施是否闭合、工程量是否来源于方案动作、验收是否可验证。不得替方案生成器补写内容。",
      outputContract: { passed: "boolean", summary: "复核结论", defects: [{ code: "defect_code", message: "具体缺陷", severity: "blocking | warning" }] }, input
    });
    if (!result) return undefined;
    const defects = Array.isArray(result.payload.defects) ? result.payload.defects.slice(0, 8).flatMap((raw) => { const item=asRecord(raw); const message=typeof item.message === "string" ? item.message.trim() : ""; return message ? [{ code: typeof item.code === "string" ? item.code : "scheme_defect", message, severity: item.severity === "warning" ? "warning" as const : "blocking" as const }] : []; }) : [];
    return { passed: result.payload.passed === true && !defects.some((item)=>item.severity === "blocking"), revision: input.revision, defects, summary: typeof result.payload.summary === "string" ? result.payload.summary.trim() : "方案独立复核完成", modelName: result.modelName, promptVersion: result.promptVersion, reviewedAt: new Date().toISOString() };
  }

  private parseSchemeOption(value: Record<string, unknown>, allowedKeys: Set<SchemeModuleKey>, parseParameters: (value: unknown) => SchemeSkillOutput["modules"][number]["parameters"]): GeneratedSchemeOption | undefined {
    const modules = Array.isArray(value.modules) ? value.modules.map(asRecord).map((item) => ({
      key: item.key as SchemeModuleKey,
      content: typeof item.content === "string" ? item.content.trim() : "",
      basis: asStrings(item.basis, 6),
      parameters: parseParameters(item.parameters)
    })).filter((item) => allowedKeys.has(item.key) && item.content) : [];
    const quantityItems = Array.isArray(value.quantityItems) ? value.quantityItems.map(asRecord).map((item) => ({
      itemName: typeof item.itemName === "string" ? item.itemName.trim() : "",
      specification: typeof item.specification === "string" ? item.specification.trim() : "待现场测量/深化",
      unit: typeof item.unit === "string" ? item.unit.trim() : "项",
      measurementBasis: typeof item.measurementBasis === "string" ? item.measurementBasis.trim() : "按现场点位和尺寸复核",
      sourceModuleKey: item.sourceModuleKey as SchemeModuleKey,
      referenceUnitPriceLow: Number(item.referenceUnitPriceLow) > 0 ? Number(item.referenceUnitPriceLow) : undefined,
      referenceUnitPriceHigh: Number(item.referenceUnitPriceHigh) > 0 ? Number(item.referenceUnitPriceHigh) : undefined,
      referencePriceBasis: typeof item.referencePriceBasis === "string" ? item.referencePriceBasis.trim() || undefined : undefined
    })).filter((item) => item.itemName && allowedKeys.has(item.sourceModuleKey)) : [];
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!title || new Set(modules.map((item) => item.key)).size !== allowedKeys.size || !quantityItems.length) return undefined;
    const tradeoffs = value.tradeoffs ? asRecord(value.tradeoffs) : {};
    const get = (key: string) => typeof tradeoffs[key] === "string" ? String(tradeoffs[key]).trim() : "待结合现场确认";
    return { title, kind: "conditional", summary: typeof value.summary === "string" ? value.summary.trim() : title, applicability: asStrings(value.applicability, 4), tradeoffs: { resolution: get("resolution"), durability: get("durability"), constructionImpact: get("constructionImpact"), risk: get("risk"), costLevel: get("costLevel") }, modules, quantityItems };
  }

  async decide(input: DecisionSkillInput): Promise<DecisionSkillOutput | undefined> {
    const result = await this.callSkill("assess-project-stage", "references/category-judgement.md", "decision", "decision", {
      task: "综合阶段判断、唯一方案、当前工程量和证据形成最终业务结论；不要套用旧审核报告格式，不使用评分",
      outputContract: {
        outcome: "approved | supplement_required | not_approved",
        reasons: ["最多三条主要依据"],
        conditions: ["仅在需要补充时输出，最多五条"]
      },
      historyPolicy: "未提供历史数据；必须依据当前项目和专业知识独立判断",
      input
    });
    if (!result) return undefined;
    const outcome = result.payload.outcome;
    if (!(["approved", "supplement_required", "not_approved"] as unknown[]).includes(outcome)) {
      throw new Error("决策编排器返回了非法结论");
    }
    const reasons = asStrings(result.payload.reasons, 3);
    if (!reasons.length) throw new Error("决策编排器缺少主要依据");
    return {
      outcome: outcome as DecisionOutcome,
      reasons,
      conditions: outcome === "supplement_required" ? asStrings(result.payload.conditions, 5) : [],
      modelName: result.modelName,
      promptVersion: result.promptVersion
    };
  }

  private async callSkill(
    skillName: "assess-project-stage" | "generate-engineering-scheme" | "compile-review-blueprint" | "review-engineering-scheme",
    referencePath: string,
    kind: SkillKind,
    operation: AIUsageOperation,
    input: unknown
  ): Promise<SkillCallResult | undefined> {
    const config = this.data.getAIProviderConfig();
    if (!config?.enabled || config.provider === "demo") return undefined;
    const apiKey = this.getApiKey();
    if (!apiKey) throw new ServiceUnavailableException("未配置 AI API 密钥");

    const skillText = this.readSkillFile(skillName, "SKILL.md");
    const referenceText = this.readSkillFile(skillName, referencePath);
    const promptVersion = `${skillName}-${createHash("sha256").update(skillText).update(referenceText).digest("hex").slice(0, 10)}`;
    const model = kind === "stage" ? config.stageModel
      : kind === "blueprint" ? config.blueprintModel || config.decisionModel
        : kind === "scheme" ? config.routeModel || config.schemeModel || config.decisionModel
          : kind === "review" ? config.reviewModel || config.decisionModel
            : config.decisionModel;
    const timeout = Math.max(30000, Number(process.env.AI_SKILL_TIMEOUT_MS || 120000));
    const outputBudgets: Record<AIUsageOperation, number> = {
      fingerprint: 1400,
      blueprint: 4500,
      necessity: 2400,
      feasibility: 2400,
      data_collection: 2400,
      scheme: 6500,
      review: 1800,
      decision: 1400,
      connection_test: 400
    };
    const defaultReasoning: Record<AIUsageOperation, "low" | "medium" | "high"> = {
      fingerprint: "low",
      blueprint: "medium",
      necessity: "medium",
      feasibility: "medium",
      data_collection: "low",
      scheme: "medium",
      review: "low",
      decision: "low",
      connection_test: "low"
    };
    const requestPayload = {
      model,
      response_format: { type: "json_object" },
      reasoning_effort: config.reasoning?.[operation === "data_collection" ? "necessity" : operation === "connection_test" ? "decision" : operation] ?? defaultReasoning[operation],
      max_completion_tokens: outputBudgets[operation],
      messages: [
        { role: "system", content: `${skillText}\n\n# 按需参考知识\n${referenceText}\n\n严格只返回 JSON 对象。` },
        { role: "user", content: JSON.stringify(input) }
      ]
    };
    const requestKey = createHash("sha256").update(model).update(promptVersion).update(JSON.stringify(input)).digest("hex");
    const existing = this.inFlight.get(requestKey);
    if (existing) return existing;

    const request = (async (): Promise<SkillCallResult | undefined> => {
      const startedAt = Date.now();
      try {
        const response = await postJson(
          `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
          { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          requestPayload,
          timeout
        );
        if (!response.ok) throw new Error(`上游返回 ${response.status}: ${response.text.slice(0, 500)}`);
        const envelope = asRecord(JSON.parse(response.text));
        const choices = Array.isArray(envelope.choices) ? envelope.choices : [];
        const first = choices.length ? asRecord(choices[0]) : {};
        const message = first.message ? asRecord(first.message) : {};
        const content = typeof message.content === "string" ? message.content : "";
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("模型未返回 JSON 内容");
        this.recordUsage({ operation, model: typeof envelope.model === "string" ? envelope.model : model, input, requestPayload, envelope, durationMs: Date.now() - startedAt });
        return {
          payload: asRecord(JSON.parse(content.slice(start, end + 1))),
          modelName: typeof envelope.model === "string" ? envelope.model : model,
          promptVersion
        };
      } catch (error) {
        this.recordUsage({ operation, model, input, requestPayload, durationMs: Date.now() - startedAt, error });
        throw new BadGatewayException(`AI Skill 调用失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    })();
    this.inFlight.set(requestKey, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(requestKey);
    }
  }

  private recordUsage(options: { operation: AIUsageOperation; model: string; input: unknown; requestPayload: unknown; envelope?: Record<string, unknown>; durationMs: number; error?: unknown }): void {
    const usage = options.envelope?.usage && typeof options.envelope.usage === "object" ? options.envelope.usage as Record<string, unknown> : undefined;
    const promptDetails = usage?.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details as Record<string, unknown> : {};
    const completionDetails = usage?.completion_tokens_details && typeof usage.completion_tokens_details === "object" ? usage.completion_tokens_details as Record<string, unknown> : {};
    const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens) || Math.ceil(JSON.stringify(options.requestPayload).length / 3);
    const outputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens) || 0;
    const totalTokens = Number(usage?.total_tokens) || inputTokens + outputTokens;
    const context = options.input && typeof options.input === "object" ? options.input as Record<string, unknown> : {};
    const nested = context.input && typeof context.input === "object" ? context.input as Record<string, unknown> : context;
    const projectTitle = typeof nested.projectTitle === "string" ? nested.projectTitle : undefined;
    const project = projectTitle ? this.data.listProjects().find((item) => item.title === projectTitle) : undefined;
    const session = project ? this.data.listInterviewSessions(project.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : undefined;
    this.data.addAIUsageRecord({
      projectId: project?.id,
      sessionId: session?.id,
      projectTitle,
      operation: options.operation,
      model: options.model,
      status: options.error ? "failed" : "success",
      inputTokens,
      outputTokens,
      cachedInputTokens: Number(promptDetails.cached_tokens) || 0,
      reasoningTokens: Number(completionDetails.reasoning_tokens) || 0,
      totalTokens,
      usageEstimated: !usage,
      durationMs: options.durationMs,
      error: options.error instanceof Error ? options.error.message.slice(0, 500) : options.error ? String(options.error).slice(0, 500) : undefined,
      createdAt: new Date().toISOString()
    });
  }

  private readSkillFile(skillName: string, relativePath: string): string {
    const roots = [
      process.env.AI_SKILLS_DIR,
      path.resolve(process.cwd(), "apps/api/skills"),
      path.resolve(process.cwd(), "skills")
    ].filter((item): item is string => Boolean(item));
    for (const root of roots) {
      const candidate = path.resolve(root, skillName, relativePath);
      if (candidate.startsWith(path.resolve(root) + path.sep) && existsSync(candidate)) return readFileSync(candidate, "utf8");
    }
    throw new ServiceUnavailableException(`未找到平台 Skill：${skillName}/${relativePath}`);
  }

  private getApiKey(): string | undefined {
    const config = this.data.getAIProviderConfig();
    if (config?.encryptedApiKey && config.apiKeyIv && config.apiKeyTag) {
      const secret = process.env.AI_CONFIG_MASTER_KEY || process.env.APP_SESSION_SECRET;
      if (!secret && process.env.NODE_ENV === "production") throw new ServiceUnavailableException("生产环境未配置 AI_CONFIG_MASTER_KEY");
      const key = createHash("sha256").update(secret || "local-test-ai-config-key-change-before-production").digest();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(config.apiKeyIv, "base64"));
      decipher.setAuthTag(Buffer.from(config.apiKeyTag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(config.encryptedApiKey, "base64")), decipher.final()]).toString("utf8");
    }
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  }
}
