"use client";

import {
  CheckCircleOutlined,
  DownloadOutlined,
  FileProtectOutlined,
  RollbackOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { ProjectStatus, VersionAttachmentSlot } from "@property-review/shared";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Input,
  List,
  Row,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { StatusTag } from "../../../../../../components/status-tag";
import { apiRequest } from "../../../../../../lib/api";
import { formatCurrency, formatDateTime } from "../../../../../../lib/presentation";
import { getSession } from "../../../../../../lib/session";

const EMPTY_TEXT = "未提供，需补充";

type ReviewVerdict = "pass" | "conditional_pass" | "fail";
type DecisionStatus = "pending" | "approved" | "returned";

interface NormCitation {
  id: string;
  code: string;
  title: string;
  clause: string;
}

interface MandatoryRequirement {
  severity: "high" | "medium" | "low";
  title: string;
  requirement: string;
  reason: string;
  citationIds: string[];
  writebackText: string;
  requiredMaterials: string[];
}

interface InternalControlRequirement {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  requirement: string;
  reason: string;
  action: string;
  requiredMaterials: string[];
  source: "platform_policy" | "skill_pack";
  ruleId?: string;
  writebackText?: string;
}

interface AdvisoryRecommendation {
  id: string;
  title: string;
  recommendation: string;
  reason: string;
  requiredMaterials: string[];
}

interface SchemeWritebackCandidate {
  id: string;
  title: string;
  targetSection: string;
  text: string;
  basis: string;
  autoApplied?: boolean;
}

interface ReviewFinding {
  severity: "high" | "medium" | "low";
  title: string;
  basis: string;
  currentState: string;
  action: string;
  requiredMaterials: string[];
}

interface ReviewSection {
  title: string;
  summary?: string;
  conclusion: string;
  findings: ReviewFinding[];
  optimizationCandidates?: AdvisoryRecommendation[];
  costQuestions?: string[];
  mustKeepItems?: string[];
  alternativePaths?: AdvisoryRecommendation[];
}

interface FinalReviewResponse {
  project: {
    id: string;
    title: string;
    status: ProjectStatus;
    statusLabel: string;
    organizationName: string;
  };
  version: {
    id: string;
    versionNumber: number;
    status: ProjectStatus;
    statusLabel: string;
    createdAt: string;
    submittedAt?: string;
    aiReviewedAt?: string;
  };
  summary: {
    categoryLabel: string;
    priorityLabel: string;
    locationSummary: string;
    expectedWindow: string;
    declaredBudget: number;
    calculatedBudget: number;
    budgetGap: number;
  };
  finalDecision: {
    status: DecisionStatus;
    label: string;
    reviewerName?: string;
    reviewerRole?: string;
    decidedAt?: string;
    comment?: string;
    selectedWritebackIds: string[];
  };
  aiSummary: {
    verdict?: ReviewVerdict;
    verdictLabel: string;
    overallScore?: number;
    conclusion: string;
    modelName?: string;
    generatedAt?: string;
    missingMaterials: string[];
    requiredActions: string[];
    attachmentReadSummary: string[];
    citations: NormCitation[];
    mandatoryRequirements: MandatoryRequirement[];
    internalControlRequirements: InternalControlRequirement[];
    advisoryRecommendations: AdvisoryRecommendation[];
    advisoryWritebackCandidates: SchemeWritebackCandidate[];
    schemeWritebacks: SchemeWritebackCandidate[];
    costEstimateRanges: Array<{
      id: string;
      itemName: string;
      basis: string;
      currentAmount?: number;
      suggestedMin?: number;
      suggestedMax?: number;
      optimizationSpace: string;
      requiresManualReview: boolean;
      relatedRuleIds: string[];
    }>;
    skillPackVersion?: string;
  };
  sections: {
    compliance?: ReviewSection;
    cost?: ReviewSection;
    technical?: ReviewSection;
    duplicate?: {
      title: string;
      conclusion: string;
      matches: Array<{
        projectTitle: string;
        versionNumber: number;
        createdAt: string;
        matchReason: string;
        locationSummary: string;
      }>;
    };
  };
  budgetSummary: {
    engineeringSubtotal: number;
    otherFeeSubtotal: number;
    calculatedBudget: number;
    declaredBudget: number;
    budgetGap: number;
    topCostItems: Array<{ itemName: string; specification: string; lineTotal: number }>;
  };
  problemContext: {
    issueSourceType: string;
    issueSourceDescription: string;
    issueDescription: string;
    currentCondition: string;
    temporaryMeasures: string;
  };
  attachmentSlots: VersionAttachmentSlot[];
  analysis: {
    costMustKeepItems: string[];
    costQuestions: string[];
    technicalAlternativePaths: AdvisoryRecommendation[];
    adoptedWritebacks: SchemeWritebackCandidate[];
  };
}

function withFallback(value?: string | number) {
  if (typeof value === "number") {
    return String(value);
  }
  return value && value.trim().length > 0 ? value : EMPTY_TEXT;
}

function severityLabel(value: "high" | "medium" | "low") {
  return value === "high" ? "高" : value === "medium" ? "中" : "低";
}

function severityColor(value: "high" | "medium" | "low") {
  return value === "high" ? "red" : value === "medium" ? "orange" : "blue";
}

function decisionType(status: DecisionStatus) {
  if (status === "approved") return "success";
  if (status === "returned") return "warning";
  return "info";
}

function SectionCard({
  title,
  children,
  extra
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="section-surface">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div className="section-title-row">
          <Typography.Title level={4} className="section-title">
            {title}
          </Typography.Title>
          {extra}
        </div>
        {children}
      </Space>
    </section>
  );
}

export default function ReportPage({
  params
}: {
  params: Promise<{ projectId: string; versionId: string }>;
}) {
  const routeParams = use(params);
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<FinalReviewResponse | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [selectedWritebackIds, setSelectedWritebackIds] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [downloadingFinalPdf, setDownloadingFinalPdf] = useState(false);
  const [downloadingConstructionPlan, setDownloadingConstructionPlan] = useState(false);
  const session = getSession();
  const canReview = session?.user.role !== "submitter";

  const citationLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const citation of report?.aiSummary.citations ?? []) {
      map.set(citation.id, `${citation.code} ${citation.title} ${citation.clause}`);
    }
    return map;
  }, [report?.aiSummary.citations]);

    const load = async (options?: { background?: boolean; suppressErrors?: boolean }) => {
    if (!session) {
      router.replace("/login");
      return;
    }

    if (!options?.background) {
      setLoading(true);
    }
    try {
      const response = await apiRequest<FinalReviewResponse>(
        `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/final-review-report`,
        {},
        session
      );
      setReport(response);
      setSelectedWritebackIds(response.finalDecision.selectedWritebackIds ?? []);
    } catch (error) {
      if (!options?.suppressErrors) {
        messageApi.error(error instanceof Error ? error.message : "加载最终审核报告失败");
      }
    } finally {
      if (!options?.background) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [routeParams.projectId, routeParams.versionId]);

  useEffect(() => {
    if (report?.version.status !== "ai_reviewing") {
      return;
    }

    const timer = window.setInterval(() => {
      void load({ background: true, suppressErrors: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [report?.version.status, routeParams.projectId, routeParams.versionId]);
  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const downloadAsset = async (
    path: string,
    fileName: string,
    setBusy?: (value: boolean) => void
  ) => {
    if (!session) {
      return;
    }

    setBusy?.(true);
    try {
      const blob = await apiRequest<Blob>(path, {}, session);
      triggerBlobDownload(blob, fileName);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "下载失败，请稍后重试");
    } finally {
      setBusy?.(false);
    }
  };

  const submitDecision = async (decision: "approved" | "returned") => {
    if (!session || decisionSubmitting) {
      return;
    }

    const comment = decisionComment.trim();
    if (!comment) {
      messageApi.warning("请先填写人工审核意见");
      return;
    }

    setDecisionSubmitting(true);
    try {
      await apiRequest(
        `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/human-decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            comment,
            selectedWritebackIds: decision === "approved" ? selectedWritebackIds : []
          })
        },
        session
      );
      messageApi.success(decision === "approved" ? "已通过该版本" : "已退回该版本");
      setDecisionComment("");
      await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "提交人工审核失败");
    } finally {
      setDecisionSubmitting(false);
    }
  };

  const grantOverride = async () => {
    if (!session || overrideSubmitting) {
      return;
    }

    const reason = overrideReason.trim();
    if (!reason) {
      messageApi.warning("请先填写特批原因");
      return;
    }

    setOverrideSubmitting(true);
    try {
      await apiRequest(
        `/projects/${routeParams.projectId}/override-grants`,
        { method: "POST", body: JSON.stringify({ scope: "both", reason }) },
        session
      );
      messageApi.success("已发放一次性特批");
      setOverrideReason("");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "特批发放失败");
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const canApprove =
    canReview &&
    report?.aiSummary.verdict !== "fail" &&
    ["ai_recommended_pass", "ai_conditionally_passed"].includes(report?.version.status ?? "");

  return (
    <div className="section-grid">
      {contextHolder}

      <section className="glass-card brand-frame document-cover">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap>
            <span className="hero-kicker">最终审核报告</span>
            {report ? <StatusTag status={report.version.status} /> : null}
          </Space>
          <Typography.Title className="hero-title" style={{ marginBottom: 0 }}>
            {report?.project.title ?? "工程立项最终审核报告"}
          </Typography.Title>
          <Typography.Paragraph className="document-lead">
            先呈现人工最终结论、审核意见和预算摘要，再展开 AI 判断依据、规范要求、风险与原始附件。
          </Typography.Paragraph>
        </Space>
      </section>

      {loading ? (
        <section className="section-surface">
          <Typography.Text>正在加载最终审核报告...</Typography.Text>
        </section>
      ) : null}

      {!loading && report ? (
        <div className="split-layout">
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <SectionCard title="人工最终结论">
              <Alert
                showIcon
                type={decisionType(report.finalDecision.status)}
                message={report.finalDecision.label}
                description={
                  report.finalDecision.status === "pending"
                    ? "当前版本尚未形成人工最终结论。"
                    : `${withFallback(report.finalDecision.comment)}`
                }
              />
              <Descriptions column={2} bordered>
                <Descriptions.Item label="审核人">
                  {withFallback(report.finalDecision.reviewerName)}
                </Descriptions.Item>
                <Descriptions.Item label="审核组织">
                  {withFallback(report.finalDecision.reviewerRole)}
                </Descriptions.Item>
                <Descriptions.Item label="审核时间">
                  {report.finalDecision.decidedAt ? formatDateTime(report.finalDecision.decidedAt) : EMPTY_TEXT}
                </Descriptions.Item>
                <Descriptions.Item label="当前版本">V{report.version.versionNumber}</Descriptions.Item>
              </Descriptions>
            </SectionCard>

            <SectionCard title="预算与版本摘要">
              <Descriptions column={2} bordered>
                <Descriptions.Item label="申报组织">{report.project.organizationName}</Descriptions.Item>
                <Descriptions.Item label="项目分类">{report.summary.categoryLabel}</Descriptions.Item>
                <Descriptions.Item label="实施位置">{report.summary.locationSummary}</Descriptions.Item>
                <Descriptions.Item label="计划周期">{report.summary.expectedWindow}</Descriptions.Item>
                <Descriptions.Item label="申报预算">{formatCurrency(report.summary.declaredBudget)}</Descriptions.Item>
                <Descriptions.Item label="测算预算">{formatCurrency(report.summary.calculatedBudget)}</Descriptions.Item>
                <Descriptions.Item label="预算差额">{formatCurrency(report.summary.budgetGap)}</Descriptions.Item>
                <Descriptions.Item label="AI 审核时间">
                  {report.version.aiReviewedAt ? formatDateTime(report.version.aiReviewedAt) : EMPTY_TEXT}
                </Descriptions.Item>
              </Descriptions>
            </SectionCard>

            <SectionCard title="AI 审核摘要">
              <Alert
                showIcon
                type={
                  report.aiSummary.verdict === "pass"
                    ? "success"
                    : report.aiSummary.verdict === "fail"
                      ? "error"
                      : "warning"
                }
                message={`AI 结论：${report.aiSummary.verdictLabel}`}
                description={withFallback(report.aiSummary.conclusion)}
              />
              <Descriptions column={2} bordered>
                <Descriptions.Item label="AI 评分">
                  {report.aiSummary.overallScore ?? EMPTY_TEXT}
                </Descriptions.Item>
                <Descriptions.Item label="模型">{withFallback(report.aiSummary.modelName)}</Descriptions.Item>
              </Descriptions>
            </SectionCard>

            <SectionCard title="强制规范要求">
              <List
                className="list-plain"
                dataSource={report.aiSummary.mandatoryRequirements}
                locale={{ emptyText: "当前版本未形成可直接写回方案的强制规范要求。" }}
                renderItem={(item) => (
                  <List.Item style={{ display: "block" }}>
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Space wrap>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Tag color={severityColor(item.severity)}>{severityLabel(item.severity)}</Tag>
                      </Space>
                      <Typography.Text>{item.requirement}</Typography.Text>
                      <Typography.Text type="secondary">
                        依据：
                        {item.citationIds.map((id) => citationLabelMap.get(id)).filter(Boolean).join("；") ||
                          "待补充明确条款"}
                      </Typography.Text>
                      <Typography.Text type="secondary">写回方案：{withFallback(item.writebackText)}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="平台审批硬性要求">
              <List
                className="list-plain"
                dataSource={report.aiSummary.internalControlRequirements}
                locale={{ emptyText: "当前版本未形成额外平台审批硬性要求。" }}
                renderItem={(item) => (
                  <List.Item style={{ display: "block" }}>
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Space wrap>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Tag color={severityColor(item.severity)}>{severityLabel(item.severity)}</Tag>
                        <Tag>{item.source === "skill_pack" ? "场景规则" : "平台内控"}</Tag>
                      </Space>
                      <Typography.Text>{item.requirement}</Typography.Text>
                      <Typography.Text type="secondary">触发原因：{withFallback(item.reason)}</Typography.Text>
                      <Typography.Text type="secondary">整改动作：{withFallback(item.action)}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="已采纳 AI 优化建议">
              <List
                className="list-plain"
                dataSource={report.analysis.adoptedWritebacks}
                locale={{ emptyText: "当前版本尚未采纳 AI 优化建议。" }}
                renderItem={(item) => (
                  <List.Item style={{ display: "block" }}>
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Typography.Text strong>{item.title}</Typography.Text>
                      <Typography.Text>{item.text}</Typography.Text>
                      <Typography.Text type="secondary">依据：{withFallback(item.basis)}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="核心风险与处理建议">
              {[report.sections.compliance, report.sections.cost, report.sections.technical]
                .filter(Boolean)
                .map((section) => (
                  <Card key={section?.title} bordered={false} className="soft-panel">
                    <Typography.Title level={5}>{section?.title}</Typography.Title>
                    <Typography.Paragraph>{section?.summary ?? section?.conclusion}</Typography.Paragraph>
                    <List
                      className="list-plain"
                      dataSource={section?.findings ?? []}
                      locale={{ emptyText: "暂无结构化问题。" }}
                      renderItem={(item) => (
                        <List.Item style={{ display: "block" }}>
                          <Space direction="vertical" size={4} style={{ width: "100%" }}>
                            <Space wrap>
                              <Typography.Text strong>{item.title}</Typography.Text>
                              <Tag color={severityColor(item.severity)}>{severityLabel(item.severity)}</Tag>
                            </Space>
                            <Typography.Text>当前情况：{withFallback(item.currentState)}</Typography.Text>
                            <Typography.Text>建议动作：{withFallback(item.action)}</Typography.Text>
                            <Typography.Text type="secondary">依据：{withFallback(item.basis)}</Typography.Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                ))}
            </SectionCard>

            <SectionCard title="成本经验区间复核">
              <List
                className="list-plain"
                dataSource={report.aiSummary.costEstimateRanges}
                locale={{ emptyText: "当前版本暂无需要经验区间复核的高占比费用项。" }}
                renderItem={(item) => (
                  <List.Item style={{ display: "block" }}>
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Typography.Text strong>{item.itemName}</Typography.Text>
                      <Typography.Text>{item.optimizationSpace}</Typography.Text>
                      <Typography.Text type="secondary">
                        {item.suggestedMin && item.suggestedMax
                          ? `建议复核区间：${formatCurrency(item.suggestedMin)} - ${formatCurrency(item.suggestedMax)}`
                          : "建议由审核人与造价人员结合现场边界复核。"}
                      </Typography.Text>
                      <Typography.Text type="secondary">依据：{withFallback(item.basis)}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="重复改造识别">
              <Typography.Paragraph>
                {report.sections.duplicate?.conclusion ?? "未命中疑似重复改造。"}
              </Typography.Paragraph>
              <List
                className="list-plain"
                dataSource={report.sections.duplicate?.matches ?? []}
                locale={{ emptyText: "未命中疑似重复改造。" }}
                renderItem={(item) => (
                  <List.Item style={{ display: "block" }}>
                    <Typography.Text strong>{`${item.projectTitle} / V${item.versionNumber}`}</Typography.Text>
                    <br />
                    <Typography.Text>{withFallback(item.matchReason)}</Typography.Text>
                    <br />
                    <Typography.Text type="secondary">
                      {`${withFallback(item.locationSummary)} · ${formatDateTime(item.createdAt)}`}
                    </Typography.Text>
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="需补材料与后续动作">
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                  <Card size="small" title="需补材料" className="soft-panel">
                    <List
                      dataSource={
                        report.aiSummary.missingMaterials.length ? report.aiSummary.missingMaterials : [EMPTY_TEXT]
                      }
                      renderItem={(item) => <List.Item>{item}</List.Item>}
                    />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="必改动作" className="soft-panel">
                    <List
                      dataSource={report.aiSummary.requiredActions.length ? report.aiSummary.requiredActions : [EMPTY_TEXT]}
                      renderItem={(item) => <List.Item>{item}</List.Item>}
                    />
                  </Card>
                </Col>
              </Row>
            </SectionCard>

            <SectionCard title="原始附件">
              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                {report.attachmentSlots.map((slot) => (
                  <Card
                    key={slot.key}
                    size="small"
                    title={slot.label}
                    extra={<Tag>{slot.required ? "必传" : "可选"}</Tag>}
                    className="soft-panel"
                  >
                    <Typography.Paragraph type="secondary">{slot.description}</Typography.Paragraph>
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
                              onClick={() => void downloadAsset(`/files/${item.id}/download`, item.fileName)}
                            >
                              下载
                            </Button>
                          ]}
                        >
                          <Space direction="vertical" size={0}>
                            <Typography.Text>{item.fileName}</Typography.Text>
                            <Typography.Text type="secondary">{`${Math.ceil(item.size / 1024)} KB`}</Typography.Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                ))}
              </Space>
            </SectionCard>
          </Space>

          <Space direction="vertical" size={18} className="sticky-stack" style={{ width: "100%" }}>
            <section className="section-surface">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Title level={4} className="section-title">
                  导出与跳转
                </Typography.Title>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  loading={downloadingFinalPdf}
                  onClick={() =>
                    void downloadAsset(
                      `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/final-review-report.pdf`,
                      `final-review-${routeParams.versionId}.pdf`,
                      setDownloadingFinalPdf
                    )
                  }
                  block
                >
                  下载最终审核报告 PDF
                </Button>
                <Button
                  icon={<FileProtectOutlined />}
                  loading={downloadingConstructionPlan}
                  onClick={() =>
                    void downloadAsset(
                      `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/construction-plan.pdf`,
                      `construction-plan-${routeParams.versionId}.pdf`,
                      setDownloadingConstructionPlan
                    )
                  }
                  block
                >
                  下载施工方案 PDF
                </Button>
                <Button block>
                  <Link href={`/projects/${routeParams.projectId}/feasibility/${routeParams.versionId}`}>
                    查看可行性报告
                  </Link>
                </Button>
                <Button block>
                  <Link href={`/projects/${routeParams.projectId}/bill-of-quantities/${routeParams.versionId}`}>
                    查看工程量清单
                  </Link>
                </Button>
                <Button block onClick={() => router.push(`/projects/${routeParams.projectId}`)}>
                  返回项目详情
                </Button>
              </Space>
            </section>

            {canReview ? (
              <section className="section-surface">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Typography.Title level={4} className="section-title">
                    人工终审
                  </Typography.Title>
                  <Input.TextArea
                    rows={4}
                    value={decisionComment}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDecisionComment(event.target.value)}
                    placeholder="请填写最终人工审核意见，例如同意实施、退回原因或需补充的关键要求。"
                  />
                  <Card size="small" className="soft-panel" title="AI 建议写回候选">
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                      勾选后，这些建议会随人工通过一起写入最终审核报告、可行性报告和施工方案；未勾选的仅作为 AI 预审建议保留。
                    </Typography.Paragraph>
                    <Checkbox.Group
                      style={{ width: "100%" }}
                      value={selectedWritebackIds}
                      disabled={!canApprove || decisionSubmitting}
                      onChange={(values) => setSelectedWritebackIds(values.map(String))}
                    >
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        {report.aiSummary.advisoryWritebackCandidates.length ? (
                          report.aiSummary.advisoryWritebackCandidates.map((item) => (
                            <Checkbox key={item.id} value={item.id}>
                              <Space direction="vertical" size={2}>
                                <Typography.Text strong>{item.title}</Typography.Text>
                                <Typography.Text type="secondary">{item.text}</Typography.Text>
                              </Space>
                            </Checkbox>
                          ))
                        ) : (
                          <Typography.Text type="secondary">当前版本暂无可写回建议。</Typography.Text>
                        )}
                      </Space>
                    </Checkbox.Group>
                  </Card>
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={decisionSubmitting}
                    disabled={!canApprove}
                    onClick={() => void submitDecision("approved")}
                    block
                  >
                    通过
                  </Button>
                  <Button
                    danger
                    icon={<RollbackOutlined />}
                    loading={decisionSubmitting}
                    onClick={() => void submitDecision("returned")}
                    block
                  >
                    退回修改
                  </Button>
                  {!canApprove && report.finalDecision.status === "pending" ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="当前版本暂不能直接通过"
                      description="AI 结论失败或版本状态不在可终审范围内时，只能退回修改。"
                    />
                  ) : null}
                </Space>
              </section>
            ) : null}

            {canReview ? (
              <section className="section-surface">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Typography.Title level={4} className="section-title">
                    一次性特批
                  </Typography.Title>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    用于额度或冷却期被拦截，但项目确需紧急推进的场景。
                  </Typography.Paragraph>
                  <Input.TextArea
                    rows={3}
                    value={overrideReason}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setOverrideReason(event.target.value)}
                    placeholder="请填写特批原因"
                  />
                  <Button
                    type="dashed"
                    icon={<ThunderboltOutlined />}
                    loading={overrideSubmitting}
                    onClick={() => void grantOverride()}
                    block
                  >
                    发放特批
                  </Button>
                </Space>
              </section>
            ) : null}
          </Space>
        </div>
      ) : null}
    </div>
  );
}
