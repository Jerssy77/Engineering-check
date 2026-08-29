"use client";

import { ArrowRightOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
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
            <span className="auth-badge"><b>ER / 01</b> 工程立项审查平台</span>
            <Typography.Title className="auth-title">
              工程立项<br />审查平台
            </Typography.Title>
          </div>
          <div className="auth-review-route" aria-label="审查流程">
            <div><span>01</span><strong>项目申报</strong></div>
            <div><span>02</span><strong>专业审查</strong></div>
            <div><span>03</span><strong>结论归档</strong></div>
          </div>
          <div className="auth-datum">DATUM 0.00 · FACT / EVIDENCE / DECISION</div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-top">
            <span className="eyebrow-label">ACCOUNT ACCESS</span>
            <Typography.Title level={2}>
              账号登录
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

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRightOutlined />} iconPosition="end">
              登录
            </Button>
          </Form>
        </section>
      </div>
    </div>
  );
}
