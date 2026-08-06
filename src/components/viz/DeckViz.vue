<script setup lang="ts">
/**
 * DeckViz —— 队列可视化的 5 种真 3D 结构，按 theme 切换。
 *
 * 设计根因：卡堆居中且大（~480px），任何放在正后方的平面元素都会被它挡住、
 * 读成「2D 贴纸」。所以每种结构都用有体积的节点（光珠 / 门框 / 晶柱 / 副卡），
 * 并把它们分布在卡堆轮廓之外的 3D 空间里（轨道半径、螺旋高度、纵深隧道、地面环阵、
 * 底部弧线），让近端节点大且亮、远端小且暗——近大远小才是真 3D。
 *
 * 数据由父组件（InboxDeck）传入归一化后的 deck 数组 + 当前聚焦位 active。
 * 点击节点 → emit('jump', index) 跳到该项。
 */
import { computed } from 'vue'
import type { WorkItem } from '@/features/insights'
import type { DeckThemeId } from '@/composables/useDeckTheme'

interface Props {
  items: { kind: WorkItem['kind']; title: string; started?: boolean }[]
  active: number
  theme: DeckThemeId
}
const props = defineProps<Props>()
const emit = defineEmits<{ jump: [index: number] }>()

const KIND_COLOR: Record<WorkItem['kind'], string> = {
  task: 'var(--color-alive)',
  bug: 'var(--color-danger)',
  local: 'var(--color-accent)',
}
/** 节点色：已开工的禅道任务转琥珀（与卡片边条同语言），未开始 / Bug / 本地保持来源色 */
const colorOf = (kind: WorkItem['kind'], started?: boolean) =>
  started ? 'var(--color-warning)' : KIND_COLOR[kind]

interface VizNode {
  i: number
  kind: WorkItem['kind']
  title: string
  started?: boolean
  style: string
  cls: string
  h?: number
}

const nodes = computed<VizNode[]>(() => {
  const { items, active, theme } = props
  const n = items.length
  if (!n) return []
  const DEG = Math.PI / 180

  if (theme === 'f') {
    // 轨道光珠：倾斜椭圆轨道，半径 360 > 卡堆半宽；近端（下方）亮且大
    const step = 360 / n
    return items.map((it, i) => {
      const a = i * step
      const front = (Math.sin(a * DEG) + 1) / 2
      const op = 0.26 + 0.7 * front
      const bl = 2.2 * (1 - front)
      const cur = i === active
      return {
        i,
        kind: it.kind,
        title: it.title,
        started: it.started,
        cls: cur ? 'bd cur' : i < active ? 'bd past' : 'bd',
        style: `--bc:${colorOf(it.kind, it.started)};transform:rotateZ(${a.toFixed(1)}deg) translateX(360px);opacity:${op.toFixed(3)};filter:blur(${bl.toFixed(1)}px)`,
      }
    })
  }

  if (theme === 'g') {
    // 螺旋天梯：绕卡堆盘旋上升，半径 360、纵向 ±260，均超出卡堆轮廓
    return items.map((it, i) => {
      const deg = i * 30
      const front = (Math.cos(deg * DEG) + 1) / 2
      const op = 0.26 + 0.7 * front
      const bl = 2.2 * (1 - front)
      const y = 260 - i * 22.5
      const cur = i === active
      return {
        i,
        kind: it.kind,
        title: it.title,
        started: it.started,
        cls: cur ? 'bd cur' : i < active ? 'bd past' : 'bd',
        style: `--bc:${colorOf(it.kind, it.started)};transform:rotateY(${deg}deg) translateZ(360px) translateY(${y}px);opacity:${op.toFixed(3)};filter:blur(${bl.toFixed(1)}px)`,
      }
    })
  }

  if (theme === 'h') {
    // 纵深回廊：比卡堆更大的发光门框，一格格向后上方缩入雾中
    const SHOW = Math.min(n, 12)
    return Array.from({ length: SHOW }, (_, i) => {
      const it = items[i]
      const w = 560 + i * 26
      const op = 0.95 - i * 0.072
      const bl = i * 0.5
      return {
        i,
        kind: it.kind,
        title: it.title,
        started: it.started,
        cls: i === 0 ? 'fr cur' : 'fr',
        style: `--fc:${colorOf(it.kind, it.started)};width:${w}px;transform:translate(-50%,-50%) translateY(${(-i * 30)}px) translateZ(${(-i * 150)}px);opacity:${op.toFixed(3)};filter:blur(${bl.toFixed(1)}px);z-index:${50 - i}`,
      }
    })
  }

  if (theme === 'i') {
    // 全息晶柱阵：地面网格上每项一根发光晶柱，颜色=来源，高度=当前最突出
    return items.map((it, i) => {
      const a = (i * 360) / n
      const h = i === active ? 190 : i < active ? 120 : 60 + ((i * 37) % 70)
      return {
        i,
        kind: it.kind,
        title: it.title,
        started: it.started,
        cls: i === active ? 'pw cur' : 'pw',
        h,
        style: `--pc:${colorOf(it.kind, it.started)};transform:rotateY(${a.toFixed(1)}deg) translateZ(300px)`,
      }
    })
  }

  // j 弧面副卡（默认）：24 张迷你副卡在卡堆下方排成向两侧后退翘起的 3D 弧线（循环）
  return items.map((it, i) => {
    const n = items.length
    // 循环偏移：取环上最短距离，让首尾相连（激活首项时左侧露出末尾副卡，反之亦然）
    let p = i - active
    if (p > n / 2) p -= n
    else if (p <= -n / 2) p += n
    const x = p * 58
    const z = -(Math.abs(p) ** 1.35) * 16 - 150
    const ry = Math.max(-58, Math.min(58, -p * 9))
    const front = (z + 520) / 370
    const op = 0.3 + 0.65 * front
    const bl = 2 * (1 - front)
    const cur = i === active
    return {
      i,
      kind: it.kind,
      title: it.title,
      started: it.started,
      cls: cur ? 'tl cur' : 'tl',
      style: `--tc:${colorOf(it.kind, it.started)};transform:translate(-50%,-50%) translateX(${x.toFixed(0)}px) translateY(250px) translateZ(${z.toFixed(0)}px) rotateY(${ry.toFixed(1)}deg)${cur ? ' scale(1.18) translateY(-10px)' : ''};opacity:${op.toFixed(3)};filter:blur(${bl.toFixed(1)}px);z-index:${70 - Math.abs(p) * 2}`,
    }
  })
})

const onNodePointerDown = (e: PointerEvent) => {
  // 阻止冒泡到舞台的拖拽指针按下：节点只负责「点击跳转」，不参与卡堆拖拽
  e.stopPropagation()
}
const onJump = (i: number) => emit('jump', i)
</script>

<template>
  <div class="deck-viz">
    <!-- F 轨道光珠 -->
    <div v-if="theme === 'f'" class="viz-f">
      <div class="track"></div>
      <i
        v-for="node in nodes"
        :key="node.i"
        class="bd"
        :class="node.cls"
        :style="node.style"
        @pointerdown="onNodePointerDown"
        @click="onJump(node.i)"
      />
    </div>

    <!-- G 螺旋天梯 -->
    <div v-else-if="theme === 'g'" class="viz-g">
      <i
        v-for="node in nodes"
        :key="node.i"
        class="bd"
        :class="node.cls"
        :style="node.style"
        @pointerdown="onNodePointerDown"
        @click="onJump(node.i)"
      />
    </div>

    <!-- H 纵深回廊 -->
    <div v-else-if="theme === 'h'" class="viz-h">
      <div class="fog"></div>
      <div
        v-for="node in nodes"
        :key="node.i"
        class="fr"
        :class="node.cls"
        :style="node.style"
        @pointerdown="onNodePointerDown"
        @click="onJump(node.i)"
      >
        <span>#{{ String(node.i + 1).padStart(2, '0') }}</span>
      </div>
    </div>

    <!-- I 全息晶柱阵 -->
    <div v-else-if="theme === 'i'" class="viz-i">
      <div class="grid"></div>
      <div
        v-for="node in nodes"
        :key="node.i"
        class="pw"
        :class="node.cls"
        :style="node.style"
        @pointerdown="onNodePointerDown"
        @click="onJump(node.i)"
      >
        <i class="pl" :style="{ height: node.h + 'px' }"></i>
      </div>
    </div>

    <!-- J 弧面副卡（默认） -->
    <div v-else class="viz-j">
      <div
        v-for="node in nodes"
        :key="node.i"
        class="tl"
        :class="[node.cls, { 'is-started': node.started }]"
        :style="node.style"
        @pointerdown="onNodePointerDown"
        @click="onJump(node.i)"
      >
        <span class="n">#{{ String(node.i + 1).padStart(2, '0') }}</span>
        <span class="t" :title="node.title">{{ node.title }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 容器：占满舞台、居中子元素、不拦截指针（节点自己开 pointer-events） */
.deck-viz {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  pointer-events: none;
  transform: translateY(calc(-1 * var(--deck-lift, 0px))) scale(var(--deck-scale, 1));
  transform-origin: center top;
}
.viz-f,
.viz-g,
.viz-h,
.viz-i,
.viz-j {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}
.viz-f {
  transform: translateY(10px) rotateX(42deg) rotateY(-18deg);
}
.viz-g {
  transform: rotateX(14deg) rotateY(-18deg);
}
.viz-h {
  /* 仅用舞台透视，自身不倾斜，让门框正面向后延伸 */
}
.viz-i {
  transform: translateY(165px) rotateX(72deg);
}
.viz-j {
  transform: rotateX(12deg);
}

/* ---------------- F 轨道光珠 ---------------- */
.viz-f .track {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 720px;
  height: 720px;
  margin: -360px 0 0 -360px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 0 24px -8px rgba(39, 227, 255, 0.3), inset 0 0 24px -10px rgba(39, 227, 255, 0.2);
}
.bd {
  position: absolute;
  left: 0;
  top: 0;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  pointer-events: auto;
  cursor: pointer;
  background: radial-gradient(circle at 35% 30%, #fff, var(--bc) 62%);
  box-shadow: 0 0 9px var(--bc), 0 0 24px color-mix(in srgb, var(--bc) 55%, transparent);
  transition: transform 0.5s var(--ease-out-expo), opacity 0.4s;
}
.bd.past {
  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.7), color-mix(in srgb, var(--bc) 40%, transparent) 62%);
  box-shadow: 0 0 5px color-mix(in srgb, var(--bc) 45%, transparent);
}
.bd.cur {
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  z-index: 3;
  background: radial-gradient(circle at 35% 30%, #fff 30%, var(--bc) 70%);
  box-shadow: 0 0 16px #fff, 0 0 36px var(--bc), 0 0 64px color-mix(in srgb, var(--bc) 70%, transparent);
}
.bd.cur::after {
  content: '';
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--bc) 70%, transparent);
}

/* ---------------- H 纵深回廊 ---------------- */
.viz-h .fog {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1400px;
  height: 1100px;
  transform: translate(-50%, -50%) translateZ(-1500px);
  background: radial-gradient(closest-side, rgba(4, 8, 16, 0), rgba(4, 8, 16, 0.5) 55%, rgba(3, 6, 12, 0.9));
  pointer-events: none;
}
.fr {
  position: absolute;
  left: 50%;
  top: 50%;
  height: 360px;
  border-radius: 18px;
  pointer-events: auto;
  cursor: pointer;
  border: 1.5px solid color-mix(in srgb, var(--fc) 55%, transparent);
  background: linear-gradient(160deg, color-mix(in srgb, var(--fc) 6%, rgba(10, 15, 24, 0.3)), rgba(8, 12, 20, 0.12));
  box-shadow: inset 0 0 50px -20px color-mix(in srgb, var(--fc) 40%, transparent), 0 0 34px -12px color-mix(in srgb, var(--fc) 40%, transparent);
  transition: transform 0.6s var(--ease-out-expo), opacity 0.4s;
}
.fr span {
  position: absolute;
  left: 18px;
  top: 14px;
  font: 700 11px/1 var(--font-mono);
  letter-spacing: 0.1em;
  color: color-mix(in srgb, var(--fc) 80%, #fff);
}
.fr.cur {
  border-color: color-mix(in srgb, var(--fc) 85%, transparent);
  box-shadow: inset 0 0 60px -16px color-mix(in srgb, var(--fc) 55%, transparent), 0 0 46px -8px color-mix(in srgb, var(--fc) 60%, transparent);
}

/* ---------------- I 全息晶柱阵 ---------------- */
.viz-i .grid {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 920px;
  height: 920px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background:
    radial-gradient(closest-side, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%),
    repeating-linear-gradient(0deg, rgba(39, 227, 255, 0.07) 0 1px, transparent 1px 46px),
    repeating-linear-gradient(90deg, rgba(39, 227, 255, 0.07) 0 1px, transparent 1px 46px);
  -webkit-mask-image: radial-gradient(closest-side, #000 40%, transparent 72%);
  mask-image: radial-gradient(closest-side, #000 40%, transparent 72%);
}
.pw {
  position: absolute;
  left: 0;
  top: 0;
  transform-style: preserve-3d;
  pointer-events: auto;
  cursor: pointer;
}
.pl {
  position: absolute;
  left: -7px;
  bottom: 0;
  width: 14px;
  display: block;
  transform: rotateX(-72deg);
  transform-origin: 50% 100%;
  background: linear-gradient(180deg, color-mix(in srgb, var(--pc) 90%, #fff) 0%, color-mix(in srgb, var(--pc) 45%, transparent) 30%, color-mix(in srgb, var(--pc) 8%, transparent) 100%);
  border: 1px solid color-mix(in srgb, var(--pc) 55%, transparent);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  box-shadow: 0 0 18px -2px color-mix(in srgb, var(--pc) 55%, transparent);
  transition: height 0.5s var(--ease-out-expo);
}
.pw.cur .pl {
  width: 20px;
  left: -10px;
  background: linear-gradient(180deg, #fff 0%, color-mix(in srgb, var(--pc) 90%, #fff) 22%, color-mix(in srgb, var(--pc) 40%, transparent) 100%);
  box-shadow: 0 0 26px 0 color-mix(in srgb, var(--pc) 80%, transparent), 0 0 60px -6px var(--pc);
}

/* ---------------- J 弧面副卡 ---------------- */
.tl {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 104px;
  height: 70px;
  border-radius: 11px;
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 9px 7px 11px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--tc) 50%, var(--color-line));
  border-left: 3px solid var(--tc);
  background: linear-gradient(165deg, color-mix(in srgb, var(--tc) 12%, #131a28), #0c1220);
  box-shadow: 0 16px 34px -16px rgba(0, 8, 16, 0.8), 0 0 20px -8px color-mix(in srgb, var(--tc) 45%, transparent);
  transition: transform 0.5s var(--ease-out-expo), opacity 0.4s;
}
.tl .n {
  font: 700 10px/1 var(--font-mono);
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--tc) 88%, #fff);
}
.tl .t {
  font: 500 9.5px/1.25 var(--font-sans);
  color: var(--color-ink-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
.tl.cur {
  border-color: color-mix(in srgb, var(--tc) 90%, transparent);
  background: linear-gradient(165deg, color-mix(in srgb, var(--tc) 26%, #131a28), #0c1220);
  box-shadow: 0 20px 44px -14px rgba(0, 8, 16, 0.9), 0 0 36px -4px color-mix(in srgb, var(--tc) 70%, transparent);
}
.tl.cur .n {
  color: #fff;
}
.tl.cur .t {
  color: var(--color-ink);
}
/* 已开工副卡：右上角一枚琥珀 LED 点（与卡堆「已开始」同语言） */
.tl.is-started .n { position: relative; padding-right: 11px; }
.tl.is-started .n::after {
  content: '';
  position: absolute;
  right: 0;
  top: 1px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-warning);
  box-shadow: 0 0 6px var(--color-warning);
}

@media (prefers-reduced-motion: reduce) {
  .bd,
  .fr,
  .pl,
  .tl {
    transition: none;
  }
}
</style>
