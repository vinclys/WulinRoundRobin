# Wulin Cloud v8 · 上线验收清单

## A. 备份与 Branch

- [ ] 正式 Admin 已导出升级前 JSON。
- [ ] Supabase 已运行 `backup_before_v8.sql` 并保存结果。
- [ ] v8 branch 从当前 Vercel Production commit SHA 建立。
- [ ] `.env`、secret key、SESSION_SECRET 没有进入 GitHub。
- [ ] `npm test` 全部通过。
- [ ] `npm run build` 成功并产生 `dist/`。

## B. Preview 隔离

- [ ] Supabase 已运行 `create_v8_preview_event.sql`。
- [ ] Vercel Preview 使用 `wulin-annual-2026-v8-preview`。
- [ ] Preview 环境变量修改后已 Redeploy。
- [ ] `/api/health` 显示 Preview slug 和 `database: connected`。

## C. 三 Pool 六种子

- [ ] 测试 Category 正好有 3 Pools。
- [ ] 每个 Pool 的 Qualifiers 都设为 2。
- [ ] Admin 显示完整六支出线队伍。
- [ ] Auto Seed 依次使用 PTS → 同 Pool H2H → DIFF → PF。
- [ ] Seed 1、Seed 2 显示 `BYE TO SF`。
- [ ] QF1 为 Seed 3 vs Seed 6。
- [ ] QF2 为 Seed 4 vs Seed 5。
- [ ] SF1 为 Seed 1 vs QF2 Winner。
- [ ] SF2 为 Seed 2 vs QF1 Winner。
- [ ] Move Up / Move Down 会切换为 Manual Order。
- [ ] Reset Auto 会恢复自动 Seed。
- [ ] 生成 Playoff 后 Full Schedule 和 TV 2 对阵一致。
- [ ] QF2 胜者正确进入 Seed 1 的 SF。
- [ ] QF1 胜者正确进入 Seed 2 的 SF。
- [ ] Final 接收两场 SF 胜者。
- [ ] 开启 Third Place 时接收两场 SF 败者。

## D. TV 1

- [ ] 每个 Active Category 分别显示 Done / Total。
- [ ] 每个 Active Category 分别显示 Queue。
- [ ] 有进行中比赛时显示 Live。
- [ ] Inactive Category 不出现在 Session Progress。
- [ ] On Deck `PREPARE FOR COURT N` 在电视上清楚可读。
- [ ] iPad 横屏一屏可看到 On Deck 与 6 Live Courts。
- [ ] 自动 On Deck 仍按 Court Category + Pool Routes。
- [ ] 人工 On Deck 可显示仍在比赛中的队伍。

## E. Admin

- [ ] 六场地中控保持 3 × 2。
- [ ] Court ACCESS 可限制 Category 和 Pool。
- [ ] Potential Court 可修改并同步到 TV 1。
- [ ] Category / Pool Tabs 正常。
- [ ] Pool 完整 Standing 正常。
- [ ] Score Corrections 位于页面最后。
- [ ] Score Corrections 默认按 Category 折叠。
- [ ] 修改 RR 分数后排名重算。
- [ ] 修改 Playoff 胜者后下游晋级重算。

## F. 正式上线

- [ ] Preview 验收完成后才 Merge PR。
- [ ] Vercel Production Deployment 状态为 `Ready`。
- [ ] 正式 `/api/health` 显示正确正式 slug。
- [ ] 正式 Admin 原 Categories / Pools / Teams / Scores / Courts / Queue 均存在。
- [ ] 已做一次无害保存并显示 `App state v8` / `Synced`。
- [ ] Supabase 已运行 `verify_v8_update.sql`。
- [ ] `app_state_version = 8`。
- [ ] 两台电视无需刷新即可收到 Realtime 更新。
- [ ] 需要新规则的既有三 Pool Category 已重新生成 Playoff。
- [ ] 上线后再次导出正式 JSON。
- [ ] 确认无误后已运行 `remove_v8_preview_event.sql`。
