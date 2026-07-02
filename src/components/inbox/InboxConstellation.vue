<script setup lang="ts">
/**
 * Three.js 任务星域：把统一收件箱里的真实工作项渲染成一个带电影感的 3D 科幻星图。
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
const corePressure = computed(() => {
  if (props.summary.overdue || props.urgentCount >= 3) return 'CRITICAL'
  if (props.summary.dueSoon || props.summary.stalled) return 'ELEVATED'
  return 'STABLE'
})
const activeItem = computed(() => {
  const key = hoveredKey.value
  return key ? props.items.find((it) => it.key === key) ?? null : null
})

const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let composer: EffectComposer | null = null
let root: THREE.Group | null = null
let nodesGroup: THREE.Group | null = null
let core: THREE.Mesh | null = null
let coreHalo: THREE.Sprite | null = null
let coreOuter: THREE.Sprite | null = null
let particles: THREE.Points | null = null
let raycaster: THREE.Raycaster | null = null
const lastPointer = new THREE.Vector2(99, 99)
let pointerInside = false
const _tmpV = new THREE.Vector3()
let frame = 0
let resizeObserver: ResizeObserver | null = null
const nodeSprites = new Map<string, THREE.Sprite>()
const nodeCores = new Map<string, THREE.Mesh>()
/** 仅任务拥有轨道（一任务一轨道）；bugs / 本地项无轨道，散落分布 */
const nodeOrbits = new Map<string, { ring: THREE.LineLoop; angle: number; speed: number; radiusX: number; radiusY: number }>()
const nodeBase = new Map<string, { position: THREE.Vector3; scale: number; color: THREE.Color; risk: ConstellationRisk; drifts: boolean }>()

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
  // 深空底
  const base = ctx.createLinearGradient(0, 0, w, h)
  base.addColorStop(0, '#03040d')
  base.addColorStop(0.5, '#070a1c')
  base.addColorStop(1, '#0a0820')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // 大块星云气体（多色径向渐变，加性叠加）
  ctx.globalCompositeOperation = 'lighter'
  const clouds: Array<[number, number, number, string]> = [
    [w * 0.32, h * 0.4, w * 0.5, 'rgba(56,189,248,0.45)'],   // 青
    [w * 0.7, h * 0.32, w * 0.46, 'rgba(168,85,247,0.4)'],    // 紫
    [w * 0.6, h * 0.72, w * 0.42, 'rgba(244,114,182,0.32)'],  // 玫红
    [w * 0.22, h * 0.7, w * 0.4, 'rgba(45,212,191,0.3)'],     // 青绿
    [w * 0.5, h * 0.52, w * 0.6, 'rgba(99,102,241,0.28)'],    // 靛
  ]
  for (const [x, y, r, color] of clouds) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(0.5, color.replace(/[\d.]+\)$/, '0.12)'))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // 远处密集星尘
  ctx.globalCompositeOperation = 'source-over'
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const r = Math.random() * 1.3
    const a = Math.random() * 0.7 + 0.1
    ctx.fillStyle = `rgba(255,255,255,${a})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 几颗亮星带光晕
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const g = ctx.createRadialGradient(x, y, 0, x, y, 14)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, 14, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function colorOf(kind: ConstellationKind, risk: ConstellationRisk): THREE.Color {
  if (risk === 'overdue') return new THREE.Color('#ff3b6b')
  if (risk === 'due-soon') return new THREE.Color('#ffd166')
  if (risk === 'stalled') return new THREE.Color('#a78bfa')
  if (kind === 'bug') return new THREE.Color('#fb7185')
  if (kind === 'local') return new THREE.Color('#2dd4bf')
  return new THREE.Color('#38bdf8')
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
  scene.fog = new THREE.FogExp2(0x05071a, 0.028)

  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 160)
  camera.position.set(0, 3.8, 16.5)
  camera.lookAt(0, 0, 0)

  root = new THREE.Group()
  root.rotation.x = -0.2
  // HUD 悬浮在右侧时，把任务星域的视觉重心保留在原左侧舞台位置，避免核心被面板遮住。
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.6, 0.22)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const ambient = new THREE.AmbientLight(0x88aaff, 0.5)
  scene.add(ambient)
  const keyLight = new THREE.PointLight(0x7dd3fc, 6, 30)
  keyLight.position.set(-5, 6, 8)
  scene.add(keyLight)
  const dangerLight = new THREE.PointLight(0xff3b6b, props.summary.overdue ? 5 : 1.6, 22)
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
  const pressureColor = props.summary.overdue ? '#ff3b6b' : props.summary.dueSoon ? '#f59e0b' : '#ffe0a3'
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
}

/** 构建一条任务的专属轨道环（椭圆，独立倾角） */
function makeOrbitRing(
  radiusX: number,
  radiusY: number,
  tiltX: number,
  tiltZ: number,
  color: THREE.Color,
): THREE.LineLoop {
  const curve = new THREE.EllipseCurve(0, 0, radiusX, radiusY, 0, Math.PI * 2)
  const points = curve.getPoints(160)
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, 0, p.y)))
  const material = new THREE.LineBasicMaterial({
    color: color.clone().lerp(new THREE.Color('#ffffff'), 0.3),
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
  })
  const line = new THREE.LineLoop(geometry, material)
  line.rotation.x = tiltX
  line.rotation.z = tiltZ
  return line
}

/** 轨道上 angle 对应的世界位置（与 ring 几何同参照系） */
function writeOrbitPosition(
  o: { radiusX: number; radiusY: number; ring: THREE.LineLoop; angle: number },
  target: THREE.Vector3,
): THREE.Vector3 {
  target.set(Math.cos(o.angle) * o.radiusX, 0, Math.sin(o.angle) * o.radiusY)
  target.applyQuaternion(o.ring.quaternion)
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

  const tasks = props.items.filter((it) => it.kind === 'task')
  const others = props.items.filter((it) => it.kind !== 'task')

  // 任务：每个任务一条专属轨道，节点沿轨道运行
  // 半径动态拟合：不管几个任务都落在 [rMin, rMax] 内，避免最外圈跑出视口
  const N = tasks.length
  const rMin = 3.4
  const rMax = 7.6
  const spacing = N > 1 ? (rMax - rMin) / (N - 1) : 0
  tasks.forEach((it, index) => {
    const color = colorOf(it.kind, it.riskLevel)
    const radiusX = N === 1 ? (rMin + rMax) / 2 : rMin + index * spacing
    const radiusY = radiusX * (0.32 + Math.random() * 0.16)
    const tiltX = 1.05 + Math.random() * 0.35
    const tiltZ = -0.4 + Math.random() * 0.8
    const ring = makeOrbitRing(radiusX, radiusY, tiltX, tiltZ, color)
    nodesGroup!.add(ring)

    const angle = Math.random() * Math.PI * 2
    const speed = (0.05 + Math.random() * 0.07) * (Math.random() < 0.5 ? -1 : 1)
    const orbit = { ring, angle, speed, radiusX, radiusY }
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

    nodeBase.set(it.key, { position: pos.clone(), scale, color: color.clone(), risk: it.riskLevel, drifts: false })
  })

  // Bug / 本地：无轨道，按类型散落（Bug 中场异常区，本地外缘漂浮带）
  others.forEach((it, index) => {
    const color = colorOf(it.kind, it.riskLevel)
    const a = Math.random() * Math.PI * 2
    const radius = it.kind === 'bug' ? 5.0 + Math.random() * 1.8 : 6.8 + Math.random() * 1.6
    const height = (Math.random() - 0.5) * 2.2
    const pos = new THREE.Vector3(Math.cos(a) * radius, height, Math.sin(a) * radius * 0.5)
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

    nodeBase.set(it.key, { position: pos.clone(), scale, color: color.clone(), risk: it.riskLevel, drifts: true })
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
  const color = new THREE.Color(props.summary.overdue ? '#ff3b6b' : props.summary.dueSoon ? '#f59e0b' : '#ffe0a3')
  if (core?.material instanceof THREE.MeshStandardMaterial) {
    core.material.emissive.copy(color)
    core.material.emissiveIntensity = props.summary.total ? 2.0 : 1.4
  }
  if (coreHalo?.material instanceof THREE.SpriteMaterial) coreHalo.material.color.copy(color)
  if (coreOuter?.material instanceof THREE.SpriteMaterial) coreOuter.material.color.copy(color)
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
    root.rotation.y = Math.sin(t * 0.16) * 0.12
    if (particles) particles.rotation.y += 0.0004
    if (core) {
      core.rotation.x += 0.003
      core.rotation.y += 0.0045
      const s = 1 + Math.sin(t * 2.2) * 0.04
      core.scale.setScalar(s)
    }
    if (coreHalo) {
      const s = 3.2 + Math.sin(t * 1.3) * 0.26
      coreHalo.scale.set(s, s, 1)
    }
    if (coreOuter) {
      const s = 5.6 + Math.sin(t * 0.9) * 0.4
      coreOuter.scale.set(s, s, 1)
    }
  }

  const activeKey = hoveredKey.value
  const hasActive = !!activeKey

  for (const [key, sprite] of nodeSprites) {
    const base = nodeBase.get(key)
    if (!base) continue
    const orbit = nodeOrbits.get(key)
    const isActive = key === activeKey

    // 任务沿轨道运行（hover 时该项停住，便于点击）；bug/本地项原地轻飘
    if (orbit) {
      if (!slow && !isActive) orbit.angle += orbit.speed * 0.016
      writeOrbitPosition(orbit, sprite.position)
      base.position.copy(sprite.position)
    } else if (!slow) {
      sprite.position.x = base.position.x + Math.sin(t * 0.8 + (sprite.userData.index ?? 0)) * 0.12
      sprite.position.y = base.position.y + Math.sin(t * 1.1 + (sprite.userData.index ?? 0) * 1.3) * 0.12
    }

    const pulse = slow ? 0 : Math.sin(t * 2.4 + (sprite.userData.index ?? 0)) * 0.06
    // 被指向的节点放大爆亮，其余在指向时压暗到 20%——一眼锁定
    const dim = hasActive && !isActive ? 0.2 : 1
    const boost = isActive ? 2.1 : 1
    const target = base.scale * boost * dim * (1 + (slow ? 0 : Math.max(0, pulse) * 0.5))
    sprite.scale.set(target, target, 1)
    if (sprite.material instanceof THREE.SpriteMaterial) {
      sprite.material.opacity = isActive ? 1 : base.risk === 'calm' ? 0.85 * dim : dim
    }
    const coreMesh = nodeCores.get(key)
    if (coreMesh) {
      coreMesh.position.copy(sprite.position)
      const cs = (0.16 + (base.risk === 'calm' ? 0 : 0.1)) * boost * dim
      coreMesh.scale.setScalar(cs)
    }
    // 任务轨道环：hover 时该轨道高亮，其余变暗
    if (orbit?.ring.material instanceof THREE.LineBasicMaterial) {
      orbit.ring.material.opacity = isActive ? 0.95 : hasActive ? 0.1 : 0.42
    }
  }

  composer.render()

  // 每帧用最近指针位置做射线检测，让移动中的任务节点也能被 hover 到
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

function onPointerMove(event: PointerEvent) {
  if (!host.value) return
  const rect = host.value.getBoundingClientRect()
  lastPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  lastPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  pointerInside = true
}
function onPointerEnter() {
  pointerInside = true
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
  void nextTick(setupScene)
})

watch(() => props.items, rebuildNodes, { deep: true })
watch(() => props.summary, updateCore, { deep: true })

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

      <div class="ic3d-core-readout" :class="`is-${corePressure.toLowerCase()}`">
        <span>CORE</span>
        <strong>{{ summary.total || urgentCount || items.length }}</strong>
        <em>{{ corePressure }}</em>
      </div>

      <!-- 指向指示器：HTML 覆盖层跟踪被 hover 节点的屏幕投影（瞄准光环 + 标题标签） -->
      <div
        v-show="hoverScreen.visible && activeItem"
        class="ic3d-reticle"
        :class="activeItem ? `risk-${activeItem.riskLevel}` : ''"
        :style="{ left: hoverScreen.x + 'px', top: hoverScreen.y + 'px' }"
      >
        <span class="ic3d-reticle-bracket is-tl" />
        <span class="ic3d-reticle-bracket is-tr" />
        <span class="ic3d-reticle-bracket is-bl" />
        <span class="ic3d-reticle-bracket is-br" />
        <span class="ic3d-reticle-label">
          <i>{{ activeItem?.kindLabel }}</i>
          <b>{{ activeItem?.title }}</b>
          <em v-if="activeItem?.riskLevel !== 'calm'">{{ activeItem?.riskLabel }}</em>
        </span>
      </div>

      <transition name="ic3d-lock">
        <div v-if="activeItem" class="ic3d-target-card" :class="`risk-${activeItem.riskLevel}`">
          <p>TARGET</p>
          <h4>{{ activeItem.title }}</h4>
          <div>
            <span>{{ activeItem.kindLabel }}</span>
            <span>{{ activeItem.meta }}</span>
          </div>
          <small>{{ activeItem.riskWhy || '信号稳定，暂无异常风险。' }}</small>
          <button class="ic3d-target-open" @click.stop="activeItem && openHudItem(activeItem.key)">点击打开 →</button>
        </div>
      </transition>

      <div v-if="remainder" class="ic3d-remainder">+{{ remainder }} DEEP SPACE SIGNALS</div>
    </div>

    <aside class="ic3d-hud">
      <div class="ic3d-hud-header">
        <p>MISSION CONSTELLATION</p>
        <h3>任务星域</h3>
        <span>{{ items.length }} NODES ONLINE</span>
      </div>

      <div class="ic3d-pressure" :class="`is-${corePressure.toLowerCase()}`">
        <span>CORE PRESSURE</span>
        <strong>{{ corePressure }}</strong>
      </div>

      <div class="ic3d-metrics">
        <span><b>{{ sourceStats.task }}</b> TASK</span>
        <span><b>{{ sourceStats.bug }}</b> BUG</span>
        <span><b>{{ sourceStats.local }}</b> LOCAL</span>
      </div>

      <div class="ic3d-risk-grid">
        <span><b>{{ summary.overdue }}</b> OVERDUE</span>
        <span><b>{{ summary.dueSoon }}</b> DUE SOON</span>
        <span><b>{{ summary.stalled }}</b> STALLED</span>
      </div>

      <div class="ic3d-signal-list">
        <header>
          <span>ACTIVE ANOMALIES</span>
          <em>{{ hotItems.length || 0 }}</em>
        </header>
        <button
          v-for="(it, idx) in hotItems"
          :key="it.key"
          :class="[`risk-${it.riskLevel}`, { 'is-active': activeItem?.key === it.key }]"
          @pointerenter="hudHoveredKey = it.key"
          @pointerleave="hudHoveredKey = null"
          @click="openHudItem(it.key)"
        >
          <i>{{ String(idx + 1).padStart(2, '0') }}</i>
          <span>{{ it.kindLabel }}</span>
          <strong>{{ it.title }}</strong>
        </button>
        <p v-if="!hotItems.length" class="ic3d-calm">NO ACTIVE ANOMALY · 星域稳定运行</p>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.ic3d-shell {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  padding: 18px;
  background: #03040d;
  /* 与项目统一字体（见 src/style.css 的 body） */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "Noto Sans", sans-serif;
}
.ic3d-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
  background: #03040d;
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
  opacity: 0.22;
  background:
    linear-gradient(transparent 0 48%, rgba(125, 211, 252, 0.32) 50%, transparent 52% 100%);
  transform: translateY(-100%);
  animation: ic3d-scan 6s linear infinite;
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
  font-size: 10px;
  letter-spacing: 0.06em;
  color: rgba(186, 230, 253, 0.6);
  font-style: normal;
}
.ic3d-core-readout strong {
  grid-row: span 2;
  font-size: 32px;
  font-weight: 600;
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
  color: #e0f2fe;
  text-shadow: 0 0 18px rgba(125, 211, 252, 0.72);
}
.ic3d-core-readout.is-critical strong { color: #fecdd3; text-shadow: 0 0 20px rgba(244, 63, 94, 0.82); }
.ic3d-core-readout.is-elevated strong { color: #fde68a; text-shadow: 0 0 20px rgba(245, 158, 11, 0.72); }
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
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(125, 211, 252, 0.85);
}
.ic3d-target-open {
  margin-top: 10px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 11px;
  color: rgba(186, 230, 253, 0.9);
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
  animation: ic3d-reticle-pulse 1.4s ease-in-out infinite;
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
  font-size: 10px;
  letter-spacing: 0.04em;
  color: rgba(125, 211, 252, 0.78);
}
.ic3d-reticle-label b {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.96);
}
.ic3d-reticle-label em {
  font-style: normal;
  font-size: 10px;
  color: rgba(252, 165, 165, 0.85);
}
.ic3d-reticle.risk-due-soon .ic3d-reticle-label em { color: rgba(253, 230, 138, 0.9); }
.ic3d-reticle.risk-stalled .ic3d-reticle-label em { color: rgba(221, 214, 254, 0.9); }
@keyframes ic3d-reticle-pulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.12); opacity: 1; }
}
.ic3d-target-card h4 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.94);
}
.ic3d-target-card div { display: flex; gap: 8px; margin-top: 8px; }
.ic3d-target-card div span {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  color: rgba(224, 242, 254, 0.8);
  background: rgba(125, 211, 252, 0.12);
}
.ic3d-target-card small {
  display: block;
  margin-top: 9px;
  line-height: 1.55;
  color: rgba(226, 232, 240, 0.66);
}
.ic3d-target-card.risk-overdue { border-color: rgba(244, 63, 94, 0.5); box-shadow: 0 0 42px rgba(244, 63, 94, 0.26); }
.ic3d-target-card.risk-due-soon { border-color: rgba(251, 191, 36, 0.46); }
.ic3d-target-card.risk-stalled { border-color: rgba(167, 139, 250, 0.46); }
.ic3d-remainder {
  position: absolute;
  z-index: 6;
  right: 28px;
  bottom: 28px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(125, 211, 252, 0.56);
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
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(2, 6, 23, 0.66), rgba(15, 23, 42, 0.34)),
    radial-gradient(circle at 0 0, rgba(14, 165, 233, 0.18), transparent 38%);
  border: 1px solid rgba(125, 211, 252, 0.18);
  box-shadow: inset 0 0 42px rgba(14, 165, 233, 0.08), 0 18px 60px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(16px) saturate(135%);
}
.ic3d-hud::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(105deg, transparent 0 36%, rgba(125, 211, 252, 0.14) 48%, transparent 60% 100%);
  transform: translateX(-120%);
  animation: ic3d-hud-sheen 6.5s ease-in-out infinite;
}
.ic3d-hud-header p,
.ic3d-signal-list header span,
.ic3d-pressure span {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgba(45, 212, 191, 0.78);
}
.ic3d-hud-header h3 {
  margin: 7px 0 4px;
  font-size: 22px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: rgba(255, 255, 255, 0.96);
}
.ic3d-hud-header > span {
  font-size: 12px;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: rgba(186, 230, 253, 0.56);
}
.ic3d-pressure {
  margin-top: 18px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.22);
}
.ic3d-pressure strong {
  display: block;
  margin-top: 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #bae6fd;
  text-shadow: 0 0 18px rgba(34, 211, 238, 0.5);
}
.ic3d-pressure.is-critical { background: rgba(244, 63, 94, 0.12); border-color: rgba(244, 63, 94, 0.38); }
.ic3d-pressure.is-critical strong { color: #fecdd3; text-shadow: 0 0 18px rgba(244, 63, 94, 0.62); }
.ic3d-pressure.is-elevated { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.32); }
.ic3d-pressure.is-elevated strong { color: #fde68a; text-shadow: 0 0 18px rgba(245, 158, 11, 0.54); }
.ic3d-metrics,
.ic3d-risk-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.ic3d-metrics span,
.ic3d-risk-grid span {
  padding: 10px 8px;
  border-radius: 14px;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(226, 232, 240, 0.52);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.ic3d-metrics b,
.ic3d-risk-grid b {
  display: block;
  margin-bottom: 3px;
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(224, 242, 254, 0.96);
}
.ic3d-risk-grid span:first-child b { color: #fda4af; }
.ic3d-risk-grid span:nth-child(2) b { color: #fde68a; }
.ic3d-risk-grid span:nth-child(3) b { color: #ddd6fe; }
.ic3d-signal-list { margin-top: 18px; }
.ic3d-signal-list header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ic3d-signal-list header em {
  font-style: normal;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.6);
}
.ic3d-signal-list button {
  position: relative;
  width: 100%;
  display: grid;
  grid-template-columns: 24px 42px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 10px 0;
  color: rgba(226, 232, 240, 0.74);
  text-align: left;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  transition: color 0.16s, background 0.16s, padding 0.16s;
}
.ic3d-signal-list button::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 999px;
  background: rgba(125, 211, 252, 0.42);
  opacity: 0;
  box-shadow: 0 0 12px currentColor;
}
.ic3d-signal-list button:hover,
.ic3d-signal-list button.is-active {
  color: #fff;
  padding-left: 8px;
  background: linear-gradient(90deg, rgba(125, 211, 252, 0.1), transparent);
}
.ic3d-signal-list button:hover::before,
.ic3d-signal-list button.is-active::before { opacity: 1; }
.ic3d-signal-list i {
  font-style: normal;
  font-size: 10px;
  color: rgba(125, 211, 252, 0.58);
}
.ic3d-signal-list span {
  font-size: 10px;
  color: rgba(125, 211, 252, 0.72);
}
.ic3d-signal-list strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 500;
}
.ic3d-signal-list button.risk-overdue span,
.ic3d-signal-list button.risk-overdue strong { color: #fecdd3; }
.ic3d-signal-list button.risk-due-soon strong { color: #fde68a; }
.ic3d-signal-list button.risk-stalled strong { color: #ddd6fe; }
.ic3d-calm {
  margin: 14px 0 0;
  padding: 12px;
  border-radius: 14px;
  font-size: 12px;
  letter-spacing: 0.02em;
  color: rgba(94, 234, 212, 0.66);
  background: rgba(45, 212, 191, 0.08);
  border: 1px solid rgba(45, 212, 191, 0.14);
}
.ic3d-lock-enter-active,
.ic3d-lock-leave-active { transition: opacity 0.18s, transform 0.18s; }
.ic3d-lock-enter-from,
.ic3d-lock-leave-to { opacity: 0; transform: translateY(8px) scale(0.98); }
@keyframes ic3d-scan {
  0% { transform: translateY(-100%); }
  58%, 100% { transform: translateY(100%); }
}
@keyframes ic3d-hud-sheen {
  0%, 34% { transform: translateX(-120%); }
  70%, 100% { transform: translateX(120%); }
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
  .ic3d-scan,
  .ic3d-hud::before { animation: none; }
}
</style>
