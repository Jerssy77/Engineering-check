"use client";

import {
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  PlusOutlined,
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
  createEmptyCostMatrixRow
} from "@property-review/shared";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Row,
  Select,
  Space,
  Timeline,
  Typography,
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
  costRowTypeLabels,
  costRowTypeOptions,
  formatCurrency,
  formatDateTime,
  issueSourceOptions,
  labelFromMap,
  priorityLabels,
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

const BASE_FIELDS = [
  { name: "projectName", label: "项目名称", type: "input", required: true },
  { name: "projectCategory", label: "改造类别", type: "select", options: projectCategoryOptions, required: true },
  { name: "priority", label: "优先级", type: "select", options: priorityOptions, required: true },
  { name: "expectedStartDate", label: "计划开工", type: "date", required: true },
  { name: "expectedEndDate", label: "计划完工", type: "date", required: true },
  { name: "budgetAmount", label: "申报总预算", type: "number", required: true }
] as const;

const LOCATION_FIELDS = [
  ["propertyName", "楼盘/项目"],
  ["building", "楼栋"],
  ["floor", "楼层"],
  ["area", "区域/系统"],
  ["room", "房间/点位"],
  ["equipmentPoint", "设备/组件"],
  ["impactScope", "影响范围"]
] as const;

const PROBLEM_FIELDS = [
  { name: "issueSourceType", label: "问题来源", type: "select", options: issueSourceOptions },
  { name: "urgencyLevel", label: "紧急程度", type: "select", options: urgencyOptions },
  { name: "complaintCount", label: "投诉数", type: "number" },
  { name: "workOrderCount", label: "工单数", type: "number" }
] as const;

const PROBLEM_TEXT_FIELDS = [
  ["issueSourceDescription", "来源说明"],
  ["issueDescription", "问题描述"],
  ["currentCondition", "现状判断"],
  ["temporaryMeasures", "临时措施"]
] as const;

const TECHNICAL_FIELDS = [
  ["objective", "改造目标"],
  ["implementationScope", "实施范围"],
  ["feasibilitySummary", "可行性说明"],
  ["keyProcess", "关键工艺"],
  ["materialSelection", "材料选型"],
  ["maintenancePlan", "运维要求"],
  ["acceptancePlan", "验收方案"],
  ["hiddenWorksRequirement", "隐蔽工程要求"],
  ["sampleFirstRequirement", "样板先行要求"],
  ["detailDrawingRequirement", "节点详图要求"],
  ["thirdPartyTestingRequirement", "第三方检测要求"],
  ["preliminaryPlan", "初步方案"]
] as const;

const BUSINESS_TEXT_FIELDS = [
  ["initialBudgetExplanation", "预算依据"],
  ["expectedBenefits", "预期效果"],
  ["supplementaryNotes", "补充说明"]
] as const;

const REQUIRED_TECHNICAL_FIELDS = new Set([
  "objective",
  "implementationScope",
  "feasibilitySummary",
  "keyProcess",
  "materialSelection",
  "acceptancePlan",
  "preliminaryPlan"
]);

function buildBudgetSummary(values?: Partial<FormSnapshot>): BudgetSummary {
  return calculateBudgetSummary({
    costMatrixRows: values?.costMatrixRows ?? [],
    declaredBudget: values?.budgetAmount ?? 0
  });
}

function getFileAccept(slotKey: string): string | undefined {
  if (slotKey === "issue_photos") return "image/*";
  if (slotKey === "fault_registry") return ".xls,.xlsx,.csv";
  if (slotKey === "drawings") return ".pdf,image/*";
  return undefined;
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
  const [submitting, setSubmitting] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [form] = Form.useForm<FormSnapshot>();
  const session = getSession();

  const applyDetailResponse = (response: ProjectDetailResponse) => {
    setDetail(response);
    const current = response.versions.find((item) => item.id === response.project.currentVersionId) ?? response.versions[0];
    if (current) {
      form.setFieldsValue(current.snapshot);
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
  const watchedBudget = Form.useWatch("budgetAmount", form);
  const watchedCostRows = Form.useWatch("costMatrixRows", form);
  const liveBudgetSummary = useMemo(
    () =>
      buildBudgetSummary({
        ...form.getFieldsValue(true),
        budgetAmount: watchedBudget,
        costMatrixRows: watchedCostRows
      }),
    [form, watchedBudget, watchedCostRows]
  );

  const patchCurrentVersion = async (values: FormSnapshot) => {
    if (!currentVersion) return;
    const response = await apiRequest<ProjectDetailResponse>(
      `/projects/${routeParams.projectId}/versions/${currentVersion.id}`,
      { method: "PATCH", body: JSON.stringify(values) },
      session
    );
    applyDetailResponse(response);
    return response;
  };

  const saveDraft = async (values: FormSnapshot) => {
    setSaving(true);
    try {
      await patchCurrentVersion(values);
      messageApi.success("草稿已保存");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
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
        messageApi.error("请先补全必填信息再提交 AI 预审");
      } else {
        messageApi.error(error instanceof Error ? error.message : "提交失败");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const createVersion = async () => {
    await apiRequest(`/projects/${routeParams.projectId}/versions`, { method: "POST" }, session);
    messageApi.success("新版本已创建");
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
      messageApi.success("AI 预审已重新发起，系统正在后台处理");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重新送审失败");
    } finally {
      setSubmitting(false);
    }
  };

  const insertTechnicalTemplate = () => {
    const category = (form.getFieldValue("projectCategory") ?? currentVersion?.snapshot.projectCategory ?? "mep_upgrade") as ProjectCategory;
    const template = technicalSchemeTemplates[category];
    const hasExistingContent = TECHNICAL_FIELDS.some(([field]) => {
      const value = form.getFieldValue(field);
      return typeof value === "string" && value.trim().length > 0;
    });

    if (hasExistingContent && !window.confirm("技术方案中已有内容，是否用模板内容覆盖这些字段？")) {
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
      messageApi.success("材料上传成功");
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

  const downloadFaultRegistryTemplate = () => {
    window.open(buildApiUrl("/files/templates/fault-registry.xlsx"), "_blank");
  };

  const eligibilityMessage = detail?.eligibility.allowed
    ? `可提交 AI 预审，本周剩余 ${detail.eligibility.remainingWeeklyQuota} 次。`
    : detail?.eligibility.reason === "cooldown_active"
      ? `冷却期未结束，最早 ${formatDateTime(detail.eligibility.blockedUntil)} 后再提交。`
      : detail?.eligibility.reason === "weekly_quota_reached"
        ? "城市公司本周 AI 额度已用完。"
        : "当前状态下暂不能提交。";

  return (
    <div className="section-grid">
      {contextHolder}
      <section className="glass-card" style={{ padding: 26 }}>
        <Space direction="vertical" size={10}>
          <Space wrap>
            <span className="hero-kicker">立项详情</span>
            {detail && <StatusTag status={detail.project.status} />}
          </Space>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {detail?.project.title ?? "加载中..."}
          </Typography.Title>
          <Typography.Paragraph style={{ color: "#56636a", marginBottom: 0 }}>
            按标准化模块填写问题、技术方案、成本矩阵和固定材料，系统会据此完成 AI 审核与重复改造识别。
          </Typography.Paragraph>
        </Space>
      </section>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={17}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            {detail && (
              <Alert
                type={detail.eligibility.allowed ? "success" : "warning"}
                showIcon
                message={eligibilityMessage}
                description={
                  detail.eligibility.overrideAvailable
                    ? "当前项目已有可用特批。"
                    : "提交时后端会再次校验额度、冷却期、矩阵金额和必传材料。"
                }
                style={{ marginBottom: 18, borderRadius: 18 }}
              />
            )}
            {currentVersionFailureLog && (
              <Alert
                type="error"
                showIcon
                message="AI 预审未完成"
                description={`${currentVersionFailureLog.detail}。请检查草稿内容后重新提交。`}
                style={{ marginBottom: 18, borderRadius: 18 }}
              />
            )}

            <Form form={form} layout="vertical" onFinish={saveDraft}>
              <Card title="基础信息" style={{ marginBottom: 18, borderRadius: 18 }}>
                <Row gutter={16}>
                  {BASE_FIELDS.map((field) => (
                    <Col span={field.name === "budgetAmount" ? 12 : 8} key={field.name}>
                      <FieldRenderer disabled={!canEdit} field={field} />
                    </Col>
                  ))}
                </Row>
                {canEdit && (
                  <Button onClick={() => form.setFieldValue("budgetAmount", liveBudgetSummary.calculatedBudget)}>
                    同步自动总价到总预算
                  </Button>
                )}
              </Card>

              <Card title="位置与问题" style={{ marginBottom: 18, borderRadius: 18 }}>
                <Row gutter={16}>
                  {LOCATION_FIELDS.map(([key, label]) => (
                    <Col span={key === "impactScope" ? 12 : 8} key={key}>
                      <Form.Item
                        name={["location", key]}
                        label={label}
                        rules={key === "propertyName" ? [{ required: true, message: "请填写楼盘/项目" }] : undefined}
                      >
                        <Input disabled={!canEdit} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
                <Row gutter={16}>
                  {PROBLEM_FIELDS.map((field) => (
                    <Col span={field.type === "select" ? 12 : 6} key={field.name}>
                      <FieldRenderer disabled={!canEdit} field={field} />
                    </Col>
                  ))}
                </Row>
                {PROBLEM_TEXT_FIELDS.map(([name, label]) => (
                  <Form.Item
                    key={name}
                    name={name}
                    label={label}
                    rules={["issueDescription", "currentCondition"].includes(name) ? [{ required: true, message: `请填写${label}` }] : undefined}
                  >
                    <Input.TextArea rows={3} disabled={!canEdit} />
                  </Form.Item>
                ))}
              </Card>

              <Card
                title="技术方案"
                extra={
                  canEdit ? (
                    <Button icon={<FileTextOutlined />} onClick={insertTechnicalTemplate}>
                      插入模板
                    </Button>
                  ) : null
                }
                style={{ marginBottom: 18, borderRadius: 18 }}
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16, borderRadius: 16 }}
                  message="可一键插入当前改造类别的技术方案模板，关键参数会用 xxx 占位。"
                />
                {TECHNICAL_FIELDS.map(([name, label]) => (
                  <Form.Item
                    key={name}
                    name={name}
                    label={label}
                    rules={REQUIRED_TECHNICAL_FIELDS.has(name) ? [{ required: true, message: `请填写${label}` }] : undefined}
                  >
                    <Input.TextArea rows={3} disabled={!canEdit} />
                  </Form.Item>
                ))}
                {BUSINESS_TEXT_FIELDS.map(([name, label]) => (
                  <Form.Item
                    key={name}
                    name={name}
                    label={label}
                    rules={["initialBudgetExplanation", "expectedBenefits"].includes(name) ? [{ required: true, message: `请填写${label}` }] : undefined}
                  >
                    <Input.TextArea rows={3} disabled={!canEdit} />
                  </Form.Item>
                ))}
              </Card>

              <Card title="费用测算矩阵" style={{ marginBottom: 18, borderRadius: 18 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1.8fr 1.5fr 1fr 1fr 1.2fr 1.2fr 1.8fr 64px",
                    gap: 8,
                    fontWeight: 600,
                    marginBottom: 12,
                    color: "#47545a"
                  }}
                >
                  <div>类型</div>
                  <div>费用项/清单项</div>
                  <div>规格型号</div>
                  <div>单位</div>
                  <div>数量</div>
                  <div>单价</div>
                  <div>合价</div>
                  <div>测算依据/备注</div>
                  <div />
                </div>

                <Form.List name="costMatrixRows">
                  {(fields, { add, remove }) => (
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      {fields.map((field) => {
                        const currentRow = (form.getFieldValue(["costMatrixRows", field.name]) ?? {}) as Partial<CostMatrixRow>;
                        return (
                          <div
                            key={field.key}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1.2fr 1.8fr 1.5fr 1fr 1fr 1.2fr 1.2fr 1.8fr 64px",
                              gap: 8,
                              alignItems: "start"
                            }}
                          >
                            <Form.Item name={[field.name, "type"]} rules={[{ required: true, message: "请选择类型" }]} style={{ marginBottom: 0 }}>
                              <Select disabled={!canEdit} options={costRowTypeOptions} />
                            </Form.Item>
                            <Form.Item name={[field.name, "itemName"]} rules={[{ required: true, message: "请填写费用项" }]} style={{ marginBottom: 0 }}>
                              <Input disabled={!canEdit} />
                            </Form.Item>
                            <Form.Item name={[field.name, "specification"]} style={{ marginBottom: 0 }}>
                              <Input disabled={!canEdit} />
                            </Form.Item>
                            <Form.Item name={[field.name, "unit"]} style={{ marginBottom: 0 }}>
                              <Input disabled={!canEdit} />
                            </Form.Item>
                            <Form.Item name={[field.name, "quantity"]} rules={[{ required: true, message: "请填写数量" }]} style={{ marginBottom: 0 }}>
                              <InputNumber style={{ width: "100%" }} min={0.01} disabled={!canEdit} />
                            </Form.Item>
                            <Form.Item name={[field.name, "unitPrice"]} rules={[{ required: true, message: "请填写单价" }]} style={{ marginBottom: 0 }}>
                              <InputNumber style={{ width: "100%" }} min={0.01} disabled={!canEdit} />
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
                            <div>
                              {canEdit && (
                                <Button
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={() => remove(field.name)}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {canEdit && (
                        <Space wrap>
                          <Button
                            icon={<PlusOutlined />}
                            onClick={() => add(createEmptyCostMatrixRow("engineering"))}
                          >
                            新增工程量行
                          </Button>
                          <Button
                            icon={<PlusOutlined />}
                            onClick={() => add(createEmptyCostMatrixRow("other_fee"))}
                          >
                            新增其他费用行
                          </Button>
                        </Space>
                      )}
                    </Space>
                  )}
                </Form.List>

                <Divider />
                <Descriptions column={2} bordered>
                  <Descriptions.Item label="工程量合计">
                    {formatCurrency(liveBudgetSummary.engineeringSubtotal)}
                  </Descriptions.Item>
                  <Descriptions.Item label="其他费用合计">
                    {formatCurrency(liveBudgetSummary.otherFeeSubtotal)}
                  </Descriptions.Item>
                  <Descriptions.Item label="自动总价">
                    {formatCurrency(liveBudgetSummary.calculatedBudget)}
                  </Descriptions.Item>
                  <Descriptions.Item label="申报总预算">
                    {formatCurrency(liveBudgetSummary.declaredBudget)}
                  </Descriptions.Item>
                  <Descriptions.Item label="差额" span={2}>
                    <Typography.Text type={liveBudgetSummary.budgetGap === 0 ? "success" : "danger"}>
                      {formatCurrency(liveBudgetSummary.budgetGap)}
                    </Typography.Text>
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              <Card title="材料槽位" style={{ marginBottom: 18, borderRadius: 18 }}>
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  {(detail?.currentAttachmentSlots ?? []).map((slot) => (
                    <Card
                      key={slot.key}
                      size="small"
                      title={
                        <Space>
                          <Typography.Text strong>{slot.label}</Typography.Text>
                          <Typography.Text type={slot.required ? "danger" : "secondary"}>
                            {slot.required ? "必传" : "可选"}
                          </Typography.Text>
                        </Space>
                      }
                      extra={
                        <Space>
                          <Typography.Text type={slot.status === "missing" ? "danger" : "secondary"}>
                            {slot.status === "provided" ? "已提供" : slot.status === "missing" ? "缺失" : "可选"}
                          </Typography.Text>
                          {slot.key === "fault_registry" && (
                            <Button type="link" icon={<DownloadOutlined />} onClick={downloadFaultRegistryTemplate}>
                              下载模板
                            </Button>
                          )}
                        </Space>
                      }
                    >
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                        {slot.description}
                      </Typography.Paragraph>
                      <List
                        dataSource={slot.attachments}
                        locale={{ emptyText: "暂无文件" }}
                        renderItem={(item) => (
                          <List.Item
                            actions={
                              canEdit
                                ? [
                                    <Button
                                      key="delete"
                                      danger
                                      type="link"
                                      icon={<DeleteOutlined />}
                                      onClick={() => void deleteAttachment(item.id)}
                                    />
                                  ]
                                : []
                            }
                          >
                            <Space direction="vertical" size={0}>
                              <Typography.Text>{item.fileName}</Typography.Text>
                              <Typography.Text type="secondary">{`${Math.ceil(item.size / 1024)} KB`}</Typography.Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                      {canEdit && (
                        <label style={{ display: "inline-flex", marginTop: 8 }}>
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
                      )}
                    </Card>
                  ))}
                </Space>
              </Card>

              <Space wrap>
                {canEdit && (
                  <Button type="primary" htmlType="submit" loading={saving}>
                    保存草稿
                  </Button>
                )}
                {canEdit && (
                  <Button
                    type="primary"
                    ghost
                    icon={<RocketOutlined />}
                    disabled={Boolean(uploadingKey) || saving}
                    loading={submitting}
                    onClick={submit}
                  >
                    提交 AI 预审
                  </Button>
                )}
                {session?.user.role === "submitter" && detail?.project.status !== "draft" && (
                  <Button icon={<CopyOutlined />} onClick={createVersion}>
                    基于当前内容新建版本
                  </Button>
                )}
                {session?.user.role === "submitter" &&
                  ["ai_returned", "human_returned"].includes(detail?.project.status ?? "") && (
                    <Button icon={<SyncOutlined />} loading={submitting} onClick={retryReview}>
                      创建下一版并再次送审
                    </Button>
                  )}
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} xl={7}>
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
              <Typography.Title level={4}>当前版本</Typography.Title>
              {currentVersion && (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="版本">V{currentVersion.versionNumber}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <StatusTag status={currentVersion.status} />
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {formatDateTime(currentVersion.createdAt)}
                  </Descriptions.Item>
                  <Descriptions.Item label="分类">
                    {labelFromMap(categoryLabels, currentVersion.snapshot.projectCategory)}
                  </Descriptions.Item>
                  <Descriptions.Item label="优先级">
                    {labelFromMap(priorityLabels, currentVersion.snapshot.priority)}
                  </Descriptions.Item>
                  <Descriptions.Item label="预算">
                    {formatCurrency(currentVersion.snapshot.budgetAmount)}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </Card>

            <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
              <Typography.Title level={4}>版本时间线</Typography.Title>
              <List
                dataSource={detail?.versions ?? []}
                renderItem={(item) => {
                  const review = detail?.aiReviews.find((entry) => entry.versionId === item.id);
                  return (
                    <List.Item
                      actions={
                        review
                          ? [<Link key="report" href={`/projects/${routeParams.projectId}/report/${item.id}`}>查看结论</Link>]
                          : []
                      }
                    >
                      <Space direction="vertical" size={2}>
                        <Space>
                          <Typography.Text strong>V{item.versionNumber}</Typography.Text>
                          <StatusTag status={item.status} />
                        </Space>
                        <Typography.Text type="secondary">{formatDateTime(item.createdAt)}</Typography.Text>
                        {review && <Typography.Text>{review.conclusion}</Typography.Text>}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </Card>

            <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
              <Typography.Title level={4}>审计留痕</Typography.Title>
              <Timeline
                items={(detail?.auditLogs ?? []).slice(0, 8).map((item) => ({
                  color: "#146c6f",
                  children: (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{labelFromMap(auditActionLabels, item.action)}</Typography.Text>
                      <Typography.Text>{item.detail}</Typography.Text>
                      <Typography.Text type="secondary">{formatDateTime(item.createdAt)}</Typography.Text>
                    </Space>
                  )
                }))}
              />
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
}
