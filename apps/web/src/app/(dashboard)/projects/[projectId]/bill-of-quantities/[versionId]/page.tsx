"use client";

import {
  DownloadOutlined,
  FileTextOutlined,
  TableOutlined
} from "@ant-design/icons";
import { Alert, Button, List, Space, Table, Tag, Typography, message } from "antd";
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
  sourceMode: "online" | "upload";
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
  uploadedSheetSummary?: {
    attachmentId: string;
    fileName: string;
    parsedAt: string;
    totalAmount?: number;
    totalLabel?: string;
    totalCell?: string;
    totalSheetName?: string;
    detailRowCount: number;
    parsedSheetNames: string[];
    sections: Array<{
      id: string;
      sheetName: string;
      name: string;
      startRow: number;
      endRow?: number;
      subtotal?: number;
      tax?: number;
      total?: number;
    }>;
    rows: Array<{
      id: string;
      sheetName: string;
      rowNumber: number;
      sectionName?: string;
      rowType: "detail" | "summary" | "tax" | "note";
      itemName: string;
      specification?: string;
      unit?: string;
      quantity?: number;
      unitPrice?: number;
      lineTotal?: number;
      remark?: string;
    }>;
    notes: string[];
    warnings: string[];
  };
  originalAttachment?: {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
  };
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
              {report?.sourceMode === "upload"
                ? "当前版本采用上传 Excel 清单作为正式工程量清单，页面展示解析摘要、分组汇总和关键明细，Excel 下载将返回用户原始文件。"
                : "以工程项与其他费用两类清晰展开当前版本的预算矩阵，支持直接预览、导出 PDF 和导出 Excel，方便后续执行与采买衔接。"}
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
                {report?.sourceMode === "upload" ? "上传清单解析预览" : "工程量清单预览"}
              </Typography.Title>
              {report?.sourceMode === "upload" && report.uploadedSheetSummary ? (
                <Space direction="vertical" size={14} style={{ width: "100%" }}>
                  <div className="report-columns">
                    <div className="summary-item">
                      <Typography.Text type="secondary">原始文件</Typography.Text>
                      <strong>{report.uploadedSheetSummary.fileName}</strong>
                      <Typography.Text type="secondary">{report.uploadedSheetSummary.parsedSheetNames.join("、")}</Typography.Text>
                    </div>
                    <div className="summary-item">
                      <Typography.Text type="secondary">识别总价</Typography.Text>
                      <strong>{formatCurrency(report.uploadedSheetSummary.totalAmount ?? 0)}</strong>
                      <Typography.Text type="secondary">
                        {report.uploadedSheetSummary.totalSheetName ?? "-"} {report.uploadedSheetSummary.totalCell ?? ""}
                      </Typography.Text>
                    </div>
                    <div className="summary-item">
                      <Typography.Text type="secondary">明细行数</Typography.Text>
                      <strong>{report.uploadedSheetSummary.detailRowCount} 行</strong>
                    </div>
                  </div>
                  {report.uploadedSheetSummary.warnings.length ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="解析提示"
                      description={report.uploadedSheetSummary.warnings.join("；")}
                    />
                  ) : null}
                  <List
                    bordered
                    header={<Typography.Text strong>分组汇总</Typography.Text>}
                    dataSource={report.uploadedSheetSummary.sections}
                    locale={{ emptyText: "暂未识别到分组" }}
                    renderItem={(section) => (
                      <List.Item>
                        <Space direction="vertical" size={2} style={{ width: "100%" }}>
                          <Typography.Text strong>{section.name}</Typography.Text>
                          <Typography.Text type="secondary">
                            {section.sheetName} 第 {section.startRow}-{section.endRow ?? section.startRow} 行
                          </Typography.Text>
                          <Typography.Text>
                            小计 {section.subtotal === undefined ? "-" : formatCurrency(section.subtotal)} / 税费{" "}
                            {section.tax === undefined ? "-" : formatCurrency(section.tax)} / 总计{" "}
                            {section.total === undefined ? "-" : formatCurrency(section.total)}
                          </Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <List
                    bordered
                    header={<Typography.Text strong>解析明细</Typography.Text>}
                    dataSource={report.uploadedSheetSummary.rows}
                    pagination={{ pageSize: 12, size: "small" }}
                    renderItem={(row) => (
                      <List.Item>
                        <Space direction="vertical" size={2} style={{ width: "100%" }}>
                          <Space wrap>
                            <Tag>{row.rowType === "detail" ? "明细" : row.rowType === "summary" ? "汇总" : row.rowType === "tax" ? "税费" : "备注"}</Tag>
                            <Typography.Text strong>{row.itemName}</Typography.Text>
                            <Typography.Text type="secondary">
                              {row.sheetName} 第 {row.rowNumber} 行
                            </Typography.Text>
                          </Space>
                          <Typography.Text type="secondary">
                            {row.specification || row.sectionName || "-"} / {row.unit || "-"} / 数量 {row.quantity ?? "-"} / 单价{" "}
                            {row.unitPrice === undefined ? "-" : formatCurrency(row.unitPrice)} / 合价{" "}
                            {row.lineTotal === undefined ? "-" : formatCurrency(row.lineTotal)}
                          </Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </Space>
              ) : (
                <Table<BoqRow>
                  rowKey="id"
                  loading={loading}
                  columns={columns}
                  dataSource={report?.rows ?? []}
                  pagination={false}
                  scroll={{ x: 1100 }}
                />
              )}
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
                    report?.sourceMode === "upload" && report.originalAttachment
                      ? report.originalAttachment.fileName
                      : `bill-of-quantities-${routeParams.versionId}.xlsx`
                  )
                }
                block
              >
                {report?.sourceMode === "upload" ? "下载原始 Excel" : "下载 Excel"}
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
                  <Typography.Text type="secondary">{report?.sourceMode === "upload" ? "上传清单总价" : "矩阵测算总价"}</Typography.Text>
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
