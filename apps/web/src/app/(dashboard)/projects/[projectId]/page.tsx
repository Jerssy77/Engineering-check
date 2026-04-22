"use client";

import {
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  RocketOutlined,
  SyncOutlined
} from "@ant-design/icons";
import {
  BudgetSummary,
  CostMatrixRow,
  FormSnapshot,
  ProjectCategory,
  ProjectStatus,
  VersionAttachmentSlot,
  calculateBudgetSummary,
  calculateCostLineTotal,
  createEmptyCostMatrixRow,
  summarizeLocation
} from "@property-review/shared";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Col,
  Form,
  Input,
  InputNumber,
  List,
  Progress,
  Radio,
  Row,
  Space,
  Tag,
  Tabs,
  Timeline,
  Typography,
  Select,
  message
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";

import { StatusTag } from "../../../../components/status-tag";
import { apiRequest, buildApiUrl } from "../../../../lib/api";
import {
  auditActionLabels,
  categoryLabels,
  costRowTypeOptions,
  formatCurrency,
  formatDateTime,
  issueSourceOptions,
  labelFromMap,
  priorityOptions,
  projectCategoryOptions,
  technicalSchemeTemplates,
  urgencyOptions
} from "../../../../lib/presentation";
import { getSession } from "../../../../lib/session";

interface VersionDetail {
  id: string;
  versionNumber: number;
  status: ProjectStatus;
  snapshot: FormSnapshot;
  createdAt: string;
}

interface ProjectDetailResponse {
  project: { id: string; title: string; status: ProjectStatus; currentVersionId: string };
  versions: VersionDetail[];
  aiReviews: Array<{ versionId: string; conclusion: string }>;
  auditLogs: Array<{ id: string; versionId?: string; action: string; detail: string; createdAt: string }>;
  eligibility: {
    allowed: boolean;
    remainingWeeklyQuota: number;
    reason?: string;
    blockedUntil?: string;
    overrideAvailable: boolean;
  };
  currentBudgetSummary: BudgetSummary;
  currentAttachmentSlots: VersionAttachmentSlot[];
}

const WIZARD_STEPS = [
  { title: "基础信息", description: "项目身份、位置、周期与预算基线" },
  { title: "问题与现状", description: "问题来源、现场表现和影响范围" },
  { title: "技术方案", description: "目标、范围、工艺、材料与交付方式" },
  { title: "工程量与预算", description: "清单录入、预算说明与重点成本" },
  { title: "附件与提交确认", description: "材料准备、提交资格与正式产出入口" }
] as const;

const BASE_FIELDS = [
  { name: "projectName", label: "项目名称", type: "input", required: true, span: 12 },
  { name: "projectCategory", label: "改造类别", type: "select", options: projectCategoryOptions, required: true, span: 12 },
  { name: "priority", label: "优先级", type: "select", options: priorityOptions, required: true, span: 8 },
  { name: "expectedStartDate", label: "计划开工", type: "date", required: true, span: 8 },
  { name: "expectedEndDate", label: "计划完工", type: "date", required: true, span: 8 },
  { name: "budgetAmount", label: "申报总预算（元）", type: "number", required: true, span: 12 }
] as const;

const LOCATION_FIELDS = [
  ["propertyName", "楼盘 / 项目"],
  ["building", "楼栋"],
  ["floor", "楼层"],
  ["area", "区域 / 系统"],
  ["room", "房间 / 点位"],
  ["equipmentPoint", "设备 / 组件"],
  ["impactScope", "影响范围"]
] as const;

const PROBLEM_FIELDS = [
  { name: "issueSourceType", label: "问题来源", type: "select", options: issueSourceOptions, span: 8 },
  { name: "urgencyLevel", label: "紧急程度", type: "select", options: urgencyOptions, span: 8 },
  { name: "complaintCount", label: "投诉数量", type: "number", span: 4 },
  { name: "workOrderCount", label: "工单数量", type: "number", span: 4 }
] as const;

const PROBLEM_TEXT_FIELDS = [
  ["issueSourceDescription", "来源说明", false],
  ["issueDescription", "问题描述", true],
  ["currentCondition", "现状判断", true]
] as const;

const TECHNICAL_CORE_FIELDS = [
  ["objective", "改造目标", true],
  ["implementationScope", "实施范围", true],
  ["feasibilitySummary", "可行性说明", true],
  ["keyProcess", "关键工艺", true],
  ["materialSelection", "材料选型", true],
  ["acceptancePlan", "验收计划", true],
  ["preliminaryPlan", "实施路径", true]
] as const;

const TECHNICAL_ADVANCED_FIELDS = [
  ["maintenancePlan", "维护计划"],
  ["hiddenWorksRequirement", "隐蔽工程要求"],
  ["sampleFirstRequirement", "样板先行要求"],
  ["detailDrawingRequirement", "节点详图要求"],
  ["thirdPartyTestingRequirement", "第三方检测要求"]
] as const;

const BUSINESS_TEXT_FIELDS = [
  ["initialBudgetExplanation", "预算依据", true],
  ["expectedBenefits", "预期收益", true],
  ["supplementaryNotes", "补充说明", false]
] as const;

const RISK_FLAG_FIELDS = [
  ["powerOrWaterShutdown", "涉及停机 / 停水 / 停电或系统切换"],
  ["fireSystemImpact", "影响消防系统或消防安全能力"],
  ["hotWork", "涉及动火作业"],
  ["workingAtHeight", "涉及高处作业"],
  ["concealedWork", "涉及隐蔽工程"],
  ["nightWork", "涉及夜间施工"],
  ["occupiedAreaImpact", "影响已使用区域或客户通行"],
  ["thirdPartyTesting", "需要第三方检测或专项复核"]
] as const;

const CATEGORY_SPECIFIC_FIELDS: Record<ProjectCategory, Array<[string, string, string]>> = {
  mep_upgrade: [
    ["systemBoundary", "系统边界", "例如：冷机房 B1 冷冻水系统，不涉及末端风盘"],
    ["shutdownWindow", "停复机 / 切换窗口", "例如：夜间 22:00-次日 6:00 可短暂停机"],
    ["acceptanceIndicator", "关键验收指标", "例如：联动启停、振动、噪声、报警恢复"]
  ],
  fire_safety: [
    ["affectedFireSystem", "受影响消防系统", "例如：报警回路、防排烟、喷淋、消火栓"],
    ["temporaryFireMeasure", "临时消防保障", "例如：值守、临时灭火器材、旁路监护"],
    ["linkageTestScope", "联动测试范围", "例如：报警、反馈、复位、联动启停"]
  ],
  energy_retrofit: [
    ["energyBaseline", "能耗基线", "例如：近 3 个月电耗/水耗或运行时长"],
    ["savingVerification", "节能验证方式", "例如：改造前后对比、试运行观察周期"],
    ["comfortBoundary", "舒适性 / 服务边界", "例如：不降低温度、照度或供水体验"]
  ],
  civil_upgrade: [
    ["defectBoundary", "缺陷边界", "例如：渗漏点、空鼓面积、裂缝长度"],
    ["sampleRequirement", "样板确认方式", "例如：先做 1 个典型节点样板"],
    ["protectionRequirement", "成品保护与通行组织", "例如：围挡、通行引导、噪声控制"]
  ],
  plumbing_drainage: [
    ["pipeBoundary", "管线 / 点位边界", "例如：B1 排水主管至 1# 检查口"],
    ["pressureOrFlowTest", "试压 / 通水 / 通球要求", "例如：试压 30 分钟无渗漏"],
    ["waterShutdownPlan", "停水或临时排水安排", "例如：分区停水，设置临排泵"]
  ]
};

function buildBudgetSummary(values?: Partial<FormSnapshot>): BudgetSummary {
  return calculateBudgetSummary({
    costMatrixRows: values?.costMatrixRows ?? [],
    declaredBudget: values?.budgetAmount ?? 0,
    costInputMode: values?.costInputMode,
    uploadedCostSheet: values?.uploadedCostSheet
  });
}

function mergeFormSnapshot(
  previous: Partial<FormSnapshot>,
  next: Partial<FormSnapshot>
): Partial<FormSnapshot> {
  const location = {
    propertyName: "",
    building: "",
    floor: "",
    area: "",
    room: "",
    equipmentPoint: "",
    impactScope: "",
    ...previous.location,
    ...next.location
  };

  return {
    ...previous,
    ...next,
    location,
    riskFlags: {
      ...previous.riskFlags,
      ...next.riskFlags
    },
    categorySpecificFields: {
      ...previous.categorySpecificFields,
      ...next.categorySpecificFields
    },
    costInputMode: next.costInputMode ?? previous.costInputMode ?? "online",
    uploadedCostSheet: next.uploadedCostSheet ?? previous.uploadedCostSheet,
    costMatrixRows: next.costMatrixRows ?? previous.costMatrixRows
  };
}

function getFileAccept(slotKey: string): string | undefined {
  if (slotKey === "issue_photos") return "image/*";
  if (slotKey === "fault_registry") return ".xls,.xlsx,.csv";
  if (slotKey === "cost_sheet") return ".xls,.xlsx,.csv";
  if (slotKey === "drawings") return ".pdf,image/*";
  return undefined;
}

function SectionBlock({
  title,
  body,
  children,
  extra
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="section-surface">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
          <div>
            <Typography.Title level={4} className="section-title">
              {title}
            </Typography.Title>
            {body ? (
              <Typography.Paragraph className="section-copy" style={{ marginTop: 8, marginBottom: 0 }}>
                {body}
              </Typography.Paragraph>
            ) : null}
          </div>
          {extra}
        </div>
        {children}
      </Space>
    </section>
  );
}

function FieldRenderer(props: {
  disabled: boolean;
  field: {
    name: string;
    label: string;
    type: "input" | "select" | "date" | "number";
    options?: Array<{ value: string; label: string }>;
    required?: boolean;
  };
}) {
  const { disabled, field } = props;
  const rules = field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined;

  return (
    <Form.Item name={field.name} label={field.label} rules={rules}>
      {field.type === "select" ? (
        <Select disabled={disabled} options={field.options} />
      ) : field.type === "number" ? (
        <InputNumber style={{ width: "100%" }} min={0} disabled={disabled} />
      ) : (
        <Input type={field.type === "date" ? "date" : "text"} disabled={disabled} />
      )}
    </Form.Item>
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const routeParams = use(params);
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [downloadingConstructionPlan, setDownloadingConstructionPlan] = useState(false);
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<Partial<FormSnapshot>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm<FormSnapshot>();
  const session = getSession();

  const watchedProjectName = Form.useWatch("projectName", form);
  const watchedProjectCategory = Form.useWatch("projectCategory", form) as ProjectCategory | undefined;
  const watchedLocation = Form.useWatch("location", form);

  const applyDetailResponse = (response: ProjectDetailResponse) => {
    setDetail(response);
    const current = response.versions.find((item) => item.id === response.project.currentVersionId) ?? response.versions[0];
    if (current) {
      form.setFieldsValue(current.snapshot);
      setLiveSnapshot(current.snapshot);
    }
  };

  const load = async (options?: { background?: boolean; suppressErrors?: boolean }) => {
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!options?.background) {
      setLoading(true);
    }
    try {
      const response = await apiRequest<ProjectDetailResponse>(`/projects/${routeParams.projectId}`, {}, session);
      applyDetailResponse(response);
    } catch (error) {
      if (!options?.suppressErrors) {
        messageApi.error(error instanceof Error ? error.message : "项目加载失败");
      }
    } finally {
      if (!options?.background) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [routeParams.projectId]);

  useEffect(() => {
    if (detail?.project.status !== "ai_reviewing") {
      return;
    }

    const timer = window.setInterval(() => {
      void load({ background: true, suppressErrors: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [detail?.project.status, routeParams.projectId]);

  const currentVersion = useMemo(
    () => detail?.versions.find((item) => item.id === detail.project.currentVersionId) ?? detail?.versions[0],
    [detail]
  );

  const currentVersionLatestLog = useMemo(() => {
    if (!detail || !currentVersion) {
      return undefined;
    }
    return detail.auditLogs.find((item) => item.versionId === currentVersion.id);
  }, [currentVersion, detail]);

  const currentVersionFailureLog =
    currentVersion?.status === "draft" && currentVersionLatestLog?.action === "ai_review_failed"
      ? currentVersionLatestLog
      : undefined;

  const canEdit = session?.user.role === "submitter" && currentVersion?.status === "draft";

  const liveBudgetSummary = useMemo(() => buildBudgetSummary(liveSnapshot), [liveSnapshot]);

  const liveLocationSummary = useMemo(() => {
    const location = watchedLocation ?? liveSnapshot.location;
    if (!location) {
      return currentVersion ? summarizeLocation(currentVersion.snapshot.location) : "待补充";
    }

    return summarizeLocation({
      propertyName: location.propertyName ?? "",
      building: location.building ?? "",
      floor: location.floor ?? "",
      area: location.area ?? "",
      room: location.room ?? "",
      equipmentPoint: location.equipmentPoint ?? "",
      impactScope: location.impactScope ?? ""
    });
  }, [currentVersion, liveSnapshot.location, watchedLocation]);

  const patchCurrentVersion = async (values: FormSnapshot) => {
    if (!currentVersion) return null;
    const response = await apiRequest<ProjectDetailResponse>(
      `/projects/${routeParams.projectId}/versions/${currentVersion.id}`,
      { method: "PATCH", body: JSON.stringify(values) },
      session
    );
    applyDetailResponse(response);
    return response;
  };

  const persistDraft = async (options?: { notify?: boolean; background?: boolean }) => {
    if (!canEdit || !currentVersion) {
      return;
    }

    if (options?.background) {
      setAutosaving(true);
    } else {
      setSaving(true);
    }

    try {
      await patchCurrentVersion(form.getFieldsValue(true) as FormSnapshot);
      if (options?.notify) {
        messageApi.success("草稿已保存");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存失败");
      throw error;
    } finally {
      if (options?.background) {
        setAutosaving(false);
      } else {
        setSaving(false);
      }
    }
  };

  const goToStep = async (nextStep: number) => {
    if (nextStep === currentStep) {
      return;
    }
    if (canEdit) {
      await persistDraft({ background: true });
    }
    setCurrentStep(nextStep);
  };

  const submit = async () => {
    if (!currentVersion) return;
    if (uploadingKey) {
      messageApi.warning("请等待附件上传完成后再提交 AI 预审");
      return;
    }
    setSubmitting(true);
    try {
      await form.validateFields();
      await patchCurrentVersion(form.getFieldsValue(true) as FormSnapshot);
      const response = await apiRequest<ProjectDetailResponse>(
        `/projects/${routeParams.projectId}/submit`,
        { method: "POST", body: JSON.stringify({ versionId: currentVersion.id }) },
        session
      );
      applyDetailResponse(response);
      messageApi.success("AI 预审已发起，系统正在后台处理，页面会自动刷新");
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) {
        messageApi.error("请先补全当前项目的必填信息后再提交");
      } else {
        messageApi.error(error instanceof Error ? error.message : "提交失败");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const createVersion = async () => {
    await apiRequest(`/projects/${routeParams.projectId}/versions`, { method: "POST" }, session);
    messageApi.success("已基于当前内容创建新版本");
    await load();
  };

  const retryReview = async () => {
    setSubmitting(true);
    try {
      const response = await apiRequest<ProjectDetailResponse>(
        `/projects/${routeParams.projectId}/ai-review/retry`,
        { method: "POST" },
        session
      );
      applyDetailResponse(response);
      messageApi.success("已创建下一版本并重新发起 AI 预审");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重新送审失败");
    } finally {
      setSubmitting(false);
    }
  };

  const insertTechnicalTemplate = () => {
    const category = (form.getFieldValue("projectCategory") ??
      currentVersion?.snapshot.projectCategory ??
      "mep_upgrade") as ProjectCategory;
    const template = technicalSchemeTemplates[category];
    const hasExistingContent = [...TECHNICAL_CORE_FIELDS, ...TECHNICAL_ADVANCED_FIELDS].some(([field]) => {
      const value = form.getFieldValue(field);
      return typeof value === "string" && value.trim().length > 0;
    });

    if (hasExistingContent && !window.confirm("当前技术方案区已有内容，是否使用模板覆盖这些字段？")) {
      return;
    }

    form.setFieldsValue(template as Partial<FormSnapshot>);
    messageApi.success(`已插入${labelFromMap(categoryLabels, category)}模板`);
  };

  const uploadFiles = async (slotKey: string, event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length || !currentVersion) return;
    const formData = new FormData();
    formData.append("projectId", routeParams.projectId);
    formData.append("versionId", currentVersion.id);
    formData.append("slotKey", slotKey);
    Array.from(event.target.files).forEach((file) => formData.append("files", file));
    setUploadingKey(slotKey);
    try {
      await apiRequest("/files/upload", { method: "POST", body: formData }, session);
      messageApi.success(slotKey === "cost_sheet" ? "工程量清单已上传并开始解析" : "材料上传成功");
      await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "材料上传失败");
    } finally {
      event.target.value = "";
      setUploadingKey(null);
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    await apiRequest(`/files/${attachmentId}`, { method: "DELETE" }, session);
    messageApi.success("材料已删除");
    await load();
  };

  const downloadAttachment = async (attachmentId: string, fileName: string) => {
    try {
      const blob = await apiRequest<Blob>(`/files/${attachmentId}/download`, {}, session);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "附件下载失败");
    }
  };

  const downloadGeneratedFile = async (path: string, fileName: string) => {
    if (!session || downloadingConstructionPlan) {
      return;
    }

    setDownloadingConstructionPlan(true);
    try {
      const blob = await apiRequest<Blob>(path, {}, session);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "文件下载失败");
    } finally {
      setDownloadingConstructionPlan(false);
    }
  };

  const downloadFaultRegistryTemplate = () => {
    window.open(buildApiUrl("/files/templates/fault-registry.xlsx"), "_blank");
  };

  const attachmentProgress = useMemo(() => {
    const slots = detail?.currentAttachmentSlots ?? [];
    const applicableSlots = slots.filter((slot) => slot.status !== "not_applicable");
    const provided = applicableSlots.filter((slot) => slot.status === "provided").length;
    return {
      percent: applicableSlots.length ? Math.round((provided / applicableSlots.length) * 100) : 0,
      provided,
      total: applicableSlots.length
    };
  }, [detail?.currentAttachmentSlots]);

  const eligibilityMessage = detail?.eligibility.allowed
    ? `当前可提交 AI 预审，本周还剩 ${detail.eligibility.remainingWeeklyQuota} 次额度。`
    : detail?.eligibility.reason === "cooldown_active"
      ? `当前处于冷却期，最早 ${formatDateTime(detail.eligibility.blockedUntil)} 后可再次提交。`
      : detail?.eligibility.reason === "weekly_quota_reached"
        ? "本周 AI 额度已用完，需等待下周或申请特批。"
        : "当前状态下暂不可提交 AI 预审。";

  const saveState =
    autosaving || saving
      ? {
          tone: "saving",
          title: autosaving ? "正在自动保存" : "正在保存草稿",
          copy: autosaving
            ? "切换分区时会先把当前内容保存到草稿。"
            : "正在将当前调整写回到项目草稿。"
        }
      : {
          tone: "saved",
          title: "草稿已保存",
          copy: "可以继续切换分区、上传材料或提交 AI 预审。"
        };

  const currentStepMeta = WIZARD_STEPS[currentStep];
  const currentCategory = watchedProjectCategory ?? liveSnapshot.projectCategory ?? currentVersion?.snapshot.projectCategory ?? "mep_upgrade";
  const sectionTabItems = WIZARD_STEPS.map((item, index) => ({
    key: String(index),
    label: (
      <div className="section-tab">
        <strong>{item.title}</strong>
        <span>{item.description}</span>
      </div>
    )
  }));
  const costInputMode = liveSnapshot.costInputMode ?? currentVersion?.snapshot.costInputMode ?? "online";
  const uploadedCostSheet = liveSnapshot.uploadedCostSheet ?? currentVersion?.snapshot.uploadedCostSheet;

  const handleCostInputModeChange = (mode: "online" | "upload") => {
    const patch: Partial<FormSnapshot> = { costInputMode: mode };
    if (mode === "upload" && uploadedCostSheet?.status === "completed" && typeof uploadedCostSheet.totalAmount === "number") {
      patch.budgetAmount = uploadedCostSheet.totalAmount;
      form.setFieldValue("budgetAmount", uploadedCostSheet.totalAmount);
    }
    form.setFieldValue("costInputMode", mode);
    setLiveSnapshot((previous) => mergeFormSnapshot(previous, patch));
    window.setTimeout(() => void persistDraft({ background: true }), 0);
  };

  const stepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <SectionBlock title="项目基线" body="把项目身份、周期与预算先定准，后面所有审核和产出都会围绕这份基线展开。">
              <Row gutter={16}>
                {BASE_FIELDS.map((field) => (
                  <Col span={field.span} key={field.name}>
                    <FieldRenderer disabled={!canEdit} field={field} />
                  </Col>
                ))}
              </Row>
              <Button
                onClick={() => {
                  const nextBudget = liveBudgetSummary.calculatedBudget;
                  form.setFieldValue("budgetAmount", nextBudget);
                  setLiveSnapshot((previous) => mergeFormSnapshot(previous, { budgetAmount: nextBudget }));
                }}
                disabled={!canEdit}
              >
                同步{costInputMode === "upload" ? "上传清单总价" : "矩阵测算总价"}到申报预算
              </Button>
            </SectionBlock>

            <SectionBlock title="实施位置" body="填写到楼盘、楼栋、楼层和点位，方便后续重复改造识别与材料定位。">
              <Row gutter={16}>
                {LOCATION_FIELDS.map(([key, label]) => (
                  <Col span={key === "impactScope" ? 24 : 8} key={key}>
                    <Form.Item
                      name={["location", key]}
                      label={label}
                      rules={key === "propertyName" ? [{ required: true, message: "请填写楼盘 / 项目" }] : undefined}
                    >
                      <Input disabled={!canEdit} />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </SectionBlock>
          </Space>
        );
      case 1:
        return (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <SectionBlock title="问题来源与强度" body="先把问题从哪里来、严重到什么程度说清楚，后续结论才更可信。">
              <Row gutter={16}>
                {PROBLEM_FIELDS.map((field) => (
                  <Col span={field.span} key={field.name}>
                    <FieldRenderer disabled={!canEdit} field={field} />
                  </Col>
                ))}
              </Row>
            </SectionBlock>

            <SectionBlock title="问题与现状描述" body="把问题现象、现状判断和临时措施拆开写，阅读会更快，也方便 AI 结构化判断。">
              {PROBLEM_TEXT_FIELDS.map(([name, label, required]) => (
                <Form.Item
                  key={name}
                  name={name}
                  label={label}
                  rules={required ? [{ required: true, message: `请填写${label}` }] : undefined}
                >
                  <Input.TextArea rows={3} disabled={!canEdit} />
                </Form.Item>
              ))}
              <Collapse
                ghost
                items={[
                  {
                    key: "advanced-problem",
                    label: "展开更多现场说明",
                    children: (
                      <Form.Item name="temporaryMeasures" label="临时措施">
                        <Input.TextArea rows={3} disabled={!canEdit} />
                      </Form.Item>
                    )
                  }
                ]}
              />
            </SectionBlock>

            <SectionBlock title="专项风险勾选" body="勾选会直接进入 AI 专家预审，用来判断是否需要从严退回、补材料或写入施工控制要求。">
              <Row gutter={[12, 8]}>
                {RISK_FLAG_FIELDS.map(([key, label]) => (
                  <Col xs={24} md={12} key={key}>
                    <Form.Item name={["riskFlags", key]} valuePropName="checked" style={{ marginBottom: 0 }}>
                      <Checkbox disabled={!canEdit}>{label}</Checkbox>
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </SectionBlock>
          </Space>
        );
      case 2:
        return (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <SectionBlock
              title="技术方案主干"
              body="只保留最关键的实施逻辑，减少一次性大段自由发挥。也可以先一键带入标准模板再微调。"
              extra={
                canEdit ? (
                  <Button icon={<FileTextOutlined />} onClick={insertTechnicalTemplate}>
                    一键带入模板
                  </Button>
                ) : null
              }
            >
              {TECHNICAL_CORE_FIELDS.map(([name, label, required]) => (
                <Form.Item
                  key={name}
                  name={name}
                  label={label}
                  rules={required ? [{ required: true, message: `请填写${label}` }] : undefined}
                >
                  <Input.TextArea rows={3} disabled={!canEdit} />
                </Form.Item>
              ))}
            </SectionBlock>

            <SectionBlock
              title={`${labelFromMap(categoryLabels, currentCategory)}专项信息`}
              body="这里补少量专业判断需要的关键边界，不替代正式方案，但会显著提升 AI 审核的准确性。"
            >
              <Row gutter={16}>
                {CATEGORY_SPECIFIC_FIELDS[currentCategory].map(([key, label, placeholder]) => (
                  <Col xs={24} md={8} key={key}>
                    <Form.Item name={["categorySpecificFields", currentCategory, key]} label={label}>
                      <Input.TextArea rows={3} placeholder={placeholder} disabled={!canEdit} />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </SectionBlock>

            <SectionBlock title="高级技术约束" body="把样板、隐蔽工程、详图和检测要求放在收起区，减少主流程阅读压力。">
              <Collapse
                ghost
                defaultActiveKey={[]}
                items={[
                  {
                    key: "advanced-technical",
                    label: "展开高级技术要求",
                    children: (
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        {TECHNICAL_ADVANCED_FIELDS.map(([name, label]) => (
                          <Form.Item key={name} name={name} label={label}>
                            <Input.TextArea rows={3} disabled={!canEdit} />
                          </Form.Item>
                        ))}
                      </Space>
                    )
                  }
                ]}
              />
            </SectionBlock>
          </Space>
        );
      case 3:
        return (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <SectionBlock title="预算说明" body="先说明预算依据与预期收益，再选择在线填报或上传 Excel 清单。">
              {BUSINESS_TEXT_FIELDS.map(([name, label, required]) => (
                <Form.Item
                  key={name}
                  name={name}
                  label={label}
                  rules={required ? [{ required: true, message: `请填写${label}` }] : undefined}
                >
                  <Input.TextArea rows={3} disabled={!canEdit} />
                </Form.Item>
              ))}
            </SectionBlock>

            <SectionBlock
              title="工程量与预算"
              body="简单项目可在线填报；复杂预算清单建议上传 Excel，系统会解析总价、分组、明细和异常提示。"
              extra={
                <Form.Item name="costInputMode" style={{ marginBottom: 0 }}>
                  <Radio.Group
                    disabled={!canEdit}
                    optionType="button"
                    buttonStyle="solid"
                    value={costInputMode}
                    onChange={(event) => handleCostInputModeChange(event.target.value as "online" | "upload")}
                    options={[
                      { label: "在线填报", value: "online" },
                      { label: "上传 Excel 清单", value: "upload" }
                    ]}
                  />
                </Form.Item>
              }
            >
              {costInputMode === "upload" ? (
                <Space direction="vertical" size={14} style={{ width: "100%" }}>
                  <Alert
                    type={uploadedCostSheet?.status === "completed" ? "success" : "info"}
                    showIcon
                    message={
                      uploadedCostSheet?.status === "completed"
                        ? "已按上传清单总计同步申报预算"
                        : "请上传 .xlsx / .csv 工程量清单，系统识别最终总价后才能提交 AI 预审"
                    }
                    description="上传清单不占用其他材料 2MB 合计额度；同一草稿只保留一个当前工程量清单，重新上传会替换旧文件。"
                  />
                  {canEdit ? (
                    <label>
                      <input
                        type="file"
                        accept={getFileAccept("cost_sheet")}
                        hidden
                        onChange={(event) => void uploadFiles("cost_sheet", event)}
                      />
                      <Button icon={<CloudUploadOutlined />} loading={uploadingKey === "cost_sheet"}>
                        上传 / 替换工程量清单
                      </Button>
                    </label>
                  ) : null}
                  {uploadedCostSheet ? (
                    <Space direction="vertical" size={12} style={{ width: "100%" }}>
                      <div className="report-columns">
                        <div className="summary-item">
                          <Typography.Text type="secondary">原始文件</Typography.Text>
                          <strong>{uploadedCostSheet.fileName}</strong>
                          <Button
                            type="link"
                            icon={<DownloadOutlined />}
                            style={{ paddingInline: 0 }}
                            onClick={() => void downloadAttachment(uploadedCostSheet.attachmentId, uploadedCostSheet.fileName)}
                          >
                            下载原表
                          </Button>
                        </div>
                        <div className="summary-item">
                          <Typography.Text type="secondary">识别总价</Typography.Text>
                          <strong>{uploadedCostSheet.totalAmount ? formatCurrency(uploadedCostSheet.totalAmount) : "未识别"}</strong>
                          <Typography.Text type="secondary">
                            {uploadedCostSheet.totalSheetName ?? "工作表"} {uploadedCostSheet.totalCell ?? ""}
                          </Typography.Text>
                        </div>
                        <div className="summary-item">
                          <Typography.Text type="secondary">识别明细</Typography.Text>
                          <strong>{uploadedCostSheet.detailRowCount} 行</strong>
                          <Typography.Text type="secondary">{uploadedCostSheet.parsedSheetNames.join("、") || "未识别工作表"}</Typography.Text>
                        </div>
                        <div className="summary-item">
                          <Typography.Text type="secondary">解析状态</Typography.Text>
                          <strong>{uploadedCostSheet.status === "completed" ? "解析成功" : "解析失败"}</strong>
                          <Typography.Text type="secondary">{formatDateTime(uploadedCostSheet.parsedAt)}</Typography.Text>
                        </div>
                      </div>
                      <List
                        size="small"
                        header={<Typography.Text strong>分组汇总</Typography.Text>}
                        bordered
                        dataSource={uploadedCostSheet.sections}
                        locale={{ emptyText: "暂未识别到分组" }}
                        renderItem={(section) => (
                          <List.Item>
                            <Space direction="vertical" size={2} style={{ width: "100%" }}>
                              <Typography.Text strong>{section.name}</Typography.Text>
                              <Typography.Text type="secondary">
                                {section.sheetName} 第 {section.startRow}-{section.endRow ?? section.startRow} 行
                              </Typography.Text>
                              <Typography.Text>
                                小计 {section.subtotal === undefined ? "-" : formatCurrency(section.subtotal)} / 税费{" "}
                                {section.tax === undefined ? "-" : formatCurrency(section.tax)} / 总计{" "}
                                {section.total === undefined ? "-" : formatCurrency(section.total)}
                              </Typography.Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                      {uploadedCostSheet.warnings.length ? (
                        <Alert
                          type="warning"
                          showIcon
                          message="解析提示"
                          description={
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {uploadedCostSheet.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          }
                        />
                      ) : null}
                      <Collapse
                        items={[
                          {
                            key: "parsed-rows",
                            label: `查看全部解析明细（${uploadedCostSheet.rows.length} 行）`,
                            children: (
                              <List
                                size="small"
                                dataSource={uploadedCostSheet.rows}
                                pagination={{ pageSize: 10, size: "small" }}
                                renderItem={(row) => (
                                  <List.Item>
                                    <Space direction="vertical" size={2} style={{ width: "100%" }}>
                                      <Space wrap>
                                        <Tag>{row.rowType === "detail" ? "明细" : row.rowType === "tax" ? "税费" : row.rowType === "summary" ? "汇总" : "备注"}</Tag>
                                        <Typography.Text strong>{row.itemName}</Typography.Text>
                                        <Typography.Text type="secondary">
                                          {row.sheetName} 第 {row.rowNumber} 行
                                        </Typography.Text>
                                      </Space>
                                      <Typography.Text type="secondary">
                                        {row.specification || row.sectionName || "-"} / {row.unit || "-"} / 数量 {row.quantity ?? "-"} / 单价{" "}
                                        {row.unitPrice === undefined ? "-" : formatCurrency(row.unitPrice)} / 合价{" "}
                                        {row.lineTotal === undefined ? "-" : formatCurrency(row.lineTotal)}
                                      </Typography.Text>
                                    </Space>
                                  </List.Item>
                                )}
                              />
                            )
                          }
                        ]}
                      />
                    </Space>
                  ) : null}
                </Space>
              ) : (
                <Space direction="vertical" size={14} style={{ width: "100%" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1.8fr 1.5fr .8fr .8fr 1fr 1fr 1.4fr 56px",
                      gap: 8,
                      fontWeight: 700,
                      fontSize: 13,
                      color: "var(--ink-soft)"
                    }}
                  >
                    <div>分类</div>
                    <div>项目名称</div>
                    <div>规格型号</div>
                    <div>单位</div>
                    <div>工程量</div>
                    <div>单价</div>
                    <div>合价</div>
                    <div>备注</div>
                    <div />
                  </div>
                  <Form.List name="costMatrixRows">
                    {(
                      fields: Array<{ key: React.Key; name: number }>,
                      { add, remove }: { add: (defaultValue?: CostMatrixRow) => void; remove: (index: number | number[]) => void }
                    ) => (
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        {fields.map((field: { key: React.Key; name: number }) => {
                          const currentRow = (form.getFieldValue(["costMatrixRows", field.name]) ?? {}) as Partial<CostMatrixRow>;
                          return (
                            <div
                              key={field.key}
                              className="summary-item"
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1.2fr 1.8fr 1.5fr .8fr .8fr 1fr 1fr 1.4fr 56px",
                                gap: 8,
                                alignItems: "start"
                              }}
                            >
                              <Form.Item name={[field.name, "type"]} rules={[{ required: true, message: "请选择分类" }]} style={{ marginBottom: 0 }}>
                                <Select disabled={!canEdit} options={costRowTypeOptions} />
                              </Form.Item>
                              <Form.Item name={[field.name, "itemName"]} rules={[{ required: true, message: "请填写项目名称" }]} style={{ marginBottom: 0 }}>
                                <Input disabled={!canEdit} />
                              </Form.Item>
                              <Form.Item name={[field.name, "specification"]} style={{ marginBottom: 0 }}>
                                <Input disabled={!canEdit} />
                              </Form.Item>
                              <Form.Item name={[field.name, "unit"]} style={{ marginBottom: 0 }}>
                                <Input disabled={!canEdit} />
                              </Form.Item>
                              <Form.Item name={[field.name, "quantity"]} rules={[{ required: true, message: "请填写工程量" }]} style={{ marginBottom: 0 }}>
                                <InputNumber min={0.01} style={{ width: "100%" }} disabled={!canEdit} />
                              </Form.Item>
                              <Form.Item name={[field.name, "unitPrice"]} rules={[{ required: true, message: "请填写单价" }]} style={{ marginBottom: 0 }}>
                                <InputNumber min={0.01} style={{ width: "100%" }} disabled={!canEdit} />
                              </Form.Item>
                              <Input
                                value={formatCurrency(
                                  calculateCostLineTotal({
                                    quantity: Number(currentRow.quantity ?? 0),
                                    unitPrice: Number(currentRow.unitPrice ?? 0)
                                  })
                                )}
                                disabled
                              />
                              <Form.Item name={[field.name, "remark"]} style={{ marginBottom: 0 }}>
                                <Input disabled={!canEdit} />
                              </Form.Item>
                              {canEdit ? <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} /> : <div />}
                            </div>
                          );
                        })}
                        {canEdit ? (
                          <Space wrap>
                            <Button icon={<PlusOutlined />} onClick={() => add(createEmptyCostMatrixRow("engineering"))}>
                              新增工程项
                            </Button>
                            <Button icon={<PlusOutlined />} onClick={() => add(createEmptyCostMatrixRow("other_fee"))}>
                              新增其他费用
                            </Button>
                          </Space>
                        ) : null}
                      </Space>
                    )}
                  </Form.List>
                </Space>
              )}
              <div className="report-columns">
                <div className="summary-item">
                  <Typography.Text type="secondary">{costInputMode === "upload" ? "清单不含税 / 工程项" : "工程项小计"}</Typography.Text>
                  <strong>{formatCurrency(liveBudgetSummary.engineeringSubtotal)}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">{costInputMode === "upload" ? "税费 / 其他费用" : "其他费用小计"}</Typography.Text>
                  <strong>{formatCurrency(liveBudgetSummary.otherFeeSubtotal)}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">{costInputMode === "upload" ? "上传清单总价" : "矩阵测算总价"}</Typography.Text>
                  <strong>{formatCurrency(liveBudgetSummary.calculatedBudget)}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">预算差额</Typography.Text>
                  <strong>{formatCurrency(liveBudgetSummary.budgetGap)}</strong>
                </div>
              </div>
            </SectionBlock>
          </Space>
        );
      default:
        return (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <SectionBlock title="材料准备" body="按固定材料槽位整理附件，审核人和管理员都可以直接查看与下载。">
              <Alert
                type={detail?.eligibility.allowed ? "success" : "warning"}
                showIcon
                message={eligibilityMessage}
                style={{ borderRadius: 18 }}
              />
              {currentVersionFailureLog ? (
                <Alert
                  type="error"
                  showIcon
                  message="上次 AI 预审未完成"
                  description={`${currentVersionFailureLog.detail}。请检查草稿内容后重新提交。`}
                  style={{ borderRadius: 18 }}
                />
              ) : null}
              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                {(detail?.currentAttachmentSlots ?? []).map((slot) => (
                  <div key={slot.key} className="summary-item">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <Space style={{ justifyContent: "space-between", width: "100%" }}>
                        <Space>
                          <Typography.Text strong>{slot.label}</Typography.Text>
                          <Tag color={slot.required ? "error" : "default"}>{slot.required ? "必传" : "可选"}</Tag>
                        </Space>
                        {slot.key === "fault_registry" ? (
                          <Button type="link" icon={<DownloadOutlined />} onClick={downloadFaultRegistryTemplate}>
                            下载模板
                          </Button>
                        ) : null}
                      </Space>
                      <Typography.Text type="secondary">{slot.description}</Typography.Text>
                      <List
                        dataSource={slot.attachments}
                        locale={{ emptyText: "暂无文件" }}
                        renderItem={(item) => (
                          <List.Item
                            actions={[
                              <Button
                                key="download"
                                type="link"
                                icon={<DownloadOutlined />}
                                onClick={() => void downloadAttachment(item.id, item.fileName)}
                              >
                                下载
                              </Button>,
                              ...(canEdit
                                ? [
                                    <Button
                                      key="delete"
                                      type="link"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => void deleteAttachment(item.id)}
                                    />
                                  ]
                                : [])
                            ]}
                          >
                            <Space direction="vertical" size={0}>
                              <Typography.Text>{item.fileName}</Typography.Text>
                              <Typography.Text type="secondary">{`${Math.ceil(item.size / 1024)} KB`}</Typography.Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                      {canEdit ? (
                        <label style={{ display: "inline-flex" }}>
                          <input
                            type="file"
                            multiple={slot.key !== "fault_registry"}
                            accept={getFileAccept(slot.key)}
                            hidden
                            onChange={(event) => void uploadFiles(slot.key, event)}
                          />
                          <Button icon={<CloudUploadOutlined />} loading={uploadingKey === slot.key}>
                            上传{slot.label}
                          </Button>
                        </label>
                      ) : null}
                    </Space>
                  </div>
                ))}
              </Space>
            </SectionBlock>

            {currentVersion?.status === "human_approved" ? (
              <SectionBlock title="正式成果物" body="人工审核通过后，直接从当前已审批版本生成正式页面与下载文件。">
                <div className="report-columns">
                  <div className="summary-item">
                    <Typography.Text type="secondary">最终审核报告</Typography.Text>
                    <strong>人工结论 + AI 判断 + 附件留档</strong>
                    <Button type="link" style={{ paddingInline: 0 }}>
                      <Link href={`/projects/${routeParams.projectId}/report/${currentVersion.id}`}>打开最终审核报告</Link>
                    </Button>
                  </div>
                  <div className="summary-item">
                    <Typography.Text type="secondary">可行性报告</Typography.Text>
                    <strong>面向汇报与审批归档的简化版结论</strong>
                    <Button type="link" style={{ paddingInline: 0 }}>
                      <Link href={`/projects/${routeParams.projectId}/feasibility/${currentVersion.id}`}>打开可行性报告</Link>
                    </Button>
                  </div>
                  <div className="summary-item">
                    <Typography.Text type="secondary">工程量清单</Typography.Text>
                    <strong>支持页面预览、PDF 与 Excel 导出</strong>
                    <Button type="link" style={{ paddingInline: 0 }}>
                      <Link href={`/projects/${routeParams.projectId}/bill-of-quantities/${currentVersion.id}`}>打开工程量清单</Link>
                    </Button>
                  </div>
                  <div className="summary-item">
                    <Typography.Text type="secondary">施工方案</Typography.Text>
                    <strong>面向现场执行的施工范围、工序、安全与验收要求</strong>
                    <Button
                      type="link"
                      icon={<FileTextOutlined />}
                      loading={downloadingConstructionPlan}
                      style={{ paddingInline: 0 }}
                      onClick={() =>
                        void downloadGeneratedFile(
                          `/projects/${routeParams.projectId}/versions/${currentVersion.id}/construction-plan.pdf`,
                          `construction-plan-${currentVersion.id}.pdf`
                        )
                      }
                    >
                      下载施工方案 PDF
                    </Button>
                  </div>
                </div>
              </SectionBlock>
            ) : null}
          </Space>
        );
    }
  };

  return (
    <div className="section-grid">
      {contextHolder}
      <section className="glass-card brand-frame page-hero">
        <div className="page-hero-grid">
          <Space direction="vertical" size={14} style={{ maxWidth: 760 }}>
            <span className="hero-kicker">结构化填写与送审</span>
            <Typography.Title className="hero-title">
              {watchedProjectName || detail?.project.title || "立项填写工作面"}
            </Typography.Title>
            <Typography.Paragraph className="document-lead">
              把长表单拆成五个步骤：先定项目基线，再写问题、方案、预算和附件。阅读更轻，填写也更不容易丢步骤。
            </Typography.Paragraph>
          </Space>

          <div className="metric-grid">
            <div className="metric-card">
              <Typography.Text type="secondary">当前版本</Typography.Text>
              <Space>
                {detail ? <StatusTag status={detail.project.status} /> : null}
                <Typography.Text>{currentVersion ? `V${currentVersion.versionNumber}` : "-"}</Typography.Text>
              </Space>
              <Typography.Text type="secondary">
                {autosaving ? "正在自动保存…" : saving ? "正在保存草稿…" : "草稿实时可保存"}
              </Typography.Text>
            </div>
            <div className="metric-card">
              <Typography.Text type="secondary">附件完成度</Typography.Text>
              <strong>{`${attachmentProgress.provided} / ${attachmentProgress.total}`}</strong>
              <Progress percent={attachmentProgress.percent} showInfo={false} strokeColor="var(--accent)" />
            </div>
            <div className="metric-card">
              <span>申报预算</span>
              <strong>{formatCurrency(liveBudgetSummary.declaredBudget)}</strong>
            </div>
            <div className="metric-card">
              <span>预算差额</span>
              <strong>{formatCurrency(liveBudgetSummary.budgetGap)}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="split-layout">
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <section className="section-surface">
            <Space direction="vertical" size={18} style={{ width: "100%" }}>
              <div>
                <Typography.Title level={4} className="section-title">
                  分步填写向导
                </Typography.Title>
                <Typography.Paragraph className="section-copy" style={{ marginTop: 8, marginBottom: 0 }}>
                  每一步只保留当前阶段最需要的字段，切换步骤时会自动保存草稿。
                </Typography.Paragraph>
              </div>
              <Tabs
                className="form-tabs"
                activeKey={String(currentStep)}
                onChange={(next) => void goToStep(Number(next))}
                items={sectionTabItems}
              />
            </Space>
          </section>

          <div className="save-strip" data-state={saveState.tone}>
            <Space size={12} align="start">
              <span className="save-dot" />
              <div>
                <strong>{saveState.title}</strong>
                <span>{saveState.copy}</span>
              </div>
            </Space>
          </div>

          <Form
            form={form}
            layout="vertical"
            preserve
            onValuesChange={(_, allValues) =>
              setLiveSnapshot((previous) => mergeFormSnapshot(previous, allValues as Partial<FormSnapshot>))
            }
          >
            {stepContent()}
          </Form>

          <section className="section-surface">
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                当前操作
              </Typography.Title>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <Space wrap>
                  <Button icon={<LeftOutlined />} disabled={currentStep === 0} onClick={() => void goToStep(currentStep - 1)}>
                    上一步
                  </Button>
                  <Button
                    icon={<RightOutlined />}
                    disabled={currentStep === WIZARD_STEPS.length - 1}
                    onClick={() => void goToStep(currentStep + 1)}
                  >
                    下一步
                  </Button>
                </Space>

                <Space wrap>
                  {canEdit ? (
                    <Button onClick={() => void persistDraft({ notify: true })} loading={saving}>
                      手动保存草稿
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button
                      type="primary"
                      icon={<RocketOutlined />}
                      disabled={Boolean(uploadingKey) || saving}
                      loading={submitting}
                      onClick={submit}
                    >
                      提交 AI 预审
                    </Button>
                  ) : null}
                  {session?.user.role === "submitter" && detail?.project.status !== "draft" ? (
                    <Button icon={<CopyOutlined />} onClick={createVersion}>
                      基于当前内容新建版本
                    </Button>
                  ) : null}
                  {session?.user.role === "submitter" &&
                  ["ai_returned", "human_returned"].includes(detail?.project.status ?? "") ? (
                    <Button icon={<SyncOutlined />} loading={submitting} onClick={retryReview}>
                      创建下一版并再次送审
                    </Button>
                  ) : null}
                </Space>
              </div>
            </Space>
          </section>
        </Space>

        <Space direction="vertical" size={18} className="sticky-stack" style={{ width: "100%" }}>
          <section className="section-surface">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                简版摘要
              </Typography.Title>
              <div className="summary-grid">
                <div className="summary-item">
                  <Typography.Text type="secondary">项目名称</Typography.Text>
                  <strong>{watchedProjectName || detail?.project.title || "待补充"}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">位置摘要</Typography.Text>
                  <strong>{liveLocationSummary}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">预算状态</Typography.Text>
                  <strong>{formatCurrency(liveBudgetSummary.declaredBudget)}</strong>
                  <Typography.Text type="secondary">
                    {`${costInputMode === "upload" ? "上传清单" : "矩阵"} ${formatCurrency(liveBudgetSummary.calculatedBudget)} / 差额 ${formatCurrency(liveBudgetSummary.budgetGap)}`}
                  </Typography.Text>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">提交资格</Typography.Text>
                  <strong>{detail?.eligibility.allowed ? "可提交" : "待满足条件"}</strong>
                  <Typography.Text type="secondary">{eligibilityMessage}</Typography.Text>
                </div>
              </div>
            </Space>
          </section>

          <section className="section-surface">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                版本与产出
              </Typography.Title>
              <List
                dataSource={detail?.versions ?? []}
                renderItem={(item) => {
                  const review = detail?.aiReviews.find((entry) => entry.versionId === item.id);
                  return (
                    <List.Item>
                      <Space direction="vertical" size={6} style={{ width: "100%" }}>
                        <Space style={{ justifyContent: "space-between", width: "100%" }}>
                          <Space>
                            <Typography.Text strong>{`V${item.versionNumber}`}</Typography.Text>
                            <StatusTag status={item.status} />
                          </Space>
                          <Typography.Text type="secondary">{formatDateTime(item.createdAt)}</Typography.Text>
                        </Space>
                        <Typography.Text type="secondary">{review?.conclusion ?? "当前版本暂无 AI 摘要"}</Typography.Text>
                        <Space wrap>
                          <Button type="link" style={{ paddingInline: 0 }}>
                            <Link href={`/projects/${routeParams.projectId}/report/${item.id}`}>最终审核报告</Link>
                          </Button>
                          {item.status === "human_approved" ? (
                            <>
                              <Button type="link" style={{ paddingInline: 0 }}>
                                <Link href={`/projects/${routeParams.projectId}/feasibility/${item.id}`}>可行性报告</Link>
                              </Button>
                              <Button type="link" style={{ paddingInline: 0 }}>
                                <Link href={`/projects/${routeParams.projectId}/bill-of-quantities/${item.id}`}>工程量清单</Link>
                              </Button>
                            </>
                          ) : null}
                        </Space>
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </Space>
          </section>

          <section className="section-surface">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                审计留痕
              </Typography.Title>
              <Timeline
                items={(detail?.auditLogs ?? []).slice(0, 8).map((item) => ({
                  color: "var(--accent)",
                  children: (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{labelFromMap(auditActionLabels, item.action)}</Typography.Text>
                      <Typography.Text>{item.detail}</Typography.Text>
                      <Typography.Text type="secondary">{formatDateTime(item.createdAt)}</Typography.Text>
                    </Space>
                  )
                }))}
              />
            </Space>
          </section>
        </Space>
      </div>
    </div>
  );
}
