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
        messageApi.error(error instanceof Error ? error.message : "\u7ba1\u7406\u770b\u677f\u52a0\u8f7d\u5931\u8d25");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const costColumns = useMemo(
    () => [
      { title: "\u57ce\u5e02\u516c\u53f8", dataIndex: "organizationName" },
      { title: "\u9879\u76ee\u540d\u79f0", dataIndex: "projectName" },
      { title: "\u6539\u9020\u7c7b\u522b", dataIndex: "projectCategory", render: (value: string) => labelFromMap(categoryLabels, value) },
      { title: "\u4f4d\u7f6e\u6458\u8981", dataIndex: "locationSummary" },
      { title: "\u5f53\u524d\u72b6\u6001", dataIndex: "status", render: (value: string) => <StatusTag status={value as never} /> },
      { title: "\u521d\u7248\u6210\u672c", dataIndex: "initialBudget", render: (value: number) => formatCurrency(value) },
      { title: "\u5f53\u524d\u7248\u6210\u672c", dataIndex: "currentBudget", render: (value: number) => formatCurrency(value) },
      { title: "\u6700\u7ec8\u7248\u6210\u672c", dataIndex: "finalBudget", render: (value?: number) => (value ? formatCurrency(value) : "-") },
      { title: "\u6210\u672c\u5dee\u989d", dataIndex: "budgetDelta", render: (value: number) => <Typography.Text type={value > 0 ? "danger" : value < 0 ? "success" : undefined}>{formatCurrency(value)}</Typography.Text> },
      { title: "\u9001\u5ba1\u6b21\u6570", dataIndex: "submissionCount" },
      { title: "\u91cd\u590d\u98ce\u9669", dataIndex: "duplicateFlag", render: (value: boolean) => (value ? <Tag color="orange">\u7591\u4f3c\u91cd\u590d</Tag> : <Tag>\u65e0</Tag>) },
      { title: "\u6700\u8fd1\u66f4\u65b0", dataIndex: "updatedAt", render: (value: string) => formatDateTime(value) }
    ],
    []
  );

  return (
    <div className="section-grid">
      {contextHolder}
      <Card className="glass-card" styles={{ body: { padding: 28 } }}>
        <span className="hero-kicker">{"\u7ba1\u7406\u770b\u677f"}</span>
        <Typography.Title level={2} style={{ marginTop: 14, marginBottom: 0 }}>{"\u6539\u9020\u4e8b\u9879\u6210\u672c\u603b\u89c8"}</Typography.Title>
        <Typography.Paragraph style={{ color: "#56636a", marginTop: 10 }}>{"\u770b\u677f\u4ee5\u5b8c\u6574\u9879\u76ee\u6e05\u5355\u4e3a\u4e3b\uff0c\u540c\u65f6\u8865\u5145\u989d\u5ea6\u4f7f\u7528\u3001\u7279\u6279\u8bb0\u5f55\u548c\u5ba1\u8ba1\u7559\u75d5\u3002"}</Typography.Paragraph>
      </Card>

      <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
        <Typography.Title level={4}>{"\u6539\u9020\u9879\u76ee\u6e05\u5355"}</Typography.Title>
        <Table rowKey="projectId" pagination={{ pageSize: 6 }} dataSource={dashboard?.projectCostBoard ?? []} columns={costColumns} />
      </Card>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"\u57ce\u5e02\u516c\u53f8\u989d\u5ea6\u4f7f\u7528"}</Typography.Title>
            <Table rowKey="organizationId" pagination={false} dataSource={quotaBoard?.organizations ?? []} columns={[{ title: "\u57ce\u5e02\u516c\u53f8", dataIndex: "organizationName" }, { title: "\u672c\u5468\u5df2\u7528", dataIndex: "usedThisWeek" }, { title: "\u672c\u5468\u5269\u4f59", dataIndex: "remainingThisWeek" }]} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"\u5f53\u524d\u7b56\u7565"}</Typography.Title>
            <List dataSource={[`\u6bcf\u57ce\u5e02\u516c\u53f8\u6bcf\u5468 AI \u9001\u5ba1 ${dashboard?.quotaPolicy.weeklyQuotaPerCity ?? "--"} \u6b21`, `\u9000\u56de\u540e\u51b7\u5374 ${dashboard?.quotaPolicy.resubmitCooldownDays ?? "--"} \u5929`, `\u662f\u5426\u5141\u8bb8\u7279\u6279\uff1a${dashboard?.quotaPolicy.allowOverride ? "\u662f" : "\u5426"}`]} renderItem={(item) => <List.Item>{item}</List.Item>} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"\u8d26\u53f7\u5217\u8868"}</Typography.Title>
            <Table rowKey="id" pagination={false} dataSource={dashboard?.users ?? []} columns={[{ title: "\u59d3\u540d", dataIndex: "displayName" }, { title: "\u7528\u6237\u540d", dataIndex: "username" }, { title: "\u89d2\u8272", dataIndex: "role", render: (value: string) => labelFromMap(roleLabels, value) }, { title: "\u6240\u5c5e\u7ec4\u7ec7", dataIndex: "organizationId", render: (value: string) => dashboard?.organizations.find((item) => item.id === value)?.name ?? value }]} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"\u7279\u6279\u8bb0\u5f55"}</Typography.Title>
            <List dataSource={quotaBoard?.overrides ?? []} locale={{ emptyText: "\u6682\u65e0\u7279\u6279\u8bb0\u5f55" }} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.projectTitle} - ${labelFromMap(overrideScopeLabels, item.scope)}`} description={`${item.reason} | ${item.used ? "\u5df2\u4f7f\u7528" : "\u672a\u4f7f\u7528"} | ${formatDateTime(item.createdAt)}`} /></List.Item>} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"\u7ec4\u7ec7\u67b6\u6784"}</Typography.Title>
            <List dataSource={dashboard?.organizations ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={item.name} description={labelFromMap(organizationKindLabels, item.kind)} /></List.Item>} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 22 } }}>
            <Typography.Title level={4}>{"\u6700\u8fd1\u5ba1\u8ba1\u6d3b\u52a8"}</Typography.Title>
            <List dataSource={dashboard?.auditLogs ?? []} renderItem={(item) => <List.Item><List.Item.Meta title={labelFromMap(auditActionLabels, item.action)} description={`${item.detail} | ${formatDateTime(item.createdAt)}`} /></List.Item>} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
