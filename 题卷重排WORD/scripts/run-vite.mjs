import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundledNode = join(
  process.env.USERPROFILE || "",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "node",
  "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
const nodeExecutable = existsSync(bundledNode) ? bundledNode : process.execPath;
const command = process.argv[2];

if (command === "start") {
  process.env.NODE_ENV ||= "production";
  const serverEntry = join(root, ".server-dist", "server", "index.js");
  if (!existsSync(serverEntry)) {
    throw new Error("未找到服务端构建产物，请先运行 npm run build。");
  }
  await import(pathToFileURL(serverEntry).href);
} else {
  const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");
  const tsc = spawnSync(process.execPath, [tscBin, "-b"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });

  if (tsc.status !== 0) {
    process.exit(tsc.status ?? 1);
  }

  const viteArgs = [join(root, "node_modules", "vite", "bin", "vite.js"), ...process.argv.slice(2)];
  const vite = spawnSync(nodeExecutable, viteArgs, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });

  if (vite.status !== 0) {
    process.exit(vite.status ?? 1);
  }

  if (command !== "build") {
    process.exit(0);
  }

  const serverBuild = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.server.json"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });

  process.exit(serverBuild.status ?? 1);
}
