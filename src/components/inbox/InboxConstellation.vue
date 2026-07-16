<script setup lang="ts">
/**
 * Three.js 工作星图：把统一收件箱里的真实工作项渲染成一个带电影感的 3D 科幻星图。
 *
 * 视觉关键点：
 *   - UnrealBloomPass + OutputPass 后处理：让 emissive/sprite 真正辉光（否则只是色块）。
 *   - 节点用 Sprite + 程序生成的星体贴图（白热核心 + 彩色光晕，加性混合）→ 像真实恒星。
 *   - 程序生成的星云背景贴图 + 密集圆形星点 → 深空氛围。
 * 文字 HUD 由 DOM 承载，保证清晰和可访问。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

type ConstellationKind = 'task' | 'bug' | 'local'
type ConstellationRisk = 'overdue' | 'due-soon' | 'stalled' | 'calm'

interface ConstellationItem {
  key: string
  title: string
  kind: ConstellationKind
  kindLabel: string
  riskLevel: ConstellationRisk
  riskLabel: string
  riskWhy: string
  meta: string
  urgent: boolean
}

interface ConstellationSummary {
  total: number
  overdue: number
  dueSoon: number
  stalled: number
  headline: string
}

const props = defineProps<{
  items: ConstellationItem[]
  summary: ConstellationSummary
  urgentCount: number
  remainder?: number
}>()

const emit = defineEmits<{
  openItem: [key: string]
}>()

const host = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const hoveredKey = ref<string | null>(null)
const hudHoveredKey = ref<string | null>(null)
/** hover 指示器在屏幕上的投影位置（HTML 覆盖层：瞄准光环 + 标题标签跟踪此坐标） */
const hoverScreen = ref({ x: 0, y: 0, visible: false })
const reduceMotion = ref(false)

const hotItems = computed(() =>
  props.items.filter((it) => it.riskLevel !== 'calm' || it.urgent).slice(0, 6),
)
const sourceStats = computed(() => ({
  task: props.items.filter((it) => it.kind === 'task').length,
  bug: props.items.filter((it) => it.kind === 'bug').length,
  local: props.items.filter((it) => it.kind === 'local').length,
}))
const corePressure = computed<'critical' | 'elevated' | 'stable'>(() => {
  if (props.summary.overdue || props.urgentCount >= 3) return 'critical'
  if (props.summary.dueSoon || props.summary.stalled) return 'elevated'
  return 'stable'
})
const corePressureLabel = computed(() => {
  if (corePressure.value === 'critical') return '高压态势'
  if (corePressure.value === 'elevated') return '升温态势'
  return '平稳态势'
})
const activeItem = computed(() => {
  const key = hoveredKey.value
  return key ? props.items.find((it) => it.key === key) ?? null : null
})

function signalLabel(it?: ConstellationItem | null): string {
  if (!it) return ''
  if (it.riskLevel === 'overdue') return '逾期'
  if (it.riskLevel === 'due-soon') return '临期'
  if (it.riskLevel === 'stalled') return '停滞'
  if (it.urgent) return '紧急'
  return it.riskLabel || '平稳'
}

const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let composer: EffectComposer | null = null
let root: THREE.Group | null = null
let nodesGroup: THREE.Group | null = null
let core: THREE.Mesh | null = null
let coreHalo: THREE.Sprite | null = null
let coreOuter: THREE.Sprite | null = null
let coreCorona: THREE.Sprite | null = null
let dangerLight: THREE.PointLight | null = null
let particles: THREE.Points | null = null
let raycaster: THREE.Raycaster | null = null
const lastPointer = new THREE.Vector2(99, 99)
let pointerInside = false
const _tmpV = new THREE.Vector3()
let frame = 0
let resizeObserver: ResizeObserver | null = null
const nodeSprites = new Map<string, THREE.Sprite>()
const nodeCores = new Map<string, THREE.Mesh>()
/** 所有工作项都有轨道（一项一轨道）；轨道视觉由来源色区分。 */
interface OrbitVisual {
  ring: THREE.LineLoop
  angle: number
  speed: number
  radiusX: number
  radiusY: number
  baseOpacity: number
  kind: ConstellationKind
}
const nodeOrbits = new Map<string, OrbitVisual>()
const nodeBase = new Map<string, { position: THREE.Vector3; scale: number; color: THREE.Color; risk: ConstellationRisk; kind: ConstellationKind; urgent: boolean; drifts: boolean }>()

// 程序生成的贴图（星点、星体光晕、星云背景），卸载时统一释放
let starTex: THREE.CanvasTexture | null = null
let haloTex: THREE.CanvasTexture | null = null
let nebulaTex: THREE.CanvasTexture | null = null

// ============ 贴图生成（canvas → CanvasTexture）============
function makeStarTexture(size = 64): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeHaloTexture(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  // 外层柔光
  const g1 = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  g1.addColorStop(0, 'rgba(255,255,255,1)')
  g1.addColorStop(0.12, 'rgba(255,255,255,0.92)')
  g1.addColorStop(0.3, 'rgba(255,255,255,0.45)')
  g1.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  g1.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g1
  ctx.fillRect(0, 0, size, size)
  // 十字光芒（lens flare 风）
  ctx.globalCompositeOperation = 'lighter'
  const line = ctx.createLinearGradient(0, cx, size, cx)
  line.addColorStop(0, 'rgba(255,255,255,0)')
  line.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  line.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = line
  ctx.fillRect(0, cx - 1.5, size, 3)
  const lineV = ctx.createLinearGradient(cx, 0, cx, size)
  lineV.addColorStop(0, 'rgba(255,255,255,0)')
  lineV.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  lineV.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = lineV
  ctx.fillRect(cx - 1.5, 0, 3, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeNebulaTexture(w = 1024, h = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // 深空底：冷蓝黑，电影级调色
  const base = ctx.createLinearGradient(0, 0, w, h)
  base.addColorStop(0, '#02030a')
  base.addColorStop(0.5, '#05081a')
  base.addColorStop(1, '#070914')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // 星云气体：收敛为单一冷色主调（深青蓝）+ 一抹暖色（琥珀）做电影感互补
  ctx.globalCompositeOperation = 'lighter'
  const clouds: Array<[number, number, number, string]> = [
    [w * 0.34, h * 0.42, w * 0.52, 'rgba(45,120,170,0.42)'],   // 主调：深青蓝
    [w * 0.66, h * 0.36, w * 0.46, 'rgba(28,90,140,0.34)'],    // 主调：更深的蓝
    [w * 0.58, h * 0.68, w * 0.4, 'rgba(20,70,120,0.3)'],      // 主调：远景蓝
    [w * 0.22, h * 0.72, w * 0.32, 'rgba(180,120,70,0.18)'],   // 暖色点缀：琥珀（极淡）
  ]
  for (const [x, y, r, color] of clouds) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(0.5, color.replace(/[\d.]+\)$/, '0.12)'))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // 远处星尘：减半、更细、偏冷白，让前景节点不被背景淹没
  ctx.globalCompositeOperation = 'source-over'
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const r = Math.random() * 1.1
    const a = Math.random() * 0.6 + 0.08
    ctx.fillStyle = `rgba(220,235,255,${a})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 几颗亮星带光晕（减少，留白）
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const g = ctx.createRadialGradient(x, y, 0, x, y, 12)
    g.addColorStop(0, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, 12, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const SOURCE_TINTS: Record<ConstellationKind, THREE.Color> = {
  task: new THREE.Color('#58c7f4'),
  bug: new THREE.Color('#ff7f99'),
  local: new THREE.Color('#a78bfa'),
}

const RISK_TINTS: Partial<Record<ConstellationRisk, THREE.Color>> = {
  overdue: new THREE.Color('#ff5b78'),
  'due-soon': new THREE.Color('#f7c65a'),
  stalled: new THREE.Color('#b7a3ff'),
}

/** 紧急（玫红）—— 与 UnifiedInbox 紧急色一致；紧急是优先级维度，叠加在来源/风险色之上 */
const URGENT_TINT = new THREE.Color('#fb7185')

const FIELD_PLANE = { opacity: 0.18 }
const SOURCE_BIASES: Record<ConstellationKind, { tiltX: number; tiltY: number; tiltZ: number }> = {
  task: { tiltX: -0.04, tiltY: -0.02, tiltZ: -0.05 },
  bug: { tiltX: 0.06, tiltY: 0.03, tiltZ: 0.04 },
  local: { tiltX: -0.01, tiltY: 0.02, tiltZ: 0.02 },
}
const ORBIT_FAMILIES = [
  { tiltX: 0.72, tiltY: -0.1, tiltZ: -0.36, jitterX: 0.34, jitterY: 0.34, jitterZ: 0.7, ellipseBase: 0.34, ellipseRange: 0.22 },
  { tiltX: 1.28, tiltY: -0.2, tiltZ: 0.24, jitterX: 0.24, jitterY: 0.36, jitterZ: 0.48, ellipseBase: 0.5, ellipseRange: 0.2 },
  { tiltX: 1.18, tiltY: 0.18, tiltZ: 0.42, jitterX: 0.38, jitterY: 0.42, jitterZ: 0.84, ellipseBase: 0.38, ellipseRange: 0.24 },
  { tiltX: 0.18, tiltY: 0.22, tiltZ: 1.32, jitterX: 0.34, jitterY: 0.32, jitterZ: 0.22, ellipseBase: 0.5, ellipseRange: 0.2 },
]

function sourceColorOf(kind: ConstellationKind): THREE.Color {
  return new THREE.Color('#b9d7ff').lerp(SOURCE_TINTS[kind], 0.68)
}

function spectralColorOf(it: ConstellationItem): THREE.Color {
  const color = sourceColorOf(it.kind)
  const risk = RISK_TINTS[it.riskLevel]
  if (risk) return color.lerp(risk, it.riskLevel === 'overdue' ? 0.18 : 0.12)
  if (it.urgent) return color.lerp(URGENT_TINT, 0.5)
  return color
}

function orbitFamilyOf(index: number): (typeof ORBIT_FAMILIES)[number] {
  return ORBIT_FAMILIES[index % ORBIT_FAMILIES.length]
}

function hashUnit(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

function stableJitter(seed: string, range: number): number {
  return (hashUnit(seed) - 0.5) * range
}

function riskOrder(it: ConstellationItem): number {
  if (it.riskLevel === 'overdue') return 0
  if (it.riskLevel === 'due-soon') return 1
  if (it.urgent) return 2
  if (it.riskLevel === 'stalled') return 3
  return 4
}

function riskRadiusOffset(it: ConstellationItem): number {
  if (it.riskLevel === 'overdue') return -0.42
  if (it.riskLevel === 'due-soon') return -0.22
  if (it.urgent) return -0.12
  if (it.riskLevel === 'stalled') return 0.1
  return 0.28
}

function orbitRadiusOf(it: ConstellationItem, index: number): number {
  const shells = it.riskLevel === 'overdue' || it.urgent
    ? [4.45, 5.15, 5.85]
    : [4.75, 5.45, 6.15]
  const shell = shells[(index + Math.floor(hashUnit(`${it.key}:shell`) * shells.length)) % shells.length]
  const riskPull = riskRadiusOffset(it) * 0.34
  return Math.max(4.15, Math.min(6.55, shell + riskPull + stableJitter(`${it.key}:radius`, 0.62)))
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) material.forEach((m) => m.dispose())
  else material.dispose()
}
function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh | THREE.Line | THREE.Points
    maybeMesh.geometry?.dispose()
    if (maybeMesh.material) disposeMaterial(maybeMesh.material)
  })
}

// ============ 场景搭建 ============
function setupScene() {
  if (!canvas.value || !host.value) return

  starTex = makeStarTexture(64)
  haloTex = makeHaloTexture(256)
  nebulaTex = makeNebulaTexture(1024, 1024)

  scene = new THREE.Scene()
  scene.background = nebulaTex
  scene.fog = new THREE.FogExp2(0x040611, 0.038)

  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 160)
  camera.position.set(0, 3.8, 16.5)
  camera.lookAt(0, 0, 0)

  root = new THREE.Group()
  root.rotation.x = -0.2
  // HUD 悬浮在右侧时，把工作星图的视觉重心保留在原左侧舞台位置，避免核心被面板遮住。
  root.position.x = -2.2
  scene.add(root)

  nodesGroup = new THREE.Group()
  root.add(nodesGroup)

  const r = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: false, powerPreference: 'high-performance' })
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8))
  r.outputColorSpace = THREE.SRGBColorSpace
  r.toneMapping = THREE.ACESFilmicToneMapping
  r.toneMappingExposure = 1.05
  renderer.value = r

  // 后处理：辉光 + 色彩输出
  composer = new EffectComposer(r)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.32)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const ambient = new THREE.AmbientLight(0x88aaff, 0.5)
  scene.add(ambient)
  const keyLight = new THREE.PointLight(0x7dd3fc, 6, 30)
  keyLight.position.set(-5, 6, 8)
  scene.add(keyLight)
  dangerLight = new THREE.PointLight(0xff3b6b, corePressure.value === 'critical' ? 5 : 1.6, 22)
  dangerLight.position.set(5, 1.5, 5)
  scene.add(dangerLight)

  createStarfield()
  createCore()
  rebuildNodes()

  raycaster = new THREE.Raycaster()
  raycaster.params.Points.threshold = 0.2

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host.value)
  resize()
  animate()
}

function createStarfield() {
  if (!scene || !starTex) return
  const count = 2200
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const base = new THREE.Color('#bdd6ff')
  const hot = new THREE.Color('#ffd1f0')
  for (let i = 0; i < count; i++) {
    const radius = 10 + Math.random() * 45
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2))
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius
    positions[i * 3 + 1] = Math.cos(phi) * radius * 0.7 + THREE.MathUtils.randFloatSpread(8)
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius - 12
    const c = base.clone().lerp(hot, Math.random() * 0.5)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    size: 0.16,
    map: starTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    alphaMap: starTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  particles = new THREE.Points(geometry, material)
  scene.add(particles)
}

function createCore() {
  if (!root || !haloTex) return
  // 核心刻意用与任务节点（青蓝）拉开距离的暖白金色，避免和内圈节点糊在一起
  const pressureColor = corePressure.value === 'critical' ? '#ff3b6b' : corePressure.value === 'elevated' ? '#f59e0b' : '#ffe0a3'
  const color = new THREE.Color(pressureColor)

  core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.0, 5),
    new THREE.MeshStandardMaterial({
      color: '#1a1208',
      emissive: color,
      emissiveIntensity: 2.0,
      roughness: 0.3,
      metalness: 0.6,
    }),
  )
  core.rotation.set(0.4, -0.7, 0.2)
  root.add(core)

  // 内层光晕（收紧，不外溢到节点轨道）
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  coreHalo = new THREE.Sprite(haloMat)
  coreHalo.scale.set(3.2, 3.2, 1)
  root.add(coreHalo)

  // 外层弥散光（大幅收紧，留出节点空间）
  const outerMat = new THREE.SpriteMaterial({
    map: haloTex,
    color,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  coreOuter = new THREE.Sprite(outerMat)
  coreOuter.scale.set(5.6, 5.6, 1)
  root.add(coreOuter)

  // 最外层日冕：极淡弥散，让恒星有大气延伸感（节点浮在其前）
  const coronaMat = new THREE.SpriteMaterial({
    map: haloTex,
    color,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  coreCorona = new THREE.Sprite(coronaMat)
  coreCorona.scale.set(9, 9, 1)
  root.add(coreCorona)
}

/** 构建工作项的连续轨道环。 */
function makeOrbitRing(
  radiusX: number,
  radiusY: number,
  tiltX: number,
  tiltY: number,
  tiltZ: number,
  color: THREE.Color,
  opacity: number,
): THREE.LineLoop {
  const curve = new THREE.EllipseCurve(0, 0, radiusX, radiusY, 0, Math.PI * 2)
  const points = curve.getPoints(160)
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, 0, p.y)))
  const material = new THREE.LineBasicMaterial({
    color: color.clone().lerp(new THREE.Color('#d9ecff'), 0.18),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const ring = new THREE.LineLoop(geometry, material)
  ring.rotation.x = tiltX
  ring.rotation.y = tiltY
  ring.rotation.z = tiltZ
  return ring
}

/** 轨道上 angle 对应的世界位置，与轨道环共用同一套几何参照。 */
function writeOrbitPosition(
  o: { radiusX: number; radiusY: number; ring: THREE.LineLoop; angle: number },
  target: THREE.Vector3,
): THREE.Vector3 {
  target.set(Math.cos(o.angle) * o.radiusX, 0, Math.sin(o.angle) * o.radiusY)
  target.applyQuaternion(o.ring.quaternion)
  target.add(o.ring.position)
  return target
}

function rebuildNodes() {
  if (!nodesGroup || !haloTex) return
  nodesGroup.children.forEach(disposeObject)
  nodesGroup.clear()
  nodeSprites.clear()
  nodeCores.clear()
  nodeOrbits.clear()
  nodeBase.clear()

  const orbitingItems = [...props.items].sort((a, b) =>
    riskOrder(a) - riskOrder(b) || hashUnit(a.key) - hashUnit(b.key) || a.title.localeCompare(b.title),
  )

  // 所有工作项：每个工作项一条专属轨道，节点沿轨道运行
  // 半径动态拟合：不管几个轨道项都落在 [rMin, rMax] 内，避免最外圈跑出视口
  orbitingItems.forEach((it, index) => {
    const color = spectralColorOf(it)
    const bias = SOURCE_BIASES[it.kind]
    const family = orbitFamilyOf(index)
    const radiusX = orbitRadiusOf(it, index)
    const radiusY = radiusX * (family.ellipseBase + hashUnit(`${it.key}:ellipse`) * family.ellipseRange)
    const tiltX = family.tiltX + bias.tiltX + stableJitter(`${it.key}:tilt-x`, family.jitterX)
    const tiltY = family.tiltY + bias.tiltY + stableJitter(`${it.key}:tilt-y`, family.jitterY)
    const tiltZ = family.tiltZ + bias.tiltZ + stableJitter(`${it.key}:tilt-z`, family.jitterZ)
    const baseOpacity = Math.max(0.1, Math.min(
      0.46,
      FIELD_PLANE.opacity
        + stableJitter(`${it.key}:opacity`, 0.06)
        + (it.riskLevel === 'overdue' ? 0.1 : it.riskLevel === 'due-soon' ? 0.06 : it.riskLevel === 'stalled' ? 0.04 : 0)
        + (it.urgent ? 0.06 : 0),
    ))
    const ring = makeOrbitRing(radiusX, radiusY, tiltX, tiltY, tiltZ, color, baseOpacity)
    if (it.urgent && ring.material instanceof THREE.LineBasicMaterial) ring.material.color.lerp(URGENT_TINT, 0.5)
    nodesGroup!.add(ring)

    const angle = hashUnit(`${it.key}:angle`) * Math.PI * 2
    const direction = hashUnit(`${it.key}:direction`) < 0.5 ? -1 : 1
    const speed = (0.025 + hashUnit(`${it.key}:speed`) * 0.055) * direction
    const orbit = { ring, angle, speed, radiusX, radiusY, baseOpacity, kind: it.kind }
    nodeOrbits.set(it.key, orbit)

    const pos = writeOrbitPosition(orbit, new THREE.Vector3())
    const riskBoost = it.riskLevel === 'overdue' ? 0.5 : it.riskLevel === 'due-soon' ? 0.28 : it.riskLevel === 'stalled' ? 0.2 : 0
    const scale = 0.95 + riskBoost + (it.urgent ? 0.18 : 0)
    const sprite = makeNodeSprite(it.key, index, color, scale, it.riskLevel)
    sprite.position.copy(pos)
    nodesGroup!.add(sprite)
    nodeSprites.set(it.key, sprite)

    const coreMesh = makeNodeCore(color, riskBoost)
    coreMesh.position.copy(pos)
    nodesGroup!.add(coreMesh)
    nodeCores.set(it.key, coreMesh)

    nodeBase.set(it.key, { position: pos.clone(), scale, color: color.clone(), risk: it.riskLevel, kind: it.kind, urgent: it.urgent, drifts: false })
  })

}

function makeNodeSprite(key: string, index: number, color: THREE.Color, scale: number, risk: ConstellationRisk): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: haloTex!,
    color,
    transparent: true,
    opacity: risk === 'calm' ? 0.85 : 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(scale, scale, 1)
  sprite.userData.key = key
  sprite.userData.index = index
  return sprite
}

function makeNodeCore(color: THREE.Color, riskBoost: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.16 + riskBoost * 0.12, 20, 20),
    new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.55) }),
  )
}

function updateCore() {
  const color = new THREE.Color(corePressure.value === 'critical' ? '#ff3b6b' : corePressure.value === 'elevated' ? '#f59e0b' : '#ffe0a3')
  if (core?.material instanceof THREE.MeshStandardMaterial) {
    core.material.emissive.copy(color)
    core.material.emissiveIntensity = props.summary.total ? 2.0 : 1.4
  }
  if (coreHalo?.material instanceof THREE.SpriteMaterial) coreHalo.material.color.copy(color)
  if (coreOuter?.material instanceof THREE.SpriteMaterial) coreOuter.material.color.copy(color)
  if (coreCorona?.material instanceof THREE.SpriteMaterial) coreCorona.material.color.copy(color)
  if (dangerLight) dangerLight.intensity = corePressure.value === 'critical' ? 5 : 1.6
}

function resize() {
  if (!host.value || !renderer.value || !camera || !composer) return
  const rect = host.value.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  renderer.value.setSize(width, height, false)
  composer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function animate() {
  if (!renderer.value || !scene || !camera || !root || !composer) return
  frame = requestAnimationFrame(animate)
  const t = performance.now() * 0.001
  const slow = reduceMotion.value

  if (!slow) {
    root.rotation.y = Math.sin(t * 0.08) * 0.1
    if (particles) {
      particles.rotation.y += 0.0002
      particles.rotation.x = Math.sin(t * 0.03) * 0.04
    }
    if (core) {
      core.rotation.x += 0.0015
      core.rotation.y += 0.0025
      const s = 1 + Math.sin(t * 0.5) * 0.05
      core.scale.setScalar(s)
    }
    if (coreHalo) {
      const s = 3.2 + Math.sin(t * 0.4) * 0.32
      coreHalo.scale.set(s, s, 1)
    }
    if (coreOuter) {
      const s = 5.6 + Math.sin(t * 0.3) * 0.5
      coreOuter.scale.set(s, s, 1)
    }
    if (coreCorona) {
      const s = 9 + Math.sin(t * 0.2) * 0.6
      coreCorona.scale.set(s, s, 1)
    }
  }

  // 摄像机：极慢漂移 + 指针视差，让 3D 空间有体积感（像在空间站窗前看星图）
  if (camera) {
    if (slow) {
      camera.position.x += (0 - camera.position.x) * 0.035
      camera.position.y += (3.8 - camera.position.y) * 0.035
    } else {
      const driftX = Math.sin(t * 0.05) * 0.8
      const driftY = 3.8 + Math.sin(t * 0.04) * 0.55
      const parX = pointerInside ? lastPointer.x * 1.4 : 0
      const parY = pointerInside ? lastPointer.y * 0.9 : 0
      camera.position.x += (driftX + parX - camera.position.x) * 0.05
      camera.position.y += (driftY + parY - camera.position.y) * 0.05
    }
    camera.lookAt(0, 0, 0)
  }

  const activeKey = hoveredKey.value
  const hasActive = !!activeKey
  const activeBase = activeKey ? nodeBase.get(activeKey) ?? null : null

  for (const [key, sprite] of nodeSprites) {
    const base = nodeBase.get(key)
    if (!base) continue
    const orbit = nodeOrbits.get(key)
    const isActive = key === activeKey

    // 带轨道项沿轨道运行（hover 时该项停住，便于点击）；本地项原地轻飘
    if (orbit) {
      if (!slow && !isActive) orbit.angle += orbit.speed * 0.016
      writeOrbitPosition(orbit, sprite.position)
      base.position.copy(sprite.position)
    } else if (!slow) {
      sprite.position.x = base.position.x + Math.sin(t * 0.8 + (sprite.userData.index ?? 0)) * 0.12
      sprite.position.y = base.position.y + Math.sin(t * 1.1 + (sprite.userData.index ?? 0) * 1.3) * 0.12
    }

    // 焦点节点单一慢呼吸，其余静态（建立层级：只有该看的在动）
    const focalBreath = !slow && isActive ? Math.sin(t * 1.1) * 0.12 : 0
    // 被指向的节点放大爆亮，其余压暗到 20%，一眼锁定
    const affinity = activeBase ? 1 - clamp01(sprite.position.distanceTo(activeBase.position) / 7.5) : 0
    const dim = hasActive && !isActive ? 0.16 + affinity * 0.34 : 1
    const depthGlow = 0.62 + clamp01((sprite.position.z + 6.5) / 12) * 0.5
    const boost = isActive ? 2.1 : 1
    const target = base.scale * boost * dim * (1 + focalBreath)
    sprite.scale.set(target, target, 1)
    if (sprite.material instanceof THREE.SpriteMaterial) {
      const riskOpacity = base.risk === 'calm' ? 0.82 : 0.98
      sprite.material.opacity = isActive ? 1 : riskOpacity * dim * depthGlow
    }
    const coreMesh = nodeCores.get(key)
    if (coreMesh) {
      coreMesh.position.copy(sprite.position)
      const cs = (0.16 + (base.risk === 'calm' ? 0 : 0.1)) * boost * dim
      coreMesh.scale.setScalar(cs)
    }
    // 工作项轨道环：hover 时该轨道高亮，其余变暗
    if (orbit?.ring.material instanceof THREE.LineBasicMaterial) {
      const riskPulse = slow
        ? 0
        : base.risk === 'overdue'
          ? Math.max(0, Math.sin(t * 0.8 + (sprite.userData.index ?? 0))) * 0.18
          : base.risk === 'due-soon'
            ? Math.max(0, Math.sin(t * 0.6 + (sprite.userData.index ?? 0))) * 0.1
            : 0
      const urgentPulse = !slow && base.urgent ? Math.max(0, Math.sin(t * 0.9 + (sprite.userData.index ?? 0))) * 0.12 : 0
      orbit.ring.material.opacity = isActive
        ? 0.74
        : hasActive
          ? orbit.baseOpacity * (0.22 + affinity * 0.46)
          : Math.min(0.5, orbit.baseOpacity + riskPulse + urgentPulse)
    }
  }

  composer.render()

  // 每帧用最近指针位置做射线检测，让移动中的轨道节点也能被 hover 到
  const hit = hudHoveredKey.value ?? raycastNode()
  hoveredKey.value = hit
  if (host.value) host.value.style.cursor = hit ? 'pointer' : 'default'

  // 同步 hover 指示器的屏幕投影（HTML 覆盖层跟踪被指向的节点）
  if (hasActive && host.value && camera) {
    const sp = nodeSprites.get(activeKey)
    if (sp) {
      const world = sp.getWorldPosition(_tmpV)
      world.project(camera)
      const rect = host.value.getBoundingClientRect()
      const x = (world.x * 0.5 + 0.5) * rect.width
      const y = (-world.y * 0.5 + 0.5) * rect.height
      const onScreen = world.z < 1 && world.x >= -1.1 && world.x <= 1.1 && world.y >= -1.1 && world.y <= 1.1
      hoverScreen.value = { x, y, visible: onScreen }
    }
  } else if (hoverScreen.value.visible) {
    hoverScreen.value = { ...hoverScreen.value, visible: false }
  }
}

function raycastNode(): string | null {
  if (!camera || !raycaster || !pointerInside) return null
  raycaster.setFromCamera(lastPointer, camera)
  const intersects = raycaster.intersectObjects([...nodeSprites.values()], false)
  return (intersects[0]?.object.userData.key as string | undefined) ?? null
}

function setPointerFrom(event: PointerEvent): boolean {
  if (!host.value) return false
  const rect = host.value.getBoundingClientRect()
  lastPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  lastPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  return true
}
function onPointerMove(event: PointerEvent) {
  if (setPointerFrom(event)) pointerInside = true
}
function onPointerEnter(event: PointerEvent) {
  if (setPointerFrom(event)) pointerInside = true
}
function onPointerLeave() {
  pointerInside = false
}
function onCanvasClick() {
  const key = raycastNode()
  if (key) emit('openItem', key)
}
function openHudItem(key: string) {
  hoveredKey.value = key
  emit('openItem', key)
}

onMounted(() => {
  reduceMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  void nextTick(() => {
    setupScene()
    updateCore()
  })
})

watch(() => props.items, rebuildNodes, { deep: true })
watch([corePressure, () => props.summary.total], updateCore)

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  root?.children.forEach(disposeObject)
  if (particles) disposeObject(particles)
  nodeSprites.clear()
  nodeCores.clear()
  nodeOrbits.clear()
  nodeBase.clear()
  starTex?.dispose()
  haloTex?.dispose()
  nebulaTex?.dispose()
  composer?.dispose()
  renderer.value?.dispose()
})
</script>

<template>
  <div class="ic3d-shell">
    <div ref="host" class="ic3d-stage" @pointermove="onPointerMove" @pointerenter="onPointerEnter" @pointerleave="onPointerLeave" @click="onCanvasClick">
      <canvas ref="canvas" class="ic3d-canvas" />
      <div class="ic3d-scan" />
      <div class="ic3d-vignette" />

      <div class="ic3d-core-readout" :class="`is-${corePressure}`">
        <span>在轨</span>
        <strong>{{ summary.total || urgentCount || items.length }}</strong>
        <em>{{ corePressureLabel }}</em>
      </div>

      <!-- 指向指示器：HTML 覆盖层跟踪被 hover 节点的屏幕投影（瞄准光环 + 标题标签） -->
      <div
        v-show="hoverScreen.visible && activeItem"
        class="ic3d-reticle"
        :class="activeItem ? [`risk-${activeItem.riskLevel}`, { 'is-urgent': activeItem.urgent && activeItem.riskLevel === 'calm' }] : ''"
        :style="{ left: hoverScreen.x + 'px', top: hoverScreen.y + 'px' }"
      >
        <span class="ic3d-reticle-bracket is-tl" />
        <span class="ic3d-reticle-bracket is-tr" />
        <span class="ic3d-reticle-bracket is-bl" />
        <span class="ic3d-reticle-bracket is-br" />
        <span class="ic3d-reticle-label">
          <i>{{ activeItem?.kindLabel }}</i>
          <b>{{ activeItem?.title }}</b>
          <em v-if="activeItem?.riskLevel !== 'calm' || activeItem?.urgent">{{ signalLabel(activeItem) }}</em>
        </span>
      </div>

      <transition name="ic3d-lock">
        <div v-if="activeItem" class="ic3d-target-card" :class="[`risk-${activeItem.riskLevel}`, { 'is-urgent': activeItem.urgent && activeItem.riskLevel === 'calm' }]">
          <p>当前焦点</p>
          <h4>{{ activeItem.title }}</h4>
          <div>
            <span>{{ activeItem.kindLabel }}</span>
            <span>{{ signalLabel(activeItem) }}</span>
            <span>{{ activeItem.meta }}</span>
          </div>
          <small>{{ activeItem.riskWhy || '当前波动很低，可以按自己的节奏处理。' }}</small>
          <button class="ic3d-target-open" @click.stop="activeItem && openHudItem(activeItem.key)">打开详情</button>
        </div>
      </transition>

      <div v-if="remainder" class="ic3d-remainder">另有 {{ remainder }} 项未入图</div>
    </div>

    <aside class="ic3d-hud">
      <div class="ic3d-hud-header">
        <h3>工作星图</h3>
        <span>{{ items.length }} 项在轨</span>
      </div>

      <div class="ic3d-pressure" :class="`is-${corePressure}`">
        <strong>{{ corePressureLabel }}</strong>
      </div>

      <div class="ic3d-metrics">
        <span class="is-task"><b>{{ sourceStats.task }}</b> 主线</span>
        <span class="is-bug"><b>{{ sourceStats.bug }}</b> 异常</span>
        <span class="is-local"><b>{{ sourceStats.local }}</b> 标记</span>
      </div>

      <div class="ic3d-risk-grid">
        <span><b>{{ summary.overdue }}</b> 逾期</span>
        <span><b>{{ summary.dueSoon }}</b> 临期</span>
        <span><b>{{ summary.stalled }}</b> 停滞</span>
      </div>

      <div class="ic3d-signal-list">
        <header>
          <span>优先目标</span>
          <em>{{ hotItems.length || 0 }}</em>
        </header>
        <button
          v-for="(it, idx) in hotItems"
          :key="it.key"
          :class="[`risk-${it.riskLevel}`, { 'is-active': activeItem?.key === it.key, 'is-urgent': it.urgent }]"
          @pointerenter="hudHoveredKey = it.key"
          @pointerleave="hudHoveredKey = null"
          @click="openHudItem(it.key)"
        >
          <i>{{ String(idx + 1).padStart(2, '0') }}</i>
          <span>{{ it.kindLabel }}</span>
          <strong>{{ it.title }}</strong>
        </button>
        <p v-if="!hotItems.length" class="ic3d-calm">星图平稳，暂无优先目标</p>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.ic3d-shell {
  --ic3d-text: rgba(241, 245, 249, 0.94);
  --ic3d-text-soft: rgba(203, 213, 225, 0.72);
  --ic3d-text-muted: rgba(148, 163, 184, 0.68);
  --ic3d-accent: rgba(94, 234, 212, 0.82);
  --ic3d-line: rgba(148, 163, 184, 0.18);
  --ic3d-panel: rgba(8, 13, 28, 0.7);
  --ic3d-mono: "JetBrains Mono", "SF Mono", "Cascadia Code", "Consolas", ui-monospace, monospace;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  padding: 18px;
  background: #02030a;
  font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC",
    "Hiragino Sans GB", "Noto Sans CJK SC", -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}
.ic3d-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
  background: #02030a;
  box-shadow: inset 0 0 120px rgba(14, 165, 233, 0.12), inset 0 0 220px rgba(0, 0, 0, 0.52);
}
.ic3d-canvas,
.ic3d-scan,
.ic3d-vignette {
  position: absolute;
  inset: 0;
}
.ic3d-canvas { z-index: 1; width: 100%; height: 100%; display: block; }
.ic3d-scan {
  z-index: 3;
  pointer-events: none;
  opacity: 0.1;
  background:
    linear-gradient(transparent 0 48%, rgba(125, 211, 252, 0.32) 50%, transparent 52% 100%);
  transform: translateY(-100%);
  animation: ic3d-scan 14s linear infinite;
  mix-blend-mode: screen;
}
.ic3d-vignette {
  z-index: 4;
  pointer-events: none;
  box-shadow: inset 0 0 140px rgba(0, 0, 0, 0.8), inset 0 0 32px rgba(125, 211, 252, 0.16);
}
.ic3d-stage::before {
  content: '';
  position: absolute;
  z-index: 5;
  inset: 18px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  opacity: 0.32;
  pointer-events: none;
}
.ic3d-core-readout {
  position: absolute;
  z-index: 6;
  left: 28px;
  top: 24px;
  display: grid;
  grid-template-columns: auto auto;
  gap: 0 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(2, 6, 23, 0.42);
  border: 1px solid rgba(125, 211, 252, 0.16);
  backdrop-filter: blur(12px);
}
.ic3d-core-readout span,
.ic3d-core-readout em {
  font-size: 11px;
  line-height: 1.35;
  letter-spacing: 0.12em;
  color: var(--ic3d-text-muted);
  font-style: normal;
}
.ic3d-core-readout strong {
  grid-row: span 2;
  font-family: var(--ic3d-mono);
  font-size: 32px;
  font-weight: 500;
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: rgba(248, 250, 252, 0.96);
  text-shadow: 0 0 18px rgba(125, 211, 252, 0.5);
}
.ic3d-core-readout.is-critical strong { color: #fecdd3; text-shadow: 0 0 20px rgba(244, 63, 94, 0.62); }
.ic3d-core-readout.is-elevated strong { color: #fde68a; text-shadow: 0 0 20px rgba(245, 158, 11, 0.54); }
.ic3d-target-card {
  position: absolute;
  z-index: 7;
  left: 28px;
  bottom: 28px;
  width: min(360px, calc(100% - 56px));
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(2, 6, 23, 0.82), rgba(15, 23, 42, 0.5));
  border: 1px solid rgba(125, 211, 252, 0.28);
  box-shadow: 0 0 34px rgba(14, 165, 233, 0.2);
  backdrop-filter: blur(16px);
}
.ic3d-target-card p {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.4;
  letter-spacing: 0;
  color: var(--ic3d-accent);
}
.ic3d-target-open {
  margin-top: 10px;
  padding: 6px 11px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--ic3d-text);
  background: rgba(125, 211, 252, 0.14);
  border: 1px solid rgba(125, 211, 252, 0.28);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ic3d-target-open:hover { background: rgba(125, 211, 252, 0.26); color: #fff; }

/* 指向光环 + 标题标签（HTML 覆盖层，跟踪 3D 节点屏幕投影） */
.ic3d-reticle {
  position: absolute;
  z-index: 6;
  width: 0;
  height: 0;
  pointer-events: none;
  transform: translate(-50%, -50%);
}
.ic3d-reticle::before {
  content: '';
  position: absolute;
  left: -34px;
  top: -34px;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: 1px solid rgba(125, 211, 252, 0.6);
  box-shadow: 0 0 22px rgba(125, 211, 252, 0.4), inset 0 0 14px rgba(125, 211, 252, 0.18);
  animation: ic3d-reticle-pulse 2.2s ease-in-out infinite;
}
.ic3d-reticle.risk-overdue::before { border-color: rgba(244, 63, 94, 0.75); box-shadow: 0 0 24px rgba(244, 63, 94, 0.5), inset 0 0 14px rgba(244, 63, 94, 0.22); }
.ic3d-reticle.risk-due-soon::before { border-color: rgba(251, 191, 36, 0.72); box-shadow: 0 0 24px rgba(251, 191, 36, 0.45); }
.ic3d-reticle.risk-stalled::before { border-color: rgba(167, 139, 250, 0.72); box-shadow: 0 0 24px rgba(167, 139, 250, 0.45); }
.ic3d-reticle-bracket {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(224, 242, 254, 0.92);
  filter: drop-shadow(0 0 6px rgba(125, 211, 252, 0.7));
}
.ic3d-reticle.risk-overdue .ic3d-reticle-bracket { border-color: #fecdd3; filter: drop-shadow(0 0 6px rgba(244, 63, 94, 0.8)); }
.ic3d-reticle.risk-due-soon .ic3d-reticle-bracket { border-color: #fde68a; }
.ic3d-reticle.risk-stalled .ic3d-reticle-bracket { border-color: #ddd6fe; }
.ic3d-reticle-bracket.is-tl { left: -44px; top: -44px; border-right: none; border-bottom: none; }
.ic3d-reticle-bracket.is-tr { left: 32px; top: -44px; border-left: none; border-bottom: none; }
.ic3d-reticle-bracket.is-bl { left: -44px; top: 32px; border-right: none; border-top: none; }
.ic3d-reticle-bracket.is-br { left: 32px; top: 32px; border-left: none; border-top: none; }
.ic3d-reticle-label {
  position: absolute;
  left: 46px;
  top: -22px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 11px;
  white-space: nowrap;
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.82);
  border: 1px solid rgba(125, 211, 252, 0.32);
  box-shadow: 0 0 22px rgba(14, 165, 233, 0.22);
  backdrop-filter: blur(10px);
}
.ic3d-reticle-label i {
  font-style: normal;
  font-size: 11px;
  line-height: 1.3;
  letter-spacing: 0;
  color: var(--ic3d-accent);
}
.ic3d-reticle-label b {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--ic3d-text);
}
.ic3d-reticle-label em {
  font-style: normal;
  font-size: 11px;
  line-height: 1.3;
  color: rgba(252, 165, 165, 0.85);
}
.ic3d-reticle.risk-due-soon .ic3d-reticle-label em { color: rgba(253, 230, 138, 0.9); }
.ic3d-reticle.risk-stalled .ic3d-reticle-label em { color: rgba(221, 214, 254, 0.9); }
@keyframes ic3d-reticle-pulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.07); opacity: 1; }
}
.ic3d-target-card h4 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  line-height: 1.35;
  font-weight: 650;
  color: var(--ic3d-text);
}
.ic3d-target-card div { display: flex; gap: 8px; margin-top: 8px; }
.ic3d-target-card div span {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--ic3d-text-soft);
  background: rgba(125, 211, 252, 0.12);
}
.ic3d-target-card small {
  display: block;
  margin-top: 9px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--ic3d-text-soft);
}
.ic3d-target-card.risk-overdue { border-color: rgba(244, 63, 94, 0.5); box-shadow: 0 0 42px rgba(244, 63, 94, 0.26); }
.ic3d-target-card.risk-due-soon { border-color: rgba(251, 191, 36, 0.46); }
.ic3d-target-card.risk-stalled { border-color: rgba(167, 139, 250, 0.46); }
.ic3d-remainder {
  position: absolute;
  z-index: 6;
  right: 28px;
  bottom: 28px;
  font-size: 12px;
  letter-spacing: 0;
  color: var(--ic3d-text-muted);
}
.ic3d-hud {
  position: absolute;
  z-index: 8;
  top: 18px;
  right: 18px;
  bottom: 18px;
  width: min(312px, calc(100% - 36px));
  min-height: 0;
  overflow: hidden auto;
  padding: 18px;
  border-radius: 18px;
  background:
    linear-gradient(180deg, var(--ic3d-panel), rgba(15, 23, 42, 0.42)),
    radial-gradient(circle at 0 0, rgba(45, 212, 191, 0.1), transparent 40%);
  border: 1px solid var(--ic3d-line);
  box-shadow: inset 0 0 32px rgba(14, 165, 233, 0.05), 0 18px 60px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(16px) saturate(135%);
}
.ic3d-signal-list header span {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  letter-spacing: 0.06em;
  color: var(--ic3d-accent);
}
.ic3d-hud-header h3 {
  margin: 0 0 4px;
  font-size: 22px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--ic3d-text);
}
.ic3d-hud-header > span {
  font-family: var(--ic3d-mono);
  font-size: 12px;
  line-height: 1.45;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--ic3d-text-muted);
}
.ic3d-pressure {
  margin-top: 16px;
  padding: 12px 0 6px;
  border-top: 1px solid rgba(125, 211, 252, 0.14);
}
.ic3d-pressure strong {
  display: block;
  margin-top: 4px;
  font-family: var(--ic3d-mono);
  font-size: 20px;
  line-height: 1.25;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--ic3d-text);
}
.ic3d-pressure.is-critical { border-top-color: rgba(244, 63, 94, 0.42); }
.ic3d-pressure.is-critical strong { color: #fecdd3; }
.ic3d-pressure.is-elevated { border-top-color: rgba(245, 158, 11, 0.36); }
.ic3d-pressure.is-elevated strong { color: #fde68a; }
.ic3d-metrics,
.ic3d-risk-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 10px;
}
.ic3d-metrics span,
.ic3d-risk-grid span {
  padding: 10px 0 6px 12px;
  text-align: left;
  font-size: 11px;
  line-height: 1.4;
  letter-spacing: 0.04em;
  color: var(--ic3d-text-muted);
  border-left: 1px solid rgba(125, 211, 252, 0.12);
}
.ic3d-metrics span:first-child,
.ic3d-risk-grid span:first-child {
  padding-left: 0;
  border-left: none;
}
.ic3d-metrics b,
.ic3d-risk-grid b {
  display: block;
  margin-bottom: 4px;
  font-family: var(--ic3d-mono);
  font-size: 22px;
  line-height: 1.1;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: var(--ic3d-text);
}
.ic3d-metrics span.is-task b { color: #7dd3fc; }
.ic3d-metrics span.is-bug b { color: #fda4af; }
.ic3d-metrics span.is-local b { color: #5eead4; }
.ic3d-risk-grid span:first-child b { color: #fda4af; }
.ic3d-risk-grid span:nth-child(2) b { color: #fde68a; }
.ic3d-risk-grid span:nth-child(3) b { color: #ddd6fe; }
.ic3d-signal-list {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(125, 211, 252, 0.14);
}
.ic3d-signal-list header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ic3d-signal-list header em {
  font-style: normal;
  font-family: var(--ic3d-mono);
  font-size: 12px;
  color: var(--ic3d-text-muted);
}
.ic3d-signal-list button {
  position: relative;
  width: 100%;
  display: grid;
  grid-template-columns: 22px 38px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 10px 8px 10px 14px;
  color: var(--ic3d-text-soft);
  text-align: left;
  border-top: 1px solid rgba(125, 211, 252, 0.1);
  transition: color 0.16s, background 0.16s;
}
.ic3d-signal-list button::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 2px;
  background: rgba(125, 211, 252, 0.55);
  opacity: 0;
  transition: opacity 0.16s;
}
.ic3d-signal-list button:hover,
.ic3d-signal-list button.is-active {
  color: #fff;
  background: rgba(125, 211, 252, 0.06);
}
.ic3d-signal-list button:hover::before,
.ic3d-signal-list button.is-active::before { opacity: 1; }
.ic3d-signal-list i {
  font-style: normal;
  font-family: var(--ic3d-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ic3d-text-muted);
}
.ic3d-signal-list span {
  font-size: 11px;
  color: var(--ic3d-accent);
}
.ic3d-signal-list strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
}
.ic3d-signal-list button.risk-overdue span,
.ic3d-signal-list button.risk-overdue strong { color: #fecdd3; }
.ic3d-signal-list button.risk-due-soon strong { color: #fde68a; }
.ic3d-signal-list button.risk-stalled strong { color: #ddd6fe; }
.ic3d-calm {
  margin: 12px 0 0;
  padding: 10px 0 0;
  font-size: 12px;
  line-height: 1.55;
  letter-spacing: 0.02em;
  color: var(--ic3d-text-muted);
  border-top: 1px solid rgba(125, 211, 252, 0.1);
}
.ic3d-lock-enter-active,
.ic3d-lock-leave-active { transition: opacity 0.18s, transform 0.18s; }
.ic3d-lock-enter-from,
.ic3d-lock-leave-to { opacity: 0; transform: translateY(8px) scale(0.98); }
@keyframes ic3d-scan {
  0% { transform: translateY(-100%); }
  58%, 100% { transform: translateY(100%); }
}
@media (max-width: 1100px) {
  .ic3d-hud {
    top: auto;
    left: 18px;
    width: auto;
    max-height: 320px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ic3d-scan { animation: none; }
}
/* 紧急（玫红）标识：与 UnifiedInbox 紧急色一致，叠加在风险色之上 */
.ic3d-reticle.is-urgent::before {
  border-color: rgba(251, 113, 133, 0.78);
  box-shadow: 0 0 26px rgba(251, 113, 133, 0.55), inset 0 0 14px rgba(251, 113, 133, 0.24);
}
.ic3d-reticle.is-urgent .ic3d-reticle-bracket {
  border-color: #fda4af;
  filter: drop-shadow(0 0 6px rgba(251, 113, 133, 0.8));
}
.ic3d-target-card.is-urgent {
  border-color: rgba(251, 113, 133, 0.5);
  box-shadow: 0 0 42px rgba(251, 113, 133, 0.26);
}
.ic3d-signal-list button.is-urgent::before {
  opacity: 1;
  background: rgba(251, 113, 133, 0.85);
  box-shadow: 0 0 10px rgba(251, 113, 133, 0.6);
}
.ic3d-signal-list button.is-urgent.risk-calm strong { color: #fda4af; }
</style>
