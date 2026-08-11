# 小吴聊天助手 · 完整重构执行方案

> 本文档是一份**可直接执行的施工图**：每个文件写什么、每个文件删什么、每段逻辑怎么迁、每个测试怎么改、按什么顺序做、怎么验收。不需要你再做任何决定。
> 前置：`docs/chat-redesign/index.html` 的 5 套渲染 mockup（A Focus / B Console / C Report / D Cards / E Studio）是回复渲染的视觉参考，本方案的渲染层取其精华（A/C/B），其余为架构重构。
> 目标：**Turn 一等公民化 + agent 引擎纯逻辑化 + 审批模块化 + 分型渲染 + 入口升级**。1806 行的 `store.ts` 拆成 ~200 行薄壳。

---

## 0. 为什么这么重构（30 秒版）

| 现状痛点 | 根因 | 本方案的解法 |
|---|---|---|
| 一次问答被拆成 N 条消息、靠 `_loopGroup` 拼回 | **Turn 不是数据模型的一等公民** | 新增 `Turn` 类型，一次问答 = 一个对象 |
| `store.ts` 1806 行，改一处怕十处 | 单 store 揉进十几件事 | 按职责拆成 6 个模块，store 变薄壳 |
| 审批是 `hasOtherPending` 索引 hack | 审批不是产品模块 | 独立 `approval.ts` 队列，引擎 `await` 天然串行 |
| 所有对话用同一套"时间线+步骤卡+结论"模板 | 对话类型单一渲染 | `decideTurnMode` 分型渲染 |
| 4 个函数 + 2 个状态给"模型贴 JSON"打补丁 | 提示工程问题混进渲染层 | 删除泄漏抑制，改由 system prompt 约束 |
| 入口只显示一个"新"字 | 未读是状态不是内容 | 未读变内容预览 + 待审批标记 |

**明确不做**：不换右停靠面板形态、不换 Live2D 形象、不换 LLM 协议层（`llm/` 原样保留）、不换 model-config / connectivity / 工具层。

---

## 1. 目标文件树（新旧对照）

```
src/features/chat/
├── index.ts                  【改】barrel 增减导出
├── config.ts                 【留】不动
├── types.ts                  【改】精简为协议消息类型，re-export UI 类型
├── ui-types.ts               【新】ChatUiBlock / ChatUiKind（外部契约，保持旧结构）
├── turns.ts                  【新】Turn / ToolStep 类型 + 派生 + slim
├── approval.ts               【新】审批队列模块
├── sessions.ts               【新】会话 CRUD + 持久化 + 旧格式迁移
├── store.ts                  【改】1806 → ~200 行薄壳
├── connectivity.ts           【留】不动（ModelWidget 依赖）
├── settings.ts               【留】不动（数值参数保留）
├── utils.ts                  【改】删泄漏检测；保留时间/图片校验/token 估算
├── markdown.ts               【留】不动（去掉 streaming 复制的 hack 可选）
├── vision-models.ts          【留】不动
├── model-modal-bridge.ts     【留】不动
├── useChatHotkeys.ts         【留】不动
├── agent/
│   ├── loop.ts               【新】Agent 循环引擎（纯逻辑，可单测）
│   └── build-messages.ts     【新】Turn → OpenAI 消息 + system prompt + 截断 + clip
├── feedback/
│   ├── index.ts              【新】rate / regenerate 入口
│   ├── preference-log.ts     【搬】现有 preference-log.ts 原样搬入
│   └── few-shot.ts           【搬】现有 few-shot.ts 原样搬入
├── generative-ui.ts          【改】保留 uiBlocksFromToolResult 等；收敛 ui.render 冲突
└── components/
    ├── ChatPanel.vue         【改】4 区布局
    ├── ChatPanelHeader.vue   【留】不动
    ├── NotificationBar.vue   【新】连通性/错误/审批三合一条
    ├── ChatTurnList.vue      【新】替代 ChatMessageList.vue
    ├── TurnCard.vue          【新】分型渲染卡（核心）
    ├── AnswerCard.vue        【新】最终回答卡（markdown + UI 卡 + 动作行）
    ├── TurnProcess.vue       【新】可展开过程抽屉（步骤 + 审批 + 结果）
    ├── ToolActivityRow.vue   【留】TurnProcess 内复用
    ├── GenerativeUiBlock.vue 【留】不动
    ├── ChatComposer.vue      【留】不动
    ├── ChatEmptyState.vue    【留】不动
    ├── SessionListPopover.vue【改】行加会话状态
    ├── ChatSettingsPopover.vue【改】高级参数折叠
    ├── ChatLauncher.vue      【改】未读内容预览 + 待审批标记
    └── [删除] AssistantTurn.vue / AssistantAnswer.vue / ChatMessageItem.vue / ApprovalBar.vue
```

---

## 2. 核心新文件规格（可直接照抄）

### 2.1 `turns.ts` —— Turn 数据模型

```ts
import type { ChatMessage, ChatUiBlock, FeedbackCategory } from './types'
import type { ToolApproval } from './approval'

/** 一次完整问答的状态 */
export type TurnStatus = 'running' | 'waiting_approval' | 'done' | 'aborted' | 'failed'

/** 回合内的一次工具调用 */
export interface ToolStep {
  tool: string                        // 线上名，如 reach__search
  label: string                       // 人类可读「搜索外部资料」
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error' | 'pending'
  startTime?: number
  endTime?: number
  duration?: number
  result?: string                     // 写盘前裁剪；完整结果在内存供预览
  uiBlocks?: ChatUiBlock[]            // 该工具自动生成的 UI 卡
  approval?: ToolApproval             // 需审批时挂载
}

/** 一次问答（持久化 + 渲染的第一等公民） */
export interface Turn {
  id: string
  userContent: string                 // 用户输入
  images?: string[]                   // 内存态：agent 多轮用；写盘前剥离
  steps: ToolStep[]                   // 工具步骤（可为空 = 纯问答）
  answer: string                      // 最终回答（流式累积）
  uiBlocks: ChatUiBlock[]             // 回答级 UI 卡
  status: TurnStatus
  feedback?: 'up' | 'down'
  qualityCategory?: FeedbackCategory
  createdAt: number
  updatedAt: number
  /** 内存态：RAG/视觉补充上下文，写盘前剥离 */
  hiddenContexts?: ChatMessage[]
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function newTurn(userContent: string, images?: string[]): Turn {
  return { id: genId('t'), userContent, images, steps: [], answer: '', uiBlocks: [],
           status: 'running', createdAt: Date.now(), updatedAt: Date.now() }
}

/** 写盘前瘦身：剥离 images / hiddenContexts，裁剪 step.result */
export function slimTurn(t: Turn): Turn {
  const { images, hiddenContexts, ...rest } = t
  return { ...rest, steps: t.steps.map((s) =>
    s.result && s.result.length > 800 ? { ...s, result: s.result.slice(0, 800) + '\n…（已截断）' } : s) }
}
```

### 2.2 `approval.ts` —— 审批队列

```ts
import { computed, ref } from 'vue'
import type { ToolStep } from './turns'

export interface ToolApproval {
  title: string; description: string; risk: string
  args: Record<string, unknown>
  decision?: 'approved' | 'rejected'
  decidedAt?: number
}

export interface PendingItem { turnId: string; stepIndex: number; step: ToolStep }

const pending = ref<PendingItem[]>([])
const resolvers = new Map<string, (d: 'approved' | 'rejected') => void>()
const key = (turnId: string, i: number) => `${turnId}:${i}`

/** 引擎在工具执行前调用；Promise 悬置直到用户在 UI 批准/拒绝 */
export function useApprovalQueue() {
  function requestApproval(turnId: string, stepIndex: number, step: ToolStep): Promise<'approved' | 'rejected'> {
    step.status = 'pending'
    pending.value.push({ turnId, stepIndex, step })
    return new Promise((resolve) => resolvers.set(key(turnId, stepIndex), resolve))
  }
  function settle(turnId: string, stepIndex: number, d: 'approved' | 'rejected') {
    const k = key(turnId, stepIndex)
    resolvers.get(k)?.(d); resolvers.delete(k)
    pending.value = pending.value.filter((p) => !(p.turnId === turnId && p.stepIndex === stepIndex))
  }
  /** 批准后引擎继续执行该工具；拒绝后引擎注入 approvalRejected 结果 */
  function approve(turnId: string, stepIndex: number) { settle(turnId, stepIndex, 'approved') }
  function reject(turnId: string, stepIndex: number)  { settle(turnId, stepIndex, 'rejected') }
  /** 全部批准（ApprovalBar 用） */
  function approveAll() { for (const p of [...pending.value]) approve(p.turnId, p.stepIndex) }
  /** 中止/换会话时清理未决审批 */
  function clearForTurn(turnId: string) {
    pending.value = pending.value.filter((p) => p.turnId !== turnId)
    for (const [k, r] of resolvers) if (k.startsWith(turnId + ':')) { r('rejected'); resolvers.delete(k) }
  }
  return {
    pendingApprovals: computed(() => pending.value),
    requestApproval, approve, reject, approveAll, clearForTurn,
  }
}
```

> **并发审批的消失**：多个工具并行执行时，每个 `await requestApproval(...)` 都悬置，`Promise.all` 自然等到全部决策。不再有 `hasOtherPending` / `brokeForPending` / `truncateAfterToolResult`。

### 2.3 `agent/loop.ts` —— 循环引擎（纯逻辑，可单测）

```ts
import type { Turn, ToolStep } from '../turns'
import type { ToolApproval } from '../approval'
import type { ChatMessage } from '../types'

export interface LoopDeps {
  buildApiMessages(turn: Turn): ChatMessage[]                    // Turn → OpenAI 消息
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  approvalPolicy(tool: string, args: Record<string, unknown>): ToolApproval | null
  requestApproval(step: ToolStep, policy: ToolApproval): Promise<'approved' | 'rejected'>
  onAnswerDelta(delta: string): void                             // 流式文本 → turn.answer
  onPhase(p: 'thinking' | 'working' | 'composing'): void
  signal: AbortSignal
  maxRounds: number
  maxOutputTokens: number
}

/**
 * 跑一个 Turn 到终态。
 * 轮 = 一次模型调用。有 tool_calls → 建 ToolStep → 审批 → 执行 → 回灌 → 下一轮；
 * 无 tool_calls → 流式累积 answer → status='done'。
 */
export async function runTurn(turn: Turn, deps: LoopDeps): Promise<void> {
  const rounds = Math.max(1, deps.maxRounds)
  for (let r = 0; r < rounds; r++) {
    deps.onPhase(turn.steps.length ? 'thinking' : 'thinking')
    const { toolCalls } = await chatStream(deps.buildApiMessages(turn), {          // ①
      signal: deps.signal, tools: TOOLS, temperature: 0.3, maxTokens: deps.maxOutputTokens,
      onText: (delta) => { turn.answer += delta; deps.onAnswerDelta(delta) },
    })
    if (deps.signal.aborted) return

    if (!toolCalls.length) { turn.status = 'done'; return }                        // ② 最终回答

    deps.onPhase('working')
    const results = await Promise.all(toolCalls.map(async (tc, i) => {             // ③ 并行工具
      const step: ToolStep = {
        tool: tc.function.name, label: labelFor(tc.function.name),
        args: safeParse(tc.function.arguments), status: 'running',
        startTime: Date.now(),
      }
      turn.steps.push(step)
      const policy = deps.approvalPolicy(step.tool, step.args)
      if (policy) {                                                               // ④ 审批阻塞点
        step.approval = policy
        const d = await deps.requestApproval(turn.id, turn.steps.length - 1, step)
        if (d === 'rejected') {
          step.status = 'error'; step.result = JSON.stringify({ approvalRejected: true, tool: step.tool })
          step.endTime = Date.now(); step.duration = step.endTime - step.startTime
          return step.result
        }
      }
      try {                                                                       // ⑤ 执行 + UI 卡
        const raw = await deps.callTool(step.tool, step.args, deps.signal)
        step.status = (raw as any)?.error ? 'error' : 'done'
        step.result = JSON.stringify(raw)
        step.endTime = Date.now(); step.duration = step.endTime - step.startTime
        return step.result
      } catch (e) {
        step.status = 'error'; step.result = JSON.stringify({ error: (e as Error)?.message || '工具执行失败' })
        step.endTime = Date.now(); step.duration = step.endTime - step.startTime
        return step.result
      }
    }))
    // ⑥ 回灌 tool 消息 + 补充上下文（RAG/视觉），进入下一轮
    turn.hiddenContexts = await buildHiddenContexts(turn)
  }
  // ⑦ 用尽轮数兜底
  turn.status = 'done'
}
```

> **停止/继续**：外部 `AbortController.abort()` → 模型 fetch 抛 AbortError → `runTurn` 抛出 → store catch 设 `turn.status='aborted'`（`turn.answer` 半成品原地保留）。继续 = 新起一次 `runTurn`，但跳过首轮 user、从当前 `steps`/`answer` 之后续跑（实现：`buildApiMessages` 识别半成品 turn，追加一条 system「继续完成刚才的回答」）。
> **重试单工具**：`retryTool(turnId, stepIndex)` → 清 step 状态 → `runTool(step)` → 替换 `result` → 重跑 answer 阶段。
> **重答**：`regenerate()` → 记老 answer 进 preference → 清空 `turn.answer` + `turn.steps` → 重新 `runTurn`。

### 2.4 `sessions.ts` —— 会话 + 迁移

```ts
import { useStorage } from '@/composables/useStorage'
import { setLocalStorageItem } from '@/features/storage-health'
import type { Turn } from './turns'
import { genId, slimTurn } from './turns'

export interface ChatSession {
  id: string; title: string; turns: Turn[]; createdAt: number; updatedAt: number
}
export const MAX_SESSIONS = 50
const KEY = 'hao123-chat-sessions'

/** 旧格式（messages: ChatMessage[]）→ 新格式（turns: Turn[]）一次性迁移 */
export function migrateLegacySessions(raw: unknown): ChatSession[] | null {
  if (!Array.isArray(raw)) return null
  const hasNew = raw.every((s: any) => s && Array.isArray(s.turns))
  if (hasNew) return raw as ChatSession[]
  const old = raw.filter((s: any) => s && Array.isArray(s.messages))
  if (!old.length) return null
  return old.map((s: any) => ({
    id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
    turns: groupMessagesToTurns(s.messages),   // 见 5. 数据迁移
  }))
}

export function loadSessions(): ChatSession[] {
  const raw = localStorage.getItem(KEY)
  if (raw) {
    try {
      const migrated = migrateLegacySessions(JSON.parse(raw))
      if (migrated) { /* 迁移成功后立即写回新格式 */ return migrated }
    } catch { /* 回退空 */ }
  }
  return []
}

let timer: ReturnType<typeof setTimeout> | null = null
export function schedulePersist(list: () => ChatSession[]) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    setLocalStorageItem(KEY, JSON.stringify(list().map((s) => ({
      id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
      turns: s.turns.map(slimTurn),
    }))))
  }, 400)
}
export function flushPersist(list: () => ChatSession[]) { /* 清 timer + 立即写盘 */ }

export function deriveSessionTitle(turns: Turn[]): string {
  const first = turns.find((t) => t.userContent.trim())
  const raw = first?.userContent.replace(/\s+/g, ' ').trim()
  if (!raw) return '新的协作会话'
  return raw.length > 28 ? raw.slice(0, 28) + '…' : raw
}
```

> **性能根除**：不再"流式每 token 触发的 deep watch 整库 stringify"。只有 turn 收尾（status 落定 / answer 完成 / 停止 / 删除）才 `schedulePersist`。流式期间只写内存。

### 2.5 `agent/build-messages.ts` —— 协议组装（搬迁）

把 store.ts 里这些函数原样搬入（签名不变、逻辑不变）：
- `buildStaticSystemPrompt` / `buildCapabilitiesFromTools` / `dynamicContextMessage`
- `buildApiMessages(turn)`：把 `Turn` 压成 OpenAI 消息序列——`system → 动态system → truncateHistory(turnMessages) → (fewShot) → user(带图) → 每步 assistant(tool_calls)+tool → answer`。
- `truncateHistory` / `estimateTokens` / `estimateMessageTokens`（从 utils.ts 迁入）
- `clipForModel` / `trimLongStrings` / `fieldMaxFor`
- `buildHiddenContexts(turn)`：RAG 候选证据 + 视觉上下文（从 store 的 `ambientKbContextFromUser` / `visionContextFromToolResult` 搬入）

**新增一条 system prompt 约束**（替代 JSON 泄漏抑制，删除渲染层兜底）：
```
'- 工具返回的 JSON 是内部素材，绝不整段贴进回答正文，也不要用 JSON 代码块展示；一律用自己的话整理成自然语言。'
```

### 2.6 `store.ts` —— 薄壳（~200 行）

```ts
export const useChatStore = defineStore('chat', () => {
  const open = ref(false)
  const unread = ref(false)
  const streaming = ref(false)
  const turnPhase = ref<'idle'|'thinking'|'working'|'composing'|'done'|'aborted'|'failed'>('idle')
  const error = ref<string | null>(null)
  const feedbackStats = useStorage('hao123-chat-feedback', defaultFeedbackStats())
  // 会话层（turns 化）
  const sessions = ref<ChatSession[]>(loadSessions())
  const activeSessionId = useStorage<string | null>('hao123-chat-active-session', null)
  const activeSession = computed(() => sessions.value.find((s) => s.id === activeSessionId.value) ?? null)
  const activeTurns = computed(() => activeSession.value?.turns ?? [])
  const hasMessages = computed(() => activeTurns.value.some((t) => t.userContent || t.answer || t.uiBlocks.length))

  const configured = computed(() => llm.configured)
  const { pendingApprovals, approve, reject, approveAll, clearForTurn } = useApprovalQueue()
  const connectivity = useConnectivity()

  let controller: AbortController | null = null
  let currentRun: Promise<void> | null = null

  /** 内部：提交一个 Turn 并跑引擎 */
  async function submitTurn(turn: Turn) {
    controller?.abort(); clearForTurn(turn.id)
    const c = new AbortController(); controller = c
    streaming.value = true; turnPhase.value = 'thinking'
    const p = runTurn(turn, makeDeps(turn, c.signal))
    currentRun = p
    try {
      await p
      markSuccess(); turnPhase.value = 'done'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        turn.status = 'aborted'; turnPhase.value = 'aborted'
      } else {
        const reason = classifyError(e)
        reason ? markUnreachable(reason) : (clearConnectivityIssue(), error.value = message)
        turn.status = 'failed'; turnPhase.value = 'failed'
      }
    } finally {
      if (controller === c) { streaming.value = false; controller = null }
      if (!open.value) unread.value = true
      schedulePersist(() => sessions.value)
    }
  }

  // ============ 对外契约（外部消费者不动） ============
  function send(text: string, images: string[] = []) {
    if (streaming.value) await stop()          // 打断重发
    const turn = newTurn(text, images.length ? images : undefined)
    activeSession.value!.turns.push(turn)
    void submitTurn(turn)
  }
  function show() { open.value = true; unread.value = false }
  function close() { open.value = false }
  function toggle() { open.value = !open.value; if (open.value) unread.value = false }
  function openModelConfig() { openModelConfigModal() }
  async function stop() { controller?.abort(); await currentRun?.catch(() => {}) }

  // ============ 会话 CRUD（委托 sessions.ts） ============
  async function newSession() { /* stop → 建空会话 → capSessions */ }
  async function switchSession(id) { /* stop → flushCurrent → 切 */ }
  async function deleteSession(id) { /* stop → 删 → 回落 */ }
  function renameSession(id, title) { /* 同现状 */ }

  // ============ 回合操作（委托引擎/审批/feedback） ============
  function approveTool(turnId, stepIndex) { approve(turnId, stepIndex) }
  function rejectTool(turnId, stepIndex) { reject(turnId, stepIndex) }
  function approveAllPending() { approveAll() }
  function retryTool(turnId, stepIndex) { /* 见 loop.ts */ }
  function regenerate() { /* 见 feedback/index.ts */ }
  function rate(turnIndex, rating) { /* 见 feedback/index.ts */ }
  function resumeAfterStop() { /* 半成品 turn 续跑 */ }
  function retryConnection() { /* 同现状 */ }

  return { open, unread, streaming, turnPhase, error, configured, hasMessages,
           sessions, activeSession, activeSessionId, activeTurns, pendingApprovals,
           feedbackStats, show, close, toggle, send, stop, openModelConfig,
           newSession, switchSession, deleteSession, renameSession,
           approveTool, rejectTool, approveAllPending, retryTool, regenerate, rate,
           resumeAfterStop, retryConnection }
})
```

---

## 3. 旧文件处置表

| 文件 | 处置 | 说明 |
|---|---|---|
| `store.ts` | **重写**为 2.6 | 逻辑全部搬出 |
| `types.ts` | **重写** | `ChatMessage` 精简为协议形态（`role/content/images/tool_calls/tool_call_id`）；`ChatUiBlock/ChatUiKind` re-export 自 `ui-types.ts`；删 `ToolActivity`、`ChatSession`（移入 turns/sessions）、`FeedbackCategory` 保留（feedback 用） |
| `utils.ts` | **改** | 删 `startsWithJson` / `isRawJsonLeak` / `stripIrrelevantKbMeta`；`estimateTokens/estimateMessageTokens/truncateHistory` 迁入 `agent/build-messages.ts`；保留 `daypart/formatDate/formatTime/validateImageAdd` |
| `generative-ui.ts` | **改** | 保留 `uiBlocksFromToolResult` / `uiBlocksFromRenderResult` / `summarizeUiRenderResult`；`ui.render` 工具描述追加"凡有工具自动卡场景不要再调"条款 |
| `connectivity.ts` | **留** | 不动 |
| `settings.ts` | **留** | 不动 |
| `preference-log.ts` / `few-shot.ts` | **搬** | 原样搬入 `feedback/`，`FEW_SHOT_ENABLED` kill-switch 保留 |
| `llm/` | **留** | 全部不动 |
| `components/AssistantTurn.vue` | **删** | 被 TurnCard + TurnProcess 替代 |
| `components/AssistantAnswer.vue` | **删** | 被 AnswerCard 替代 |
| `components/ChatMessageItem.vue` | **删** | 被 TurnCard 替代 |
| `components/ApprovalBar.vue` | **删** | 并入 NotificationBar |
| `components/ChatMessageList.vue` | **删** | 被 ChatTurnList 替代 |

---

## 4. 组件规格

### 4.1 `decideTurnMode.ts`（纯函数，新文件）

```ts
export type TurnMode = 'answer-first' | 'report' | 'taskflow'
export function decideTurnMode(turn: { steps: ToolStep[]; answer: string }): TurnMode {
  if (turn.steps.some((s) => s.approval || s.status === 'pending')) return 'taskflow'
  const hasWrite = turn.steps.some((s) => /^(git|local|wbscf|claude)__/.test(s.tool))
  if (hasWrite && turn.steps.length > 0) return 'taskflow'
  const isResearch = turn.steps.some((s) => s.tool.startsWith('reach__') || s.tool.startsWith('webdoc__'))
  if (isResearch && turn.answer.length >= 2000) return 'report'
  if (turn.steps.length > 2 && turn.answer.length >= 2000) return 'report'
  return 'answer-first'
}
```

### 4.2 `TurnCard.vue` —— 分型渲染（核心）

- props: `turn: Turn`, `isLast: boolean`, `streaming: boolean`
- `mode = decideTurnMode(turn)`；用户可在卡上手动切换（`v-model` 记忆到 `localStorage['hao123-turn-mode-override']`）。
- 三种形态共用三段结构，**答案永远在过程之上**：

```
┌─────────────────────────────────────────────┐
│ [answer-first]  用户气泡 → AnswerCard        │
│                 └ 折叠行：已查询 · 天气 · 任务  │
├─────────────────────────────────────────────┤
│ [report]        AnswerCard（报告式）          │
│                 └ 底部「打开过程附录」          │
├─────────────────────────────────────────────┤
│ [taskflow]      TurnProcess（步骤+审批，内联）│
│                 └ AnswerCard（结论在上）       │
└─────────────────────────────────────────────┘
```

### 4.3 `TurnProcess.vue` —— 过程抽屉

- 折叠态：一行 `🔍 3 个动作 · 2 成功 1 失败`（人类可读标签，不裸示 `reach__search`）。
- 展开态：每步一个 `ToolActivityRow`（复用现有）+ 结果 `<details>`；pending 步显示审批按钮。
- **审批按钮不再嵌在深处**：pending 步在 TurnCard 右侧出常驻「批准 / 拒绝」主按钮 + NotificationBar 顶部审批条。

### 4.4 `NotificationBar.vue` —— 三合一条

按优先级只显示一条：`待审批（琥珀，最高）> 业务错误（红）> 连通性（琥珀）`。点击审批条 → 滚动到对应 Turn。删掉 ChatPanel 里现存的三个独立横幅（`degraded` / `error-bar` / `ApprovalBar`）。

### 4.5 `ChatTurnList.vue`

替代 `ChatMessageList.vue`：遍历 `activeTurns` 渲染 `TurnCard`，保留滚动跟随 + 回到最新 + 时间分隔线。删掉 `_loopGroup` 分组逻辑（30 行直接消失）。

### 4.6 `SessionListPopover.vue`

每行标题后追加会话状态徽标：`✓ 已完成` / `⏳ 等待确认`（取最后一个 turn 的 status）。

### 4.7 `ChatSettingsPopover.vue`

6 个数值字段折叠进"高级参数"（默认收起）；首屏改为：模型线路快捷切换 + 回答风格（简洁/详细/文档化，写入 system prompt）+ 「新会话自动带今日上下文」开关。

### 4.8 `ChatLauncher.vue` —— 入口升级

- 未读由"新"字改为**内容预览**：取最新已完成 turn 的摘要（≤10 字，如「已查好 · 5 条待办」），`unreadPreview` 计算属性暴露自 store。
- 待审批标记：`pendingApprovals.length > 0` 时立绘右下角琥珀点。
- ambient 气泡：接入首页洞察（复用 `companion/speech.ts` 签名去重），点击进面板。

---

## 5. 数据迁移（`groupMessagesToTurns`）

旧 `hao123-chat-sessions` 的 `messages: ChatMessage[]` → 新 `turns: Turn[]`，规则：

1. 遍历 messages，找到每个 `user` 消息为起点。
2. 其后连续的 `assistant`（同 `_loopGroup`）+ `tool` 消息归为一个 Turn：
   - `turn.userContent` = 该 user 的 content
   - `turn.steps` = 每条 assistant 消息的 `activities[]`（含 approval 时保留）
   - `turn.answer` = 该组内 `_loopFinal` assistant 的 content（无则空）
   - `turn.status` = 该组内有 pending → `'waiting_approval'`；有 error → `'failed'`；其余 `'done'`
3. 游离的 user/assistant 对（无 `_loopGroup`）→ 各自成单 Turn（steps 空）。
4. 迁移成功 → 立即 `setLocalStorageItem(KEY, 新格式)` 写回；失败 → 保留旧数据 + `console.warn`，不影响启动。

---

## 6. 测试迁移

| 测试文件 | 处置 |
|---|---|
| `tests/chat-utils.test.ts` | **改**：删 JSON 泄漏/截断相关用例；保留时间、`validateImageAdd`、token 估算 |
| `tests/chat-store.test.ts` | **改**：`store.messages` → `store.activeSession.turns`；重答断言看 `turn.answer`；**删**「本地意图直答」用例（`detectLocalIntent` 已删）；会话上限/切换/删除用例保留语义重写 |
| `tests/chat-approval.test.ts` | **重写**：`approveTool(1,0)` 的消息索引 → `approveTool(turnId, stepIndex)`；"并发审批不截断"用例改为断言"引擎在全部决策后才进入 answer 阶段"（观测 `llm.chatStream` 调用次数） |
| `tests/chat-image-validate.test.ts` | **留**：不动 |
| `tests/chat-preference-log.test.ts` | **留**：不动（文件搬去 `feedback/`，import 路径改一下） |
| `tests/model-config-env.test.ts` | **留**：不动 |
| `tests/agent-loop.test.ts` | **新**：引擎纯逻辑——turn 生命周期、并行工具、审批暂停/恢复（`requestApproval` resolve 后继续）、abort 保留半成品、单工具重试 |
| `tests/decide-turn-mode.test.ts` | **新**：纯函数判定规则锁定 |
| `tests/migrate-sessions.test.ts` | **新**：旧格式 `messages` → 新格式 `turns` 迁移正确性 |

---

## 7. 分阶段执行清单（每阶段独立可合并、可回滚）

> 顺序原则：**先数据模型和引擎（UI 不变），再渲染，最后入口**。全程 `npm run build` + `npm test` 必过。

### Phase 1 · 架构打底（UI 像素级不变）
- [ ] 建 `ui-types.ts`；重写 `types.ts`（协议 ChatMessage + re-export）
- [ ] 建 `turns.ts` / `approval.ts` / `sessions.ts`（含 `migrateLegacySessions`）
- [ ] 建 `agent/loop.ts` / `agent/build-messages.ts`（搬 system prompt + 截断 + clip + 隐藏上下文）
- [ ] 建 `feedback/`（搬 preference-log / few-shot）
- [ ] 重写 `store.ts` 薄壳（UI 状态 + 调度 + 契约），`send()` 改提交 Turn
- [ ] 旧 store 里的 system prompt/审批/feedback 逻辑全部删除
- [ ] 更新 4 个测试文件 + 新增 migrate 测试
- [ ] **验收**：`npm test` 全绿；面板行为与重构前逐像素一致；旧会话历史正确迁移为 Turn 且可继续对话

### Phase 2 · 渲染重构（用户可见的大变化）
- [ ] 建 `decideTurnMode.ts` / `TurnCard.vue` / `AnswerCard.vue` / `TurnProcess.vue` / `NotificationBar.vue` / `ChatTurnList.vue`
- [ ] 重写 `ChatPanel.vue`（4 区）；删 `AssistantTurn / AssistantAnswer / ChatMessageItem / ApprovalBar / ChatMessageList`
- [ ] 更新 `SessionListPopover`（状态徽标）/ `ChatSettingsPopover`（高级参数折叠）
- [ ] **验收**：对照 docs 的 A/C/B mockup 逐场景走：单工具查询（answer-first）、reach 调研（report）、git push + 审批（taskflow）；三形态判定正确、手动切换生效

### Phase 3 · 入口升级
- [ ] 重写 `ChatLauncher.vue`（未读内容预览 + 待审批标记 + ambient 气泡）
- [ ] `Layout.vue` 无改动（组件名保留）
- [ ] **验收**：完整链路——首页洞察 → 桌宠气泡 → 面板深聊 → 审批 → 结论

### Phase 4 · 元功能清理
- [ ] 删 `detectLocalIntent` 及其测试；删 utils 里泄漏检测函数
- [ ] `generative-ui.ts` 收敛 ui.render 冲突条款
- [ ] dev-only 偏好检视面板（读 IDB 看抓了哪些偏好对）
- [ ] **验收**：`npm run build` + `npm test` 全绿；代码量统计 store.ts ≤ 250 行

---

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| Turn 迁移丢历史 | `migrateLegacySessions` 失败保留旧数据只读；回滚 = 把 Phase 1 改动 revert，旧 key 未动 |
| 引擎重写行为回归（审批/停止/重试边角） | `agent-loop.test.ts` 覆盖 approval pause/resume、abort 半成品、retry；Phase 2 全量手测 |
| 分型判定误判 | 纯函数 + 单测锁定 + Turn 卡手动切换兜底 |
| 外部模块依赖 `ChatUiBlock` 结构 | `ui-types.ts` 与旧 `ChatUiKind` 完全同构，reach `ui.ts` 零改动 |

**验收红线**：`npm run build` 通过（`vue-tsc` 类型检查 + 生产构建）、`npm test` 全绿、外部消费者（`Layout` / `InboxDeck` / `GitDashboard` / modao / `ModelWidget`）编译不报错。

---

## 附：一段话总纲

> **把"运算日志"翻成"答案优先的协作空间"：`Turn` 成为数据模型和渲染的一等公民（消灭 `_loopGroup` 分组和 1806 行 store），agent 循环抽成可单测的纯逻辑引擎，审批从 `hasOtherPending` 索引 hack 升为 `requestApproval` 异步队列，对话类型由 `decideTurnMode` 决定 answer-first / report / taskflow 三种形态，入口未读从"新"字升级为内容预览。外部契约（`useChatStore().show/send/configured`、`useConnectivity`、`LlmToolDef`、`ChatUiBlock`）全程不动。4 阶段落地，每阶段独立合并、可回滚。**
