"use client";

import { AIProviderConfigView } from "@property-review/shared";
import { Alert, Button, Card, Col, Input, List, Popconfirm, Row, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { StatusTag } from "../../../components/status-tag";
import { apiRequest } from "../../../lib/api";
import { auditActionLabels, categoryLabels, formatCurrency, formatDateTime, labelFromMap, organizationKindLabels, overrideScopeLabels, roleLabels } from "../../../lib/presentation";
import { getSession } from "../../../lib/session";

interface DashboardResponse {
  organizations: Array<{ id: string; name: string; kind: string }>;
  users: Array<{ id: string; username: string; displayName: string; role: string; organizationId: string }>;
  quotaPolicy: { weeklyQuotaPerCity: number; resubmitCooldownDays: number; allowOverride: boolean };
  projectCostBoard: Array<{ projectId: string; organizationName: string; projectName: string; projectCategory: string; locationSummary: string; status: string; initialBudget: number; currentBudget: number; finalBudget?: number; budgetDelta: number; submissionCount: number; updatedAt: string; duplicateFlag: boolean }>;
  auditLogs: Array<{ id: string; action: string; detail: string; createdAt: string }>;
  investmentSummary: {
    totalInvestment: number;
    approvedInvestment: number;
    automaticApprovedInvestment: number;
    humanPendingInvestment: number;
    budgetChange: number;
    duplicateInvestment: number;
    byCategory: Array<{ name: string; amount: number }>;
    byCity: Array<{ name: string; amount: number }>;
    budgetBuckets: Array<{ name: string; amount: number; count: number }>;
    topCostItems: Array<{ name: string; amount: number }>;
  };
  aiUsage: AIUsageSummary;
}

interface AIUsageSummary {
  date: string;
  totals: { requests: number; failedRequests: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cachedInputTokens: number; totalTokens: number };
  byOperation: Array<{ operation: string; requests: number; failedRequests: number; totalTokens: number }>;
  recent: Array<{ id: string; projectTitle?: string; operation: string; model: string; status: string; inputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number; usageEstimated: boolean; durationMs: number; createdAt: string }>;
}

interface QuotaBoardResponse {
  organizations: Array<{ organizationId: string; organizationName: string; usedThisWeek: number; remainingThisWeek: number }>;
  overrides: Array<{ id: string; scope: string; reason: string; used: boolean; projectTitle: string; createdAt: string }>;
}

export default function AdminPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [resettingOrgId, setResettingOrgId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [quotaBoard, setQuotaBoard] = useState<QuotaBoardResponse | null>(null);
  const [aiConfig, setAIConfig] = useState<AIProviderConfigView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingAI, setSavingAI] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const canResetQuota = session?.user.role === "reviewer";

  const load = async () => {
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.user.role === "submitter") {
      router.replace("/projects");
      return;
    }
    setLoading(true);
    try {
      const [dashboardResponse, quotaResponse, aiResponse] = await Promise.all([
        apiRequest<DashboardResponse>("/admin/dashboard", {}, session),
        apiRequest<QuotaBoardResponse>("/admin/quota-usage", {}, session),
        session.user.role === "admin" ? apiRequest<AIProviderConfigView>("/admin/ai-config", {}, session) : Promise.resolve(null)
      ]);
      setDashboard(dashboardResponse);
      setQuotaBoard(quotaResponse);
      setAIConfig(aiResponse);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "管理看板加载失败");
    } finally {
      setLoading(false);
    }
  };

  const saveAIConfig = async () => {
    if (!session || !aiConfig) return;
    setSavingAI(true);
    try {
      const updated = await apiRequest<AIProviderConfigView>("/admin/ai-config", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: aiConfig.enabled,
          provider: aiConfig.provider,
          baseUrl: aiConfig.baseUrl,
          stageModel: aiConfig.stageModel,
          schemeModel: aiConfig.schemeModel,
          decisionModel: aiConfig.decisionModel,
          blueprintModel: aiConfig.blueprintModel,
          routeModel: aiConfig.routeModel,
          reviewModel: aiConfig.reviewModel,
          reasoning: aiConfig.reasoning,
          embeddingModel: aiConfig.embeddingModel,
          apiKey: apiKey || undefined
        })
      }, session);
      setAIConfig(updated);
      setApiKey("");
      messageApi.success("AI 配置已保存");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "AI 配置保存失败"); }
    finally { setSavingAI(false); }
  };

  const testAIConfig = async () => {
    if (!session) return;
    setSavingAI(true);
    try {
      const result = await apiRequest<{ message: string }>("/admin/ai-config/test", { method: "POST" }, session);
      messageApi.success(result.message);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "连接测试失败"); }
    finally { setSavingAI(false); }
  };

  useEffect(() => { setSession(getSession()); setSessionReady(true); }, []);
  useEffect(() => { if (sessionReady) void load(); }, [sessionReady]);

  const resetCityQuota = async (organizationId: string, organizationName: string) => {
    if (!session || !canResetQuota) {
      messageApi.warning("只有终审人可以重置额度");
      return;
    }
    setResettingOrgId(organizationId);
    try {
      const response = await apiRequest<{ removedCount: number }>(
        `/quota/organizations/${organizationId}/reset-weekly`,
        { method: "POST", body: JSON.stringify({}) },
        session
      );
      messageApi.success(`${organizationName} 额度已重置，清理 ${response.removedCount} 条本周台账`);
      await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "额度重置失败");
    } finally {
      setResettingOrgId(null);
    }
  };

  const costColumns = useMemo(
    () => [
      { title: "城市公司", dataIndex: "organizationName" },
      { title: "项目名称", dataIndex: "projectName" },
      { title: "改造类别", dataIndex: "projectCategory", render: (value: string) => labelFromMap(categoryLabels, value) },
      { title: "位置摘要", dataIndex: "locationSummary" },
      { title: "当前状态", dataIndex: "status", render: (value: string) => <StatusTag status={value as never} /> },
      { title: "初版成本", dataIndex: "initialBudget", render: (value: number) => formatCurrency(value) },
      { title: "当前版成本", dataIndex: "currentBudget", render: (value: number) => formatCurrency(value) },
      { title: "最终版成本", dataIndex: "finalBudget", render: (value?: number) => (value ? formatCurrency(value) : "-") },
      { title: "成本差额", dataIndex: "budgetDelta", render: (value: number) => <Typography.Text type={value > 0 ? "danger" : value < 0 ? "success" : undefined}>{formatCurrency(value)}</Typography.Text> },
      { title: "送审次数", dataIndex: "submissionCount" },
      { title: "重复风险", dataIndex: "duplicateFlag", render: (value: boolean) => (value ? <Tag color="orange">疑似重复</Tag> : <Tag>无</Tag>) },
      { title: "最近更新", dataIndex: "updatedAt", render: (value: string) => formatDateTime(value) }
    ],
    []
  );

  return (
    <div className="section-grid workspace-page admin-workspace">
      {contextHolder}
      <Card className="glass-card workspace-intro" styles={{ body: { padding: 28 } }}>
        <span className="workspace-code">CONTROL / INVESTMENT</span>
        <Typography.Title level={2}>{"投资与审批总览"}</Typography.Title>
        <Typography.Paragraph>把项目金额、审查进度、额度消耗与模型运行放在同一张控制面上，优先处理等待人工确认和存在重复风险的项目。</Typography.Paragraph>
      </Card>

      {session?.user.role === "admin" && aiConfig ? (
        <Card className="glass-card" title="AI 模型配置" extra={<Space><Button loading={savingAI} onClick={() => void testAIConfig()}>测试连接</Button><Button type="primary" loading={savingAI} onClick={() => void saveAIConfig()}>保存</Button></Space>}>
          <Alert type="info" showIcon message="正常项目调用：事项识别、审查蓝图、必要性、可行性和一次技术方案。最终结论与方案结构校验不再重复调用模型。" style={{ marginBottom: 18 }} />
          <Row gutter={[14, 14]}>
            <Col xs={24} md={6}><Typography.Text>启用外部模型</Typography.Text><div style={{ marginTop: 9 }}><Switch checked={aiConfig.enabled} onChange={(enabled) => setAIConfig({ ...aiConfig, enabled })} /></div></Col>
            <Col xs={24} md={6}><Typography.Text>服务类型</Typography.Text><Select style={{ width: "100%", marginTop: 6 }} value={aiConfig.provider} onChange={(provider) => setAIConfig({ ...aiConfig, provider })} options={[{ value: "demo", label: "演示规则引擎" }, { value: "openai_compatible", label: "OpenAI 兼容 API" }]} /></Col>
            <Col xs={24} md={12}><Typography.Text>API 地址</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.baseUrl} onChange={(event) => setAIConfig({ ...aiConfig, baseUrl: event.target.value })} /></Col>
            <Col xs={24} md={6}><Typography.Text>阶段判断</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.stageModel} onChange={(event) => setAIConfig({ ...aiConfig, stageModel: event.target.value })} /></Col>
            <Col xs={24} md={6}><Typography.Text>方案与清单</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.schemeModel} onChange={(event) => setAIConfig({ ...aiConfig, schemeModel: event.target.value })} /></Col>
            <Col xs={24} md={6}><Typography.Text>最终复核</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.decisionModel} onChange={(event) => setAIConfig({ ...aiConfig, decisionModel: event.target.value })} /></Col>
            <Col xs={24} md={6}><Typography.Text>动态审查蓝图</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.blueprintModel} onChange={(event) => setAIConfig({ ...aiConfig, blueprintModel: event.target.value })} /></Col>
            <Col xs={24} md={6}><Typography.Text>技术路线</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.routeModel} onChange={(event) => setAIConfig({ ...aiConfig, routeModel: event.target.value })} /></Col>
            <Col xs={24} md={6}><Typography.Text>独立方案复核</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.reviewModel} onChange={(event) => setAIConfig({ ...aiConfig, reviewModel: event.target.value })} /></Col>
            <Col xs={24} md={6}><Typography.Text>相似案例向量</Typography.Text><Input style={{ marginTop: 6 }} value={aiConfig.embeddingModel} onChange={(event) => setAIConfig({ ...aiConfig, embeddingModel: event.target.value })} /></Col>
            {[{ key: "fingerprint", label: "事项识别" }, { key: "blueprint", label: "审查蓝图" }, { key: "necessity", label: "必要性判断" }, { key: "feasibility", label: "可行性判断" }, { key: "scheme", label: "技术方案" }].map((item) => (
              <Col xs={24} md={6} key={item.key}><Typography.Text>{item.label}推理强度</Typography.Text><Select style={{ width: "100%", marginTop: 6 }} value={aiConfig.reasoning?.[item.key as keyof NonNullable<AIProviderConfigView["reasoning"]>] ?? "medium"} onChange={(value) => setAIConfig({ ...aiConfig, reasoning: { ...aiConfig.reasoning, [item.key]: value } })} options={[{ value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }]} /></Col>
            ))}
            <Col xs={24}><Typography.Text>API 密钥 {aiConfig.hasApiKey ? "（已配置）" : ""}</Typography.Text><Input.Password style={{ marginTop: 6 }} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={aiConfig.hasApiKey ? "留空表示不更换" : "输入后加密保存，页面不会回显"} /></Col>
          </Row>
        </Card>
      ) : null}

      {session?.user.role === "admin" ? (
        <Card className="glass-card" title={`AI 用量 · ${dashboard?.aiUsage.date ?? "今日"}`}>
          <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
            <Col xs={12} md={6}><Typography.Text type="secondary">请求</Typography.Text><Typography.Title level={4}>{dashboard?.aiUsage.totals.requests ?? 0}</Typography.Title></Col>
            <Col xs={12} md={6}><Typography.Text type="secondary">失败</Typography.Text><Typography.Title level={4}>{dashboard?.aiUsage.totals.failedRequests ?? 0}</Typography.Title></Col>
            <Col xs={12} md={6}><Typography.Text type="secondary">总 Token</Typography.Text><Typography.Title level={4}>{(dashboard?.aiUsage.totals.totalTokens ?? 0).toLocaleString()}</Typography.Title></Col>
            <Col xs={12} md={6}><Typography.Text type="secondary">其中推理</Typography.Text><Typography.Title level={4}>{(dashboard?.aiUsage.totals.reasoningTokens ?? 0).toLocaleString()}</Typography.Title></Col>
          </Row>
          <Table size="small" pagination={false} rowKey="operation" dataSource={dashboard?.aiUsage.byOperation ?? []} columns={[{ title: "环节", dataIndex: "operation" }, { title: "请求", dataIndex: "requests" }, { title: "失败", dataIndex: "failedRequests" }, { title: "Token", dataIndex: "totalTokens", render: (value: number) => value.toLocaleString() }]} />
        </Card>
      ) : null}

      <Row gutter={[16, 16]}>
        {[
          ["当前总投资", dashboard?.investmentSummary.totalInvestment ?? 0],
          ["已批准金额", dashboard?.investmentSummary.approvedInvestment ?? 0],
          ["正式自动批准金额", dashboard?.investmentSummary.automaticApprovedInvestment ?? 0],
          ["待人工确认金额", dashboard?.investmentSummary.humanPendingInvestment ?? 0],
          ["版本预算净变化", dashboard?.investmentSummary.budgetChange ?? 0],
          ["重复改造涉及金额", dashboard?.investmentSummary.duplicateInvestment ?? 0]
        ].map(([label, value]) => (
          <Col xs={24} sm={12} xl={8} key={String(label)}>
            <Card className="glass-card"><Typography.Text type="secondary">{label}</Typography.Text><Typography.Title level={3} style={{ marginBottom: 0 }}>{formatCurrency(Number(value))}</Typography.Title></Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={8}>
          <Card className="glass-card" title="类别投资分布">
            <List dataSource={dashboard?.investmentSummary.byCategory ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={labelFromMap(categoryLabels, item.name)} description={formatCurrency(item.amount)} /></List.Item>} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="glass-card" title="城市投资分布">
            <List dataSource={dashboard?.investmentSummary.byCity ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={item.name} description={formatCurrency(item.amount)} /></List.Item>} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="glass-card" title="预算区间">
            <List dataSource={dashboard?.investmentSummary.budgetBuckets ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.name} · ${item.count} 项`} description={formatCurrency(item.amount)} /></List.Item>} />
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" title="主要成本项" extra={session?.user.role === "admin" ? <Link href="/admin/knowledge"><Button>打开知识工作台</Button></Link> : null}>
        <List grid={{ gutter: 16, xs: 1, sm: 2, lg: 4 }} dataSource={dashboard?.investmentSummary.topCostItems ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={item.name || "未命名成本项"} description={formatCurrency(item.amount)} /></List.Item>} />
      </Card>

      <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
        <Typography.Title level={4}>{"改造项目清单"}</Typography.Title>
        <Table rowKey="projectId" pagination={{ pageSize: 6 }} dataSource={dashboard?.projectCostBoard ?? []} columns={costColumns} scroll={{ x: 1500 }} />
      </Card>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"城市公司额度使用"}</Typography.Title>
            <Table
              rowKey="organizationId"
              pagination={false}
              dataSource={quotaBoard?.organizations ?? []}
              columns={[
                { title: "城市公司", dataIndex: "organizationName" },
                { title: "本周已用", dataIndex: "usedThisWeek" },
                { title: "本周剩余", dataIndex: "remainingThisWeek" },
                {
                  title: "操作",
                  render: (item: { organizationId: string; organizationName: string }) =>
                    canResetQuota ? (
                      <Popconfirm
                        title="确认重置本周额度？"
                        description={`将清空 ${item.organizationName} 本周 AI 送审额度台账。`}
                        onConfirm={() => void resetCityQuota(item.organizationId, item.organizationName)}
                        okText="确认重置"
                        cancelText="取消"
                      >
                        <Button
                          size="small"
                          danger
                          loading={resettingOrgId === item.organizationId}
                        >
                          重置额度
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Typography.Text type="secondary">仅终审人可操作</Typography.Text>
                    )
                }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"当前策略"}</Typography.Title>
            <List dataSource={[`每城市公司每周 AI 送审 ${dashboard?.quotaPolicy.weeklyQuotaPerCity ?? "--"} 次`, `退回后冷却 ${dashboard?.quotaPolicy.resubmitCooldownDays ?? "--"} 天`, `是否允许特批：${dashboard?.quotaPolicy.allowOverride ? "是" : "否"}`]} renderItem={(item) => <List.Item>{item}</List.Item>} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"账号列表"}</Typography.Title>
            <Table rowKey="id" pagination={false} scroll={{ x: 700 }} dataSource={dashboard?.users ?? []} columns={[{ title: "姓名", dataIndex: "displayName" }, { title: "用户名", dataIndex: "username" }, { title: "角色", dataIndex: "role", render: (value: string) => labelFromMap(roleLabels, value) }, { title: "所属组织", dataIndex: "organizationId", render: (value: string) => dashboard?.organizations.find((item) => item.id === value)?.name ?? value }]} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"特批记录"}</Typography.Title>
            <List dataSource={quotaBoard?.overrides ?? []} locale={{ emptyText: "暂无特批记录" }} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.projectTitle} - ${labelFromMap(overrideScopeLabels, item.scope)}`} description={`${item.reason} | ${item.used ? "已使用" : "未使用"} | ${formatDateTime(item.createdAt)}`} /></List.Item>} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"组织架构"}</Typography.Title>
            <List dataSource={dashboard?.organizations ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={item.name} description={labelFromMap(organizationKindLabels, item.kind)} /></List.Item>} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"最近审计活动"}</Typography.Title>
            <List dataSource={dashboard?.auditLogs ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={labelFromMap(auditActionLabels, item.action)} description={`${item.detail} | ${formatDateTime(item.createdAt)}`} /></List.Item>} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
