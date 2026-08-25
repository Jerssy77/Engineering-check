import { existsSync } from "node:fs";

import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AIReviewResult,
  Attachment,
  AttachmentParseResult,
  AuditLog,
  AIUsageRecord,
  AnswerRecord,
  DEFAULT_QUOTA_POLICY,
  EvidenceClaim,
  GuidedDecision,
  HumanDecision,
  InterviewSession,
  KnowledgeRelease,
  Organization,
  OverrideGrant,
  Project,
  ProjectAggregate,
  ProjectVersion,
  QuotaPolicy,
  QuotaUsageLedger,
  SessionUser,
  StageAssessment,
  StoredAIProviderConfig,
  User,
  createId
} from "@property-review/shared";

import { DemoDataService } from "./demo-data.service";
import {
  ensureDirectory,
  normalizeLatin1Utf8Text,
  readJsonFile,
  resolveDataFilePath,
  resolveUploadDirPath,
  writeJsonAtomic
} from "./storage-paths";

interface StoreState {
  organizations: Organization[];
  users: User[];
  projects: Project[];
  versions: ProjectVersion[];
  attachments: Attachment[];
  parseResults: AttachmentParseResult[];
  aiReviews: AIReviewResult[];
  decisions: HumanDecision[];
  overrides: OverrideGrant[];
  quotaLedger: QuotaUsageLedger[];
  auditLogs: AuditLog[];
  aiUsageRecords: AIUsageRecord[];
  interviewSessions: InterviewSession[];
  answerRecords: AnswerRecord[];
  evidenceClaims: EvidenceClaim[];
  stageAssessments: StageAssessment[];
  guidedDecisions: GuidedDecision[];
  knowledgeReleases: KnowledgeRelease[];
  aiProviderConfig?: StoredAIProviderConfig;
  quotaPolicy: QuotaPolicy;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeState(raw: Partial<StoreState> | undefined): StoreState {
  return {
    organizations: raw?.organizations ?? [],
    users: raw?.users ?? [],
    projects: raw?.projects ?? [],
    versions: raw?.versions ?? [],
    attachments: raw?.attachments ?? [],
    parseResults: raw?.parseResults ?? [],
    aiReviews: raw?.aiReviews ?? [],
    decisions: raw?.decisions ?? [],
    overrides: raw?.overrides ?? [],
    quotaLedger: raw?.quotaLedger ?? [],
    auditLogs: raw?.auditLogs ?? [],
    aiUsageRecords: raw?.aiUsageRecords ?? [],
    interviewSessions: raw?.interviewSessions ?? [],
    answerRecords: raw?.answerRecords ?? [],
    evidenceClaims: raw?.evidenceClaims ?? [],
    stageAssessments: raw?.stageAssessments ?? [],
    guidedDecisions: raw?.guidedDecisions ?? [],
    knowledgeReleases: raw?.knowledgeReleases ?? [],
    aiProviderConfig: raw?.aiProviderConfig,
    quotaPolicy: raw?.quotaPolicy ?? { ...DEFAULT_QUOTA_POLICY }
  };
}

function repairMojibake<T>(value: T, parentKey?: string): T {
  if (typeof value === "string") {
    return (parentKey === "storageKey" ? value : normalizeLatin1Utf8Text(value)) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => repairMojibake(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, repairMojibake(nestedValue, key)])
    ) as T;
  }
  return value;
}

function repairStateText(state: StoreState): StoreState {
  return repairMojibake(state);
}

function buildSeedState(): StoreState {
  const seed = new DemoDataService();
  const projects = seed.listProjects();

  return {
    organizations: seed.getOrganizations(),
    users: seed.getUsers(),
    projects,
    versions: seed.listVersions(),
    attachments: seed.listAttachments(),
    parseResults: seed.listParseResults(),
    aiReviews: projects.flatMap((project) => seed.getAggregate(project.id).aiReviews),
    decisions: projects.flatMap((project) => seed.getAggregate(project.id).humanDecisions),
    overrides: seed.listOverrides(),
    quotaLedger: seed.listQuotaLedger(),
    auditLogs: seed.listAuditLogs(),
    aiUsageRecords: [],
    interviewSessions: [],
    answerRecords: [],
    evidenceClaims: [],
    stageAssessments: [],
    guidedDecisions: [],
    knowledgeReleases: [],
    aiProviderConfig: undefined,
    quotaPolicy: seed.getQuotaPolicy()
  };
}

@Injectable()
export class FileBackedDataService {
  private readonly dataFilePath = resolveDataFilePath();
  private readonly uploadDirPath = resolveUploadDirPath();
  private state: StoreState;

  constructor() {
    ensureDirectory(this.uploadDirPath);
    this.state = this.loadState();
  }

  private loadState(): StoreState {
    const rawState = normalizeState(readJsonFile<Partial<StoreState>>(this.dataFilePath));
    const loaded = repairStateText(rawState);
    if (existsSync(this.dataFilePath)) {
      if (JSON.stringify(rawState) !== JSON.stringify(loaded)) {
        writeJsonAtomic(this.dataFilePath, loaded);
      }
      return loaded;
    }

    const seed = buildSeedState();
    writeJsonAtomic(this.dataFilePath, seed);
    return seed;
  }

  private persist(): void {
    writeJsonAtomic(this.dataFilePath, this.state);
  }

  exportState(): StoreState {
    return deepClone(this.state);
  }

  getUploadDirPath(): string {
    return this.uploadDirPath;
  }

  getQuotaPolicy(): QuotaPolicy { return this.state.quotaPolicy; }
  getOrganizations(): Organization[] { return this.state.organizations; }
  getUsers(): User[] { return this.state.users; }
  findUserByUsername(username: string): User | undefined { return this.state.users.find((item) => item.username === username); }

  getSessionUser(userId: string): SessionUser {
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) throw new NotFoundException("用户不存在");
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, organizationId: user.organizationId };
  }

  getProject(projectId: string): Project {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) throw new NotFoundException("立项不存在");
    return project;
  }

  getVersion(versionId: string): ProjectVersion {
    const version = this.state.versions.find((item) => item.id === versionId);
    if (!version) throw new NotFoundException("版本不存在");
    return version;
  }

  getAttachment(attachmentId: string): Attachment {
    const attachment = this.state.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new NotFoundException("附件不存在");
    return attachment;
  }

  getAggregate(projectId: string): ProjectAggregate {
    return {
      project: this.getProject(projectId),
      versions: this.state.versions.filter((item) => item.projectId === projectId),
      attachments: this.state.attachments.filter((item) => item.projectId === projectId),
      attachmentParseResults: this.state.parseResults.filter((item) => this.state.attachments.some((attachment) => attachment.id === item.attachmentId && attachment.projectId === projectId)),
      aiReviews: this.state.aiReviews.filter((item) => item.projectId === projectId),
      humanDecisions: this.state.decisions.filter((item) => item.projectId === projectId),
      overrides: this.state.overrides.filter((item) => item.projectId === projectId)
    };
  }

  listProjects(): Project[] { return this.state.projects; }
  listVersions(projectId?: string): ProjectVersion[] { return projectId ? this.state.versions.filter((item) => item.projectId === projectId) : this.state.versions; }
  listAttachments(projectId?: string, versionId?: string): Attachment[] { return this.state.attachments.filter((item) => (!projectId || item.projectId === projectId) && (!versionId || item.versionId === versionId)); }
  listParseResults(attachmentId?: string): AttachmentParseResult[] { return attachmentId ? this.state.parseResults.filter((item) => item.attachmentId === attachmentId) : this.state.parseResults; }
  listQuotaLedger(): QuotaUsageLedger[] { return this.state.quotaLedger; }
  listOverrides(projectId?: string): OverrideGrant[] { return projectId ? this.state.overrides.filter((item) => item.projectId === projectId) : this.state.overrides; }
  listAuditLogs(projectId?: string): AuditLog[] { return projectId ? this.state.auditLogs.filter((item) => item.projectId === projectId) : this.state.auditLogs; }
  listAIUsageRecords(): AIUsageRecord[] { return deepClone(this.state.aiUsageRecords); }
  listInterviewSessions(projectId?: string): InterviewSession[] { return projectId ? this.state.interviewSessions.filter((item) => item.projectId === projectId) : this.state.interviewSessions; }
  listAnswerRecords(sessionId?: string): AnswerRecord[] { return sessionId ? this.state.answerRecords.filter((item) => item.sessionId === sessionId) : this.state.answerRecords; }
  listEvidenceClaims(sessionId?: string): EvidenceClaim[] { return sessionId ? this.state.evidenceClaims.filter((item) => item.sessionId === sessionId) : this.state.evidenceClaims; }
  listStageAssessments(sessionId?: string): StageAssessment[] { return sessionId ? this.state.stageAssessments.filter((item) => item.sessionId === sessionId) : this.state.stageAssessments; }
  listGuidedDecisions(sessionId?: string): GuidedDecision[] { return sessionId ? this.state.guidedDecisions.filter((item) => item.sessionId === sessionId) : this.state.guidedDecisions; }
  listKnowledgeReleases(): KnowledgeRelease[] { return this.state.knowledgeReleases; }

  getInterviewSession(sessionId: string): InterviewSession {
    const session = this.state.interviewSessions.find((item) => item.id === sessionId);
    if (!session) throw new NotFoundException("访谈会话不存在");
    return session;
  }

  getGuidedDecision(decisionId: string): GuidedDecision {
    const decision = this.state.guidedDecisions.find((item) => item.id === decisionId);
    if (!decision) throw new NotFoundException("智能决策不存在");
    return decision;
  }

  getKnowledgeRelease(releaseId: string): KnowledgeRelease {
    const release = this.state.knowledgeReleases.find((item) => item.id === releaseId);
    if (!release) throw new NotFoundException("知识版本不存在");
    return release;
  }

  createProject(project: Omit<Project, "id">): Project {
    const created: Project = { ...project, id: createId("project") };
    this.state.projects.push(created);
    this.persist();
    return created;
  }

  updateProject(projectId: string, updater: (current: Project) => Project): Project {
    const index = this.state.projects.findIndex((item) => item.id === projectId);
    if (index < 0) throw new NotFoundException("立项不存在");
    const updated = updater(this.state.projects[index]);
    this.state.projects[index] = updated;
    this.persist();
    return updated;
  }

  createVersion(version: Omit<ProjectVersion, "id">): ProjectVersion {
    const created: ProjectVersion = { ...version, id: createId("version") };
    this.state.versions.push(created);
    this.persist();
    return created;
  }

  updateVersion(versionId: string, updater: (current: ProjectVersion) => ProjectVersion): ProjectVersion {
    const index = this.state.versions.findIndex((item) => item.id === versionId);
    if (index < 0) throw new NotFoundException("版本不存在");
    const updated = updater(this.state.versions[index]);
    this.state.versions[index] = updated;
    this.persist();
    return updated;
  }

  createAttachment(attachment: Omit<Attachment, "id">): Attachment {
    const created: Attachment = { ...attachment, id: createId("attachment") };
    this.state.attachments.push(created);
    this.persist();
    return created;
  }

  deleteAttachment(attachmentId: string): Attachment {
    const attachment = this.getAttachment(attachmentId);
    this.state.attachments = this.state.attachments.filter((item) => item.id !== attachmentId);
    this.state.parseResults = this.state.parseResults.filter((item) => item.attachmentId !== attachmentId);
    const emptiedClaimIds: string[] = [];
    this.state.evidenceClaims = this.state.evidenceClaims
      .map((claim) => ({ ...claim, attachmentIds: claim.attachmentIds.filter((id) => id !== attachmentId) }))
      .filter((claim) => {
        if (claim.attachmentIds.length) return true;
        emptiedClaimIds.push(claim.id);
        return false;
      });
    if (emptiedClaimIds.length) {
      this.state.interviewSessions = this.state.interviewSessions.map((session) => ({
        ...session,
        evidenceClaimIds: session.evidenceClaimIds.filter((id) => !emptiedClaimIds.includes(id))
      }));
    }
    this.persist();
    return attachment;
  }

  createParseResult(parseResult: Omit<AttachmentParseResult, "id">): AttachmentParseResult {
    const created: AttachmentParseResult = { ...parseResult, id: createId("parse") };
    this.state.parseResults.push(created);
    this.persist();
    return created;
  }

  addAiReview(review: Omit<AIReviewResult, "id">): AIReviewResult {
    this.state.aiReviews = this.state.aiReviews.filter((item) => item.versionId !== review.versionId);
    const created: AIReviewResult = { ...review, id: createId("review") };
    this.state.aiReviews.push(created);
    this.persist();
    return created;
  }

  addDecision(decision: Omit<HumanDecision, "id">): HumanDecision {
    this.state.decisions = this.state.decisions.filter((item) => item.versionId !== decision.versionId);
    const created: HumanDecision = { ...decision, id: createId("decision") };
    this.state.decisions.push(created);
    this.persist();
    return created;
  }

  addQuotaUsage(entry: Omit<QuotaUsageLedger, "id">): QuotaUsageLedger {
    const created: QuotaUsageLedger = { ...entry, id: createId("quota") };
    this.state.quotaLedger.push(created);
    this.persist();
    return created;
  }

  removeQuotaUsage(projectId: string, versionId: string): void {
    const nextLedger = this.state.quotaLedger.filter(
      (item) => item.projectId !== projectId || item.versionId !== versionId
    );
    if (nextLedger.length === this.state.quotaLedger.length) {
      return;
    }

    this.state.quotaLedger = nextLedger;
    this.persist();
  }

  removeQuotaUsageByOrganizationAndRange(organizationId: string, startIso: string, endIso: string): number {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const nextLedger = this.state.quotaLedger.filter((item) => {
      if (item.organizationId !== organizationId) return true;
      const consumedAt = new Date(item.consumedAt);
      return consumedAt < start || consumedAt > end;
    });
    const removedCount = this.state.quotaLedger.length - nextLedger.length;
    if (removedCount <= 0) {
      return 0;
    }
    this.state.quotaLedger = nextLedger;
    this.persist();
    return removedCount;
  }

  addOverride(overrideRecord: Omit<OverrideGrant, "id">): OverrideGrant {
    const created: OverrideGrant = { ...overrideRecord, id: createId("override") };
    this.state.overrides.push(created);
    this.persist();
    return created;
  }

  markOverrideUsed(overrideId: string, usedAt: string): OverrideGrant {
    const index = this.state.overrides.findIndex((item) => item.id === overrideId);
    if (index < 0) throw new NotFoundException("特批记录不存在");
    const updated = { ...this.state.overrides[index], used: true, usedAt };
    this.state.overrides[index] = updated;
    this.persist();
    return updated;
  }

  releaseOverride(overrideId: string): OverrideGrant {
    const index = this.state.overrides.findIndex((item) => item.id === overrideId);
    if (index < 0) throw new NotFoundException("Override record not found");
    const updated = { ...this.state.overrides[index], used: false, usedAt: undefined };
    this.state.overrides[index] = updated;
    this.persist();
    return updated;
  }

  createInterviewSession(session: Omit<InterviewSession, "id">): InterviewSession {
    const created: InterviewSession = { ...session, id: createId("interview") };
    this.state.interviewSessions.push(created);
    this.persist();
    return created;
  }

  updateInterviewSession(sessionId: string, updater: (current: InterviewSession) => InterviewSession): InterviewSession {
    const index = this.state.interviewSessions.findIndex((item) => item.id === sessionId);
    if (index < 0) throw new NotFoundException("访谈会话不存在");
    const updated = updater(this.state.interviewSessions[index]);
    this.state.interviewSessions[index] = updated;
    this.persist();
    return updated;
  }

  createAnswerRecord(answer: Omit<AnswerRecord, "id">): AnswerRecord {
    const created: AnswerRecord = { ...answer, id: createId("answer") };
    this.state.answerRecords.push(created);
    this.persist();
    return created;
  }

  supersedeAnswerRecord(answerId: string, supersededAt: string): AnswerRecord {
    const index = this.state.answerRecords.findIndex((item) => item.id === answerId);
    if (index < 0) throw new NotFoundException("访谈答案不存在");
    const updated = { ...this.state.answerRecords[index], supersededAt };
    this.state.answerRecords[index] = updated;
    this.persist();
    return updated;
  }

  createEvidenceClaim(claim: Omit<EvidenceClaim, "id">): EvidenceClaim {
    const created: EvidenceClaim = { ...claim, id: createId("evidence") };
    this.state.evidenceClaims.push(created);
    this.persist();
    return created;
  }

  updateEvidenceClaim(claimId: string, updater: (current: EvidenceClaim) => EvidenceClaim): EvidenceClaim {
    const index = this.state.evidenceClaims.findIndex((item) => item.id === claimId);
    if (index < 0) throw new NotFoundException("证据声明不存在");
    const updated = updater(this.state.evidenceClaims[index]);
    this.state.evidenceClaims[index] = updated;
    this.persist();
    return updated;
  }

  replaceStageAssessment(assessment: Omit<StageAssessment, "id">): StageAssessment {
    const now = assessment.generatedAt;
    this.state.stageAssessments = this.state.stageAssessments.map((item) =>
      item.sessionId === assessment.sessionId && item.stage === assessment.stage && !item.invalidatedAt
        ? { ...item, invalidatedAt: now }
        : item
    );
    const created: StageAssessment = { ...assessment, id: createId("assessment") };
    this.state.stageAssessments.push(created);
    this.persist();
    return created;
  }

  invalidateStageAssessments(sessionId: string, stages: StageAssessment["stage"][], invalidatedAt: string): void {
    this.state.stageAssessments = this.state.stageAssessments.map((item) =>
      item.sessionId === sessionId && stages.includes(item.stage) && !item.invalidatedAt
        ? { ...item, invalidatedAt }
        : item
    );
    this.persist();
  }

  createGuidedDecision(decision: Omit<GuidedDecision, "id">): GuidedDecision {
    const created: GuidedDecision = { ...decision, id: createId("guided_decision") };
    this.state.guidedDecisions.push(created);
    this.persist();
    return created;
  }

  updateGuidedDecision(decisionId: string, updater: (current: GuidedDecision) => GuidedDecision): GuidedDecision {
    const index = this.state.guidedDecisions.findIndex((item) => item.id === decisionId);
    if (index < 0) throw new NotFoundException("智能决策不存在");
    const updated = updater(this.state.guidedDecisions[index]);
    this.state.guidedDecisions[index] = updated;
    this.persist();
    return updated;
  }

  createKnowledgeRelease(release: Omit<KnowledgeRelease, "id">): KnowledgeRelease {
    const created: KnowledgeRelease = { ...release, id: createId("knowledge") };
    this.state.knowledgeReleases.push(created);
    this.persist();
    return created;
  }

  updateKnowledgeRelease(releaseId: string, updater: (current: KnowledgeRelease) => KnowledgeRelease): KnowledgeRelease {
    const index = this.state.knowledgeReleases.findIndex((item) => item.id === releaseId);
    if (index < 0) throw new NotFoundException("知识版本不存在");
    const updated = updater(this.state.knowledgeReleases[index]);
    this.state.knowledgeReleases[index] = updated;
    this.persist();
    return updated;
  }

  getAIProviderConfig(): StoredAIProviderConfig | undefined {
    return this.state.aiProviderConfig ? deepClone(this.state.aiProviderConfig) : undefined;
  }

  setAIProviderConfig(config: StoredAIProviderConfig): StoredAIProviderConfig {
    this.state.aiProviderConfig = deepClone(config);
    this.persist();
    return deepClone(config);
  }

  addAuditLog(log: Omit<AuditLog, "id">): AuditLog {
    const created: AuditLog = { ...log, id: createId("audit") };
    this.state.auditLogs.push(created);
    this.persist();
    return created;
  }

  addAIUsageRecord(record: Omit<AIUsageRecord, "id">): AIUsageRecord {
    const created: AIUsageRecord = { ...record, id: createId("ai_usage") };
    this.state.aiUsageRecords.push(created);
    this.persist();
    return deepClone(created);
  }
}
