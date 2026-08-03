# 武林年度赛 Cloud v7：更新现有 GitHub + Vercel + Supabase

适用于现有正式网站：

```text
https://wulin-round-robin.vercel.app
```

本升级保留现有 Supabase Project、正式域名、赛事数据、历史快照与 Vercel Environment Variables。核心代码由 v6 升级到 v7。

> 现有 Production Deployment 不一定来自 `main`。升级前先在 Vercel 当前 Production Deployment 查看真实 Source branch / commit，再从该 source 建立 `upgrade/cloud-v7`；不要直接假设本地 `main` 就是当前线上代码。

---

# 1. v7 包含的修正

1. 双 Pool、每组前两名时，Playoff 固定交叉半决赛：
   - Pool A #1 vs Pool B #2
   - Pool A #2 vs Pool B #1
2. Round Robin Standing 排序：
   - Win Points
   - Head-to-Head
   - Point Differential
   - Points For
3. TV 2 Playoff 改为 bracket / branch 图。
4. Admin Playoff 设置显示每个 Pool 的完整排名与预计首轮对阵。
5. Staff Admin 以英文为主，保留少量中文辅助。
6. 人工 On Deck 可指定 Expected Court。
7. 每个 Court 可限制 Active Category，并进一步限制具体 Pool。
8. 自动 On Deck 会按每个 Court 的 Category + Pool route 选下一场。
9. 人工 On Deck 即使有队伍仍在打，也会继续显示下一场计划。
10. TV 1 针对 iPad 横屏 AirPlay 优化，一屏显示 Next 3–6 与六个 Live Courts。

---

# 2. 最重要的数据结论

## 2.1 不需要重建 Supabase

v7 新字段仍保存在现有 JSONB：

```text
public.tournaments.state
```

新增格式：

```text
state.version = 7
settings.courts[].poolAccess
matches[].preferredCourtId
```

因此现有部署：

- 不需要新建 Supabase Project；
- 不需要删除表；
- 不需要重新运行完整 `supabase/schema.sql`；
- 不需要更换 Project URL 或 API keys；
- 不需要修改正式 event slug；
- 原有 Cat、Pool、队伍、RR 比分与 Playoff 数据会保留。

第一次用 v7 后台成功保存时，兼容层会补齐新字段并写回同一条赛事记录。

## 2.2 错误的旧 Playoff 不会自动消失

代码升级不会擅自删除已经存在的 Men's Doubles Playoff，因为其中可能已有真实比分。

正式部署完成、完成备份并核对完整排名后，需要在后台明确执行：

```text
CATEGORY / POOL / PLAYOFF SETUP
→ Men's Doubles
→ REGENERATE PLAYOFF
```

这只会删除该 Category 的旧 Playoff matches、Playoff 分数与下游晋级结果；Round Robin 比分不会删除。已经试跑过的 Playoff 分数需要按新交叉对阵重新输入。

---

# 3. 升级前做两份备份

## 3.1 从现有线上后台导出 JSON

打开：

```text
https://wulin-round-robin.vercel.app/?view=admin
```

1. 输入 Staff PIN。
2. 点击 `EXPORT BACKUP JSON · 导出`。
3. 保存为：

```text
wulin_before_v7_YYYY-MM-DD_HHMM.json
```

这份文件包含 Categories、Pools、Teams、Courts、Routes、Queue、On Deck、RR、Playoff、比分与设置，是最方便的完整恢复文件。

## 3.2 在 Supabase 保存数据库结果

打开：

```text
Supabase Dashboard
→ SQL Editor
→ New query
```

运行：

```text
supabase/backup_before_v7.sql
```

下载查询结果，至少保留：

```text
slug
cloud_row_version
app_state_version
updated_at
updated_by
complete_state_json
```

不要执行 DELETE、TRUNCATE，也不要在现有项目重新运行完整 `schema.sql`。

## 3.3 记录当前 Production Deployment

打开：

```text
Vercel Dashboard
→ wulin-round-robin Project
→ Deployments
→ 当前 Production
```

记录：

- Deployment URL；
- Git branch；
- Git commit SHA；
- Production Branch。

发生问题时可以快速回滚到这一个 deployment。

---

# 4. 先确认 v7 Branch 应该从哪里建立

不要默认 `main` 一定等于当前线上 v6。先在 Vercel 当前 Production Deployment 的 `Source` 查看实际 branch 与 commit。

## 情况 A：当前 Production 来自 main，而且 main 已经是 v6

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c upgrade/cloud-v7
```

## 情况 B：当前 Production 来自其他 branch，例如 upgrade/cloud-v6

从实际 Production branch 建立 v7：

```bash
git fetch origin
git switch upgrade/cloud-v6
git pull --ff-only origin upgrade/cloud-v6
git switch -c upgrade/cloud-v7
```

## 情况 C：不确定 branch，但知道当前 Production commit SHA

直接从该 commit 建 branch：

```bash
git fetch origin
git switch -c upgrade/cloud-v7 PRODUCTION_COMMIT_SHA
```

确认：

```bash
git branch --show-current
git log -1 --oneline
```

第一行应是：

```text
upgrade/cloud-v7
```

第二行应对应当前线上 v6 的 source commit。

---

# 5. 用 v7 文件覆盖原 GitHub Repository

1. 解压：

```text
wulin-supabase-vercel-v7.zip
```

2. 打开原本连接 GitHub 与 Vercel 的本地 repository 根目录。
3. 保留隐藏的：

```text
.git
```

4. 把 v7 包中的项目文件复制进去并覆盖同名文件。可参考：

```text
FILES_TO_REPLACE.txt
```

主要需要更新：

```text
api/
public/
server/
src/
supabase/
tests/
index.html
package.json
vercel.json
README.md
ARCHITECTURE.md
CHANGELOG_V7.md
UPDATE_EXISTING_DEPLOYMENT_ZH.md
```

不要复制或提交：

```text
.env
.env.local
真实 SUPABASE_SECRET_KEY
真实 SESSION_SECRET
```

---

# 6. 本地检查

使用 Node.js 20.19 或更新版本：

```bash
npm install
npm test
npm run build
```

应看到：

```text
16 tests passed
vite build completed
```

测试包括：

- Cai / Larry 与 Vin / Greg 同 Win Points 时，直接交手胜者排前；
- Pool A #1 vs Pool B #2；
- Pool A #2 vs Pool B #1；
- v7 Court Category/Pool route 状态验证；
- Expected Court 状态验证；
- Staff Session、Cookie 与 API 安全验证。

---

# 7. Commit 与 Push

```bash
git status
git add .
git commit -m "Upgrade Wulin tournament control to cloud v7"
git push -u origin upgrade/cloud-v7
```

提交前再次检查：

```bash
git status
```

确保没有：

```text
.env
.env.local
任何真实 secret key
```

---

# 8. 建立 GitHub Pull Request 与 Vercel Preview

1. GitHub 打开 repository。
2. 建立 Pull Request。
3. `compare` 选择：

```text
upgrade/cloud-v7
```

4. `base` 选择 Vercel 设定的 Production Branch，通常是：

```text
main
```

5. PR title：

```text
Wulin Tournament Control v7
```

6. 先不要 Merge。

连接 GitHub 后，Vercel 会为非 Production branch / PR 建立独立 Preview Deployment。

打开：

```text
Vercel Dashboard
→ wulin-round-robin
→ Deployments
```

找到 `upgrade/cloud-v7`，等待：

```text
Ready
```

Build 设置应为：

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Node.js: 20.19 or newer
```

---

# 9. Preview 测试的两种方式

## 方式 A：只读检查 Production 数据

如果 Preview 沿用 Production 的 Supabase URL、keys 与 event slug，Preview 后台写入会修改正式赛事。

这种情况下只检查：

- TV 1 画面；
- TV 2 bracket；
- Admin 页面布局；
- `/api/health`；

不要在 Preview 后台排场、改比分或重建 Playoff。

## 方式 B：建立独立 Preview event，推荐

在 Supabase SQL Editor 运行：

```text
supabase/create_v7_preview_event.sql
```

它会把当前正式 state 复制成：

```text
wulin-annual-2026-v7-preview
```

然后在 Vercel Project → Settings → Environment Variables，给 **Preview** environment 设置：

```text
VITE_EVENT_SLUG=wulin-annual-2026-v7-preview
EVENT_SLUG=wulin-annual-2026-v7-preview
```

其他 Supabase URL 与 keys 可以继续使用同一个 Project，但 scope 必须是 Preview。保存后对 Preview deployment 执行 Redeploy。

这样可以完整测试：

- 输入比分；
- Court Pool routes；
- On Deck Expected Court；
- 重建 Men's Doubles Playoff；
- Realtime；

而不会改正式 event row。

测试完可运行：

```text
supabase/remove_v7_preview_event.sql
```

只删除 preview slug，不影响 production slug。

---

# 10. Vercel Environment Variables

v7 沿用原变量，Production 通常不需要修改：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_EVENT_SLUG
SUPABASE_URL
SUPABASE_SECRET_KEY
EVENT_SLUG
ADMIN_PIN
SESSION_SECRET
```

旧项目使用以下服务器变量也兼容：

```text
SUPABASE_SERVICE_ROLE_KEY
```

Production 必须保持：

```text
VITE_EVENT_SLUG = EVENT_SLUG = public.tournaments.slug
```

正式赛事通常是：

```text
wulin-annual-2026
```

安全规则：

- Publishable key 可以进入浏览器端 `VITE_` 变量；
- Secret / service-role key 只可以放 server-side 变量；
- 绝不能创建 `VITE_SUPABASE_SECRET_KEY`；
- 修改任何 Environment Variable 后，要建立新 deployment 或 Redeploy。

---

# 11. Preview 验收项目

## 11.1 TV 1

```text
https://PREVIEW_URL/?view=operations
```

检查：

- iPad landscape 一屏显示全部内容；
- 左侧 Next 3–6 Games；
- 右侧 6 个 Live Courts；
- 队名明显放大；
- 每场显示 Cat、Pool、RR ROUND；
- On Deck 显示 Expected Court；
- 人工预排且队伍仍在比赛时显示 `PLAYING NOW · 打完接场`。

## 11.2 TV 2

```text
https://PREVIEW_URL/?view=results
```

检查：

- Standing 显示 H2H / TB；
- Playoff 是 bracket branch，不是 list；
- Semifinal 分支连接 Final；
- Third Place Match 开启时有独立 bronze lane；
- Champion、Runner-up、Third Place、4th Place 正确。

## 11.3 Staff Admin

```text
https://PREVIEW_URL/?view=admin
```

检查：

- 英文主导、中文辅助；
- 六场地仍是 3 × 2；
- 每个 Court 的 `ROUTES` 可选 Category；
- Category 下可选 `ALL POOLS` 或具体 Pool；
- 人工 On Deck 可选 Expected Court；
- Playoff 设置显示每个 Pool 全部排名；
- Men's Doubles Expected Opening Round 显示 A1 vs B2、A2 vs B1。

## 11.4 H2H 检查

在同 Win Points 的 Cai / Larry 与 Vin / Greg 所在 Pool，确认：

- 两队直接比赛胜者排前；
- 即使另一队 overall Point Differential 更高，也不覆盖直接交手结果；
- `H2H / TB` 显示 `H2H WIN` / `H2H LOSS` 与比分。

## 11.5 Court Pool route 与自动 On Deck

例如设置：

```text
Court 1 → Men's Doubles → Pool A
Court 2 → Men's Doubles → Pool B
Court 3 → Women's Doubles → Pool A
```

自动 On Deck 应优先出现：

```text
Court 1 下一场 Men's Pool A
Court 2 下一场 Men's Pool B
Court 3 下一场 Women's Pool A
```

---

# 12. 上线到 Production

Preview 验收后：

1. 在 GitHub Merge Pull Request 到 Vercel 的 Production Branch。
2. 打开 Vercel Deployments。
3. 等来自 Production Branch 的 deployment 显示 `Ready`。
4. 确认正式域名仍指向新 deployment。
5. 打开：

```text
https://wulin-round-robin.vercel.app/api/health
```

正常应类似：

```json
{
  "ok": true,
  "service": "wulin-tournament-control",
  "database": "connected",
  "eventSlug": "wulin-annual-2026",
  "version": 123
}
```

这里的 `version` 是 Supabase row 每次成功保存增加的版本号，不需要等于 7。

---

# 13. Production 第一次 v7 数据保存

## 13.1 检查旧数据

登录正式 Admin，确认：

- 6 个 Categories；
- Pool A / Pool B；
- 所有队伍；
- Round Robin 比分；
- Courts；
- On Deck / Hold；
- 原 Playoff records。

## 13.2 做一次无害保存

例如：

```text
TV 1 On Deck count: 6 → 5 → 6
```

等待顶部显示：

```text
SYNCED / 实时同步
```

这次保存会把云端 state 格式正式升级为 v7，并补上：

```text
court.poolAccess
match.preferredCourtId
```

## 13.3 配置正式 Court routes

例如：

```text
Court 4 → Men's Doubles → Pool A only
Court 5 → Men's Doubles → Pool B only
Court 6 → Women's Doubles → All Pools
```

操作路径：

```text
SIX-COURT CONTROL
→ 对应 Court 的 ROUTES
→ 选择 Category
→ 选择 ALL POOLS 或具体 Pool
→ DONE
```

---

# 14. 正式修正 Men's Doubles Playoff

执行前再次导出 JSON。

进入：

```text
CATEGORY / POOL / PLAYOFF SETUP
→ Men's Doubles
```

1. 查看 Pool A 完整排名。
2. 查看 Pool B 完整排名。
3. 核对 Expected Opening Round：

```text
Match 1: Pool A #1 vs Pool B #2
Match 2: Pool A #2 vs Pool B #1
```

4. 记录旧 Playoff 实际比分。
5. 点击：

```text
REGENERATE PLAYOFF · 重排淘汰赛
```

6. 确认警告。
7. 按新交叉对阵重新输入已经试跑过的 Playoff 分数。
8. 打开 TV 2，确认 branch 与奖牌排名。

Round Robin 比分不会受这一步影响。

---

# 15. Supabase 升级验证

第一次 v7 保存后，在 Supabase SQL Editor 运行：

```text
supabase/verify_v7_update.sql
```

应看到：

```text
app_state_version = 7
court_count = 6
courts_with_v7_pool_access_shape = 6
```

`matches_with_preferred_court_field` 应等于现有 `match_count`；`matches_with_expected_court` 可以是 0 或更大，只统计已经指定 Expected Court 的比赛。

还应看到：

```text
supabase_realtime | public | tournaments
```

以及公开只读 RLS policy。

两个 version 的含义不同：

| Field | Meaning |
|---|---|
| `cloud_row_version` | 每成功保存一次增加 1 |
| `app_state_version` | App state 格式版本，本版应为 7 |

---

# 16. 两设备 Realtime 测试

设备 A 打开：

```text
?view=admin
```

设备 B 打开：

```text
?view=operations
```

或：

```text
?view=results
```

在设备 A 做一项可恢复操作：

- 设置某 Court 的 Pool route；
- 加入 On Deck 并选择 Expected Court；
- 调整 Next 3–6；
- 输入一场测试比分。

设备 B 应无需刷新自动更新：

- Expected Court；
- On Deck 顺序；
- Live Court；
- Standing；
- Playoff bracket；
- Medal positions。

---

# 17. 回滚

## 17.1 代码回滚

Vercel：

```text
Project
→ Deployments
→ 找到升级前正常 Production Deployment
→ ...
→ Instant Rollback
```

代码回滚不会自动改 Supabase state。

## 17.2 数据回滚

若误改比分或 Playoff：

1. 使用升级前导出的 JSON，在 Admin 执行 Import；或
2. 从 `tournament_state_history` 选择升级前 snapshot；
3. 再检查 Courts、On Deck、Standing 与 Playoff。

不要通过重新运行完整 `schema.sql` 恢复现有项目。
