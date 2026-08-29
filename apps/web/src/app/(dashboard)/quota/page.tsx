"use client";

import { Card, Col, List, Row, Statistic, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiRequest } from "../../../lib/api";
import { formatDate, formatDateTime } from "../../../lib/presentation";
import { getSession } from "../../../lib/session";

interface QuotaResponse {
  used: number;
  remaining: number;
  weekStart: string;
  weekEnd: string;
  policy: {
    weeklyQuotaPerCity: number;
    resubmitCooldownDays: number;
  };
  entries: Array<{
    id: string;
    consumedAt: string;
    projectTitle: string;
  }>;
}

export default function QuotaPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);

  useEffect(() => {
    const load = async () => {
      const session = getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      if (session.user.role !== "submitter") {
        router.replace("/admin");
        return;
      }
      setLoading(true);
      try {
        const response = await apiRequest<QuotaResponse>("/quota/me", {}, session);
        setQuota(response);
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "额度信息加载失败");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <div className="section-grid workspace-page quota-workspace">
      {contextHolder}
      <Card className="glass-card workspace-intro" styles={{ body: { padding: 28 } }}>
        <span className="workspace-code">QUOTA / WEEKLY WINDOW</span>
        <Typography.Title level={2}>
          {"AI 送审额度"}
        </Typography.Title>
      </Card>

      <Row gutter={[20, 20]}>
        <Col xs={24} md={8}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            <Statistic
              title={"本周剩余额度"}
              value={quota?.remaining ?? 0}
              suffix={`/ ${quota?.policy.weeklyQuotaPerCity ?? 0}`}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            <Statistic title={"本周已使用"} value={quota?.used ?? 0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            <Statistic
              title={"退回后冷却期"}
              value={quota?.policy.resubmitCooldownDays ?? 3}
              suffix={"天"}
            />
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
        <Typography.Title level={4}>{"额度台账"}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {`统计周期：${quota ? formatDate(quota.weekStart) : "--"} - ${
            quota ? formatDate(quota.weekEnd) : "--"
          }`}
        </Typography.Paragraph>
        <List
          dataSource={quota?.entries ?? []}
          locale={{ emptyText: "本周暂无 AI 送审记录" }}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta title={item.projectTitle} description={formatDateTime(item.consumedAt)} />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
