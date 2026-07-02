/**
 * Chat 助手 · 工作台上下文采集（welcome-guide 与每日晨报共享）
 *
 * 把首页 AI 特性需要的「当前工作台快照」采集集中到一处：天气 + 指派给我的禅道任务/Bug
 * + 本地待办，翻成模型易懂的中文行，拼成一段纯文本喂给模型。
 *
 * 为何独立成模块：
 *  - 单一数据源：编码 → 中文映射（状态/优先级/严重程度）只维护一份，避免散落多处不一致；
 *  - 并发去重：首页的「开场引导」与「每日晨报」几乎同时挂载、同时需要上下文，in-flight 去重
 *    让同一时刻的并发调用只发一次禅道请求（对齐 weather store / kb loader 的并发约定）；
 *  - 可复用：未来其它「基于工作台现状生成」的 AI 特性（如周报）直接调用即可。
 */
import { useWeatherStore } from '@/features/weather'
import { useZentaoSession, callZentaoTool } from '@/features/zentao'
import { useLocalTaskStore } from '@/features/local-tasks'
import { daypart } from './utils'

// ============ 编码 → 中文（模型只认人话，编码字段必须翻成中文）============

const TASK_STATUS: Record<string, string> = {
  wait: '未开始', doing: '进行中', done: '已完成', pause: '已暂停', cancel: '已取消', closed: '已关闭',
}
const BUG_STATUS: Record<string, string> = { active: '待解决', resolved: '已解决', closed: '已关闭' }
const SEVERITY: Record<string, string> = { '1': '严重', '2': '主要', '3': '次要', '4': '轻微' }
const PRI: Record<string, string> = { '1': '紧急', '2': '高', '3': '中', '4': '低' }
const label = (map: Record<string, string>, v: unknown) => map[String(v)] || ''

interface TaskItem { name?: string; status?: string; pri?: string | number; deadline?: string }
interface BugItem { title?: string; status?: string; severity?: string | number; pri?: string | number }

/** 取「指派给我」的工作项（带状态/优先级，已翻成中文行）；失败返回空数组 */
async function assignedLines(tool: string, kind: 'task' | 'bug'): Promise<string[]> {
  try {
    const r = (await callZentaoTool(tool, { type: 'assignedTo' })) as { tasks?: TaskItem[]; bugs?: BugItem[] }
    if (kind === 'task') {
      return (r.tasks ?? [])
        .filter((t) => t.name)
        .slice(0, 8)
        .map((t) => {
          const meta = [label(TASK_STATUS, t.status), label(PRI, t.pri) && `优先级${label(PRI, t.pri)}`, t.deadline && `截止${t.deadline}`]
            .filter(Boolean)
            .join('，')
          return `「${t.name}」${meta ? `（${meta}）` : ''}`
        })
    }
    return (r.bugs ?? [])
      .filter((b) => b.title)
      .slice(0, 8)
      .map((b) => {
        const meta = [label(BUG_STATUS, b.status), label(SEVERITY, b.severity) && `${label(SEVERITY, b.severity)}级`]
          .filter(Boolean)
          .join('，')
        return `「${b.title}」${meta ? `（${meta}）` : ''}`
      })
  } catch {
    return []
  }
}

/** 实际采集逻辑（不含缓存） */
async function collect(): Promise<string> {
  const weather = useWeatherStore()
  await weather.ensureReady()
  const session = useZentaoSession()
  const now = new Date()
  // 本地时间（非 UTC）：完整日期 + 星期 + 时段，让生成的建议贴合「今天周几、此刻」
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  const lines: string[] = [`现在是${dateStr} ${daypart(now.getHours())}。`]

  // autoLocate 失败兜底已改为 nearestCity().name（不再写 '当前位置' 占位），故直接取城市名即可。
  const city = weather.cityName || null
  if (city) {
    const wn = weather.now
    const today = weather.daily[0]
    let w = `所在城市：${city}。`
    if (wn) w += `当前${wn.text} ${wn.temp}°C。`
    if (today) w += `今日 ${today.tempMin}~${today.tempMax}°C，白天${today.textDay}。`
    lines.push(w)
  }

  if (session.configured) {
    const [tasks, bugs] = await Promise.all([
      assignedLines('zentao.my_tasks', 'task'),
      assignedLines('zentao.my_bugs', 'bug'),
    ])
    lines.push(tasks.length ? `我的开发任务（${tasks.length} 个）：\n${tasks.join('\n')}` : '当前没有指派给我的开发任务。')
    lines.push(bugs.length ? `测试提给我的 Bug（${bugs.length} 个）：\n${bugs.join('\n')}` : '当前没有测试提给我的 Bug。')
  }

  // 本地待办（手动创建、与禅道无关，始终可用）
  const localStore = useLocalTaskStore()
  const localTasks = localStore.open
    .slice(0, 8)
    .map((t) => `「${t.title}」（${label(PRI, t.pri) ? `优先级${label(PRI, t.pri)}` : ''}${t.deadline ? `，截止${t.deadline}` : ''}）`)
  lines.push(
    localTasks.length
      ? `我的本地待办（${localStore.openCount} 个）：\n${localTasks.join('\n')}`
      : '当前没有本地待办。',
  )

  return lines.join('\n')
}

// ============ 并发去重（同一时刻多个 AI 特性共享一次采集）============

let inflight: Promise<string> | null = null

/**
 * 采集当前工作台上下文，返回喂给模型的纯文本。
 *
 * 同一时刻的并发调用复用同一个 Promise（只发一次禅道请求）；`force=true` 时绕过缓存
 * 重新采集（供「刷新简报」等需要最新数据的场景），且不写入缓存、不影响正在进行的复用。
 */
export function buildDashboardContext(opts: { force?: boolean } = {}): Promise<string> {
  if (!opts.force && inflight) return inflight
  const p = collect().finally(() => {
    if (inflight === p) inflight = null
  })
  if (!opts.force) inflight = p
  return p
}
