import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit
} from "@nestjs/common";
import {
  AnswerRecord,
  Attachment,
  CostMatrixRow,
  DecisionOutcome,
  DuplicateComparisonRecord,
  EvidenceClaim,
  FormSnapshot,
  HistoricalCostBenchmark,
  InterviewSession,
  InterviewStage,
  InterviewAnswerValue,
  KnowledgeRelease,
  LiveDecisionTendency,
  ProjectAggregate,
  QuestionDefinition,
  ProjectLocationAnswer,
  ScopeSelectionAnswer,
  SchemeModule,
  SchemeModuleKey,
  SchemeOption,
  SessionUser,
  StageAssessment,
  StageDataCollectionTemplate,
  ItemFingerprint,
  ScopeCalibrationProposal,
  SchemeReview,
  calculateSubmissionEligibility,
  createId,
  findDuplicateProjects,
  resolveGuidedApprovalRoute
} from "@property-review/shared";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

import { FileBackedDataService } from "../shared/file-backed-data.service";
import { buildRuleBasedReview } from "../shared/rule-based-review";
import { AnswerInterviewDto } from "./dto/answer-interview.dto";
import { ConfirmSchemeDto } from "./dto/confirm-scheme.dto";
import { ConfirmUnderstandingDto } from "./dto/confirm-understanding.dto";
import { GuidedDecisionDto } from "./dto/guided-decision.dto";
import { LinkEvidenceDto } from "./dto/link-evidence.dto";
import { UpdateKnowledgeReleaseDto } from "./dto/knowledge-release.dto";
import { UpdateInterviewCostsDto } from "./dto/update-costs.dto";
import { SaveAnswerDraftDto } from "./dto/save-answer-draft.dto";
import { SaveStageSupplementDto } from "./dto/stage-supplement.dto";
import { ConfirmFingerprintDto } from "./dto/confirm-fingerprint.dto";
import { ConfirmScopeCalibrationDto } from "./dto/scope-calibration.dto";
import { INTERVIEW_STAGE_ORDER, buildInitialKnowledgeRelease } from "./interview-knowledge";
import { GuidedAiSkillService, SchemeSkillOutput, StageSkillOutput } from "./guided-ai-skill.service";

const PILOT_CATEGORIES = new Set(["civil_upgrade", "mep_upgrade"]);
const STAGE_MODEL = "controlled-interview-assessor";
const STAGE_PROMPT_VERSION = "guided-v1";
const DATA_COLLECTION_MAX_BYTES = 512 * 1024;
const SCHEME_TITLES: Record<SchemeModuleKey, string> = {
  objective: "改造目标",
  scope: "实施范围",
  process: "工艺路径",
  materials: "材料原则",
  risk_controls: "风险与实施措施",
  acceptance: "验收方式"
};

function textValue(answer: AnswerRecord | undefined): string {
  if (answer === undefined) return "";
  if (typeof answer.value === "string" || typeof answer.value === "number") return String(answer.value).trim();
  if (Array.isArray(answer.value)) return answer.value.join(",");
  return JSON.stringify(answer.value);
}

function answerHasValue(answer: AnswerRecord | undefined): boolean {
  if (!answer) return false;
  if (Array.isArray(answer.value)) return answer.value.length > 0;
  if (typeof answer.value === "object") {
    if ("values" in answer.value) return Object.values(answer.value.values).some((value) => String(value ?? "").trim().length > 0);
    return Object.values(answer.value).some((value) => Array.isArray(value) ? value.length > 0 : String(value ?? "").trim().length > 0);
  }
  return String(answer.value).trim().length > 0;
}

function compactAIValue(value: InterviewAnswerValue | string | number): InterviewAnswerValue | string | number {
  if (typeof value !== "string") {
    if (Array.isArray(value)) return value.slice(0, 20);
    if (value && typeof value === "object") {
      const serialized = JSON.stringify(value);
      return serialized.length > 3000 ? `${serialized.slice(0, 2400)}…（结构化内容共${serialized.length}字符，原文已在项目记录中保留）` : value;
    }
    return value;
  }
  const normalized = value.trim();
  if (normalized.length <= 2000) return normalized;
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 4) {
    return `结构化明细共${Math.max(0, lines.length - 1)}条、${normalized.length}字符。表头：${lines[0].slice(0, 500)}。代表记录：${lines.slice(1, 5).join("；").slice(0, 1400)}。完整原文已在项目记录中保留，模型只接收统计摘要。`;
  }
  return `${normalized.slice(0, 1800)}…（原文共${normalized.length}字符，完整内容已在项目记录中保留）`;
}

function answerIsUnknown(answer: AnswerRecord | undefined): boolean {
  if (!answer) return false;
  if (Array.isArray(answer.value)) return answer.value.includes("unknown");
  if (typeof answer.value === "object") return Object.values(answer.value).includes("unknown");
  return answer.value === "unknown";
}

function locationValue(answer: AnswerRecord | undefined): ProjectLocationAnswer | undefined {
  return answer?.value && typeof answer.value === "object" && !Array.isArray(answer.value)
    ? answer.value as ProjectLocationAnswer
    : undefined;
}

function scopeValue(answer: AnswerRecord | undefined): ScopeSelectionAnswer | undefined {
  return answer?.value && typeof answer.value === "object" && !Array.isArray(answer.value)
    ? answer.value as ScopeSelectionAnswer
    : undefined;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.round((ordered.length - 1) * fraction)));
  return roundMoney(ordered[index]);
}

@Injectable()
export class InterviewsService implements OnModuleInit {
  private readonly activeDecisionJobs = new Set<string>();

  constructor(
    @Inject(FileBackedDataService) private readonly data: FileBackedDataService,
    @Inject(GuidedAiSkillService) private readonly guidedAiSkillService: GuidedAiSkillService
  ) {}

  onModuleInit(): void {
    for (const session of this.data.listInterviewSessions().filter((item) => item.status === "assessing")) {
      const version = this.data.getVersion(session.versionId);
      this.scheduleDecision(session, this.data.getSessionUser(version.createdBy));
    }
  }

  getInterview(projectId: string, user: SessionUser) {
    const aggregate = this.getAccessibleAggregate(projectId, user);
    const session = this.ensureSession(aggregate, user);
    this.syncEvidenceClaims(session);
    return this.buildView(session.id, user);
  }

  async confirmFingerprint(projectId: string, user: SessionUser, dto: ConfirmFingerprintDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if ((session.guidedVersion ?? 1) !== 2) throw new BadRequestException("当前项目不是 V2 智能审核");
    const now = new Date().toISOString();
    const fingerprint: ItemFingerprint = {
      discipline: dto.discipline.trim(), system: dto.system.trim(), object: dto.object.trim(), problemMode: dto.problemMode.trim(), proposedAction: dto.proposedAction.trim(), impactScope: dto.impactScope.trim(), intent: dto.intent, businessObjective: dto.businessObjective.trim(), scopeStrategy: dto.scopeStrategy, basis: dto.basis ?? session.fingerprint?.basis ?? [], modelName: session.fingerprint?.modelName ?? "user-confirmed", promptVersion: session.fingerprint?.promptVersion ?? "fingerprint-v2", confirmedAt: now
    };
    const resetsReviewContext = session.fingerprint?.intent !== fingerprint.intent || session.fingerprint?.scopeStrategy !== fingerprint.scopeStrategy;
    this.data.invalidateStageAssessments(session.id, ["necessity", "feasibility", "scheme", "cost", "decision"], now);
    this.data.updateInterviewSession(session.id, (item) => ({ ...item, fingerprint, reviewContextStartedAt: resetsReviewContext ? now : item.reviewContextStartedAt, declaredScope: fingerprint.impactScope, confirmedScope: undefined, scopeCalibration: undefined, stageSupplement: undefined, supplementRound: resetsReviewContext ? {} : item.supplementRound, reviewBlueprint: undefined, status: "blueprint_compiling", nextQuestionId: undefined, updatedAt: now }));
    try {
      const reusableBlueprints = this.data.listInterviewSessions()
        .filter((item) => item.id !== session.id && item.fingerprint?.intent === fingerprint.intent)
        .flatMap((item) => item.reviewBlueprint ? [item.reviewBlueprint] : [])
        .filter((item) => item.fingerprintKey.includes(fingerprint.system) || item.fingerprintKey.includes(fingerprint.object))
        .slice(-3);
      const blueprint = await this.guidedAiSkillService.compileBlueprint({ fingerprint, category: session.category, projectTitle: this.data.getProject(projectId).title, facts: this.v2FactContext(session.id), reusableBlueprints });
      if (!blueprint) throw new Error("AI未生成审查蓝图");
      this.data.updateInterviewSession(session.id, (item) => ({ ...item, reviewBlueprint: blueprint, status: "in_progress", nextQuestionId: this.firstUnansweredQuestion(item), tendencyReasons: ["事项已确认，开始项目专属专业审查"], updatedAt: new Date().toISOString() }));
      await this.advanceInterview(session.id);
    } catch (error) {
      this.data.updateInterviewSession(session.id, (item) => ({ ...item, status: "manual_review", aiFailureReason: error instanceof Error ? error.message : "审查蓝图生成失败", updatedAt: new Date().toISOString() }));
    }
    return this.buildView(session.id, user);
  }

  async answer(projectId: string, user: SessionUser, dto: AnswerInterviewDto) {
    this.ensureSubmitter(user);
    const aggregate = this.getAccessibleAggregate(projectId, user);
    const session = this.ensureSession(aggregate, user);
    if (["assessing", "completed", "manual_review"].includes(session.status)) {
      throw new BadRequestException("当前版本已送审，不能继续修改答案");
    }
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    const question = this.applicableQuestions(release, session.category, this.activeAnswerMap(session.id))
      .find((item) => item.id === dto.questionId);
    if (!question) {
      throw new BadRequestException("该问题不属于当前已发布题库，或其触发条件尚未满足");
    }
    this.validateAnswer(question, dto.value);

    const allAnswers = this.data.listAnswerRecords(session.id);
    const sameRequest = dto.idempotencyKey
      ? allAnswers.find((item) => item.idempotencyKey === dto.idempotencyKey)
      : undefined;
    if (sameRequest) return this.buildView(session.id, user);

    const current = allAnswers.find((item) => item.questionId === question.id && !item.supersededAt);
    if (current && JSON.stringify(current.value) === JSON.stringify(dto.value)) return this.buildView(session.id, user);

    const now = new Date().toISOString();
    if (current) this.data.supersedeAnswerRecord(current.id, now);
    const revision = Math.max(0, ...allAnswers.filter((item) => item.questionId === question.id).map((item) => item.revision)) + 1;
    const answer = this.data.createAnswerRecord({
      sessionId: session.id,
      questionId: question.id,
      value: dto.value,
      revision,
      idempotencyKey: dto.idempotencyKey,
      answeredBy: user.id,
      answeredAt: now
    });

    const invalidatedStages = INTERVIEW_STAGE_ORDER.slice(INTERVIEW_STAGE_ORDER.indexOf(question.stage)) as InterviewStage[];
    this.data.invalidateStageAssessments(session.id, invalidatedStages, now);
    const answersAfter = this.activeAnswerMap(session.id);
    const affected = this.applicableQuestions(release, session.category, answersAfter)
      .filter((item) => INTERVIEW_STAGE_ORDER.indexOf(item.stage) >= INTERVIEW_STAGE_ORDER.indexOf(question.stage))
      .map((item) => item.id);
    const resetsV2Blueprint = (session.guidedVersion ?? 1) === 2
      && ["necessity.problem_summary", "necessity.project_location"].includes(question.id);
    const resetsScope = ["necessity.project_location", "feasibility.scope_components"].includes(question.id);
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      answerIds: [...item.answerIds.filter((id) => id !== current?.id), answer.id],
      answerDraft: item.answerDraft?.questionId === question.id ? undefined : item.answerDraft,
      affectedQuestionIds: affected,
      necessityUnderstanding: ["necessity.problem_summary", "necessity.project_location"].includes(question.id)
        ? undefined
        : question.responseType === "fact_form" && item.necessityUnderstanding
          ? { ...item.necessityUnderstanding, confirmedAt: now }
          : item.necessityUnderstanding,
      schemeModules: current ? [] : item.schemeModules,
      schemeOptions: current ? [] : item.schemeOptions,
      selectedSchemeOptionId: current ? undefined : item.selectedSchemeOptionId,
      schemeSelectionReason: current ? undefined : item.schemeSelectionReason,
      generatedCostRows: current ? [] : item.generatedCostRows,
      costBenchmarks: current ? [] : item.costBenchmarks,
      fingerprint: resetsV2Blueprint ? undefined : item.fingerprint,
      reviewBlueprint: resetsV2Blueprint ? undefined : item.reviewBlueprint,
      declaredScope: resetsScope ? undefined : item.declaredScope,
      confirmedScope: resetsScope ? undefined : item.confirmedScope,
      scopeCalibration: undefined,
      supplementRound: resetsV2Blueprint ? undefined : item.supplementRound,
      technicalRoutes: resetsV2Blueprint ? undefined : item.technicalRoutes,
      schemeReview: resetsV2Blueprint ? undefined : item.schemeReview,
      decisionId: undefined,
      stageSupplement: undefined,
      status: "in_progress",
      updatedAt: now
    }));
    await this.advanceInterview(session.id);
    this.writeFactsToSnapshot(session.id);
    return this.buildView(session.id, user);
  }

  saveAnswerDraft(projectId: string, user: SessionUser, dto: SaveAnswerDraftDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (["assessing", "completed", "manual_review"].includes(session.status)) throw new BadRequestException("当前版本不能继续暂存");
    const question = this.data.getKnowledgeRelease(session.knowledgeReleaseId).questions
      .find((item) => item.id === dto.questionId && item.categories.includes(session.category));
    if (!question) throw new BadRequestException("暂存问题不属于当前题库");
    const savedAt = new Date().toISOString();
    this.data.updateInterviewSession(session.id, (item) => ({ ...item, answerDraft: { questionId: dto.questionId, value: dto.value, savedAt }, updatedAt: savedAt }));
    return { saved: true, savedAt };
  }

  saveStageSupplementDraft(projectId: string, user: SessionUser, dto: SaveStageSupplementDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (session.status !== "stage_supplement" || !session.stageSupplement) throw new BadRequestException("当前没有需要暂存的阶段补充信息");
    const savedAt = new Date().toISOString();
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      stageSupplement: item.stageSupplement ? { ...item.stageSupplement, draftValues: dto.values } : undefined,
      updatedAt: savedAt
    }));
    return { saved: true, savedAt };
  }

  async submitStageSupplement(projectId: string, user: SessionUser, dto: SaveStageSupplementDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    const supplement = session.stageSupplement;
    if (session.status !== "stage_supplement" || !supplement) throw new BadRequestException("当前没有需要提交的阶段补充信息");
    const missingRequired = supplement.fields.filter((field) => field.required && !String(dto.values[field.id] ?? "").trim());
    if (missingRequired.length) throw new BadRequestException(`请补充：${missingRequired.map((field) => field.label).join("、")}`);
    const now = new Date().toISOString();
    this.data.invalidateStageAssessments(session.id, [supplement.stage, "scheme", "cost", "decision"], now);
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      stageSupplementFacts: [...(item.stageSupplementFacts ?? []), {
        stage: supplement.stage,
        assessmentId: item.assessmentIds[item.assessmentIds.length - 1] ?? "",
        values: dto.values,
        labels: Object.fromEntries(supplement.fields.map((field) => [field.id, field.label])),
        submittedAt: now
      }],
      supplementRound: { ...(item.supplementRound ?? {}), [supplement.stage]: (item.supplementRound?.[supplement.stage] ?? 0) + 1 },
      stageSupplement: undefined,
      status: "in_progress",
      nextQuestionId: undefined,
      updatedAt: now
    }));
    await this.advanceInterview(session.id);
    return this.buildView(session.id, user);
  }

  async downloadStageDataCollectionTemplate(projectId: string, user: SessionUser): Promise<{ buffer: Buffer; fileName: string }> {
    this.ensureSubmitter(user);
    let session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    const supplement = session.stageSupplement;
    if (session.status !== "stage_supplement" || !supplement) throw new BadRequestException("当前没有需要采集的补充数据");

    let template = supplement.dataCollection;
    if (!template) {
      try {
        template = await this.guidedAiSkillService.generateDataCollectionTemplate({
          stage: supplement.stage,
          category: session.category,
          projectTitle: this.data.getProject(projectId).title,
          fingerprint: session.fingerprint,
          summary: supplement.summary,
          missingFacts: supplement.missingFacts,
          fields: supplement.fields
        });
      } catch {
        template = undefined;
      }
      if (!template) template = this.fallbackDataCollectionTemplate(supplement);
      this.data.updateInterviewSession(session.id, (item) => ({
        ...item,
        stageSupplement: item.stageSupplement ? { ...item.stageSupplement, dataCollection: template } : undefined,
        updatedAt: new Date().toISOString()
      }));
      session = this.data.getInterviewSession(session.id);
    }

    const workbook = this.buildDataCollectionWorkbook(this.data.getProject(projectId).title, template);
    const output = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
    return { buffer, fileName: `${this.safeDownloadName(template.title)}.xlsx` };
  }

  async uploadStageDataCollection(projectId: string, user: SessionUser, file?: Express.Multer.File) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    const supplement = session.stageSupplement;
    if (session.status !== "stage_supplement" || !supplement?.dataCollection) throw new BadRequestException("请先下载当前补充任务的数据采集表");
    if (!file?.buffer?.length) throw new BadRequestException("请选择填写完成的 Excel 文件");
    if (file.size > DATA_COLLECTION_MAX_BYTES) throw new BadRequestException("实测数据表不能超过 512 KB；请删除图片、截图和无关工作表后重试");
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException("只接受系统生成的 .xlsx 数据采集表");

    const rows = await this.parseDataCollectionWorkbook(file.buffer, supplement.dataCollection);
    if (!rows.length) throw new BadRequestException("数据采集表中没有可提交的记录");
    const requiredColumns = supplement.dataCollection.columns.filter((column) => column.required);
    const incomplete = rows.findIndex((row) => requiredColumns.some((column) => !String(row[column.id] ?? "").trim()));
    if (incomplete >= 0) throw new BadRequestException(`第 ${incomplete + 1} 条记录缺少必填数据`);

    const now = new Date().toISOString();
    this.data.invalidateStageAssessments(session.id, [supplement.stage, "scheme", "cost", "decision"], now);
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      stageSupplementFacts: [...(item.stageSupplementFacts ?? []), {
        stage: supplement.stage,
        assessmentId: item.assessmentIds[item.assessmentIds.length - 1] ?? "",
        values: { structured_collection: JSON.stringify(rows) },
        labels: { structured_collection: `${supplement.dataCollection?.title ?? "实测数据"}（${rows.length}条）` },
        submittedAt: now
      }],
      supplementRound: { ...(item.supplementRound ?? {}), [supplement.stage]: (item.supplementRound?.[supplement.stage] ?? 0) + 1 },
      stageSupplement: undefined,
      status: "in_progress",
      nextQuestionId: undefined,
      updatedAt: now
    }));
    await this.advanceInterview(session.id);
    return this.buildView(session.id, user);
  }

  async confirmScopeCalibration(projectId: string, user: SessionUser, dto: ConfirmScopeCalibrationDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    const proposal = session.scopeCalibration;
    if (session.status !== "scope_confirmation" || !proposal) {
      throw new BadRequestException("当前没有需要确认的工程范围");
    }

    const correctedScope = dto.correctedScope?.trim();
    if (dto.action === "correct_supported" && !correctedScope) {
      throw new BadRequestException("请填写修正后的工程范围");
    }
    const confirmedScope = dto.action === "adopt_supported"
      ? proposal.supportedScope
      : dto.action === "correct_supported"
        ? correctedScope!
        : proposal.declaredScope;
    const now = new Date().toISOString();
    const record = {
      ...proposal,
      action: dto.action,
      confirmedScope,
      comment: dto.comment?.trim() || undefined,
      confirmedBy: user.id,
      confirmedAt: now
    } as const;

    if (dto.action === "keep_declared") {
      const assessment = this.data.listStageAssessments(session.id)
        .find((item) => item.id === proposal.sourceAssessmentId && !item.invalidatedAt)
        ?? this.data.listStageAssessments(session.id).find((item) => item.stage === proposal.stage && !item.invalidatedAt);
      if (!assessment) throw new BadRequestException("范围判断已失效，请重新发起判断");
      const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
      const questions = this.applicableQuestions(release, session.category, this.activeAnswerMap(session.id)).filter((item) => item.stage === proposal.stage);
      this.data.updateInterviewSession(session.id, (item) => {
        const supplement = this.buildStageSupplement(item, assessment, questions, []);
        if (!supplement.fields.some((field) => field.label.includes(proposal.unsupportedScope))) {
          supplement.fields = [{
            id: "unsupported_scope_facts",
            label: `请补充“${proposal.unsupportedScope}”对应的问题、数量或位置明细`,
            inputType: "textarea" as const,
            placeholder: "只填写尚未覆盖范围的实际情况；如确实不在本次实施范围，请返回选择缩小范围",
            required: true
          }, ...supplement.fields].slice(0, 4);
        }
        return ({
        ...item,
        confirmedScope,
        scopeCalibration: undefined,
        scopeCalibrationHistory: [...(item.scopeCalibrationHistory ?? []), record],
        status: "stage_supplement",
        stageSupplement: supplement,
        tendency: "needs_information",
        tendencyReasons: ["保留原申报范围，继续补充尚未覆盖部分的事实"],
        updatedAt: now
      }); });
      return this.buildView(session.id, user);
    }

    this.data.invalidateStageAssessments(session.id, INTERVIEW_STAGE_ORDER.slice(INTERVIEW_STAGE_ORDER.indexOf(proposal.stage)), now);
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      declaredScope: item.declaredScope || proposal.declaredScope,
      confirmedScope,
      scopeCalibration: undefined,
      scopeCalibrationHistory: [...(item.scopeCalibrationHistory ?? []), record],
      fingerprint: item.fingerprint ? { ...item.fingerprint, impactScope: confirmedScope, confirmedAt: now } : item.fingerprint,
      supplementRound: { ...(item.supplementRound ?? {}), [proposal.stage]: 0 },
      stageSupplement: undefined,
      status: "in_progress",
      nextQuestionId: undefined,
      updatedAt: now
    }));
    await this.advanceInterview(session.id);
    this.writeFactsToSnapshot(session.id);
    return this.buildView(session.id, user);
  }

  async reassess(projectId: string, user: SessionUser) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (session.status !== "manual_review" || session.decisionId) {
      throw new BadRequestException("当前版本不需要重新判断");
    }
    const stage = session.stage === "feasibility" ? "feasibility" : "necessity";
    const now = new Date().toISOString();
    const answers = this.activeAnswerMap(session.id);
    this.data.invalidateStageAssessments(session.id, INTERVIEW_STAGE_ORDER.slice(INTERVIEW_STAGE_ORDER.indexOf(stage)), now);
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      status: "in_progress",
      tendency: "needs_information",
      tendencyReasons: ["按当前已填事实重新进行专业判断"],
      declaredScope: item.declaredScope || this.resolveDeclaredScope(item, answers),
      confirmedScope: undefined,
      scopeCalibration: undefined,
      stageSupplement: undefined,
      supplementRound: { ...(item.supplementRound ?? {}), [stage]: 0 },
      nextQuestionId: undefined,
      aiFailureReason: undefined,
      updatedAt: now
    }));
    await this.advanceInterview(session.id);
    return this.buildView(session.id, user);
  }

  async regenerateScheme(projectId: string, user: SessionUser) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (session.decisionId || !["scheme_confirmation", "cost_confirmation"].includes(session.status)) {
      throw new BadRequestException("当前版本不能重新生成施工方案");
    }
    const answers = this.activeAnswerMap(session.id);
    const upstreamRecentlyUnavailable = /network socket|TLS connection|ECONNRESET|ETIMEDOUT|上游请求超过|连接中断/i.test(session.aiFailureReason ?? "");
    const generatedByModel = upstreamRecentlyUnavailable ? undefined : await this.generateScheme(session, answers, [
      "施工方案需要补充结构化关键参数：建议基准值、允许区间和现场确认方式。",
      "工程量项需要给出可询价规格，并在无历史样本时给出AI市场知识参考价区间及估算口径。"
    ]);
    const generated = generatedByModel ?? this.enrichExistingSchemeWithKnowledge(session);
    const routes = this.routesFromScheme(session, generated.options);
    const review = generatedByModel
      ? this.validateGeneratedScheme(generated, (session.schemeReview?.revision ?? 0) + 1)
      : session.schemeReview;
    const now = new Date().toISOString();
    const benchmarks = generated.costRows.map((row) => this.buildBenchmark(session, row));
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      stage: "scheme",
      status: "scheme_confirmation",
      schemeModules: generated.modules,
      schemeOptions: generated.options,
      selectedSchemeOptionId: generated.options.find((option) => option.kind === "recommended")?.id,
      generatedCostRows: generated.costRows,
      costBenchmarks: benchmarks,
      technicalRoutes: routes,
      schemeReview: review ? { ...review, passed: review.passed || generatedByModel === undefined, summary: generatedByModel ? review.summary : "模型连接中断，已使用受控专业知识补充参数与参考价；原技术路线保持不变。" } : session.schemeReview,
      aiFailureReason: generatedByModel ? undefined : item.aiFailureReason,
      updatedAt: now
    }));
    this.data.addAuditLog({ actorId: user.id, projectId, versionId: session.versionId, action: "guided_scheme_regenerated", detail: "已按参数化方案与市场参考价口径重新深化施工方案。", createdAt: now });
    return this.buildView(session.id, user);
  }

  private enrichExistingSchemeWithKnowledge(session: InterviewSession): { modules: SchemeModule[]; costRows: CostMatrixRow[]; options: SchemeOption[] } {
    const elevatorCabin = /电梯|轿厢/.test(`${this.data.getProject(session.projectId).title} ${session.fingerprint?.object ?? ""}`);
    const parametersByModule: Partial<Record<SchemeModuleKey, SchemeModule["parameters"]>> = elevatorCabin ? {
      objective: [
        { name: "统一观感标准", recommendedValue: "同批次同色号、同纹理方向、同收口做法", confirmationMethod: "首件样板签认并作为逐台验收基准", status: "recommended" },
        { name: "功能改造边界", recommendedValue: "不改变控制、曳引、门机及安全回路", confirmationMethod: "施工图与电梯专业会签", status: "recommended" }
      ],
      scope: [
        { name: "计量分组", recommendedValue: "按轿厢尺寸、基层材质、接口形式和处置路线分组", confirmationMethod: "资产台账与代表类型测量表核对", status: "recommended" },
        { name: "精确台数与展开面积", confirmationMethod: "逐台测量后在工程量页闭合", status: "field_confirm" }
      ],
      process: [
        { name: "首件样板", recommendedValue: "每种主要构造类型至少1台", confirmationMethod: "样板验收记录", status: "recommended" },
        { name: "基层处置分级", recommendedValue: "保留修复／保留覆装／局部拆换", confirmationMethod: "拆除或探查后逐台记录", status: "recommended" },
        { name: "单台停梯窗口", allowedRange: "结合现场客流和工艺由施工组织确定", confirmationMethod: "施工单位排程并由运营确认", status: "field_confirm" }
      ],
      materials: [
        { name: "饰面材料", recommendedValue: "304发纹或抗指纹不锈钢等薄型轻量化体系", confirmationMethod: "样板、材质证明和供应商深化图确认", status: "recommended" },
        { name: "面板厚度", allowedRange: "建议以供应商体系及电梯专业复核为准；涉及整板更换时可按≥1.2mm询价比选", confirmationMethod: "实物测厚、材料证明及重量复核", status: "range" },
        { name: "新增重量及分布", confirmationMethod: "逐台称重计算并由原厂或电梯专业复核", status: "field_confirm" },
        { name: "完成面净空及门区间隙", confirmationMethod: "施工前实测，样板完成后复测无干涉", status: "field_confirm" }
      ],
      risk_controls: [
        { name: "设备保护范围", recommendedValue: "轿门、操纵盘、显示器、扶手、通风口、照明和检修口", confirmationMethod: "开工前检查表与完工复验", status: "recommended" },
        { name: "恢复运行条件", recommendedValue: "门体无干涉、安全装置与检修口功能不受影响", confirmationMethod: "电梯专业逐台复验并签认", status: "recommended" }
      ],
      acceptance: [
        { name: "观感", recommendedValue: "同批无明显色差、翘边、松动、锐边及污染", confirmationMethod: "在正常照明和约1.5m观察距离下检查", status: "recommended" },
        { name: "功能", recommendedValue: "门体、操纵、显示、通风、照明和检修功能正常", confirmationMethod: "逐台运行复验", status: "recommended" },
        { name: "资料", recommendedValue: "材料证明、重量复核、隐蔽记录、样板签认和逐台验收记录齐全", confirmationMethod: "交付资料清单核验", status: "recommended" }
      ]
    } : {};
    const modules = session.schemeModules.map((module) => ({
      ...module,
      parameters: module.parameters?.length ? module.parameters : parametersByModule[module.key] ?? [],
      modelName: "controlled-engineering-knowledge"
    }));
    const ranges: Array<{ pattern: RegExp; low: number; high: number; basis: string }> = [
      { pattern: /调查|测量/, low: 300, high: 800, basis: "2026年国内一般城市、单台、含税综合估算，含现场测量和类型归档，不含第三方检测。" },
      { pattern: /样板/, low: 3000, high: 8000, basis: "2026年国内一般城市、每项/每代表类型、含税综合估算，按可转入正式施工的首件计。" },
      { pattern: /拆除|清运/, low: 80, high: 180, basis: "2026年国内一般城市、每平方米、含税综合估算，含人工拆除和场内清运，不含危险废物。" },
      { pattern: /壁板拆换/, low: 800, high: 1800, basis: "2026年国内一般城市、每平方米、含税综合估算，按局部壁板制作安装，不含控制及门机改造。" },
      { pattern: /除锈|修补|基层/, low: 120, high: 300, basis: "2026年国内一般城市、每平方米、含税综合估算，按一般表层锈蚀与局部找平；穿透腐蚀另计。" },
      { pattern: /饰面系统|装饰板/, low: 900, high: 1800, basis: "2026年国内一般城市、每平方米、含税综合估算，按薄型不锈钢或同级模块化饰面、辅材和安装；品牌与特殊纹理另询。" },
      { pattern: /收边/, low: 120, high: 300, basis: "2026年国内一般城市、每米、含税综合估算，按设备开口及阴阳角定制收口。" },
      { pattern: /重量|净空|专业.*复核/, low: 500, high: 1200, basis: "2026年国内一般城市、每台、含税综合估算，按电梯专业配合复核，不含政府监督检验费。" },
      { pattern: /停梯|设备保护|恢复运行/, low: 800, high: 2000, basis: "2026年国内一般城市、每台、含税综合估算，含一般保护和恢复配合；夜间及特殊保障另计。" },
      { pattern: /验收|归档/, low: 200, high: 600, basis: "2026年国内一般城市、每台、含税综合估算，含逐台检查和一般资料整理。" }
    ];
    const detailedCostRows = session.generatedCostRows.map((row) => {
      const match = ranges.find((item) => item.pattern.test(row.itemName));
      return match ? { ...row, referenceUnitPriceLow: match.low, referenceUnitPriceHigh: match.high, referencePriceBasis: match.basis, referencePriceAsOf: "2026-08-13" } : row;
    });
    const costRows: CostMatrixRow[] = elevatorCabin ? this.buildElevatorCoreEstimate(session) : detailedCostRows;
    const updateOption = (option: SchemeOption): SchemeOption => ({
      ...option,
      modules: option.id === session.selectedSchemeOptionId || option.kind === "recommended" ? modules : option.modules,
      costRows: option.id === session.selectedSchemeOptionId || option.kind === "recommended" ? costRows : option.costRows
    });
    return { modules, costRows, options: (session.schemeOptions ?? [this.defaultSchemeOption(modules, costRows)]).map(updateOption) };
  }

  private buildElevatorCoreEstimate(session: InterviewSession): CostMatrixRow[] {
    const submittedCollections = (session.stageSupplementFacts ?? [])
      .map((fact) => fact.values.structured_collection)
      .filter((value): value is string => typeof value === "string" && value.trim().startsWith("["))
      .map((value) => {
        try { return JSON.parse(value) as Array<Record<string, unknown>>; } catch { return []; }
      });
    const collectionCabinCounts = submittedCollections.map((collection) => new Set(collection.map((item) => [item.project_name, item.building_name ?? item.building_no, item.elevator_no].map((value) => String(value ?? "").trim()).join("|")).filter((key) => key !== "||")).size).filter((count) => count > 0);
    const estimatedCabins = collectionCabinCounts.length ? Math.min(200, Math.min(...collectionCabinCounts)) : 10;
    const estimatedWallAreaPerCabin = 14;
    const coreLow = 15000;
    const coreHigh = 26000;
    const coreMid = 20500;
    const conditionalReplacementArea = roundMoney(estimatedCabins * estimatedWallAreaPerCabin * 0.1);
    return [
      {
        id: createId("cost"), type: "engineering", itemName: "电梯轿厢内饰综合翻新", specification: "按约14㎡/台暂估；含测量、首件样板、既有饰面拆除、一般基层处理、薄型轻量化饰面、收边、设备保护、停梯配合、恢复运行及验收", unit: "台",
        quantity: estimatedCabins, unitPrice: coreMid, remark: "核心综合价；已合并管理动作和常规配合费用，申请人可按实际台数及询价修改。",
        referenceUnitPriceLow: coreLow, referenceUnitPriceHigh: coreHigh, referencePriceBasis: "2026年国内一般城市、标准客梯轿厢、含税综合估算；按约14㎡内壁展开面积和一般基层条件测算，不含控制、曳引、门机改造及大面积结构性壁板更换。", referencePriceAsOf: "2026-08-13", estimateSource: "ai_knowledge", estimateAssumption: `根据已提交逐台记录去重暂估${estimatedCabins}台；每台内壁展开面积暂按${estimatedWallAreaPerCabin}㎡。`
      },
      {
        id: createId("cost"), type: "engineering", itemName: "严重失效壁板条件更换", specification: "仅发生穿孔、严重变形、连接失效或基层不可保留时计取；未发生可删除或数量改为0", unit: "平方米",
        quantity: conditionalReplacementArea, unitPrice: 1300, remark: "条件项；暂按总展开面积10%预留，避免把全部轿厢按整板更换计价。",
        referenceUnitPriceLow: 800, referenceUnitPriceHigh: 1800, referencePriceBasis: "2026年国内一般城市、含税综合估算，含局部壁板制作安装及与饰面体系衔接，不含电梯功能系统改造。", referencePriceAsOf: "2026-08-13", estimateSource: "ai_knowledge", estimateAssumption: `暂按${estimatedCabins}台×${estimatedWallAreaPerCabin}㎡/台×10%条件发生率。`
      }
    ];
  }

  async linkEvidence(projectId: string, user: SessionUser, dto: LinkEvidenceDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (["assessing", "completed", "manual_review"].includes(session.status)) {
      throw new BadRequestException("当前版本已送审，不能继续关联材料");
    }
    const attachment = this.data.getAttachment(dto.attachmentId);
    if (attachment.projectId !== projectId || attachment.versionId !== session.versionId) {
      throw new BadRequestException("只能关联当前项目版本的材料");
    }
    if (dto.evidenceType === "photo" && attachment.kind !== "image") {
      throw new BadRequestException("现场照片类型只能关联图片文件");
    }
    const existing = this.data.listEvidenceClaims(session.id)
      .find((claim) => claim.attachmentIds.includes(attachment.id));
    const claim = existing
      ? this.data.updateEvidenceClaim(existing.id, (item) => ({ ...item, evidenceType: dto.evidenceType }))
      : this.data.createEvidenceClaim({
          sessionId: session.id,
          factKey: "problem_exists",
          attachmentIds: [attachment.id],
          evidenceType: dto.evidenceType,
          confirmedBy: user.id,
          confirmedAt: new Date().toISOString()
        });
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      evidenceClaimIds: [...new Set([...item.evidenceClaimIds, claim.id])],
      updatedAt: new Date().toISOString()
    }));
    this.data.invalidateStageAssessments(session.id, ["necessity", "feasibility", "scheme", "cost", "decision"], new Date().toISOString());
    if (session.status !== "stage_confirmation") await this.advanceInterview(session.id);
    return this.buildView(session.id, user);
  }

  async confirmUnderstanding(projectId: string, user: SessionUser, dto: ConfirmUnderstandingDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (!session.necessityUnderstanding) throw new BadRequestException("当前还没有可确认的AI理解");
    const now = new Date().toISOString();
    if (dto.action === "disagree" && !dto.comment?.trim()) throw new BadRequestException("请简要说明哪项理解不准确");
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      necessityUnderstanding: dto.action === "confirm" ? {
        ...item.necessityUnderstanding!,
        confirmedAt: now,
        disagreement: undefined
      } : undefined,
      status: "in_progress",
      nextQuestionId: dto.action === "disagree" ? "necessity.problem_summary" : item.necessityUnderstanding?.followUpQuestionId ?? item.nextQuestionId,
      tendencyReasons: dto.action === "disagree" ? ["请修改问题描述，AI将重新理解"] : item.tendencyReasons,
      updatedAt: now
    }));
    return this.buildView(session.id, user);
  }

  confirmScheme(projectId: string, user: SessionUser, dto: ConfirmSchemeDto) {
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (session.status === "assessing") throw new BadRequestException("系统正在形成最终结论，当前不能修改方案");
    if (!session.schemeModules.length) throw new BadRequestException("请先完成必要性和可行性访谈");
    const options = session.schemeOptions ?? [];
    const selectedOptionId = dto.selectedOptionId ?? session.selectedSchemeOptionId ?? options.find((item) => item.kind === "recommended")?.id;
    const selectedOption = options.find((item) => item.id === selectedOptionId);
    if (selectedOption?.kind === "conditional" && !dto.selectionReason?.trim() && selectedOptionId !== session.selectedSchemeOptionId) {
      throw new BadRequestException("选择条件备选方案时必须说明原因或新的现场约束");
    }
    const baseModules = selectedOption?.modules ?? session.schemeModules;
    const edits = new Map(dto.modules.map((item) => [item.key, item]));
    const now = new Date().toISOString();
    const modules = baseModules.map((module) => {
      const edit = edits.get(module.key);
      const changed = Boolean(edit?.content?.trim() && edit.content.trim() !== module.content);
      if (changed && !edit?.editReason?.trim()) throw new BadRequestException(`修改“${module.title}”时必须说明原因`);
      return {
        ...module,
        content: edit?.content?.trim() || module.content,
        confirmed: true,
        editedBy: changed ? user.id : module.editedBy,
        editReason: changed ? edit?.editReason?.trim() : module.editReason,
        updatedAt: now
      };
    });
    if (session.decisionId) {
      if (user.role === "submitter") throw new ForbiddenException("项目送审后只能由审核人或管理员修改方案");
      this.data.updateInterviewSession(session.id, (item) => ({ ...item, schemeModules: modules, updatedAt: now }));
      this.writeSchemeToSnapshot(session.id);
      this.data.addAuditLog({
        actorId: user.id,
        projectId,
        versionId: session.versionId,
        action: "guided_scheme_overridden",
        detail: `审核人修改方案模块：${modules.filter((module) => module.editedBy === user.id).map((module) => module.title).join("、")}`,
        createdAt: now
      });
      return this.buildView(session.id, user);
    }
    this.ensureSubmitter(user);
    const rows = selectedOption?.costRows ?? (session.generatedCostRows.length ? session.generatedCostRows : this.buildCostSkeleton(session));
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      stage: "cost",
      status: "cost_confirmation",
      tendency: "leaning_approved",
      tendencyReasons: ["必要性和可行性信息已闭合", "唯一推荐方案已确认"],
      schemeModules: modules,
      schemeOptions: options,
      selectedSchemeOptionId: selectedOptionId,
      schemeSelectionReason: selectedOption?.kind === "conditional" ? dto.selectionReason?.trim() : undefined,
      generatedCostRows: rows,
      affectedQuestionIds: [],
      updatedAt: now
    }));
    this.writeSchemeToSnapshot(session.id);
    return this.buildView(session.id, user);
  }

  updateCosts(projectId: string, user: SessionUser, dto: UpdateInterviewCostsDto) {
    this.ensureSubmitter(user);
    const session = this.ensureSession(this.getAccessibleAggregate(projectId, user), user);
    if (["assessing", "completed", "manual_review"].includes(session.status) || session.decisionId) {
      throw new BadRequestException("项目已进入决策流程，当前不能修改成本清单");
    }
    if (!session.schemeModules.every((item) => item.confirmed)) throw new BadRequestException("请先确认推荐方案");
    const rows = dto.rows.map((row) => ({
      ...row,
      id: row.id || createId("cost"),
      type: row.type === "other_fee" ? "other_fee" as const : "engineering" as const,
      itemName: String(row.itemName ?? "").trim(),
      specification: String(row.specification ?? "").trim(),
      unit: String(row.unit ?? "").trim(),
      quantity: Number(row.quantity),
      unitPrice: Number(row.unitPrice),
      remark: String(row.remark ?? "").trim()
    }));
    if (!rows.length || rows.some((row) => !row.itemName || !row.unit || row.quantity <= 0 || row.unitPrice <= 0)) {
      throw new BadRequestException("工程量、单位、数量和单价必须填写完整且为正数");
    }
    const calculated = roundMoney(rows.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0));
    if (roundMoney(dto.declaredBudget) !== calculated) {
      throw new BadRequestException(`申报预算必须与清单合价一致，当前清单合计为 ${calculated} 元`);
    }
    const now = new Date().toISOString();
    const benchmarks = rows.map((row) => this.buildBenchmark(session, row));
    this.data.updateInterviewSession(session.id, (item) => ({
      ...item,
      stage: "decision",
      status: "ready_to_submit",
      tendency: "leaning_approved",
      tendencyReasons: ["必要事实、方案和预算已闭合", "可以发起最终送审"],
      generatedCostRows: rows,
      costBenchmarks: benchmarks,
      updatedAt: now
    }));
    this.data.updateVersion(session.versionId, (version) => ({
      ...version,
      snapshot: { ...version.snapshot, budgetAmount: calculated, costInputMode: "online", costMatrixRows: rows }
    }));
    this.createAssessment(session.id, "cost", "leaning_approved", "工程量清单与申报预算闭合", ["所有成本项均包含数量、单位、单价和合价"], []);
    return this.buildView(session.id, user);
  }

  submit(projectId: string, user: SessionUser) {
    this.ensureSubmitter(user);
    const aggregate = this.getAccessibleAggregate(projectId, user);
    const session = this.ensureSession(aggregate, user);
    this.syncEvidenceClaims(session);
    const refreshed = this.data.getInterviewSession(session.id);
    const hardGaps = this.validateHardGates(refreshed);
    if (hardGaps.length) throw new BadRequestException(hardGaps.join("；"));
    const eligibility = this.eligibility(aggregate);
    if (!eligibility.allowed) {
      throw new BadRequestException(eligibility.reason === "weekly_quota_reached" ? "本周最终送审额度已用完" : "当前处于再次送审冷却期或已送审状态");
    }

    const now = new Date().toISOString();
    this.data.addQuotaUsage({
      organizationId: aggregate.project.organizationId,
      projectId,
      versionId: refreshed.versionId,
      consumedAt: now
    });
    if (eligibility.availableOverrideId) this.data.markOverrideUsed(eligibility.availableOverrideId, now);
    this.data.updateInterviewSession(refreshed.id, (item) => ({ ...item, status: "assessing", updatedAt: now }));
    this.data.updateVersion(refreshed.versionId, (item) => ({ ...item, status: "ai_reviewing", submittedAt: now }));
    this.data.updateProject(projectId, (item) => ({ ...item, status: "ai_reviewing", updatedAt: now }));
    this.data.addAuditLog({ actorId: user.id, projectId, versionId: refreshed.versionId, action: "guided_submit", detail: "智能访谈项目已发起最终送审", createdAt: now });

    this.scheduleDecision(refreshed, user);
    return this.buildView(refreshed.id, user);
  }

  private scheduleDecision(session: InterviewSession, user: SessionUser): void {
    if (this.activeDecisionJobs.has(session.id)) return;
    this.activeDecisionJobs.add(session.id);
    setImmediate(() => {
      void this.completeDecision(this.data.getInterviewSession(session.id), user)
        .catch((error) => this.completeAiFailure(this.data.getInterviewSession(session.id), user, error))
        .finally(() => this.activeDecisionJobs.delete(session.id));
    });
  }

  decide(projectId: string, user: SessionUser, dto: GuidedDecisionDto) {
    if (user.role === "submitter") throw new ForbiddenException("只有审核人或管理员可以确认或改判");
    const aggregate = this.getAccessibleAggregate(projectId, user);
    const session = this.ensureSession(aggregate, user);
    if (!session.decisionId) throw new BadRequestException("当前项目还没有可确认的智能结论");
    const current = this.data.getGuidedDecision(session.decisionId);
    const now = new Date().toISOString();
    const overridden = dto.outcome !== current.outcome;
    const decision = this.data.updateGuidedDecision(current.id, (item) => ({
      ...item,
      originalOutcome: overridden ? item.originalOutcome ?? item.outcome : item.originalOutcome,
      outcome: dto.outcome,
      conditions: dto.outcome === "approved" ? [] : item.conditions,
      status: overridden ? "overridden" : "effective",
      overrideReasonCode: dto.reasonCode,
      overrideComment: dto.comment,
      decidedBy: user.id,
      decidedAt: now
    }));
    const approved = dto.outcome === "approved";
    const status = approved ? "human_approved" : "human_returned";
    this.data.updateVersion(session.versionId, (item) => ({ ...item, status, returnedAt: approved ? item.returnedAt : now }));
    this.data.updateProject(projectId, (item) => ({ ...item, status, updatedAt: now }));
    this.data.addDecision({
      projectId,
      versionId: session.versionId,
      reviewerId: user.id,
      decision: approved ? "approved" : "returned",
      comment: `${dto.reasonCode}${dto.comment ? `：${dto.comment}` : ""}`,
      decidedAt: now
    });
    this.data.updateInterviewSession(session.id, (item) => ({ ...item, status: "completed", updatedAt: now }));
    this.data.addAuditLog({
      actorId: user.id,
      projectId,
      versionId: session.versionId,
      action: overridden ? "guided_decision_overridden" : "guided_decision_confirmed",
      detail: `最终结论：${dto.outcome}；原因代码：${dto.reasonCode}`,
      createdAt: now
    });
    return { ...this.buildView(session.id, user), decision };
  }

  listKnowledge(user: SessionUser) {
    this.ensureAdmin(user);
    this.ensurePublishedKnowledge(user.id);
    return this.data.listKnowledgeReleases().sort((a, b) => b.version - a.version);
  }

  createKnowledgeDraft(user: SessionUser) {
    this.ensureAdmin(user);
    const published = this.ensurePublishedKnowledge(user.id);
    const now = new Date().toISOString();
    const { id: _publishedId, ...publishedContent } = JSON.parse(JSON.stringify(published)) as KnowledgeRelease;
    return this.data.createKnowledgeRelease({
      ...publishedContent,
      version: Math.max(...this.data.listKnowledgeReleases().map((item) => item.version)) + 1,
      name: `${published.name}（草稿）`,
      status: "draft",
      changeNote: "",
      createdBy: user.id,
      createdAt: now,
      publishedAt: undefined
    });
  }

  updateKnowledge(releaseId: string, user: SessionUser, dto: UpdateKnowledgeReleaseDto) {
    this.ensureAdmin(user);
    const release = this.data.getKnowledgeRelease(releaseId);
    if (release.status !== "draft") throw new BadRequestException("只有草稿知识版本可以编辑");
    return this.data.updateKnowledgeRelease(releaseId, (item) => ({
      ...item,
      name: dto.name ?? item.name,
      changeNote: dto.changeNote ?? item.changeNote,
      questions: dto.questions ?? item.questions,
      schemeTemplates: dto.schemeTemplates ?? item.schemeTemplates
    }));
  }

  publishKnowledge(releaseId: string, user: SessionUser) {
    this.ensureAdmin(user);
    const release = this.data.getKnowledgeRelease(releaseId);
    const errors = this.validateKnowledge(release);
    if (errors.length) throw new BadRequestException(errors.join("；"));
    const now = new Date().toISOString();
    this.data.listKnowledgeReleases().filter((item) => item.status === "published").forEach((item) => {
      this.data.updateKnowledgeRelease(item.id, (current) => ({ ...current, status: "archived" }));
    });
    return this.data.updateKnowledgeRelease(releaseId, (item) => ({ ...item, status: "published", publishedAt: now }));
  }

  rollbackKnowledge(releaseId: string, user: SessionUser) {
    this.ensureAdmin(user);
    const target = this.data.getKnowledgeRelease(releaseId);
    if (target.status === "draft") throw new BadRequestException("草稿不能作为回滚目标");
    const targetErrors = this.validateKnowledge(target);
    if (targetErrors.length) throw new BadRequestException(`该历史版本结构不完整，不能回滚：${targetErrors.join("；")}`);
    const draft = this.createKnowledgeDraft(user);
    this.data.updateKnowledgeRelease(draft.id, () => ({
      ...JSON.parse(JSON.stringify(target)) as KnowledgeRelease,
      id: draft.id,
      version: draft.version,
      name: `${target.name}（回滚发布）`,
      status: "draft",
      changeNote: `回滚至知识版本 V${target.version}`,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      publishedAt: undefined
    }));
    return this.publishKnowledge(draft.id, user);
  }

  replayKnowledge(releaseId: string, user: SessionUser) {
    this.ensureAdmin(user);
    const release = this.data.getKnowledgeRelease(releaseId);
    const projects = this.data.listProjects();
    const questions = release.questions ?? [];
    const categories = release.categories ?? [];
    const eligible = projects.filter((project) => categories.includes(project.category));
    const history = eligible.filter((project) => this.data.listVersions(project.id).some((version) => version.status === "human_approved"));
    const caseResults = eligible.map((project) => {
      const version = [...this.data.listVersions(project.id)].sort((a, b) => b.versionNumber - a.versionNumber)[0];
      const snapshot = version?.snapshot;
      const missingCoreFacts = snapshot ? [
        !snapshot.issueDescription.trim() ? "问题描述" : "",
        !snapshot.location.propertyName.trim() || !snapshot.location.equipmentPoint.trim() ? "位置/对象" : "",
        !snapshot.implementationScope.trim() ? "实施范围" : "",
        !snapshot.acceptancePlan.trim() ? "验收目标" : "",
        !snapshot.costMatrixRows.length || snapshot.budgetAmount <= 0 ? "预算闭合" : ""
      ].filter(Boolean) : ["历史版本不存在"];
      return {
        projectId: project.id,
        projectName: project.title,
        category: project.category,
        latestStatus: version?.status ?? project.status,
        approvedHistoricalCase: this.data.listVersions(project.id).some((item) => item.status === "human_approved"),
        missingCoreFacts
      };
    });
    return {
      releaseId,
      checkedAt: new Date().toISOString(),
      totalProjects: projects.length,
      applicableProjects: eligible.length,
      approvedHistoricalCases: history.length,
      reachableQuestionCount: questions.length,
      replayReadyCases: caseResults.filter((item) => !item.missingCoreFacts.length).length,
      caseResults,
      warnings: questions.some((item) => item.dependsOn && !questions.some((candidate) => candidate.id === item.dependsOn?.questionId))
        ? ["存在无法解析的题目触发关系"]
        : [],
      note: "历史回放用于管理员比较，不作为启用正式自动批准的硬门槛"
    };
  }

  private ensureSession(aggregate: ProjectAggregate, user: SessionUser): InterviewSession {
    if (!PILOT_CATEGORIES.has(aggregate.project.category) || aggregate.project.experience !== "guided_interview") {
      throw new BadRequestException("该项目使用历史表单流程，不适用智能访谈");
    }
    const version = aggregate.versions.find((item) => item.id === aggregate.project.currentVersionId);
    if (!version) throw new NotFoundException("当前项目版本不存在");
    const existing = this.data.listInterviewSessions(aggregate.project.id).find((item) => item.versionId === version.id);
    if (existing) {
      const latest = this.ensurePublishedKnowledge(user.id);
      const editable = !["assessing", "completed", "manual_review"].includes(existing.status);
      if (editable && existing.knowledgeReleaseId !== latest.id) {
        return this.data.updateInterviewSession(existing.id, (item) => ({ ...item, knowledgeReleaseId: latest.id, necessityUnderstanding: undefined, stageSupplement: undefined, status: "in_progress", nextQuestionId: "necessity.problem_summary", updatedAt: new Date().toISOString() }));
      }
      if (editable && existing.status === "stage_confirmation" && existing.necessityUnderstanding && !existing.necessityUnderstanding.followUpQuestionId) {
        const fallbackId = this.categoryFactFormId(existing.category);
        if (fallbackId && latest.questions.some((question) => question.id === fallbackId)) {
          return this.data.updateInterviewSession(existing.id, (item) => ({ ...item, necessityUnderstanding: { ...item.necessityUnderstanding!, followUpQuestionId: fallbackId }, updatedAt: new Date().toISOString() }));
        }
      }
      if (editable && existing.status === "awaiting_evidence") {
        const assessment = this.data.listStageAssessments(existing.id)
          .find((item) => !item.invalidatedAt && item.stage === existing.stage && item.tendency === "needs_information");
        if (assessment && (assessment.stage === "necessity" || assessment.stage === "feasibility")) {
          const answers = this.activeAnswerMap(existing.id);
          const questions = this.applicableQuestions(latest, existing.category, answers)
            .filter((question) => question.stage === assessment.stage);
          const missing = questions.filter((question) => question.critical && answerIsUnknown(answers.get(question.id)));
          return this.data.updateInterviewSession(existing.id, (item) => ({
            ...item,
            status: "stage_supplement",
            nextQuestionId: undefined,
            stageSupplement: this.buildStageSupplement(item, assessment, questions, missing),
            updatedAt: new Date().toISOString()
          }));
        }
      }
      if (editable && existing.status === "stage_supplement" && existing.stageSupplement && !existing.stageSupplement.fields?.length) {
        return this.data.updateInterviewSession(existing.id, (item) => ({
          ...item,
          stageSupplement: item.stageSupplement ? {
            ...item.stageSupplement,
            fields: (item.stageSupplement.missingFacts.length ? item.stageSupplement.missingFacts : [item.stageSupplement.summary]).slice(0, 4).map((fact, index) => ({
              id: `supplement_${index + 1}`,
              label: fact,
              inputType: "textarea" as const,
              placeholder: "请填写已确认的实际情况",
              required: true
            }))
          } : undefined,
          updatedAt: new Date().toISOString()
        }));
      }
      return existing;
    }
    const now = new Date().toISOString();
    const release = this.ensurePublishedKnowledge(user.id);
    const guidedVersion = aggregate.project.guidedVersion ?? 1;
    const first = guidedVersion === 2
      ? release.questions.find((item) => item.id === "necessity.problem_summary")
      : release.questions.find((item) => item.categories.includes(aggregate.project.category));
    const created = this.data.createInterviewSession({
      projectId: aggregate.project.id,
      versionId: version.id,
      knowledgeReleaseId: release.id,
      category: aggregate.project.category,
      guidedVersion,
      stage: "necessity",
      status: "in_progress",
      tendency: "needs_information",
      tendencyReasons: ["请先确认问题和证据"],
      nextQuestionId: first?.id,
      answerIds: [],
      evidenceClaimIds: [],
      assessmentIds: [],
      schemeModules: [],
      generatedCostRows: [],
      costBenchmarks: [],
      affectedQuestionIds: [],
      createdAt: now,
      updatedAt: now
    });
    const previous = this.data.listInterviewSessions(aggregate.project.id)
      .filter((item) => item.id !== created.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!previous) return created;

    const inheritedAnswerIds = this.data.listAnswerRecords(previous.id)
      .filter((item) => !item.supersededAt && release.questions.some((question) => question.id === item.questionId))
      .map((item) => this.data.createAnswerRecord({
        sessionId: created.id,
        questionId: item.questionId,
        value: item.value,
        revision: 1,
        answeredBy: user.id,
        answeredAt: now
      }).id);
    const inheritedClaimIds = this.data.listEvidenceClaims(previous.id).map((claim) =>
      this.data.createEvidenceClaim({
        sessionId: created.id,
        factKey: claim.factKey,
        attachmentIds: claim.attachmentIds,
        evidenceType: claim.evidenceType,
        confirmedBy: claim.confirmedBy,
        confirmedAt: claim.confirmedAt
      }).id
    );
    this.data.updateInterviewSession(created.id, (item) => ({
      ...item,
      answerIds: inheritedAnswerIds,
      evidenceClaimIds: inheritedClaimIds,
      affectedQuestionIds: release.questions.map((question) => question.id),
      tendencyReasons: ["已继承上一版本中未受影响的事实和证据，请修改导致退回或不批准的内容"],
      updatedAt: now
    }));
    void this.advanceInterview(created.id);
    this.writeFactsToSnapshot(created.id);
    return this.data.getInterviewSession(created.id);
  }

  private async advanceInterview(sessionId: string): Promise<void> {
    let session = this.data.getInterviewSession(sessionId);
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    const answers = this.activeAnswerMap(sessionId);
    if ((session.guidedVersion ?? 1) === 2 && !session.fingerprint?.confirmedAt) {
      if (!this.hasMinimumNecessityInput(answers)) {
        const next = ["necessity.problem_summary", "necessity.project_location"].map((id) => release.questions.find((question) => question.id === id)).find((question) => question && !answerHasValue(answers.get(question.id)));
        this.data.updateInterviewSession(sessionId, (item) => ({ ...item, stage: "necessity", status: "in_progress", nextQuestionId: next?.id, tendencyReasons: ["先确认事项和位置"], updatedAt: new Date().toISOString() }));
        return;
      }
      const fingerprint = session.fingerprint ?? await this.guidedAiSkillService.identifyItem({ category: session.category, projectTitle: this.data.getProject(session.projectId).title, facts: release.questions.filter((question) => answerHasValue(answers.get(question.id))).map((question) => ({ title: question.title, answer: answers.get(question.id)!.value })) });
      if (fingerprint) this.data.updateInterviewSession(sessionId, (item) => ({ ...item, fingerprint, status: "fingerprint_confirmation", nextQuestionId: undefined, tendencyReasons: ["请确认AI识别的工程事项"], updatedAt: new Date().toISOString() }));
      else this.data.updateInterviewSession(sessionId, (item) => ({ ...item, status: "manual_review", aiFailureReason: "事项识别失败", updatedAt: new Date().toISOString() }));
      return;
    }
    if ((session.guidedVersion ?? 1) === 2 && !session.reviewBlueprint) return;
    if ((session.guidedVersion ?? 1) === 2) {
      const stagesComplete = await this.advanceV2Stages(sessionId, session, answers, release);
      if (!stagesComplete) return;
      session = this.data.getInterviewSession(sessionId);
    }
    if ((session.guidedVersion ?? 1) !== 2) for (const stage of ["necessity", "feasibility"] as const) {
      const questions = this.applicableQuestions(release, session.category, answers).filter((item) => item.stage === stage);
      if (stage === "necessity" && this.hasMinimumNecessityInput(answers) && !session.necessityUnderstanding?.confirmedAt) {
        const understanding = await this.buildNecessityUnderstanding(session, questions, answers);
        if (understanding) {
          this.data.updateInterviewSession(sessionId, (item) => ({
            ...item,
            stage: "necessity",
            status: "stage_confirmation",
            nextQuestionId: undefined,
            stageSupplement: undefined,
            necessityUnderstanding: understanding,
            tendency: "needs_information",
            tendencyReasons: ["请先确认AI对当前问题的理解"],
            updatedAt: new Date().toISOString()
          }));
          return;
        }
      }
      const next = questions.find((item) => item.required && !answerHasValue(answers.get(item.id)));
      if (next) {
        const unknown = questions.find((item) => item.critical && answerIsUnknown(answers.get(item.id)));
        this.data.updateInterviewSession(sessionId, (item) => ({
          ...item,
          stage,
          status: unknown ? "awaiting_evidence" : "in_progress",
          tendency: "needs_information",
          tendencyReasons: unknown ? ["关键事实尚不清楚，需要补充材料"] : ["继续回答即可形成阶段判断"],
          nextQuestionId: next.id,
          stageSupplement: undefined,
          updatedAt: new Date().toISOString()
        }));
        return;
      }
      const missing = questions.filter((item) => item.critical && answerIsUnknown(answers.get(item.id)));
      const currentAssessment = this.data.listStageAssessments(sessionId)
        .find((item) => item.stage === stage && !item.invalidatedAt);
      const assessment = currentAssessment ?? await this.assessStage(sessionId, stage, answers, questions, missing);
      if (assessment.scopeCalibration) {
        this.pauseForScopeCalibration(sessionId, assessment);
        return;
      }
      const requiresSupplement = missing.length > 0 || assessment.tendency === "needs_information";
      const exhausted = (session.guidedVersion ?? 1) === 2 && requiresSupplement && (session.supplementRound?.[stage] ?? 0) >= 2;
      const stageSupplement = requiresSupplement && !exhausted
        ? this.buildStageSupplement(session, assessment, questions, missing)
        : undefined;
      session = this.data.updateInterviewSession(sessionId, (item) => ({
        ...item,
        stage,
        tendency: assessment.tendency,
        tendencyReasons: assessment.reasons,
        assessmentIds: [...item.assessmentIds.filter((id) => this.data.listStageAssessments(sessionId).some((record) => record.id === id && !record.invalidatedAt)), assessment.id],
        status: exhausted ? "manual_review" : requiresSupplement ? "stage_supplement" : item.status,
        nextQuestionId: undefined,
        stageSupplement,
        updatedAt: new Date().toISOString()
      }));
      if (requiresSupplement) return;
    }
    let generated = session.schemeModules.length ? undefined : await this.generateScheme(session, answers);
    let schemeReview = session.schemeReview;
    if ((session.guidedVersion ?? 1) === 2 && session.fingerprint && session.reviewBlueprint && generated) {
      const routes = this.routesFromScheme(session, generated.options);
      schemeReview = this.validateGeneratedScheme(generated, 1);
      session = this.data.updateInterviewSession(sessionId, (item) => ({ ...item, technicalRoutes: routes, schemeReview, updatedAt: new Date().toISOString() }));
      if (schemeReview && !schemeReview.passed) {
        const factsMissing = schemeReview.defects.some((defect) => ["critical_parameter_deferred", "unsupported_assumption", "interface_gap"].includes(defect.code));
        const mayDeferForUpgrade = factsMissing && ["quality_upgrade", "lifecycle_renewal"].includes(session.fingerprint?.intent ?? "");
        if (mayDeferForUpgrade) {
          schemeReview = { ...schemeReview, passed: true, summary: "方案方向可进入确认；实测参数已转为样板或施工前实施条件", defects: schemeReview.defects.map((defect) => ({ ...defect, severity: "warning" as const })) };
          this.data.updateInterviewSession(sessionId, (item) => ({ ...item, schemeReview, updatedAt: new Date().toISOString() }));
        } else {
          this.data.updateInterviewSession(sessionId, (item) => ({ ...item, status: factsMissing ? "stage_supplement" : "manual_review", stage: "feasibility", stageSupplement: factsMissing ? { stage: "feasibility", summary: schemeReview!.summary, reasons: schemeReview!.defects.map((defect) => defect.message).slice(0,3), missingFacts: schemeReview!.defects.map((defect) => defect.message).slice(0,3), questionIds: [], fields: schemeReview!.defects.filter((defect)=>defect.severity === "blocking").slice(0,4).map((defect,index)=>({ id:`scheme_gap_${index+1}`, label:defect.message, inputType:"textarea", placeholder:"请填写已经确认的实际情况", required:true })), modelName: schemeReview!.modelName, promptVersion: schemeReview!.promptVersion, createdAt: schemeReview!.reviewedAt } : undefined, updatedAt: new Date().toISOString() }));
          return;
        }
      }
    }
    const modules = session.schemeModules.length ? session.schemeModules : generated?.modules ?? this.buildSchemeModules(session, answers);
    const costRows = session.generatedCostRows.length ? session.generatedCostRows : generated?.costRows ?? this.buildCostSkeleton(session);
    const costBenchmarks = costRows.map((row) => this.buildBenchmark(session, row));
    const options = session.schemeOptions?.length ? session.schemeOptions : generated?.options ?? [this.defaultSchemeOption(modules, costRows)];
    const selectedOptionId = session.selectedSchemeOptionId ?? options.find((item) => item.kind === "recommended")?.id;
    this.data.updateInterviewSession(sessionId, (item) => ({
      ...item,
      stage: "scheme",
      status: "scheme_confirmation",
      nextQuestionId: undefined,
      schemeModules: modules,
      generatedCostRows: costRows,
      costBenchmarks,
      schemeOptions: options,
      selectedSchemeOptionId: selectedOptionId,
      stageSupplement: undefined,
      tendency: "leaning_approved",
      tendencyReasons: ["必要性和可行性信息已完成", "请确认唯一推荐方案"],
      updatedAt: new Date().toISOString()
    }));
  }

  private async advanceV2Stages(sessionId: string, initial: InterviewSession, answers: Map<string, AnswerRecord>, release: KnowledgeRelease): Promise<boolean> {
    let session = initial;
    for (const stage of ["necessity", "feasibility"] as const) {
      const current = this.data.listStageAssessments(sessionId).find((item) => item.stage === stage && !item.invalidatedAt);
      const baseQuestions = release.questions.filter((question) => ["necessity.problem_summary", "necessity.project_location"].includes(question.id));
      const assessment = current ?? await this.assessStage(sessionId, stage, answers, baseQuestions, []);
      if (assessment.scopeCalibration) {
        this.pauseForScopeCalibration(sessionId, assessment);
        return false;
      }
      const requiresSupplement = assessment.tendency === "needs_information";
      const rounds = session.supplementRound?.[stage] ?? 0;
      if (requiresSupplement && rounds >= 2) {
        this.data.updateInterviewSession(sessionId, (item) => ({ ...item, stage, status: "manual_review", tendency: "needs_information", tendencyReasons: ["两轮聚焦补充后关键事实仍未闭合，当前不能形成专业判断"], nextQuestionId: undefined, stageSupplement: undefined, updatedAt: new Date().toISOString() }));
        return false;
      }
      session = this.data.updateInterviewSession(sessionId, (item) => ({
        ...item,
        stage,
        tendency: assessment.tendency,
        tendencyReasons: assessment.reasons,
        assessmentIds: [...item.assessmentIds.filter((id) => this.data.listStageAssessments(sessionId).some((record) => record.id === id && !record.invalidatedAt)), assessment.id],
        status: requiresSupplement ? "stage_supplement" : assessment.tendency === "leaning_not_approved" ? "manual_review" : "in_progress",
        nextQuestionId: undefined,
        stageSupplement: requiresSupplement ? this.buildStageSupplement(item, assessment, [], []) : undefined,
        updatedAt: new Date().toISOString()
      }));
      if (requiresSupplement || assessment.tendency === "leaning_not_approved") return false;
    }
    return true;
  }

  private routesFromScheme(session: InterviewSession, options: SchemeOption[]) {
    const blueprintRoutes = session.reviewBlueprint?.candidateRoutes ?? [];
    return options.map((option, index) => ({
      id: `route_${index + 1}`,
      name: option.title,
      kind: option.kind === "recommended" ? "recommended" as const : "conditional" as const,
      mechanism: blueprintRoutes[index]?.mechanism ?? option.summary,
      applicability: option.applicability,
      exclusionReasons: blueprintRoutes.filter((_, routeIndex) => routeIndex !== index).flatMap((route) => route.exclusions).slice(0,4),
      criticalParameters: blueprintRoutes[index]?.criticalParameters ?? [],
      interfaces: option.modules.filter((module)=>["scope","materials","risk_controls"].includes(module.key)).map((module)=>module.content).slice(0,3),
      executionSequence: option.modules.filter((module)=>module.key === "process").map((module)=>module.content),
      acceptanceTargets: option.modules.filter((module)=>module.key === "acceptance").map((module)=>module.content)
    }));
  }

  private v2FactContext(sessionId: string) {
    const session = this.data.getInterviewSession(sessionId);
    const answers = this.activeAnswerMap(sessionId);
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    return {
      answers: release.questions.filter((question) => answerHasValue(answers.get(question.id))).map((question) => ({ id: question.id, label: question.title, value: compactAIValue(answers.get(question.id)?.value ?? "") })),
      supplements: (session.stageSupplementFacts ?? []).filter((fact) => !session.reviewContextStartedAt || fact.submittedAt >= session.reviewContextStartedAt).map((fact) => ({ stage: fact.stage, submittedAt: fact.submittedAt, values: Object.fromEntries(Object.entries(fact.values).map(([id, value]) => [fact.labels[id] ?? id, compactAIValue(value)])) }))
    };
  }

  private firstUnansweredQuestion(session: InterviewSession): string | undefined {
    const answers = this.activeAnswerMap(session.id);
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    return this.applicableQuestions(release, session.category, answers).find((question) => question.required && !answerHasValue(answers.get(question.id)))?.id;
  }

  private buildStageSupplement(
    session: InterviewSession,
    assessment: StageAssessment,
    questions: QuestionDefinition[],
    missing: QuestionDefinition[]
  ): NonNullable<InterviewSession["stageSupplement"]> {
    const allowed = new Set(questions.map((question) => question.id));
    const selectedIds = [
      ...(assessment.followUpQuestionIds ?? []).filter((id) => allowed.has(id)),
      ...missing.map((question) => question.id)
    ];
    if (!selectedIds.length && assessment.stage === "necessity") {
      const fallbackId = this.categoryFactFormId(session.category);
      if (fallbackId && allowed.has(fallbackId)) selectedIds.push(fallbackId);
    }
    if (!selectedIds.length) {
      const fallback = questions.find((question) => question.critical) ?? questions[0];
      if (fallback) selectedIds.push(fallback.id);
    }
    const fields = assessment.supplementFields?.length
      ? assessment.supplementFields.slice(0, 4)
      : (assessment.missingFacts.length ? assessment.missingFacts : [assessment.summary]).slice(0, 4).map((fact, index) => ({
          id: `supplement_${index + 1}`,
          label: fact,
          inputType: "textarea" as const,
          placeholder: "请填写已确认的实际情况",
          required: true
        }));
    return {
      stage: assessment.stage as "necessity" | "feasibility",
      summary: assessment.summary,
      reasons: assessment.reasons.slice(0, 3),
      missingFacts: assessment.missingFacts.length
        ? assessment.missingFacts.slice(0, 3)
        : missing.map((question) => question.title).slice(0, 3),
      questionIds: [...new Set(selectedIds)].slice(0, 1),
      fields,
      dataCollectionRecommended: assessment.dataCollectionRecommended
        ?? (fields.filter((field) => field.inputType === "number").length >= 2 || assessment.missingFacts.some((fact) => /实测|测点|逐次|逐条|近.*月|故障记录|运行记录|巡检记录/.test(fact))),
      modelName: assessment.modelName,
      promptVersion: assessment.promptVersion,
      createdAt: assessment.generatedAt
    };
  }

  private pauseForScopeCalibration(sessionId: string, assessment: StageAssessment): void {
    if (!assessment.scopeCalibration) return;
    const proposal: ScopeCalibrationProposal = {
      ...assessment.scopeCalibration,
      sourceAssessmentId: assessment.id
    };
    this.data.updateInterviewSession(sessionId, (item) => ({
      ...item,
      stage: proposal.stage,
      status: "scope_confirmation",
      declaredScope: item.declaredScope || proposal.declaredScope,
      scopeCalibration: proposal,
      stageSupplement: undefined,
      nextQuestionId: undefined,
      tendency: "needs_information",
      tendencyReasons: [proposal.reason],
      assessmentIds: [...new Set([...item.assessmentIds, assessment.id])],
      updatedAt: new Date().toISOString()
    }));
  }

  private resolveDeclaredScope(session: InterviewSession, answers: Map<string, AnswerRecord>): string | undefined {
    if (session.fingerprint?.impactScope?.trim()) return session.fingerprint.impactScope.trim();
    const location = locationValue(answers.get("necessity.project_location"));
    if (location) {
      const place = [location.propertyName, location.building, location.floor, location.area, location.point].filter((value) => value?.trim()).join(" / ");
      if (place) return place;
    }
    const selected = scopeValue(answers.get("feasibility.scope_components"));
    if (selected?.included?.length) return [...selected.included, selected.other].filter(Boolean).join("、");
    return undefined;
  }

  private fallbackDataCollectionTemplate(supplement: NonNullable<InterviewSession["stageSupplement"]>): StageDataCollectionTemplate {
    const columns: StageDataCollectionTemplate["columns"] = supplement.fields.slice(0, 10).map((field) => ({
      id: field.id,
      label: field.label,
      dataType: field.inputType === "number" ? "number" as const : field.inputType === "select" ? "select" as const : "text" as const,
      unit: field.unit,
      required: field.required,
      options: field.options?.map((option) => option.label)
    }));
    if (columns.length < 2) columns.unshift({ id: "record_time", label: "记录时间", dataType: "date", required: true });
    return {
      title: supplement.stage === "necessity" ? "必要性补充数据采集表" : "可行性补充数据采集表",
      description: supplement.summary,
      rowLabel: "一条实测或事件记录",
      instructions: ["一行填写一条记录", "只填写数据，不要插入照片或截图", "照片如确有必要请在系统中单独上传"],
      maxRows: 100,
      columns,
      modelName: supplement.modelName,
      promptVersion: supplement.promptVersion
    };
  }

  private buildDataCollectionWorkbook(projectTitle: string, template: StageDataCollectionTemplate): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "工程立项智能访谈";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("数据填写", { views: [{ state: "frozen", ySplit: 5 }] });
    sheet.properties.defaultRowHeight = 22;
    const width = Math.max(2, template.columns.length);
    sheet.mergeCells(1, 1, 1, width);
    sheet.getCell(1, 1).value = template.title;
    sheet.getCell(1, 1).font = { bold: true, size: 17, color: { argb: "FF163A63" } };
    sheet.getRow(1).height = 32;
    sheet.mergeCells(2, 1, 2, width);
    sheet.getCell(2, 1).value = `${projectTitle}｜${template.description}`;
    sheet.getCell(2, 1).alignment = { wrapText: true, vertical: "middle" };
    sheet.getCell(2, 1).font = { color: { argb: "FF52657A" }, size: 10 };
    sheet.getRow(2).height = 34;
    sheet.mergeCells(3, 1, 3, width);
    sheet.getCell(3, 1).value = `填写口径：每行代表${template.rowLabel}。${template.instructions.join("；")}。禁止插入照片、截图、宏或外部链接。`;
    sheet.getCell(3, 1).alignment = { wrapText: true, vertical: "middle" };
    sheet.getCell(3, 1).font = { color: { argb: "FF8A5A00" }, size: 10 };
    sheet.getCell(3, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E8" } };
    sheet.getRow(3).height = 42;

    template.columns.forEach((column, index) => {
      const cell = sheet.getCell(5, index + 1);
      cell.value = `${column.label}${column.unit ? `（${column.unit}）` : ""}${column.required ? " *" : ""}`;
      cell.font = { bold: true, color: { argb: "FF123B69" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2FF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFBCD2EA" } } };
      sheet.getColumn(index + 1).width = column.dataType === "date" ? 16 : column.dataType === "number" ? 15 : Math.min(28, Math.max(14, column.label.length * 2 + 6));
      for (let row = 6; row <= 5 + template.maxRows; row += 1) {
        if (column.dataType === "number") sheet.getCell(row, index + 1).numFmt = "0.00";
        if (column.dataType === "date") sheet.getCell(row, index + 1).numFmt = "yyyy-mm-dd hh:mm";
      }
      if (column.dataType === "select" && column.options?.length) {
        sheet.getCell(6, index + 1).dataValidation = { type: "list", allowBlank: !column.required, formulae: [`\"${column.options.join(",")}\"`] };
        for (let row = 7; row <= 5 + template.maxRows; row += 1) sheet.getCell(row, index + 1).dataValidation = sheet.getCell(6, index + 1).dataValidation;
      }
    });
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + template.maxRows, column: template.columns.length } };
    sheet.pageSetup = { orientation: template.columns.length > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    const meta = workbook.addWorksheet("__system");
    meta.state = "veryHidden";
    meta.getCell("A1").value = "property-review-data-collection-v1";
    meta.getCell("A2").value = JSON.stringify(template);
    return workbook;
  }

  private async parseDataCollectionWorkbook(buffer: Buffer, template: StageDataCollectionTemplate): Promise<Array<Record<string, string | number>>> {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new BadRequestException("文件不是有效的 .xlsx 工作簿，请在 Excel 或 WPS 中另存为 Excel 工作簿（.xlsx）后上传");
    }
    const zipIndex = buffer.toString("latin1");
    if (zipIndex.includes("xl/media/")) throw new BadRequestException("数据采集表不能包含照片或截图，请删除后上传");
    if (/vbaProject\.bin/i.test(zipIndex)) throw new BadRequestException("数据采集表不能包含宏，请另存为普通 .xlsx 文件");
    if (zipIndex.includes("xl/externalLinks/")) throw new BadRequestException("数据采集表不能包含外部链接，请将数据粘贴为值后上传");

    try {
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellFormula: true });
      const allowedSheets = new Set(["数据填写", "__system"]);
      if (!workbook.SheetNames.includes("数据填写") || !workbook.SheetNames.includes("__system")) {
        throw new BadRequestException("不是当前系统生成的数据采集表，请重新下载模板填写");
      }
      if (workbook.SheetNames.some((name) => !allowedSheets.has(name))) {
        throw new BadRequestException("数据采集表包含无关工作表，请删除后再上传");
      }
      const sheet = workbook.Sheets["数据填写"];
      const meta = workbook.Sheets["__system"];
      if (meta?.A1?.v !== "property-review-data-collection-v1") {
        throw new BadRequestException("不是当前系统生成的数据采集表，请重新下载模板填写");
      }
      try {
        const embedded = JSON.parse(String(meta.A2?.v ?? "")) as StageDataCollectionTemplate;
        const currentColumns = template.columns.map((column) => column.id).join("|");
        const embeddedColumns = embedded.columns?.map((column) => column.id).join("|");
        if (!embeddedColumns || embeddedColumns !== currentColumns) throw new Error("template mismatch");
      } catch {
        throw new BadRequestException("数据采集表已过期，请重新下载当前模板");
      }

      const rows: Array<Record<string, string | number>> = [];
      for (let rowIndex = 6; rowIndex <= 5 + template.maxRows; rowIndex += 1) {
        const values: Record<string, string | number> = {};
        template.columns.forEach((column, columnIndex) => {
          const address = XLSX.utils.encode_cell({ r: rowIndex - 1, c: columnIndex });
          const cell = sheet[address];
          if (cell?.f) throw new BadRequestException(`第 ${rowIndex - 5} 条记录含公式，请粘贴为数值后上传`);
          const raw = cell?.v;
          const value = raw instanceof Date
            ? raw.toISOString()
            : typeof raw === "number"
              ? raw
              : typeof raw === "string"
                ? raw.trim()
                : typeof raw === "boolean"
                  ? (raw ? "是" : "否")
                  : "";
          if (value !== "") values[column.id] = value;
        });
        if (Object.keys(values).length) rows.push(values);
      }
      return rows;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("无法读取该Excel文件，请使用刚下载的模板，并在Excel或WPS中另存为普通 .xlsx 文件后重试");
    }
  }

  private safeDownloadName(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "实测数据采集表";
  }

  private hasMinimumNecessityInput(answers: Map<string, AnswerRecord>): boolean {
    return answerHasValue(answers.get("necessity.problem_summary")) && answerHasValue(answers.get("necessity.project_location"));
  }

  private async buildNecessityUnderstanding(session: InterviewSession, questions: QuestionDefinition[], answers: Map<string, AnswerRecord>) {
    try {
      const output = await this.guidedAiSkillService.understandNecessity({
        stage: "necessity",
        category: session.category,
        projectTitle: this.data.getProject(session.projectId).title,
        questions: questions.filter((question) => answerHasValue(answers.get(question.id))).map((question) => ({ id: question.id, title: question.title, critical: question.critical, answer: answers.get(question.id)?.value ?? "" })),
        evidence: this.evidenceContext(session),
        allowedQuestionIds: questions.map((question) => question.id)
      });
      const followUpQuestionId = this.resolveUnderstandingFollowUp(session.category, output?.missingFacts ?? [], questions, answers);
      return output ? {
        summary: output.summary,
        facts: output.facts,
        missingFacts: output.missingFacts,
        followUpQuestionId,
        evidenceRequest: output.evidenceRequest ? { ...output.evidenceRequest, acceptedTypes: output.evidenceRequest.acceptedTypes as EvidenceClaim["evidenceType"][] } : undefined,
        modelName: output.modelName,
        promptVersion: output.promptVersion
      } : undefined;
    } catch (error) {
      this.data.updateInterviewSession(session.id, (item) => ({ ...item, aiFailureReason: error instanceof Error ? error.message : "必要性理解失败", updatedAt: new Date().toISOString() }));
      return undefined;
    }
  }

  private resolveUnderstandingFollowUp(
    category: InterviewSession["category"],
    missingFacts: string[],
    questions: QuestionDefinition[],
    answers: Map<string, AnswerRecord>
  ): string | undefined {
    const factFormId = this.categoryFactFormId(category);
    const factForm = questions.find((item) => item.id === factFormId);
    if (missingFacts.length && factForm && !answerHasValue(answers.get(factForm.id))) return factForm.id;
    return questions.find((item) => item.required && !answerHasValue(answers.get(item.id)))?.id;
  }

  private categoryFactFormId(category: InterviewSession["category"]): string | undefined {
    const categoryFactForms: Partial<Record<InterviewSession["category"], string>> = {
      mep_upgrade: "necessity.problem_history",
      plumbing_drainage: "necessity.problem_history",
      civil_upgrade: "necessity.condition_history",
      fire_safety: "necessity.compliance_history",
      energy_retrofit: "necessity.performance_baseline"
    };
    return categoryFactForms[category];
  }

  private async assessStage(
    sessionId: string,
    stage: "necessity" | "feasibility",
    answers: Map<string, AnswerRecord>,
    questions: QuestionDefinition[],
    missing: QuestionDefinition[]
  ): Promise<StageAssessment> {
    const session = this.data.getInterviewSession(sessionId);
    if (!missing.length) {
      try {
        const project = this.data.getProject(session.projectId);
        const output = await this.guidedAiSkillService.assessStage({
          stage,
          category: session.category,
          projectTitle: project.title,
          questions: questions.map((question) => ({
            id: question.id,
            title: question.title,
            critical: question.critical,
            answer: compactAIValue(answers.get(question.id)?.value ?? "")
          })),
          evidence: this.evidenceContext(session),
          allowedQuestionIds: questions.map((question) => question.id),
          supplementalFacts: (session.stageSupplementFacts ?? [])
            .filter((fact) => fact.stage === stage && (!session.reviewContextStartedAt || fact.submittedAt >= session.reviewContextStartedAt))
            .map((fact) => Object.entries(fact.values).map(([id, value]) => ({ label: fact.labels[id] ?? id, value: compactAIValue(value) as string | number })).flat())
            .flat(),
          blueprint: session.reviewBlueprint,
          fingerprint: session.fingerprint,
          declaredScope: session.declaredScope || this.resolveDeclaredScope(session, answers),
          confirmedScope: session.confirmedScope
        });
        if (output) {
          this.data.updateInterviewSession(sessionId, (item) => ({ ...item, aiFailureReason: undefined, updatedAt: new Date().toISOString() }));
          return this.createSkillAssessment(sessionId, stage, output);
        }
      } catch (error) {
        this.data.updateInterviewSession(sessionId, (item) => ({
          ...item,
          aiFailureReason: error instanceof Error ? error.message : "阶段 Skill 调用失败，已使用受控兜底判断",
          updatedAt: new Date().toISOString()
        }));
      }
    }
    return this.assessStageFallback(sessionId, stage, answers, missing);
  }

  private assessStageFallback(sessionId: string, stage: "necessity" | "feasibility", answers: Map<string, AnswerRecord>, missing: QuestionDefinition[]): StageAssessment {
    const session = this.data.getInterviewSession(sessionId);
    if (["quality_upgrade", "lifecycle_renewal"].includes(session.fingerprint?.intent ?? "")) {
      return this.createAssessment(
        sessionId,
        stage,
        "leaning_approved",
        stage === "necessity" ? `原则必要性成立：${session.fingerprint?.businessObjective || "更新目标明确"}` : "可进入方案设计，专业参数作为实施条件闭合",
        [session.fingerprint?.intent === "quality_upgrade" ? "品质与形象提升目标明确" : "生命周期更新目标明确", "已确认项目对象和覆盖策略"],
        [],
        { implementationConditions: stage === "feasibility" ? ["施工前按代表类型复核重量、接口、净空和材料性能", "先做样板并完成受影响功能和复梯检查"] : [] }
      );
    }
    if (missing.length) {
      return this.createAssessment(sessionId, stage, "needs_information", "关键事实尚未闭合", ["存在选择“不清楚”的关键事实"], missing.map((item) => item.title));
    }
    if (stage === "necessity") {
      const consequence = textValue(answers.get("necessity.consequence"));
      const repair = textValue(answers.get("necessity.repair_alternative"));
      if (consequence === "appearance" && repair === "yes") {
        return this.createAssessment(sessionId, stage, "leaning_not_approved", "现有信息更支持日常维修，不支持单独立项", ["主要收益为观感改善", "常规维修可以解决"], []);
      }
      return this.createAssessment(sessionId, stage, "leaning_approved", "问题真实且具备立项必要性", ["问题位置和影响范围明确", "不处理后果已确认", repair === "yes" ? "需要在方案中进一步排除维修替代" : "常规维修不能长期解决"], []);
    }
    const riskAnswers = ["feasibility.shutdown", "feasibility.fire_impact", "feasibility.occupied_impact", "feasibility.concealed_work", "feasibility.hot_work", "feasibility.working_at_height", "feasibility.third_party_testing"];
    const risks = riskAnswers.filter((id) => !["none", "no", ""].includes(textValue(answers.get(id))));
    return this.createAssessment(sessionId, stage, "leaning_approved", "现场条件可通过方案措施进行控制", ["实施范围和排除范围明确", "施工窗口已说明", risks.length ? `已识别 ${risks.length} 项实施风险并纳入方案` : "未识别重大实施冲突"], []);
  }

  private createSkillAssessment(sessionId: string, stage: InterviewStage, output: StageSkillOutput): StageAssessment {
    const session = this.data.getInterviewSession(sessionId);
    const principleUpgrade = ["necessity", "feasibility"].includes(stage)
      && ["quality_upgrade", "lifecycle_renewal"].includes(session.fingerprint?.intent ?? "")
      && this.evidenceContext(session).length > 0
      && output.tendency === "needs_information";
    const normalizedOutput = principleUpgrade ? {
      ...output,
      tendency: "leaning_approved" as const,
      summary: stage === "necessity"
        ? `原则必要性成立：${session.fingerprint?.businessObjective || "项目目标明确"}`
        : "具备进入方案设计的基本条件；尚未闭合的实测参数已转为实施前条件。",
      reasons: [...new Set([`项目动机为${session.fingerprint?.intent === "quality_upgrade" ? "品质与形象提升" : "生命周期更新"}`, ...output.reasons])].slice(0, 3),
      implementationConditions: [...new Set([...output.implementationConditions, ...output.missingFacts])].slice(0, 8),
      missingFacts: [],
      supplementFields: [],
      followUpQuestionIds: [],
      dataCollectionRecommended: false,
      scopeCalibration: session.fingerprint?.scopeStrategy === "condition_based" ? output.scopeCalibration : undefined
    } : output;
    return this.createAssessment(
      sessionId,
      stage,
      normalizedOutput.tendency,
      normalizedOutput.summary,
      normalizedOutput.reasons,
      normalizedOutput.missingFacts,
      { modelName: normalizedOutput.modelName, promptVersion: normalizedOutput.promptVersion, followUpQuestionIds: normalizedOutput.followUpQuestionIds, supplementFields: normalizedOutput.supplementFields, propositionResults: normalizedOutput.propositionResults, dataCollectionRecommended: normalizedOutput.dataCollectionRecommended, scopeCalibration: normalizedOutput.scopeCalibration, implementationConditions: normalizedOutput.implementationConditions }
    );
  }

  private createAssessment(
    sessionId: string,
    stage: InterviewStage,
    tendency: LiveDecisionTendency,
    summary: string,
    reasons: string[],
    missingFacts: string[],
    options?: { modelName?: string; promptVersion?: string; followUpQuestionIds?: string[]; supplementFields?: NonNullable<InterviewSession["stageSupplement"]>["fields"]; propositionResults?: StageAssessment["propositionResults"]; dataCollectionRecommended?: boolean; scopeCalibration?: StageSkillOutput["scopeCalibration"]; implementationConditions?: string[] }
  ): StageAssessment {
    const session = this.data.getInterviewSession(sessionId);
    const assessment = this.data.replaceStageAssessment({
      sessionId,
      stage,
      tendency,
      summary,
      reasons,
      missingFacts,
      evidenceAttachmentIds: this.data.listAttachments(session.projectId, session.versionId).map((item) => item.id),
      modelName: options?.modelName ?? STAGE_MODEL,
      promptVersion: options?.promptVersion ?? STAGE_PROMPT_VERSION,
      followUpQuestionIds: options?.followUpQuestionIds,
      supplementFields: options?.supplementFields,
      dataCollectionRecommended: options?.dataCollectionRecommended,
      implementationConditions: options?.implementationConditions,
      scopeCalibration: options?.scopeCalibration && (stage === "necessity" || stage === "feasibility") ? {
        ...options.scopeCalibration,
        stage,
        modelName: options.modelName ?? STAGE_MODEL,
        promptVersion: options.promptVersion ?? STAGE_PROMPT_VERSION,
        createdAt: new Date().toISOString()
      } : undefined,
      propositionResults: options?.propositionResults,
      knowledgeReleaseId: session.knowledgeReleaseId,
      generatedAt: new Date().toISOString()
    });
    return assessment;
  }

  private async generateScheme(session: InterviewSession, answers: Map<string, AnswerRecord>, reviewDefects?: string[]): Promise<{ modules: SchemeModule[]; costRows: CostMatrixRow[]; options: SchemeOption[] } | undefined> {
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    const questions = this.applicableQuestions(release, session.category, answers);
    const assessments = this.data.listStageAssessments(session.id).filter((item) => !item.invalidatedAt);
    try {
      const output = await this.guidedAiSkillService.generateScheme({
        category: session.category,
        projectTitle: this.data.getProject(session.projectId).title,
        facts: [
          ...(session.confirmedScope ? [{ id: "system.confirmed_scope", title: "本版本确认工程范围", answer: session.confirmedScope as InterviewAnswerValue }] : []),
          ...questions.filter((question) => answerHasValue(answers.get(question.id))).map((question) => ({
          id: question.id,
          title: question.title,
          answer: compactAIValue(answers.get(question.id)?.value ?? "")
          }))
        ],
        evidence: this.evidenceContext(session).map(({ type, fileName }) => ({ type, fileName })),
        assessments: assessments.map((assessment) => ({
          stage: assessment.stage,
          tendency: assessment.tendency,
          summary: assessment.summary,
          reasons: assessment.reasons,
          implementationConditions: assessment.implementationConditions
        })),
        moduleKeys: Object.keys(SCHEME_TITLES) as SchemeModuleKey[],
        fingerprint: session.fingerprint,
        blueprint: session.reviewBlueprint,
        reviewDefects
      });
      if (output) {
        this.data.updateInterviewSession(session.id, (item) => ({ ...item, aiFailureReason: undefined, updatedAt: new Date().toISOString() }));
        return this.mapGeneratedScheme(output);
      }
      return undefined;
    } catch (error) {
      this.data.updateInterviewSession(session.id, (item) => ({
        ...item,
        aiFailureReason: error instanceof Error ? error.message : "方案 Skill 调用失败，已使用受控兜底方案",
        updatedAt: new Date().toISOString()
      }));
      return undefined;
    }
  }

  private validateGeneratedScheme(
    generated: { modules: SchemeModule[]; costRows: CostMatrixRow[]; options: SchemeOption[] },
    revision: number
  ): SchemeReview {
    const defects: SchemeReview["defects"] = [];
    const moduleKeys = new Set(generated.modules.filter((module) => module.content.trim()).map((module) => module.key));
    const missingModules = (Object.keys(SCHEME_TITLES) as SchemeModuleKey[]).filter((key) => !moduleKeys.has(key));
    if (missingModules.length) defects.push({ code: "missing_module", message: `缺少方案模块：${missingModules.map((key) => SCHEME_TITLES[key]).join("、")}`, severity: "blocking" });
    if (!generated.costRows.length) defects.push({ code: "missing_quantity", message: "方案未形成核心工程量项目", severity: "blocking" });
    if (generated.costRows.length > 6) defects.push({ code: "too_many_cost_items", message: "成本项超过6项，应合并非核心管理与措施费用", severity: "warning" });
    if (generated.modules.some((module) => !(module.parameters?.length))) defects.push({ code: "missing_parameters", message: "部分方案模块缺少可复核的参数或确认方法", severity: "warning" });
    if (generated.costRows.some((row) => !row.remark?.trim())) defects.push({ code: "missing_measurement_basis", message: "部分核心成本项缺少工程量测算口径", severity: "warning" });
    const passed = !defects.some((defect) => defect.severity === "blocking");
    return {
      passed,
      revision,
      defects,
      summary: passed ? "方案结构完整，已通过本地契约校验" : "方案结构不完整，未进入工程量确认",
      modelName: "deterministic-scheme-validator",
      promptVersion: "scheme-contract-v1",
      reviewedAt: new Date().toISOString()
    };
  }

  private mapGeneratedScheme(output: SchemeSkillOutput): { modules: SchemeModule[]; costRows: CostMatrixRow[]; options: SchemeOption[] } {
    const now = new Date().toISOString();
    const mapModules = (source: SchemeSkillOutput["modules"]): SchemeModule[] => source.map((module) => ({
        key: module.key,
        title: SCHEME_TITLES[module.key],
        content: module.content,
        basis: module.basis,
        parameters: module.parameters,
        modelName: output.modelName,
        promptVersion: output.promptVersion,
        confirmed: false,
        updatedAt: now
      }));
    const mapRows = (source: SchemeSkillOutput["quantityItems"]): CostMatrixRow[] => source.map((item) => ({
        id: createId("cost"),
        type: "engineering",
        itemName: item.itemName,
        specification: item.specification,
        unit: item.unit,
        quantity: 0,
        unitPrice: 0,
        remark: `计量依据：${item.measurementBasis}；来源：${SCHEME_TITLES[item.sourceModuleKey]}`,
        referenceUnitPriceLow: item.referenceUnitPriceLow,
        referenceUnitPriceHigh: item.referenceUnitPriceHigh,
        referencePriceBasis: item.referencePriceBasis,
        referencePriceAsOf: item.referenceUnitPriceLow && item.referenceUnitPriceHigh ? new Date().toISOString().slice(0, 10) : undefined
      }));
    const modules = mapModules(output.modules);
    const costRows = mapRows(output.quantityItems);
    const recommended: SchemeOption = {
      id: createId("scheme_option"), title: "AI主推荐方案", kind: "recommended", summary: "当前事实条件下解决程度与实施风险最平衡的路径", applicability: ["按当前已确认事实实施"],
      tradeoffs: { resolution: "针对已确认问题形成完整治理闭环", durability: "按推荐材料与工艺形成长期修复", constructionImpact: "按风险措施组织实施", risk: "已纳入当前可识别风险", costLevel: "以工程量测量和询价结果为准" },
      modules, costRows
    };
    const alternatives: SchemeOption[] = output.alternatives.map((option) => ({
      id: createId("scheme_option"), title: option.title, kind: "conditional", summary: option.summary, applicability: option.applicability, tradeoffs: option.tradeoffs,
      modules: mapModules(option.modules), costRows: mapRows(option.quantityItems)
    }));
    return {
      modules,
      costRows,
      options: [recommended, ...alternatives]
    };
  }

  private defaultSchemeOption(modules: SchemeModule[], costRows: CostMatrixRow[]): SchemeOption {
    return {
      id: createId("scheme_option"),
      title: "当前推荐方案",
      kind: "recommended",
      summary: "当前事实条件下建议采用此方案",
      applicability: ["按当前已确认事实实施"],
      tradeoffs: { resolution: "形成目标、范围、工艺和验收闭环", durability: "按材料原则与现场条件确认", constructionImpact: "按风险措施执行", risk: "风险措施已纳入方案", costLevel: "以工程量与询价为准" },
      modules,
      costRows
    };
  }

  private evidenceContext(session: InterviewSession): Array<{ type: string; fileName: string; mimeType: string }> {
    const claims = this.data.listEvidenceClaims(session.id);
    const attachments = new Map(this.data.listAttachments(session.projectId).map((attachment) => [attachment.id, attachment]));
    const result: Array<{ type: string; fileName: string; mimeType: string }> = [];
    for (const claim of claims) {
      for (const attachmentId of claim.attachmentIds) {
        const attachment = attachments.get(attachmentId);
        if (attachment) result.push({ type: claim.evidenceType, fileName: attachment.fileName, mimeType: attachment.mimeType });
      }
    }
    return result;
  }

  private buildSchemeModules(session: InterviewSession, answers: Map<string, AnswerRecord>): SchemeModule[] {
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    const templates = release.schemeTemplates[session.category] ?? {};
    const location = locationValue(answers.get("necessity.project_location"));
    const scope = scopeValue(answers.get("feasibility.scope_components"));
    const scopeQuestion = release.questions.find((item) => item.id === "feasibility.scope_components");
    const scopeLabels = (scope?.included ?? []).map((value) => scopeQuestion?.options?.find((item) => item.value === value)?.label ?? value);
    if (scope?.other?.trim()) scopeLabels.push(scope.other.trim());
    const context = {
      problem: textValue(answers.get("necessity.problem_summary")),
      location: [location?.propertyName, location?.building, location?.floor, location?.area, location?.point].filter(Boolean).join(" / "),
      scope: scopeLabels.join("、"),
      excluded: scopeQuestion?.options?.filter((option) => !(scope?.included ?? []).includes(option.value) && option.value !== "other").map((option) => option.label).join("、") ?? "",
      window: textValue(answers.get("feasibility.execution_window")),
      target: textValue(answers.get("feasibility.acceptance_target"))
    };
    const riskNotes = [
      !["", "none"].includes(textValue(answers.get("feasibility.shutdown"))) ? "需制定停水、停电、停机或系统切换措施" : "",
      textValue(answers.get("feasibility.fire_impact")) === "yes" ? "需制定消防系统影响和临时保障措施" : "",
      textValue(answers.get("feasibility.occupied_impact")) === "yes" ? "需实施占用区隔离和客户通行保障" : "",
      textValue(answers.get("feasibility.concealed_work")) === "yes" ? "需执行隐蔽验收和影像留档" : "",
      textValue(answers.get("feasibility.hot_work")) === "yes" ? "需执行动火审批和监护" : "",
      textValue(answers.get("feasibility.working_at_height")) === "yes" ? "需执行高处作业防护" : "",
      textValue(answers.get("feasibility.third_party_testing")) === "yes" ? "需纳入第三方检测" : ""
    ].filter(Boolean);
    const generated: Record<SchemeModuleKey, string> = session.category === "civil_upgrade" ? {
      objective: `解决${context.location}的${context.problem}，恢复使用并降低复发风险。`,
      scope: `本次包含${context.scope}；明确不包含${context.excluded}。`,
      process: "现场复核 → 围挡保护 → 基层处理 → 节点修复 → 面层恢复 → 验收。",
      materials: "按基层和使用环境选型，满足相容、耐久及维护要求。",
      risk_controls: `${context.window}组织实施；${riskNotes.length ? riskNotes.join("；") : "执行常规施工安全、围挡和成品保护措施"}。`,
      acceptance: `过程与完工验收；目标：${context.target}。`
    } : {
      objective: `解决${context.location}的${context.problem}，恢复稳定运行。`,
      scope: `本次包含${context.scope}；明确不包含${context.excluded}。`,
      process: "现场复核与隔离 → 拆除/切换 → 安装接入 → 单机调试 → 系统联调。",
      materials: "与既有接口、容量和控制协议兼容，满足安全与维护要求。",
      risk_controls: `${context.window}组织实施；${riskNotes.length ? riskNotes.join("；") : "执行常规机电施工安全、隔离和恢复措施"}。`,
      acceptance: `完成安装、联动和试运行验收；目标：${context.target}。`
    };
    return (Object.keys(SCHEME_TITLES) as SchemeModuleKey[]).map((key) => {
      const content = generated[key] || templates[key]?.trim() || "";
      return { key, title: SCHEME_TITLES[key], content, basis: Object.values(context).filter(Boolean), confirmed: false, updatedAt: new Date().toISOString() };
    });
  }

  private buildCostSkeleton(session: InterviewSession): CostMatrixRow[] {
    const scope = scopeValue(this.activeAnswerMap(session.id).get("feasibility.scope_components"));
    const civil: Record<string, { itemName: string; unit: string }> = {
      main_object: { itemName: "主要对象修复改造", unit: "㎡" },
      connected_system: { itemName: "配套节点及连接处理", unit: "m" },
      base_support: { itemName: "基层、基础处理", unit: "㎡" },
      surface_restore: { itemName: "面层及装饰恢复", unit: "㎡" },
      protection: { itemName: "围挡与成品保护", unit: "项" },
      testing: { itemName: "检测与验收", unit: "项" }
    };
    const mep: Record<string, { itemName: string; unit: string }> = {
      main_object: { itemName: "主要设备或系统改造", unit: "台" },
      connected_system: { itemName: "配套管线、电缆及接驳", unit: "m" },
      base_support: { itemName: "基础及支吊架", unit: "项" },
      surface_restore: { itemName: "保温及装饰恢复", unit: "㎡" },
      protection: { itemName: "临时保障与成品保护", unit: "项" },
      testing: { itemName: "调试、检测与验收", unit: "项" }
    };
    const mapping = session.category === "civil_upgrade" ? civil : mep;
    const selected = (scope?.included ?? []).filter((value) => value !== "other");
    const rows = selected.map((value) => ({ key: value, ...mapping[value] })).filter((item) => item.itemName);
    if (scope?.other?.trim()) rows.push({ key: "other", itemName: scope.other.trim(), unit: "项" });
    return rows.map(({ key, itemName, unit }) => ({
      id: createId("cost"),
      type: "engineering",
      itemName,
      specification: "待现场测量/深化",
      unit,
      quantity: 0,
      unitPrice: 0,
      remark: `来自范围选择：${key === "other" ? "其他" : itemName}`
    }));
  }

  private buildBenchmark(session: InterviewSession, row: CostMatrixRow): HistoricalCostBenchmark {
    const normalize = (value: string) => value.toLowerCase().replace(/[\s、，,：:（）()]/g, "");
    const project = this.data.getProject(session.projectId);
    const cutoff = Date.now() - 24 * 31 * 24 * 60 * 60 * 1000;
    const candidates = this.data.listProjects()
      .filter((item) => item.category === session.category)
      .flatMap((item) => this.data.listVersions(item.id).map((version) => ({ project: item, version })))
      .filter(({ version }) => version.status === "human_approved" && version.id !== session.versionId)
      .flatMap(({ project: historicalProject, version }) => version.snapshot.costMatrixRows
        .filter((item) => item.unit === row.unit && (normalize(item.itemName).includes(normalize(row.itemName)) || normalize(row.itemName).includes(normalize(item.itemName))))
        .map((item) => ({ unitPrice: item.unitPrice, sameRegion: historicalProject.organizationId === project.organizationId, recent: new Date(version.createdAt).getTime() >= cutoff })))
      .filter((item) => item.unitPrice > 0);
    const primary = candidates.filter((item) => item.sameRegion && item.recent);
    const recent = candidates.filter((item) => item.recent);
    const selected = primary.length >= 3 ? primary : recent.length >= 3 ? recent : candidates;
    const prices = selected.map((item) => item.unitPrice);
    const comparisonScope = primary.length >= 3
      ? "同类别、同方案成本项、同单位、同城市、近24个月人工批准项目"
      : recent.length >= 3
        ? "同类别、同方案成本项、同单位、近24个月人工批准项目（城市样本不足，已扩大地域）"
        : candidates.length
          ? "同类别、同方案成本项、同单位历史人工批准项目（近24个月样本不足，已扩大时间）"
          : "暂无可比历史人工批准项目";
    if (!prices.length && row.referenceUnitPriceLow && row.referenceUnitPriceHigh) {
      return {
        itemName: row.itemName,
        unit: row.unit,
        sampleCount: 0,
        medianUnitPrice: roundMoney((row.referenceUnitPriceLow + row.referenceUnitPriceHigh) / 2),
        lowerUnitPrice: row.referenceUnitPriceLow,
        upperUnitPrice: row.referenceUnitPriceHigh,
        comparisonScope: "无历史成交样本，采用AI专业知识形成的前期市场估算",
        insufficientSample: true,
        source: "ai_market_estimate",
        basis: row.referencePriceBasis || "含税综合单价宽口径估算，具体以统一询价口径和供应商报价为准",
        asOf: row.referencePriceAsOf || new Date().toISOString().slice(0, 10),
        disclaimer: "仅用于立项估算和询价校核，不是供应商报价，不自动写入申报单价。"
      };
    }
    return {
      itemName: row.itemName,
      unit: row.unit,
      sampleCount: prices.length,
      medianUnitPrice: percentile(prices, 0.5),
      lowerUnitPrice: percentile(prices, 0.25),
      upperUnitPrice: percentile(prices, 0.75),
      comparisonScope,
      insufficientSample: prices.length < 3,
      source: "historical_approved",
      basis: comparisonScope,
      asOf: new Date().toISOString().slice(0, 10),
      disclaimer: "历史价格仅作校核，不自动写入申报单价。"
    };
  }

  private async completeDecision(session: InterviewSession, user: SessionUser): Promise<void> {
    const version = this.data.getVersion(session.versionId);
    const claimAttachmentIds = new Set(this.data.listEvidenceClaims(session.id).flatMap((claim) => claim.attachmentIds));
    const attachments = this.data.listAttachments(session.projectId).filter((item) => item.versionId === session.versionId || claimAttachmentIds.has(item.id));
    const parseResults = attachments.flatMap((attachment) => this.data.listParseResults(attachment.id));
    const duplicateMatches = findDuplicateProjects({ currentProjectId: session.projectId, snapshot: version.snapshot, records: this.buildDuplicateRecords(session.projectId) });
    const assessments = this.data.listStageAssessments(session.id).filter((item) => !item.invalidatedAt);
    const necessity = assessments.find((item) => item.stage === "necessity");
    const total = version.snapshot.budgetAmount;
    const outcome: DecisionOutcome = assessments.some((assessment) => assessment.tendency === "leaning_not_approved")
      ? "not_approved"
      : assessments.some((assessment) => assessment.tendency === "needs_information")
        ? "supplement_required"
        : "approved";
    const fallbackReasons = assessments.map((assessment) => assessment.summary).filter(Boolean).slice(0, 3);
    const reasons = fallbackReasons.length ? fallbackReasons : [necessity?.summary ?? "已按阶段判断和完整性规则形成结论"];
    const conditions = outcome === "supplement_required"
      ? [...new Set(assessments.flatMap((assessment) => assessment.missingFacts))].slice(0, 5)
      : [];
    const modelName = "deterministic-decision-orchestrator";
    const promptVersion = "decision-from-stage-results-v1";

    // 旧结构只继续服务兼容报告，不再参与本次业务结论。
    const compatibleReview = buildRuleBasedReview({
      projectId: session.projectId,
      versionId: session.versionId,
      snapshot: version.snapshot,
      attachments,
      parseResults,
      duplicateMatches
    });
    this.data.addAiReview({
      ...compatibleReview,
      verdict: outcome === "approved" ? "pass" : outcome === "not_approved" ? "fail" : "conditional_pass",
      conclusion: reasons.join("；"),
      modelName,
      promptVersion
    });

    const formalEnabled = process.env.PRODUCTION_FOUNDATION_READY === "true" && process.env.GUIDED_FORMAL_AUTO_APPROVAL === "true";
    const route = resolveGuidedApprovalRoute({ outcome, budgetAmount: total, formalAutoApprovalEnabled: formalEnabled });
    const status = route === "automatic" ? "effective" : "pending";
    const now = new Date().toISOString();
    const decision = this.data.createGuidedDecision({
      sessionId: session.id,
      outcome,
      route,
      status,
      reasons,
      conditions,
      decidedBy: "system",
      decidedAt: now,
      modelName,
      promptVersion,
      knowledgeReleaseId: session.knowledgeReleaseId
    });
    const nextStatus = route === "automatic" ? "human_approved" : outcome === "approved" ? "ai_recommended_pass" : outcome === "supplement_required" ? "ai_conditionally_passed" : "ai_returned";
    this.data.updateVersion(session.versionId, (item) => ({ ...item, status: nextStatus, aiReviewedAt: now, returnedAt: outcome === "not_approved" ? now : item.returnedAt }));
    this.data.updateProject(session.projectId, (item) => ({ ...item, status: nextStatus, updatedAt: now }));
    this.data.updateInterviewSession(session.id, (item) => ({ ...item, status: "completed", tendency: outcome === "approved" ? "leaning_approved" : outcome === "not_approved" ? "leaning_not_approved" : "needs_information", tendencyReasons: reasons, decisionId: decision.id, updatedAt: now }));
    if (route === "automatic") this.data.addDecision({ projectId: session.projectId, versionId: session.versionId, reviewerId: "system", decision: "approved", comment: "正式自动批准", decidedAt: now });
    this.data.addAuditLog({ actorId: user.id, projectId: session.projectId, versionId: session.versionId, action: "guided_decision_generated", detail: `结论：${outcome}；路径：${route}`, createdAt: now });
  }

  private completeAiFailure(session: InterviewSession, user: SessionUser, error: unknown): void {
    const now = new Date().toISOString();
    const reason = error instanceof Error ? error.message : "AI 连续失败";
    const decision = this.data.createGuidedDecision({ sessionId: session.id, outcome: "supplement_required", route: "manual_ai_failure", status: "pending", reasons: ["AI 连续失败，已保留全部进度并转人工"], conditions: [], decidedBy: "system", decidedAt: now, modelName: STAGE_MODEL, promptVersion: STAGE_PROMPT_VERSION, knowledgeReleaseId: session.knowledgeReleaseId });
    this.data.updateInterviewSession(session.id, (item) => ({ ...item, status: "manual_review", aiFailureReason: reason, decisionId: decision.id, updatedAt: now }));
    this.data.updateVersion(session.versionId, (item) => ({ ...item, status: "ai_conditionally_passed", aiReviewedAt: now }));
    this.data.updateProject(session.projectId, (item) => ({ ...item, status: "ai_conditionally_passed", updatedAt: now }));
    this.data.addAuditLog({ actorId: user.id, projectId: session.projectId, versionId: session.versionId, action: "guided_ai_failed_manual", detail: reason, createdAt: now });
  }

  private validateHardGates(session: InterviewSession): string[] {
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    const answers = this.activeAnswerMap(session.id);
    const questions = this.applicableQuestions(release, session.category, answers);
    const gaps: string[] = [];
    const gateQuestions = (session.guidedVersion ?? 1) === 2
      ? questions.filter((item) => ["necessity.problem_summary", "necessity.project_location"].includes(item.id))
      : questions;
    if (gateQuestions.some((item) => item.required && !answerHasValue(answers.get(item.id)))) gaps.push("仍有必答事实未完成");
    if (gateQuestions.some((item) => item.critical && answerIsUnknown(answers.get(item.id)))) gaps.push("关键事实选择了“不清楚”");
    if (!this.data.listEvidenceClaims(session.id).some((claim) => claim.attachmentIds.length > 0)) gaps.push("至少需要一项照片、工单、巡检、检测、投诉或设备记录证据");
    const evidenceAnswer = answers.get("necessity.problem_evidence_type")?.value;
    const selectedEvidence = Array.isArray(evidenceAnswer) ? evidenceAnswer.filter((item) => item !== "unknown") : [];
    const linkedTypes = new Set(this.data.listEvidenceClaims(session.id).map((claim) => claim.evidenceType));
    const missingEvidenceTypes = selectedEvidence.filter((evidenceType) => !linkedTypes.has(evidenceType as EvidenceClaim["evidenceType"]));
    if (missingEvidenceTypes.length) gaps.push("仍有已选证明材料尚未上传或分类");
    if (!session.schemeModules.length || session.schemeModules.some((item) => !item.confirmed)) gaps.push("推荐方案尚未按模块确认");
    const total = roundMoney(session.generatedCostRows.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0));
    if (!session.generatedCostRows.length || session.generatedCostRows.some((row) => !row.itemName || !row.unit || row.quantity <= 0 || row.unitPrice <= 0) || total <= 0) gaps.push("工程量清单尚未闭合");
    if (roundMoney(this.data.getVersion(session.versionId).snapshot.budgetAmount) !== total) gaps.push("申报预算与工程量清单合价不一致");
    return gaps;
  }

  private syncEvidenceClaims(session: InterviewSession): void {
    const claimAttachmentIds = new Set(this.data.listEvidenceClaims(session.id).flatMap((claim) => claim.attachmentIds));
    const attachments = this.data.listAttachments(session.projectId).filter((item) => item.versionId === session.versionId || claimAttachmentIds.has(item.id));
    const existing = this.data.listEvidenceClaims(session.id);
    const missing = attachments.filter((attachment) => !existing.some((claim) => claim.attachmentIds.includes(attachment.id)));
    if (!missing.length) return;
    const inferable = missing.filter((attachment) => attachment.slotKey === "issue_photos" || attachment.slotKey === "fault_registry");
    if (!inferable.length) return;
    const createdIds = inferable.map((attachment) => this.data.createEvidenceClaim({
      sessionId: session.id,
      factKey: "problem_exists",
      attachmentIds: [attachment.id],
      evidenceType: this.evidenceType(attachment)
    }).id);
    this.data.updateInterviewSession(session.id, (item) => ({ ...item, evidenceClaimIds: [...item.evidenceClaimIds, ...createdIds], updatedAt: new Date().toISOString() }));
  }

  private evidenceType(attachment: Attachment) {
    if (attachment.slotKey === "issue_photos" || attachment.kind === "image") return "photo" as const;
    if (attachment.slotKey === "fault_registry") return "inspection" as const;
    return "other" as const;
  }

  private writeFactsToSnapshot(sessionId: string): void {
    const session = this.data.getInterviewSession(sessionId);
    const answers = this.activeAnswerMap(sessionId);
    const version = this.data.getVersion(session.versionId);
    const location = locationValue(answers.get("necessity.project_location"));
    const scope = scopeValue(answers.get("feasibility.scope_components"));
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    const scopeQuestion = release.questions.find((question) => question.id === "feasibility.scope_components");
    const scopeText = (scope?.included ?? []).map((value) => scopeQuestion?.options?.find((option) => option.value === value)?.label ?? value).concat(scope?.other?.trim() ? [scope.other.trim()] : []).join("、");
    const evidenceValue = answers.get("necessity.problem_evidence_type")?.value;
    this.data.updateVersion(session.versionId, (item) => ({ ...item, snapshot: {
      ...item.snapshot,
      issueDescription: textValue(answers.get("necessity.problem_summary")) || item.snapshot.issueDescription,
      currentCondition: textValue(answers.get("necessity.problem_summary")) || item.snapshot.currentCondition,
      issueSourceDescription: Array.isArray(evidenceValue) ? evidenceValue.join("、") : "",
      implementationScope: session.confirmedScope || scopeText || item.snapshot.implementationScope,
      feasibilitySummary: `施工窗口：${textValue(answers.get("feasibility.execution_window"))}`,
      acceptancePlan: textValue(answers.get("feasibility.acceptance_target")) || item.snapshot.acceptancePlan,
      expectedBenefits: textValue(answers.get("necessity.consequence")) || item.snapshot.expectedBenefits,
      location: {
        ...item.snapshot.location,
        propertyName: location?.propertyName || item.snapshot.location.propertyName,
        building: location?.building || item.snapshot.location.building,
        floor: location?.floor || item.snapshot.location.floor,
        area: location?.area || item.snapshot.location.area,
        equipmentPoint: location?.point || item.snapshot.location.equipmentPoint,
        impactScope: session.confirmedScope || location?.impactScope || item.snapshot.location.impactScope
      },
      riskFlags: { ...item.snapshot.riskFlags, powerOrWaterShutdown: !["", "none"].includes(textValue(answers.get("feasibility.shutdown"))), fireSystemImpact: textValue(answers.get("feasibility.fire_impact")) === "yes", occupiedAreaImpact: textValue(answers.get("feasibility.occupied_impact")) === "yes", concealedWork: textValue(answers.get("feasibility.concealed_work")) === "yes", hotWork: textValue(answers.get("feasibility.hot_work")) === "yes", workingAtHeight: textValue(answers.get("feasibility.working_at_height")) === "yes", thirdPartyTesting: textValue(answers.get("feasibility.third_party_testing")) === "yes" }
    }}));
    if (version.snapshot.projectName !== this.data.getProject(session.projectId).title) return;
  }

  private writeSchemeToSnapshot(sessionId: string): void {
    const session = this.data.getInterviewSession(sessionId);
    const byKey = new Map(session.schemeModules.map((item) => [item.key, item.content]));
    const answers = this.activeAnswerMap(session.id);
    const enabled = (questionId: string) => textValue(answers.get(questionId)) === "yes";
    this.data.updateVersion(session.versionId, (item) => ({ ...item, snapshot: {
      ...item.snapshot,
      objective: byKey.get("objective") ?? "",
      implementationScope: byKey.get("scope") ?? "",
      keyProcess: byKey.get("process") ?? "",
      materialSelection: byKey.get("materials") ?? "",
      maintenancePlan: "按确认方案、设备说明和验收目标制定移交后的巡检与维护计划",
      feasibilitySummary: byKey.get("risk_controls") ?? "",
      acceptancePlan: byKey.get("acceptance") ?? "",
      hiddenWorksRequirement: enabled("feasibility.concealed_work") ? "隐蔽前完成验收记录和过程影像，验收合格后方可封闭" : "本项目未触发隐蔽工程专项要求",
      sampleFirstRequirement: "涉及观感、材料色差或节点做法时先施工样板，经确认后展开",
      detailDrawingRequirement: enabled("feasibility.concealed_work") || enabled("feasibility.fire_impact") ? "施工前补充关键节点和系统接口深化图" : "按现场放样及确认方案实施",
      thirdPartyTestingRequirement: enabled("feasibility.third_party_testing") ? "按访谈确认的验收目标委托第三方检测并提交报告" : "本项目未触发第三方检测专项要求",
      preliminaryPlan: session.schemeModules.map((module) => `${module.title}：${module.content}`).join("\n"),
      initialBudgetExplanation: "由确认方案生成工程量清单，并与历史人工批准项目进行相似价格比较",
      supplementaryNotes: "由智能访谈结构化生成"
    } }));
  }

  private buildView(sessionId: string, user: SessionUser) {
    const session = this.data.getInterviewSession(sessionId);
    const project = this.data.getProject(session.projectId);
    this.ensureAccess(user, project.organizationId);
    const release = this.data.getKnowledgeRelease(session.knowledgeReleaseId);
    const answers = this.data.listAnswerRecords(session.id).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
    const activeAnswers = answers.filter((item) => !item.supersededAt);
    const activeMap = new Map(activeAnswers.map((item) => [item.questionId, item]));
    const nextQuestion = release.questions.find((item) => item.id === session.nextQuestionId);
    const version = this.data.getVersion(session.versionId);
    const inheritedEvidenceIds = new Set(this.data.listEvidenceClaims(session.id).flatMap((claim) => claim.attachmentIds));
    const attachments = this.data.listAttachments(session.projectId).filter((item) => item.versionId === session.versionId || inheritedEvidenceIds.has(item.id));
    const total = roundMoney(session.generatedCostRows.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0));
    const requiredEvidence = activeAnswers.find((item) => item.questionId === "necessity.problem_evidence_type")?.value;
    const evidencePrompts = [
      Array.isArray(requiredEvidence) && requiredEvidence.includes("unknown") ? "请补充至少一项可证明问题存在的现场材料" : "按已选类型上传材料",
      activeMap.get("feasibility.fire_impact")?.value === "yes" ? "消防影响说明和临时保障措施" : "",
      activeMap.get("feasibility.hot_work")?.value === "yes" ? "动火作业审批和安全措施" : "",
      activeMap.get("feasibility.concealed_work")?.value === "yes" ? "隐蔽验收记录和过程影像计划" : "",
      activeMap.get("feasibility.working_at_height")?.value === "yes" ? "高处作业方案和防护措施" : "",
      activeMap.get("feasibility.third_party_testing")?.value === "yes" ? "第三方检测项目和验收标准" : ""
    ].filter(Boolean);
    const hardGateGaps = this.validateHardGates(session);
    const similarCases = this.data.getAggregate(session.projectId).aiReviews
      .find((item) => item.versionId === session.versionId)?.duplicateReview.matches ?? [];
    return {
      project: { ...project, currentVersionNumber: version.versionNumber },
      session,
      nextQuestion,
      understandingQuestion: session.necessityUnderstanding?.followUpQuestionId
        ? release.questions.find((item) => item.id === session.necessityUnderstanding?.followUpQuestionId)
        : undefined,
      supplementQuestions: (session.stageSupplement?.questionIds ?? [])
        .map((id) => release.questions.find((question) => question.id === id))
        .filter((question): question is QuestionDefinition => Boolean(question)),
      answeredQuestions: release.questions.filter((item) => activeMap.has(item.id)).map((question) => ({ question, answer: activeMap.get(question.id) })),
      answerHistory: answers,
      attachments,
      evidenceClaims: this.data.listEvidenceClaims(session.id),
      assessments: this.data.listStageAssessments(session.id).filter((item) => !item.invalidatedAt),
      similarCases,
      decision: session.decisionId ? this.data.getGuidedDecision(session.decisionId) : undefined,
      budget: { calculated: total, declared: version.snapshot.budgetAmount, closed: total > 0 && total === version.snapshot.budgetAmount },
      eligibility: this.eligibility(this.data.getAggregate(session.projectId)),
      hardGateGaps,
      submissionReady: hardGateGaps.length === 0 && session.status === "ready_to_submit",
      evidenceRequirement: evidencePrompts.join("；"),
      knowledge: { id: release.id, version: release.version, name: release.name },
      formalAutoApprovalEnabled: process.env.PRODUCTION_FOUNDATION_READY === "true" && process.env.GUIDED_FORMAL_AUTO_APPROVAL === "true"
    };
  }

  private activeAnswerMap(sessionId: string): Map<string, AnswerRecord> {
    return new Map(this.data.listAnswerRecords(sessionId).filter((item) => !item.supersededAt).map((item) => [item.questionId, item]));
  }

  private applicableQuestions(release: KnowledgeRelease, category: InterviewSession["category"], answers: Map<string, AnswerRecord>): QuestionDefinition[] {
    const necessityPriority = new Map([
      ["necessity.problem_summary", 0],
      ["necessity.project_location", 1],
      ["necessity.problem_evidence_type", 2]
    ]);
    return release.questions
      .filter((question) => question.categories.includes(category) && (!question.dependsOn || question.dependsOn.values.includes(textValue(answers.get(question.dependsOn.questionId)))))
      .sort((left, right) => (necessityPriority.get(left.id) ?? 99) - (necessityPriority.get(right.id) ?? 99));
  }

  private validateAnswer(question: QuestionDefinition, value: InterviewAnswerValue): void {
    if (question.responseType === "number" && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new BadRequestException("请输入有效数字");
    if (question.responseType === "single_choice" && !question.options?.some((item) => item.value === String(value))) throw new BadRequestException("答案必须来自已发布题目的可选项");
    if (question.responseType === "short_text" && String(value).trim().length < 2) throw new BadRequestException("请至少填写两个字");
    if (question.responseType === "multi_choice") {
      if (!Array.isArray(value) || !value.length) throw new BadRequestException("请至少选择一项");
      if (value.includes("unknown") && value.length > 1) throw new BadRequestException("“目前没有可用材料”不能与其他材料同时选择");
      if (value.some((item) => !question.options?.some((option) => option.value === item))) throw new BadRequestException("答案必须来自已发布题目的可选项");
    }
    if (question.responseType === "location_form") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("请填写项目位置");
      const location = value as ProjectLocationAnswer;
      if (!location.propertyName?.trim() || !location.point?.trim() || !location.impactScope) throw new BadRequestException("请填写管理项目、具体点位和影响范围");
      if (!["single_point", "partial_area", "building", "multi_building", "unknown"].includes(location.impactScope)) throw new BadRequestException("请选择有效的影响范围");
    }
    if (question.responseType === "fact_form") {
      if (!value || typeof value !== "object" || Array.isArray(value) || !("values" in value)) throw new BadRequestException("请填写补充事实");
      const values = (value as { values: Record<string, string | number> }).values ?? {};
      const required = question.formFields?.filter((field) => field.required) ?? [];
      if (required.some((field) => String(values[field.id] ?? "").trim().length === 0)) throw new BadRequestException("请完成标记为必填的补充事实");
      if (!Object.values(values).some((item) => String(item ?? "").trim().length > 0)) throw new BadRequestException("请至少填写一项补充事实");
    }
    if (question.responseType === "scope_selector") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("请选择改造范围");
      const scope = value as ScopeSelectionAnswer;
      if (!Array.isArray(scope.included) || !scope.included.length) throw new BadRequestException("请至少选择一个改造部分");
      if (scope.included.includes("other") && !scope.other?.trim()) throw new BadRequestException("请填写其他改造内容");
      if (scope.included.some((item) => !question.options?.some((option) => option.value === item))) throw new BadRequestException("改造范围必须来自已发布选项");
    }
  }

  private validateKnowledge(release: KnowledgeRelease): string[] {
    const errors: string[] = [];
    const ids = new Set<string>();
    const questions = release.questions ?? [];
    const categories = release.categories ?? [];
    if (!questions.length) errors.push("知识版本没有受控题目");
    if (!release.schemeTemplates || !Object.keys(release.schemeTemplates).length) errors.push("知识版本没有方案模块");
    Object.entries(release.schemeTemplates ?? {}).forEach(([category, modules]) => {
      Object.entries(modules ?? {}).forEach(([key, content]) => {
        if (!String(content ?? "").trim()) errors.push(`方案模块为空：${category}.${key}`);
        if (/xxx/i.test(String(content ?? ""))) errors.push(`方案模块仍含占位符：${category}.${key}`);
      });
    });
    questions.forEach((question) => {
      if (ids.has(question.id)) errors.push(`题目ID重复：${question.id}`);
      ids.add(question.id);
      if (["single_choice", "multi_choice", "scope_selector"].includes(question.responseType) && !question.options?.length) errors.push(`选择题缺少选项：${question.id}`);
      if (question.responseType === "fact_form" && !question.formFields?.length) errors.push(`补充事实卡缺少字段：${question.id}`);
      if (!question.categories.length) errors.push(`题目没有适用类别：${question.id}`);
      if (!question.factKey.trim()) errors.push(`题目没有事实键：${question.id}`);
    });
    questions.forEach((question) => {
      if (!question.dependsOn) return;
      const parent = questions.find((item) => item.id === question.dependsOn?.questionId);
      if (!parent) {
        errors.push(`触发题不存在：${question.id}`);
        return;
      }
      const parentValues = new Set(parent.options?.map((item) => item.value) ?? []);
      if (!question.dependsOn.values.length || question.dependsOn.values.some((value) => !parentValues.has(value))) errors.push(`触发值不可达：${question.id}`);
    });
    categories.forEach((category) => { if (!questions.some((question) => question.categories.includes(category))) errors.push(`类别没有可用问题：${category}`); });
    return errors;
  }

  private ensurePublishedKnowledge(createdBy: string): KnowledgeRelease {
    const existing = this.data.listKnowledgeReleases().filter((item) => item.status === "published").sort((a, b) => b.version - a.version)[0];
    if (existing?.questions.some((question) => question.id === "necessity.condition_history")) return existing;
    const now = new Date().toISOString();
    const upgraded = buildInitialKnowledgeRelease(createdBy, now);
    return this.data.createKnowledgeRelease({
      ...upgraded,
      version: (existing?.version ?? 0) + 1,
      name: "工程智能访谈 · 通用补充事实版",
      changeNote: "AI理解只确认一次；按工程类别生成通用补充事实卡；支持服务端自动暂存和断点恢复。"
    });
  }

  private eligibility(aggregate: ProjectAggregate) {
    return calculateSubmissionEligibility({ policy: this.data.getQuotaPolicy(), ledger: this.data.listQuotaLedger(), overrides: aggregate.overrides, versions: aggregate.versions, organizationId: aggregate.project.organizationId, currentStatus: aggregate.project.status });
  }

  private buildDuplicateRecords(projectId: string): DuplicateComparisonRecord[] {
    return this.data.listProjects().flatMap((project) => this.data.listVersions(project.id).map((version) => ({ projectId: project.id, projectTitle: project.title, projectCategory: project.category, versionId: version.id, versionNumber: version.versionNumber, status: version.status, createdAt: version.createdAt, snapshot: version.snapshot }))).filter((record) => record.projectId !== projectId);
  }

  private getAccessibleAggregate(projectId: string, user: SessionUser): ProjectAggregate {
    const aggregate = this.data.getAggregate(projectId);
    this.ensureAccess(user, aggregate.project.organizationId);
    return aggregate;
  }

  private ensureAccess(user: SessionUser, organizationId: string): void {
    if (user.role === "submitter" && user.organizationId !== organizationId) throw new ForbiddenException("无权访问该项目");
  }

  private ensureSubmitter(user: SessionUser): void {
    if (user.role !== "submitter") throw new ForbiddenException("只有申报人可以填写和送审");
  }

  private ensureAdmin(user: SessionUser): void {
    if (user.role !== "admin") throw new ForbiddenException("只有管理员可以维护知识版本");
  }
}
