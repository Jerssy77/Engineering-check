"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { AuthResponse } from "@property-review/shared";
import { Button, Col, Form, Input, Row, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import { startTransition } from "react";

import { apiRequest } from "../../lib/api";
import { saveSession } from "../../lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [form] = Form.useForm<{ username: string; password: string }>();
  const [messageApi, contextHolder] = message.useMessage();

  const submit = async (values: { username: string; password: string }) => {
    try {
      const session = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });

      saveSession(session);
      messageApi.success("\u767b\u5f55\u6210\u529f");
      startTransition(() => router.push("/projects"));
    } catch (error) {
      const text = error instanceof Error ? error.message : "\u767b\u5f55\u5931\u8d25";
      messageApi.error(text);
    }
  };

  return (
    <div className="page-shell">
      {contextHolder}
      <div className="section-grid two-col">
        <section className="glass-card" style={{ padding: 36 }}>
          <span className="hero-kicker">{"\u7269\u4e1a\u5de5\u7a0b\u7acb\u9879 - AI \u9884\u5ba1"}</span>
          <h1 className="hero-title" style={{ marginTop: 18 }}>
            {"\u8ba9\u7acb\u9879\u8349\u7a3f\u3001AI \u7ed3\u8bba\u548c\u4eba\u5de5\u7ec8\u5ba1\u7559\u5728\u540c\u4e00\u6761\u5de5\u4f5c\u6d41\u91cc\u3002"}
          </h1>
          <Typography.Paragraph style={{ fontSize: 16, color: "#56636a", marginTop: 18 }}>
            {"\u57ce\u5e02\u516c\u53f8\u6309\u6807\u51c6\u6a21\u5757\u586b\u62a5\u7acb\u9879\u6750\u6599\uff0c\u7cfb\u7edf\u5148\u505a\u989d\u5ea6\u4e0e\u51b7\u5374\u671f\u6821\u9a8c\uff0c\u518d\u89e6\u53d1 AI \u9884\u5ba1\uff0c"}
            {"\u751f\u6210\u4e00\u9875\u7b80\u660e\u7ed3\u8bba\u4f9b\u533a\u57df\u6216\u603b\u90e8\u5de5\u7a0b\u7ba1\u7406\u4eba\u5feb\u901f\u5224\u65ad\u3002"}
          </Typography.Paragraph>
          <Row gutter={[16, 16]} style={{ marginTop: 28 }}>
            {[
              { label: "\u57ce\u5e02\u516c\u53f8\u6bcf\u5468 AI \u9001\u5ba1", value: "3 \u6b21" },
              { label: "\u9000\u56de\u540e\u51b7\u5374\u671f", value: "3 \u5929" },
              { label: "\u8f93\u51fa\u7ed3\u679c", value: "\u5728\u7ebf\u9875 + PDF" }
            ].map((item) => (
              <Col span={8} key={item.label}>
                <div className="metric-chip">
                  <Typography.Text type="secondary">{item.label}</Typography.Text>
                  <Typography.Title level={4} style={{ margin: "6px 0 0" }}>
                    {item.value}
                  </Typography.Title>
                </div>
              </Col>
            ))}
          </Row>
        </section>

        <section className="glass-card" style={{ padding: 30 }}>
          <Typography.Title level={3} style={{ marginTop: 0 }}>
            {"\u767b\u5f55\u7cfb\u7edf"}
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            {"\u8bf7\u4f7f\u7528\u5df2\u5206\u914d\u7684\u7528\u6237\u540d\u548c\u5bc6\u7801\u767b\u5f55\u7cfb\u7edf\u3002"}
          </Typography.Paragraph>

          <Form form={form} layout="vertical" onFinish={submit}>
            <Form.Item name="username" label={"\u7528\u6237\u540d"} rules={[{ required: true, message: "\u8bf7\u8f93\u5165\u7528\u6237\u540d" }]}>
              <Input prefix={<UserOutlined />} placeholder={"\u8bf7\u8f93\u5165\u7528\u6237\u540d"} />
            </Form.Item>
            <Form.Item name="password" label={"\u5bc6\u7801"} rules={[{ required: true, message: "\u8bf7\u8f93\u5165\u5bc6\u7801" }]}>
              <Input.Password prefix={<LockOutlined />} placeholder={"\u8bf7\u8f93\u5165\u5bc6\u7801"} />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block style={{ height: 46 }}>
              {"\u8fdb\u5165\u5de5\u4f5c\u53f0"}
            </Button>
          </Form>
        </section>
      </div>
    </div>
  );
}
