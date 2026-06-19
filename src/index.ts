#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { Command } from "commander";
import inquirer from "inquirer";
import pc from "picocolors";

type ChatRole = "user" | "assistant" | "system" | "unknown";

interface ChatMessage {
  role: ChatRole;
  text: string;
}

interface SyncOptions {
  from: string;
  toPaths: string[];
  maxMessages: number;
  outputFormat: OutputFormat;
  metadata: SyncMetadata;
}

interface InitOptions {
  target: string;
}

interface WatchOptions extends SyncOptions {
  intervalSec: number;
}

interface ExportOptions {
  projects: string[];
  out: string;
  format: "json" | "markdown" | "both";
}

interface DoctorOptions {
  projects: string[];
  outputFormat: "text" | "json";
}

interface BootstrapOptions extends SyncOptions {
  doctorOutput: "text" | "json";
}

interface BootstrapConfigFile {
  from?: string;
  to?: string;
  maxMessages?: number;
  output?: OutputFormat;
  taskId?: string;
  services?: string[];
  apiInterfaces?: string[];
  risks?: string[];
  doctorOutput?: "text" | "json";
}

interface ServiceEntry {
  name: string;
  path: string;
  addedAt: string;
}

interface ServiceRegistry {
  version: 1;
  services: ServiceEntry[];
}

type MarkerKind = "transcript" | "worker-log";

type TaskMarker =
  | {
      kind: "transcript";
      filePath: string;
      lineOffset: number;
    }
  | {
      kind: "worker-log";
      filePath: string;
      byteOffset: number;
    };

interface TaskState {
  version: 1;
  taskId: string;
  title: string;
  from: string;
  targets: string[];
  startedAt: string;
  lastSyncedAt?: string;
  marker: TaskMarker;
}

type OutputFormat = "markdown" | "json" | "both";

interface SyncMetadata {
  taskId?: string;
  services: string[];
  apiInterfaces: string[];
  risks: string[];
}

interface SummaryJson {
  generatedAt?: string;
  source?: {
    project?: string;
    type?: string;
    file?: string;
  };
  metadata?: {
    taskId?: string;
    services?: string[];
    apiInterfaces?: string[];
    risks?: string[];
  };
  sections?: {
    goals?: string[];
    decisions?: string[];
    execution?: string[];
    nextSteps?: string[];
  };
}

interface DoctorItem {
  projectPath: string;
  cursorProjectDir: string;
  cursorProjectDirExists: boolean;
  transcriptDir: string;
  transcriptExists: boolean;
  transcriptReadable: boolean;
  transcriptCount: number;
  workerLogFile: string;
  workerLogExists: boolean;
  workerLogReadable: boolean;
  latestSummaryJson: string;
  latestSummaryJsonExists: boolean;
  latestSummaryJsonReadable: boolean;
}

interface SourceSnapshot {
  sourceType: "transcript" | "worker-log";
  sourceFile: string;
  sourceSignature: string;
  messages: ChatMessage[];
}

// ============================================================================
// 输出辅助函数
// ============================================================================

const output = {
  success: (msg: string) => console.log(pc.green("✓"), msg),
  error: (msg: string) => console.error(pc.red("✗"), msg),
  warning: (msg: string) => console.log(pc.yellow("⚠"), msg),
  info: (msg: string) => console.log(pc.blue("ℹ"), msg),
  title: (msg: string) => console.log(pc.bold(pc.cyan(msg))),
  dim: (msg: string) => console.log(pc.dim(msg)),
  section: (label: string, value: string) =>
    console.log(`  ${pc.dim(label)}: ${value}`),
  divider: () => console.log(pc.dim("━".repeat(40))),
};

function printErrorWithRecovery(message: string, suggestions: string[]): void {
  output.error(message);
  if (suggestions.length > 0) {
    console.log(pc.dim("\n💡 建议:"));
    suggestions.forEach((s) => console.log(pc.dim(`  • ${s}`)));
  }
}

function getProjectDisplayName(projectPath: string): string {
  const registry = readServiceRegistry();
  const service = registry.services.find((s) => s.path === projectPath);
  if (service) {
    return service.name;
  }
  return path.basename(projectPath);
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// CLI 定义
// ============================================================================

const program = new Command();

program
  .name("cb")
  .description("ContextBridge CLI - sync Cursor context between local projects")
  .version("1.0.0");

program
  .command("sync")
  .description("Sync latest conversation summary from project A to project B")
  .option("--from <path>", "source project path or service name (default: current directory)")
  .option("--to <paths...>", "target project paths or service names (B/C/...)")
  .option("--max-messages <number>", "max recent messages to summarize", "16")
  .option("--output <format>", "output format: markdown | json | both", "markdown")
  .option("--task-id <id>", "task id for cross-project tracking")
  .option("--service <name...>", "related service names")
  .option("--api <name...>", "related API or topic names")
  .option("--risk <text...>", "known risks")
  .action(
    (opts: {
      from?: string;
      to?: string[];
      maxMessages: string;
      output: string;
      taskId?: string;
      service?: string[];
      api?: string[];
      risk?: string[];
    }) => {
      // 自动检测源项目：优先级 from参数 > 活跃任务 > 当前目录
      const activeTask = readCurrentTask();
      let fromPath: string;

      if (opts.from) {
        fromPath = resolveProjectPath(opts.from);
      } else if (activeTask) {
        fromPath = activeTask.from;
      } else {
        fromPath = process.cwd();
      }

      const normalized: SyncOptions = {
        from: fromPath,
        toPaths: (opts.to ?? []).map((p) => resolveProjectPath(p)),
        maxMessages: normalizeMaxMessages(opts.maxMessages),
        outputFormat: normalizeOutputFormat(opts.output),
        metadata: normalizeMetadata({
          taskId: opts.taskId,
          services: opts.service,
          apiInterfaces: opts.api,
          risks: opts.risk,
        }),
      };

      runSync(normalized);
    },
  );

program
  .command("watch")
  .description("Watch source project and auto-sync summary to target project")
  .option("--from <path>", "source project path or service name (default: current directory or task source)")
  .option("--to <paths...>", "target project paths or service names (default: task targets)")
  .option("--max-messages <number>", "max recent messages to summarize", "16")
  .option("--interval <seconds>", "watch interval seconds", "20")
  .option("--output <format>", "output format: markdown | json | both", "markdown")
  .option("--task-id <id>", "task id for cross-project tracking")
  .option("--service <name...>", "related service names")
  .option("--api <name...>", "related API or topic names")
  .option("--risk <text...>", "known risks")
  .action(
    (opts: {
      from?: string;
      to?: string[];
      maxMessages: string;
      interval: string;
      output: string;
      taskId?: string;
      service?: string[];
      api?: string[];
      risk?: string[];
    }) => {
      // 自动检测源项目：优先级 from参数 > 活跃任务 > 当前目录
      const activeTask = readCurrentTask();
      let fromPath: string;

      if (opts.from) {
        fromPath = resolveProjectPath(opts.from);
      } else if (activeTask) {
        fromPath = activeTask.from;
      } else {
        fromPath = process.cwd();
      }

      const normalized: WatchOptions = {
        from: fromPath,
        toPaths: (opts.to ?? []).map((p) => resolveProjectPath(p)),
        maxMessages: normalizeMaxMessages(opts.maxMessages),
        intervalSec: normalizeInterval(opts.interval),
        outputFormat: normalizeOutputFormat(opts.output),
        metadata: normalizeMetadata({
          taskId: opts.taskId,
          services: opts.service,
          apiInterfaces: opts.api,
          risks: opts.risk,
        }),
      };

      runWatch(normalized);
    },
  );

program
  .command("init")
  .description("Initialize ContextBridge files in target project")
  .requiredOption("--target <path>", "target project path or service name")
  .action((opts: { target: string }) => {
    const normalized: InitOptions = {
      target: resolveProjectPath(opts.target),
    };
    runInit(normalized);
  });

program
  .command("export")
  .description("Export latest summaries from multiple projects")
  .requiredOption("--projects <paths...>", "project paths or service names to aggregate")
  .requiredOption("--out <path>", "output file path without extension")
  .option("--format <format>", "output format: json | markdown | both", "both")
  .action(
    (opts: {
      projects: string[];
      out: string;
      format: string;
    }) => {
      const normalized: ExportOptions = {
        projects: opts.projects.map((p) => resolveProjectPath(p)),
        out: resolveProjectPath(opts.out),
        format: normalizeExportFormat(opts.format),
      };
      runExport(normalized);
    },
  );

program
  .command("doctor")
  .description("Diagnose local Cursor context availability")
  .requiredOption("--projects <paths...>", "project paths or service names to check")
  .option("--output <format>", "output format: text | json", "text")
  .action(
    (opts: {
      projects: string[];
      output: string;
    }) => {
      const normalized: DoctorOptions = {
        projects: opts.projects.map((p) => resolveProjectPath(p)),
        outputFormat: normalizeDoctorOutput(opts.output),
      };
      runDoctor(normalized);
    },
  );

program
  .command("bootstrap")
  .description("Run init + sync + doctor in one command")
  .option("--config <path>", "bootstrap config file path (JSON)")
  .option("--from <path>", "source project path or service name (A)")
  .option("--to <path>", "target project path or service name (B)")
  .option("--max-messages <number>", "max recent messages to summarize")
  .option("--output <format>", "output format: markdown | json | both")
  .option("--task-id <id>", "task id for cross-project tracking")
  .option("--service <name...>", "related service names")
  .option("--api <name...>", "related API or topic names")
  .option("--risk <text...>", "known risks")
  .option("--doctor-output <format>", "doctor output: text | json")
  .action(
    (opts: {
      config?: string;
      from?: string;
      to?: string;
      maxMessages?: string;
      output?: string;
      taskId?: string;
      service?: string[];
      api?: string[];
      risk?: string[];
      doctorOutput?: string;
    }) => {
      const config = opts.config
        ? loadBootstrapConfig(resolvePath(opts.config))
        : {};

      const fromPath = resolveRequiredProjectPath(opts.from ?? config.from, "--from");
      const toPath = resolveRequiredProjectPath(opts.to ?? config.to, "--to");
      const maxMessages = normalizeMaxMessages(
        opts.maxMessages ?? String(config.maxMessages ?? 16),
      );
      const outputFormat = normalizeOutputFormat(
        opts.output ?? config.output ?? "both",
      );
      const doctorOutput = normalizeDoctorOutput(
        opts.doctorOutput ?? config.doctorOutput ?? "text",
      );

      const normalized: BootstrapOptions = {
        from: fromPath,
        toPaths: [toPath],
        maxMessages,
        outputFormat,
        metadata: normalizeMetadata({
          taskId: opts.taskId ?? config.taskId,
          services: opts.service ?? config.services,
          apiInterfaces: opts.api ?? config.apiInterfaces,
          risks: opts.risk ?? config.risks,
        }),
        doctorOutput,
      };
      runBootstrap(normalized);
    },
  );

program
  .command("services-import")
  .description("Register all first-level project folders as services")
  .requiredOption("--root <path>", "root directory, e.g. C:/Users/name/IdeaProjects")
  .option("--dry-run", "preview without writing registry", false)
  .action((opts: { root: string; dryRun?: boolean }) => {
    runServicesImport({
      root: resolvePath(opts.root),
      dryRun: Boolean(opts.dryRun),
    });
  });

program
  .command("services-list")
  .description("List registered services")
  .action(() => {
    runServicesList();
  });

program
  .command("task-start")
  .description("Start a task and set incremental sync marker")
  .requiredOption("--from <path>", "source project path or service name (A)")
  .option("--to <paths...>", "default target project paths or service names for this task")
  .requiredOption("--title <text>", "task title")
  .option("--task-id <id>", "task id; auto-generated if omitted")
  .action((opts: { from: string; to?: string[]; title: string; taskId?: string }) => {
    runTaskStart({
      from: resolveProjectPath(opts.from),
      targets: (opts.to ?? []).map((p) => resolveProjectPath(p)),
      title: opts.title,
      taskId: opts.taskId,
    });
  });

program
  .command("task-stop")
  .description("Stop current active task")
  .action(() => {
    runTaskStop();
  });

program
  .command("task-status")
  .description("Show current active task status")
  .action(() => {
    runTaskStatus();
  });

program
  .command("quickstart")
  .description("Interactive guide to set up ContextBridge for new users")
  .action(async () => {
    await runQuickstart();
  });

program.parse();

function runSync(options: SyncOptions): void {
  try {
    ensureDirectory(options.from, "source project");
  } catch (error) {
    if (error instanceof Error) {
      printErrorWithRecovery(error.message, [
        "检查路径是否正确",
        "运行 `cb services-list` 查看已登记的服务",
        "运行 `cb services-import --root <目录>` 登记新服务",
      ]);
      process.exit(1);
    }
    throw error;
  }

  const normalizedFrom = normalizeWorkspacePath(options.from);
  const activeTask = readCurrentTask();
  const effectiveTargets = resolveSyncTargets(options.toPaths, activeTask, options.from);

  try {
    for (const target of effectiveTargets) {
      ensureDirectory(target, "target project");
    }
  } catch (error) {
    if (error instanceof Error) {
      printErrorWithRecovery(error.message, [
        "检查路径是否正确",
        "运行 `cb services-list` 查看已登记的服务",
        "运行 `cb services-import --root <目录>` 登记新服务",
      ]);
      process.exit(1);
    }
    throw error;
  }

  const effectiveMetadata: SyncMetadata = {
    ...options.metadata,
    taskId: options.metadata.taskId ?? activeTask?.taskId,
  };

  let snapshot: SourceSnapshot;
  if (activeTask && activeTask.from === normalizedFrom) {
    const incremental = loadSourceSnapshotByMarker(
      options.from,
      options.maxMessages,
      activeTask.marker,
    );
    if (incremental.messages.length === 0) {
      console.log(`No new messages since marker for task ${activeTask.taskId}.`);
      return;
    }
    snapshot = {
      sourceType: incremental.marker.kind,
      sourceFile: incremental.marker.filePath,
      sourceSignature: `${incremental.marker.kind}:${incremental.marker.filePath}`,
      messages: incremental.messages,
    };
    activeTask.marker = incremental.marker;
    activeTask.lastSyncedAt = new Date().toISOString();
    writeCurrentTask(activeTask);
  } else {
    try {
      snapshot = loadSourceSnapshot(options.from, options.maxMessages);
    } catch (error) {
      if (error instanceof Error && error.message.includes("No readable source found")) {
        printErrorWithRecovery("无法读取 Cursor 会话数据", [
          "确保已在 Cursor 中打开源项目",
          "进行至少一次对话",
          "运行 `cb doctor` 检查环境",
        ]);
        process.exit(1);
      }
      throw error;
    }
  }

  const result = writeSummaryFiles({
    sourceProject: options.from,
    targetProject: effectiveTargets[0],
    snapshot,
    maxMessages: options.maxMessages,
    outputFormat: options.outputFormat,
    metadata: effectiveMetadata,
  });

  const messageCount = snapshot.messages.length;

  console.log("");
  output.success("同步完成");
  console.log("");
  output.title("📄 摘要信息");
  output.section("源项目", getProjectDisplayName(options.from));
  output.section("数据来源", snapshot.sourceType);
  output.section("消息数", `${messageCount} 条`);

  console.log("");
  output.title("📁 生成文件");
  for (const target of effectiveTargets) {
    const targetResult =
      target === effectiveTargets[0]
        ? result
        : writeSummaryFiles({
            sourceProject: options.from,
            targetProject: target,
            snapshot,
            maxMessages: options.maxMessages,
            outputFormat: options.outputFormat,
            metadata: effectiveMetadata,
          });
    for (const filePath of targetResult.generatedPaths) {
      const relativePath = filePath.replace(target, getProjectDisplayName(target));
      console.log(`  ${relativePath}`);
    }
  }

  console.log("");
  output.title("💡 下一步");
  console.log(`  在目标项目 Cursor 中打开 ${pc.dim(".contextbridge/context-summary-latest.md")}`);
}

function runWatch(options: WatchOptions): void {
  try {
    ensureDirectory(options.from, "source project");
  } catch (error) {
    if (error instanceof Error) {
      printErrorWithRecovery(error.message, [
        "检查路径是否正确",
        "运行 `cb services-list` 查看已登记的服务",
        "运行 `cb services-import --root <目录>` 登记新服务",
      ]);
      process.exit(1);
    }
    throw error;
  }

  const normalizedFrom = normalizeWorkspacePath(options.from);
  const activeTask = readCurrentTask();
  const effectiveTargets = resolveSyncTargets(options.toPaths, activeTask, options.from);

  try {
    for (const target of effectiveTargets) {
      ensureDirectory(target, "target project");
    }
  } catch (error) {
    if (error instanceof Error) {
      printErrorWithRecovery(error.message, [
        "检查路径是否正确",
        "运行 `cb services-list` 查看已登记的服务",
        "运行 `cb services-import --root <目录>` 登记新服务",
      ]);
      process.exit(1);
    }
    throw error;
  }

  console.log("");
  output.title(`👀 监听中 (每 ${options.intervalSec} 秒检查一次)`);
  output.divider();
  output.section("源项目", getProjectDisplayName(options.from));
  output.section("目标项目", effectiveTargets.map((p) => getProjectDisplayName(p)).join(", "));
  console.log("");

  let previousSignature = "";

  const tick = (): void => {
    try {
      const activeTask = readCurrentTask();
      const effectiveMetadata: SyncMetadata = {
        ...options.metadata,
        taskId: options.metadata.taskId ?? activeTask?.taskId,
      };

      let snapshot: SourceSnapshot;
      if (activeTask && activeTask.from === normalizedFrom) {
        const incremental = loadSourceSnapshotByMarker(
          options.from,
          options.maxMessages,
          activeTask.marker,
        );
        if (incremental.messages.length === 0) {
          console.log(`[${new Date().toLocaleTimeString()}] ${pc.dim("ℹ 无变化")}`);
          return;
        }
        snapshot = {
          sourceType: incremental.marker.kind,
          sourceFile: incremental.marker.filePath,
          sourceSignature: `${incremental.marker.kind}:${incremental.marker.filePath}:${Date.now()}`,
          messages: incremental.messages,
        };
        activeTask.marker = incremental.marker;
        activeTask.lastSyncedAt = new Date().toISOString();
        writeCurrentTask(activeTask);
      } else {
        snapshot = loadSourceSnapshot(options.from, options.maxMessages);
        if (snapshot.sourceSignature === previousSignature) {
          console.log(`[${new Date().toLocaleTimeString()}] ${pc.dim("ℹ 无变化")}`);
          return;
        }
      }

      const outputs: string[] = [];
      for (const target of effectiveTargets) {
        const result = writeSummaryFiles({
          sourceProject: options.from,
          targetProject: target,
          snapshot,
          maxMessages: options.maxMessages,
          outputFormat: options.outputFormat,
          metadata: effectiveMetadata,
        });
        outputs.push(...result.generatedPaths);
      }
      previousSignature = snapshot.sourceSignature;

      const msgCount = snapshot.messages.length;
      console.log(
        `[${new Date().toLocaleTimeString()}] ${pc.green("✓")} 已同步 (${msgCount} 条消息)`
      );
      for (const filePath of outputs) {
        const shortPath = filePath.split(path.sep).slice(-3).join(path.sep);
        console.log(`  ${pc.dim("→")} ${shortPath}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error(
        `[${new Date().toLocaleTimeString()}] ${pc.red("✗")} 同步失败: ${message}`
      );
    }
  };

  tick();
  setInterval(tick, options.intervalSec * 1000);
}

function runInit(options: InitOptions): void {
  ensureDirectory(options.target, "target project");

  const outDir = path.join(options.target, ".contextbridge");
  fs.mkdirSync(outDir, { recursive: true });

  const entryPath = path.join(outDir, "context-entry.md");
  const latestPath = path.join(outDir, "context-summary-latest.md");
  const latestJsonPath = path.join(outDir, "context-summary-latest.json");

  const content = [
    "# ContextBridge 入口文件",
    "",
    "此文件用于在 Cursor 新会话中快速引用跨项目上下文。",
    "",
    "## 推荐使用方式",
    "1. 在 Cursor 对话中先打开 `context-summary-latest.md`。",
    "2. 用下面的提示词开场：",
    "",
    "```text",
    "继续上一个跨服务任务，请先读取 .contextbridge/context-summary-latest.md，",
    "按其中的目标、关键决策、执行记录继续推进，并补充当前项目的实现步骤。",
    "```",
    "",
    "## 文件说明",
    "- `context-summary-latest.md`: 最近一次同步结果。",
    "- `context-summary-latest.json`: 结构化摘要，适合脚本二次处理。",
    "- `context-summary-YYYYMMDD-HHmmss.md`: 历史快照归档。",
    "- `context-summary-YYYYMMDD-HHmmss.json`: 结构化历史归档。",
    "",
  ].join("\n");

  if (!fs.existsSync(latestPath)) {
    fs.writeFileSync(
      latestPath,
      "# ContextBridge 同步摘要\n\n- 暂无内容，请先执行 cb sync。\n",
      "utf8",
    );
  }
  if (!fs.existsSync(latestJsonPath)) {
    const initial = {
      generatedAt: new Date().toISOString(),
      note: "暂无内容，请先执行 cb sync。",
    };
    fs.writeFileSync(latestJsonPath, JSON.stringify(initial, null, 2), "utf8");
  }
  fs.writeFileSync(entryPath, content, "utf8");

  console.log("Init completed.");
  console.log(`Context directory: ${outDir}`);
  console.log(`Entry file: ${entryPath}`);
}

function runExport(options: ExportOptions): void {
  const items = options.projects.map((projectPath) => {
    const latestJsonPath = path.join(
      projectPath,
      ".contextbridge",
      "context-summary-latest.json",
    );
    let parsed: SummaryJson | null = null;
    if (fs.existsSync(latestJsonPath)) {
      try {
        const raw = fs.readFileSync(latestJsonPath, "utf8");
        parsed = JSON.parse(raw) as SummaryJson;
      } catch {
        parsed = null;
      }
    }
    return {
      projectPath,
      summaryPath: latestJsonPath,
      exists: fs.existsSync(latestJsonPath),
      summary: parsed,
    };
  });

  const exportData = {
    generatedAt: new Date().toISOString(),
    projectCount: options.projects.length,
    includedCount: items.filter((it) => it.exists && it.summary).length,
    items: items.map((it) => ({
      projectPath: it.projectPath,
      summaryPath: it.summaryPath,
      exists: it.exists,
      summary: it.summary,
    })),
  };

  const outputDir = path.dirname(options.out);
  fs.mkdirSync(outputDir, { recursive: true });

  const generatedPaths: string[] = [];

  if (options.format === "json" || options.format === "both") {
    const jsonPath = `${options.out}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2), "utf8");
    generatedPaths.push(jsonPath);
  }

  if (options.format === "markdown" || options.format === "both") {
    const markdownPath = `${options.out}.md`;
    fs.writeFileSync(markdownPath, buildExportMarkdown(exportData), "utf8");
    generatedPaths.push(markdownPath);
  }

  console.log("Export completed.");
  for (const p of generatedPaths) {
    console.log(`Generated: ${p}`);
  }
}

function runDoctor(options: DoctorOptions): void {
  const items = options.projects.map((projectPath) => inspectProject(projectPath));
  const failed = items.filter(
    (item) =>
      !item.cursorProjectDirExists ||
      (!item.transcriptReadable && !item.workerLogReadable),
  );

  if (options.outputFormat === "json") {
    const payload = {
      generatedAt: new Date().toISOString(),
      projectCount: items.length,
      failedCount: failed.length,
      items,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("");
  output.title("🔍 环境诊断报告");
  output.divider();
  console.log("");

  // 表格输出
  const header = "项目              Cursor    Transcript    Worker Log    Summary";
  console.log(pc.dim(header));
  console.log(pc.dim("─".repeat(55)));

  for (const item of items) {
    const name = getProjectDisplayName(item.projectPath).padEnd(16);
    const cursorStatus = item.cursorProjectDirExists
      ? pc.green("✓")
      : pc.red("✗ 缺失");

    const transcriptStatus = item.transcriptReadable
      ? pc.green(`✓ ${item.transcriptCount} 个`)
      : item.transcriptExists
        ? pc.yellow("✗ 无法读取")
        : pc.red("✗ 缺失");

    const workerLogStatus = item.workerLogReadable
      ? pc.green("✓")
      : item.workerLogExists
        ? pc.yellow("✗ 无法读取")
        : pc.red("✗ 缺失");

    const summaryStatus = item.latestSummaryJsonReadable
      ? pc.green("✓")
      : item.latestSummaryJsonExists
        ? pc.yellow("✗ 无法读取")
        : pc.red("✗ 缺失");

    console.log(`${name}    ${cursorStatus}     ${transcriptStatus}     ${workerLogStatus}     ${summaryStatus}`);
  }

  // 问题汇总
  const problems: { project: string; issue: string; suggestion: string }[] = [];
  for (const item of items) {
    const projectName = getProjectDisplayName(item.projectPath);
    if (!item.cursorProjectDirExists) {
      problems.push({
        project: projectName,
        issue: "Cursor 目录不存在",
        suggestion: "请先在 Cursor 中打开该项目",
      });
    }
    if (!item.transcriptReadable && !item.transcriptExists) {
      problems.push({
        project: projectName,
        issue: "无 transcript 文件",
        suggestion: "请先在 Cursor 中打开该项目并进行对话",
      });
    }
    if (!item.workerLogReadable && !item.workerLogExists) {
      problems.push({
        project: projectName,
        issue: "无 worker.log 文件",
        suggestion: "请先在 Cursor 中使用该项目",
      });
    }
    if (!item.latestSummaryJsonExists) {
      problems.push({
        project: projectName,
        issue: "无摘要文件",
        suggestion: "运行 `cb sync` 生成",
      });
    }
  }

  if (problems.length > 0) {
    console.log("");
    output.warning(`发现 ${problems.length} 个问题:`);
    for (const p of problems) {
      console.log(`  • ${p.project}: ${p.issue}`);
      console.log(pc.dim(`    → ${p.suggestion}`));
    }
  } else {
    console.log("");
    output.success("所有项目环境正常");
  }
  console.log("");
}

function runBootstrap(options: BootstrapOptions): void {
  const bootstrapTargets = options.toPaths;
  if (bootstrapTargets.length === 0) {
    throw new Error("Bootstrap requires at least one target project.");
  }

  console.log("Bootstrap started.");
  console.log("");

  console.log("[1/3] Initializing target project...");
  for (const target of bootstrapTargets) {
    runInit({ target });
  }
  console.log("");

  console.log("[2/3] Syncing context...");
  runSync({
    from: options.from,
    toPaths: options.toPaths,
    maxMessages: options.maxMessages,
    outputFormat: options.outputFormat,
    metadata: options.metadata,
  });
  console.log("");

  console.log("[3/3] Running doctor diagnostics...");
  runDoctor({
    projects: [options.from, ...bootstrapTargets],
    outputFormat: options.doctorOutput,
  });
  console.log("");

  console.log("Bootstrap completed.");
}

function runServicesImport(options: { root: string; dryRun: boolean }): void {
  ensureDirectory(options.root, "services root");

  const entries = fs
    .readdirSync(options.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(options.root, entry.name),
      addedAt: new Date().toISOString(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const registry = readServiceRegistry();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of entries) {
    const byNameIndex = registry.services.findIndex((s) => s.name === item.name);
    const samePathExists = registry.services.some((s) => s.path === item.path);

    if (byNameIndex >= 0) {
      if (registry.services[byNameIndex].path === item.path) {
        skipped += 1;
      } else {
        registry.services[byNameIndex] = item;
        updated += 1;
      }
      continue;
    }

    if (samePathExists) {
      skipped += 1;
      continue;
    }

    registry.services.push(item);
    added += 1;
  }

  registry.services.sort((a, b) => a.name.localeCompare(b.name));

  if (!options.dryRun) {
    writeServiceRegistry(registry);
  }

  console.log(options.dryRun ? "Services import preview completed." : "Services import completed.");
  console.log(`Root: ${options.root}`);
  console.log(`Detected folders: ${entries.length}`);
  console.log(`Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
  console.log(`Registry: ${resolveServiceRegistryPath()}`);
}

function runServicesList(): void {
  const registry = readServiceRegistry();
  if (registry.services.length === 0) {
    console.log("No registered services.");
    console.log(`Registry: ${resolveServiceRegistryPath()}`);
    return;
  }

  console.log(`Registered services (${registry.services.length}):`);
  for (const svc of registry.services) {
    console.log(`- ${svc.name}: ${svc.path}`);
  }
}

function runTaskStart(options: {
  from: string;
  targets: string[];
  title: string;
  taskId?: string;
}): void {
  ensureDirectory(options.from, "source project");
  const normalizedFrom = normalizeWorkspacePath(options.from);
  const normalizedTargets = options.targets.map((p) => normalizeWorkspacePath(p));
  for (const target of normalizedTargets) {
    ensureDirectory(target, "target project");
  }
  const marker = createTaskMarker(normalizedFrom);
  const task: TaskState = {
    version: 1,
    taskId: options.taskId?.trim() || generateTaskId(),
    title: options.title.trim(),
    from: normalizedFrom,
    targets: dedupeLines(normalizedTargets),
    startedAt: new Date().toISOString(),
    marker,
  };

  writeCurrentTask(task);

  console.log("Task started.");
  console.log(`Task ID: ${task.taskId}`);
  console.log(`Title: ${task.title}`);
  console.log(`From: ${task.from}`);
  if (task.targets.length > 0) {
    console.log(`Targets: ${task.targets.join(", ")}`);
  }
  console.log(`Marker: ${task.marker.kind} ${task.marker.filePath}`);
}

function runTaskStop(): void {
  const task = readCurrentTask();
  if (!task) {
    console.log("No active task.");
    return;
  }

  archiveTask(task);
  clearCurrentTask();

  console.log("Task stopped.");
  console.log(`Task ID: ${task.taskId}`);
}

function runTaskStatus(): void {
  const task = readCurrentTask();
  if (!task) {
    output.info("当前无活跃任务");
    return;
  }

  console.log("");
  output.title("📋 当前任务");
  output.divider();
  output.section("任务 ID", task.taskId);
  output.section("标题", task.title);
  output.section("源项目", getProjectDisplayName(task.from));
  if (task.targets.length > 0) {
    output.section("目标项目", task.targets.map((p) => getProjectDisplayName(p)).join(", "));
  }
  output.section("开始时间", formatTimestamp(task.startedAt));
  if (task.lastSyncedAt) {
    output.section("最后同步", formatTimestamp(task.lastSyncedAt));
  }

  console.log("");
  output.title("📌 锚点位置");
  if (task.marker.kind === "transcript") {
    output.section("类型", "transcript");
    output.section("行号", `@line ${task.marker.lineOffset}`);
    const shortFile = task.marker.filePath.split(path.sep).slice(-2).join(path.sep);
    output.section("文件", shortFile);
  } else {
    output.section("类型", "worker-log");
    output.section("字节偏移", `@byte ${task.marker.byteOffset}`);
    const shortFile = task.marker.filePath.split(path.sep).slice(-2).join(path.sep);
    output.section("文件", shortFile);
  }
  console.log("");
}

async function runQuickstart(): Promise<void> {
  console.log("");
  output.title("✨ 欢迎使用 ContextBridge CLI");
  output.divider();
  console.log("");

  // 获取已注册的服务列表
  const registry = readServiceRegistry();
  const hasServices = registry.services.length > 0;

  // 1. 选择源项目
  const sourceChoices: { name: string; value: string }[] = hasServices
    ? registry.services.map((s) => ({ name: s.name, value: s.path }))
    : [];

  sourceChoices.push({ name: "手动输入路径...", value: "__manual__" });

  const sourceAnswer = await inquirer.prompt<{
    source: string;
  }>([
    {
      type: "list",
      name: "source",
      message: "选择源项目 (使用 Cursor 对话的项目):",
      choices: sourceChoices,
      pageSize: 10,
    },
  ]);

  let fromPath: string;
  if (sourceAnswer.source === "__manual__") {
    const manualAnswer = await inquirer.prompt<{
      path: string;
    }>([
      {
        type: "input",
        name: "path",
        message: "输入源项目路径:",
        validate: (input: string) => {
          if (!input.trim()) return "请输入路径";
          const resolved = resolvePath(input.trim());
          if (!fs.existsSync(resolved)) return `路径不存在: ${resolved}`;
          if (!fs.statSync(resolved).isDirectory()) return "路径不是目录";
          return true;
        },
      },
    ]);
    fromPath = resolvePath(manualAnswer.path);
  } else {
    fromPath = sourceAnswer.source;
  }

  // 2. 选择目标项目
  const targetChoices: { name: string; value: string }[] = hasServices
    ? registry.services
        .filter((s) => s.path !== fromPath)
        .map((s) => ({ name: s.name, value: s.path }))
    : [];

  targetChoices.push({ name: "手动输入路径...", value: "__manual__" });

  const targetAnswer = await inquirer.prompt<{
    targets: string[];
  }>([
    {
      type: "checkbox",
      name: "targets",
      message: "选择目标项目 (将同步上下文到此项目):",
      choices: targetChoices,
      pageSize: 10,
      validate: (input: string[]) => {
        if (input.length === 0) return "请至少选择一个目标项目";
        return true;
      },
    },
  ]);

  const toPaths: string[] = [];
  for (const target of targetAnswer.targets) {
    if (target === "__manual__") {
      const manualAnswer = await inquirer.prompt<{
        path: string;
      }>([
        {
          type: "input",
          name: "path",
          message: "输入目标项目路径:",
          validate: (input: string) => {
            if (!input.trim()) return "请输入路径";
            const resolved = resolvePath(input.trim());
            if (!fs.existsSync(resolved)) return `路径不存在: ${resolved}`;
            if (!fs.statSync(resolved).isDirectory()) return "路径不是目录";
            return true;
          },
        },
      ]);
      toPaths.push(resolvePath(manualAnswer.path));
    } else {
      toPaths.push(target);
    }
  }

  // 3. 可选：任务 ID
  const taskIdAnswer = await inquirer.prompt<{
    taskId: string;
  }>([
    {
      type: "input",
      name: "taskId",
      message: "任务 ID (可选，用于追踪):",
      default: "",
    },
  ]);

  // 4. 可选：关联服务
  const servicesAnswer = await inquirer.prompt<{
    services: string;
  }>([
    {
      type: "input",
      name: "services",
      message: "关联服务 (可选，多个用逗号分隔):",
      default: "",
    },
  ]);

  // 5. 可选：关联接口
  const apisAnswer = await inquirer.prompt<{
    apis: string;
  }>([
    {
      type: "input",
      name: "apis",
      message: "关联接口 (可选，多个用逗号分隔):",
      default: "",
    },
  ]);

  // 6. 可选：已知风险
  const risksAnswer = await inquirer.prompt<{
    risks: string;
  }>([
    {
      type: "input",
      name: "risks",
      message: "已知风险 (可选):",
      default: "",
    },
  ]);

  // 解析可选参数
  const taskId = taskIdAnswer.taskId.trim() || undefined;
  const services = servicesAnswer.services
    ? servicesAnswer.services
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const apis = apisAnswer.apis
    ? apisAnswer.apis
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const risks = risksAnswer.risks
    ? risksAnswer.risks
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // 开始执行
  console.log("");
  output.title("🚀 正在初始化...");
  output.divider();
  console.log("");

  try {
    // 初始化目标项目
    for (const target of toPaths) {
      runInit({ target });
    }
    output.success("已初始化目标项目");

    // 同步上下文
    const metadata: SyncMetadata = {
      taskId,
      services,
      apiInterfaces: apis,
      risks,
    };

    const syncOptions: SyncOptions = {
      from: fromPath,
      toPaths,
      maxMessages: 16,
      outputFormat: "both",
      metadata,
    };

    // 获取消息数量
    const snapshot = loadSourceSnapshot(fromPath, 16);
    const messageCount = snapshot.messages.length;

    runSync(syncOptions);
    output.success(`已同步上下文 (${messageCount} 条消息)`);

    // 运行诊断
    runDoctor({
      projects: [fromPath, ...toPaths],
      outputFormat: "text",
    });

    // 输出总结
    console.log("");
    output.title("📄 摘要信息");
    output.section("源项目", getProjectDisplayName(fromPath));
    output.section("消息数", `${messageCount} 条`);
    output.section("目标项目", toPaths.map((p) => getProjectDisplayName(p)).join(", "));

    console.log("");
    output.title("📁 生成文件");
    for (const target of toPaths) {
      const mdPath = path.join(target, ".contextbridge", "context-summary-latest.md");
      const jsonPath = path.join(target, ".contextbridge", "context-summary-latest.json");
      console.log(`  ${getProjectDisplayName(target)}/.contextbridge/context-summary-latest.md`);
      console.log(`  ${getProjectDisplayName(target)}/.contextbridge/context-summary-latest.json`);
    }

    console.log("");
    output.title("💡 下一步");
    console.log("  在目标项目 Cursor 中打开:");
    console.log(pc.dim("    .contextbridge/context-summary-latest.md"));
    console.log("");
    console.log("  使用以下提示词开始:");
    console.log(
      pc.dim(
        '    "继续上一个跨服务任务，请先读取 .contextbridge/context-summary-latest.md..."'
      )
    );
    console.log("");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    printErrorWithRecovery(message, []);
    process.exit(1);
  }
}

function loadSourceSnapshot(projectPath: string, maxMessages: number): SourceSnapshot {
  const transcriptDir = resolveTranscriptDir(projectPath);
  const latestTranscript = pickLatestTranscriptFile(transcriptDir);
  if (latestTranscript) {
    const transcriptMessages = parseTranscript(latestTranscript);
    if (transcriptMessages.length > 0) {
      const stat = fs.statSync(latestTranscript);
      return {
        sourceType: "transcript",
        sourceFile: latestTranscript,
        sourceSignature: `${latestTranscript}:${stat.size}:${stat.mtimeMs}`,
        messages: transcriptMessages,
      };
    }
  }

  const workerLogFile = resolveWorkerLogFile(projectPath);
  if (workerLogFile && fs.existsSync(workerLogFile)) {
    const workerMessages = parseWorkerLog(workerLogFile, maxMessages * 3);
    if (workerMessages.length > 0) {
      const stat = fs.statSync(workerLogFile);
      return {
        sourceType: "worker-log",
        sourceFile: workerLogFile,
        sourceSignature: `${workerLogFile}:${stat.size}:${stat.mtimeMs}`,
        messages: workerMessages,
      };
    }
  }

  throw new Error(
    `No readable source found. Tried transcript dir: ${transcriptDir}, worker log: ${workerLogFile ?? "N/A"}`,
  );
}

function loadSourceSnapshotByMarker(
  projectPath: string,
  maxMessages: number,
  marker: TaskMarker,
): { messages: ChatMessage[]; marker: TaskMarker } {
  if (marker.kind === "transcript") {
    const next = loadTranscriptIncremental(projectPath, marker);
    return {
      messages: next.messages.slice(-Math.max(maxMessages * 4, maxMessages)),
      marker: next.marker,
    };
  }

  const next = loadWorkerLogIncremental(projectPath, marker);
  return {
    messages: next.messages.slice(-Math.max(maxMessages * 4, maxMessages)),
    marker: next.marker,
  };
}

function loadTranscriptIncremental(
  projectPath: string,
  marker: Extract<TaskMarker, { kind: "transcript" }>,
): { messages: ChatMessage[]; marker: TaskMarker } {
  const transcriptDir = resolveTranscriptDir(projectPath);
  if (!fs.existsSync(transcriptDir) || !fs.statSync(transcriptDir).isDirectory()) {
    return { messages: [], marker };
  }

  const files = fs
    .readdirSync(transcriptDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(transcriptDir, name))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);

  if (files.length === 0) {
    return { messages: [], marker };
  }

  let startIndex = files.findIndex(
    (filePath) => normalizeWorkspacePath(filePath) === normalizeWorkspacePath(marker.filePath),
  );

  if (startIndex < 0) {
    const refreshed = createTaskMarker(normalizeWorkspacePath(projectPath));
    return { messages: [], marker: refreshed };
  }

  const allMessages: ChatMessage[] = [];
  let nextMarker: TaskMarker = marker;
  for (let i = startIndex; i < files.length; i += 1) {
    const filePath = files[i];
    const rawLines = readRawLines(filePath);
    const startLine = i === startIndex ? marker.lineOffset : 0;
    const newLines = rawLines.slice(Math.max(startLine, 0));
    allMessages.push(...parseTranscriptLines(newLines));
    nextMarker = {
      kind: "transcript",
      filePath,
      lineOffset: rawLines.length,
    };
  }

  return { messages: allMessages, marker: nextMarker };
}

function loadWorkerLogIncremental(
  projectPath: string,
  marker: Extract<TaskMarker, { kind: "worker-log" }>,
): { messages: ChatMessage[]; marker: TaskMarker } {
  const workerLogFile = resolveWorkerLogFile(projectPath);
  if (!fs.existsSync(workerLogFile) || !fs.statSync(workerLogFile).isFile()) {
    return { messages: [], marker };
  }

  const stat = fs.statSync(workerLogFile);
  const currentSize = stat.size;
  const safeOffset = Math.max(0, Math.min(marker.byteOffset, currentSize));
  if (currentSize <= safeOffset) {
    return {
      messages: [],
      marker: {
        kind: "worker-log",
        filePath: workerLogFile,
        byteOffset: currentSize,
      },
    };
  }

  const buffer = fs.readFileSync(workerLogFile);
  const chunk = buffer.subarray(safeOffset).toString("utf8");
  const messages = parseWorkerLogContent(chunk);

  return {
    messages,
    marker: {
      kind: "worker-log",
      filePath: workerLogFile,
      byteOffset: currentSize,
    },
  };
}

function createTaskMarker(normalizedProjectPath: string): TaskMarker {
  const transcriptDir = resolveTranscriptDir(normalizedProjectPath);
  const latestTranscript = pickLatestTranscriptFile(transcriptDir);
  if (latestTranscript) {
    const lines = readRawLines(latestTranscript);
    return {
      kind: "transcript",
      filePath: latestTranscript,
      lineOffset: lines.length,
    };
  }

  const workerLogFile = resolveWorkerLogFile(normalizedProjectPath);
  const size =
    fs.existsSync(workerLogFile) && fs.statSync(workerLogFile).isFile()
      ? fs.statSync(workerLogFile).size
      : 0;
  return {
    kind: "worker-log",
    filePath: workerLogFile,
    byteOffset: size,
  };
}

function resolveCursorProjectDir(projectPath: string): string {
  const home = getUserHomeDir();
  const normalized = normalizeWorkspacePath(projectPath);
  const workspaceKey = buildWorkspaceKey(normalized);

  return path.join(home, ".cursor", "projects", workspaceKey);
}

function resolveTranscriptDir(projectPath: string): string {
  return path.join(resolveCursorProjectDir(projectPath), "agent-transcripts");
}

function resolveWorkerLogFile(projectPath: string): string {
  return path.join(resolveCursorProjectDir(projectPath), "worker.log");
}

function normalizeWorkspacePath(inputPath: string): string {
  const absolute = path.resolve(inputPath);
  return absolute.replace(/\\/g, "/");
}

function buildWorkspaceKey(normalizedPath: string): string {
  let p = normalizedPath;

  if (p.length >= 2 && p[1] === ":") {
    p = `${p[0]}${p.slice(2)}`;
  }

  p = p.replace(/^\//, "");
  p = p.replace(/[\\/]+/g, "-");
  p = p.replace(/[^a-zA-Z0-9_-]/g, "-");
  p = p.replace(/-+/g, "-");

  return p;
}

function getUserHomeDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) {
    throw new Error("Cannot resolve user home directory from environment.");
  }
  return home;
}

function pickLatestTranscriptFile(transcriptDir: string): string | null {
  if (!fs.existsSync(transcriptDir) || !fs.statSync(transcriptDir).isDirectory()) {
    return null;
  }

  const entries = fs
    .readdirSync(transcriptDir)
    .filter((name: string) => name.endsWith(".jsonl"))
    .map((name: string) => {
      const full = path.join(transcriptDir, name);
      const stat = fs.statSync(full);
      return { full, mtimeMs: stat.mtimeMs };
    })
    .sort(
      (a: { mtimeMs: number }, b: { mtimeMs: number }) =>
        b.mtimeMs - a.mtimeMs,
    );

  if (entries.length === 0) {
    return null;
  }

  return entries[0].full;
}

function parseTranscript(filePath: string): ChatMessage[] {
  return parseTranscriptLines(readRawLines(filePath));
}

function parseTranscriptLines(lines: string[]): ChatMessage[] {
  const output: ChatMessage[] = [];

  for (const line of lines.filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as unknown;
      const role = detectRole(parsed);
      const text = extractText(parsed).trim();

      if (!text) {
        continue;
      }

      output.push({ role, text: normalizeWhitespace(text) });
    } catch {
      continue;
    }
  }
  return output;
}

function parseWorkerLog(filePath: string, maxLines: number): ChatMessage[] {
  const messages = parseWorkerLogContent(fs.readFileSync(filePath, "utf8"));
  return messages.slice(-Math.max(maxLines, 1));
}

function parseWorkerLogContent(content: string): ChatMessage[] {
  const lines = content.split(/\r?\n/);
  const meaningful: string[] = [];
  for (const line of lines) {
    const parsed = pickWorkerLogLine(line);
    if (parsed) {
      meaningful.push(parsed);
    }
  }
  return meaningful.map((line) => ({ role: "assistant", text: line }));
}

function readRawLines(filePath: string): string[] {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

function pickWorkerLogLine(line: string): string | null {
  const applying = line.match(/Applying change type=(\w+)\s+relativePath=(.+)$/);
  if (applying) {
    return `代码变更: ${applying[1]} ${applying[2]}`;
  }

  const updating = line.match(/Updating files .*changes=(\d+)/);
  if (updating) {
    return `批量更新文件: ${updating[1]} 个`;
  }

  const updated = line.match(/Updated files requestId=.*response=/);
  if (updated) {
    return "文件更新请求已完成";
  }

  if (line.includes("[error]")) {
    const compact = normalizeWhitespace(line.replace(/^.*\[error\]\s*/, ""));
    return compact ? `异常: ${compact}` : "异常: 未知错误";
  }

  if (line.includes("Indexing finished")) {
    return "索引完成";
  }

  return null;
}

function detectRole(value: unknown): ChatRole {
  if (!value || typeof value !== "object") {
    return "unknown";
  }

  const obj = value as Record<string, unknown>;
  const direct = pickRole(obj.role);
  if (direct) {
    return direct;
  }

  if (obj.message && typeof obj.message === "object") {
    const nested = pickRole((obj.message as Record<string, unknown>).role);
    if (nested) {
      return nested;
    }
  }

  return "unknown";
}

function pickRole(input: unknown): ChatRole | null {
  if (typeof input !== "string") {
    return null;
  }

  const lowered = input.toLowerCase();
  if (
    lowered === "user" ||
    lowered === "assistant" ||
    lowered === "system"
  ) {
    return lowered;
  }
  return "unknown";
}

function extractText(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).join(" ");
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const prioritizedKeys = [
      "text",
      "content",
      "message",
      "prompt",
      "response",
      "output",
      "input",
    ];

    const pieces: string[] = [];
    for (const key of prioritizedKeys) {
      if (key in obj) {
        pieces.push(extractText(obj[key]));
      }
    }

    if (pieces.length > 0) {
      return pieces.join(" ");
    }

    return Object.values(obj)
      .map((v) => extractText(v))
      .join(" ");
  }

  return "";
}

function buildSummary(input: {
  sourceProject: string;
  sourceFile: string;
  sourceType: "transcript" | "worker-log";
  allMessages: ChatMessage[];
  maxMessages: number;
  metadata: SyncMetadata;
}): string {
  const recent = input.allMessages.slice(-Math.max(input.maxMessages, 1));
  const users = dedupeLines(
    recent.filter((m) => m.role === "user").map((m) => pickFirstLine(m.text)),
  );
  const assistants = dedupeLines(
    recent
      .filter((m) => m.role === "assistant")
      .map((m) => pickFirstLine(m.text)),
  );

  const userSection = toBulletLines(users, 5);
  const assistantSection = toBulletLines(assistants, 5);
  const decisionSection = toBulletLines(assistants, 3);
  const nextStepSection = buildNextSteps(users, assistants);
  const metadataSection = buildMetadataLines(input.metadata);

  return [
    "# ContextBridge 同步摘要",
    "",
    `- 同步时间: ${new Date().toLocaleString()}`,
    `- 源项目: \`${input.sourceProject}\``,
    `- 数据来源: \`${input.sourceType}\``,
    `- 源文件: \`${input.sourceFile}\``,
    ...metadataSection,
    "",
    ...(users.length > 0
      ? [
          "## 任务目标",
          userSection,
          "",
          "## 关键决策",
          decisionSection,
          "",
          "## 执行记录",
          assistantSection,
        ]
      : ["## 执行记录", assistantSection]),
    "",
    "## 下一步建议",
    nextStepSection,
    "",
    "## 使用建议",
    "- 在 Cursor 中打开本文件，并在新会话开头引用其中要点。",
    "- 对当前任务补充任务 ID、接口名、验收标准后再继续协作。",
    "",
  ].join("\n");
}

function buildJsonSummary(input: {
  sourceProject: string;
  sourceFile: string;
  sourceType: "transcript" | "worker-log";
  allMessages: ChatMessage[];
  maxMessages: number;
  metadata: SyncMetadata;
}): Record<string, unknown> {
  const recent = input.allMessages.slice(-Math.max(input.maxMessages, 1));
  const users = dedupeLines(
    recent.filter((m) => m.role === "user").map((m) => pickFirstLine(m.text)),
  );
  const assistants = dedupeLines(
    recent
      .filter((m) => m.role === "assistant")
      .map((m) => pickFirstLine(m.text)),
  );

  return {
    generatedAt: new Date().toISOString(),
    source: {
      project: input.sourceProject,
      type: input.sourceType,
      file: input.sourceFile,
    },
    metadata: input.metadata,
    sections: {
      goals: users.slice(-5),
      decisions: assistants.slice(-3),
      execution: assistants.slice(-5),
      nextSteps: buildNextSteps(users, assistants)
        .split("\n")
        .map((line) => line.replace(/^- /, "")),
    },
  };
}

function toBulletLines(lines: string[], limit: number): string {
  const selected = lines.slice(-limit);
  if (selected.length === 0) {
    return "- 暂无可提取内容";
  }

  return selected.map((line) => `- ${line}`).join("\n");
}

function dedupeLines(lines: string[]): string[] {
  const set = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || set.has(normalized)) {
      continue;
    }
    set.add(normalized);
    output.push(normalized);
  }
  return output;
}

function pickFirstLine(text: string): string {
  const line = text.split(/\r?\n/)[0] ?? "";
  const compact = line.trim();
  if (!compact) {
    return "（空内容）";
  }
  return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeMaxMessages(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("--max-messages must be a positive integer.");
  }
  return n;
}

function normalizeInterval(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 5) {
    throw new Error("--interval must be an integer >= 5.");
  }
  return n;
}

function normalizeOutputFormat(input: string): OutputFormat {
  const value = input.toLowerCase();
  if (value === "markdown" || value === "json" || value === "both") {
    return value;
  }
  throw new Error("--output must be one of: markdown, json, both.");
}

function normalizeExportFormat(input: string): "json" | "markdown" | "both" {
  const value = input.toLowerCase();
  if (value === "json" || value === "markdown" || value === "both") {
    return value;
  }
  throw new Error("--format must be one of: json, markdown, both.");
}

function normalizeDoctorOutput(input: string): "text" | "json" {
  const value = input.toLowerCase();
  if (value === "text" || value === "json") {
    return value;
  }
  throw new Error("--output must be one of: text, json.");
}

function loadBootstrapConfig(configPath: string): BootstrapConfigFile {
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
    throw new Error(`Cannot find bootstrap config file: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Config file must contain a JSON object: ${configPath}`);
  }

  const obj = parsed as Record<string, unknown>;
  const maxMessagesValue = obj.maxMessages;
  const outputValue = obj.output;
  const doctorOutputValue = obj.doctorOutput;

  return {
    from: pickOptionalString(obj.from),
    to: pickOptionalString(obj.to),
    maxMessages:
      typeof maxMessagesValue === "number" && Number.isFinite(maxMessagesValue)
        ? Math.trunc(maxMessagesValue)
        : undefined,
    output:
      typeof outputValue === "string"
        ? normalizeOutputFormat(outputValue)
        : undefined,
    taskId: pickOptionalString(obj.taskId),
    services: pickOptionalStringArray(obj.services),
    apiInterfaces:
      pickOptionalStringArray(obj.apiInterfaces) ?? pickOptionalStringArray(obj.api),
    risks: pickOptionalStringArray(obj.risks) ?? pickOptionalStringArray(obj.risk),
    doctorOutput:
      typeof doctorOutputValue === "string"
        ? normalizeDoctorOutput(doctorOutputValue)
        : undefined,
  };
}

function pickOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function pickOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => Boolean(item));
  return values.length > 0 ? values : undefined;
}

function resolveRequiredPath(input: string | undefined, optionName: string): string {
  if (!input) {
    throw new Error(`Missing required option ${optionName} (or provide it in --config).`);
  }
  return resolvePath(input);
}

function resolveRequiredProjectPath(input: string | undefined, optionName: string): string {
  if (!input) {
    throw new Error(`Missing required option ${optionName} (or provide it in --config).`);
  }
  return resolveProjectPath(input);
}

function normalizeMetadata(input: {
  taskId?: string;
  services?: string[];
  apiInterfaces?: string[];
  risks?: string[];
}): SyncMetadata {
  return {
    taskId: input.taskId?.trim() || undefined,
    services: dedupeLines(input.services ?? []),
    apiInterfaces: dedupeLines(input.apiInterfaces ?? []),
    risks: dedupeLines(input.risks ?? []),
  };
}

function resolveSyncTargets(
  cliTargets: string[],
  activeTask: TaskState | null,
  sourcePath?: string,
): string[] {
  const normalizedCliTargets = dedupeLines(cliTargets.map((p) => normalizeWorkspacePath(p)));
  if (normalizedCliTargets.length > 0) {
    return normalizedCliTargets;
  }

  // 如果有活跃任务且源项目一致，使用任务的目标
  if (activeTask) {
    const normalizedSource = sourcePath ? normalizeWorkspacePath(sourcePath) : "";
    if (normalizedSource === activeTask.from || !sourcePath) {
      const taskTargets = activeTask.targets ?? [];
      if (taskTargets.length > 0) {
        return dedupeLines(taskTargets.map((p) => normalizeWorkspacePath(p)));
      }
    }
  }

  // 检查当前目录是否是已登记的服务，尝试提示可能的目标
  const cwd = process.cwd();
  const registry = readServiceRegistry();
  const currentService = registry.services.find((s) => s.path === cwd);

  if (currentService) {
    printErrorWithRecovery(`当前在服务 ${currentService.name}，未指定目标项目`, [
      "使用 `--to <服务名>` 指定目标项目",
      "运行 `cb task-start --to <服务名>` 设置默认目标",
      "运行 `cb quickstart` 进行交互式配置",
    ]);
  } else {
    printErrorWithRecovery("未指定目标项目", [
      "使用 `--to <项目路径或服务名>` 指定目标项目",
      "运行 `cb task-start --to <服务名>` 设置默认目标",
      "运行 `cb quickstart` 进行交互式配置",
    ]);
  }
  process.exit(1);
}

function resolvePath(inputPath: string): string {
  return path.resolve(inputPath);
}

function resolveProjectPath(input: string): string {
  const trimmed = input.trim();

  // 1. 检查是否是已注册的服务名
  const registry = readServiceRegistry();
  const service = registry.services.find((s) => s.name === trimmed);
  if (service) {
    return service.path;
  }

  // 2. 检查是否是路径（包含路径分隔符或驱动器字母）
  if (trimmed.includes("/") || trimmed.includes("\\") || /^[A-Za-z]:/.test(trimmed)) {
    return resolvePath(trimmed);
  }

  // 3. 既不是服务名也不是路径，尝试作为相对路径
  return resolvePath(trimmed);
}

function ensureDirectory(targetPath: string, label: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Cannot find ${label}: ${targetPath}`);
  }
  if (!fs.statSync(targetPath).isDirectory()) {
    throw new Error(`${label} is not a directory: ${targetPath}`);
  }
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function buildMetadataLines(metadata: SyncMetadata): string[] {
  const lines: string[] = [];
  if (metadata.taskId) {
    lines.push(`- 任务ID: \`${metadata.taskId}\``);
  }
  if (metadata.services.length > 0) {
    lines.push(`- 关联服务: ${metadata.services.join(", ")}`);
  }
  if (metadata.apiInterfaces.length > 0) {
    lines.push(`- 关联接口: ${metadata.apiInterfaces.join(", ")}`);
  }
  if (metadata.risks.length > 0) {
    lines.push(`- 已知风险: ${metadata.risks.join(" | ")}`);
  }
  return lines;
}

function inspectProject(projectPath: string): DoctorItem {
  const cursorProjectDir = resolveCursorProjectDir(projectPath);
  const transcriptDir = resolveTranscriptDir(projectPath);
  const workerLogFile = resolveWorkerLogFile(projectPath);
  const latestSummaryJson = path.join(
    projectPath,
    ".contextbridge",
    "context-summary-latest.json",
  );

  const cursorProjectDirExists =
    fs.existsSync(cursorProjectDir) && fs.statSync(cursorProjectDir).isDirectory();
  const transcriptExists =
    fs.existsSync(transcriptDir) && fs.statSync(transcriptDir).isDirectory();
  const workerLogExists =
    fs.existsSync(workerLogFile) && fs.statSync(workerLogFile).isFile();
  const latestSummaryJsonExists =
    fs.existsSync(latestSummaryJson) && fs.statSync(latestSummaryJson).isFile();

  const transcriptReadable = transcriptExists && canReadDir(transcriptDir);
  const workerLogReadable = workerLogExists && canReadFile(workerLogFile);
  const latestSummaryJsonReadable =
    latestSummaryJsonExists && canReadFile(latestSummaryJson);

  const transcriptCount = transcriptReadable
    ? fs.readdirSync(transcriptDir).filter((name) => name.endsWith(".jsonl")).length
    : 0;

  return {
    projectPath,
    cursorProjectDir,
    cursorProjectDirExists,
    transcriptDir,
    transcriptExists,
    transcriptReadable,
    transcriptCount,
    workerLogFile,
    workerLogExists,
    workerLogReadable,
    latestSummaryJson,
    latestSummaryJsonExists,
    latestSummaryJsonReadable,
  };
}

function canReadFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function canReadDir(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.R_OK);
    fs.readdirSync(dirPath);
    return true;
  } catch {
    return false;
  }
}

function buildExportMarkdown(data: {
  generatedAt: string;
  projectCount: number;
  includedCount: number;
  items: Array<{
    projectPath: string;
    summaryPath: string;
    exists: boolean;
    summary: SummaryJson | null;
  }>;
}): string {
  const lines: string[] = [];
  lines.push("# ContextBridge 汇总报告");
  lines.push("");
  lines.push(`- 生成时间: ${data.generatedAt}`);
  lines.push(`- 项目总数: ${data.projectCount}`);
  lines.push(`- 有效摘要数: ${data.includedCount}`);
  lines.push("");

  for (const item of data.items) {
    lines.push(`## ${item.projectPath}`);
    lines.push(`- 摘要文件: \`${item.summaryPath}\``);
    lines.push(`- 文件状态: ${item.exists ? "存在" : "缺失"}`);
    if (!item.exists || !item.summary) {
      lines.push("- 结论: 暂无可导出摘要");
      lines.push("");
      continue;
    }

    const taskId = item.summary.metadata?.taskId;
    if (taskId) {
      lines.push(`- 任务ID: \`${taskId}\``);
    }
    const services = item.summary.metadata?.services ?? [];
    if (services.length > 0) {
      lines.push(`- 服务: ${services.join(", ")}`);
    }
    const apis = item.summary.metadata?.apiInterfaces ?? [];
    if (apis.length > 0) {
      lines.push(`- 接口: ${apis.join(", ")}`);
    }
    const risks = item.summary.metadata?.risks ?? [];
    if (risks.length > 0) {
      lines.push(`- 风险: ${risks.join(" | ")}`);
    }

    const nextSteps = item.summary.sections?.nextSteps ?? [];
    lines.push("- 下一步:");
    if (nextSteps.length === 0) {
      lines.push("  - 无");
    } else {
      for (const step of nextSteps.slice(0, 3)) {
        lines.push(`  - ${step}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function resolveServiceRegistryPath(): string {
  return path.join(getUserHomeDir(), ".contextbridge", "services.json");
}

function readServiceRegistry(): ServiceRegistry {
  const registryPath = resolveServiceRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return { version: 1, services: [] };
  }

  try {
    const raw = fs.readFileSync(registryPath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, services: [] };
    }

    const obj = parsed as Record<string, unknown>;
    const servicesRaw = Array.isArray(obj.services) ? obj.services : [];
    const services: ServiceEntry[] = servicesRaw
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const s = item as Record<string, unknown>;
        if (typeof s.name !== "string" || typeof s.path !== "string") {
          return null;
        }
        return {
          name: s.name.trim(),
          path: s.path.trim(),
          addedAt:
            typeof s.addedAt === "string" && s.addedAt.trim()
              ? s.addedAt
              : new Date().toISOString(),
        };
      })
      .filter((v): v is ServiceEntry => Boolean(v && v.name && v.path));

    return { version: 1, services };
  } catch {
    return { version: 1, services: [] };
  }
}

function writeServiceRegistry(registry: ServiceRegistry): void {
  const registryPath = resolveServiceRegistryPath();
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");
}

function resolveTaskRootDir(): string {
  return path.join(getUserHomeDir(), ".contextbridge", "tasks");
}

function resolveCurrentTaskPath(): string {
  return path.join(resolveTaskRootDir(), "current-task.json");
}

function resolveTaskArchiveDir(): string {
  return path.join(resolveTaskRootDir(), "history");
}

function readCurrentTask(): TaskState | null {
  const taskPath = resolveCurrentTaskPath();
  if (!fs.existsSync(taskPath) || !fs.statSync(taskPath).isFile()) {
    return null;
  }

  try {
    const raw = fs.readFileSync(taskPath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.taskId !== "string" ||
      typeof obj.title !== "string" ||
      typeof obj.from !== "string" ||
      typeof obj.startedAt !== "string" ||
      !obj.marker ||
      typeof obj.marker !== "object"
    ) {
      return null;
    }
    const markerObj = obj.marker as Record<string, unknown>;
    let marker: TaskMarker | null = null;
    if (
      markerObj.kind === "transcript" &&
      typeof markerObj.filePath === "string" &&
      typeof markerObj.lineOffset === "number"
    ) {
      marker = {
        kind: "transcript",
        filePath: markerObj.filePath,
        lineOffset: Math.max(0, Math.trunc(markerObj.lineOffset)),
      };
    } else if (
      markerObj.kind === "worker-log" &&
      typeof markerObj.filePath === "string" &&
      typeof markerObj.byteOffset === "number"
    ) {
      marker = {
        kind: "worker-log",
        filePath: markerObj.filePath,
        byteOffset: Math.max(0, Math.trunc(markerObj.byteOffset)),
      };
    }
    if (!marker) {
      return null;
    }

    return {
      version: 1,
      taskId: obj.taskId,
      title: obj.title,
      from: obj.from,
      targets: Array.isArray(obj.targets)
        ? obj.targets
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => Boolean(item))
        : [],
      startedAt: obj.startedAt,
      lastSyncedAt:
        typeof obj.lastSyncedAt === "string" ? obj.lastSyncedAt : undefined,
      marker,
    };
  } catch {
    return null;
  }
}

function writeCurrentTask(task: TaskState): void {
  const taskPath = resolveCurrentTaskPath();
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), "utf8");
}

function clearCurrentTask(): void {
  const taskPath = resolveCurrentTaskPath();
  if (fs.existsSync(taskPath)) {
    fs.rmSync(taskPath, { force: true });
  }
}

function archiveTask(task: TaskState): void {
  const archiveDir = resolveTaskArchiveDir();
  fs.mkdirSync(archiveDir, { recursive: true });
  const safeId = task.taskId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const archivePath = path.join(
    archiveDir,
    `${safeId}-${formatDate(new Date())}.json`,
  );
  fs.writeFileSync(archivePath, JSON.stringify(task, null, 2), "utf8");
}

function generateTaskId(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `TASK-${yyyy}${mm}${dd}-${hh}${mi}`;
}

function writeSummaryFiles(input: {
  sourceProject: string;
  targetProject: string;
  snapshot: SourceSnapshot;
  maxMessages: number;
  outputFormat: OutputFormat;
  metadata: SyncMetadata;
}): { generatedPaths: string[] } {
  const digestMarkdown = buildSummary({
    sourceProject: input.sourceProject,
    sourceFile: input.snapshot.sourceFile,
    sourceType: input.snapshot.sourceType,
    allMessages: input.snapshot.messages,
    maxMessages: input.maxMessages,
    metadata: input.metadata,
  });
  const digestJson = buildJsonSummary({
    sourceProject: input.sourceProject,
    sourceFile: input.snapshot.sourceFile,
    sourceType: input.snapshot.sourceType,
    allMessages: input.snapshot.messages,
    maxMessages: input.maxMessages,
    metadata: input.metadata,
  });

  const outDir = path.join(input.targetProject, ".contextbridge");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = formatDate(new Date());
  const generatedPaths: string[] = [];

  if (input.outputFormat === "markdown" || input.outputFormat === "both") {
    const latestMdPath = path.join(outDir, "context-summary-latest.md");
    const archiveMdPath = path.join(outDir, `context-summary-${stamp}.md`);
    fs.writeFileSync(latestMdPath, digestMarkdown, "utf8");
    fs.writeFileSync(archiveMdPath, digestMarkdown, "utf8");
    generatedPaths.push(latestMdPath, archiveMdPath);
  }

  if (input.outputFormat === "json" || input.outputFormat === "both") {
    const latestJsonPath = path.join(outDir, "context-summary-latest.json");
    const archiveJsonPath = path.join(outDir, `context-summary-${stamp}.json`);
    fs.writeFileSync(latestJsonPath, JSON.stringify(digestJson, null, 2), "utf8");
    fs.writeFileSync(archiveJsonPath, JSON.stringify(digestJson, null, 2), "utf8");
    generatedPaths.push(latestJsonPath, archiveJsonPath);
  }

  return { generatedPaths };
}

function buildNextSteps(users: string[], assistants: string[]): string {
  if (users.length === 0 && assistants.length === 0) {
    return "- 补充任务背景后执行下一轮同步。";
  }

  if (users.length > 0) {
    return [
      "- 将任务目标映射到当前项目的 Controller/Service/DAO 改动点。",
      "- 列出依赖服务与接口变更，先完成契约一致性检查。",
      "- 在提交前补充验收用例和回滚方案。",
    ].join("\n");
  }

  return [
    "- 根据执行记录补充需求目标，避免仅有操作日志缺少业务语义。",
    "- 对异常记录逐条排查并确认最终结果。",
  ].join("\n");
}
