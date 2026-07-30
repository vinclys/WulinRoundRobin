# 武林年度赛 v6：更新现有 Vercel + Supabase 部署

本版本把已经确认的 v6 本地预览功能合并到正式云端版：

- TV 1：6 个当前场地 + Next 3–6 Games；
- TV 2：可选择公开 Cat 的 Round Robin leaderboard、Playoff 和奖牌排名；
- Current Session Active Cats；
- 每个 Court 在场地卡片内直接设置 `ALL ACTIVE` 或可运行 Cat；
- Court 和 Queue 显示准确的 `RR ROUND x/y`；
- 后台 3 列 × 2 行六场地中控；
- Cat / Pool 双层 Tabs；
- Supabase Realtime、多设备版本锁、Vercel 安全 PIN Session 保持不变。

## 最重要的结论

**升级已经部署的项目不需要重新建立 Supabase，也不需要删除或重建数据库。**

`tournaments.state` 是 JSONB；v6 前端会兼容并自动补齐旧状态缺少的字段。现有 Cat、Pool、队伍、赛程、比分和 Playoff 数据会保留。第一次用 v6 后台保存时，补齐后的 v6 状态会写回同一条云端记录。

---

## A. 升级前备份

### 1. 从旧线上 App 导出

1. 打开旧线上网址的后台。
2. 登录工作人员 PIN。
3. 点击「导出备份 JSON」。
4. 把文件保存为类似：

```text
wulin_before_v6_2026-08-xx.json
```

### 2. 可选：Supabase SQL 备份

在 Supabase Dashboard → SQL Editor 运行：

```text
supabase/backup_before_v6.sql
```

保存查询结果。不要清空 `tournaments` 或 `tournament_state_history`。

---

## B. 用 v6 文件覆盖现有 GitHub Repository

### 方法 1：使用 Windows 文件夹和 GitHub Desktop

1. 解压本 ZIP。
2. 打开你原本连接 Vercel 的 GitHub repository 本地文件夹。
3. 保留原 repository 的 `.git` 隐藏文件夹。
4. 把 v6 项目的下列内容复制进原 repository，选择覆盖：

```text
api/
public/
server/
src/
supabase/
tests/
.env.example
.gitignore
ARCHITECTURE.md
DEPLOY_ZH.md
README.md
UPDATE_EXISTING_DEPLOYMENT_ZH.md
index.html
package.json
vercel.json
```

5. 不要把真实 `.env` 或 `.env.local` 上传到 GitHub。
6. 在 GitHub Desktop 查看 Changes，确认没有 Secret Key。
7. Commit message：

```text
Upgrade Wulin tournament control to cloud v6
```

8. Push origin。

### 方法 2：命令行

在原 repository 根目录执行：

```bash
git status
git checkout -b upgrade/cloud-v6
```

把解压后的 v6 文件覆盖到这个目录，然后执行：

```bash
git status
git add .
git commit -m "Upgrade Wulin tournament control to cloud v6"
git push -u origin upgrade/cloud-v6
```

建议先让 Vercel 为这个 branch 生成 Preview；确认无误后再 merge 到原本的 Production branch（通常是 `main`）。

---

## C. Vercel 环境变量

如果前一个云端版已经正常运行，以下变量继续沿用，通常不需要修改：

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

三个 slug 必须继续对应同一赛事：

```text
VITE_EVENT_SLUG = EVENT_SLUG = tournaments.slug
```

默认值：

```text
wulin-annual-2026
```

不要把 `SUPABASE_SECRET_KEY` 改成以 `VITE_` 开头；浏览器只能使用 publishable key。

如果你修改了任何 Vercel Environment Variable，保存后必须创建新的 deployment 或 Redeploy；旧 deployment 不会自动得到新变量。

---

## D. Vercel 自动部署

如果 Vercel 已连接 GitHub：

1. Push branch 后，Vercel 自动建立 Preview Deployment。
2. 打开 Vercel Project → Deployments。
3. 等待 Build 状态变成 Ready。
4. 在 Preview URL 先做测试。
5. Merge 到 Production branch 后，Vercel 自动更新正式域名。

若 Build 失败：

1. 打开失败 Deployment。
2. 查看 Build Logs。
3. 确认 Framework 是 Vite。
4. Build Command 应为：

```text
npm run build
```

5. Output Directory 应为：

```text
dist
```

---

## E. Supabase 是否要运行 SQL？

### 已有云端版

**不用重新运行 `schema.sql`。**

现有表、RLS、RPC、history 和 Realtime publication 都与 v6 相容。直接更新前端和 Vercel Functions 即可。

升级后可运行：

```text
supabase/verify_v6_update.sql
```

在第一次 v6 后台保存前，`app_state_version` 或 `on_deck_limit` 可能仍显示旧值或 null，这是正常的；v6 浏览器已经在读取时补齐默认值。第一次保存后会显示：

```text
app_state_version = 6
on_deck_limit = 6
```

### 全新 Supabase Project

只有新建项目时才运行完整：

```text
supabase/schema.sql
```

---

## F. Preview 测试时避免改到正式比赛数据

Vercel Preview 如果使用与 Production 完全相同的 Supabase 环境变量，Preview 后台也会修改正式数据库。

安全选择有两个：

1. Preview 只做公开页面和登录画面检查，不在后台保存；或
2. 为 Preview 建立独立 Supabase 测试 project / 独立 event slug。

最简单的正式升级方式是：先导出 JSON 备份，在 Preview 只检查布局，然后 merge；正式域名上线后再做完整后台操作测试。

---

## G. 正式域名上线后的逐项检查

先打开：

```text
https://你的域名/api/health
```

应看到：

```json
{
  "ok": true,
  "database": "connected",
  "eventSlug": "wulin-annual-2026"
}
```

然后检查四个页面：

```text
TV 1
https://你的域名/?view=operations

TV 2
https://你的域名/?view=results

完整赛程
https://你的域名/?view=schedule

后台
https://你的域名/?view=admin
```

后台登录后：

1. 确认原有 Cat、Pool、队伍和比分仍在。
2. 在 Current Session 只启用当前上午或下午正在运行的 Cat。
3. 检查每个 Court 的「可排」按钮。
4. Court 3 等弹性场地可以勾选 `ALL ACTIVE`。
5. 确认 Court 卡片和 Queue 显示 `RR ROUND x/y`。
6. 把 On Deck 数量设为 3、4、5 或 6；默认 6。
7. 在 TV 2 选择需要公开的 Cat。
8. 等顶部显示：

```text
实时同步 · vXX
```

9. 用另一台手机打开 TV 1 / TV 2，确认无需刷新就更新。

---

## H. 旧数据升级后的默认逻辑

旧云端状态没有 v6 字段时，系统会这样处理：

- `prepareLimit`：默认 6；
- `court.allowAllActive`：默认 false；
- `cat.active`：已有 Court 分配或有正在进行比赛的 Cat 会自动设为 Active；其他 Cat 默认 Inactive；
- 原有 `courtIds`、Queue、比分、排名和 Playoff 不会删除。

上线后建议工作人员主动检查一次上午/下午 Active Cat，避免旧 Court 分配令不该运行的 Cat 被自动判断为 Active。

---

## I. 回滚方法

### Vercel Dashboard

1. Project → Deployments。
2. 找到上一版 Ready deployment。
3. 使用 Promote / Rollback，或从 Git revert 后重新部署。

### Git

```bash
git revert <v6-commit-sha>
git push
```

v6 新增字段都位于 JSONB 内；旧前端会忽略不认识的字段，因此代码回滚不会自动删除比赛数据。不过任何回滚前仍建议先导出 JSON。

---

## J. 比赛当天建议

- TV 1 固定打开 `?view=operations` 并全屏；
- TV 2 固定打开 `?view=results`，选好 Cat 后全屏；
- 工作人员电脑打开 `?view=admin`；
- 比赛开始前导出一份 JSON；
- 中午切换下午项目时先调整 Active Cats，再调整 Court 可排 Cat；
- 看到「保存中」时不要连续刷新；等变成「实时同步」；
- 若出现多人修改冲突，系统会载入云端最新版本，工作人员应重新执行刚才那一步。
