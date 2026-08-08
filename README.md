# kawaii-image Skill

这是 kawaii-image 开放 API 的标准 Agent Skill，也适用于 Claude Code、Codex、OpenCode、Kimi 等支持 Markdown Skill 的 Agent。

## 安装

公开仓库：`kawaii-ren/kawaii-image-skill`

- Claude Code：将 `apps/skills/kawaii-image` 复制或软链到项目 `.claude/skills/kawaii-image`。
- Codex：将目录复制或软链到 `~/.codex/skills/kawaii-image`，或在 Codex 配置中启用该 skill 路径。
- OpenCode / Kimi：把该目录加入对应 Agent 的 skills 目录或配置路径。
- 或直接执行：`npx skills add kawaii-ren/kawaii-image-skill`

## 配置

以下命令需要在已安装的 kawaii-image Skill 目录内执行；Codex 项目内通常位于 `.agents/skills/kawaii-image`，全局位于 `~/.codex/skills/kawaii-image`。

```bash
node scripts/kawaii.mjs login
```

CLI 默认连接 `https://kawaii.ren`。
`login` 会打开浏览器完成授权，并把 Key 保存到 `~/.kawaii-image/config.json`。
也可以手动创建 Key 后设置 `KAWAII_IMAGE_API_TOKEN`。

## 使用

```bash
node scripts/kawaii.mjs capabilities
node scripts/kawaii.mjs create --prompt "a red car on a beach" --wait --output ./result.png
```

API Key 由组织管理员在 Web 管理端的“开放 API”页面创建。
