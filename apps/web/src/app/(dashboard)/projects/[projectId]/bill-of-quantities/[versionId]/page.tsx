"use client";

import {
  DownloadOutlined,
  FileTextOutlined,
  TableOutlined
} from "@ant-design/icons";
import { Button, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

import { apiRequest } from "../../../../../../lib/api";
import { formatCurrency } from "../../../../../../lib/presentation";
import { getSession } from "../../../../../../lib/session";

interface BoqRow {
  id: string;
  type: "engineering" | "other_fee";
  typeLabel: string;
  itemName: string;
  specification: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  remark: string;
}

interface BoqResponse {
  project: {
    id: string;
    title: string;
    organizationName: string;
    versionNumber: number;
    categoryLabel: string;
    locationSummary: string;
    expectedWindow: string;
  };
  rows: BoqRow[];
  engineeringRows: BoqRow[];
  otherFeeRows: BoqRow[];
  budgetSummary: {
    engineeringSubtotal: number;
    otherFeeSubtotal: number;
    calculatedBudget: number;
    declaredBudget: number;
    budgetGap: number;
  };
  declaredBudgetNote: string;
}

export default function BillOfQuantitiesPage({
  params
}: {
  params: Promise<{ projectId: string; versionId: string }>;
}) {
  const routeParams = use(params);
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<BoqResponse | null>(null);
  const session = getSession();

  const load = async () => {
    if (!session) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<BoqResponse>(
        `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/bill-of-quantities`,
        {},
        session
      );
      setReport(response);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工程量清单加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [routeParams.projectId, routeParams.versionId]);

  const downloadAsset = async (path: string, fileName: string) => {
    try {
      const blob = await apiRequest<Blob>(path, {}, session);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "下载失败");
    }
  };

  const columns: ColumnsType<BoqRow> = [
    {
      title: "分类",
      dataIndex: "typeLabel",
      width: 120
    },
    {
      title: "项目名称",
      dataIndex: "itemName",
      width: 220
    },
    {
      title: "规格型号",
      dataIndex: "specification",
      width: 180,
      render: (value: string) => value || "—"
    },
    {
      title: "单位",
      dataIndex: "unit",
      width: 100,
      render: (value: string) => value || "—"
    },
    {
      title: "工程量",
      dataIndex: "quantity",
      width: 110
    },
    {
      title: "单价（元）",
      dataIndex: "unitPrice",
      width: 140,
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "合价（元）",
      dataIndex: "lineTotal",
      width: 140,
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "备注",
      dataIndex: "remark",
      render: (value: string) => value || "—"
    }
  ];

  return (
    <div className="section-grid">
      {contextHolder}

      <section className="glass-card brand-frame document-cover">
        <div className="split-layout" style={{ alignItems: "end" }}>
          <Space direction="vertical" size={14}>
            <span className="hero-kicker">Bill Of Quantities</span>
            <Typography.Title className="hero-title">
              {report?.project.title ?? "工程量清单"}
            </Typography.Title>
            <Typography.Paragraph style={{ color: "var(--ink-soft)", marginBottom: 0, maxWidth: 760 }}>
              以工程项与其他费用两类清晰展开当前版本的预算矩阵，支持直接预览、导出 PDF 和导出 Excel，方便后续执行与采买衔接。
            </Typography.Paragraph>
          </Space>

          <div className="summary-grid">
            <div className="summary-item">
              <Typography.Text type="secondary">版本信息</Typography.Text>
              <strong>{report ? `V${report.project.versionNumber}` : "-"}</strong>
              <Typography.Text type="secondary">
                {report ? `${report.project.categoryLabel} · ${report.project.locationSummary}` : "—"}
              </Typography.Text>
            </div>
            <div className="summary-item">
              <Typography.Text type="secondary">预算总览</Typography.Text>
              <strong>{report ? formatCurrency(report.budgetSummary.calculatedBudget) : "-"}</strong>
              <Typography.Text type="secondary">
                {report ? report.declaredBudgetNote : "—"}
              </Typography.Text>
            </div>
          </div>
        </div>
      </section>

      <div className="split-layout">
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <section className="section-surface document-table">
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                工程量清单预览
              </Typography.Title>
              <Table<BoqRow>
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={report?.rows ?? []}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            </Space>
          </section>
        </Space>

        <Space direction="vertical" size={18} className="sticky-stack" style={{ width: "100%" }}>
          <section className="section-surface">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                导出与跳转
              </Typography.Title>
              <Button
                icon={<DownloadOutlined />}
                onClick={() =>
                  void downloadAsset(
                    `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/bill-of-quantities.pdf`,
                    `bill-of-quantities-${routeParams.versionId}.pdf`
                  )
                }
                block
              >
                下载 PDF
              </Button>
              <Button
                icon={<TableOutlined />}
                onClick={() =>
                  void downloadAsset(
                    `/projects/${routeParams.projectId}/versions/${routeParams.versionId}/bill-of-quantities.xlsx`,
                    `bill-of-quantities-${routeParams.versionId}.xlsx`
                  )
                }
                block
              >
                下载 Excel
              </Button>
              <Button icon={<FileTextOutlined />} block>
                <Link href={`/projects/${routeParams.projectId}/feasibility/${routeParams.versionId}`}>
                  返回可行性报告
                </Link>
              </Button>
            </Space>
          </section>

          <section className="section-surface">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                汇总金额
              </Typography.Title>
              <div className="summary-grid">
                <div className="summary-item">
                  <Typography.Text type="secondary">工程项小计</Typography.Text>
                  <strong>{report ? formatCurrency(report.budgetSummary.engineeringSubtotal) : "-"}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">其他费用小计</Typography.Text>
                  <strong>{report ? formatCurrency(report.budgetSummary.otherFeeSubtotal) : "-"}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">矩阵测算总价</Typography.Text>
                  <strong>{report ? formatCurrency(report.budgetSummary.calculatedBudget) : "-"}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">申报总预算</Typography.Text>
                  <strong>{report ? formatCurrency(report.budgetSummary.declaredBudget) : "-"}</strong>
                </div>
                <div className="summary-item">
                  <Typography.Text type="secondary">预算差额</Typography.Text>
                  <strong>{report ? formatCurrency(report.budgetSummary.budgetGap) : "-"}</strong>
                </div>
              </div>
            </Space>
          </section>
        </Space>
      </div>
    </div>
  );
}
