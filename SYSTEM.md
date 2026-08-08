# kawaii-image 图像生成能力说明

## 系统定位

kawaii-image 是一个面向 B 端与个人客户端的 AI 图像生成开放平台。客户端通过 `/api/v1` 开放 API提交提示词和参考图，系统异步生成单张图片，并返回任务状态和可下载地址。

## 核心能力

- 文生图：根据中文或英文提示词生成单张图片。
- 图生图/参考图生成：上传一张或多张参考图，让生成结果跟随参考内容。
- 单张任务生命周期：`pending -> processing -> completed/failed/cancelled`。
- 任务可重试：`completed`、`failed`、`cancelled` 状态的任务可重新发起。
- 结果可下载：任务完成后返回 `download_url`。

## 模型与参数

- 模型必须从 `GET /api/v1/models` 或 `GET /api/v1/capabilities` 返回的列表中选择，使用平台返回的 `id`。
- 每个模型有各自的宽高比、尺寸、积分成本和参考图数量上限。
- 创建任务时可按需传入 `aspectRatio` 或 `imageSize`；不支持的取值会被服务端拒绝。
- 参考图通过 `POST /api/v1/uploads` 上传，创建任务时 `refs` 传上传返回的引用值。
- 平台会按组织积分扣除生成成本；积分不足时返回 `402`，并给出续费地址。
- 组织可关闭开放 API；普通用户权限关闭后，普通用户创建的存量 Key 会立即失效。
- 每个用户最多 5 个有效 Key。

## 交互约定

- 所有响应统一为 `{ code, message, data }`，`code = 0` 表示成功。
- 客户端通过 `GET /api/v1/tasks/:uuid/stream` 订阅任务状态；断线后可用 `GET /api/v1/tasks/:uuid` 单次重查。
- `download_url` 仅用于下载，不要长期保存。
- 用户可见文案不应出现 Gemini、Seedream 等底层模型/服务真实名称。

## 典型工作流

1. 调用 `GET /api/v1/capabilities` 获取可用模型和配额。
2. 如需参考图，先调用 `POST /api/v1/uploads` 上传。
3. 调用 `POST /api/v1/tasks` 创建任务。
4. 通过 SSE 接收 `snapshot` / `task.update` / `terminal`；断线后单次重查 `GET /api/v1/tasks/:uuid`。
5. 完成时使用 `download_url` 下载结果；失败时读取 `error_message` 后决定是否重试。
