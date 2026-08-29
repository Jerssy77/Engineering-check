"use client";

import {
  AnswerRecord,
  Attachment,
  CostMatrixRow,
  DuplicateRemodelingMatch,
  EvidenceClaim,
  GuidedDecision,
  InterviewAnswerValue,
  InterviewSession,
  FactFormAnswer,
  ProjectLocationAnswer,
  QuestionDefinition,
  ScopeSelectionAnswer,
  SchemeModule,
  SchemeOption,
  StageAssessment
} from "@property-review/shared";
import { ArrowLeftOutlined, CheckCircleOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, InboxOutlined, PlusOutlined, SendOutlined, SyncOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import type { UploadProps } from "antd";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiRequest } from "../../../../../lib/api";
import { prepareFileForUpload } from "../../../../../lib/image-compression";
import { formatCurrency } from "../../../../../lib/presentation";
import { getSession } from "../../../../../lib/session";

interface InterviewView {
  project: { id: string; title: string; category: string; currentVersionNumber: number };
  session: InterviewSession;
  nextQuestion?: QuestionDefinition;
  understandingQuestion?: QuestionDefinition;
  supplementQuestions: QuestionDefinition[];
  answeredQuestions: Array<{ question: QuestionDefinition; answer: AnswerRecord }>;
  answerHistory: AnswerRecord[];
  attachments: Attachment[];
  evidenceClaims: EvidenceClaim[];
  assessments: StageAssessment[];
  similarCases: DuplicateRemodelingMatch[];
  decision?: GuidedDecision;
  budget: { calculated: number; declared: number; closed: boolean };
  eligibility: { allowed: boolean; reason?: string; remainingWeeklyQuota: number; blockedUntil?: string };
  hardGateGaps: string[];
  submissionReady: boolean;
  evidenceRequirement: string;
  knowledge: { id: string; version: number; name: string };
  formalAutoApprovalEnabled: boolean;
}

const stageItems = [
  { title: "必要性" },
  { title: "可行性" },
  { title: "方案" },
  { title: "工程量与询价" },
  { title: "决策" }
];
const stageIndex: Record<string, number> = { necessity: 0, feasibility: 1, scheme: 2, cost: 3, decision: 4 };
const tendencyLabels = { leaning_approved: "倾向批准", needs_information: "需要补充", leaning_not_approved: "倾向不批准" };
const tendencyColors = { leaning_approved: "green", needs_information: "orange", leaning_not_approved: "red" };
const outcomeLabels = { approved: "批准", supplement_required: "需要补充", not_approved: "不批准" };
const routeLabels = { shadow_human: "影子审批 · 待人工确认", human_budget: "预算超过20万元 · 转人工批准", automatic: "正式自动批准", manual_ai_failure: "AI故障 · 转人工" };
const evidenceTypeLabels: Record<EvidenceClaim["evidenceType"], string> = { photo: "现场照片", work_order: "工单/报修记录", inspection: "巡检记录", test: "检测/运行数据", complaint: "投诉记录", equipment_record: "设备报警/维保记录", other: "其他补充证据" };
const impactOptions = [
  { value: "single_point", label: "单点/单台" },
  { value: "partial_area", label: "局部区域/单系统" },
  { value: "building", label: "整栋/主要功能区" },
  { value: "multi_building", label: "多楼栋/大范围" },
  { value: "unknown", label: "暂不清楚" }
];
const reasonOptions = [
  { value: "confirm_ai_conclusion", label: "确认智能结论" },
  { value: "evidence_sufficient", label: "证据充分" },
  { value: "evidence_insufficient", label: "证据不足" },
  { value: "necessity_insufficient", label: "立项必要性不足" },
  { value: "scheme_risk", label: "方案风险未闭合" },
  { value: "budget_over_threshold", label: "预算超过授权范围" },
  { value: "compliance_or_safety_risk", label: "合规或安全风险" },
  { value: "material_conflict", label: "事实与材料矛盾" },
  { value: "other_manual_judgement", label: "其他人工专业判断" }
];

function evidenceSlot(file: File, selectedEvidence?: string): "issue_photos" | "fault_registry" | "supplementary" {
  if (selectedEvidence === "photo" && file.type.startsWith("image/")) return "issue_photos";
  if (selectedEvidence === "inspection" && /\.(xls|xlsx|csv)$/i.test(file.name)) return "fault_registry";
  return "supplementary";
}

function emptyAnswer(question?: QuestionDefinition): InterviewAnswerValue {
  if (question?.responseType === "multi_choice") return [];
  if (question?.responseType === "location_form") return { propertyName: "", building: "", floor: "", area: "", point: "", impactScope: "single_point" } satisfies ProjectLocationAnswer;
  if (question?.responseType === "scope_selector") return { included: [] } satisfies ScopeSelectionAnswer;
  if (question?.responseType === "fact_form") return { values: {} } satisfies FactFormAnswer;
  return "";
}

function answerReady(value: InterviewAnswerValue): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    if ("propertyName" in value) return Boolean(value.propertyName.trim() && value.point.trim() && value.impactScope);
    if ("values" in value) return Object.values(value.values).some((item) => String(item ?? "").trim().length > 0);
    return value.included.length > 0 && (!value.included.includes("other") || Boolean(value.other?.trim()));
  }
  return String(value).trim().length > 0;
}

function answerSummary(question: QuestionDefinition, value: InterviewAnswerValue): string {
  if (Array.isArray(value)) return value.map((item) => question.options?.find((option) => option.value === item)?.label ?? item).join("、");
  if (typeof value === "object" && "propertyName" in value) return [value.propertyName, value.building, value.floor, value.area, value.point].filter(Boolean).join(" / ");
  if (typeof value === "object" && "values" in value) return Object.values(value.values).filter((item) => String(item ?? "").trim()).join("；");
  if (typeof value === "object") return value.included.map((item) => question.options?.find((option) => option.value === item)?.label ?? item).concat(value.other ? [value.other] : []).join("、");
  return question.options?.find((option) => option.value === String(value))?.label ?? String(value);
}

function FactFormFields({ question, value, onChange }: { question: QuestionDefinition; value: InterviewAnswerValue; onChange: (value: InterviewAnswerValue) => void }) {
  const form: FactFormAnswer = typeof value === "object" && !Array.isArray(value) && "values" in value ? value : { values: {} };
  const setField = (id: string, fieldValue: string | number) => onChange({ values: { ...form.values, [id]: fieldValue } });
  return <div className="compact-form-grid">
    {question.formFields?.map((field) => <label key={field.id}><span>{field.label}{field.unit ? `（${field.unit}）` : ""}</span>
      {field.inputType === "number" ? <InputNumber min={0} value={Number(form.values[field.id] ?? 0) || undefined} onChange={(next) => setField(field.id, Number(next ?? 0))} placeholder={field.placeholder} style={{ width: "100%" }} />
        : field.inputType === "select" ? <Select value={String(form.values[field.id] ?? "") || undefined} options={field.options?.map((option) => ({ value: option.value, label: option.label }))} onChange={(next) => setField(field.id, next)} placeholder={field.placeholder ?? "请选择"} />
          : <Input value={String(form.values[field.id] ?? "")} onChange={(event) => setField(field.id, event.target.value)} placeholder={field.placeholder} />}
    </label>)}
  </div>;
}

function AnswerFields({ question, value, onChange }: { question: QuestionDefinition; value: InterviewAnswerValue; onChange: (value: InterviewAnswerValue) => void }) {
  if (question.responseType === "single_choice") return <Radio.Group value={value} onChange={(event) => onChange(event.target.value)} className="answer-choice-grid">
    {question.options?.map((option) => <Radio.Button key={option.value} value={option.value}><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</Radio.Button>)}
  </Radio.Group>;
  if (question.responseType === "multi_choice") return <Checkbox.Group
    className="answer-checkbox-grid"
    value={Array.isArray(value) ? value : []}
    onChange={(values) => {
      const selected = values.map(String);
      onChange(selected.includes("unknown") ? ["unknown"] : selected);
    }}
    options={question.options?.map((option) => ({ label: option.label, value: option.value }))}
  />;
  if (question.responseType === "location_form") {
    const location: ProjectLocationAnswer = typeof value === "object" && !Array.isArray(value) && "propertyName" in value
      ? value
      : emptyAnswer(question) as ProjectLocationAnswer;
    const change = (patch: Partial<ProjectLocationAnswer>) => onChange({ ...location, ...patch });
    return <div className="compact-form-grid">
      <label className="field-span-2"><span>管理项目</span><Input value={location.propertyName} onChange={(event) => change({ propertyName: event.target.value })} placeholder="如：滨湖花园" /></label>
      <label><span>楼栋</span><Input value={location.building} onChange={(event) => change({ building: event.target.value })} placeholder="如：A座" /></label>
      <label><span>楼层</span><Input value={location.floor} onChange={(event) => change({ floor: event.target.value })} placeholder="如：B1" /></label>
      <label><span>区域</span><Input value={location.area} onChange={(event) => change({ area: event.target.value })} placeholder="如：冷机房" /></label>
      <label><span>对象/点位</span><Input value={location.point} onChange={(event) => change({ point: event.target.value })} placeholder="如：1#机组" /></label>
      <label className="field-span-2"><span>影响范围</span><Select value={location.impactScope} onChange={(next) => change({ impactScope: next })} options={impactOptions} /></label>
    </div>;
  }
  if (question.responseType === "scope_selector") {
    const selected: ScopeSelectionAnswer = typeof value === "object" && !Array.isArray(value) && "included" in value ? value : { included: [] };
    return <div>
      <Checkbox.Group className="answer-checkbox-grid" value={selected.included} onChange={(values) => onChange({ ...selected, included: values.map(String) })} options={question.options?.map((option) => ({ label: option.label, value: option.value }))} />
      {selected.included.includes("other") ? <Input style={{ marginTop: 12 }} value={selected.other} onChange={(event) => onChange({ ...selected, other: event.target.value })} placeholder="其他改造内容" /> : null}
      <Typography.Text type="secondary" className="scope-boundary-note">未选部分自动记为“不包含”，后续可返回修改。</Typography.Text>
    </div>;
  }
  if (question.responseType === "number") return <InputNumber size="large" value={Number(value)} onChange={(next) => onChange(next ?? "")} style={{ width: "100%" }} />;
  if (question.responseType === "fact_form") return <FactFormFields question={question} value={value} onChange={onChange} />;
  return <Input size="large" value={String(value)} onChange={(event) => onChange(event.target.value)} placeholder="简要填写" />;
}

function FactFormEditor({ question, initialValue, onSaved, projectId, session }: { question: QuestionDefinition; initialValue?: InterviewAnswerValue; onSaved: (view: InterviewView) => void; projectId: string; session: ReturnType<typeof getSession> }) {
  const [value, setValue] = useState<InterviewAnswerValue>(initialValue ?? emptyAnswer(question));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!answerReady(value)) return;
    const timer = window.setTimeout(async () => {
      try {
        await apiRequest(`/projects/${projectId}/interview/answer-draft`, { method: "PATCH", body: JSON.stringify({ questionId: question.id, value }) }, session);
        setSaved(true);
      } catch { setSaved(false); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(value), question.id]);
  const submit = async () => {
    setSaving(true);
    try {
      const view = await apiRequest<InterviewView>(`/projects/${projectId}/interview/answers`, { method: "POST", body: JSON.stringify({ questionId: question.id, value, idempotencyKey: `${question.id}-${Date.now()}` }) }, session);
      onSaved(view);
    } finally { setSaving(false); }
  };
  return <div className="inline-fact-form"><Typography.Text strong>{question.title}</Typography.Text><FactFormFields question={question} value={value} onChange={(next) => { setValue(next); setSaved(false); }} /><Space><Button loading={saving} disabled={!answerReady(value)} onClick={() => void submit()}>保存补充信息</Button>{saved ? <Typography.Text type="secondary">已自动暂存</Typography.Text> : null}</Space></div>;
}

export default function InterviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [view, setView] = useState<InterviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<InterviewAnswerValue>("");
  const [supplementValues, setSupplementValues] = useState<Record<string, string | number>>({});
  const [fingerprintDraft, setFingerprintDraft] = useState({ discipline: "", system: "", object: "", problemMode: "", proposedAction: "", impactScope: "", intent: "corrective_repair", businessObjective: "", scopeStrategy: "condition_based" });
  const [evidenceUploadType, setEvidenceUploadType] = useState<EvidenceClaim["evidenceType"]>("photo");
  const [editingQuestion, setEditingQuestion] = useState<QuestionDefinition | null>(null);
  const [scheme, setScheme] = useState<SchemeModule[]>([]);
  const [selectedSchemeOptionId, setSelectedSchemeOptionId] = useState<string>();
  const [schemeSelectionReason, setSchemeSelectionReason] = useState("");
  const [understandingDisagreement, setUnderstandingDisagreement] = useState("");
  const [correctedScope, setCorrectedScope] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string>();
  const [costRows, setCostRows] = useState<CostMatrixRow[]>([]);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionOutcome, setDecisionOutcome] = useState<GuidedDecision["outcome"]>("approved");
  const [reasonCode, setReasonCode] = useState("confirm_ai_conclusion");
  const [decisionComment, setDecisionComment] = useState("");
  const questionEditorRef = useRef<HTMLDivElement>(null);

  const load = async (silent = false) => {
    if (!session) return router.replace("/login");
    if (!silent) setLoading(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview`, {}, session);
      setView(data);
      setScheme(data.session.schemeModules);
      setSelectedSchemeOptionId(data.session.selectedSchemeOptionId);
      setCostRows(data.session.generatedCostRows);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "访谈加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { setSession(getSession()); setSessionReady(true); }, []);
  useEffect(() => { if (sessionReady) void load(); }, [projectId, sessionReady]);

  useEffect(() => {
    if (view?.session.fingerprint) setFingerprintDraft({ discipline: view.session.fingerprint.discipline, system: view.session.fingerprint.system, object: view.session.fingerprint.object, problemMode: view.session.fingerprint.problemMode, proposedAction: view.session.fingerprint.proposedAction, impactScope: view.session.fingerprint.impactScope, intent: view.session.fingerprint.intent ?? "corrective_repair", businessObjective: view.session.fingerprint.businessObjective ?? view.session.fingerprint.problemMode, scopeStrategy: view.session.fingerprint.scopeStrategy ?? "condition_based" });
  }, [view?.session.fingerprint?.promptVersion]);

  useEffect(() => {
    if (view?.session.status !== "assessing") return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [view?.session.status, projectId]);

  const activeQuestion = editingQuestion ?? view?.nextQuestion;
  useEffect(() => {
    if (view?.session.status !== "stage_supplement" || !view.session.stageSupplement) return setSupplementValues({});
    setSupplementValues(view.session.stageSupplement.draftValues ?? {});
  }, [view?.session.stageSupplement?.createdAt]);

  useEffect(() => {
    if (view?.session.status !== "stage_supplement" || !view.session.stageSupplement || !Object.values(supplementValues).some((value) => String(value).trim())) return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await apiRequest<{ saved: boolean; savedAt: string }>(`/projects/${projectId}/interview/stage-supplement/draft`, { method: "PATCH", body: JSON.stringify({ values: supplementValues }) }, session);
        setDraftSavedAt(result.savedAt);
      } catch { /* 暂存失败不打断填报 */ }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(supplementValues), view?.session.stageSupplement?.createdAt]);
  useEffect(() => {
    if (!activeQuestion || !view) return setAnswer("");
    const existing = view.answeredQuestions.find((item) => item.question.id === activeQuestion.id)?.answer.value;
    const draft = view.session.answerDraft?.questionId === activeQuestion.id ? view.session.answerDraft.value : undefined;
    setAnswer(existing ?? draft ?? emptyAnswer(activeQuestion));
  }, [activeQuestion?.id, view?.session.updatedAt]);

  useEffect(() => {
    if (!activeQuestion || !view || !answerReady(answer) || view.session.status === "stage_confirmation") return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await apiRequest<{ saved: boolean; savedAt: string }>(`/projects/${projectId}/interview/answer-draft`, { method: "PATCH", body: JSON.stringify({ questionId: activeQuestion.id, value: answer }) }, session);
        setDraftSavedAt(result.savedAt);
      } catch { /* 正式提交仍会提示错误，暂存失败不打断填写 */ }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeQuestion?.id, JSON.stringify(answer)]);

  useEffect(() => {
    if (!editingQuestion) return;
    questionEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editingQuestion?.id]);

  const progress = useMemo(() => {
    if (!view) return 0;
    if (view.decision) return 100;
    return Math.min(95, view.answeredQuestions.length * 5 + stageIndex[view.session.stage] * 12);
  }, [view]);

  const implementationConditions = useMemo(() => view
    ? [...new Set(view.assessments.filter((item) => !item.invalidatedAt).flatMap((item) => item.implementationConditions ?? []))]
    : [], [view]);

  const submitAnswer = async () => {
    if (!activeQuestion || !answerReady(answer)) return;
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/answers`, {
        method: "POST",
        body: JSON.stringify({ questionId: activeQuestion.id, value: answer, idempotencyKey: `${activeQuestion.id}-${Date.now()}` })
      }, session);
      setView(data);
      setScheme(data.session.schemeModules);
      setCostRows(data.session.generatedCostRows);
      setEditingQuestion(null);
      setAnswer("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存答案失败");
    } finally {
      setSaving(false);
    }
  };

  const submitStageSupplement = async () => {
    if (!view?.session.stageSupplement) return;
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/stage-supplement`, { method: "POST", body: JSON.stringify({ values: supplementValues }) }, session);
      setView(data);
      setSupplementValues({});
      setDraftSavedAt(undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "补充信息提交失败");
    } finally { setSaving(false); }
  };

  const downloadDataCollectionTemplate = async () => {
    if (!view?.session.stageSupplement) return;
    setSaving(true);
    try {
      const blob = await apiRequest<Blob>(`/projects/${projectId}/interview/stage-supplement/template.xlsx`, {}, session);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${view.session.stageSupplement.dataCollection?.title ?? "实测数据采集表"}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      await load(true);
      messageApi.success("采集表已生成，请填写后在此上传");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "采集表生成失败"); }
    finally { setSaving(false); }
  };

  const uploadDataCollectionTemplate = async (file: File) => {
    if (file.size > 512 * 1024) {
      messageApi.error("实测数据表不能超过 512 KB，请删除照片、截图和无关工作表");
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/stage-supplement/upload`, { method: "POST", body: form }, session);
      setView(data);
      setSupplementValues({});
      messageApi.success("实测数据已读取，并已重新判断");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "实测数据读取失败"); }
    finally { setSaving(false); }
  };

  const confirmFingerprint = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/fingerprint`, { method: "POST", body: JSON.stringify({ ...fingerprintDraft, basis: view?.session.fingerprint?.basis ?? [] }) }, session);
      setView(data);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "事项确认失败"); }
    finally { setSaving(false); }
  };

  const confirmScopeCalibration = async (action: "adopt_supported" | "keep_declared" | "correct_supported") => {
    if (action === "correct_supported" && !correctedScope.trim()) return;
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/scope-calibration`, {
        method: "POST",
        body: JSON.stringify({ action, correctedScope: action === "correct_supported" ? correctedScope.trim() : undefined })
      }, session);
      setView(data);
      setScheme(data.session.schemeModules);
      setCostRows(data.session.generatedCostRows);
      setCorrectedScope("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工程范围确认失败");
    } finally { setSaving(false); }
  };

  const reassess = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/reassess`, { method: "POST" }, session);
      setView(data);
      setScheme(data.session.schemeModules);
      setCostRows(data.session.generatedCostRows);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重新判断失败");
    } finally { setSaving(false); }
  };

  const uploadProps: UploadProps = {
    multiple: true,
    showUploadList: false,
    accept: ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv",
    customRequest: async ({ file, onSuccess, onError }) => {
      if (!view) return;
      try {
        const prepared = await prepareFileForUpload(file as File);
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("versionId", view.session.versionId);
        form.append("slotKey", evidenceSlot(prepared.file, evidenceUploadType));
        form.append("files", prepared.file, prepared.file.name);
        const uploaded = await apiRequest<Attachment[]>("/files/upload", { method: "POST", body: form }, session);
        await Promise.all(uploaded.map((attachment) => apiRequest(`/projects/${projectId}/interview/evidence`, {
          method: "POST",
          body: JSON.stringify({ attachmentId: attachment.id, evidenceType: evidenceUploadType })
        }, session)));
        onSuccess?.({});
        messageApi.success(prepared.compressed ? "照片已自动压缩并上传" : "证据已上传");
        await load();
      } catch (error) {
        onError?.(error as Error);
        messageApi.error(error instanceof Error ? error.message : "上传失败");
      }
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    setSaving(true);
    try {
      await apiRequest(`/files/${attachmentId}`, { method: "DELETE" }, session);
      await load(true);
      messageApi.success("材料已删除，证据状态已同步更新");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "删除失败"); }
    finally { setSaving(false); }
  };

  const downloadAttachment = async (attachment: Attachment) => {
    try {
      const blob = await apiRequest<Blob>(`/files/${attachment.id}/download`, {}, session);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "下载失败"); }
  };

  const confirmScheme = async () => {
    setSaving(true);
    try {
      const original = new Map(view?.session.schemeModules.map((item) => [item.key, item.content]));
      const modules = scheme.map((item) => ({ key: item.key, content: item.content, editReason: item.content !== original.get(item.key) ? item.editReason : undefined }));
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/scheme/confirm`, { method: "POST", body: JSON.stringify({ modules, selectedOptionId: selectedSchemeOptionId, selectionReason: schemeSelectionReason }) }, session);
      setView(data);
      setScheme(data.session.schemeModules);
      setCostRows(data.session.generatedCostRows);
      messageApi.success("方案已确认，清单骨架已生成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "方案确认失败");
    } finally { setSaving(false); }
  };

  const regenerateScheme = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/scheme/regenerate`, { method: "POST" }, session);
      setView(data);
      setScheme(data.session.schemeModules);
      setCostRows(data.session.generatedCostRows);
      setSelectedSchemeOptionId(data.session.selectedSchemeOptionId ?? "");
      messageApi.success("方案参数和参考价已重新深化");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "方案深化失败");
    } finally { setSaving(false); }
  };

  const confirmUnderstanding = async (action: "confirm" | "disagree") => {
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/necessity/understanding`, { method: "POST", body: JSON.stringify({ action, comment: understandingDisagreement }) }, session);
      setView(data);
      setUnderstandingDisagreement("");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "理解确认失败"); }
    finally { setSaving(false); }
  };

  const chooseSchemeOption = (option: SchemeOption) => {
    setSelectedSchemeOptionId(option.id);
    setScheme(option.modules);
    setCostRows(option.costRows);
    if (option.kind === "recommended") setSchemeSelectionReason("");
  };

  const saveCosts = async () => {
    const declaredBudget = costRows.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/costs`, { method: "PATCH", body: JSON.stringify({ rows: costRows, declaredBudget }) }, session);
      setView(data);
      setCostRows(data.session.generatedCostRows);
      messageApi.success("预算已闭合，可以最终送审");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "预算保存失败"); }
    finally { setSaving(false); }
  };

  const finalSubmit = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/submit`, { method: "POST" }, session);
      setView(data);
      messageApi.success("已提交，结论将在当前页面原位显示");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "送审失败"); }
    finally { setSaving(false); }
  };

  const createRevision = async () => {
    setSaving(true);
    try {
      await apiRequest(`/projects/${projectId}/versions`, { method: "POST" }, session);
      await load();
      messageApi.success("已创建新版本，可继续补充并重新判断");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "创建修订版本失败"); }
    finally { setSaving(false); }
  };

  const addCostRow = () => setCostRows((items) => [...items, {
    id: `cost-${crypto.randomUUID()}`,
    type: "engineering",
    itemName: "",
    specification: "",
    unit: "项",
    quantity: 1,
    unitPrice: 0,
    remark: ""
  }]);

  const decide = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<InterviewView>(`/projects/${projectId}/interview/decision`, { method: "POST", body: JSON.stringify({ outcome: decisionOutcome, reasonCode, comment: decisionComment }) }, session);
      setView(data);
      setDecisionOpen(false);
      messageApi.success("最终决定已生效并留痕");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "决定保存失败"); }
    finally { setSaving(false); }
  };

  if (loading && !view) return <Card loading />;
  if (!view) return null;
  const isSubmitter = session?.user.role === "submitter";
  const canDecide = session?.user.role === "reviewer" || session?.user.role === "admin";
  const canEditDraft = Boolean(isSubmitter && !view.decision && !["assessing", "completed", "manual_review"].includes(view.session.status));
  const canEditCosts = Boolean(canEditDraft && ["cost_confirmation", "ready_to_submit"].includes(view.session.status));

  return (
    <div className="interview-page workspace-page interview-workspace">
      {contextHolder}
      <div className="interview-topbar">
        <Space>
          <Link href="/projects"><Button type="text" icon={<ArrowLeftOutlined />}>项目列表</Button></Link>
          <Divider type="vertical" />
          <div><Typography.Text strong>{view.project.title}</Typography.Text><br /><Typography.Text type="secondary">V{view.project.currentVersionNumber} · 知识版本 V{view.knowledge.version}</Typography.Text></div>
        </Space>
        <Tag color={view.formalAutoApprovalEnabled ? "green" : "gold"}>{view.formalAutoApprovalEnabled ? "正式自动批准已启用" : "影子审批运行中"}</Tag>
      </div>

      <Card className="interview-progress-card">
        <Steps current={stageIndex[view.session.stage]} items={stageItems} responsive />
        <Progress percent={progress} showInfo={false} strokeColor="#1c5ec6" />
      </Card>

      {view.session.status === "assessing" ? (
        <Card className="question-card">
          <Space direction="vertical" align="center" size={16} style={{ width: "100%", paddingBlock: 30 }}>
            <Spin size="large" indicator={<SyncOutlined spin />} />
            <Typography.Title level={3} style={{ margin: 0 }}>正在形成最终结论</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ textAlign: "center", maxWidth: 560 }}>事实、证据、方案与预算复核中</Typography.Paragraph>
          </Space>
        </Card>
      ) : view.decision ? (
        <Card className={`decision-hero decision-${view.decision.outcome}`}>
          <span className="hero-kicker">最终业务结论</span>
          <Typography.Title>{outcomeLabels[view.decision.outcome]}</Typography.Title>
          <Typography.Text>{routeLabels[view.decision.route]}</Typography.Text>
          <div className="decision-reasons">
            {view.decision.reasons.slice(0, 3).map((reason) => <div key={reason}><CheckCircleOutlined /> {reason}</div>)}
          </div>
          {view.decision.conditions.length ? <Alert type="warning" showIcon message="待补内容" description={view.decision.conditions.join("；")} /> : null}
          <Space wrap>
            {canDecide && view.decision.status === "pending" ? <Button type="primary" onClick={() => { setDecisionOutcome(view.decision!.outcome); setDecisionOpen(true); }}>确认或改判</Button> : null}
            {isSubmitter && ["supplement_required", "not_approved"].includes(view.decision.outcome) ? <Button loading={saving} onClick={() => void createRevision()}>创建修订版本</Button> : null}
          </Space>
        </Card>
      ) : null}

      <div className="interview-status-strip">
        <div><span>当前判断</span><Tag color={tendencyColors[view.session.tendency]}>{tendencyLabels[view.session.tendency]}</Tag></div>
        <div><span>已确认</span><strong>{view.answeredQuestions.length}</strong> 项事实</div>
        <div><span>证据</span><strong>{view.evidenceClaims.length}</strong> 份</div>
      </div>

      {view.session.status === "manual_review" && isSubmitter && !view.decision ? (
        <Card className="question-card supplement-card">
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Space wrap><Tag color="orange">本版本已结束</Tag><Typography.Text type="secondary">不会清空现有填报</Typography.Text></Space>
            <Typography.Title level={3} style={{ margin: 0 }}>补充事实后重新发起</Typography.Title>
            <Typography.Paragraph style={{ margin: 0 }}>
              新版本将继承当前已确认的 {view.answeredQuestions.length} 项事实和 {view.evidenceClaims.length} 份证据；本轮阶段判断、补充次数和未完成方案将重新计算。
            </Typography.Paragraph>
            <Alert type="warning" showIcon message={view.session.tendencyReasons[0] ?? "当前版本不能继续形成专业判断"} />
            <Popconfirm
              title="创建下一申报版本？"
              description="创建后进入新版本继续补充，当前版本保留为历史记录。"
              okText="创建并继续"
              cancelText="取消"
              onConfirm={() => void createRevision()}
            >
              <Button loading={saving}>创建修订版本</Button>
            </Popconfirm>
            <Button type="primary" loading={saving} onClick={() => void reassess()}>按现有事实重新判断</Button>
          </Space>
        </Card>
      ) : null}

      {view.session.status === "stage_confirmation" && view.session.necessityUnderstanding ? (
        <Card className="question-card understanding-card">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space><Tag color="blue">AI当前理解</Tag><Typography.Text type="secondary">先确认理解，再继续追问</Typography.Text></Space>
            <Typography.Title level={3} style={{ margin: 0 }}>{view.session.necessityUnderstanding.summary}</Typography.Title>
            <div className="understanding-facts">
              {view.session.necessityUnderstanding.facts.map((fact) => <div key={fact}><CheckCircleOutlined /> {fact}</div>)}
            </div>
            {view.session.necessityUnderstanding.missingFacts.length ? <Typography.Text type="secondary">{view.session.necessityUnderstanding.missingFacts[0]}</Typography.Text> : null}
            {view.understandingQuestion?.responseType === "fact_form" ? <FactFormEditor question={view.understandingQuestion} initialValue={view.session.answerDraft?.questionId === view.understandingQuestion.id ? view.session.answerDraft.value : undefined} onSaved={setView} projectId={projectId} session={session} /> : null}
            {view.session.necessityUnderstanding.evidenceRequest ? (
              <div className="inline-evidence-request">
                <div><Typography.Text strong>建议补充材料</Typography.Text><br /><Typography.Text type="secondary">{view.session.necessityUnderstanding.evidenceRequest.purpose}</Typography.Text></div>
                <Space wrap>{view.session.necessityUnderstanding.evidenceRequest.acceptedTypes.map((type) => <Tag key={type}>{evidenceTypeLabels[type]}</Tag>)}</Space>
                <Upload {...uploadProps}><Button icon={<InboxOutlined />}>选择材料并自动识别</Button></Upload>
              </div>
            ) : null}
            <Space wrap>
              <Button type="primary" loading={saving} onClick={() => void confirmUnderstanding("confirm")}>理解正确</Button>
              <Input style={{ width: 320 }} placeholder="哪里理解不准确？" value={understandingDisagreement} onChange={(event) => setUnderstandingDisagreement(event.target.value)} />
              <Button disabled={!understandingDisagreement.trim()} loading={saving} onClick={() => void confirmUnderstanding("disagree")}>提交纠正</Button>
            </Space>
          </Space>
        </Card>
      ) : null}

      {view.session.status === "fingerprint_confirmation" && view.session.fingerprint ? (
        <Card className="question-card fingerprint-card">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space><Tag color="blue">事项识别</Tag><Typography.Text type="secondary">确认后生成本项目专属审查蓝图</Typography.Text></Space>
            <Typography.Title level={3} style={{ margin: 0 }}>AI识别的是这项工程吗？</Typography.Title>
            <div className="fingerprint-grid">
              <label><span>工程专业</span><Input value={fingerprintDraft.discipline} onChange={(event)=>setFingerprintDraft({...fingerprintDraft,discipline:event.target.value})}/></label>
              <label><span>所属系统</span><Input value={fingerprintDraft.system} onChange={(event)=>setFingerprintDraft({...fingerprintDraft,system:event.target.value})}/></label>
              <label><span>改造对象</span><Input value={fingerprintDraft.object} onChange={(event)=>setFingerprintDraft({...fingerprintDraft,object:event.target.value})}/></label>
              <label><span>问题模式</span><Input value={fingerprintDraft.problemMode} onChange={(event)=>setFingerprintDraft({...fingerprintDraft,problemMode:event.target.value})}/></label>
              <label><span>拟采取动作</span><Input value={fingerprintDraft.proposedAction} onChange={(event)=>setFingerprintDraft({...fingerprintDraft,proposedAction:event.target.value})}/></label>
              <label><span>影响范围</span><Input value={fingerprintDraft.impactScope} onChange={(event)=>setFingerprintDraft({...fingerprintDraft,impactScope:event.target.value})}/></label>
              <label><span>申报动机</span><Select value={fingerprintDraft.intent} onChange={(value)=>setFingerprintDraft({...fingerprintDraft,intent:value})} options={[
                {value:"quality_upgrade",label:"品质与形象提升"},{value:"lifecycle_renewal",label:"生命周期更新"},{value:"corrective_repair",label:"故障或病害整治"},{value:"compliance_rectification",label:"合规整改"},{value:"efficiency_upgrade",label:"节能提效"},{value:"capacity_upgrade",label:"扩容升级"}
              ]}/></label>
              <label><span>范围策略</span><Select value={fingerprintDraft.scopeStrategy} onChange={(value)=>setFingerprintDraft({...fingerprintDraft,scopeStrategy:value})} options={[
                {value:"uniform_standard",label:"按统一标准整体覆盖"},{value:"phased_program",label:"整体规划、分期实施"},{value:"condition_based",label:"按现状筛选对象"},{value:"single_object",label:"单个对象实施"}
              ]}/></label>
              <label><span>希望实现的结果</span><Input value={fingerprintDraft.businessObjective} onChange={(event)=>setFingerprintDraft({...fingerprintDraft,businessObjective:event.target.value})} placeholder="如：统一轿厢形象，提升乘用空间品质"/></label>
            </div>
            <Button type="primary" loading={saving} disabled={Object.values(fingerprintDraft).some((value)=>!value.trim())} onClick={()=>void confirmFingerprint()}>确认事项并开始专业审查</Button>
          </Space>
        </Card>
      ) : null}

      {view.session.status === "blueprint_compiling" ? <Card><Spin /> <Typography.Text>正在生成项目专属审查蓝图…</Typography.Text></Card> : null}

      {view.session.status === "scope_confirmation" && view.session.scopeCalibration && canEditDraft ? (
        <Card className="question-card scope-calibration-card">
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <Space wrap><Tag color="blue">范围需要确认</Tag><Typography.Text type="secondary">不计入补充次数</Typography.Text></Space>
            <Typography.Title level={3} style={{ margin: 0 }}>现有信息只支持申报范围的一部分</Typography.Title>
            <Typography.Paragraph style={{ margin: 0 }}>{view.session.scopeCalibration.reason}</Typography.Paragraph>
            <div className="scope-comparison-grid">
              <div><span>原申报范围</span><strong>{view.session.scopeCalibration.declaredScope}</strong></div>
              <div className="scope-supported"><span>当前有依据的范围</span><strong>{view.session.scopeCalibration.supportedScope}</strong></div>
              <div className="scope-unsupported"><span>尚未覆盖</span><strong>{view.session.scopeCalibration.unsupportedScope}</strong></div>
            </div>
            {view.session.scopeCalibration.basis.length ? <Typography.Text type="secondary">依据：{view.session.scopeCalibration.basis.join("；")}</Typography.Text> : null}
            <Space wrap>
              <Button type="primary" loading={saving} onClick={() => void confirmScopeCalibration("adopt_supported")}>按当前有依据的范围继续</Button>
              <Button loading={saving} onClick={() => void confirmScopeCalibration("keep_declared")}>保持原范围，继续补充</Button>
            </Space>
            <div className="scope-correction-row">
              <Input value={correctedScope} onChange={(event) => setCorrectedScope(event.target.value)} placeholder="AI识别不准确时，填写正确的工程范围" />
              <Button disabled={!correctedScope.trim()} loading={saving} onClick={() => void confirmScopeCalibration("correct_supported")}>按我修正的范围继续</Button>
            </div>
          </Space>
        </Card>
      ) : null}

      <Row gutter={[22, 22]} align="top">
        <Col xs={24} xl={24}>
          {view.session.status === "stage_supplement" && view.session.stageSupplement && canEditDraft ? (
            <div ref={questionEditorRef}>
              <Card className="question-card supplement-card">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Space wrap><Tag color="orange">AI需要补充</Tag><Tag>{view.session.stageSupplement.stage === "necessity" ? "必要性判断" : "可行性判断"}</Tag></Space>
                  <Typography.Title level={3} style={{ margin: 0 }}>{view.session.stageSupplement.summary}</Typography.Title>
                  {view.session.stageSupplement.missingFacts.length ? (
                    <div className="supplement-gap-list">
                      {view.session.stageSupplement.missingFacts.map((fact) => <div key={fact}><span />{fact}</div>)}
                    </div>
                  ) : null}
                  <div className="supplement-editor">
                    <Typography.Text strong>请补充以下信息</Typography.Text>
                    <div className="supplement-field-grid">
                      {view.session.stageSupplement.fields.map((field) => <label key={field.id}>
                        <span>{field.label}{field.unit ? `（${field.unit}）` : ""}</span>
                        {field.inputType === "number" ? <InputNumber min={0} value={Number(supplementValues[field.id] ?? 0) || undefined} onChange={(value) => setSupplementValues((current) => ({ ...current, [field.id]: Number(value ?? 0) }))} placeholder={field.placeholder} style={{ width: "100%" }} />
                          : field.inputType === "select" ? <Select value={String(supplementValues[field.id] ?? "") || undefined} onChange={(value) => setSupplementValues((current) => ({ ...current, [field.id]: value }))} options={field.options?.map((option) => ({ value: option.value, label: option.label }))} placeholder={field.placeholder ?? "请选择"} />
                            : field.inputType === "textarea" ? <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} value={String(supplementValues[field.id] ?? "")} onChange={(event) => setSupplementValues((current) => ({ ...current, [field.id]: event.target.value }))} placeholder={field.placeholder} />
                              : <Input value={String(supplementValues[field.id] ?? "")} onChange={(event) => setSupplementValues((current) => ({ ...current, [field.id]: event.target.value }))} placeholder={field.placeholder} />}
                      </label>)}
                    </div>
                    <Space wrap>
                      <Button type="primary" loading={saving} disabled={view.session.stageSupplement.fields.some((field) => field.required && !String(supplementValues[field.id] ?? "").trim())} onClick={() => void submitStageSupplement()}>提交并重新判断</Button>
                      {view.session.stageSupplement.dataCollectionRecommended || view.session.stageSupplement.dataCollection ? <>
                        <Button icon={<DownloadOutlined />} loading={saving} onClick={() => void downloadDataCollectionTemplate()}>下载实测数据表</Button>
                        <Upload
                          accept=".xlsx"
                          maxCount={1}
                          showUploadList={false}
                          beforeUpload={(file) => { void uploadDataCollectionTemplate(file); return false; }}
                        >
                          <Button icon={<InboxOutlined />} loading={saving}>上传已填写表格</Button>
                        </Upload>
                      </> : null}
                      {draftSavedAt ? <Typography.Text type="secondary">已自动暂存</Typography.Text> : null}
                    </Space>
                    {view.session.stageSupplement.dataCollectionRecommended || view.session.stageSupplement.dataCollection ? <Typography.Text type="secondary">记录较多时可用Excel。表内只填数据，不放照片，文件上限512 KB；照片仍在材料区单独上传并自动压缩。</Typography.Text> : null}
                  </div>
                </Space>
              </Card>
            </div>
          ) : null}

          {activeQuestion && canEditDraft && !["stage_confirmation", "stage_supplement", "scope_confirmation"].includes(view.session.status) ? (
            <div ref={questionEditorRef}>
            <Card className="question-card">
              <Space direction="vertical" size={18} style={{ width: "100%" }}>
                <Space><Tag>{activeQuestion.stage === "necessity" ? "必要性" : "可行性"}</Tag>{editingQuestion ? <Tag color="blue">正在修改</Tag> : null}</Space>
                <div><Typography.Title level={2}>{activeQuestion.title}</Typography.Title>{activeQuestion.helpText ? <Typography.Paragraph type="secondary">{activeQuestion.helpText}</Typography.Paragraph> : null}</div>
                {activeQuestion.responseType === "single_choice" ? (
                  <Radio.Group value={answer} onChange={(event) => setAnswer(event.target.value)} className="answer-choice-grid">
                    {activeQuestion.options?.map((option) => <Radio.Button key={option.value} value={option.value}><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</Radio.Button>)}
                  </Radio.Group>
                ) : activeQuestion.responseType === "multi_choice" ? (
                  <Checkbox.Group
                    className="answer-checkbox-grid"
                    value={Array.isArray(answer) ? answer : []}
                    onChange={(values) => {
                      const selected = values.map(String);
                      setAnswer(selected.includes("unknown") ? ["unknown"] : selected);
                    }}
                    options={activeQuestion.options?.map((option) => ({ label: option.label, value: option.value }))}
                  />
                ) : activeQuestion.responseType === "location_form" ? (
                  <div className="compact-form-grid">
                    {(() => {
                      const location: ProjectLocationAnswer = typeof answer === "object" && !Array.isArray(answer) && "propertyName" in answer
                        ? answer
                        : emptyAnswer(activeQuestion) as ProjectLocationAnswer;
                      const change = (patch: Partial<ProjectLocationAnswer>) => setAnswer({ ...location, ...patch });
                      return <>
                        <label className="field-span-2"><span>管理项目</span><Input value={location.propertyName} onChange={(event) => change({ propertyName: event.target.value })} placeholder="如：滨湖花园" /></label>
                        <label><span>楼栋</span><Input value={location.building} onChange={(event) => change({ building: event.target.value })} placeholder="如：A座" /></label>
                        <label><span>楼层</span><Input value={location.floor} onChange={(event) => change({ floor: event.target.value })} placeholder="如：B1" /></label>
                        <label><span>区域</span><Input value={location.area} onChange={(event) => change({ area: event.target.value })} placeholder="如：冷机房" /></label>
                        <label><span>对象/点位</span><Input value={location.point} onChange={(event) => change({ point: event.target.value })} placeholder="如：1#机组" /></label>
                        <label className="field-span-2"><span>影响范围</span><Select value={location.impactScope} onChange={(value) => change({ impactScope: value })} options={impactOptions} /></label>
                      </>;
                    })()}
                  </div>
                ) : activeQuestion.responseType === "scope_selector" ? (
                  (() => {
                    const selectedScope: ScopeSelectionAnswer = typeof answer === "object" && !Array.isArray(answer) && "included" in answer ? answer : { included: [] };
                    return <div>
                      <Checkbox.Group
                        className="answer-checkbox-grid"
                        value={selectedScope.included}
                        onChange={(values) => setAnswer({ ...selectedScope, included: values.map(String) })}
                        options={activeQuestion.options?.map((option) => ({ label: option.label, value: option.value }))}
                      />
                      {selectedScope.included.includes("other") ? <Input style={{ marginTop: 12 }} value={selectedScope.other} onChange={(event) => setAnswer({ ...selectedScope, other: event.target.value })} placeholder="其他改造内容" /> : null}
                      <Typography.Text type="secondary" className="scope-boundary-note">未选部分自动记为“不包含”，后续可返回修改。</Typography.Text>
                    </div>;
                  })()
                ) : activeQuestion.responseType === "number" ? (
                  <InputNumber size="large" value={Number(answer)} onChange={(value) => setAnswer(value ?? "")} style={{ width: "100%" }} />
                ) : activeQuestion.responseType === "fact_form" ? (
                  <FactFormFields question={activeQuestion} value={answer} onChange={setAnswer} />
                ) : (
                  <Input size="large" value={String(answer)} onChange={(event) => setAnswer(event.target.value)} placeholder="简要填写" />
                )}
                <Space>
                  <Button type="primary" size="large" loading={saving} disabled={!answerReady(answer)} onClick={() => void submitAnswer()}>{editingQuestion ? "保存修改" : "确认并继续"}</Button>
                  {editingQuestion ? <Button onClick={() => setEditingQuestion(null)}>取消</Button> : null}
                  {draftSavedAt ? <Typography.Text type="secondary">已自动暂存</Typography.Text> : null}
                </Space>
              </Space>
            </Card>
            </div>
          ) : null}

          {!activeQuestion && view.session.status === "awaiting_evidence" ? (
            <Card className="question-card">
              <Alert type="warning" showIcon message="关键事实还不能确认" description="你选择了“不清楚”。请上传能证明该事实的材料，或在右侧已确认事实中修改对应回答；系统不会用假设替代关键事实。" />
            </Card>
          ) : null}

          {view.session.stage === "scheme" && view.session.status === "scheme_confirmation" && !view.decision ? (
            <Card title="方案比选" extra={<Space><Tag color="blue">主推荐优先</Tag>{view.session.schemeModules[0]?.modelName ? <Tag>AI · {view.session.schemeModules[0].modelName}</Tag> : null}{canEditDraft ? <Button size="small" icon={<SyncOutlined />} loading={saving} onClick={() => void regenerateScheme()}>深化参数与参考价</Button> : null}</Space>}>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {view.session.technicalRoutes?.length ? <div className="route-summary">
                  {view.session.technicalRoutes.map((route)=><div key={route.id}><Space><Tag color={route.kind === "recommended" ? "blue" : "gold"}>{route.kind === "recommended" ? "主路线" : "条件备选"}</Tag><strong>{route.name}</strong></Space><p>{route.mechanism}</p>{route.criticalParameters.length ? <small>关键参数：{route.criticalParameters.join("、")}</small> : null}</div>)}
                </div> : null}
                {view.session.schemeReview ? <Alert type={view.session.schemeReview.passed ? "success" : "warning"} showIcon message={view.session.schemeReview.passed ? "独立方案复核通过" : "独立方案复核未通过"} description={view.session.schemeReview.summary} /> : null}
                {implementationConditions.length ? <Alert type="info" showIcon message="实施前条件（不阻断原则立项）" description={<ul className="condition-list">{implementationConditions.map((item) => <li key={item}>{item}</li>)}</ul>} /> : null}
                <Row gutter={[12, 12]}>
                  {(view.session.schemeOptions ?? []).map((option) => <Col xs={24} lg={8} key={option.id}>
                    <Card hoverable className={selectedSchemeOptionId === option.id ? "scheme-option selected" : "scheme-option"} onClick={() => chooseSchemeOption(option)}>
                      <Space><Tag color={option.kind === "recommended" ? "blue" : "gold"}>{option.kind === "recommended" ? "AI推荐" : "条件备选"}</Tag><Typography.Text strong>{option.title}</Typography.Text></Space>
                      <Typography.Paragraph type="secondary">{option.summary}</Typography.Paragraph>
                      <Typography.Text>适用：{option.applicability.join("；")}</Typography.Text>
                      <div className="scheme-tradeoffs"><span>解决程度：{option.tradeoffs.resolution}</span><span>施工影响：{option.tradeoffs.constructionImpact}</span><span>成本：{option.tradeoffs.costLevel}</span></div>
                    </Card>
                  </Col>)}
                </Row>
                {(view.session.schemeOptions ?? []).find((item) => item.id === selectedSchemeOptionId)?.kind === "conditional" ? <Input placeholder="选择备选方案的原因或新增现场约束（必填）" value={schemeSelectionReason} onChange={(event) => setSchemeSelectionReason(event.target.value)} /> : null}
                {scheme.map((module, index) => {
                  const changed = module.content !== view.session.schemeModules[index]?.content;
                  return <div className="scheme-module" key={module.key}>
                    <Typography.Title level={5}>{module.title}</Typography.Title>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={module.content} disabled={!isSubmitter} onChange={(event) => setScheme((items) => items.map((item) => item.key === module.key ? { ...item, content: event.target.value } : item))} />
                    {module.parameters?.length ? <Table style={{ marginTop: 10 }} size="small" pagination={false} rowKey={(item) => `${module.key}-${item.name}`} dataSource={module.parameters} columns={[
                      { title: "关键参数", dataIndex: "name", width: 180 },
                      { title: "建议值/范围", render: (_, item) => item.recommendedValue || item.allowedRange || "现场确认" },
                      { title: "确认方式", dataIndex: "confirmationMethod" },
                      { title: "状态", width: 100, render: (_, item) => <Tag color={item.status === "recommended" ? "blue" : item.status === "range" ? "cyan" : "default"}>{item.status === "recommended" ? "建议值" : item.status === "range" ? "允许区间" : "现场确认"}</Tag> }
                    ]} /> : null}
                    {changed ? <Input style={{ marginTop: 10 }} placeholder="修改原因（必填）" value={module.editReason} onChange={(event) => setScheme((items) => items.map((item) => item.key === module.key ? { ...item, editReason: event.target.value } : item))} /> : null}
                  </div>;
                })}
                {view.session.costBenchmarks.length ? <Card size="small" title="工程量与参考价预览">
                  <Table size="small" pagination={false} rowKey="id" dataSource={costRows} columns={[
                    { title: "清单项", dataIndex: "itemName" },
                    { title: "单位", dataIndex: "unit", width: 80 },
                    { title: "暂估数量", dataIndex: "quantity", width: 100 },
                    { title: "参考含税综合单价", width: 210, render: (_, row) => { const item = view.session.costBenchmarks.find((benchmark) => benchmark.itemName === row.itemName); return item?.lowerUnitPrice && item?.upperUnitPrice ? `${formatCurrency(item.lowerUnitPrice)}～${formatCurrency(item.upperUnitPrice)}/${row.unit}` : "暂无"; } },
                    { title: "暂估合价", width: 130, render: (_, row) => formatCurrency(row.quantity * row.unitPrice) },
                    { title: "来源", width: 160, render: (_, row) => { const item = view.session.costBenchmarks.find((benchmark) => benchmark.itemName === row.itemName); return item?.source === "ai_market_estimate" ? <Tag color="gold">AI市场估算</Tag> : item?.sampleCount ? <Tag color="blue">历史成交</Tag> : <Tag>暂无样本</Tag>; } }
                  ]} />
                  <Typography.Text type="secondary">系统已按当前事实预填数量和参考区间中位价，作为可修改的立项估算；最终以实际工程量和统一口径询价为准。</Typography.Text>
                </Card> : null}
                {canEditDraft ? <Button type="primary" size="large" loading={saving} onClick={() => void confirmScheme()}>确认方案并进入工程量调整</Button> : null}
              </Space>
            </Card>
          ) : null}

          {view.decision ? (
            <Card title="唯一推荐方案" extra={canDecide && view.decision.status === "pending" ? <Tag color="blue">审核人可结构化修改</Tag> : null}>
              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                {scheme.map((module, index) => {
                  const changed = module.content !== view.session.schemeModules[index]?.content;
                  return <div className="scheme-module" key={module.key}>
                    <Typography.Title level={5}>{module.title}</Typography.Title>
                    <Input.TextArea rows={3} value={module.content} disabled={!canDecide || view.decision?.status !== "pending"} onChange={(event) => setScheme((items) => items.map((item) => item.key === module.key ? { ...item, content: event.target.value } : item))} />
                    {changed ? <Input placeholder="结构化修改原因（必填）" value={module.editReason} onChange={(event) => setScheme((items) => items.map((item) => item.key === module.key ? { ...item, editReason: event.target.value } : item))} /> : null}
                  </div>;
                })}
                {canDecide && view.decision.status === "pending" ? <Button loading={saving} onClick={() => void confirmScheme()}>保存方案修改并留痕</Button> : null}
              </Space>
            </Card>
          ) : null}

          {(["cost", "decision"].includes(view.session.stage) || Boolean(view.decision)) ? (
            <Card title="工程量与询价" extra={<Space>{view.decision ? <Tag color="blue">审核依据</Tag> : null}<Tag>{view.session.costBenchmarks.length ? "含价格参考" : "先测量，后询价"}</Tag></Space>}>
              {costRows.some((row) => row.estimateAssumption) ? <Alert style={{ marginBottom: 14 }} type="info" showIcon message="已代入可修改的投资估算" description={<ul className="condition-list">{costRows.filter((row) => row.estimateAssumption).map((row) => <li key={row.id}><strong>{row.itemName}：</strong>{row.estimateAssumption}</li>)}</ul>} /> : null}
              <Table rowKey="id" pagination={false} dataSource={costRows} scroll={{ x: 1180 }} columns={[
                { title: "成本项", dataIndex: "itemName", width: 210, render: (value, row) => <Input value={value} disabled={!canEditCosts} onChange={(event) => setCostRows((items) => items.map((item) => item.id === row.id ? { ...item, itemName: event.target.value } : item))} /> },
                { title: "工程量", children: [
                  { title: "规格", dataIndex: "specification", width: 180, render: (value, row) => <Input value={value} disabled={!canEditCosts} onChange={(event) => setCostRows((items) => items.map((item) => item.id === row.id ? { ...item, specification: event.target.value } : item))} /> },
                  { title: "单位", dataIndex: "unit", width: 90, render: (value, row) => <Input value={value} disabled={!canEditCosts} onChange={(event) => setCostRows((items) => items.map((item) => item.id === row.id ? { ...item, unit: event.target.value } : item))} /> },
                  { title: "数量", dataIndex: "quantity", width: 120, render: (value, row) => <InputNumber min={0} value={value} disabled={!canEditCosts} onChange={(next) => setCostRows((items) => items.map((item) => item.id === row.id ? { ...item, quantity: Number(next ?? 0) } : item))} /> }
                ]},
                { title: "询价", children: [
                  { title: "含税单价", dataIndex: "unitPrice", width: 140, render: (value, row) => <InputNumber min={0} value={value} disabled={!canEditCosts} onChange={(next) => setCostRows((items) => items.map((item) => item.id === row.id ? { ...item, unitPrice: Number(next ?? 0) } : item))} /> },
                  { title: "合价", width: 130, render: (_, row) => formatCurrency(row.quantity * row.unitPrice) },
                  { title: "参考价（不自动填入）", width: 280, render: (_, row) => { const item = view.session.costBenchmarks.find((benchmark) => benchmark.itemName === row.itemName); return item?.lowerUnitPrice && item?.upperUnitPrice ? <Space direction="vertical" size={0}><span>{formatCurrency(item.lowerUnitPrice)}～{formatCurrency(item.upperUnitPrice)}/{row.unit}</span><Space size={4}><Tag color={item.source === "ai_market_estimate" ? "gold" : "blue"}>{item.source === "ai_market_estimate" ? "AI市场估算" : `历史${item.sampleCount}例`}</Tag><Typography.Text type="secondary">{item.asOf}</Typography.Text></Space><Typography.Text type="secondary">{item.basis || item.comparisonScope}</Typography.Text></Space> : <Typography.Text type="secondary">暂无可比样本</Typography.Text>; } }
                ]},
                ...(canEditCosts ? [{ title: "", width: 56, render: (_: unknown, row: CostMatrixRow) => <Popconfirm title="删除该成本项？" onConfirm={() => setCostRows((items) => items.filter((item) => item.id !== row.id))}><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除${row.itemName || "成本项"}`} /></Popconfirm> }] : [])
              ]} />
              <div className="cost-total"><span>含税申报预算</span><strong>{formatCurrency(costRows.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0))}</strong></div>
              {canEditCosts ? <Space wrap style={{ marginTop: 18 }}><Button icon={<PlusOutlined />} onClick={addCostRow}>增加成本项</Button><Button type="primary" loading={saving} onClick={() => void saveCosts()}>保存并校验预算闭合</Button>{view.session.status === "ready_to_submit" ? <Button type="primary" danger icon={<SendOutlined />} loading={saving} disabled={!view.eligibility.allowed || !view.submissionReady} onClick={() => void finalSubmit()}>最终送审</Button> : null}</Space> : null}
              {!view.decision && view.hardGateGaps.length ? <Alert style={{ marginTop: 14 }} type="info" message="送审前还需完成" description={view.hardGateGaps.join("；")} /> : null}
              {!view.eligibility.allowed && view.session.status === "ready_to_submit" ? <Alert style={{ marginTop: 14 }} type="warning" message="当前不能最终送审" description={view.eligibility.reason === "weekly_quota_reached" ? "本周送审额度已用完" : "处于3天冷却期或项目已经送审"} /> : null}
            </Card>
          ) : null}
        </Col>

        <Col xs={24} xl={24}>
          <div className="interview-detail-grid">
            <Card title="实时判断">
              <Tag color={tendencyColors[view.session.tendency]} className="decision-tendency">{tendencyLabels[view.session.tendency]}</Tag>
              <List size="small" dataSource={view.session.tendencyReasons} renderItem={(item) => <List.Item>{item}</List.Item>} />
            </Card>
            <Card title="证据材料">
              {view.evidenceRequirement ? <Typography.Text type="secondary">{view.evidenceRequirement}</Typography.Text> : null}
              {canEditDraft ? <Space direction="vertical" style={{ width: "100%", marginTop: 10 }}>
                <Select value={evidenceUploadType} onChange={setEvidenceUploadType} options={Object.entries(evidenceTypeLabels).map(([value, label]) => ({ value, label }))} />
                <Upload.Dragger {...uploadProps}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p>选择或拖入材料</p></Upload.Dragger>
              </Space> : null}
              <List size="small" dataSource={view.attachments} locale={{ emptyText: "尚未上传证据" }} renderItem={(item) => <List.Item actions={[
                <Button key="download" type="text" icon={<DownloadOutlined />} aria-label={`下载${item.fileName}`} onClick={() => void downloadAttachment(item)} />,
                ...(canEditDraft && item.versionId === view.session.versionId ? [<Popconfirm key="delete" title="删除这份材料？" onConfirm={() => void deleteAttachment(item.id)}><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除${item.fileName}`} /></Popconfirm>] : [])
              ]}><List.Item.Meta title={<Typography.Text ellipsis>{item.fileName}</Typography.Text>} description={evidenceTypeLabels[view.evidenceClaims.find((claim) => claim.attachmentIds.includes(item.id))?.evidenceType ?? "other"]} /></List.Item>} />
            </Card>
            <Card title={`已确认事实（${view.answeredQuestions.length}）`}>
              <Collapse ghost items={(["necessity", "feasibility"] as const).map((stage) => ({
                key: stage,
                label: `${stage === "necessity" ? "必要性" : "可行性"}事实（${view.answeredQuestions.filter((item) => item.question.stage === stage).length}）`,
                children: <List size="small" dataSource={view.answeredQuestions.filter((item) => item.question.stage === stage)} renderItem={({ question, answer: recorded }) => <List.Item actions={canEditDraft ? [<Button key="edit" type="link" size="small" icon={<EditOutlined />} onClick={() => setEditingQuestion(question)}>修改</Button>] : undefined}><List.Item.Meta title={question.title} description={answerSummary(question, recorded.value)} /></List.Item>}
                />
              }))} />
            </Card>
            {canDecide && view.similarCases.length ? <Card title="历史相似项目"><List size="small" dataSource={view.similarCases.slice(0, 3)} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.projectTitle} · V${item.versionNumber}`} description={`${item.matchReason}（相似度 ${Math.round(item.similarityScore * 100)}%）`} /></List.Item>} /></Card> : null}
            {view.assessments.length ? <Card title="阶段判断"><List dataSource={view.assessments} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><span>{item.stage === "necessity" ? "必要性" : item.stage === "feasibility" ? "可行性" : "成本"}</span><Tag color={tendencyColors[item.tendency]}>{tendencyLabels[item.tendency]}</Tag></Space>} description={<Space direction="vertical" size={2}><span>{item.summary}</span><Typography.Text type="secondary">依据：{item.reasons.join("；")}</Typography.Text>{item.implementationConditions?.length ? <Typography.Text type="secondary">后续条件：{item.implementationConditions.join("；")}</Typography.Text> : null}<Typography.Text type="secondary">模型 {item.modelName} · 知识版本 {view.knowledge.version}</Typography.Text></Space>} /></List.Item>} /></Card> : null}
          </div>
        </Col>
      </Row>

      <Modal title="确认或改判" open={decisionOpen} onCancel={() => setDecisionOpen(false)} onOk={() => void decide()} confirmLoading={saving} okText="保存最终决定">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Radio.Group value={decisionOutcome} onChange={(event) => setDecisionOutcome(event.target.value)} optionType="button" buttonStyle="solid" options={[{ label: "批准", value: "approved" }, { label: "需要补充", value: "supplement_required" }, { label: "不批准", value: "not_approved" }]} />
          <Select value={reasonCode} onChange={setReasonCode} options={reasonOptions} style={{ width: "100%" }} aria-label="改判原因" />
          <Input.TextArea rows={4} value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} placeholder="补充说明（可选）" />
          <Alert type="info" message="系统会记录原结论、改判结论、原因、人员和版本，不会自动修改题库或规则。" />
        </Space>
      </Modal>
    </div>
  );
}
