// eval/sync-prompt.mjs
//
// 从 src/features/chat/briefing.ts 抽取 BRIEFING_SYSTEM_PROMPT，解析 ${ASSISTANT_NAME}（默认「小吴」，
// 可用 `ASSISTANT_NAME=xxx npm run eval:sync` 覆盖），写入 prompts/briefing.system.v1.txt。
//
// 作用：保证评测基线 v1 与现网 system prompt 逐字一致——改了 briefing.ts 后跑一次 sync，
// 基线自动更新；否则你拿着过期的 v1 做对比，数字就没意义了。
//
// 跑法：npm run eval:sync
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src', 'features', 'chat', 'briefing.ts')
const OUT = join(__dirname, 'prompts', 'briefing.system.v1.txt')
const ASSISTANT_NAME = process.env.ASSISTANT_NAME || '小吴'

const src = readFileSync(SRC, 'utf8')
// 抓 `const BRIEFING_SYSTEM_PROMPT = [ ... ].join('\n')`
const m = src.match(/const\s+BRIEFING_SYSTEM_PROMPT\s*=\s*(\[[\s\S]*?\])\.join\('\\n'\)/)
if (!m) {
  console.error('✗ 没在 briefing.ts 里匹配到 BRIEFING_SYSTEM_PROMPT 数组——源码结构变了？请手动核对后改本脚本。')
  process.exit(1)
}

let arr
try {
  // 数组元素全是字符串 / 模板字面量，唯一外部引用是 ${ASSISTANT_NAME}（已在作用域内）
  // eslint-disable-next-line no-eval
  arr = eval(m[1])
} catch (e) {
  console.error('✗ 解析数组失败：', e?.message || e)
  process.exit(1)
}

const text = arr.join('\n')
writeFileSync(OUT, text + '\n', 'utf8')
console.log(`✓ 已同步 v1 基线 → ${OUT}`)
console.log(`    ${text.length} 字符，助手名「${ASSISTANT_NAME}」`)
console.log('    （改完 briefing.ts 后重跑本命令即可更新基线）')
