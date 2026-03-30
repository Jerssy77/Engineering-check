import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function findEnvFile(startDir) {
  let currentDir = startDir;

  while (true) {
    const candidate = path.join(currentDir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile() {
  const envFile = findEnvFile(process.cwd());
  if (!envFile) {
    return;
  }

  const content = readFileSync(envFile, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripQuotes(trimmed.slice(separatorIndex + 1));
  }
}

loadEnvFile();

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const mode = process.argv[2] || "dev";
const host = process.env.WEB_HOST?.trim() || "0.0.0.0";
const port = process.env.WEB_PORT?.trim() || process.env.PORT?.trim() || "3000";

const child = spawn(process.execPath, [nextBin, mode, "-H", host, "-p", port], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
