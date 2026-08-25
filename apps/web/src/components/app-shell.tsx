"use client";

import { BarChartOutlined, BookOutlined, FileSearchOutlined, FolderOpenOutlined, LogoutOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Space, Tag, Typography } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";

import { roleLabels } from "../lib/presentation";
import { clearSession, getSession } from "../lib/session";

const { Header, Content, Sider } = Layout;

type ShellUser = { displayName: string; role: string; organizationName?: string };

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ShellUser>({ displayName: "访客", role: "submitter" });

  useEffect(() => {
    const session = getSession();
    if (!session) return router.replace("/login");
    setUser({ displayName: session.user.displayName, role: session.user.role, organizationName: session.user.organizationId });
  }, [router]);

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/quota")) return "quota";
    if (pathname.startsWith("/admin/knowledge")) return "knowledge";
    if (pathname.startsWith("/admin")) return "admin";
    return "projects";
  }, [pathname]);

  const menuItems = [
    { key: "projects", icon: <FolderOpenOutlined />, label: <Link href="/projects">项目与访谈</Link> },
    { key: "quota", icon: <BarChartOutlined />, label: <Link href="/quota">额度与策略</Link> },
    ...(user.role !== "submitter" ? [{ key: "admin", icon: <SettingOutlined />, label: <Link href="/admin">管理看板</Link> }] : []),
    ...(user.role === "admin" ? [{ key: "knowledge", icon: <BookOutlined />, label: <Link href="/admin/knowledge">知识工作台</Link> }] : [])
  ];

  return (
    <Layout className="platform-shell">
      <Sider breakpoint="lg" collapsedWidth="0" width={244} className="platform-sider">
        <div className="platform-brand">
          <div className="platform-brand-panel">
            <span className="brand-mark">工</span>
            <div><strong>工程立项</strong><small>智能审核</small></div>
          </div>
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} />
        <div className="platform-side-note">
          <strong>{roleLabels[user.role] ?? user.role}</strong>
        </div>
      </Sider>

      <Layout style={{ background: "transparent" }}>
        <Header style={{ background: "transparent", padding: "0 0 0 16px", height: "auto" }}>
          <div className="glass-card platform-header-card">
            <div className="platform-header-main">
              <Typography.Title level={4} style={{ margin: 0 }}>工程立项智能审核</Typography.Title>
              <Tag color="gold">影子审批</Tag>
            </div>
            <Space wrap size={12} className="platform-header-actions">
              <div className="platform-user-card"><Typography.Text strong>{user.displayName}</Typography.Text><Typography.Text type="secondary">{roleLabels[user.role] ?? user.role}</Typography.Text></div>
              <Button icon={<FileSearchOutlined />}><Link href="/projects">项目</Link></Button>
              <Button type="text" danger icon={<LogoutOutlined />} onClick={() => { clearSession(); router.replace("/login"); }}>退出</Button>
            </Space>
          </div>
        </Header>
        <Content className="platform-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
