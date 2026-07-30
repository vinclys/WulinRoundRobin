# 注意：已有旧云端部署请使用 UPDATE_EXISTING_DEPLOYMENT_ZH.md

本文件主要用于全新 Supabase + Vercel 项目。

# 武林年度赛实时版：Supabase + Vercel 部署手册

## 1. 部署后的结构

```text
观众手机 / 比赛电视 / 义工设备
              │
              ├── 公开读取 + Realtime ──────> Supabase tournaments 表
              │                                 （RLS 只允许公开读取）
              │
              └── 工作人员写入 ─────────────> Vercel /api/state
                                                │
                                                ├── 验证 HttpOnly Session Cookie
                                                ├── 使用服务器端 Supabase secret key
                                                └── 调用原子版本锁 RPC
```

数据的唯一权威来源是 Supabase。浏览器 localStorage 只保存：

1. 最近一次云端状态缓存，网络短暂中断时仍能显示；
2. 尚未同步的本地变更；
3. 多人同时修改发生冲突时的本地保护副本。

它不再是每台设备各自独立的比赛数据库。

---

## 2. 准备账号

需要：

- 一个 Supabase 账号；
- 一个 Vercel 账号；
- 推荐一个 GitHub 账号，用于自动部署和版本管理。

Google Sites 不需要参与正式运行。它可以日后作为活动入口页，链接到 Vercel 地址。

---

## 3. 创建 Supabase 项目

1. 登录 Supabase Dashboard。
2. 新建 Project。
3. Project name 可填：`wulin-tournament-2026`。
4. Database password 请使用密码管理器生成并保存；此密码不等于工作人员后台 PIN。
5. Region 选择距离比赛地点和主要观众最近的区域。
6. 等待项目初始化完成。

### 3.1 建立数据库、RLS 和 Realtime

1. 在 Supabase 左侧打开 **SQL Editor**。
2. 新建 Query。
3. 打开本项目的 `supabase/schema.sql`。
4. 复制全部 SQL，粘贴到 SQL Editor。
5. 点击 **Run**。
6. 确认没有错误。

这段 SQL 会建立：

- `public.tournaments`：当前共享比赛状态；
- `public.tournament_state_history`：最近 250 个状态版本；
- `save_tournament_state(...)`：原子保存和版本冲突检查；
- RLS：匿名用户只能读 `is_public=true` 的比赛；
- Realtime publication：让前端收到状态更新；
- 初始 event slug：`wulin-annual-2026`。

### 3.2 检查 SQL 是否正确

在 SQL Editor 运行 `supabase/verify.sql`。

正常结果应包括：

- `tournaments` 有一行 `wulin-annual-2026`；
- `version` 初始为 `1`；
- 存在 `Public tournaments are readable` policy；
- `supabase_realtime` publication 包含 `public.tournaments`；
- history 至少有一个 `schema-seed` 版本。

### 3.3 取得 Supabase URL 和 Keys

在 Supabase Dashboard 打开 **Settings → API Keys**，或使用项目的 **Connect** 对话框。

需要复制三项：

1. **Project URL**，形如：`https://xxxxx.supabase.co`
2. **Publishable key**，形如：`sb_publishable_...`
3. **Secret key**，形如：`sb_secret_...`

规则：

- Publishable key 会进入前端，是公开值，但必须配合 RLS。
- Secret key 权限很高，只能放在 Vercel Server 环境变量。
- 任何名为 `VITE_...` 的变量都会进入浏览器 bundle；因此绝对不要把 secret key 放进 `VITE_` 变量。
- 旧 Supabase 项目也可临时使用 `anon` 和 `service_role`，但新项目优先使用 publishable / secret keys。

---

## 4. 准备项目代码

### 方式 A：推荐，使用 GitHub

1. 解压 `wulin-supabase-vercel.zip`。
2. 在 GitHub 新建一个 private repository，例如：`wulin-tournament-live`。
3. 在电脑终端进入解压后的目录。
4. 执行：

```bash
git init
git add .
git commit -m "Initial Wulin Supabase tournament app"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

检查 GitHub 仓库中没有 `.env`、真实 secret key 或 Session secret。

### 方式 B：不使用 GitHub，直接用 Vercel CLI

```bash
npm install
npx vercel login
npx vercel
```

首次回答项目设置问题时：

- Framework：Vite；
- Build command：`npm run build`；
- Output directory：`dist`。

不过长期维护仍建议 GitHub，因为每次 push 都会自动生成部署。

---

## 5. 在 Vercel 创建项目

### GitHub 导入方式

1. 登录 Vercel Dashboard。
2. 点击 **Add New → Project**。
3. Import 刚才的 GitHub repository。
4. Framework Preset 应自动识别为 **Vite**。
5. 暂时不要立即依赖第一次部署成功；先填写环境变量。

### 5.1 添加环境变量

在 Vercel Project → **Settings → Environment Variables** 添加以下变量。

| Name | Value | 是否公开 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL | 会进入浏览器 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | 会进入浏览器 |
| `VITE_EVENT_SLUG` | `wulin-annual-2026` | 会进入浏览器 |
| `SUPABASE_URL` | 同一个 Supabase Project URL | 服务器端 |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | **服务器机密** |
| `EVENT_SLUG` | `wulin-annual-2026` | 服务器端 |
| `ADMIN_PIN` | `5678` | **服务器机密** |
| `SESSION_SECRET` | 至少 32 字符随机字符串 | **服务器机密** |

生成 `SESSION_SECRET` 的推荐命令：

```bash
openssl rand -base64 48
```

复制输出完整内容到 Vercel，不要提交到 GitHub。

### 5.2 环境范围

第一次正式部署可把上述变量全部勾选 **Production**。

需要 Preview 部署时，有两种选择：

- 简单试用：Preview 也使用同一个数据库和 event slug；注意预览版会操作正式数据。
- 更安全：建立第二个 Supabase 测试项目，或在数据库插入另一个 slug，例如 `wulin-annual-2026-test`，然后给 Preview 使用测试环境变量。

### 5.3 部署或重新部署

环境变量保存后：

1. 打开 Vercel Project → Deployments；
2. 对最新部署点击菜单 → **Redeploy**；
3. 或 push 一个新的 Git commit。

环境变量变更不会自动进入旧部署，必须重新部署。

---

## 6. 第一次上线检查

假设 Vercel 地址是：

```text
https://your-project.vercel.app
```

### 6.1 检查 API Function

浏览器打开：

```text
https://your-project.vercel.app/api/health
```

应看到类似：

```json
{"ok":true,"service":"wulin-tournament-control","database":"connected","eventSlug":"wulin-annual-2026","version":1}
```

### 6.2 检查公开页面

1. 打开首页。
2. 顶部状态应从“连接云端”变成“实时同步 · v1”。
3. 页面最初没有 Cat，这是正常的生产空数据库。
4. 打开“完整赛程”应显示空状态而不是报错。

红色“缺少 Supabase 配置”通常表示：

- `VITE_SUPABASE_URL` 或 `VITE_SUPABASE_PUBLISHABLE_KEY` 未设置；
- 设置后没有 Redeploy；
- key 复制时有空格或遗漏字符。

### 6.3 检查工作人员登录

1. 打开“后台管理”。
2. 输入 `5678`。
3. 后台应打开，并显示 Supabase 云端版本。
4. 浏览器开发者工具中不应看到 secret key。
5. 登录 Cookie 是 HttpOnly，JavaScript 不能读取。

### 6.4 建立比赛资料

有两种方式：

- 点击“载入示例”做功能测试；
- 直接新增正式 Cat / Pool / 队伍。

正式输入建议：

1. 先新增 6 个 Cat；
2. 每个 Cat 输入 Pool 和队伍；
3. 检查 RR 自动生成；
4. 给早上要跑的 3 个 Cat 分配不同 Courts；
5. Dashboard 只选择这 3 个 Cat；
6. 用“加入准备 / 置顶 / 暂缓”安排下一批队伍。

### 6.5 检查多设备 Realtime

1. 电脑 A 打开后台并登录。
2. 手机或无痕窗口 B 打开同一个 Vercel 地址，不登录。
3. A 新增 Cat 或修改 Event name。
4. B 应在几秒内自动更新，不需要刷新。
5. A 安排比赛到 Court 后，B 的 Court 区应同步变化。
6. A 录入比分后，B 的排名和 Playoff 结果应同步变化。

### 6.6 检查并发冲突保护

1. 电脑 A、电脑 B 都登录后台。
2. 两边同时修改不同内容，并尽量在同一秒保存。
3. 先保存成功的一边会增加数据库 version。
4. 后保存的一边若仍使用旧 version，会看到“多人修改冲突”。
5. 系统不会覆盖较新的云端数据；冲突设备会加载最新状态，并把自己未保存的版本留在 localStorage 保护副本中。

比赛当天仍建议：

- 1 台主控设备负责比分和排场；
- 其他后台设备用于辅助，不要多人同时快速编辑同一个场次；
- 大屏和观众设备只读。

---

## 7. 从旧 localStorage v3 迁移数据

最安全的方式不是复制 localStorage，而是使用 JSON：

1. 打开旧 v3 HTML。
2. 后台点击 **导出 JSON**。
3. 打开新的 Vercel 云端版并登录后台。
4. 点击 **导入 JSON**，选择旧备份。
5. 顶部状态显示“保存中”，随后变成“实时同步”。
6. 在另一台设备打开同一网址，确认数据出现。
7. 再从云端版导出一次 JSON，作为迁移后备份。

旧浏览器 localStorage 和新 Vercel 域名不是同一个 origin，因此不会自动共享。

---

## 8. 三四名和季军规则

每个 Cat 在生成 Playoff 前选择：

### 生成三四名赛

- 两场 Semifinal 的败方进入 Third Place；
- Third Place 胜者为季军，败者为第四名；
- 该比赛进入 Queue，可排场和修改比分。

### 不打三四名赛

- 比较两名 Semifinal 败方的输球分差；
- 分差较小者为季军；
- 分差较大者为第四名；
- 如果分差相同，大屏会显示“季军待确认”，需要工作人员按赛事补充规则人工决定。

切换规则后需要重新生成该 Cat 的 Playoff；重新生成会覆盖旧 Playoff，因此操作前先确认。

---

## 9. 日常备份和恢复

### 比赛前

- 完成全部队伍输入后导出 JSON；
- 完成 RR 排表和场地分配后再导出 JSON；
- 将备份存在两处，例如工作人员电脑和 Google Drive。

### 比赛中

Supabase 自动保留最近 250 个共享状态版本。可在 SQL Editor 查看：

```sql
select t.slug, h.version, h.actor, h.created_at
from public.tournament_state_history h
join public.tournaments t on t.id = h.tournament_id
where t.slug = 'wulin-annual-2026'
order by h.version desc
limit 30;
```

紧急回滚模板位于 `supabase/restore-example.sql`。使用前：

1. 先导出当前 JSON；
2. 查清正确的 `TARGET_VERSION`；
3. 替换 SQL 中的占位符；
4. 在 SQL Editor 执行；
5. 所有 Realtime 客户端会收到恢复后的新版本。

---

## 10. 自定义域名和大屏链接

在 Vercel Project → **Settings → Domains** 添加正式域名，例如：

```text
score.wulin.example
```

建议使用：

- TV 1 场地候场：`https://your-domain/?view=operations`
- TV 2 排名与 Playoff：`https://your-domain/?view=results`
- 完整赛程：`https://your-domain/?view=schedule`
- 工作人员：`https://your-domain/?view=admin`

电视浏览器打开 Dashboard 后点击“大屏全屏”。

如使用 Google Sites，可只放三个按钮或嵌入链接；主要应用仍运行在 Vercel。

---

## 11. 安全说明

### 11.1 关于 `5678`

该 PIN 符合当前赛事要求，但只有 4 位。公开发布测试链接时，任何知道 PIN 的人都能进入后台。

建议：

- 内部试运行可保留 `5678`；
- 正式公开前在 Vercel 把 `ADMIN_PIN` 改为更长值；
- 修改环境变量后 Redeploy；
- 不要把 PIN 写在公开海报或观众页面。

### 11.2 Key 的边界

- `VITE_SUPABASE_PUBLISHABLE_KEY`：公开，依赖 RLS 限制为只读。
- `SUPABASE_SECRET_KEY`：服务器机密，具有高权限，绝不放进浏览器、GitHub、聊天截图或 `VITE_` 变量。
- `SESSION_SECRET`：只在 Vercel，用于签发工作人员 Session Cookie。

### 11.3 写入路径

浏览器不能直接 update `tournaments`：

- RLS / grants 只给 anon 和 authenticated SELECT；
- 写入必须经过 `/api/state`；
- `/api/state` 必须收到有效工作人员 Cookie；
- Vercel Function 才能使用 secret key；
- SQL RPC 检查 expected version。

---

## 12. 常见问题

### 页面一直显示“缺少 Supabase 配置”

检查三个前端变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_EVENT_SLUG`

保存后重新部署。

### 页面显示 0 个 Cat

新数据库初始为空。登录后台后新增 Cat，或载入示例。

### PIN 正确但后台打不开

检查：

- `ADMIN_PIN` 是否设为 `5678`；
- `SESSION_SECRET` 是否至少 32 字符；
- 当前浏览器是否阻止 Cookie；
- Vercel Function Logs 中 `/api/login` 是否报配置错误。

### 后台能开，但保存失败

检查服务器变量：

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `EVENT_SLUG`

还要确认 `EVENT_SLUG`、`VITE_EVENT_SLUG` 和数据库 `slug` 三者完全相同。

### 另一台设备不自动更新

1. 运行 `supabase/verify.sql`；
2. 确认 `supabase_realtime` publication 包含 `tournaments`；
3. 确认浏览器能连接 WebSocket；
4. 查看浏览器 Console 是否有 Supabase Realtime 错误；
5. 刷新页面确认基本读取正常。

### 出现“多人修改冲突”

这是保护机制，不是数据损坏：

1. 云端保留了先完成的修改；
2. 当前设备自动加载最新版本；
3. 当前设备未保存的版本保存在 localStorage conflict backup；
4. 工作人员重新执行刚才那项操作即可。

### Vercel 修改环境变量后没有变化

环境变量只影响新部署。保存变量后必须 Redeploy。

---

## 13. 正式比赛前验收清单

- [ ] Supabase schema.sql 成功运行。
- [ ] verify.sql 四组检查都正常。
- [ ] Vercel 8 个环境变量已设置。
- [ ] Secret key 没有出现在任何 `VITE_` 变量。
- [ ] `/api/health` 返回 ok。
- [ ] PIN 登录成功。
- [ ] 第二台设备实时收到 Cat / Court / Score 更新。
- [ ] 6 个 Court 都测试过安排、退回和完成比分。
- [ ] 人工准备队列、置顶、暂缓和恢复已测试。
- [ ] 已完成比分修改后 RR 排名会重算。
- [ ] Playoff 晋级和比分修正已测试。
- [ ] 三四名赛开启和关闭两种规则都测试过。
- [ ] Dashboard 显示冠军、亚军、季军和第四名。
- [ ] 已导出一份正式赛前 JSON 备份。
- [ ] 主控电脑、电视、备用热点和电源方案已准备。

---

## 14. 官方参考

- Supabase Realtime / Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Vercel Vite deployment: https://vercel.com/docs/frameworks/frontend/vite
- Vercel Functions: https://vercel.com/docs/functions/functions-api-reference
- Vercel environment variables: https://vercel.com/docs/environment-variables/managing-environment-variables
