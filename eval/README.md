# eval/ — 晨报 prompt 评测骨架（promptfoo）

把「改 system prompt → 凭感觉」变成「**改 prompt → 出对比数字**」。这是整个项目第一条评测闭环，不依赖任何训练 / 微调，只用 promptfoo + 你现有的模型配置。

## 这是什么

针对首页「每日晨报」（`src/features/chat/briefing.ts`）的 system prompt，用 10 条固定的工作台快照做输入，跑两个 prompt 版本（v1 现网基线 / v2 微调变体），出一张**通过率对比表**。改一句 prompt、重跑、看数字涨没涨——这就是评测。

```
        v1(现网基线)   v2(你改的)
case①     ✓             ✓
case②     ✗(漏了)       ✓
…
通过率    70%           85%   ← 这就是「我比之前强 15%」的依据
```

## 一次性准备（3 步）

1. **导出模型配置**：打开页面「模型线路控制台」→ 点导出，把 JSON 整体粘贴进 `eval/llm-config.local.json`（参考 `llm-config.local.json.example` 的形状）。该文件含明文 API Key，**已被 gitignore**，不会进仓库。
2. **装依赖**：`npm install`（已在 package.json 加了 `promptfoo` devDep）。
3. **自检**：`npm run eval:config` —— 打印将用哪个 provider / model / 端点，key 脱敏。不发任何网络请求。

## 跑评测

```bash
npm run eval:briefing    # 跑 10 条 × 2 prompt = 20 次调用，成本可忽略
npm run eval:view        # 浏览器打开对比矩阵 + 每条输出 + 断言明细
```

终端会直接出 v1 / v2 各自的通过率与失败明细。

## 怎么读这个数字

- **同一个 prompt、同一组固定输入** → 通过率就是它的质量分数。
- **v1 70% / v2 85%** → 你的改动净赚 +15pt，有据可查。
- 点开失败的 case → 能看到模型实际输出 + 哪条 assert 挂了 → 知道改哪儿。
- 评测集是**固定的**，所以两次跑之间的差异**只能**来自 prompt（或模型）——这就是它可比的原因。

## 日常迭代闭环

1. 想试个新写法 → 复制 `prompts/briefing.system.v2.txt` 改几行（或直接改 v2）。
2. `npm run eval:briefing` → 看通过率。
3. 涨了就把它定为新基线；跌了就知道这思路不对。
4. 改了 `briefing.ts` 的源 prompt → `npm run eval:sync` 让 v1 跟着更新，基线不漂移。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run eval:config` | 校验配置在位、打印将用的 provider/model（不发请求） |
| `npm run eval:sync` | 从 `briefing.ts` 抽现网 prompt 覆写 `v1.txt`（防基线漂移） |
| `npm run eval:briefing` | 跑评测，出 v1/v2 对比 |
| `npm run eval:view` | 浏览器看结果矩阵 + 历史曲线 |

## 怎么扩展（从这条骨架长出去）

- **加「AI 评委」断言**（评语气 / 完整度这类没法 `contains` 的维度）：在 case 里加
  ```yaml
  - type: llm-rubric
    value: "语气像靠谱同事，简洁不寒暄；工作项名用「」框起"
  ```
  promptfoo 会用你配置的同一个模型当评委打分。MVP 默认没开，是为了让首跑零额外 token、纯确定性。
- **多模型横向对比**：`provider.mjs` 现在只导出 active provider。把它改成导出一个数组（每个 provider 一项），promptfoo 就会多出几列，一次看出 DeepSeek / Qwen / GPT 各自的通过率。
- **加 inbox-insight 评测**：结构完全同构（`src/features/chat/inbox-insight.ts`），复制这套目录、换 prompt 文件和断言即可。
- **沉淀偏好数据**：把每次失败 case 的「bad output」和你手动改好的「good output」存成 `(prompt, chosen, rejected)` → 这就是日后 DPO/微调的数据集原料，也是评测之上的下一层。

## 安全

- `eval/llm-config.local.json` 含明文 API Key，**已在 `.gitignore`**，别手动提交。
- 评测直连 `${baseUrl}/chat/completions` + `Bearer`，与生产经 dev 代理转发后的真实上游完全一致；不经过浏览器代理。
