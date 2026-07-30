import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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
const tsxBin = join(root, "node_modules", "tsx", "dist", "cli.mjs");

const result = spawnSync(nodeExecutable, [tsxBin, "watch", join(root, "server", "index.ts")], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

process.exit(result.status ?? 1);
