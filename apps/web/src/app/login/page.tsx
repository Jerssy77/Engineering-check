"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { AuthResponse } from "@property-review/shared";
import { Button, Form, Input, Space, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

import { apiRequest } from "../../lib/api";
import { saveSession } from "../../lib/session";

const TENCENT_LOGIN_URL = "https://qualityai.cgr.com.cn/login";

export default function LoginPage() {
  const router = useRouter();
  const [form] = Form.useForm<{ username: string; password: string }>();
  const [messageApi, contextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);
  const [isLegacyRenderHost, setIsLegacyRenderHost] = useState(false);

  useEffect(() => {
    setIsLegacyRenderHost(
      window.location.hostname.endsWith(".onrender.com") &&
      process.env.NEXT_PUBLIC_DEPLOYMENT_KIND !== "test"
    );
  }, []);

  const submit = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    try {
      const session = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });

      saveSession(session);
      messageApi.success("登录成功");
      startTransition(() => router.push("/projects"));
    } catch (error) {
      const text = error instanceof Error ? error.message : "登录失败";
      messageApi.error(text);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLegacyRenderHost) {
    return (
      <div className="auth-shell">
        <section className="auth-panel" style={{ maxWidth: 620, margin: "80px auto" }}>
          <span className="auth-badge">旧环境已停用</span>
          <Typography.Title level={2} style={{ marginTop: 18 }}>
            Render 演示环境已完成迁移
          </Typography.Title>
          <Typography.Paragraph className="section-copy">
            当前 Render 地址只保留迁移提示，不再用于填报、审核或下载附件。请统一使用腾讯云正式入口，避免产生分散数据。
          </Typography.Paragraph>
          <Button type="primary" size="large" href={TENCENT_LOGIN_URL}>
            打开腾讯云正式入口
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      {contextHolder}

      <div className="auth-grid">
        <section className="auth-hero">
          <div className="auth-hero-copy">
            <span className="auth-badge">工程立项审批平台</span>
            <Typography.Title className="auth-title">
              问清事实，形成方案，明确决策。
            </Typography.Title>
            <Typography.Paragraph className="auth-lead">工程项目从申报到审批的单线工作台。</Typography.Paragraph>
          </div>
          <div className="auth-feature-line">
            <span>智能访谈</span><span>唯一方案</span><span>明确结论</span>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-top">
            <span className="eyebrow-label">账号登录</span>
            <Typography.Title level={3} style={{ margin: "14px 0 8px" }}>
              进入工作台
            </Typography.Title>
          </div>

          <Form form={form} layout="vertical" onFinish={submit} className="auth-form">
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: "请输入用户名" }]}
            >
              <Input prefix={<UserOutlined />} placeholder="请输入用户名" size="large" />
            </Form.Item>

            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" size="large" />
            </Form.Item>

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} style={{ height: 50 }}>
              进入工作台
            </Button>
          </Form>

        </section>
      </div>
    </div>
  );
}
