"use client";

import {
  BarChartOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { Button, Layout, Menu, Space, Typography } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";

import { roleLabels } from "../lib/presentation";
import { clearSession, getSession } from "../lib/session";

const { Header, Content, Sider } = Layout;

type ShellUser = {
  displayName: string;
  role: string;
  organizationName?: string;
};

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ShellUser>({
    displayName: "访客",
    role: "submitter"
  });

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    setUser({
      displayName: session.user.displayName,
      role: session.user.role,
      organizationName: session.user.organizationId
    });
  }, [router]);

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/quota")) return "quota";
    if (pathname.startsWith("/admin")) return "admin";
    return "projects";
  }, [pathname]);

  return (
    <Layout className="platform-shell">
      <Sider breakpoint="lg" collapsedWidth="0" width={292} className="platform-sider">
        <div className="platform-brand">
          <div className="glass-card platform-brand-panel brand-frame">
            <span className="hero-kicker">工程立项审批平台</span>
            <Typography.Title level={3} className="platform-brand-title">
              统一填报、审批与成果输出
            </Typography.Title>
            <Typography.Paragraph className="platform-brand-copy">
              项目立项、AI 预审、人工终审和正式成果物统一归档。
            </Typography.Paragraph>
          </div>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            {
              key: "projects",
              icon: <FolderOpenOutlined />,
              label: <Link href="/projects">项目与填报</Link>
            },
            {
              key: "quota",
              icon: <BarChartOutlined />,
              label: <Link href="/quota">额度与策略</Link>
            },
            {
              key: "admin",
              icon: <SettingOutlined />,
              label: <Link href="/admin">管理看板</Link>
            }
          ]}
        />

        <div className="platform-side-note">
          <Typography.Text className="summary-label">当前角色</Typography.Text>
          <strong>{roleLabels[user.role] ?? user.role}</strong>
          <Typography.Text type="secondary">
            页面、按钮和成果物会按角色自动显示。
          </Typography.Text>
        </div>
      </Sider>

      <Layout style={{ background: "transparent" }}>
        <Header style={{ background: "transparent", padding: "0 0 0 16px", height: "auto" }}>
          <div className="glass-card platform-header-card">
            <div className="platform-header-main">
              <span className="eyebrow-label">当前工作台</span>
              <Typography.Title level={4} style={{ margin: "8px 0 0" }}>
                工程立项审批平台
              </Typography.Title>
              <Typography.Paragraph className="platform-header-copy">
                适用于立项发起、预算核对、终审留档和成果导出。
              </Typography.Paragraph>
            </div>

            <Space wrap size={12} className="platform-header-actions">
              <div className="platform-user-card">
                <Typography.Text strong>{user.displayName}</Typography.Text>
                <Typography.Text type="secondary">
                  {roleLabels[user.role] ?? user.role}
                </Typography.Text>
              </div>
              <Button icon={<FileSearchOutlined />} style={{ height: 42, paddingInline: 18 }}>
                <Link href="/projects">打开项目列表</Link>
              </Button>
              <Button
                danger
                icon={<LogoutOutlined />}
                style={{ height: 42, paddingInline: 18 }}
                onClick={() => {
                  clearSession();
                  router.replace("/login");
                }}
              >
                退出登录
              </Button>
            </Space>
          </div>
        </Header>

        <Content className="platform-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
