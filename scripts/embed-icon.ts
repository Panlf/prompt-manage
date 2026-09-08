/**
 * 构建后自动嵌入图标到 exe 文件
 * 用法: bun run scripts/embed-icon.ts
 */
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const root = process.cwd();
const rcedit = join(root, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const icon = join(root, "resources", "app-icon.ico");
const buildDir = join(root, "build", "stable-win-x64");

const targets = [
  join(buildDir, "prompt-manage-Setup.exe"),
  join(buildDir, "prompt-manage", "bin", "launcher"),
];

if (!existsSync(rcedit)) {
  console.error("rcedit not found at:", rcedit);
  console.error("Run: npm install rcedit");
  process.exit(1);
}

if (!existsSync(icon)) {
  console.error("Icon not found:", icon);
  process.exit(1);
}

for (const target of targets) {
  if (!existsSync(target)) {
    console.log(`Skip (not found): ${target}`);
    continue;
  }
  try {
    execSync(`"${rcedit}" "${target}" --set-icon "${icon}"`, { stdio: "inherit" });
    console.log(`Icon embedded: ${target}`);
  } catch (e) {
    console.error(`Failed: ${target}`, e);
  }
}

console.log("Done.");
