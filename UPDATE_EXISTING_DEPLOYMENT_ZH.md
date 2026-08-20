# 武林年度赛 Cloud v8：更新现有 Vercel + Supabase 部署

适用情况：

- 网站已经部署在 Vercel；
- GitHub repository 已连接 Vercel；
- 正式比赛数据已经存入 Supabase；
- 需要保留现有 Categories、Pools、Teams、RR 分数、Courts、Queue 和历史版本。

v8 是前端、规则引擎与 JSONB state 格式升级。现有 Supabase 表结构、RLS、Realtime publication、RPC、API keys 与 Vercel Project 均可继续使用。

---

## 一、v8 新功能与规则

### 三 Pool、每 Pool 前两名

六支出线队伍先产生跨 Pool Seeds 1–6：

```text
1. Win Points
2. Head-to-Head（仅适用于确实在同一 Pool 交手的同分队伍）
3. Point Difference
4. Points For
```

不同 Pool 的队伍没有直接交手，因此没有 H2H 时直接比较 DIFF / PF。后台允许工作人员手动 Move Up / Move Down，手动结果优先。

Playoff 路径：

```text
Seed 1  ───────────────┐
                       ├─ SF1 ─┐
Seed 4 ─┐              │       │
        ├─ QF2 Winner ─┘       │
Seed 5 ─┘                      ├─ Final
                               │
Seed 2  ───────────────┐       │
                       ├─ SF2 ─┘
Seed 3 ─┐              │
        ├─ QF1 Winner ─┘
Seed 6 ─┘
```

官方比赛编号顺序：

```text
QF1 = Seed 3 vs Seed 6
QF2 = Seed 4 vs Seed 5
SF1 = Seed 1 vs Winner QF2
SF2 = Seed 2 vs Winner QF1
Final = Winner SF1 vs Winner SF2
```

### TV 1

- 每个 Active Category 独立显示 Done / Total、Queue、Live；
- 不再只显示一个全赛事 Completed / In Queue 数字；
- Expected Court 字样加大；
- iPad landscape 保持 On Deck 与 6 Live Courts 横向同屏。

### Admin

- Score Corrections 移到页面最后；
- 按 Category 折叠；
- 打开某个 Category 后才查看该项目比分细节；
- 修改 RR 分数后立即重算排名；
- 修改 Playoff 胜者后清理并重建受影响的下游分支。

---

## 二、升级前备份

### 1. 从正式 Admin 导出 JSON

打开：

```text
https://你的正式域名/?view=admin
```

登录后点击：

```text
EXPORT BACKUP JSON
```

建议命名：

```text
wulin_before_v8_YYYY-MM-DD.json
```

这份 JSON 是最快的完整恢复文件。

### 2. 从 Supabase 保存数据库快照

打开：

```text
Supabase Dashboard
→ SQL Editor
→ New query
```

运行：

```text
supabase/backup_before_v8.sql
```

下载或复制 Result。

### 3. 不要做这些操作

```text
不要删除 public.tournaments
不要删除 public.tournament_state_history
不要重新运行完整 schema.sql
不要建立新的正式 event slug
不要更换现有 Supabase keys
```

---

## 三、确认 Vercel 当前 Production Source

不要凭记忆假设正式版本一定来自 `main`。

打开：

```text
Vercel Dashboard
→ 当前 Wulin Project
→ Deployments
→ 当前 Production Deployment
→ Source
```

记录：

```text
Git repository
Git branch
Commit SHA
Production Branch
```

最安全的方法是直接从当前 Production commit 建立 v8 branch。

---

## 四、建立 v8 Git Branch

进入原 Git repository：

```bash
cd YOUR_EXISTING_WULIN_REPOSITORY
```

更新远端资料：

```bash
git fetch origin
```

从刚才记录的 Production Commit SHA 建立 branch：

```bash
git switch -c upgrade/cloud-v8 PRODUCTION_COMMIT_SHA
```

确认：

```bash
git branch --show-current
git log -1 --oneline
```

应看到：

```text
upgrade/cloud-v8
```

并且最新 commit 与当前线上 Production Source 相同。

### GitHub Desktop 做法

1. 打开原 repository；
2. Fetch origin；
3. 找到当前 Production 对应 branch / commit；
4. `Current Branch → New Branch`；
5. 名称填：

```text
upgrade/cloud-v8
```

---

## 五、覆盖项目文件

1. 解压：

```text
wulin-supabase-vercel-v8.zip
```

2. 打开解压目录；
3. 把里面全部文件复制到原 Git repository 根目录；
4. 选择覆盖同名文件；
5. 必须保留原 repository 的隐藏文件夹：

```text
.git
```

主要文件包括：

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
UPDATE_EXISTING_DEPLOYMENT_ZH.md
```

不要复制或提交：

```text
.env
.env.local
真实 SUPABASE_SECRET_KEY
真实 SESSION_SECRET
真实 ADMIN_PIN
```

---

## 六、本地测试

项目需要 Node.js 20.19 或更新版本。

运行：

```bash
npm install
npm test
npm run build
```

`npm test` 应通过 20 项测试，包括：

```text
Pool Head-to-Head
Two-Pool crossover
Three-Pool six-seed ranking
Manual seed override
Seed 3 vs 6 / Seed 4 vs 5
Court Category + Pool routes
Automatic On Deck
Busy-team manual On Deck
Session / Cookie / API security
State validation
```

`npm run build` 成功后应产生：

```text
dist/
```

不要把 `node_modules` 提交到 GitHub。

---

## 七、Commit 与 Push

检查变化：

```bash
git status
```

提交：

```bash
git add -A
git commit -m "Upgrade Wulin tournament control to cloud v8"
git push -u origin upgrade/cloud-v8
```

在 GitHub 建立 Pull Request：

```text
Compare: upgrade/cloud-v8
Base: Vercel 设置中的 Production Branch
```

先不要 Merge。

---

## 八、Vercel Preview 安全设置

GitHub branch push 后，连接的 Vercel Project 会建立 Preview Deployment。

打开：

```text
Vercel Dashboard
→ Project
→ Deployments
→ upgrade/cloud-v8 Preview
```

等待状态：

```text
Ready
```

### 为什么建议建立独立 Preview event

如果 Preview Environment 与 Production 使用相同：

```text
SUPABASE_URL
EVENT_SLUG
SUPABASE_SECRET_KEY
```

那么 Preview Admin 的写入会修改正式比赛数据。

### 建立 Preview event

在 Supabase SQL Editor 运行：

```text
supabase/create_v8_preview_event.sql
```

它会复制正式 event 到：

```text
wulin-annual-2026-v8-preview
```

然后进入：

```text
Vercel
→ Project Settings
→ Environment Variables
```

只给 **Preview** Environment 设置：

```text
VITE_EVENT_SLUG=wulin-annual-2026-v8-preview
EVENT_SLUG=wulin-annual-2026-v8-preview
```

其他 URL / keys 保持现有值。

保存后对 Preview Deployment 执行：

```text
Redeploy
```

环境变量变化不会自动进入已经完成的旧 Deployment。

---

## 九、检查现有 Vercel Environment Variables

Production 应继续保留：

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

旧项目也可以继续使用：

```text
SUPABASE_SERVICE_ROLE_KEY
```

正式环境必须满足：

```text
VITE_EVENT_SLUG = EVENT_SLUG = public.tournaments.slug
```

通常是：

```text
wulin-annual-2026
```

不要把 Secret / Service Role key 放入任何 `VITE_` 变量。`VITE_` 变量会进入浏览器 bundle。

v8 没有新增环境变量。

---

## 十、Preview 验收

### TV 1

```text
https://PREVIEW_DOMAIN/?view=operations
```

检查：

- Active Cat 各自显示 Done / Total；
- 各自显示 Queue；
- 有进行中比赛时显示 Live；
- On Deck Expected Court 字体更大；
- iPad landscape 一屏同时看到 On Deck 和 6 Live Courts；
- Court + Category + Pool 自动 On Deck 仍正常。

### TV 2

```text
https://PREVIEW_DOMAIN/?view=results
```

检查：

- 原有 Pool standings；
- H2H 排名；
- 两 Pool crossover；
- Playoff branch；
- 三 Pool 6 Seeds 生成后，Bracket 为 QF → SF → Final；
- Seed 1 / 2 直接出现在 SF。

### Admin

```text
https://PREVIEW_DOMAIN/?view=admin
```

检查：

- 6 Court 横向中控；
- Category + Pool Routes；
- Manual On Deck + Potential Court；
- Category / Pool Tabs；
- 三 Pool Cross-Pool Seed Table；
- Move Up / Move Down；
- Reset Auto；
- Score Corrections 位于页面最后；
- Score Corrections 按 Category 折叠。

---

## 十一、三 Pool 功能验收步骤

在 Preview 使用一个拥有 3 Pools 的 Category：

1. 每个 Pool 的 `PLAYOFF QUALIFIERS` 设为 `2`；
2. 完成或输入足够 RR 分数；
3. 打开该 Category 的 Playoff Settings；
4. 查看六支队伍的自动 Seed 1–6；
5. 检查列：

```text
PTS
H2H / TB
DIFF
PF
```

6. 检查路径：

```text
QF1 Seed 3 vs Seed 6
QF2 Seed 4 vs Seed 5
SF1 Seed 1 vs QF2 Winner
SF2 Seed 2 vs QF1 Winner
```

7. 用 Move Up / Move Down 改变一个 Seed；
8. 确认状态变为 `MANUAL ORDER`；
9. 点击 `GENERATE PLAYOFF`；
10. 在 Full Schedule 和 TV 2 检查真实对阵；
11. 完成 QF2，确认胜者进入 Seed 1 的 SF；
12. 完成 QF1，确认胜者进入 Seed 2 的 SF；
13. 如开启 Third Place Match，确认两个 SF 败方进入 Bronze Match。

---

## 十二、Merge 正式上线

Preview 全部通过后：

1. GitHub Merge Pull Request；
2. 等 Vercel 自动建立 Production Deployment；
3. 确认状态：

```text
Ready
```

4. 打开：

```text
https://你的正式域名/api/health
```

正常结果应包括：

```json
{
  "ok": true,
  "database": "connected",
  "eventSlug": "wulin-annual-2026"
}
```

`version` 是 Supabase row version，每次成功保存增加一次，不需要等于 8。

---

## 十三、第一次正式 v8 保存

登录正式 Admin，先确认旧数据仍在：

```text
Categories
Pools
Teams
RR Scores
Existing Playoff
Courts
Queue
On Deck
```

做一次无害修改：

```text
TV 1 On Deck Count：6 → 5 → 6
```

等待顶部显示：

```text
App state v8
Synced with Supabase
```

这次保存会把 normalize 后的 v8 JSONB state 写回原 event row。

---

## 十四、现有 Playoff 不会自动被替换

升级代码不会自动删除已经存在的 Playoff，因为旧 Playoff 可能已经有真实比分。

对于需要应用新三 Pool 规则的 Category：

1. 再导出一份 JSON；
2. 打开 Category / Pool / Playoff Settings；
3. 确认三个 Pool 每个出线 2 队；
4. 检查自动跨 Pool Seeds；
5. 必要时手动调整；
6. 点击：

```text
GENERATE / REGENERATE PLAYOFF
```

7. 确认替换旧 Playoff。

这一操作：

- 保留 RR 赛程与 RR 比分；
- 保留 Pool standings；
- 删除该 Category 的旧 Playoff matches；
- 删除旧 Playoff 分数；
- 按 v8 Seeds 重新生成 QF / SF / Final / optional Bronze。

旧 Playoff 分数需要按当天记录重新输入。

---

## 十五、Supabase 检查

第一次正式 v8 保存后，在 Supabase SQL Editor 运行：

```text
supabase/verify_v8_update.sql
```

预期：

```text
app_state_version = 8
court_count = 6
categories_with_seed_order_field = category_count
```

`custom_six_seed_bracket_matches`：

- 尚未生成三 Pool Playoff 时可以是 `0`；
- 生成三 Pool Playoff 后应大于 `0`。

还应看到：

```text
supabase_realtime | public | tournaments
```

---

## 十六、两台电视与多设备 Realtime 测试

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

- 修改 Court Route；
- 加入 On Deck；
- 修改 Potential Court；
- 输入比分；
- 调整 Active Category；
- 调整 On Deck Count。

其他设备应无需手动刷新就更新。

---

## 十七、清理 Preview event

正式版确认正常后，在 Supabase SQL Editor 运行：

```text
supabase/remove_v8_preview_event.sql
```

然后可以删除 Vercel Preview 专用的两个 slug 环境变量，或者留给下次测试。

---

## 十八、回滚

### 代码回滚

```text
Vercel
→ Deployments
→ 找到升级前最后一个正常 Production Deployment
→ Instant Rollback / Promote
```

### 数据回滚

使用任一方法：

1. Admin 导入升级前 JSON；
2. 从 `tournament_state_history` 恢复升级前 snapshot；
3. 再检查 Courts、Queue、On Deck、RR、Playoff。

不要通过重新运行完整 `schema.sql` 恢复现有比赛。
