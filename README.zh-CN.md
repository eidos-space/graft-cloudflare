# Cloudflare 个人 Graft 同步服务

[English](README.md)

在你自己的 Cloudflare 账户中运行 Graft Remote v1。每个部署由一个人管理，
多个仓库和设备共用一个访问密钥，无需 Eidos 账户或官方同步订阅。

[![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/eidos-space/graft-cloudflare)

本模板已完成的检查和待执行的 Cloudflare 控制台部署验收步骤见
[验证记录](docs/VALIDATION.zh-CN.md)。

## 部署

你需要启用 Workers 和 R2 的 Cloudflare 账户，以及接收 Cloudflare 创建的仓库副本的
GitHub 或 GitLab 账户。R2 需要单独开通并完成计费设置，即使用量在免费额度内也是如此。

1. 点击**部署到 Cloudflare**，连接账户，选择 Worker 和仓库名称。Cloudflare 会在
   按钮流程中自动创建 Git 仓库副本，无需手动 fork 或 clone。
2. 开始部署。Cloudflare 根据 `wrangler.jsonc` 创建 R2 存储桶和 SQLite Durable Objects，
   无需手动填写账户资源 ID，也不要求自定义域名。
3. 部署完成后立即打开 HTTPS `workers.dev` 地址下的 `/setup`，生成访问密钥并保存在
   密码管理器中。密钥仅显示一次，各台设备使用同一密钥。首次配置完成前，任何知道
   公网地址的人都可能抢先领取；如果发现服务已被配置，请参见[访问恢复](docs/OPERATIONS.zh-CN.md#访问与密钥轮换)。
4. 打开 `/healthz` 检查服务。
   返回 `200` 和 `"status":"ok"` 表示访问已配置且目录 Durable Object 有响应；
   这**不代表** R2 或仓库 Durable Object 已验证可用。管理接口和仓库地址使用同一来源地址。

密钥可以访问**该部署中的所有仓库**。这是个人服务，不提供用户注册或多租户共享功能。

部署机制参见 Cloudflare 的
[Deploy to Cloudflare buttons 文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。

## 本地开发与命令行部署

使用 Node.js 22 或更新版本，以及 `package.json` 声明的 pnpm 版本。

```sh
git clone https://github.com/eidos-space/graft-cloudflare.git
cd graft-cloudflare
pnpm install --frozen-lockfile
pnpm setup:local
```

`setup:local` 创建仅当前用户可读写的 `.dev.vars`，写入随机开发密钥；
如果文件已存在则保留原内容。然后运行：

```sh
pnpm dev
```

本地 Wrangler 开发使用本地 R2 和 Durable Object 存储。`.dev.vars` 被 Git 忽略，
部署时不会自动上传其中的密钥。

部署到自己的 Cloudflare 账户：

```sh
pnpm exec wrangler login
pnpm deploy
```

部署完成后按上述步骤打开 `/setup`。Wrangler 会在首次部署时自动创建 R2 绑定。后续升级应保留同一个 Worker 和资源关联。
更换 Worker 名称可能创建独立服务，不会迁移已有数据。

## 创建与查找仓库

将 `GRAFT_ORIGIN` 设为部署后的 HTTPS 来源地址，并通过密码管理器或 shell 环境加载
`GRAFT_REMOTE_TOKEN`。不要把访问密钥写进远端 URL。

```sh
export GRAFT_ORIGIN='https://your-worker.your-subdomain.workers.dev'
```

创建端到端加密仓库：

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $GRAFT_REMOTE_TOKEN" \
  --header 'Content-Type: application/json' \
  --request PUT \
  --data '{"display_name":"个人笔记"}' \
  "$GRAFT_ORIGIN/api/graft/repositories/notes"
```

省略 `encryption` 时默认使用 `encrypted-remote-v1`。服务在创建时固定仓库加密类型和
UUID；重复创建请求不会重置仓库身份，也不会降低加密级别。

列出仓库：

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $GRAFT_REMOTE_TOKEN" \
  "$GRAFT_ORIGIN/api/graft/repositories"
```

成功列出仓库还会检查密钥，但不会检查 R2。创建仓库会测试
初始化；下面的冒烟检查还会写入和读取对象数据。不要仅凭 `/healthz` 判断部署完全可用。

如果 `/healthz` 返回 `503`，请完成 `/setup` 或检查用于恢复的 Secret。如果列出仓库返回 `401`，
检查客户端使用的密钥是否相同。构建或资源创建失败时，请检查 Cloudflare 构建／部署日志，
并确认已开通 R2。不要在日志或求助内容中包含密钥。如果健康检查通过但存储操作失败，
请检查 Worker 日志以及 `OBJECTS`、`DIRECTORY` 和 `REPOSITORIES` 绑定。

仓库 URL 形如 `https://your-host/personal/notes`。固定的 `personal` 是路径布局，
不是租户标识。必须先创建仓库才能访问协议接口；未知仓库不会被自动创建为明文仓库。

访问密钥与加密密码相互独立。密钥负责服务访问授权，加密和密码处理由客户端完成。
服务端不接收、也无法找回加密密码。

## 使用 Graft CLI 连接明文仓库

只有明确接受 Cloudflare 存储管理员可以读取仓库内容时，才使用明文类型：

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $GRAFT_REMOTE_TOKEN" \
  --header 'Content-Type: application/json' \
  --request PUT \
  --data '{"encryption":"plain","display_name":"CLI 示例"}' \
  "$GRAFT_ORIGIN/api/graft/repositories/cli-example"
```

在已有本地 Graft 仓库中添加一个新的远端名称：

```sh
graft remote add selfhost "$GRAFT_ORIGIN/personal/cli-example"
graft push selfhost main
```

下载到新的目录：

```sh
mkdir downloaded-copy
cd downloaded-copy
graft clone "$GRAFT_ORIGIN/personal/cli-example" main
```

如果分支名不是 `main`，请替换为实际分支名。Graft 下载到当前目录，
第二个参数是分支名，不是目标文件夹。

Graft 从 `GRAFT_REMOTE_TOKEN` 环境变量读取密钥。`graft+http://` 仅用于本机回环开发，
部署后的加密仓库要求 HTTPS。

在 Eidos Lite 的**设置 → 账户与服务 → 同步 → 自定义服务器**中添加服务器地址和访问密钥。
Lite 的自托管同步需要 Spark 功能；服务器本身不使用 Eidos 账户或订阅。
同步密码单独用于加密和解锁 Space。明文 CLI 测试不能证明加密客户端兼容性。

## 存储、额度和运维

仓库元数据、加密身份、引用和对象发布状态保存在 SQLite Durable Objects 中，
不可变数据保存在私有 R2 存储桶中。Workers、SQLite Durable Objects 和 R2
各自有额度与限制。支持免费计划不等于保证零费用或无限存储；请求 CPU 和上传限制同样适用。

- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [R2 定价](https://developers.cloudflare.com/r2/pricing/)
- [运维与备份边界](docs/OPERATIONS.md)
- [管理 API](docs/API.zh-CN.md)

服务不调用官方账户接口，不检查订阅，不提供按用户配额、活跃仓库自动垃圾回收
或内置的一致性备份/导出命令。所有仓库共用该 Cloudflare 账户的资源。

## 验证改动

```sh
pnpm check
pnpm test
pnpm dry-run
```

这些命令不会部署，也不需要 Cloudflare 凭据。它们检查生成的绑定类型、TypeScript、
本地 Workers 运行时行为及 Worker 打包。原生客户端和实际部署验证单独记录在
[验证记录](docs/VALIDATION.zh-CN.md)。

运行 `pnpm dev` 后，`pnpm smoke` 会读取本地 `.dev.vars`，创建少量冒烟仓库并检查服务。
验证自己的部署时，请显式设置 `GRAFT_SMOKE_ORIGIN` 和 `GRAFT_REMOTE_TOKEN`。
每次运行会创建两个仓库，其中一个是明文仓库；脚本不会自动删除它们。
可以对这些测试名称调用管理 DELETE 接口清理。
如果不希望测试记录和对象留在个人服务中，请使用临时部署。

`pnpm smoke:sdk` 还会验证加密初始化、两个独立设备会话，以及 SQLite 和附件回传。
将 `GRAFT_SDK_PATH` 设为支持 E2EE 的 Graft Node SDK 包路径；使用独立原生构建时，
另设 `GRAFT_SDK_NATIVE_PATH`。服务端本身不需要安装该 SDK 或原生构建。
每次 SDK 冒烟测试也会永久创建一个加密仓库。

## 许可证

MIT。协议、Hono 和 Cloudflare 存储适配器来自已发布的
[`@eidos.space/graft-remote` 包](https://github.com/eidos-space/graft)。
