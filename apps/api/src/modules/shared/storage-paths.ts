import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_DATA_FILE = "./runtime-data/app-state.json";
const DEFAULT_UPLOAD_DIR = "./runtime-data/uploads";

function findWorkspaceRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const markers = [
      path.join(currentDir, ".env"),
      path.join(currentDir, ".env.example"),
      path.join(currentDir, "package-lock.json")
    ];

    if (markers.some((marker) => existsSync(marker))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }
    currentDir = parentDir;
  }
}

function resolveAppPath(configured: string | undefined, fallback: string): string {
  return path.resolve(findWorkspaceRoot(process.cwd()), configured?.trim() || fallback);
}

export function resolveWorkspacePath(...parts: string[]): string {
  return path.resolve(findWorkspaceRoot(process.cwd()), ...parts);
}

export function resolveDataFilePath(): string {
  return resolveAppPath(process.env.APP_DATA_FILE, DEFAULT_DATA_FILE);
}

export function resolveUploadDirPath(): string {
  return resolveAppPath(process.env.APP_UPLOAD_DIR, DEFAULT_UPLOAD_DIR);
}

export function ensureDirectory(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function ensureFileDirectory(filePath: string): void {
  ensureDirectory(path.dirname(filePath));
}

export function readJsonFile<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureFileDirectory(filePath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function sanitizeFileName(fileName: string): string {
  const sanitized = fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  return sanitized || "file";
}

export function normalizeLatin1Utf8Text(value: string): string {
  if (!value || /[\u4E00-\u9FFF]/u.test(value) || !/[\u00C0-\u024F]/u.test(value)) {
    return value;
  }

  try {
    const normalized = Buffer.from(value, "latin1").toString("utf8");
    return normalized.includes("\uFFFD") ? value : normalized;
  } catch {
    return value;
  }
}
