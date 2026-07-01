<script setup lang="ts">
/**
 * Git diff 渲染盒
 *
 * 把 `git diff` / `git show` 的原始文本解析成带行号与 +/- 配色的可读视图：
 *   - 新增行绿、删除行红、hunk 头青、文件头(meta)灰
 *   - 左侧 old/new 双行号列，保留代码原始缩进（white-space: pre），超长横向滚动
 *   - 不再做 word-break: break-all（破坏代码可读性的旧实现已移除）
 *
 * 仅渲染前 MAX_LINES 行，防止巨型 diff 撑爆 DOM；LLM 已配置时底部出现「让小吴解释」入口。
 */
import { computed } from 'vue'
import IconLoading from '~icons/mdi/loading'
import IconRobot from '~icons/mdi/robot-outline'

const props = defineProps<{ content: string; loading?: boolean; aiReady?: boolean }>()
defineEmits<{ explain: [] }>()

type DiffLineType = 'hunk' | 'add' | 'del' | 'context' | 'meta'
interface DiffLine {
  type: DiffLineType
  text: string
  oldNo?: number
  newNo?: number
}

const MAX_LINES = 2000

const diffLines = computed<DiffLine[]>(() => {
  const raw = props.content
  if (!raw) return []
  const lines = raw.split('\n')
  let oldNo = 0
  let newNo = 0
  const out: DiffLine[] = []
  for (let i = 0; i < lines.length && out.length < MAX_LINES; i++) {
    const line = lines[i]
    if (line.startsWith('@@')) {
      const m = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      if (m) {
        oldNo = parseInt(m[1], 10)
        newNo = parseInt(m[2], 10)
      }
      out.push({ type: 'hunk', text: line })
    } else if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      out.push({ type: 'meta', text: line })
    } else if (line.startsWith('+')) {
      out.push({ type: 'add', text: line.slice(1), newNo: newNo++ })
    } else if (line.startsWith('-')) {
      out.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ })
    } else {
      out.push({ type: 'context', text: line.replace(/^ /, ''), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return out
})

const totalLines = computed(() => props.content.split('\n').length)
const truncated = computed(() => totalLines.value > MAX_LINES)
</script>

<template>
  <div class="gdb-box">
    <div v-if="loading" class="gdb-loading">
      <IconLoading class="gdb-spin" /> 加载中…
    </div>
    <template v-else>
      <div class="gdb-view">
        <div
          v-for="(ln, i) in diffLines"
          :key="i"
          class="gdb-ln"
          :class="`is-${ln.type}`"
        >
          <span class="gdb-no old">{{ ln.oldNo ?? '' }}</span>
          <span class="gdb-no new">{{ ln.newNo ?? '' }}</span>
          <span class="gdb-sign">{{ ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : '' }}</span>
          <span class="gdb-code" v-text="ln.text" />
        </div>
        <div v-if="!diffLines.length" class="gdb-empty">(无 diff 输出)</div>
      </div>
      <div v-if="truncated" class="gdb-truncated">
        输出共 {{ totalLines }} 行，仅显示前 {{ MAX_LINES }} 行
      </div>
      <div v-if="aiReady && diffLines.length" class="gdb-actions">
        <button class="gdb-explain" @click="$emit('explain')">
          <IconRobot class="w-3 h-3" />
          <span>让小吴解释这段 diff</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gdb-box {
  background: rgba(0, 0, 0, 0.28);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.gdb-loading {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
}
.gdb-view {
  max-height: 340px;
  overflow: auto;
  padding: 6px 0;
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}
.gdb-view::-webkit-scrollbar { height: 6px; width: 6px; }
.gdb-view::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 3px; }

.gdb-ln {
  display: flex;
  align-items: flex-start;
  white-space: pre;
}
.gdb-ln:hover { background: rgba(255, 255, 255, 0.03); }

.gdb-no {
  flex-shrink: 0;
  width: 44px;
  padding: 0 8px;
  text-align: right;
  color: rgba(255, 255, 255, 0.22);
  user-select: none;
}
.gdb-sign {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-weight: 700;
}
.gdb-code {
  flex: 1;
  min-width: 0;
  padding-right: 16px;
  white-space: pre;
}

.gdb-ln.is-context .gdb-code { color: rgba(255, 255, 255, 0.55); }
.gdb-ln.is-add { background: rgba(34, 197, 94, 0.10); }
.gdb-ln.is-add .gdb-sign,
.gdb-ln.is-add .gdb-code { color: rgb(134, 239, 172); }
.gdb-ln.is-del { background: rgba(244, 63, 94, 0.10); }
.gdb-ln.is-del .gdb-sign,
.gdb-ln.is-del .gdb-code { color: rgb(252, 165, 165); }
.gdb-ln.is-hunk { background: rgba(45, 212, 191, 0.07); }
.gdb-ln.is-hunk .gdb-code { color: rgb(94, 234, 212); }
.gdb-ln.is-meta .gdb-code { color: rgba(255, 255, 255, 0.42); }

.gdb-empty { padding: 12px 16px; color: rgba(255, 255, 255, 0.3); font-size: 12px; }
.gdb-truncated {
  padding: 6px 16px;
  font-size: 11px;
  color: rgba(251, 191, 36, 0.7);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.gdb-actions {
  padding: 6px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  gap: 6px;
}
.gdb-explain {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(45, 212, 191, 0.10);
  border: 1px solid rgba(45, 212, 191, 0.22);
  color: rgb(94, 234, 212);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.gdb-explain:hover { background: rgba(45, 212, 191, 0.18); }

.gdb-spin { animation: gdb-spin 1s linear infinite; }
@keyframes gdb-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .gdb-spin { animation: none; }
}
</style>
