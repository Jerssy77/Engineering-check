import { AntdRegistry } from "@ant-design/nextjs-registry";
import "@ant-design/v5-patch-for-react-19";
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "工程立项审批平台",
  description: "用于立项填报、AI 预审、人工终审与正式成果物导出的内部工作流系统。"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
