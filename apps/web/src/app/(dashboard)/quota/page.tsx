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
        messageApi.error(error instanceof Error ? error.message : "\u989d\u5ea6\u4fe1\u606f\u52a0\u8f7d\u5931\u8d25");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <div className="section-grid">
      {contextHolder}
      <Card className="glass-card" styles={{ body: { padding: 28 } }}>
        <span className="hero-kicker">{"\u989d\u5ea6\u4e2d\u5fc3"}</span>
        <Typography.Title level={2} style={{ marginTop: 14, marginBottom: 0 }}>
          {"AI \u7528\u91cf\u63a7\u5236"}
        </Typography.Title>
        <Typography.Paragraph style={{ color: "#56636a", marginTop: 10 }}>
          {
            "\u53ea\u6709\u201c\u63d0\u4ea4 AI \u9884\u5ba1\u201d\u4f1a\u6d88\u8017\u989d\u5ea6\uff0c\u8349\u7a3f\u4fdd\u5b58\u3001\u67e5\u770b\u7ed3\u8bba\u6216\u5386\u53f2\u7248\u672c\u90fd\u4e0d\u4f1a\u5360\u7528\u989d\u5ea6\u3002"
          }
        </Typography.Paragraph>
      </Card>

      <Row gutter={[20, 20]}>
        <Col xs={24} md={8}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            <Statistic
              title={"\u672c\u5468\u5269\u4f59\u989d\u5ea6"}
              value={quota?.remaining ?? 0}
              suffix={`/ ${quota?.policy.weeklyQuotaPerCity ?? 0}`}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            <Statistic title={"\u672c\u5468\u5df2\u4f7f\u7528"} value={quota?.used ?? 0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
            <Statistic
              title={"\u9000\u56de\u540e\u51b7\u5374\u671f"}
              value={quota?.policy.resubmitCooldownDays ?? 3}
              suffix={"\u5929"}
            />
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" loading={loading} styles={{ body: { padding: 24 } }}>
        <Typography.Title level={4}>{"\u989d\u5ea6\u53f0\u8d26"}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {`\u7edf\u8ba1\u5468\u671f\uff1a${quota ? formatDate(quota.weekStart) : "--"} - ${
            quota ? formatDate(quota.weekEnd) : "--"
          }`}
        </Typography.Paragraph>
        <List
          dataSource={quota?.entries ?? []}
          locale={{ emptyText: "\u672c\u5468\u6682\u65e0 AI \u9001\u5ba1\u8bb0\u5f55" }}
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
