import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.LIVE_API_BASE_URL?.trim() || "http://127.0.0.1:3001";
const outputFile = path.resolve(
  process.cwd(),
  process.env.APP_DATA_FILE?.trim() || "./runtime-data/app-state.json"
);

function inferPassword(user) {
  return user.role === "admin" ? "demo123" : "jinyuan888";
}

async function apiRequest(pathname, init = {}, token) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("x-user-id", token);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${pathname} -> ${response.status} ${response.statusText}: ${body}`);
  }

  return response.json();
}

function buildQuotaLedger(projects, versionsByProject) {
  return projects.flatMap((project) =>
    (versionsByProject.get(project.id) ?? [])
      .filter((version) => version.submittedAt)
      .map((version) => ({
        id: `quota_${version.id}`,
        organizationId: project.organizationId,
        projectId: project.id,
        versionId: version.id,
        consumedAt: version.submittedAt
      }))
  );
}

async function main() {
  const auth = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: process.env.LIVE_ADMIN_USERNAME?.trim() || "admin",
      password: process.env.LIVE_ADMIN_PASSWORD?.trim() || "demo123"
    })
  });

  const dashboard = await apiRequest("/admin/dashboard", {}, auth.token);
  const projectRows = await apiRequest("/projects", {}, auth.token);

  const details = [];
  for (const project of projectRows) {
    const detail = await apiRequest(`/projects/${project.id}`, {}, auth.token);
    details.push(detail);
  }

  const versionsByProject = new Map(details.map((detail) => [detail.project.id, detail.versions]));
  const state = {
    organizations: dashboard.organizations ?? [],
    users: (dashboard.users ?? []).map((user) => ({
      ...user,
      password: inferPassword(user)
    })),
    projects: details.map((detail) => detail.project),
    versions: details.flatMap((detail) => detail.versions ?? []),
    attachments: details.flatMap((detail) => detail.attachments ?? []),
    parseResults: details.flatMap((detail) => detail.attachmentParseResults ?? []),
    aiReviews: details.flatMap((detail) => detail.aiReviews ?? []),
    decisions: details.flatMap((detail) => detail.humanDecisions ?? []),
    overrides: details.flatMap((detail) => detail.overrides ?? []),
    quotaLedger: buildQuotaLedger(details.map((detail) => detail.project), versionsByProject),
    auditLogs: details.flatMap((detail) => detail.auditLogs ?? []),
    quotaPolicy: dashboard.quotaPolicy
  };

  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  console.log(`Captured ${state.projects.length} projects to ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
