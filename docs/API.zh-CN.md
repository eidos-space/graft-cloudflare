# 管理 API

[English](API.md)

管理接口与协议接口使用同一个 HTTPS 来源地址。需要认证的请求携带
`Authorization: Bearer <访问密钥>`。不要向这些接口发送加密密码。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/` | 公开服务信息 |
| GET | `/healthz` | 公开配置健康检查，密钥未配置时返回 503 |
| GET, POST | `/setup` | 一次性配置页面及密钥领取 |
| GET | `/.well-known/graft` | 公开服务发现 |
| GET | `/api/graft/repositories` | 列出所有者的仓库 |
| PUT | `/api/graft/repositories/:name` | 显式、幂等地创建仓库 |
| PATCH | `/api/graft/repositories/:name` | 仅修改显示名称 |

后三个接口需要共用密钥。固定的协议命名空间 `personal` 不代表账户或租户。

## 创建仓库

仓库名称是稳定的技术键，长度为一到 64 个 ASCII 字符，首尾必须是字母或数字，
中间可以包含字母、数字、`.`、`_` 和 `-`。显示名称会去除首尾空白并进行 NFC 规范化，
长度为一到 80 个 Unicode 码点，不允许控制字符。

JSON 请求体可以省略：

```json
{
  "display_name": "个人笔记",
  "encryption": "encrypted-remote-v1"
}
```

省略 `encryption` 时默认选择 `encrypted-remote-v1`，创建明文仓库必须显式使用
`"plain"`。新加密仓库拥有持久化 UUID 和固定加密类型，重试返回同一身份。
已有仓库不能通过重复创建请求转换加密类型。

新仓库返回 201，幂等重试返回 200：

```json
{
  "created": true,
  "namespace": "personal",
  "repository": "notes",
  "name": "notes",
  "display_name": "个人笔记",
  "created_at": 1793318400000,
  "encryption": {
    "profile": "encrypted-remote-v1",
    "version": 1,
    "suite": 1,
    "uuid": "c71a2344-4eb4-4d36-a733-68164d1cde40"
  },
  "remote_url": "https://your-host/personal/notes"
}
```

示例中的 UUID 和时间戳仅用于演示。明文仓库的 `encryption` 为 `null`，
`created_at` 是 Unix 纪元以来的毫秒数。显示名称只是标签，不会改变远端 URL 或技术键。

## 列表与重命名

列表返回 `{"namespace":"personal","repositories":[...]}`，每项包含
`name`、`display_name`、`created_at`、`encryption` 和 `remote_url`。

向对应仓库发送 `{"display_name":"新名称"}` PATCH 请求即可改名。
这不会改变 UUID、加密类型、引用或远端 URL。

## 协议

Remote v1 请求以 `/personal/:name` 为根路径，由固定版本的上游 Graft 包处理。
协议访问前必须完成显式仓库创建。未知仓库返回 404，不会自动成为明文仓库。

客户端必须通过持久化 descriptor 建立加密身份，不能假设修改 URL 就完成了已有
加密远端的迁移。管理 API 不接收加密密码或解密后的密钥。

本版本不提供仓库删除或垃圾回收接口。
