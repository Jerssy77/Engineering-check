"use client";

import { DownloadOutlined, FileProtectOutlined, SnippetsOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, List, Space, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";

import { apiRequest } from "../../../../../../lib/api";
import { formatCurrency } from "../../../../../../lib/presentation";
import { getSession } from "../../../../../../lib/session";

const EMPTY_TEXT = "未提供，需补充";

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
}

interface AdvisoryRecommendation {
  id?: string;
  title: string;
  recommendation: string;
  reason: string;
  requiredMaterials: string[];
}

interface SchemeWritebackCandidate {
  id?: string;
  title: string;
  targetSection: string;
  text: string;
  basis: string;
}

interface FeasibilityResponse {
  project: {
    id: string;
    title: string;
    organizationName: string;
    versionNumber: number;
    categoryLabel: string;
    priorityLabel: string;
    statusLabel: string;
  };
  overview: {
    projectName: string;
    locationSummary: string;
    expectedWindow: string;
    objective: string;
    expectedBenefits: string;
    issueSourceType: string;
  };
  problemBackground: {
    issueDescription: string;
    currentCondition: string;
    temporaryMeasures: string;
    issueSourceDescription: string;
    impactScope: string;
  };
  solutionSummary: {
    implementationScope: string;
    feasibilitySummary: string;
    keyProcess: string;
    materialSelection: string;
    acceptancePlan: string;
    maintenancePlan: string;
    preliminaryPlan: string;
    implementationRequirements: string[];
  };
  budgetSummary: {
    engineeringSubtotal: number;
    otherFeeSubtotal: number;
    calculatedBudget: number;
    declaredBudget: number;
    budgetGap: number;
  };
  topCostItems: Array<{ itemName: string; specification: string; lineTotal: number }>;
  riskAndControl: string[];
  mandatoryRequirements: MandatoryRequirement[];
  internalControlRequirements: InternalControlRequirement[];
  citations: NormCitation[];
  schemeWritebacks: SchemeWritebackCandidate[];
  adoptedWritebacks: SchemeWritebackCandidate[];
  costInsights: {
    mustKeepItems: string[];
    optimizationCandidates: AdvisoryRecommendation[];
    costQuestions: string[];
  };
  technicalInsights: {
    alternativePaths: AdvisoryRecommendation[];
    schemeCandidates: SchemeWritebackCandidate[];
  };
  conclusion: {
    title: string;
    body: string;
    humanComment?: string;
  };
}

function withFallback(value?: string) {
  return value && value.trim().length > 0 ? value : EMPTY_TEXT;
}

function severityLabel(value: "high" | "medium" | "low") {
  return value === "high" ? "高" : value === "medium" ? "中" : "低";
}

function severityColor(value: "high" | "medium" | "low") {
  return value === "high" ? "red" : value === "medium" ? "orange" : "blue";
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section-surface">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Title level={4} className="section-title">
          {title}
        </Typography.Title>
        {children}
      </Space>
    </section>
  );
}

export default function FeasibilityPage({
  params
}: {
  params: Promise<{ projectId: string; versionId: string }>;
}) {
  const routeParams = use(params);
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingConstructionPlan, setDownloadingConstructionPlan] = useState(false);
  const [report, setReport] = useState<FeasibilityResponse | null>(null);
  const session = getSession();

  const citationLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const citation of report?.citations ?? []) {
      map.set(citation.id, `${citation.code} ${citation.title} ${citation.clause}`);
    }
    return map;
  }, [report?.citations]);

  const load = async () => {
    if (!session) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<FeasibilityResponse>(
        `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/feasibility-report`,
        {},
        session
      );
      setReport(response);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载可行性报告失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [routeParams.projectId, routeParams.versionId]);

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
    setBusy: (value: boolean) => void
  ) => {
    if (!session) {
      return;
    }

    setBusy(true);
    try {
      const blob = await apiRequest<Blob>(path, {}, session);
      triggerBlobDownload(blob, fileName);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "下载失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section-grid">
      {contextHolder}

      <section className="glass-card brand-frame document-cover">
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <span className="hero-kicker">可行性报告</span>
          <Typography.Title className="hero-title" style={{ marginBottom: 0 }}>
            {report?.project.title ?? "工程立项可行性报告"}
          </Typography.Title>
          <Typography.Paragraph className="document-lead">
            面向内部立项汇报和审批留档，按项目概况、建设必要性、实施条件、技术方案、投资估算、风险控制和结论建议组织。
          </Typography.Paragraph>
        </Space>
      </section>

      {loading ? (
        <section className="section-surface">
          <Typography.Text>正在加载可行性报告...</Typography.Text>
        </section>
      ) : null}

      {!loading && report ? (
        <div className="split-layout">
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <SectionCard title="一、项目概况">
              <Descriptions column={2} bordered>
                <Descriptions.Item label="项目名称">{withFallback(report.overview.projectName)}</Descriptions.Item>
                <Descriptions.Item label="申报组织">{withFallback(report.project.organizationName)}</Descriptions.Item>
                <Descriptions.Item label="项目分类">{withFallback(report.project.categoryLabel)}</Descriptions.Item>
                <Descriptions.Item label="优先级">{withFallback(report.project.priorityLabel)}</Descriptions.Item>
                <Descriptions.Item label="实施位置">{withFallback(report.overview.locationSummary)}</Descriptions.Item>
                <Descriptions.Item label="计划周期">{withFallback(report.overview.expectedWindow)}</Descriptions.Item>
              </Descriptions>
            </SectionCard>

            <SectionCard title="二、建设必要性">
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Typography.Text strong>问题来源</Typography.Text>
                <Typography.Text>{withFallback(report.overview.issueSourceType)}</Typography.Text>
                <Typography.Text strong>问题描述</Typography.Text>
                <Typography.Text>{withFallback(report.problemBackground.issueDescription)}</Typography.Text>
                <Typography.Text strong>当前状态</Typography.Text>
                <Typography.Text>{withFallback(report.problemBackground.currentCondition)}</Typography.Text>
                <Typography.Text strong>影响范围</Typography.Text>
                <Typography.Text>{withFallback(report.problemBackground.impactScope)}</Typography.Text>
              </Space>
            </SectionCard>

            <SectionCard title="三、实施条件与技术方案">
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Typography.Text strong>立项目标</Typography.Text>
                <Typography.Text>{withFallback(report.overview.objective)}</Typography.Text>
                <Typography.Text strong>实施范围</Typography.Text>
                <Typography.Text>{withFallback(report.solutionSummary.implementationScope)}</Typography.Text>
                <Typography.Text strong>可行性说明</Typography.Text>
                <Typography.Text>{withFallback(report.solutionSummary.feasibilitySummary)}</Typography.Text>
                <Typography.Text strong>关键工艺</Typography.Text>
                <Typography.Text>{withFallback(report.solutionSummary.keyProcess)}</Typography.Text>
                <Typography.Text strong>材料选型</Typography.Text>
                <Typography.Text>{withFallback(report.solutionSummary.materialSelection)}</Typography.Text>
                <Typography.Text strong>验收与维护</Typography.Text>
                <Typography.Text>
                  {withFallback(report.solutionSummary.acceptancePlan)}；{withFallback(report.solutionSummary.maintenancePlan)}
                </Typography.Text>
              </Space>
            </SectionCard>

            <SectionCard title="四、强制规范要求">
              <List
                className="list-plain"
                dataSource={report.mandatoryRequirements}
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

            <SectionCard title="五、平台审批硬性要求">
              <List
                className="list-plain"
                dataSource={report.internalControlRequirements}
                locale={{ emptyText: "当前版本未形成额外平台审批硬性要求。" }}
                renderItem={(item) => (
                  <List.Item style={{ display: "block" }}>
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Space wrap>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Tag color={severityColor(item.severity)}>{severityLabel(item.severity)}</Tag>
                      </Space>
                      <Typography.Text>{item.requirement}</Typography.Text>
                      <Typography.Text type="secondary">整改动作：{withFallback(item.action)}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="六、已采纳 AI 优化建议">
              <List
                className="list-plain"
                dataSource={report.adoptedWritebacks}
                locale={{ emptyText: "当前版本尚未采纳 AI 优化建议。" }}
                renderItem={(item) => (
                  <List.Item style={{ display: "block" }}>
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <br />
                    <Typography.Text>{item.text}</Typography.Text>
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="七、投资估算">
              <Descriptions column={2} bordered>
                <Descriptions.Item label="工程项小计">
                  {formatCurrency(report.budgetSummary.engineeringSubtotal)}
                </Descriptions.Item>
                <Descriptions.Item label="其他费用小计">
                  {formatCurrency(report.budgetSummary.otherFeeSubtotal)}
                </Descriptions.Item>
                <Descriptions.Item label="测算总价">
                  {formatCurrency(report.budgetSummary.calculatedBudget)}
                </Descriptions.Item>
                <Descriptions.Item label="申报预算">
                  {formatCurrency(report.budgetSummary.declaredBudget)}
                </Descriptions.Item>
                <Descriptions.Item label="预算差额">
                  {formatCurrency(report.budgetSummary.budgetGap)}
                </Descriptions.Item>
                <Descriptions.Item label="当前状态">{withFallback(report.project.statusLabel)}</Descriptions.Item>
              </Descriptions>
              <List
                className="list-plain"
                header={<Typography.Text strong>主要费用项</Typography.Text>}
                dataSource={report.topCostItems}
                locale={{ emptyText: "暂无费用明细。" }}
                renderItem={(item) => (
                  <List.Item>
                    {`${withFallback(item.itemName)}${item.specification ? ` / ${item.specification}` : ""}：${formatCurrency(
                      item.lineTotal
                    )}`}
                  </List.Item>
                )}
              />
            </SectionCard>

            <SectionCard title="八、风险与控制">
              <List
                className="list-plain"
                dataSource={report.riskAndControl}
                locale={{ emptyText: "当前版本未列出专项风险控制项。" }}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
              {report.costInsights.optimizationCandidates.length ? (
                <Alert
                  type="info"
                  showIcon
                  message="成本优化建议"
                  description={report.costInsights.optimizationCandidates
                    .map((item) => `${item.title}：${item.recommendation}`)
                    .join("；")}
                />
              ) : null}
              {report.technicalInsights.alternativePaths.length ? (
                <Alert
                  type="info"
                  showIcon
                  message="技术替代路径"
                  description={report.technicalInsights.alternativePaths
                    .map((item) => `${item.title}：${item.recommendation}`)
                    .join("；")}
                />
              ) : null}
            </SectionCard>

            <SectionCard title="九、结论建议">
              <Alert
                type="success"
                showIcon
                message={withFallback(report.conclusion.title)}
                description={withFallback(report.conclusion.body)}
              />
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
                  onClick={() =>
                    void downloadAsset(
                      `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/feasibility-report.pdf`,
                      `feasibility-${routeParams.versionId}.pdf`,
                      setDownloadingPdf
                    )
                  }
                  loading={downloadingPdf}
                  block
                >
                  下载可行性报告 PDF
                </Button>
                <Button
                  icon={<FileProtectOutlined />}
                  onClick={() =>
                    void downloadAsset(
                      `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/construction-plan.pdf`,
                      `construction-plan-${routeParams.versionId}.pdf`,
                      setDownloadingConstructionPlan
                    )
                  }
                  loading={downloadingConstructionPlan}
                  block
                >
                  下载施工方案 PDF
                </Button>
                <Button icon={<SnippetsOutlined />} block>
                  <Link href={`/projects/${routeParams.projectId}/report/${routeParams.versionId}`}>
                    查看最终审核报告
                  </Link>
                </Button>
                <Button block>
                  <Link href={`/projects/${routeParams.projectId}/bill-of-quantities/${routeParams.versionId}`}>
                    查看工程量清单
                  </Link>
                </Button>
              </Space>
            </section>

            <section className="section-surface">
              <Typography.Title level={4} className="section-title">
                报告定位
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                本报告用于内部审批留档和立项汇报；现场执行时请结合施工方案、工程量清单和审批意见组织实施。
              </Typography.Paragraph>
            </section>
          </Space>
        </div>
      ) : null}
    </div>
  );
}
