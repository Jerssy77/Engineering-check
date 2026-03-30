import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import { Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";

import "./globals.css";

const sans = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "700"]
});

const serif = Noto_Serif_SC({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["500", "700"]
});

export const metadata: Metadata = {
  title: "\u7269\u4e1a\u5de5\u7a0b\u7acb\u9879 AI \u5ba1\u6838\u7cfb\u7edf",
  description: "\u7528\u4e8e\u7acb\u9879\u586b\u62a5\u3001AI \u9884\u5ba1\u3001\u4eba\u5de5\u7ec8\u5ba1\u4e0e\u989d\u5ea6\u6cbb\u7406\u7684\u5185\u90e8\u5de5\u4f5c\u6d41\u7cfb\u7edf\u3002"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${sans.variable} ${serif.variable}`}>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
