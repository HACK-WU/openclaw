# 群聊防循环机制设计

## 一、问题定义

在群聊多 Agent 协作场景中，Agent 互相回复可能导致无限循环：

- **A↔B 乒乓**：两个 Agent 互相回复，永不停止
- **A→B→C→A 环路**：多 Agent 形成消息环
- **A 独占**：单个 Agent 不断自言自语
- **CLI 挂起**：CLI Agent 执行长时间命令，永远不返回
- **整体失控**：以上组合叠加，导致系统资源耗尽

---

## 二、核心设计：maxRounds 计数

### 2.1 设计原则

maxRounds 的计数方式极其简单，只有两条规则：

1. **Agent 触发时 +1**：每当一个 Agent 被触发执行推理（渲染对话之前），`roundCount + 1`
2. **Owner 发新消息时清零**：Owner 发送新消息时，无论当前链处于什么状态，一律清零并开启新对话链

**不触发就不计数**——只要没有 Agent 被触发执行，计数器就不会增加。

**Owner 发消息立即清零**——Owner 的新消息会立即终止当前对话链（如果有），清零所有状态，开启全新的对话链。没有排队，没有等待。

**⚠️ 关键区分**：这里的"Owner 发消息"指的是**真正的 Owner 操作**（用户在输入框里打字发送），不包括前端自动投递（`skipTranscript` 的消息）。前端的汇总/投递虽然以 `sender: { type: "owner" }` 发送，但带有 `skipTranscript: true` 标记，后端会识别并**不清零**——它们属于当前对话链的一部分，受 maxRounds 和 chainTimeout 约束。

### 2.2 计数时机

```
Owner 发消息 → roundCount = 0（清零，新对话链开始）
  ↓
Agent A 触发 → roundCount = 1（+1）→ 执行推理 → 回复
  ↓
Agent B 触发 → roundCount = 2（+1）→ 执行推理 → 回复
  ↓
Agent A 再次触发 → roundCount = 3（+1）→ 执行推理 → 回复
  ↓
...直到 roundCount >= maxRounds → 阻止后续 Agent 触发
```

**关键**：计数发生在触发前，而不是回复后。这样能精确控制执行中的 Agent 数量。

### 2.3 后端实现位置

计数发生在后端 `group.ts` 的触发流程中：

- **Owner 发消息时**：调用 `initChainState`，`roundCount = 0`（这是唯一的清零时机）
- **Agent 触发前**：调用 `atomicCheckAndIncrement`，原子地检查并 +1
- **触发失败时**：计数已增加但 Agent 未执行（可接受，因为触发本身就是消耗）

### 2.4 前端同步

前端维护一个 `ChainState`（`groupChainStates`），用于：

- **UI 显示**：提示用户当前轮数
- **前端限流**：`detectAndForwardMentions` 中检查 `chain.count` 是否超限
- **对话链结束时清零**：所有 Agent 回复完成后重置 `chain.count = 0`

前端的 `chain.count` 和后端的 `roundCount` **语义相近**：都是"Agent 执行次数"。前端在收到 Agent 的 stream final 事件后 +1（表示一次执行完成），所有 Agent 完成后清零。

---

## 三、两层防护架构

```
┌──────────────────────────────────────────────────┐
│  Layer 1: 用户可配置限制（主要控制层）              │
│  maxRounds / chainTimeout / cliTimeout           │
├──────────────────────────────────────────────────┤
│  Layer 2: 后端硬限制（兜底安全网）                  │
│  CHAIN_MAX_COUNT / CHAIN_MAX_DURATION            │
└──────────────────────────────────────────────────┘
```

### 3.1 Layer 1：用户可配置限制

| 参数         | 字段名         | 默认值                 | 范围          | 说明                                                      |
| ------------ | -------------- | ---------------------- | ------------- | --------------------------------------------------------- |
| 最大轮数     | `maxRounds`    | 10                     | 1-100         | Agent 回复的最大总次数（Owner 发新消息时清零）            |
| 对话链超时   | `chainTimeout` | 单播 15min / 广播 8min | 60000-1800000 | 对话链总时长上限(ms)，超时后终止所有 Agent 并阻止后续触发 |
| CLI 执行超时 | `cliTimeout`   | 300000 (5min)          | 30000-600000  | 单次 CLI 命令的最长执行时间(ms)                           |

所有参数持久化在群组 meta（`GroupSessionEntry`）中。

**chainTimeout 默认值说明**：

- 单播模式下 Agent 串行执行，每个 Agent 的完成时间会影响后续 Agent 的触发时间，因此给较长的 15 分钟
- 广播模式下 Agent 并行执行，超时是唯一的终止手段（触发前检查对并行 Agent 无效），因此给较短的 8 分钟

### 3.2 Layer 2：后端硬限制

| 常量名               | 值     | 说明                                                 |
| -------------------- | ------ | ---------------------------------------------------- |
| `CHAIN_MAX_COUNT`    | 20     | 兜底最大触发次数（与 maxRounds 相同逻辑）            |
| `CHAIN_MAX_DURATION` | 5 分钟 | 兜底超时限制（与 chainTimeout 相同逻辑，运行时监控） |

硬编码在后端，不可通过 UI 修改。正常情况下 Layer 1 先触发（maxRounds=10 < CHAIN_MAX_COUNT=20）。

Layer 2 仅在 Layer 1 失效时生效（RPC 失败、meta 损坏、前端 Bug 等）。Layer 2 与 Layer 1 共享同一套运行时监控机制。

---

## 四、触发模式与计数

### 4.1 串行触发（单播模式）

```
Owner 消息 → initChainState → roundCount = 0
  ↓
Agent A: atomicCheckAndIncrement → roundCount = 1 → 执行 → 回复
  ↓
Agent B: atomicCheckAndIncrement → roundCount = 2 → 执行 → 回复
  ↓
Agent C: atomicCheckAndIncrement → roundCount = 3 → 执行 → 回复
```

串行模式下也使用 `atomicCheckAndIncrement` 保持一致性，虽然串行天然原子，但统一接口更简洁。

### 4.2 并行触发（广播模式）

```
Owner 消息 → roundCount = 0（初始化）
  ↓
┌─────────────────────────────────────────────┐
│  atomicCheckAndIncrement (共享状态存储)       │
│  Agent A: 检查 → roundCount=9 → 通过 → 执行   │
│  Agent B: 检查 → roundCount=10 → 通过 → 执行  │
│  Agent C: 检查 → roundCount=11 → 阻止        │
└─────────────────────────────────────────────┘
```

并行模式下通过 `chain-state-store.ts` 的共享状态存储 + 锁机制保证原子性。

**示例**：roundCount=8，maxRounds=10，3 个 Agent 并行

```
初始状态: roundCount = 8

Agent A: atomicCheckAndIncrement() → roundCount = 9 → 允许执行
Agent B: atomicCheckAndIncrement() → roundCount = 10 → 允许执行
Agent C: atomicCheckAndIncrement() → roundCount = 11 > maxRounds → 被阻止

最终: Agent A 和 B 执行，Agent C 被阻止
```

### 4.3 Agent 互相触发

Agent 回复中 @其他 Agent 时，仍属同一对话链，继续累加 `roundCount`：

```
Owner 消息 → roundCount = 0
  ↓
Agent A 触发 → roundCount = 1 → 回复并 @B
  ↓
Agent B 被触发 → roundCount = 2 → 回复
  ↓
...直到 roundCount >= maxRounds → 对话链自然结束
  ↓
（Owner 发新消息才能开启下一轮）
```

**对话链边界**：对话链在以下情况结束：所有 Agent 回复完成、chainTimeout 超时、maxRounds 耗尽。对话链结束后不清零——等 Owner 下次发消息时才清零并开启新链。

### 4.4 maxRounds 典型场景

#### 场景 1：串行级联触发直到 maxRounds 阻止

```
maxRounds = 3，单播模式

T=0:    Owner 发消息 @ Agent A → initChainState → roundCount = 0
T=1:    Agent A 触发 → roundCount = 1 → 执行 → 回复并 @ Agent B
T=3:    Agent B 触发 → roundCount = 2 → 执行 → 回复并 @ Agent C
T=5:    Agent C 触发 → roundCount = 3 = maxRounds → 执行 → 回复并 @ Agent D
T=7:    Agent D 尝试触发 → roundCount=4 >= maxRounds=3 → ❌ 阻止
T=7:    → maxRounds 耗尽 → chainTimeout 监控清除 → 对话链结束
```

**结果**：A、B、C 依次执行，D 被 maxRounds 阻止。

#### 场景 2：广播初始派发耗尽 maxRounds

```
maxRounds = 3，广播模式

T=0:    Owner 发消息 @ Agent A、B、C → roundCount = 0
T=1:    Agent A 触发 → roundCount = 1 → 执行中
T=1:    Agent B 触发 → roundCount = 2 → 执行中
T=1:    Agent C 触发 → roundCount = 3 = maxRounds → 执行中
T=3:    Agent A 回复完成 → 回复中 @ Agent D → D 尝试触发 → ❌ 阻止（roundCount=4 >= 3）
T=5:    Agent B 回复完成 → 回复中 @ Agent E → E 尝试触发 → ❌ 阻止
T=6:    Agent C 回复完成 → 回复中 @ Agent F → F 尝试触发 → ❌ 阻止
T=6:    → 所有 Agent 完成 + maxRounds 耗尽 → 对话链结束
```

**结果**：初始 3 个 Agent 执行完毕后，各自的级联触发全部被 maxRounds 阻止。

#### 场景 3：maxRounds 未耗尽，由 chainTimeout 终止

```
maxRounds = 100，chainTimeout = 8 分钟，广播模式

T=0:    Owner 发消息 @ Agent A、B → 启动 monitor
T=1:    Agent A 触发 → roundCount = 1 → 执行中
T=1:    Agent B 触发 → roundCount = 2 → 执行中
T=3:    Agent A 回复完成 → @ Agent C
T=3:    Agent C 触发 → roundCount = 3 → 执行中（耗时 10 分钟）
T=8:    chainTimeout 触发！→ Agent C 被终止（roundCount 仅为 3，远未到 maxRounds=100）
T=8:    → 对话链超时结束
```

**结果**：maxRounds 设置很大时，chainTimeout 成为主要的终止手段。maxRounds 防的是无限循环，chainTimeout 防的是单个 Agent 执行过长。

#### 场景 4：Owner 在 Agent 执行中发新消息（立即清零）

```
chainTimeout = 8 分钟，单播模式

T=0:    Owner 发消息 M1 @ Agent A → initChainState → 启动 monitor
T=1:    Agent A 触发 → roundCount = 1 → 执行中
T=3:    Owner 发消息 M2 @ Agent B → 立即 initChainState！
        → 旧链的 monitor 被清除
        → roundCount = 0（重新开始）
        → 启动新 monitor
T=3:    Agent B 触发 → roundCount = 1 → 执行中
```

**结果**：Owner 的 M2 立即打断 M1 的对话链，开启全新的对话链。Agent A 如果还在执行，其 AbortSignal 被触发，执行被中断。

**设计意图**：Owner 是对话链的唯一控制者。Owner 说话意味着"我要开始新的对话"，无需等待旧链完成。

---

## 五、超时处理

### 5.1 三个超时参数的职责分工

```
┌─────────────────────────────────────────────────────┐
│  chainTimeout = 对话链总时长上限（运行时监控）        │
│  → 超时后终止所有正在执行的 Agent                    │
│  → 阻止后续 Agent 触发                               │
│  → 这是"最后一道门"，保证对话链不会无限延续           │
├─────────────────────────────────────────────────────┤
│  cliTimeout = 单次 CLI 命令超时（运行时监控）        │
│  → 超时后 kill PTY 进程                              │
│  → 这是"单命令防护"，防止单个命令挂起                 │
├─────────────────────────────────────────────────────┤
│  maxRounds = Agent 触发总次数上限（触发前检查）        │
│  → 防止乒乓/环路                                     │
└─────────────────────────────────────────────────────┘
```

### 5.2 chainTimeout 设计意图

`chainTimeout` 是**对话链总时长上限**，采用**运行时监控**实现。

- **核心原则**：从对话链开始（Owner 发消息）到所有 Agent 完成，总时长不得超过 `chainTimeout`
- **超时后行为**：
  - **已触发且正在执行的 Agent** → 通过 `AbortSignal` 主动终止
  - **尚未触发的 Agent** → `atomicCheckAndIncrement` 阻止触发
  - **对话链状态** → 清除 monitor，对话链处于"已死"状态，等待 Owner 下一条消息重新开始

### 5.3 两层检查机制

chainTimeout 同时具备两层检查：

| 检查层     | 时机         | 作用                 | 位置                         |
| ---------- | ------------ | -------------------- | ---------------------------- |
| 触发前检查 | Agent 触发前 | 阻止尚未触发的 Agent | `atomicCheckAndIncrement`    |
| 运行时监控 | Agent 执行中 | 终止已触发的 Agent   | `chain-timeout.ts` (monitor) |

两者配合：monitor 负责终止运行中的 Agent，触发前检查负责阻止后续 Agent。即使 monitor 未启动（如极端异常），触发前检查也能保证不会继续触发新 Agent。

### 5.4 场景 A：Agent 在超时前完成

```
chainTimeout = 8 分钟（广播模式）

T=0:    Owner 发消息 → 启动 monitor（8 分钟后触发）
T=1:    Agent A 触发 → 通过 → 开始执行（耗时 2 分钟）
T=3:    Agent A 回复完成
T=3:    Agent B 触发 → 通过 → 开始执行（耗时 1 分钟）
T=4:    Agent B 回复完成 → 所有 Agent 完成 → 对话链自然结束
```

**结果**：对话链总时长 4 分钟，在超时前自然结束。

### 5.5 场景 B：Agent 执行时间超过 chainTimeout

```
chainTimeout = 8 分钟（广播模式）

T=0:    Owner 发消息 → 启动 monitor（T=8 时触发）
T=1:    Agent A 触发 → 通过 → 开始执行（需要 15 分钟完成）
T=8:    monitor 超时触发！
        → abortController.abort()（终止 LLM Agent）
        → killBridgePty()（终止 CLI Agent）
T=8:    Agent A 被强制终止
```

**结果**：A 被终止，对话链在 8 分钟时结束。

### 5.6 场景 C：并行模式下部分 Agent 超时

```
chainTimeout = 8 分钟（广播模式）

T=0:    Owner 发消息 → 启动 monitor
T=1:    Agent A 触发 → 通过 → 执行 2 分钟
T=1:    Agent B 触发 → 通过 → 执行 15 分钟
T=1:    Agent C 触发 → 通过 → 执行 1 分钟
T=2:    Agent C 回复完成
T=3:    Agent A 回复完成
T=8:    monitor 超时触发！
        → Agent B 被强制终止（仍在执行中）
        → Agent A/C 不受影响（已完成）
```

**结果**：A/C 正常完成，B 被终止。

### 5.7 为什么需要运行时监控？

如果只用触发前检查（无 monitor），存在以下漏洞：

1. **并行长执行**：3 个 Agent 同时触发，各执行 30 分钟，对话链持续 30 分钟远超 8 分钟限制
2. **单个 Agent 挂起**：CodeBuddy 执行 `sleep 600`，对话链持续 10 分钟
3. **CLI 进程无限制**：没有 `cliTimeout` 时，CLI 命令可以无限运行

运行时监控是 `chainTimeout` 作为"对话链总时长上限"的核心保障。

---

## 六、边界情况

### 6.1 页面刷新影响

前端状态存储在浏览器内存中，刷新后会丢失：

| 组件                    | 存储位置   | 刷新后  | 影响             |
| ----------------------- | ---------- | ------- | ---------------- |
| 后端 `store`            | 服务端内存 | ✅ 保留 | 触发控制不受影响 |
| 前端 `groupChainStates` | 浏览器内存 | ❌ 丢失 | UI 显示可能错误  |

**结论**：刷新页面不影响核心功能，后端仍是唯一真实来源。前端同步机制仅用于 UI 显示正确性。

### 6.2 Owner 唯一性

每个群组只有一个 Owner。Owner 发消息会立即终止当前对话链并开启新的一轮。

### 6.3 并行错误隔离

使用 `Promise.allSettled`，一个 Agent 失败不影响其他 Agent。

### 6.4 CLI Agent

额外受 `cliTimeout` 限制单次命令执行时间。

---

## 七、参数一览

### 用户可配置（Layer 1）

| UI 名称      | 字段名         | 默认值                     | 说明                                                  |
| ------------ | -------------- | -------------------------- | ----------------------------------------------------- |
| 最大轮数     | `maxRounds`    | 10                         | Agent 回复的最大总次数，Owner 发新消息时清零          |
| 对话链超时   | `chainTimeout` | 单播 15 分钟 / 广播 8 分钟 | 对话链总时长上限，超时后终止所有 Agent 并阻止后续触发 |
| CLI 执行超时 | `cliTimeout`   | 5 分钟                     | 单次 CLI 命令最长执行时间                             |

### 后端硬限制（Layer 2）

| 常量名               | 值     | 说明             |
| -------------------- | ------ | ---------------- |
| `CHAIN_MAX_COUNT`    | 20     | 兜底最大回复次数 |
| `CHAIN_MAX_DURATION` | 5 分钟 | 兜底最大持续时间 |
