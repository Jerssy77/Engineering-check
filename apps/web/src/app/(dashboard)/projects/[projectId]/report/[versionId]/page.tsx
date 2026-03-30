"use client";

import {
  CheckCircleOutlined,
  DownloadOutlined,
  RollbackOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { ProjectStatus } from "@property-review/shared";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  List,
  Row,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import { useRouter } from "next/navigation";
import { startTransition, use, useEffect, useState } from "react";

import { StatusTag } from "../../../../../../components/status-tag";
import { apiRequest } from "../../../../../../lib/api";
import {
  categoryLabels,
  costRowTypeLabels,
  formatCurrency,
  formatDateTime,
  labelFromMap,
  verdictLabels
} from "../../../../../../lib/presentation";
import { getSession } from "../../../../../../lib/session";

const EMPTY_TEXT = "未提供/需补充";
const NO_DUPLICATE_TEXT = "未命中疑似重复改造";

interface ReportResponse {
  project: { id: string; title: string; status: ProjectStatus };
  version: {
    id: string;
    versionNumber: number;
    status: ProjectStatus;
    snapshot: { projectName: string; projectCategory: string; budgetAmount: number };
  };
  budgetSummary: {
    engineeringSubtotal: number;
    otherFeeSubtotal: number;
    calculatedBudget: number;
    declaredBudget: number;
    budgetGap: number;
    topCostItems: Array<{ itemName: string; specification: string; lineTotal: number }>;
  };
  review?: {
    verdict: "pass" | "conditional_pass" | "fail";
    conclusion: string;
    overallScore: number;
    attachmentReadSummary: string[];
    missingMaterials: string[];
    requiredActions: string[];
    complianceReview: {
      title: string;
      conclusion: string;
      findings: Array<{
        severity: string;
        title: string;
        basis: string;
        currentState: string;
        action: string;
        requiredMaterials: string[];
      }>;
    };
    costReview: {
      title: string;
      conclusion: string;
      findings: Array<{
        severity: string;
        title: string;
        basis: string;
        currentState: string;
        action: string;
        requiredMaterials: string[];
      }>;
    };
    technicalReview: {
      title: string;
      conclusion: string;
      findings: Array<{
        severity: string;
        title: string;
        basis: string;
        currentState: string;
        action: string;
        requiredMaterials: string[];
      }>;
    };
    duplicateReview: {
      title: string;
      conclusion: string;
      matches: Array<{
        projectId: string;
        projectTitle: string;
        versionNumber: number;
        createdAt: string;
        matchReason: string;
        locationSummary: string;
      }>;
    };
  };
  decision?: { decision: "approved" | "returned"; comment: string; decidedAt: string };
}

function VerdictBanner({
  verdict,
  conclusion
}: {
  verdict: "pass" | "conditional_pass" | "fail";
  conclusion: string;
}) {
  const type = verdict === "pass" ? "success" : verdict === "conditional_pass" ? "warning" : "error";
  return (
    <Alert
      showIcon
      type={type}
      message={`AI 结论：${labelFromMap(verdictLabels, verdict)}`}
      description={conclusion}
      style={{ borderRadius: 18 }}
    />
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
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [decisionForm] = Form.useForm<{ comment: string }>();
  const [overrideForm] = Form.useForm<{ reason: string }>();
  const session = getSession();
  const canReview = session?.user.role !== "submitter";

  const load = async () => {
    if (!session) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    try {
      const response = await apiRequest<ReportResponse>(
        `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/report`,
        {},
        session
      );
      setReport(response);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "结论页加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [routeParams.projectId, routeParams.versionId]);

  const downloadPdf = async () => {
    try {
      const blob = await apiRequest<Blob>(
        `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/report.pdf`,
        {},
        session
      );
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ai-review-${routeParams.versionId}.pdf`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "PDF 下载失败");
    }
  };

  const submitDecision = async (decision: "approved" | "returned") => {
    setDecisionSubmitting(true);
    try {
      const values = await decisionForm.validateFields();
      await apiRequest(
        `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/human-decision`,
        {
          method: "POST",
          body: JSON.stringify({ decision, comment: values.comment })
        },
        session
      );
      messageApi.success(decision === "approved" ? "版本已通过" : "版本已退回");
      await load();
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setDecisionSubmitting(false);
    }
  };

  const grantOverride = async () => {
    setOverrideSubmitting(true);
    try {
      const values = await overrideForm.validateFields();
      await apiRequest(
        `/projects/${routeParams.projectId}/override-grants`,
        { method: "POST", body: JSON.stringify({ scope: "both", reason: values.reason }) },
        session
      );
      messageApi.success("特批已发放");
      overrideForm.resetFields();
    } catch (error) {
      if (error instanceof Error) messageApi.error(error.message);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  return (
    <div className="section-grid">
      {contextHolder}
      <Card className="glass-card" loading={loading} styles={{ body: { padding: 28 } }}>
        <Space direction="vertical" size={10}>
          <Space wrap>
            <span className="hero-kicker">AI 结论页</span>
            {report && <StatusTag status={report.version.status} />}
          </Space>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {report?.project.title ?? "AI 预审结论"}
          </Typography.Title>
          <Typography.Paragraph style={{ color: "#56636a", marginBottom: 0 }}>
            结果按合规、成本、技术和重复改造识别四个维度展开，所有问题都会附带修改动作和需补充材料。
          </Typography.Paragraph>
        </Space>
      </Card>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={16}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            {report?.review ? (
              <Space direction="vertical" size={18} style={{ width: "100%" }}>
                <VerdictBanner verdict={report.review.verdict} conclusion={report.review.conclusion} />
                <Descriptions column={2} bordered>
                  <Descriptions.Item label="版本">V{report.version.versionNumber}</Descriptions.Item>
                  <Descriptions.Item label="总分">{report.review.overallScore}</Descriptions.Item>
                  <Descriptions.Item label="改造类别">
                    {labelFromMap(categoryLabels, report.version.snapshot.projectCategory)}
                  </Descriptions.Item>
                  <Descriptions.Item label="申报总预算">
                    {formatCurrency(report.version.snapshot.budgetAmount)}
                  </Descriptions.Item>
                  <Descriptions.Item label="工程量合计">
                    {formatCurrency(report.budgetSummary.engineeringSubtotal)}
                  </Descriptions.Item>
                  <Descriptions.Item label="其他费用合计">
                    {formatCurrency(report.budgetSummary.otherFeeSubtotal)}
                  </Descriptions.Item>
                  <Descriptions.Item label="矩阵总价">
                    {formatCurrency(report.budgetSummary.calculatedBudget)}
                  </Descriptions.Item>
                  <Descriptions.Item label="差额">
                    {formatCurrency(report.budgetSummary.budgetGap)}
                  </Descriptions.Item>
                </Descriptions>

                {[report.review.complianceReview, report.review.costReview, report.review.technicalReview].map(
                  (section) => (
                    <Card key={section.title} bordered={false} style={{ background: "#fffaf4" }}>
                      <Typography.Title level={4}>{section.title}</Typography.Title>
                      <Typography.Paragraph>{section.conclusion}</Typography.Paragraph>
                      <List
                        dataSource={section.findings}
                        locale={{ emptyText: "暂无问题" }}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={2} style={{ width: "100%" }}>
                              <Space>
                                <Typography.Text strong>{item.title}</Typography.Text>
                                <Tag color={item.severity === "high" ? "red" : item.severity === "medium" ? "orange" : "blue"}>
                                  {item.severity === "high" ? "高" : item.severity === "medium" ? "中" : "低"}
                                </Tag>
                              </Space>
                              <Typography.Text>{`判断依据：${item.basis}`}</Typography.Text>
                              <Typography.Text>{`当前情况：${item.currentState}`}</Typography.Text>
                              <Typography.Text>{`修改动作：${item.action}`}</Typography.Text>
                              <Typography.Text type="secondary">
                                {`需补充材料：${item.requiredMaterials.length ? item.requiredMaterials.join("、") : EMPTY_TEXT}`}
                              </Typography.Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Card>
                  )
                )}

                <Card bordered={false} style={{ background: "#fffaf4" }}>
                  <Typography.Title level={4}>
                    {report.review.duplicateReview.title || "重复改造识别"}
                  </Typography.Title>
                  <Typography.Paragraph>
                    {report.review.duplicateReview.conclusion || NO_DUPLICATE_TEXT}
                  </Typography.Paragraph>
                  <List
                    dataSource={report.review.duplicateReview.matches}
                    locale={{ emptyText: NO_DUPLICATE_TEXT }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={2}>
                          <Typography.Text strong>{`${item.projectTitle} / V${item.versionNumber}`}</Typography.Text>
                          <Typography.Text>{item.matchReason || EMPTY_TEXT}</Typography.Text>
                          <Typography.Text type="secondary">
                            {`${item.locationSummary || EMPTY_TEXT} | ${formatDateTime(item.createdAt)}`}
                          </Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </Card>

                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Card size="small" title="需补充材料" style={{ borderRadius: 18 }}>
                      <List
                        dataSource={report.review.missingMaterials.length ? report.review.missingMaterials : [EMPTY_TEXT]}
                        renderItem={(item) => <List.Item>{item || EMPTY_TEXT}</List.Item>}
                      />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small" title="必改动作" style={{ borderRadius: 18 }}>
                      <List
                        dataSource={report.review.requiredActions.length ? report.review.requiredActions : [EMPTY_TEXT]}
                        renderItem={(item) => <List.Item>{item || EMPTY_TEXT}</List.Item>}
                      />
                    </Card>
                  </Col>
                  <Col span={24}>
                    <Card size="small" title="附件阅读摘要" style={{ borderRadius: 18 }}>
                      <List
                        dataSource={report.review.attachmentReadSummary.length ? report.review.attachmentReadSummary : [EMPTY_TEXT]}
                        renderItem={(item) => <List.Item>{item || EMPTY_TEXT}</List.Item>}
                      />
                    </Card>
                  </Col>
                  <Col span={24}>
                    <Card size="small" title="费用测算摘要" style={{ borderRadius: 18 }}>
                      <List
                        dataSource={
                          report.budgetSummary.topCostItems.length
                            ? report.budgetSummary.topCostItems.map(
                                (item) =>
                                  `${item.itemName || EMPTY_TEXT}${item.specification ? ` / ${item.specification}` : ""}：${formatCurrency(item.lineTotal)}`
                              )
                            : [EMPTY_TEXT]
                        }
                        renderItem={(item) => <List.Item>{item}</List.Item>}
                      />
                    </Card>
                  </Col>
                </Row>
              </Space>
            ) : (
              <Alert type="info" message="当前版本暂无 AI 结论" showIcon />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
              <Typography.Title level={4}>操作</Typography.Title>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Button icon={<DownloadOutlined />} onClick={downloadPdf} block>
                  下载 PDF
                </Button>
                <Button block onClick={() => startTransition(() => router.push(`/projects/${routeParams.projectId}`))}>
                  返回立项详情
                </Button>
              </Space>
            </Card>

            {canReview && report?.review && (
              <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
                <Typography.Title level={4}>人工终审</Typography.Title>
                <Form form={decisionForm} layout="vertical">
                  <Form.Item
                    name="comment"
                    label="审核意见"
                    rules={[{ required: true, message: "请输入审核意见" }]}
                  >
                    <Input.TextArea rows={4} />
                  </Form.Item>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      loading={decisionSubmitting}
                      disabled={report.review.verdict === "fail"}
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
                  </Space>
                </Form>
                {report.decision && (
                  <Alert
                    style={{ marginTop: 18, borderRadius: 16 }}
                    type={report.decision.decision === "approved" ? "success" : "warning"}
                    message={report.decision.decision === "approved" ? "该版本已通过" : "该版本已退回"}
                    description={`${report.decision.comment} | ${formatDateTime(report.decision.decidedAt)}`}
                  />
                )}
              </Card>
            )}

            {canReview && (
              <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
                <Typography.Title level={4}>一次性特批</Typography.Title>
                <Typography.Paragraph type="secondary">
                  当城市公司因额度或冷却期被拦截，且项目需要紧急推进时，可在此发起一次性放行。
                </Typography.Paragraph>
                <Form form={overrideForm} layout="vertical">
                  <Form.Item
                    name="reason"
                    label="特批原因"
                    rules={[{ required: true, message: "请输入特批原因" }]}
                  >
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Button
                    type="dashed"
                    icon={<ThunderboltOutlined />}
                    loading={overrideSubmitting}
                    onClick={() => void grantOverride()}
                    block
                  >
                    发放特批
                  </Button>
                </Form>
              </Card>
            )}
          </Space>
        </Col>
      </Row>
    </div>
  );
}
