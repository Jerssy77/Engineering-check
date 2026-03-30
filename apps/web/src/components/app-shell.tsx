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

import { clearSession, getSession } from "../lib/session";

const { Header, Content, Sider } = Layout;

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("\u8bbf\u5ba2");

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setDisplayName(session.user.displayName);
  }, [router]);

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/quota")) return "quota";
    if (pathname.startsWith("/admin")) return "admin";
    return "projects";
  }, [pathname]);

  return (
    <Layout style={{ minHeight: "100vh", background: "transparent" }}>
      <Sider
        breakpoint="lg"
        collapsedWidth="0"
        width={256}
        style={{
          background: "rgba(255,250,244,0.82)",
          borderRight: "1px solid rgba(57,70,72,0.12)",
          backdropFilter: "blur(14px)"
        }}
      >
        <div style={{ padding: 24 }}>
          <Typography.Text style={{ color: "#146c6f", fontWeight: 700 }}>ENGINEERING AI</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 10, marginBottom: 6 }}>
            {"\u7acb\u9879\u5ba1\u6838\u5de5\u4f5c\u53f0"}
          </Typography.Title>
          <Typography.Paragraph style={{ color: "#56636a", marginBottom: 0 }}>
            {
              "\u628a\u63d0\u62a5\u3001\u5ba1\u6838\u7559\u75d5\u548c AI \u989d\u5ea6\u6cbb\u7406\u653e\u5728\u540c\u4e00\u4e2a\u5de5\u4f5c\u53f0\u91cc\u3002"
            }
          </Typography.Paragraph>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            {
              key: "projects",
              icon: <FolderOpenOutlined />,
              label: <Link href="/projects">{"\u7acb\u9879\u5217\u8868"}</Link>
            },
            {
              key: "quota",
              icon: <BarChartOutlined />,
              label: <Link href="/quota">{"\u989d\u5ea6\u4e2d\u5fc3"}</Link>
            },
            {
              key: "admin",
              icon: <SettingOutlined />,
              label: <Link href="/admin">{"\u7ba1\u7406\u770b\u677f"}</Link>
            }
          ]}
          style={{ background: "transparent", borderInlineEnd: "none" }}
        />
      </Sider>
      <Layout style={{ background: "transparent" }}>
        <Header
          style={{
            background: "transparent",
            padding: "18px 28px 0",
            height: "auto"
          }}
        >
          <div className="glass-card" style={{ padding: 18, display: "flex", justifyContent: "space-between" }}>
            <Space direction="vertical" size={2}>
              <Typography.Text type="secondary">{"\u5f53\u524d\u767b\u5f55"}</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {displayName}
              </Typography.Title>
            </Space>
            <Space>
              <Button type="default" icon={<FileSearchOutlined />}>
                <Link href="/projects">{"\u6253\u5f00\u7acb\u9879"}</Link>
              </Button>
              <Button
                danger
                icon={<LogoutOutlined />}
                onClick={() => {
                  clearSession();
                  router.replace("/login");
                }}
              >
                {"\u9000\u51fa\u767b\u5f55"}
              </Button>
            </Space>
          </div>
        </Header>
        <Content style={{ padding: 28 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
