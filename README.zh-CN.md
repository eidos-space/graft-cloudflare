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

1. 在密码管理器中生成随机访问密钥，或在本地仓库运行 `pnpm token`。
   至少使用 32 个字符；`pnpm token` 会生成包含 256 位随机性的密钥。
2. 点击**部署到 Cloudflare**，连接账户，选择 Worker 和仓库名称。
3. 将密钥填入 **GRAFT_REMOTE_TOKEN** Secret，并保存在密码管理器中；各台设备使用同一密钥。
4. 开始部署。Cloudflare 根据 `wrangler.jsonc` 创建 R2 存储桶和 SQLite Durable Objects，
   无需手动填写账户资源 ID，也不要求自定义域名。
5. 复制部署得到的 HTTPS `workers.dev` 地址，打开 `/healthz` 检查服务。
   管理接口和仓库地址使用同一来源地址。

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
pnpm exec wrangler secret put GRAFT_REMOTE_TOKEN
pnpm deploy
```

Wrangler 会在首次部署时自动创建 R2 绑定。后续升级应保留同一个 Worker 和资源关联。
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

当前已发布的 Eidos Lite 云同步入口仍限制为官方服务。本仓库不会为 Lite 增加自托管设置页。
连接加密仓库需要支持 encrypted remote 的 Graft 集成；明文 CLI 测试不能证明 Lite 加密客户端兼容性。

## 存储、额度和运维

仓库元数据、加密身份、引用和对象发布状态保存在 SQLite Durable Objects 中，
不可变数据保存在私有 R2 存储桶中。Workers、SQLite Durable Objects 和 R2
各自有额度与限制。支持免费计划不等于保证零费用或无限存储；请求 CPU 和上传限制同样适用。

- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [R2 定价](https://developers.cloudflare.com/r2/pricing/)
- [运维与备份边界](docs/OPERATIONS.md)
- [管理 API](docs/API.zh-CN.md)

服务不调用官方账户接口，不检查订阅，不提供按用户配额、自动垃圾回收、仓库删除 API
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

`pnpm smoke:sdk` 还会验证加密初始化、两个独立设备会话，以及 SQLite 和附件回传。
将 `GRAFT_SDK_PATH` 设为支持 E2EE 的 Graft Node SDK 包路径；使用独立原生构建时，
另设 `GRAFT_SDK_NATIVE_PATH`。服务端本身不需要安装该 SDK 或原生构建。

## 许可证

MIT。协议、Hono 和 Cloudflare 存储适配器来自已发布的
[`@eidos.space/graft-remote` 包](https://github.com/eidos-space/graft)。
