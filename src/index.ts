#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { Command } from "commander";

type ChatRole = "user" | "assistant" | "system" | "unknown";

interface ChatMessage {
  role: ChatRole;
  text: string;
}

interface SyncOptions {
  from: string;
  to: string;
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

const program = new Command();

program
  .name("cb")
  .description("ContextBridge CLI - sync Cursor context between local projects")
  .version("1.0.0");

program
  .command("sync")
  .description("Sync latest conversation summary from project A to project B")
  .requiredOption("--from <path>", "source project path (A)")
  .requiredOption("--to <path>", "target project path (B)")
  .option("--max-messages <number>", "max recent messages to summarize", "16")
  .option("--output <format>", "output format: markdown | json | both", "markdown")
  .option("--task-id <id>", "task id for cross-project tracking")
  .option("--service <name...>", "related service names")
  .option("--api <name...>", "related API or topic names")
  .option("--risk <text...>", "known risks")
  .action(
    (opts: {
      from: string;
      to: string;
      maxMessages: string;
      output: string;
      taskId?: string;
      service?: string[];
      api?: string[];
      risk?: string[];
    }) => {
    const normalized: SyncOptions = {
      from: resolvePath(opts.from),
      to: resolvePath(opts.to),
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
  .description("Watch project A and auto-sync summary to project B")
  .requiredOption("--from <path>", "source project path (A)")
  .requiredOption("--to <path>", "target project path (B)")
  .option("--max-messages <number>", "max recent messages to summarize", "16")
  .option("--interval <seconds>", "watch interval seconds", "20")
  .option("--output <format>", "output format: markdown | json | both", "markdown")
  .option("--task-id <id>", "task id for cross-project tracking")
  .option("--service <name...>", "related service names")
  .option("--api <name...>", "related API or topic names")
  .option("--risk <text...>", "known risks")
  .action(
    (opts: {
      from: string;
      to: string;
      maxMessages: string;
      interval: string;
      output: string;
      taskId?: string;
      service?: string[];
      api?: string[];
      risk?: string[];
    }) => {
      const normalized: WatchOptions = {
        from: resolvePath(opts.from),
        to: resolvePath(opts.to),
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
  .requiredOption("--target <path>", "target project path")
  .action((opts: { target: string }) => {
    const normalized: InitOptions = {
      target: resolvePath(opts.target),
    };
    runInit(normalized);
  });

program
  .command("export")
  .description("Export latest summaries from multiple projects")
  .requiredOption("--projects <paths...>", "project paths to aggregate")
  .requiredOption("--out <path>", "output file path without extension")
  .option("--format <format>", "output format: json | markdown | both", "both")
  .action(
    (opts: {
      projects: string[];
      out: string;
      format: string;
    }) => {
      const normalized: ExportOptions = {
        projects: opts.projects.map((p) => resolvePath(p)),
        out: resolvePath(opts.out),
        format: normalizeExportFormat(opts.format),
      };
      runExport(normalized);
    },
  );

program
  .command("doctor")
  .description("Diagnose local Cursor context availability")
  .requiredOption("--projects <paths...>", "project paths to check")
  .option("--output <format>", "output format: text | json", "text")
  .action(
    (opts: {
      projects: string[];
      output: string;
    }) => {
      const normalized: DoctorOptions = {
        projects: opts.projects.map((p) => resolvePath(p)),
        outputFormat: normalizeDoctorOutput(opts.output),
      };
      runDoctor(normalized);
    },
  );

program
  .command("bootstrap")
  .description("Run init + sync + doctor in one command")
  .option("--config <path>", "bootstrap config file path (JSON)")
  .option("--from <path>", "source project path (A)")
  .option("--to <path>", "target project path (B)")
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

      const fromPath = resolveRequiredPath(opts.from ?? config.from, "--from");
      const toPath = resolveRequiredPath(opts.to ?? config.to, "--to");
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
        to: toPath,
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

program.parse();

function runSync(options: SyncOptions): void {
  ensureDirectory(options.from, "source project");
  ensureDirectory(options.to, "target project");

  const snapshot = loadSourceSnapshot(options.from, options.maxMessages);
  const result = writeSummaryFiles({
    sourceProject: options.from,
    targetProject: options.to,
    snapshot,
    maxMessages: options.maxMessages,
    outputFormat: options.outputFormat,
    metadata: options.metadata,
  });

  console.log("Sync completed.");
  console.log(`Source type: ${snapshot.sourceType}`);
  console.log(`Source file: ${snapshot.sourceFile}`);
  for (const filePath of result.generatedPaths) {
    console.log(`Generated: ${filePath}`);
  }
}

function runWatch(options: WatchOptions): void {
  ensureDirectory(options.from, "source project");
  ensureDirectory(options.to, "target project");

  console.log(
    `Watching source project changes every ${options.intervalSec}s...`,
  );
  console.log(`From: ${options.from}`);
  console.log(`To: ${options.to}`);

  let previousSignature = "";

  const tick = (): void => {
    try {
      const snapshot = loadSourceSnapshot(options.from, options.maxMessages);
      if (snapshot.sourceSignature === previousSignature) {
        console.log(`[${new Date().toLocaleTimeString()}] No changes detected.`);
        return;
      }

      const result = writeSummaryFiles({
        sourceProject: options.from,
        targetProject: options.to,
        snapshot,
        maxMessages: options.maxMessages,
        outputFormat: options.outputFormat,
        metadata: options.metadata,
      });
      previousSignature = snapshot.sourceSignature;

      console.log(`[${new Date().toLocaleTimeString()}] Synced successfully.`);
      console.log(`  Source: ${snapshot.sourceType} ${snapshot.sourceFile}`);
      for (const filePath of result.generatedPaths) {
        console.log(`  Output: ${filePath}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error(`[${new Date().toLocaleTimeString()}] Sync failed: ${message}`);
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

  console.log("ContextBridge Doctor Report");
  console.log(`Projects: ${items.length}, Failed: ${failed.length}`);
  for (const item of items) {
    console.log("");
    console.log(`- Project: ${item.projectPath}`);
    console.log(`  Cursor dir: ${item.cursorProjectDirExists ? "OK" : "Missing"}`);
    console.log(
      `  Transcript: ${
        item.transcriptReadable
          ? `OK (${item.transcriptCount} files)`
          : item.transcriptExists
            ? "Unreadable"
            : "Missing"
      }`,
    );
    console.log(
      `  Worker log: ${
        item.workerLogReadable
          ? "OK"
          : item.workerLogExists
            ? "Unreadable"
            : "Missing"
      }`,
    );
    console.log(
      `  Latest summary json: ${
        item.latestSummaryJsonReadable
          ? "OK"
          : item.latestSummaryJsonExists
            ? "Unreadable"
            : "Missing"
      }`,
    );
  }
}

function runBootstrap(options: BootstrapOptions): void {
  console.log("Bootstrap started.");
  console.log("");

  console.log("[1/3] Initializing target project...");
  runInit({ target: options.to });
  console.log("");

  console.log("[2/3] Syncing context...");
  runSync({
    from: options.from,
    to: options.to,
    maxMessages: options.maxMessages,
    outputFormat: options.outputFormat,
    metadata: options.metadata,
  });
  console.log("");

  console.log("[3/3] Running doctor diagnostics...");
  runDoctor({
    projects: [options.from, options.to],
    outputFormat: options.doctorOutput,
  });
  console.log("");

  console.log("Bootstrap completed.");
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
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const output: ChatMessage[] = [];

  for (const line of lines) {
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
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  const meaningful: string[] = [];
  for (const line of lines) {
    const parsed = pickWorkerLogLine(line);
    if (parsed) {
      meaningful.push(parsed);
    }
  }

  return meaningful.slice(-Math.max(maxLines, 1)).map((line) => ({
    role: "assistant",
    text: line,
  }));
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

function resolvePath(inputPath: string): string {
  return path.resolve(inputPath);
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
