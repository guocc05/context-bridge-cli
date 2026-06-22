# ContextBridge 使用指南

本项目使用 ContextBridge CLI 在跨服务间同步 Cursor 对话上下文。

## 同步命令

当用户说以下话时，请执行对应的同步命令：

### 推送上下文到目标服务
用户说："把上下文同步到 xxx" 或 "同步到 xxx 服务"

执行命令：
```bash
cb push <目标服务名>
```

示例：
- "同步到 yl-jms-app-api" → `cb push yl-jms-app-api`
- "同步到 yl-jms-ops-app-core" → `cb push yl-jms-ops-app-core`
- "同步到 app-api 和 ops-app-core" → `cb push yl-jms-app-api yl-jms-ops-app-core`

### 查看已注册的服务
```bash
cb services-list
```

### 查看收件箱
用户说："看看收到了什么上下文"

执行命令：
```bash
cat .contextbridge/context-inbox.md
```

## 输出格式

同步成功后，告诉用户：
1. 任务ID
2. 在目标服务中使用的提示词

示例输出：
```
✅ 已同步到 yl-jms-app-api
📋 任务ID: TASK-20260622-1056

在目标服务中对 AI 说：
接入 TASK-20260622-1056
```
