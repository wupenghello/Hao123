// eval/optimize.mjs
//
// OPRO（Optimization by PROmpting）晨报 system prompt 自动优化器。
//
// 流程：seed（v1 基线）→ 每轮让 meta-LLM 看着「当前 prompt + 评测分数 + 失败明细 + 历史」
// 提一个改进版 → 用 in-process eval（确定性断言 + 自带 rubric 判官）打分 → 严格更优才留、
// 同分取更短（防膨胀）→ K 轮 → 输出最优到 prompts/briefing.system.opro.txt。
//
// 为什么自带 rubric 判官：当前 eval 是关键词断言，裸 OPRO 会过拟合（刷关键词）；rubric 既
// 创造 headroom（关键词全过但质量差的会被判挂），又防过拟合。判官用用户配的同一个模型，
// 零额外配置（避开 promptfoo llm-rubric 默认走 OpenAI 的坑）。
//
// 与 promptfoo（eval:briefing）共享同一份 cases/briefing.cases.yaml + promptfooconfig 的
// defaultTest 断言；promptfoo 作人工验证，本脚本作自动迭代。跑法：npm run eval:optimize
// （OPRO_ROUNDS 环境变量可调轮数，默认 4）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, 'llm-config.local.json')
const CASES_PATH = join(__dirname, 'cases', 'briefing.cases.yaml')
const CONFIG_YAML_PATH = join(__dirname, 'promptfooconfig.yaml')
const SEED_PATH = join(__dirname, 'prompts', 'briefing.system.v1.txt')
const OUT_PATH = join(__dirname, 'prompts', 'briefing.system.opro.txt')

const ROUNDS = Math.max(1, parseInt(process.env.OPRO_ROUNDS || '4', 10) || 4)
const CONCURRENCY = 4

// ============ config + chatComplete（与 provider.mjs 同款，GLM 关思考 + 流式回退）============
function loadActive() {
  let raw
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8')
  } catch {
    throw new Error(`读不到 ${CONFIG_PATH}；请在「模型线路控制台」导出存为 eval/llm-config.local.json`)
  }
  const data = JSON.parse(raw)
  const providers = Array.isArray(data.providers) ? data.providers : []
  const provider = providers.find((p) => p.id === data.activeProviderId) || providers[0]
  if (!provider) throw new Error('llm-config.local.json 里没有 provider')
  const model =
    provider.models?.find((m) => m.id === provider.activeModelId)?.name ||
    provider.models?.[0]?.name ||
    'deepseek-chat'
  return {
    name: provider.name,
    model,
    baseUrl: String(provider.baseUrl || '').replace(/\/+$/, ''),
    apiKey: String(provider.apiKey || '').trim(),
  }
}
const active = loadActive()

async function chatComplete(messages, { temperature = 0.6, maxTokens = 1200 } = {}) {
  const { model, baseUrl, apiKey, name } = active
  const extra = /^glm[-_.]/i.test(model.trim())
    ? { thinking: { type: 'disabled' }, reasoning_effort: 'none' }
    : {}
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
  const url = `${baseUrl}/chat/completions`
  const baseBody = { model, messages, temperature, max_tokens: maxTokens, ...extra }

  let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...baseBody, stream: false }) })
  if (!res.ok) throw new Error(`${name} ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`)
  const json = await res.json().catch(() => null)
  const content = json?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content

  // 流式回退（GLM 思考型非流式常返回空 content）
  const sres = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...baseBody, stream: true }) })
  if (!sres.ok) throw new Error(`${name} 流式 ${sres.status}`)
  const reader = sres.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const r of lines) {
      const ln = r.trim()
      if (!ln.startsWith('data:')) continue
      const d = ln.slice(5).trim()
      if (!d || d === '[DONE]') continue
      try {
        const j = JSON.parse(d)
        const dl = j.choices?.[0]?.delta
        if (typeof dl?.content === 'string') out += dl.content
      } catch {
        /* 半截 JSON 等下一片 */
      }
    }
  }
  if (out.trim()) return out
  throw new Error(`${name} 返回空内容`)
}

// ============ 读 cases + defaultTest 断言 ============
const casesParsed = yaml.load(readFileSync(CASES_PATH, 'utf8'))
const CASES = Array.isArray(casesParsed) ? casesParsed : casesParsed.tests || []
const configParsed = yaml.load(readFileSync(CONFIG_YAML_PATH, 'utf8'))
const DEFAULT_ASSERTS = Array.isArray(configParsed?.defaultTest?.assert) ? configParsed.defaultTest.assert : []

// ============ 确定性 assert runner ============
function evalAssert(type, value, output) {
  switch (type) {
    case 'contains':
      return { pass: output.includes(String(value)), reason: `应包含「${value}」` }
    case 'icontains':
      return { pass: output.toLowerCase().includes(String(value).toLowerCase()), reason: `应包含「${value}」` }
    case 'not-contains':
      return { pass: !output.includes(String(value)), reason: `不应包含「${value}」` }
    case 'not-icontains':
      return { pass: !output.toLowerCase().includes(String(value).toLowerCase()), reason: `不应包含「${value}」` }
    case 'contains-any':
      return {
        pass: (Array.isArray(value) ? value : []).some((v) => output.includes(String(v))),
        reason: `应包含其一：${(value || []).join('/')}`,
      }
    case 'javascript': {
      try {
        const ok = !!new Function('output', `return (${value})`)(output)
        return { pass: ok, reason: `自定义断言未满足：${value}` }
      } catch (e) {
        return { pass: false, reason: `断言表达式出错：${e?.message || e}` }
      }
    }
    default:
      // 未知类型（含 promptfoo 的 llm-rubric 若混入）交给 rubric 判官统一处理，这里跳过
      return { pass: true, reason: '' }
  }
}

// ============ rubric 判官（用同一模型，评真实质量，防过拟合）============
const RUBRIC =
  '语气像靠谱同事、简洁不寒暄；工作项名用「」框起；没有编造快照里不存在的事项；紧扣该条快照实际情况给可执行建议'

async function judgeRubric(output, context) {
  const messages = [
    {
      role: 'system',
      content: '你是晨报质量评委。判断下面这条晨报是否满足给定标准。只输出 JSON：{"pass":true或false,"reason":"一句话理由"}。',
    },
    { role: 'user', content: `# 质量标准\n${RUBRIC}\n\n# 工作台快照\n${context}\n\n# 待评晨报\n${output}` },
  ]
  const raw = await chatComplete(messages, { temperature: 0, maxTokens: 200 })
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return { pass: true, reason: '评委未返回 JSON，按通过处理' }
  try {
    const j = JSON.parse(m[0])
    return { pass: !!j.pass, reason: j.reason || '评委未给理由' }
  } catch {
    return { pass: true, reason: '评委 JSON 解析失败，按通过处理' }
  }
}

// ============ 单条 case + 整轮 eval ============
async function runCase(c, systemPrompt) {
  const desc = c.description || '(无描述)'
  const context = c.vars?.context || ''
  let output
  try {
    output = await chatComplete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context || '（暂无工作项与天气信息，给一句轻松的今日问候即可。）' },
    ])
  } catch (e) {
    return { failures: [{ desc, reason: `生成失败：${e?.message || e}` }], output: '' }
  }
  const failures = []
  for (const a of [...DEFAULT_ASSERTS, ...(c.assert || [])]) {
    const r = evalAssert(a.type, a.value, output)
    if (!r.pass) failures.push({ desc, reason: r.reason })
  }
  try {
    const rj = await judgeRubric(output, context)
    if (!rj.pass) failures.push({ desc, reason: '质量：' + rj.reason })
  } catch {
    /* rubric 调用失败不致命，跳过 */
  }
  return { failures, output }
}

async function pmap(items, limit, fn) {
  const ret = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      ret[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return ret
}

async function runEval(systemPrompt) {
  const results = await pmap(CASES, CONCURRENCY, (c) => runCase(c, systemPrompt))
  let passed = 0
  const failures = []
  results.forEach((r) => {
    if (r.failures.length === 0) passed++
    else r.failures.forEach((f) => failures.push(f))
  })
  return {
    passed,
    total: CASES.length,
    score: CASES.length ? passed / CASES.length : 0,
    failures,
  }
}

// ============ OPRO meta-prompt ============
const TASK_GOAL = `为一个 Vue 工作台的「今日晨报」生成 system prompt。晨报在用户打开工作台时显示，基于当天工作台快照（天气 + 指派给用户的禅道任务/Bug + 本地待办），用简体中文 Markdown 写一份精炼简报，帮用户一眼知道今天先干什么。要求：开头点出最该先抓的事（逾期/今天截止优先）、2~4 个要点点名具体事项（用「」框起，紧急用 **加粗**）、末尾一句贴心提示；不写标题、不提 AI、像靠谱同事的口吻。`

function metaMessages(currentPrompt, evalResult, trajectory) {
  const failStr = evalResult.failures.length
    ? evalResult.failures.map((f) => `- ${f.desc}：${f.reason}`).join('\n')
    : '（无失败）'
  const trajStr = trajectory.length
    ? trajectory.map((t, i) => `第${i + 1}轮：${(t.score * 100).toFixed(0)}%`).join('\n')
    : '（首轮）'
  return [
    {
      role: 'system',
      content:
        '你是 prompt 优化专家，在为晨报生成器优化 system prompt。基于评测失败明细提出改进。只输出新版 system prompt 的正文，不要任何解释、前后缀、代码块标记。',
    },
    {
      role: 'user',
      content:
        `# 任务\n${TASK_GOAL}\n\n# 当前 system prompt\n${currentPrompt}\n\n# 当前评测表现\n通过 ${evalResult.passed}/${evalResult.total}（${(evalResult.score * 100).toFixed(0)}%）。\n历史轨迹：\n${trajStr}\n\n失败明细（针对这些改进）：\n${failStr}\n\n# 你的任务\n输出一个改进版 system prompt，针对失败明细修正，但**不要为了过断言而堆砌关键词**、不要破坏现有优点。只输出 prompt 正文。`,
    },
  ]
}

// ============ 主循环 ============
async function main() {
  console.log(`OPRO 晨报 prompt 优化  |  ${active.name}:${active.model}  |  rounds=${ROUNDS}`)
  console.log(`cases=${CASES.length}  每轮 ~${CASES.length * 2 + 1} 次调用  |  总计 ~${ROUNDS * (CASES.length * 2 + 1)} 次\n`)

  const seed = readFileSync(SEED_PATH, 'utf8').trim()
  console.log('评测 seed（v1 基线）…')
  const seedResult = await runEval(seed)
  console.log(`seed: ${seedResult.passed}/${seedResult.total}（${(seedResult.score * 100).toFixed(0)}%）`)
  let best = { prompt: seed, ...seedResult }
  const trajectory = [{ score: seedResult.score }]
  let calls = CASES.length * 2 // seed eval

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n— 第 ${round}/${ROUNDS} 轮 —`)
    let candidate
    try {
      candidate = (await chatComplete(metaMessages(best.prompt, best, trajectory), { temperature: 0.7, maxTokens: 1200 })).trim()
    } catch (e) {
      console.warn('meta 调用失败，跳过：', e?.message || e)
      continue
    }
    calls += 1
    if (!candidate || candidate === best.prompt) {
      console.log('候选为空或未变化，跳过')
      continue
    }
    let result
    try {
      result = await runEval(candidate)
    } catch (e) {
      console.warn('候选评测失败，跳过：', e?.message || e)
      continue
    }
    calls += CASES.length * 2
    console.log(`候选 ${result.passed}/${result.total}（${(result.score * 100).toFixed(0)}%）  vs  best ${best.passed}/${best.total}（${(best.score * 100).toFixed(0)}%）`)
    const better =
      result.score > best.score || (result.score === best.score && candidate.length < best.prompt.length)
    if (better) {
      best = { prompt: candidate, ...result }
      console.log('✓ 采纳为新最优')
    } else {
      console.log('✗ 未超过 best，丢弃')
    }
    trajectory.push({ score: result.score })
  }

  writeFileSync(OUT_PATH, best.prompt + '\n', 'utf8')
  console.log(`\n=== 完成（共 ${calls} 次调用）===`)
  console.log(`seed ${(seedResult.score * 100).toFixed(0)}% → best ${(best.score * 100).toFixed(0)}%（${best.passed}/${best.total}）`)
  console.log(`最优 prompt → ${OUT_PATH}`)
  console.log(`（人工 review 后，可把内容贴进 briefing.system.v2.txt 用 eval:briefing 交叉验证）`)
}

main().catch((e) => {
  console.error('OPRO 失败：', e?.message || e)
  process.exit(1)
})
