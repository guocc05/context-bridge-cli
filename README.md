# ContextBridge CLI

ContextBridge CLI 是一个本地命令行工具，用于把一个项目里的 Cursor 对话上下文同步到另一个项目，减少跨服务、跨仓库协作时反复描述需求背景的成本。

一句话使用方式：

```text
源项目：同步到 yl-jms-ops-report-api
目标项目：接入 TASK-xxxxxxxx
```

## 核心亮点

| 亮点 | 说明 |
| --- | --- |
| 自然语言触发 | 配合 `.cursorrules` 后，用户说“同步到 xxx”，AI 自动执行 `cb push xxx`；目标项目说“接入 TASK-xxx”，AI 自动读取上下文。 |
| 真实 Cursor 会话 | 优先读取 Cursor ACP SQLite 数据，失败时降级到 agent transcript 和 worker.log，尽量复用真实用户问题与 AI 回答。 |
| 服务名与模糊匹配 | 可用服务名替代完整路径，也支持唯一模糊匹配，例如 `cb push report`。 |
| 零配置上手 | `cb setup` 或 `cb services-import` 可批量注册项目，并自动生成 `.cursorrules`。 |
| 多目标推送 | 一次把同一份上下文推送到多个目标服务。 |
| 任务 ID 接力 | 每次推送生成 `TASK-xxx`，目标项目用它继续任务。 |
| 收件箱沉淀 | 目标项目维护 `.contextbridge/context-inbox.md`，保留最近收到的上下文记录。 |
| 增量同步 | `task-start` 建立锚点后，后续 `sync/watch` 只同步新增内容。 |
| 诊断与导出 | `doctor` 检查本机 Cursor 数据可读性，`export` 聚合多项目摘要。 |

## 适用场景

- 一个需求涉及多个服务，例如先在 `app-api` 梳理需求，再到 `report-api` 实现。
- A 同学完成需求讨论，B 同学需要继续开发。
- 希望把 AI 对话中的目标、决策、执行记录和下一步沉淀为文件。
- 周报、交接、复盘需要聚合多个项目的最新上下文摘要。

## 技术栈

- Node.js / TypeScript
- Commander
- inquirer
- picocolors
- better-sqlite3

## 安装

```bash
git clone https://github.com/guocc05/context-bridge-cli.git
cd context-bridge-cli
npm install
npm run build
npm link
```

安装完成后，可以在任意目录使用 `cb` 命令。

## 快速开始

### 1. 注册服务

推荐首次使用先运行交互式配置：

```bash
cb setup
```

也可以批量扫描 `IdeaProjects` 下的所有一级目录：

```bash
cb services-import --root "C:\Users\你的用户名\IdeaProjects"
cb services-list
```

预览但不写入：

```bash
cb services-import --root "C:\Users\你的用户名\IdeaProjects" --dry-run
```

### 2. 推送上下文

在源项目目录下执行：

```bash
cd C:\Users\你的用户名\IdeaProjects\yl-web-operatingplatform-bigdata
cb push yl-jms-ops-report-api
```

输出示例：

```text
📤 推送上下文
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  源项目: yl-web-operatingplatform-bigdata
  目标项目: yl-jms-ops-report-api

✓ 已推送 16 条消息到 1 个服务

📋 任务ID: TASK-EB5507FE

💡 在目标服务中对 AI 说：
   接入 TASK-EB5507FE
```

### 3. 在目标项目接入

在目标项目 Cursor 中输入：

```text
接入 TASK-EB5507FE
```

AI 会读取目标项目的 `.contextbridge/context-summary-latest.md`，总结来源上下文，并询问是否继续推进。

## 推荐工作流

### 日常跨服务协作

```bash
# 源项目
cb push yl-jms-ops-report-api

# 目标项目 Cursor
接入 TASK-xxxxxxxx
```

也可以一次同步到多个目标：

```bash
cb push yl-jms-ops-report-api yl-jms-ops-app-core yl-jms-app-api
```

### 自然语言协作

执行 `cb setup` 或 `cb services-import` 后，工具会为已注册项目生成 `.cursorrules`。之后可以直接在 Cursor 中说：

```text
同步到 yl-jms-ops-report-api
```

目标项目中说：

```text
接入 TASK-xxxxxxxx
```

### 新项目一键接入

```bash
cb bootstrap --from yl-jms-app-api --to yl-jms-ops-report-api --output both --task-id REQ-20260622
```

也支持配置文件：

```bash
cb bootstrap --config "./contextbridge.config.json"
```

示例配置见 `contextbridge.config.example.json`：

```json
{
  "from": "C:/Users/your.name/IdeaProjects/service-a",
  "to": "C:/Users/your.name/IdeaProjects/service-b",
  "maxMessages": 20,
  "output": "both",
  "taskId": "REQ-20260618",
  "services": ["service-a", "service-b"],
  "apiInterfaces": ["OrderMarkExpandChangeEvent", "queryReceiverMobileUniqueIds"],
  "risks": ["数据一致性风险", "跨服务字段对齐风险"],
  "doctorOutput": "text"
}
```

### 任务锚点与增量同步

为避免把旧对话重复同步到目标项目，长任务推荐先开启任务锚点：

```bash
cb task-start --from yl-jms-app-api --to yl-jms-ops-report-api --title "报表导出新增字段"
```

后续可以省略 `--from` / `--to`：

```bash
cb sync
cb task-status
cb task-stop
```

当存在 active task 且同步源项目与任务源项目一致时，`sync/watch` 只同步锚点之后新增的内容。

### 持续监听同步

```bash
cb push yl-jms-ops-report-api --watch --interval 20
```

或使用传统 `watch`：

```bash
cb watch --from yl-jms-app-api --to yl-jms-ops-report-api --interval 20 --output both
```

### 诊断环境

```bash
cb doctor --projects yl-jms-app-api yl-jms-ops-report-api --output text
```

用于检查本机 Cursor 项目目录、agent transcript、worker.log、summary 文件是否存在且可读。

### 汇总导出

```bash
cb export --projects yl-jms-app-api yl-jms-ops-report-api --out "./weekly-report/contextbridge" --format both
```

用于聚合多个项目的 `context-summary-latest.json`，输出统一汇总文件。

## 命令参考

| 命令 | 用途 |
| --- | --- |
| `cb setup` | 交互式扫描项目目录并注册服务。 |
| `cb push [targets...]` | 从当前目录推送上下文到目标服务，适合日常使用。 |
| `cb push [targets...] --watch` | 从当前目录持续监听并推送。 |
| `cb sync` | 传统同步命令，支持指定源、目标、输出格式和元数据。 |
| `cb watch` | 传统持续同步命令，支持任务锚点增量模式。 |
| `cb init --target <path>` | 初始化目标项目 `.contextbridge` 入口文件。 |
| `cb quickstart` | 新手交互式引导，选择源项目和目标项目并执行同步。 |
| `cb bootstrap` | 一键执行 `init + sync + doctor`。 |
| `cb doctor` | 诊断本机 Cursor 上下文可读性。 |
| `cb export` | 聚合多个项目的最新摘要。 |
| `cb services-import` | 批量登记某目录下所有一级项目。 |
| `cb services-list` | 查看已登记服务。 |
| `cb services-remove <name>` | 删除已登记服务。 |
| `cb task-start` | 开启任务锚点。 |
| `cb task-status` | 查看当前任务状态。 |
| `cb task-stop` | 结束当前任务。 |

## 常用参数

| 参数 | 说明 |
| --- | --- |
| `--from <path>` | 源项目路径或服务名；未传时优先使用活跃任务源项目，否则使用当前目录。 |
| `--to <paths...>` | 目标项目路径或服务名，支持多个目标。 |
| `--max-messages <number>` | 提取最近 N 条消息，默认 `16`。 |
| `--output <format>` | 输出格式：`markdown`、`json`、`both`。 |
| `--task-id <id>` | 自定义任务 ID；未传时由工具生成。 |
| `--service <name...>` | 关联服务名，可多个。 |
| `--api <name...>` | 关联接口、Topic 或契约名，可多个。 |
| `--risk <text...>` | 已知风险说明，可多个。 |
| `--interval <seconds>` | `watch` 间隔秒数，最小 `5`。 |

## 输出文件

在目标项目下生成：

| 文件 | 说明 |
| --- | --- |
| `.contextbridge/context-summary-latest.md` | 最近一次同步的可读摘要，目标项目 Cursor 接入时优先读取。 |
| `.contextbridge/context-summary-latest.json` | 最近一次同步的结构化摘要，适合脚本处理。 |
| `.contextbridge/context-summary-YYYYMMDD-HHmmss.md` | Markdown 历史快照。 |
| `.contextbridge/context-summary-YYYYMMDD-HHmmss.json` | JSON 历史快照。 |
| `.contextbridge/context-entry.md` | 目标项目入口说明，由 `cb init` 生成。 |
| `.contextbridge/context-inbox.md` | 上下文收件箱，记录最近收到的任务。 |
| `.contextbridge/context-inbox.json` | 收件箱结构化数据，保留最近 50 条。 |

全局目录：

| 文件 | 说明 |
| --- | --- |
| `~/.contextbridge/services.json` | 服务名到本地路径的注册表。 |
| `~/.contextbridge/tasks/current-task.json` | 当前活跃任务锚点。 |

## 数据来源优先级

同步时会按以下顺序读取 Cursor 本地数据：

1. `~/.cursor/acp-sessions/*/store.db`
2. `~/.cursor/projects/<workspace-key>/agent-transcripts/*.jsonl`
3. `~/.cursor/projects/<workspace-key>/worker.log`

如果三者都不可读，会提示运行 `cb doctor` 进行诊断。

## FAQ

### Q: 提示找不到目标服务怎么办？

先查看已注册服务：

```bash
cb services-list
```

如果未注册，执行：

```bash
cb services-import --root "C:\Users\你的用户名\IdeaProjects"
```

也可以直接传完整路径：

```bash
cb push "C:\Users\你的用户名\IdeaProjects\yl-jms-ops-report-api"
```

### Q: 提示无法读取 Cursor 会话数据怎么办？

确保源项目已在 Cursor 中打开过，并且至少有一轮有效对话，然后运行：

```bash
cb doctor --projects 当前服务名
```

### Q: 可以不记完整服务名吗？

可以。`push` 支持已注册服务的唯一模糊匹配：

```bash
cb push report
cb push app-api
```

如果匹配到多个服务，工具会提示候选项，需要输入更精确的名称。

### Q: 这个工具需要服务端吗？

不需要。ContextBridge 是纯本地 CLI，通过读取本机 Cursor 数据并写入目标仓库文件完成上下文传递。

## 发布准备

当前项目已包含 npm 发布所需基础配置：

- `bin` 命令：`cb`
- `files` 白名单：`dist`、`README.md`、`contextbridge.config.example.json`
- `prepare` / `prepublishOnly` 自动构建
- `publishConfig.access = public`

发布示例：

```bash
npm login
npm publish
```

## 开源协议

本项目采用 `PolyForm Noncommercial 1.0.0` 协议，详见 `LICENSE` 文件。

该协议明确**禁止未授权商用**。
