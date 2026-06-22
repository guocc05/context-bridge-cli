# ContextBridge CLI - Product Introduction and User Guide

> **One-line introduction:** ContextBridge CLI is a local command-line tool that syncs Cursor session context from Project A to Project B, reducing the cost of repeatedly describing requirements in cross-service collaboration.

## 1. Background and Value

In multi-repository and multi-service collaboration scenarios, developers often need to repeatedly explain the same requirement background in different projects. This leads to high communication costs and information loss. ContextBridge CLI standardizes context synchronization and captures "requirement goals, key decisions, execution records, and next steps" into reusable documents.

- Reduce repeated communication and improve cross-service collaboration efficiency
- Make context traceable for easy onboarding
- Support structured JSON output for automation integration

## 2. Core Features

| Feature | Command | Description |
|---------|---------|-------------|
| Interactive Guide | `cb quickstart` | NEW - User-friendly, interactive selection of source/target projects |
| Initialize | `cb init` | Initialize .contextbridge directory in target project |
| One-time Sync | `cb sync` | Sync source project context to target (supports smart detection) |
| Continuous Sync | `cb watch` | Auto-detect and sync at intervals (supports smart detection) |
| One-click Setup | `cb bootstrap` | Chain init + sync + doctor |
| Environment Diagnosis | `cb doctor` | Check Cursor metadata and summary file availability |
| Multi-project Export | `cb export` | Aggregate latest JSON from multiple projects |
| Task Tracking | `cb task-start/stop/status` | Set task anchors, support incremental sync |
| Service Management | `cb services-import/list` | Batch register and view services, support service name shorthand |

## 3. Installation and Quick Start

### 3.1 Installation

```bash
git clone https://github.com/guocc05/context-bridge-cli.git
cd context-bridge-cli
npm install
npm run build
npm link
```

### 3.2 Recommended for New Users: Interactive Guide

> **Easiest way to get started:** No need to memorize any parameters, just select interactively.

```bash
cb quickstart
```

Interactive flow:
1. Select source project from registered service list (or enter path manually)
2. Select target project(s) (multi-select supported)
3. Optional: task ID, related services, interfaces, risks
4. Auto-execute init + sync + doctor

### 3.3 One-click Setup

```bash
# Using full path
cb bootstrap --from "/path/to/project-a" --to "/path/to/project-b" --output both --task-id REQ-001

# Using service name shorthand
cb bootstrap --from service-a --to service-b --output both
```

## 4. Smart Features (New)

### 4.1 Service Name Shorthand

All commands support using **service names** instead of full paths, greatly reducing input:

```bash
# Register services first
cb services-import --root "/Users/yourname/IdeaProjects"

# View registered services
cb services-list

# Sync using service name
cb sync --from service-a --to service-b

# Diagnose using service name
cb doctor --projects service-a service-b
```

### 4.2 Smart Source Detection

`sync` and `watch` commands automatically detect source project with priority:
1. Path specified by `--from` parameter
2. Active task's source project
3. Current working directory

```bash
# Running in project directory, auto-use current directory as source
cd /path/to/service-a
cb sync --to service-b

# With active task, no parameters needed
cb task-start --from service-a --to service-b --title "New Feature"
cb sync  # Auto-uses task's source and target
```

### 4.3 Colorful Output and Error Guidance

All command outputs have been optimized:
- **Colorful segmented output:** Icons, colors, dividers for better readability
- **Smart error hints:** Provides recovery suggestions on errors, not just error messages
- **Tabular diagnosis:** `cb doctor` displays project status in table format

## 5. Daily Usage Guide

### 5.1 Task Tracking Workflow (Recommended)

> Using task tracking allows: setting default target, implementing incremental sync (only sync new content after task starts).

```bash
# 1. Start task (set source and target)
cb task-start --from service-a --to service-b --title "Add export field"

# 2. View task status
cb task-status

# 3. Sync (no parameters needed, auto-uses task config)
cb sync

# 4. Real-time monitoring (optional)
cb watch

# 5. End task
cb task-stop
```

### 5.2 One-time Sync

```bash
# Traditional way
cb sync --from "/path/to/A" --to "/path/to/B" --output both --task-id REQ-20260618

# Using service name
cb sync --from service-a --to service-b

# In project directory, only specify target
cd /path/to/service-a
cb sync --to service-b

# With task, no parameters needed
cb sync
```

### 5.3 Continuous Sync

```bash
# Traditional way
cb watch --from service-a --to service-b --interval 20

# With task, no parameters needed
cb watch

# In project directory
cb watch --to service-b
```

### 5.4 Environment Diagnosis

```bash
# Check multiple projects
cb doctor --projects service-a service-b

# JSON format output
cb doctor --projects service-a --output json
```

### 5.5 Multi-project Export

```bash
cb export --projects service-a service-b --out "./weekly-report" --format both
```

## 6. Command Reference

| Command | Required Params | Optional Params |
|---------|-----------------|-----------------|
| `cb quickstart` | None | Interactive selection, no params needed |
| `cb sync` | None (smart detection) | --from, --to, --output, --task-id |
| `cb watch` | None (smart detection) | --from, --to, --interval, --output |
| `cb init` | --target | Supports service name |
| `cb doctor` | --projects | --output (text/json) |
| `cb export` | --projects, --out | --format |
| `cb bootstrap` | --from, --to or --config | --output, --task-id |
| `cb task-start` | --from, --title | --to, --task-id |
| `cb task-stop` | None | None |
| `cb task-status` | None | None |
| `cb services-import` | --root | --dry-run |
| `cb services-list` | None | None |

## 7. Recommended Team Adoption

- New team members run `cb quickstart` on day one
- Bind unified taskId for each requirement (e.g., REQ-xxxx)
- Use `cb task-start` to set default target, no need to specify repeatedly
- Run `cb export` before weekly meetings for summary
- Run `cb doctor` first when encountering issues

## 8. FAQ

### Q: Getting "No target project specified" error?

```bash
# Option 1: Use --to to specify
cb sync --to service-b

# Option 2: Start task first to set default target
cb task-start --from service-a --to service-b --title "xxx"
cb sync

# Option 3: Interactive configuration
cb quickstart
```

### Q: Getting "Cannot read Cursor session data" error?

```bash
# Diagnose environment
cb doctor --projects service-a

# Ensure:
# 1. Open source project in Cursor
# 2. Have at least one conversation
# 3. Check Cursor data directory permissions
```

### Q: How to sync to multiple targets?

```bash
# Option 1: Specify multiple targets in command
cb sync --from service-a --to service-b service-c service-d

# Option 2: Set multiple targets when starting task
cb task-start --from service-a --to service-b service-c --title "Cross-service requirement"
```

## 9. Tech Stack and License

- **Language:** TypeScript / Node.js
- **CLI Framework:** Commander
- **Interactive:** inquirer
- **Colorful Output:** picocolors
- **License:** PolyForm Noncommercial 1.0.0 (unauthorized commercial use prohibited)

[GitHub Repository](https://github.com/guocc05/context-bridge-cli)
