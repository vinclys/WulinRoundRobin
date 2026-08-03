# Wulin Tournament Control · Supabase + Vercel v7

武林年度赛实时云端管理系统。前端部署在 Vercel，唯一共享比赛状态保存在 Supabase，并通过 Realtime 同步到工作人员后台、TV 1、TV 2 和参赛者设备。

## 页面入口

```text
?view=operations  TV 1 · Courts & On Deck
?view=results     TV 2 · Standings & Playoff Bracket
?view=schedule    Full Schedule
?view=admin       Staff Admin
```

## v7 重点更新

- 双 Pool 前二出线时，首轮固定交叉：Pool A #1 vs Pool B #2；Pool A #2 vs Pool B #1。
- Standing 同分顺序：win points → head-to-head → point differential → points for。
- TV 2 用图形化 Playoff bracket 显示晋级路线、Final 和 Third Place。
- Staff Admin 的 Playoff 设置显示每个 Pool 的完整排名与预计首轮对阵。
- Admin 改成英文优先，保留少量中文武林元素。
- 人工加入 On Deck 后，可选择预计 Court。
- 每个 Court 可限制 Active Category，并进一步限制 Pool。
- 自动 On Deck 按 Court 的 Category + Pool route 选下一场。
- 人工 On Deck 即使队伍仍在当前比赛，也会继续显示为下一场。
- TV 1 针对 iPad 横屏 AirPlay 优化，一屏显示 Next 3–6 与 6 个 Live Courts。

## Preview images

```text
docs/previews/tv1-ipad-1024x768.png
docs/previews/tv2-results-bracket.png
docs/previews/admin-court-pool-routes.png
docs/previews/admin-full-standings-playoff.png
```

## 现有部署升级

请先阅读：

```text
UPDATE_EXISTING_DEPLOYMENT_ZH.md
```

现有 Supabase 不需要重建，也不要重新运行完整 `schema.sql`。v7 新字段保存在现有 `tournaments.state` JSONB 中。

## 全新部署

请阅读：

```text
DEPLOY_ZH.md
```

全新 Supabase Project 才运行：

```text
supabase/schema.sql
```

## 安全结构

- 浏览器只包含 Supabase publishable key；RLS 只允许读取公开赛事。
- 后台写入统一经过 Vercel `/api/state`。
- Supabase secret key 只存在 Vercel Server 环境变量。
- 工作人员 PIN 存在 Vercel `ADMIN_PIN`。
- 登录成功后使用签名 HttpOnly Cookie。
- 数据库版本号提供 optimistic locking，避免两台后台静默覆盖。
- `tournament_state_history` 保留最近 250 个完整状态快照。

## 本地验证

```bash
npm install
npm test
npm run build
```

项目不包含真实 Supabase key、后台 PIN 或 Session secret。
