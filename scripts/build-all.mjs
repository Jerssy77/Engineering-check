import { spawn } from "node:child_process";

const commands =
  process.platform === "win32"
    ? [
        ["cmd.exe", ["/d", "/s", "/c", "npm run build --workspace @property-review/shared"]],
        ["cmd.exe", ["/d", "/s", "/c", "npm run build --workspace @property-review/api"]],
        ["cmd.exe", ["/d", "/s", "/c", "npm run build --workspace @property-review/web"]]
      ]
    : [
        ["npm", ["run", "build", "--workspace", "@property-review/shared"]],
        ["npm", ["run", "build", "--workspace", "@property-review/api"]],
        ["npm", ["run", "build", "--workspace", "@property-review/web"]]
      ];

for (const [command, args] of commands) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: process.cwd()
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}
