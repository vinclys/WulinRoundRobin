# Wulin Cloud v8 · 现有线上项目快速升级清单

这份清单用于已经部署在 Vercel、数据已经存于 Supabase 的项目。完整解释见 `UPDATE_EXISTING_DEPLOYMENT_ZH.md`。

## 1. 先备份

1. 打开正式站 `?view=admin`，登录后点击 `EXPORT BACKUP JSON`。
2. 在 Supabase SQL Editor 运行 `supabase/backup_before_v8.sql`，保存结果。
3. 不要删除 `public.tournaments` 或 `public.tournament_state_history`。

## 2. 从当前 Production 的准确 commit 建立 Branch

先在 Vercel 当前 Production Deployment 的 Source 中记录 Git commit SHA，然后：

```bash
git fetch origin
git switch -c upgrade/cloud-v8 PRODUCTION_COMMIT_SHA
```

这样不论当前正式代码来自 `main`、`upgrade/cloud-v6` 或其他 branch，都不会从旧代码起步。

## 3. 覆盖 v8 文件并测试

1. 解压 `wulin-supabase-vercel-v8.zip`。
2. 把解压目录中的全部项目文件复制到原 Git repository 根目录。
3. 保留原来的隐藏 `.git` 文件夹。
4. 不要复制 `.env` 或 `.env.local`，也不要把真实 key 放进 GitHub。
5. 运行：

```bash
npm install
npm test
npm run build
```

## 4. Commit / Push

```bash
git add -A
git commit -m "Upgrade Wulin tournament control to cloud v8"
git push -u origin upgrade/cloud-v8
```

GitHub 建立 Pull Request：

```text
upgrade/cloud-v8 → Vercel 的 Production Branch
```

先不要 merge。

## 5. 安全测试 Preview

推荐在 Supabase SQL Editor 运行：

```text
supabase/create_v8_preview_event.sql
```

然后在 Vercel 仅对 Preview Environment 设置：

```text
VITE_EVENT_SLUG=wulin-annual-2026-v8-preview
EVENT_SLUG=wulin-annual-2026-v8-preview
```

保存后 Redeploy Preview。否则 Preview Admin 的写入会直接修改正式 event row。

## 6. Preview 验收

检查：

```text
?view=operations
?view=results
?view=schedule
?view=admin
```

重点测试：

- 三 Pool 各前两名的跨 Pool 6 Seeds；
- Seed 1 / 2 BYE；
- QF 3 vs 6、4 vs 5；
- SF1 Seed 1 vs 4/5 Winner；
- SF2 Seed 2 vs 3/6 Winner；
- 手动 Move Up / Move Down 后重新生成 Playoff；
- TV 1 每个 Active Cat 的 Done / Queue / Live；
- Expected Court 大字；
- Admin 最后的折叠式 Score Corrections。

## 7. 正式上线

1. Merge Pull Request 到 Vercel Production Branch。
2. 等 Vercel Production Deployment 显示 `Ready`。
3. 打开 `/api/health`，确认 database 为 `connected`。
4. 登录正式 Admin，确认旧 Categories、Pools、Scores、Courts、Queue 都在。
5. 做一次无害修改，例如 On Deck Count `6 → 5 → 6`，等待 `Synced`。
6. 在 Supabase SQL Editor 运行 `supabase/verify_v8_update.sql`，确认 `app_state_version = 8`。

## 8. 三 Pool Cat 要重新生成 Playoff

升级代码不会自动删除已经存在的 Playoff。

1. 再导出一次 JSON。
2. Admin → Category / Pool / Playoff Settings。
3. 选择三 Pool Cat。
4. 确认每个 Pool 的 Qualifiers 都是 2。
5. 检查跨 Pool Seed Table。
6. 必要时 Move Up / Move Down。
7. 点击 `GENERATE / REGENERATE PLAYOFF`。
8. 已有旧 Playoff 分数会被清除，需要按比赛记录重新输入。

## 9. 清理 Preview

确认正式版正常后：

```text
supabase/remove_v8_preview_event.sql
```
