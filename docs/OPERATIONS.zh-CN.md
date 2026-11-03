# 运维

[English](OPERATIONS.md)

## 访问与密钥轮换

`/setup` 生成的密钥是部署共用的 bearer 密钥。持有密钥的设备可以读写所有仓库，
也可以创建仓库。服务不提供独立用户、设备授权或按仓库划分的权限。

用密码管理器保存高随机性的密钥。不要将它写入远端 URL、Wrangler `vars`、
提交到 Git 的 shell 命令、Issue 或支持日志。服务只保存生成密钥的 SHA-256 摘要，
密钥仅显示一次；如果页面响应丢失，请使用下面的恢复流程。

恢复访问或轮换密钥时，生成至少 32 个字符的随机密钥，在 Cloudflare 控制台中打开
该 Worker 的 Settings > Variables and Secrets，设置 `GRAFT_REMOTE_TOKEN` Secret 并部署。
也可以在本地仓库使用 Wrangler：

```sh
pnpm token
pnpm exec wrangler secret put GRAFT_REMOTE_TOKEN
```

随后更新所有连接设备。轮换不会修改仓库 UUID、加密对象或客户端加密密码。
已经开始的请求可能完成；密钥轮换不会删除已存储数据。Worker 一旦读取到有效的
控制台 Secret，就会使生成的密钥失效并永久关闭首次配置，即使之后删除 Secret 也不会重开。
无效的 Secret 会阻止访问。原来使用 `GRAFT_REMOTE_TOKEN` 的部署仍可继续使用。

## 升级

保留同一个 Worker 名称、R2 关联和 Durable Object 命名空间。部署前审阅改动，
按已提交的锁文件安装依赖，并运行 `pnpm check`、`pnpm test`、`pnpm dry-run`。
保留已知兼容的 Worker 版本用于回滚。回滚版本仍需理解已存储的仓库类型和元数据结构。

协议与存储包版本应一起固定。Worker 打包成功不能证明某个已发布原生客户端兼容。
请使用实际客户端验证加密仓库创建、上传、下载解锁及后续拉取。

## 备份与恢复

同步远端是另一份可写副本，不是独立备份。请保留经过验证的本地副本和重要数据的独立备份。

完整服务备份需要保留一致的以下数据：

- 仓库目录记录及稳定的内部 ID；
- 访问配置，以及已保存的访问密钥或恢复方法；
- 仓库加密类型和 UUID；
- HEAD/引用的精确字节；
- 不可变 R2 对象，包括仍被保留的加密 staging 对象；
- 已发布对象的可见性映射，以及存储适配器恢复所需的上传状态。

只复制 R2 存储桶不能恢复完整加密仓库。只恢复 Durable Object 元数据也可能引用不存在的对象。
不要按对象年龄或 `encrypted-staging` 前缀删除 R2 对象：已发布的加密数据仍可能使用该前缀下的键。

本版本未提供跨资源一致性导出/恢复命令。Cloudflare 各资源自己的恢复能力，
不能单独证明跨资源备份一致。在验证服务端恢复流程之前，请保留完整本地仓库、
加密凭据与独立备份。依赖备份前，应先向独立部署或空本地目录执行恢复验证。

## 空间回收与删除

失败的条件更新可能留下不可达的不可变对象。本版本没有活跃仓库自动垃圾回收器。
不要根据对象名称或时间戳猜测可达性并回收空间，也不要通过删除元数据或重命名命名空间
来重置仓库；仓库身份和加密状态属于持久化契约。

使用经过认证的仓库 DELETE 接口删除远端副本及历史，本地文件夹不受影响。
在途请求退出及清理重试期间，状态保持 `deleting`；持久化 alarm 会在重启后继续。
清理先中止分片上传、移除仓库元数据，再删除该仓库前缀下的所有对象。
目录中保留少量墓碑记录，禁止复用技术名称和 URL。重复 DELETE 是安全的。
轮询方式与状态码见[管理 API](API.zh-CN.md)。

计划停用服务时，先验证独立本地副本与备份，断开客户端，再按照明确的保留计划
使用 Cloudflare 资源管理工具处理数据。删除 Worker 不代表其 R2 与 Durable Object
数据已经全部删除。

## 资源限制

全部 Durable Objects 都使用 SQLite 存储，因此可使用 Workers 免费计划。
部署还需要开通 R2。各产品分别计算额度、费用并有自己的超额行为。
请关注请求量、CPU 错误、R2 用量和 SQL 存储。一次客户端操作可能产生多次 Worker
和 Durable Object 请求。

大文件可能需要多次协议上传。流式传输控制 Worker 内存用量，但不会绕过 Cloudflare
单次请求体限制。请验证实际客户端和文件大小，不要把存储额度理解为单文件大小上限。

参考资料：

- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [R2 定价](https://developers.cloudflare.com/r2/pricing/)
