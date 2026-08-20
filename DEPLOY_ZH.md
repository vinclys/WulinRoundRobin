# 武林年度赛 Cloud v8：Supabase + Vercel 全新部署手册

这份手册仅用于**第一次建立全新项目**。已经有线上 Vercel + Supabase 的项目，请改看：

```text
QUICK_UPDATE_V8_ZH.md
UPDATE_EXISTING_DEPLOYMENT_ZH.md
```

Cloud v8 包含双电视 Dashboard、六场地后台、Round Robin、Head-to-Head 排名、两 Pool 交叉半决赛、三 Pool 六种子 Playoff、图形化 Bracket、Court Category + Pool Routes、Potential Court、Supabase Realtime 和服务器端 Staff PIN Session。

---

## 一、系统结构

```text
TV 1 / TV 2 / 参赛者手机
          │
          ├── Supabase RLS 公开只读 + Realtime
          │
Staff Admin
          │
          └── Vercel /api/state
                   ├── 验证 HttpOnly Staff Session
                   ├── 校验完整比赛 state
                   ├── 使用服务器端 Supabase secret key
                   └── 原子版本锁保存 + history snapshot
```

Supabase 是共享比赛数据的唯一权威来源。浏览器 localStorage 只用于最新缓存、未同步修改和多人编辑冲突保护，不再是正式数据库。

---

## 二、需要准备

- Supabase 账号；
- Vercel 账号；
- 推荐 GitHub 账号和一个 private repository；
- Node.js 20.19 或更新版本，用于本地测试；
- 本项目完整 ZIP。

---

## 三、建立全新 Supabase Project

1. 登录 Supabase Dashboard；
2. 新建 Project；
3. Project name 可填 `wulin-tournament-2026`；
4. 使用密码管理器保存 Database Password；
5. Region 选择接近比赛场地的位置；
6. 等待初始化完成。

### 3.1 运行完整 Schema

只有全新 Project 才运行：

```text
supabase/schema.sql
```

操作：

```text
Supabase Dashboard
→ SQL Editor
→ New query
→ 复制 schema.sql 全部内容
→ Run
```

它会建立：

- `public.tournaments`；
- `public.tournament_state_history`；
- 原子保存 RPC `save_tournament_state(...)`；
- RLS 公开只读规则；
- Realtime publication；
- 初始 event `wulin-annual-2026`；
- 6 个默认 Courts；
- `state.version = 8` 的空赛事数据。

### 3.2 验证数据库

运行：

```text
supabase/verify.sql
```

应确认：

- `wulin-annual-2026` 存在；
- cloud row version 初始为 1；
- app state version 为 8；
- `Public tournaments are readable` policy 存在；
- `public.tournaments` 已加入 `supabase_realtime`；
- history 至少有一笔 `schema-seed`；
- 6 个 Court 都存在。

### 3.3 复制 Supabase 连接资料

在 Supabase Project Settings / API Keys 取得：

```text
Project URL
Publishable key
Secret key
```

边界：

```text
Publishable key → 可进入浏览器，但必须配合 RLS
Secret key      → 只能放 Vercel Server Environment
```

不要把 secret/service-role key 放进任何 `VITE_` 变量。

---

## 四、把项目上传到 GitHub

1. 解压 `wulin-supabase-vercel-v8.zip`；
2. 在 GitHub 建立 private repository；
3. 在解压目录执行：

```bash
git init
git add .
git commit -m "Initial Wulin Tournament Cloud v8"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

确认 repository 中没有：

```text
.env
.env.local
真实 Supabase secret key
真实 SESSION_SECRET
```

---

## 五、在 Vercel 建立 Project

1. 登录 Vercel；
2. `Add New → Project`；
3. Import 刚建立的 GitHub repository；
4. Framework Preset 选择或确认 `Vite`；
5. Build Command：

```text
npm run build
```

6. Output Directory：

```text
dist
```

---

## 六、设置 Vercel Environment Variables

进入：

```text
Vercel Project
→ Settings
→ Environment Variables
```

添加：

| Name | Value | 范围 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL | Browser |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Browser |
| `VITE_EVENT_SLUG` | `wulin-annual-2026` | Browser |
| `SUPABASE_URL` | 同一个 Project URL | Server |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | Server secret |
| `EVENT_SLUG` | `wulin-annual-2026` | Server |
| `ADMIN_PIN` | `5678` 或更长 Staff PIN | Server secret |
| `SESSION_SECRET` | 至少 32 字符随机值 | Server secret |

生成 Session Secret：

```bash
openssl rand -base64 48
```

三个 slug 必须一致：

```text
VITE_EVENT_SLUG
EVENT_SLUG
public.tournaments.slug
```

旧 Supabase 项目如仍使用 legacy service-role key，可设置：

```text
SUPABASE_SERVICE_ROLE_KEY
```

它是 `SUPABASE_SECRET_KEY` 的兼容替代项；不要同时暴露到前端。

---

## 七、部署

环境变量保存后：

```text
Vercel Project
→ Deployments
→ 最新 Deployment
→ Redeploy
```

或向 GitHub push 新 commit。等待 Deployment 状态为：

```text
Ready
```

---

## 八、检查 API 和云端连接

打开：

```text
https://YOUR_DOMAIN/api/health
```

正常结果类似：

```json
{
  "ok": true,
  "service": "wulin-tournament-control",
  "database": "connected",
  "eventSlug": "wulin-annual-2026",
  "version": 1
}
```

如果返回 500，检查：

```text
SUPABASE_URL
SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY
EVENT_SLUG
```

再查看 Vercel Function Logs。

---

## 九、检查四个页面

```text
?view=operations  TV 1：On Deck + Live Courts + Active Cat Progress
?view=results     TV 2：Standings + Playoff Bracket
?view=schedule    Full Schedule
?view=admin       Staff Admin
```

后台登录使用 `ADMIN_PIN`。PIN 验证在 Vercel Function 中执行，不是前端 JavaScript 密码判断。

---

## 十、第一次建立赛事资料

建议顺序：

1. 登录 Admin；
2. 新增 Categories；
3. 每个 Category 建立 Pool 和 Teams；
4. 检查自动生成的 Round Robin；
5. 设置上午 / 下午的 Active Categories；
6. 在 Court `ACCESS / ROUTES` 中指定 Category 和 Pool；
7. 选择 TV 1 显示 Next 3–6 Games；
8. 用 Queue、Manual On Deck、Potential Court 和 Hold 调整流程；
9. 导出第一份正式 JSON 备份。

### 两 Pool、各前两名

系统生成：

```text
Pool A #1 vs Pool B #2
Pool A #2 vs Pool B #1
```

### 三 Pool、各前两名

系统先建立六支队伍的跨 Pool Seeds：

```text
1. Win Points
2. Head-to-Head（只有同 Pool、确实交手的同分队伍适用）
3. Point Difference
4. Points For
```

然后生成：

```text
QF1 Seed 3 vs Seed 6
QF2 Seed 4 vs Seed 5
SF1 Seed 1 vs Winner QF2
SF2 Seed 2 vs Winner QF1
Final Winner SF1 vs Winner SF2
```

Seed 1、Seed 2 首轮 BYE。Admin 可在生成前 Move Up / Move Down 手动调整完整 Seed 1–6。

---

## 十一、Standing Tie-Break

每个 Pool 的排名顺序：

```text
1. Win Points
2. Head-to-Head
3. Point Difference
4. Points For
```

两队同 Win Points 时，直接交手胜者优先。三队或以上同分时，系统建立同分队伍之间的 mini-table；仍无法区分时再使用整体 DIFF / PF。

跨 Pool 队伍没有直接交手，因此跨 Pool six-seed table 只在同 Pool 的同分队伍之间保留 H2H 先后，其他队伍使用 DIFF / PF；Admin 可处理仍有争议的人工 Seed。

---

## 十二、两台电视和 Realtime 测试

设备 A：

```text
?view=admin
```

设备 B：

```text
?view=operations
```

设备 C：

```text
?view=results
```

从 Admin 执行：

- 安排比赛到 Court；
- 加入 On Deck 并选择 Potential Court；
- 输入比分；
- 修改 Active Category；
- 修改 Court Pool Route。

其他设备应无需刷新就更新。断线时，电视保留最新缓存并显示离线 / stale 状态；恢复连接后接收新的云端 snapshot。

---

## 十三、TV 1 的比赛日设置

TV 1 针对 iPad landscape AirPlay：

- 顶部按每个 Active Category 显示 `Done / Total`、`Queue`、`Live`；
- On Deck 显示 Next 3–6；
- `PREPARE FOR COURT N` 使用更大字号；
- Live Courts 以 3 × 2 显示；
- 横屏下 On Deck 与 6 Courts 保持同屏。

推荐在 iPad Browser 打开：

```text
?view=operations
```

然后点击全屏按钮，再开始 AirPlay。

---

## 十四、Score Corrections

低频使用的 Score Corrections 位于 Admin 最后：

```text
SCORE CORRECTIONS · 比分修正
```

每个 Category 默认折叠。展开后可以修改已完成 RR / Playoff 比分：

- RR 修正会重新计算 Standing；
- Playoff 修正如改变胜者，会清除并重新传播受影响的下游晋级；
- 保存后当前 Category 仍保持展开，方便连续核对。

---

## 十五、三四名规则

每个 Category 在生成 Playoff 前选择：

### 打 Third Place Match

两个 Semifinal 败方进入三四名赛，胜者季军，败者第四名。

### 不打 Third Place Match

比较两个 Semifinal 败方的输球分差：

- 分差较小者季军；
- 分差较大者第四名；
- 分差相同则显示待工作人员确认。

切换规则后需要重新生成该 Category 的 Playoff。

---

## 十六、备份和恢复

比赛前后都建议从 Admin 导出 JSON。Supabase 同时保留最近 250 个完整 snapshots。

查看历史：

```sql
select t.slug, h.version, h.actor, h.created_at
from public.tournament_state_history h
join public.tournaments t on t.id = h.tournament_id
where t.slug = 'wulin-annual-2026'
order by h.version desc
limit 30;
```

紧急恢复模板：

```text
supabase/restore-example.sql
```

使用前先导出当前 JSON，并准确确认要恢复的历史版本。

---

## 十七、并发修改保护

当两台 Admin 同时从同一个 cloud version 修改：

1. 先保存的设备成功并增加 row version；
2. 后保存的设备收到 409 version conflict；
3. 系统不会覆盖新数据；
4. 未保存 snapshot 会留在 localStorage conflict backup；
5. 设备加载最新云端 state，工作人员再执行原操作。

比赛当天仍建议一台主控负责高频比分和排场，其他 Staff 设备用于辅助。

---

## 十八、自定义域名

Vercel：

```text
Project Settings
→ Domains
```

常用入口：

```text
https://YOUR_DOMAIN/?view=operations
https://YOUR_DOMAIN/?view=results
https://YOUR_DOMAIN/?view=schedule
https://YOUR_DOMAIN/?view=admin
```

Google Sites 可作为入口页，但正式 App 仍应直接运行在 Vercel。

---

## 十九、安全检查

- `SUPABASE_SECRET_KEY` 不得出现在 GitHub；
- Secret key 不得使用 `VITE_` 前缀；
- `SESSION_SECRET` 不得重复使用简单文字；
- 正式公开前建议将四位 PIN 改成长一些；
- 修改任何 Vercel 环境变量后重新部署；
- Public 页面保持只读；
- Staff 写入只经 `/api/state`；
- 每次正式比赛前导出 JSON。

---

## 二十、正式上线验收

- [ ] `schema.sql` 只在全新 Supabase Project 运行一次；
- [ ] `verify.sql` 检查正常；
- [ ] 8 个 Vercel 环境变量已填写；
- [ ] `/api/health` 显示 `database: connected`；
- [ ] Staff PIN 登录成功；
- [ ] 第二台设备能实时收到 Court / Score 更新；
- [ ] 6 Courts 安排、退回、完赛均已测试；
- [ ] Court Category + Pool Routes 已测试；
- [ ] Manual On Deck 和 Potential Court 已测试；
- [ ] Active Category progress 在 TV 1 正确；
- [ ] Expected Court 在电视上清晰；
- [ ] Pool H2H 排名已测试；
- [ ] 两 Pool crossover 已测试；
- [ ] 三 Pool six-seed 和手动调整已测试；
- [ ] Seed 1 / 2 BYE 与 QF/SF 路径正确；
- [ ] TV 2 Bracket 和 Medal Positions 已测试；
- [ ] Score Corrections 折叠区已测试；
- [ ] 已导出正式 JSON 备份。
