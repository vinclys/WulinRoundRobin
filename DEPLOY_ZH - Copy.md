# 武林年度赛 Cloud v7：全新 Supabase + Vercel 部署

> 已经有 `wulin-round-robin.vercel.app` 的项目，请使用 `UPDATE_EXISTING_DEPLOYMENT_ZH.md`，不要重新建立 Supabase。

---

# 1. 正式架构

```text
TV 1 / TV 2 / 参赛者手机
          │
          ├── Supabase public read + Realtime
          │
Staff Admin
          │
          └── Vercel /api/state
                  ├── 验证工作人员 Session
                  ├── 使用服务器端 Supabase secret key
                  └── 原子保存 state + version lock
```

Supabase 是唯一共享数据源。浏览器 localStorage 只保留最近云端缓存、离线待同步修改和冲突保护副本。

---

# 2. 创建 Supabase Project

1. 登录 Supabase Dashboard。
2. `New Project`。
3. Project name：

```text
wulin-tournament-2026
```

4. 选择距离比赛地点较近的 Region。
5. 使用密码管理器保存 Database Password。
6. 等项目初始化完成。

## 2.1 建立数据库

Supabase → SQL Editor → New query：

1. 打开本项目 `supabase/schema.sql`。
2. 复制全部 SQL。
3. 粘贴并点击 Run。

SQL 会建立：

- `public.tournaments`
- `public.tournament_state_history`
- RLS public read policy
- `save_tournament_state(...)` atomic RPC
- Realtime publication
- 初始 event `wulin-annual-2026`
- 6 个 Courts
- v7 空 state

## 2.2 检查数据库

运行：

```text
supabase/verify.sql
```

确认：

- `wulin-annual-2026` 存在；
- row version 是 1；
- app state version 是 7；
- RLS policy 存在；
- `tournaments` 已加入 `supabase_realtime`；
- history 有 `schema-seed`。

---

# 3. 获取 Supabase API 配置

Supabase → Project Settings → API Keys，复制：

1. Project URL
2. Publishable key
3. Secret key

规则：

```text
Publishable key → 可以进入前端，但依赖 RLS
Secret key      → 只放 Vercel Server，不得进入浏览器
```

不要把 secret key 放进任何 `VITE_` 环境变量。

---

# 4. 建立 GitHub Repository

1. 解压 `wulin-supabase-vercel-v7.zip`。
2. GitHub 新建 repository，例如：

```text
WulinRoundRobin
```

3. 在解压后的项目目录运行：

```bash
git init
git add .
git commit -m "Initial Wulin Tournament Control v7"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

确认 GitHub 没有：

```text
.env
.env.local
真实 SUPABASE_SECRET_KEY
真实 SESSION_SECRET
```

---

# 5. 在 Vercel 导入 GitHub Project

1. 登录 Vercel。
2. `Add New → Project`。
3. Import 刚才的 GitHub repository。
4. Framework Preset：

```text
Vite
```

5. Build Command：

```text
npm run build
```

6. Output Directory：

```text
dist
```

---

# 6. 添加 Vercel Environment Variables

Vercel Project → Settings → Environment Variables：

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `VITE_EVENT_SLUG` | `wulin-annual-2026` |
| `SUPABASE_URL` | 同一个 Supabase Project URL |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` |
| `EVENT_SLUG` | `wulin-annual-2026` |
| `ADMIN_PIN` | 工作人员 PIN，例如 `5678` |
| `SESSION_SECRET` | 至少 32 字符的随机值 |

生成 Session secret：

```bash
openssl rand -base64 48
```

三个 slug 必须完全一致：

```text
VITE_EVENT_SLUG
EVENT_SLUG
public.tournaments.slug
```

旧 Supabase Project 也可使用 `SUPABASE_SERVICE_ROLE_KEY` 替代 `SUPABASE_SECRET_KEY`，但不能同时把高权限 key 暴露到前端。

---

# 7. 部署

环境变量保存后：

1. Vercel → Deployments。
2. 对最新 deployment 选择 Redeploy；或 push 新 commit。
3. 等状态变成 `Ready`。

检查：

```text
https://YOUR_DOMAIN/api/health
```

正常类似：

```json
{
  "ok": true,
  "service": "wulin-tournament-control",
  "database": "connected",
  "eventSlug": "wulin-annual-2026",
  "version": 1
}
```

---

# 8. 第一次建立比赛数据

入口：

```text
https://YOUR_DOMAIN/?view=admin
```

1. 输入 `ADMIN_PIN`。
2. 新建 6 个 Categories。
3. 输入每个 Category 的 Pool 和队伍。
4. 自动生成 Round Robin。
5. 选择当前上午或下午 Active Categories。
6. 在 6-Court Control 为每个 Court 设置 Category + Pool routes。
7. 设置 TV 1 On Deck 数量为 3–6。
8. 设置 TV 2 需要公布的 Categories。

建议输入完成后立即：

```text
EXPORT BACKUP JSON
```

---

# 9. 正式页面

```text
TV 1 · Courts & On Deck
https://YOUR_DOMAIN/?view=operations

TV 2 · Standings & Playoff
https://YOUR_DOMAIN/?view=results

Full Schedule
https://YOUR_DOMAIN/?view=schedule

Staff Admin
https://YOUR_DOMAIN/?view=admin
```

TV 1 针对 iPad 横屏 AirPlay 优化。建议浏览器横屏、隐藏地址栏后再投屏。

---

# 10. Realtime 多设备测试

设备 A 打开 Staff Admin，设备 B 打开 TV 1 或 TV 2。

在 A：

- 修改 Court route；
- 加入 On Deck；
- 指定 Expected Court；
- 安排比赛；
- 输入比分。

B 应无需刷新就更新：

- Live Courts；
- On Deck；
- Standings；
- Playoff bracket；
- Medal positions。

---

# 11. Playoff 规则检查

双 Pool、每 Pool 前二出线时应生成：

```text
Pool A #1 vs Pool B #2
Pool A #2 vs Pool B #1
```

Standing 同分顺序：

```text
win points
→ direct head-to-head / H2H mini-table
→ point differential
→ points for
```

Admin 的 `QUALIFIER CHECK` 会显示所有队伍完整排名与预计首轮对阵，确认后再点击 `GENERATE PLAYOFF`。

---

# 12. 备份与恢复

比赛前、上午结束、下午开始、Playoff 前与比赛结束后都建议导出 JSON。

Supabase 会保留最近 250 个完整 state snapshots。

紧急恢复模板：

```text
supabase/restore-example.sql
```

使用前把 `TARGET_VERSION` 替换成实际 history version，并先导出当前 JSON。

---

# 13. 安全提醒

- 不要公开 Staff PIN。
- 正式比赛可把 4 位 PIN 改成更长值。
- 修改 `ADMIN_PIN` 或其他 Vercel variables 后必须重新部署。
- Secret key 绝对不能出现在 GitHub、浏览器 bundle 或 `VITE_` variables。
- Public screen 只读；所有写入必须经过 Vercel API。
