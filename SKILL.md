---
name: kawaii-image
description: Generate or edit images through the kawaii-image open API. Use when the agent needs to create image generation tasks, upload reference images, stream task status, retry failed tasks, or download generated images from a configured kawaii-image deployment.
---

# kawaii-image 图像生成

kawaii-image 提供异步单张图像生成开放 API。Agent 是开放 API 的客户端之一，普通 App、脚本和集成方也可以直接使用同一套接口。

## 前置条件

- 需要可访问的 kawaii-image 服务地址。
- 组织需要开启开放 API；普通用户需要组织允许后，每个用户最多可创建 5 个有效 Key。
- 需要 Node.js 18+。

## 首次配置

以下命令需要在已安装的 kawaii-image Skill 目录内执行；Codex 项目内通常位于 `.agents/skills/kawaii-image`，全局位于 `~/.codex/skills/kawaii-image`。

优先使用浏览器自动授权：

```bash
node scripts/kawaii.mjs login
```

CLI 会启动本机回调并打开浏览器。登录后授权页会为当前组织创建或获取 API Key，CLI 自动保存到 `~/.kawaii-image/config.json`。

也可以手动创建 Key 后配置环境变量：

```bash
export KAWAII_IMAGE_API_TOKEN=ki_xxxxxxxx
```

## 最短工作流

1. 查看能力与模型：

```bash
node scripts/kawaii.mjs capabilities
node scripts/kawaii.mjs login
```

2. 创建并等待生成：

```bash
node scripts/kawaii.mjs create \
  --prompt "日落下的海边公路，一辆红色跑车" \
  --ref ./car.png \
  --wait \
  --output ./result.png
```

3. 查看已有任务：

```bash
node scripts/kawaii.mjs status <taskUuid>
```

## 命令

```bash
node scripts/kawaii.mjs capabilities
node scripts/kawaii.mjs login
node scripts/kawaii.mjs logout
node scripts/kawaii.mjs models
node scripts/kawaii.mjs create --prompt "..." [--model uuid] [--aspect-ratio 1:1] [--image-size 1024] [--ref 文件] [--wait]
node scripts/kawaii.mjs status <taskUuid>
node scripts/kawaii.mjs list [--status pending] [--limit 20]
node scripts/kawaii.mjs upload <file...>
node scripts/kawaii.mjs retry <taskUuid>
node scripts/kawaii.mjs cancel <taskUuid>
node scripts/kawaii.mjs download <taskUuid> [--output result.png]
```

## 系统能力

完整能力说明见 `SYSTEM.md`。重要约束：

- 模型必须从 `/api/v1/models` 或 `/api/v1/capabilities` 返回列表中选择。
- 参考图先上传，再把返回的引用值作为 `refs` 传入。
- 任务完成后通过 `download_url` 下载结果。
- `402` 表示组织付费套餐过期，错误详情会包含完整续费 URL。
- 不展示底层模型/服务真实名称。

## 安全

- API Key 只能通过请求头 `Authorization: Bearer <key>` 发送，不要写入日志或文件。
- 不要把签名后的 `download_url` 长期保存在业务状态。
- 不要共享组织 API Key；撤销后应立即停止使用。
