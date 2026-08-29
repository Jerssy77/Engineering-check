"use client";

import { BarChartOutlined, BookOutlined, FolderOpenOutlined, LogoutOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Layout, Menu } from "antd";
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

  const pageMeta = useMemo(() => {
    if (pathname.startsWith("/admin/knowledge")) return { code: "KN-04", title: "知识工作台" };
    if (pathname.startsWith("/admin")) return { code: "MG-03", title: "管理看板" };
    if (pathname.startsWith("/quota")) return { code: "QT-02", title: "额度与策略" };
    if (pathname.includes("/interview")) return { code: "QA-01", title: "填报访谈" };
    if (pathname.includes("/report/")) return { code: "RP-05", title: "最终审核报告" };
    if (pathname.includes("/feasibility/")) return { code: "FS-05", title: "可行性报告" };
    if (pathname.includes("/bill-of-quantities/")) return { code: "BQ-05", title: "工程量清单" };
    if (/\/projects\/[^/]+/.test(pathname)) return { code: "FM-01", title: "结构化填报" };
    return { code: "PL-00", title: "项目审查台账" };
  }, [pathname]);

  const menuItems = [
    { key: "projects", icon: <FolderOpenOutlined />, label: <Link href="/projects"><span>项目与访谈</span><small>PROJECTS</small></Link> },
    ...(user.role === "submitter" ? [{ key: "quota", icon: <BarChartOutlined />, label: <Link href="/quota"><span>额度与策略</span><small>QUOTA</small></Link> }] : []),
    ...(user.role !== "submitter" ? [{ key: "admin", icon: <SettingOutlined />, label: <Link href="/admin"><span>管理看板</span><small>CONTROL</small></Link> }] : []),
    ...(user.role === "admin" ? [{ key: "knowledge", icon: <BookOutlined />, label: <Link href="/admin/knowledge"><span>知识工作台</span><small>KNOWLEDGE</small></Link> }] : [])
  ];

  return (
    <Layout className="platform-shell">
      <Sider breakpoint="lg" collapsedWidth="0" width={252} className="platform-sider">
        <div className="platform-brand">
          <div className="platform-brand-panel">
            <span className="brand-mark"><i /><b>工</b></span>
            <div><strong>工程审查台</strong><small>ENGINEERING REVIEW</small></div>
          </div>
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} />
        <div className="platform-side-note">
          <span>当前身份</span>
          <strong>{roleLabels[user.role] ?? user.role}</strong>
          <small>{user.displayName}</small>
        </div>
      </Sider>

      <Layout className="platform-main">
        <Header className="platform-header">
          <div className="platform-header-card">
            <div className="platform-header-context">
              <span>{pageMeta.code}</span>
              <div>
                <strong>{pageMeta.title}</strong>
              </div>
            </div>
            <div className="platform-header-actions">
              <span className="platform-mode"><i />影子审批</span>
              <Button className="platform-logout" type="text" icon={<LogoutOutlined />} onClick={() => { clearSession(); router.replace("/login"); }}>退出</Button>
            </div>
          </div>
        </Header>
        <Content className="platform-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
