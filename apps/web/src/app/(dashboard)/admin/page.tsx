"use client";

import { Card, Col, List, Row, Table, Tag, Typography, message } from "antd";
import { useRouter } from "next/navigation";
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
}

interface QuotaBoardResponse {
  organizations: Array<{ organizationId: string; organizationName: string; usedThisWeek: number; remainingThisWeek: number }>;
  overrides: Array<{ id: string; scope: string; reason: string; used: boolean; projectTitle: string; createdAt: string }>;
}

export default function AdminPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [quotaBoard, setQuotaBoard] = useState<QuotaBoardResponse | null>(null);

  useEffect(() => {
    const load = async () => {
      const session = getSession();
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
        const [dashboardResponse, quotaResponse] = await Promise.all([
          apiRequest<DashboardResponse>("/admin/dashboard", {}, session),
          apiRequest<QuotaBoardResponse>("/admin/quota-usage", {}, session)
        ]);
        setDashboard(dashboardResponse);
        setQuotaBoard(quotaResponse);
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "管理看板加载失败");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

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
    <div className="section-grid">
      {contextHolder}
      <Card className="glass-card" styles={{ body: { padding: 28 } }}>
        <span className="hero-kicker">{"管理看板"}</span>
        <Typography.Title level={2} style={{ marginTop: 14, marginBottom: 0 }}>{"改造事项成本总览"}</Typography.Title>
        <Typography.Paragraph style={{ color: "#56636a", marginTop: 10 }}>{"看板以完整项目清单为主，同时补充额度使用、特批记录和审计留痕。"}</Typography.Paragraph>
      </Card>

      <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
        <Typography.Title level={4}>{"改造项目清单"}</Typography.Title>
        <Table rowKey="projectId" pagination={{ pageSize: 6 }} dataSource={dashboard?.projectCostBoard ?? []} columns={costColumns} />
      </Card>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"城市公司额度使用"}</Typography.Title>
            <Table rowKey="organizationId" pagination={false} dataSource={quotaBoard?.organizations ?? []} columns={[{ title: "城市公司", dataIndex: "organizationName" }, { title: "本周已用", dataIndex: "usedThisWeek" }, { title: "本周剩余", dataIndex: "remainingThisWeek" }]} />
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
            <Table rowKey="id" pagination={false} dataSource={dashboard?.users ?? []} columns={[{ title: "姓名", dataIndex: "displayName" }, { title: "用户名", dataIndex: "username" }, { title: "角色", dataIndex: "role", render: (value: string) => labelFromMap(roleLabels, value) }, { title: "所属组织", dataIndex: "organizationId", render: (value: string) => dashboard?.organizations.find((item) => item.id === value)?.name ?? value }]} />
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
