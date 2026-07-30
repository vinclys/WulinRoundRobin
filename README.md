# Wulin Tournament Control · Supabase + Vercel v6

正式云端版本，包含双电视 Dashboard、Active Cats、六场地横向中控、Round Robin/Playoff、实时同步和安全后台。

## 入口

```text
?view=operations  TV 1：Courts & On Deck
?view=results     TV 2：Standings & Playoff
?view=schedule    Full Schedule
?view=admin       Staff Admin
```

## 已经部署过旧云端版

请先阅读：

```text
UPDATE_EXISTING_DEPLOYMENT_ZH.md
```

升级现有项目不需要重建 Supabase；直接更新同一 Git repository 即可。

## 全新部署

请阅读：

```text
DEPLOY_ZH.md
```

然后在新 Supabase project 运行：

```text
supabase/schema.sql
```

## 核心安全结构

- 浏览器：Supabase publishable key，只读公开 event；
- 后台写入：Vercel `/api/state`；
- 服务器：Supabase secret key；
- 工作人员 PIN：Vercel `ADMIN_PIN`；
- Session：签名 HttpOnly Cookie；
- 多设备写入：optimistic version lock；
- 历史：最近 250 个 state snapshots。
