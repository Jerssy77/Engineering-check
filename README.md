# 物业工程立项 AI 审核系统

这是一个面向物业工程立项场景的内部原型系统，覆盖：

- 城市公司标准化填报
- AI 预审与一页结论
- 退回修改与版本留痕
- 区域/总部人工终审
- AI 额度、冷却期与特批治理

## 仓库结构

- `apps/web`: Next.js 前端
- `apps/api`: NestJS 后端
- `packages/shared`: 前后端共享类型、限流逻辑和表单模型
- `prisma/schema.prisma`: 数据模型草案

## 当前实现

- 已实现标准化立项表单、技术方案模板、统一费用测算矩阵、固定材料槽位和重复改造识别。
- 已实现 AI 审核结构化输出：合规、成本、技术、重复改造四大板块。
- 默认使用规则引擎版 `demo` 审核。
- 已支持接入真实大模型 API；配置环境变量后，后端会改为调用外部模型。
- 已支持用 `Tailscale` 让其他电脑通过浏览器访问这台电脑上的系统。

## 安装与本地开发

1. 在仓库根目录执行 `npm install`
2. 复制 `.env.example` 为 `.env`
3. 执行 `npm run prisma:generate`
4. 执行 `npm run dev:api`
5. 新开终端执行 `npm run dev:web`

## 真实 AI 接入

后端会自动读取仓库根目录的 `.env`。默认配置如下：

```env
AI_PROVIDER="demo"
AI_API_BASE_URL="https://api.openai.com/v1"
AI_API_PATH="/chat/completions"
AI_API_KEY=""
AI_MODEL_NAME="gpt-4.1-mini"
AI_API_TIMEOUT_MS="60000"
AI_ALLOW_DEMO_FALLBACK="false"
```

如果要改成真实模型：

1. 把 `AI_PROVIDER` 改成 `openai_compatible`
2. 填入 `AI_API_KEY`
3. 按你的模型服务修改 `AI_API_BASE_URL`、`AI_API_PATH`、`AI_MODEL_NAME`
4. 重启 `npm run dev:api` 或 `npm run start:api`

说明：

- 当前接入方式采用 OpenAI 兼容接口协议。
- 默认调用路径是 `/chat/completions`。
- 如果你用的是兼容 OpenAI 协议的模型网关，也可以直接替换 `AI_API_BASE_URL` 和 `AI_MODEL_NAME`。
- 如果开启 `AI_ALLOW_DEMO_FALLBACK="true"`，当真实模型调用失败时会自动回退到 demo 审核，并在报告里写明已回退。

## 多人共享填报

推荐做法：使用 `Tailscale`，由这台电脑充当临时服务器，不直接暴露公网。

### 1. 配置监听地址

`.env.example` 已包含以下参数：

```env
WEB_HOST="0.0.0.0"
WEB_PORT="3000"
API_HOST="0.0.0.0"
API_PORT="3001"
NEXT_PUBLIC_API_BASE_URL="http://100.x.x.x:3001"
```

说明：

- 前端和后端都会监听 `0.0.0.0`，不再只绑定本机回环地址。
- 浏览器端已内置兜底逻辑：如果 `NEXT_PUBLIC_API_BASE_URL` 还是 `localhost:3001`，但用户是通过你的服务器地址访问前端，系统会自动把 API 请求改到当前主机的 `3001` 端口。
- 最稳妥的做法仍然是把 `NEXT_PUBLIC_API_BASE_URL` 改成这台电脑的 `Tailscale IPv4` 地址。

### 2. 获取可分享地址

这台电脑安装并登录 Tailscale 后，可运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\show-tailscale-access.ps1
```

脚本会输出：

- 前端访问地址：`http://<Tailscale IP>:3000`
- 后端访问地址：`http://<Tailscale IP>:3001`

### 3. 生产方式启动

不要长期用 `dev` 模式给别人访问。建议：

1. 先执行 `npm run build`
2. 开两个终端分别执行：

```powershell
npm run start:api
npm run start:web
```

### 4. 其他填报人如何访问

- 每个填报人电脑安装并登录同一个 `Tailscale tailnet`
- 浏览器直接打开：`http://<你的 Tailscale IP>:3000`
- 不需要本地部署项目，也不需要数据库、Redis 或 AI Key

### 5. Windows 防火墙

如别人通过 Tailscale 地址仍无法访问，请检查本机防火墙是否放行 `3000`、`3001` 端口，至少要允许 Tailscale/专用网络访问。

## 演示账号

- `shanghai.pm / demo123`
- `east.reviewer / demo123`
- `admin / demo123`

## 当前限制

- 当前仓库已支持本地文件持久化过渡方案，但默认仍是单机落盘，不是多机共享数据库。
- AI 审核虽然可以接真实模型，但附件解析和队列调度仍是原型级实现。
- 这套方式适合内部试用和短期试运行；若要长期多人使用，建议迁移到正式服务器并加上 HTTPS、数据库持久化和对象存储。

## 试运行数据持久化

如果你计划先试运行一个月、之后再迁移到公司服务器，当前仓库已经支持“本地文件持久化”过渡方案：

- 结构化数据默认写入 `runtime-data/app-state.json`
- 新上传的附件文件默认写入 `runtime-data/uploads/`
- 这两个目录都不会提交到 Git 仓库

### 1. 切换前抓取当前在线数据

如果旧 API 还在运行，可先执行：

```powershell
npm run data:capture-live
```

默认会从 `http://127.0.0.1:3001` 抓取当前在线数据，并写入：

```text
runtime-data/app-state.json
```

可通过环境变量覆盖：

- `LIVE_API_BASE_URL`
- `LIVE_ADMIN_USERNAME`
- `LIVE_ADMIN_PASSWORD`

### 2. 重启 API 后自动改为落盘

API 重启后，会优先读取 `APP_DATA_FILE` 指向的数据文件；如果该文件不存在，才会回退到默认演示种子数据。

`.env.example` 已新增：

```env
APP_DATA_FILE="./runtime-data/app-state.json"
APP_UPLOAD_DIR="./runtime-data/uploads"
```

### 3. 迁移到公司服务器时带走什么

如果下个月迁移到公司服务器，至少要复制这两个目录/文件：

- `runtime-data/app-state.json`
- `runtime-data/uploads/`

这样可以把试运行期间保存下来的结构化数据和切换后新增的附件一起带走。

### 4. 当前过渡方案的边界

- 这是“一个月试运行”的过渡方案，不是最终企业级长期架构
- 切换到该方案之后，后续新增和修改的数据会持续落盘
- 在切换前的历史附件，由于旧版本只保存了附件元数据，没有保存文件本体，因此只能保留记录，无法补回原始文件

## GitHub + Render 演示部署

推荐把代码放在私有 GitHub 仓库，再用 Render 托管成两个 Web Service：

- `property-review-api`
- `property-review-web`

仓库里已经提供了根目录的 `render.yaml`，默认面向“内部演示版”场景：

- 继续使用 demo 内存数据，不依赖 Postgres、Redis、MinIO
- API 服务监听 Render 分配端口并提供 `/health` 健康检查
- Web 服务从根目录构建，不把 monorepo 截断到 `apps/web`
- 两个服务都带了 build filter，只有相关目录变更时才自动重建

### 1. 推送到 GitHub

建议使用私有仓库，避免把演示账号、业务原型和后续配置暴露到公网。

初始化仓库后可参考：

```powershell
git init -b main
git add .
git commit -m "Prepare Render deployment"
```

说明：

- `.env`、`node_modules`、`.next`、`dist`、`uploads` 已被忽略，不会提交
- `package-lock.json` 需要提交，Render 会使用 `npm ci` 进行稳定安装

### 2. 在 Render 创建 Blueprint

1. 登录 Render
2. 选择 `New +` -> `Blueprint`
3. 连接你的 GitHub 私有仓库
4. 让 Render 读取仓库根目录的 `render.yaml`

默认构建/启动方式如下：

- API：
  - Build Command：`npm ci && npm run build`
  - Start Command：`npm run start:api`
- Web：
  - Build Command：`npm ci && npm run build`
  - Start Command：`npm run start:web`

### 3. Render 环境变量

`render.yaml` 已内置以下演示环境变量：

- API：
  - `API_HOST=0.0.0.0`
  - `AI_PROVIDER=demo`
  - `APP_TIMEZONE=Asia/Shanghai`
- Web：
  - `WEB_HOST=0.0.0.0`

还需要你在 Render 控制台为 Web 服务补充：

- `NEXT_PUBLIC_API_BASE_URL=https://<你的 API 服务域名>.onrender.com`

建议先创建 API 服务，等 Render 分配出实际公网地址后，再把这个值填到 Web 服务里并重新部署一次。

### 4. 为什么不设置 rootDir

这个仓库是 monorepo：

- `apps/web`
- `apps/api`
- `packages/shared`

如果把 Render 的 `rootDir` 直接设成 `apps/web` 或 `apps/api`，构建时会看不到根目录的 workspace 配置和 `packages/shared`，导致安装或编译失败。因此这里统一从仓库根目录构建。

### 5. 部署后验证

1. 打开 Render 分配给 `property-review-web` 的网址
2. 使用演示账号登录
3. 检查项目列表、详情、报告页和附件上传
4. 打开 `https://<你的 API 服务域名>.onrender.com/health`，确认返回健康状态

### 6. 演示版注意事项

- Render 免费实例空闲一段时间后会休眠，首次访问会有冷启动延迟
- 当前数据仍然是内存态，重新部署或服务重启后会恢复为演示种子数据
- 如果以后要公开仓库或长期多人使用，先移除演示账号信息并补齐真实认证、数据库持久化和对象存储
