# ContextBridge CLI

本地命令行工具，用于把 A 项目的 Cursor 会话要点同步到 B 项目，减少跨项目重复描述需求的成本。

## 技术栈

- Node.js
- TypeScript
- Commander

## 快速开始

```bash
npm install
npm run build
npm link
```

## 命令

```bash
cb sync --from "<A项目路径>" --to "<B项目路径>"
```

可选参数：

- `--max-messages <number>`：从最近 N 条消息中提炼摘要，默认 `16`
- `--output <format>`：`markdown` | `json` | `both`，默认 `markdown`
- `--task-id <id>`：任务 ID（如 `REQ-1024`）
- `--service <name...>`：关联服务（支持多个）
- `--api <name...>`：关联接口/Topic（支持多个）
- `--risk <text...>`：风险说明（支持多个）

```bash
cb watch --from "<A项目路径>" --to "<B项目路径>" --interval 20 --output both
```

可选参数：

- `--max-messages <number>`：从最近 N 条消息中提炼摘要，默认 `16`
- `--interval <seconds>`：轮询间隔（秒），最小 `5`
- 其余参数同 `sync`

```bash
cb init --target "<B项目路径>"
```

用于初始化目标项目的 `.contextbridge` 入口文件。

```bash
cb doctor --projects "<项目A路径>" "<项目B路径>" --output text
```

用于诊断本机 Cursor 上下文可读性（transcript/worker.log/summary.json）。

```bash
cb export --projects "<项目A路径>" "<项目B路径>" --out "<输出目录>/weekly-report" --format both
```

用于聚合多个项目的 `context-summary-latest.json`，输出统一汇总文件。

```bash
cb bootstrap --from "<A项目路径>" --to "<B项目路径>" --output both --task-id REQ-20260618
```

一键执行 `init + sync + doctor`，用于新项目快速接入跨项目上下文协作。

也支持通过配置文件执行（命令行参数优先级高于配置文件）：

```bash
cb bootstrap --config "./contextbridge.config.json"
```

示例配置见：`contextbridge.config.example.json`

配置字段：

- `from` / `to`
- `maxMessages`
- `output`
- `taskId`
- `services`
- `apiInterfaces`（或 `api`）
- `risks`（或 `risk`）
- `doctorOutput`

## 输出

在目标项目 `B` 下生成：

- `.contextbridge/context-summary-latest.md`
- `.contextbridge/context-summary-YYYYMMDD-HHmmss.md`
- `.contextbridge/context-summary-latest.json`
- `.contextbridge/context-summary-YYYYMMDD-HHmmss.json`
- `.contextbridge/context-entry.md`（通过 `init` 生成）

## 摘要结构

- 任务目标
- 关键决策
- 执行记录
- 下一步建议

## 发布准备

当前项目已包含 npm 发布所需基础配置：

- `bin` 命令：`cb`
- `files` 白名单：`dist` + `README.md`
- `prepare` / `prepublishOnly` 自动构建
- `publishConfig.access = public`

发布示例：

```bash
npm login
npm publish
```
