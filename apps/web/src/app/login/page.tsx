"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { AuthResponse } from "@property-review/shared";
import { Button, Form, Input, Space, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { apiRequest } from "../../lib/api";
import { saveSession } from "../../lib/session";

const PLATFORM_POINTS = [
  {
    title: "统一填报",
    description: "城市公司、工程中心和管理层在同一套结构里完成立项信息、预算和附件归档。"
  },
  {
    title: "AI 预审",
    description: "把规范性要求、成本优化和技术建议集中到同一份审核视图，减少来回沟通。"
  },
  {
    title: "成果直出",
    description: "人工通过后直接生成审核报告、可行性报告和工程量清单，支持 PDF / Excel 导出。"
  }
];

const PROCESS_STEPS = [
  "申报人提交项目与附件",
  "AI 形成预审结论与强制项",
  "人工终审合并意见并留档",
  "通过后输出可行性报告与工程量清单"
];

export default function LoginPage() {
  const router = useRouter();
  const [form] = Form.useForm<{ username: string; password: string }>();
  const [messageApi, contextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div className="auth-shell">
      {contextHolder}

      <div className="auth-grid">
        <section className="auth-hero">
          <div className="auth-hero-copy">
            <span className="auth-badge">工程立项审批平台</span>
            <Typography.Title className="auth-title">
              让立项、AI 审核和正式审批成果留在同一条工作流里。
            </Typography.Title>
            <Typography.Paragraph className="auth-lead">
              面向城市公司与工程管理团队的内部审批系统。重点不是做一个更复杂的后台，而是让填报更快、
              审核更清楚、结果更容易流转。
            </Typography.Paragraph>
          </div>

          <div className="auth-highlight-grid">
            {PLATFORM_POINTS.map((item) => (
              <div key={item.title} className="auth-highlight-card">
                <span>{item.title}</span>
                <strong>{item.description}</strong>
              </div>
            ))}
          </div>

          <div className="auth-process-panel">
            <div className="auth-panel-head">
              <span className="summary-label">审批流概览</span>
              <strong>从填报到成果输出的单线流程</strong>
            </div>
            <div className="auth-step-list">
              {PROCESS_STEPS.map((step, index) => (
                <div key={step} className="auth-step-item">
                  <span className="auth-step-index">{String(index + 1).padStart(2, "0")}</span>
                  <p>{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-top">
            <span className="eyebrow-label">账号登录</span>
            <Typography.Title level={3} style={{ margin: "14px 0 8px" }}>
              进入工作台
            </Typography.Title>
            <Typography.Paragraph className="section-copy" style={{ marginBottom: 0 }}>
              使用分配账号登录后，可直接进入项目填报、AI 预审、人工终审和成果导出页面。
            </Typography.Paragraph>
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

          <div className="auth-footnote">
            <strong>当前版本支持</strong>
            <span>项目填报、附件归档、AI 预审、人工终审、可行性报告与工程量清单导出。</span>
          </div>
        </section>
      </div>
    </div>
  );
}
