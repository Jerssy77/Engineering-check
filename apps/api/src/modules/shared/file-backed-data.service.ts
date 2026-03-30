import { existsSync } from "node:fs";

import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AIReviewResult,
  Attachment,
  AttachmentParseResult,
  AuditLog,
  DEFAULT_QUOTA_POLICY,
  HumanDecision,
  Organization,
  OverrideGrant,
  Project,
  ProjectAggregate,
  ProjectVersion,
  QuotaPolicy,
  QuotaUsageLedger,
  SessionUser,
  User,
  createId
} from "@property-review/shared";

import { DemoDataService } from "./demo-data.service";
import {
  ensureDirectory,
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
    quotaPolicy: raw?.quotaPolicy ?? { ...DEFAULT_QUOTA_POLICY }
  };
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
    const loaded = normalizeState(readJsonFile<Partial<StoreState>>(this.dataFilePath));
    if (existsSync(this.dataFilePath)) {
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

  addAuditLog(log: Omit<AuditLog, "id">): AuditLog {
    const created: AuditLog = { ...log, id: createId("audit") };
    this.state.auditLogs.push(created);
    this.persist();
    return created;
  }
}
