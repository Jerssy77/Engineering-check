"use client";

import { ConfigProvider } from "antd";
import { PropsWithChildren } from "react";

const uiFont = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';

export function DesignProvider({ children }: PropsWithChildren) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#1e5a88",
          colorSuccess: "#2f7567",
          colorWarning: "#b76237",
          colorError: "#a9443d",
          colorText: "#12304a",
          colorTextSecondary: "#61727b",
          colorBorder: "rgba(18, 48, 74, 0.20)",
          borderRadius: 5,
          controlHeight: 40,
          controlHeightLG: 48,
          controlHeightSM: 32,
          fontFamily: uiFont,
          fontSize: 14,
          lineHeight: 1.6
        },
        components: {
          Button: { fontWeight: 600, paddingInline: 16 },
          Card: { headerFontSize: 16, headerHeight: 56 },
          Form: { labelFontSize: 13, verticalLabelPadding: "0 0 7px" },
          Input: { paddingInline: 12 },
          Select: { optionFontSize: 14 },
          Table: { cellFontSize: 13, cellPaddingBlock: 14, cellPaddingInline: 16 }
        }
      }}
    >
      {children}
    </ConfigProvider>
  );
}
