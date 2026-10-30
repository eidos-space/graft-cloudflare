# 验证记录

[English](VALIDATION.md)

2026-10-30 完成本地验证。本地运行时测试和部署 dry-run 不能证明 Cloudflare
控制台部署成功，也不能证明特定工作负载能始终运行在免费额度内。

## 已完成

- `pnpm install`：独立安装公开发布的依赖，不使用 workspace 链接。
- `pnpm check`：Wrangler 绑定类型与配置一致，严格 TypeScript 检查通过。
- `pnpm test`：36 项 Workers 运行时集成测试通过，包括一次性配置、并发领取和 Secret 恢复。
- `pnpm dry-run`：生成可部署 bundle；
  包含 R2 和两个 SQLite Durable Object 绑定。
- `pnpm smoke`：本地 Wrangler 领取生成的密钥后，加密仓库创建、描述符、普通仓库条件写入及 Range 读取通过。
- 首次配置改动之前，`pnpm smoke:sdk` 已通过：真实原生 SDK 完成加密初始化、首次上传后的独立下载验证、
  错误密码拒绝、第二设备克隆解锁，以及 SQLite 和附件改动回传第一设备。

集成测试还覆盖 HTTPS/loopback 限制、共享密钥鉴权及缺失/弱密钥拒绝、显式建库、
UUID 持久化、并发建库与中断恢复、加密 profile 不可转换、仓库隔离、CAS 竞争、
Range、DO 驱逐重启、加密引用和 6 MiB 加密分片断点恢复及原子发布。

原生验证使用 Graft SDK 0.3.35 的 `e2ee` 功能构建，源码版本
`bcd0cd6c23e0611f20a16b040a8bf00afa029731`，服务端使用已发布的 Remote 0.2.5 包。
这证明该本地 SDK/服务端组合可用，不能作为所有已发布 Lite 或移动客户端的兼容证明。
本机旧 addon 缺少所需 SDK 接口，未将它作为通过的兼容证据。

Wrangler 4.155.0 和当前测试插件内置运行时支持到 2026-10-23，因此配置固定并验证了
这个兼容日期。上游 Graft npm 包有源码 sourcemap 缺失提示，不影响测试通过。

## 尚待 Cloudflare 控制台验收

1. 在已开通 R2 的账户中实际点击公开部署按钮。
2. 确认无需预先生成密钥，创建私有账户存储桶和两个 SQLite DO 绑定，不依赖官方 Eidos 账户；
   完成 `/setup`，验证密钥仅显示一次、恢复流程及重新部署。
3. 对部署后的地址执行加密上传、克隆解锁及回传验证。
4. 更新同一个 Worker 后确认 UUID 和数据保留。
5. 测量实际请求 CPU 和存储用量，再判断具体使用场景的免费额度容量。

上述本地检查没有部署任何 Cloudflare 资源。已发布 Lite UI 尚无自托管连接入口。
本版暂不提供协调式服务端备份恢复、仓库删除 API 或自动 GC。
