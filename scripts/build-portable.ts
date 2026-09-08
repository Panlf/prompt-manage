/**
 * 构建后：从 tar.zst 解压生成真正的绿色版应用 + 嵌入图标 + 打包 zip
 *
 * 背景：
 *   Electrobun 构建后，build/stable-win-x64/prompt-manage/bin/launcher.exe 实际是
 *   extractor.exe（自解压安装器外壳），不能直接运行。真正的 launcher 在
 *   Resources/<hash>.tar.zst 压缩包里，必须解压才能得到。
 *
 * 用法: bun run scripts/build-portable.ts
 */
import { existsSync, rmSync, mkdirSync, readdirSync, copyFileSync, statSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * 重命名/移动文件或目录，带重试。
 * Windows 上 Defender/搜索索引器可能对刚生成的文件短暂加锁（EPERM/EACCES/EBUSY），
 * 等待后重试通常即可成功。
 */
function renameWithRetry(src: string, dst: string, label: string, tries = 6, delayMs = 500) {
	let lastErr: unknown;
	for (let i = 0; i < tries; i++) {
		try {
			renameSync(src, dst);
			return;
		} catch (e) {
			lastErr = e;
			console.log(`  Retry ${i + 1}/${tries} for [${label}]: ${e instanceof Error ? e.message : String(e)}`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
		}
	}
	fail(`Failed to ${label}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

const root = process.cwd();
const rcedit = join(root, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const icon = join(root, "resources", "app-icon.ico");
const zigZstd = join(root, "node_modules", "electrobun", "dist-win-x64", "zig-zstd.exe");
const buildDir = join(root, "build", "stable-win-x64");
const appSourceDir = join(buildDir, "prompt-manage");
const resourcesDir = join(appSourceDir, "Resources");

// 临时工作目录
const workDir = join(buildDir, "_portable_work");
const extractedDir = join(workDir, "prompt-manage");
const tarPath = join(workDir, "app.tar");

// 输出（用户可见名称统一为 PromptHub）
const portableDir = join(buildDir, "PromptHub");
const portableZip = join(buildDir, "PromptHub.zip");

// 主程序名（更专业的命名，替代默认的 launcher.exe）
const appExeName = "PromptHub.exe";

function fail(msg: string) {
	console.error(msg);
	process.exit(1);
}

// 1. 检查必需文件
console.log("=== Step 1: Check prerequisites ===");
if (!existsSync(resourcesDir)) fail(`Resources not found: ${resourcesDir}`);
if (!existsSync(zigZstd)) fail(`zig-zstd not found: ${zigZstd}`);
if (!existsSync(rcedit)) fail(`rcedit not found: ${rcedit}`);
if (!existsSync(icon)) fail(`icon not found: ${icon}`);

// 找到 .tar.zst 文件（hash 命名的）
const zstFiles = readdirSync(resourcesDir).filter((f) => f.endsWith(".tar.zst"));
if (zstFiles.length === 0) fail(`No .tar.zst found in ${resourcesDir}`);
const zstFile = join(resourcesDir, zstFiles[0]);
console.log(`Found archive: ${zstFiles[0]}`);

// 2. 准备工作目录
console.log("\n=== Step 2: Prepare work directory ===");
if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
if (existsSync(portableDir)) rmSync(portableDir, { recursive: true, force: true });
if (existsSync(portableZip)) rmSync(portableZip);
mkdirSync(workDir, { recursive: true });
console.log("Work dir created.");

// 3. 解压 .zst -> .tar
console.log("\n=== Step 3: Decompress .zst -> .tar ===");
execSync(`"${zigZstd}" decompress -i "${zstFile}" -o "${tarPath}"`, { stdio: "inherit" });
console.log(`Decompressed to: ${tarPath} (${(statSync(tarPath).size / 1024 / 1024).toFixed(2)} MB)`);

// 4. 解压 .tar -> 目录（用系统 tar 命令）
console.log("\n=== Step 4: Extract .tar -> directory ===");
// NOTE: run with cwd + relative filename. GNU tar (first on PATH under Git Bash)
// interprets "C:\..." as a remote host spec ("host:file"); relative paths work
// identically on both GNU tar and Windows bsdtar.
execSync(`tar -xf app.tar`, { stdio: "inherit", cwd: workDir });
if (!existsSync(extractedDir)) fail(`Extraction failed: ${extractedDir} not found`);
console.log(`Extracted to: ${extractedDir}`);

// 5. 嵌入图标：PromptHub.exe（launcher）与 bun.exe（窗口宿主进程，任务栏图标来源）
//    都要嵌入，否则任务栏显示 bun 默认图标
console.log("\n=== Step 5: Embed icons + rename launcher.exe ===");
const binDir = join(extractedDir, "bin");
const launcherExe = join(binDir, "launcher.exe");
const bunExe = join(binDir, "bun.exe");
if (!existsSync(launcherExe)) fail(`launcher.exe not found: ${launcherExe}`);
if (!existsSync(bunExe)) fail(`bun.exe not found: ${bunExe}`);
for (const exe of [launcherExe, bunExe]) {
	const sizeBefore = statSync(exe).size;
	try {
		execSync(`"${rcedit}" "${exe}" --set-icon "${icon}"`, { stdio: "inherit" });
		const sizeAfter = statSync(exe).size;
		console.log(`Icon embedded into ${exe.includes("bun") ? "bun.exe" : "launcher.exe"}: ${sizeBefore} -> ${sizeAfter} bytes`);
	} catch (e) {
		console.error(`Failed to embed icon into ${exe}: ${e}`);
		if (exe === launcherExe) console.log("Continuing without icon (launcher will still work).");
		else console.log("WARNING: bun.exe keeps default icon (taskbar will show bun icon).");
	}
}

// 重命名 launcher.exe -> PromptHub.exe（更专业的命名）
// fs.renameSync + 重试：Windows Defender/索引器可能短暂锁定刚写入的 exe，
// 直接 move 一次失败即终止；重试可覆盖绝大多数瞬时锁。
const finalExePath = join(extractedDir, "bin", appExeName);
renameWithRetry(launcherExe, finalExePath, `rename launcher.exe -> ${appExeName}`);
console.log(`Renamed: launcher.exe -> ${appExeName}`);

// 6. 移动到最终目录
console.log("\n=== Step 6: Move to final portable directory ===");
// 直接重命名 extractedDir -> portableDir
renameWithRetry(extractedDir, portableDir, `move to ${portableDir}`);
console.log(`Portable dir: ${portableDir}`);

// 6.5 写入外置数据目录配置模板。
// 用户把它复制为同目录 config.json 并填 dataDir 即可指定数据存储位置；
// 升级时"覆盖解压"不会删除用户已创建的 config.json（zip 中只含 example 模板）。
const exampleConfigPath = join(portableDir, "bin", "config.example.json");
writeFileSync(exampleConfigPath, JSON.stringify({ dataDir: "D:\\PromptHubData" }, null, 2) + "\n");
console.log(`Config template: ${exampleConfigPath}`);

// 7. 打包 zip
console.log("\n=== Step 7: Create portable zip ===");
execSync(
	`powershell -NoProfile -Command "Compress-Archive -Path '${portableDir}' -DestinationPath '${portableZip}' -CompressionLevel Optimal -Force"`,
	{ stdio: "inherit" },
);

if (existsSync(portableZip)) {
	const sizeMB = (statSync(portableZip).size / 1024 / 1024).toFixed(2);
	console.log(`\nPortable zip: ${portableZip} (${sizeMB} MB)`);
	console.log(`解压后运行: prompt-manage-portable\\bin\\${appExeName}`);
} else {
	fail("Failed to create zip");
}

// 8. 清理临时目录
console.log("\n=== Step 8: Cleanup ===");
if (existsSync(workDir)) {
	rmSync(workDir, { recursive: true, force: true });
	console.log("Work dir cleaned.");
}

console.log("\n=== Done ===");
