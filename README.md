# Wulin Tournament Control · Supabase + Vercel v8

正式云端版，面向 6 场地年度赛。公开端分为两台电视，工作人员在 Admin 中实时排场、录分、调整 On Deck、设置 Active Categories / Court Routes，并通过 Supabase Realtime 同步到全部设备。

## 页面入口

```text
?view=operations  TV 1：Live Courts + On Deck + Active Category progress
?view=results     TV 2：Standings + Visual Playoff Bracket
?view=schedule    Full Schedule
?view=admin       Staff Admin
```

## v8 重点

- 三个 Pool、每 Pool 前两名出线时，自动产生跨 Pool 的 6 个 Seeds；
- 跨 Pool 自动排名：Win Points → 同 Pool Head-to-Head → Point Difference → Points For；
- Seed 1 / Seed 2 首轮 BYE；QF 为 Seed 3 vs 6、Seed 4 vs 5；
- SF1：Seed 1 vs Winner(Seed 4 vs 5)；SF2：Seed 2 vs Winner(Seed 3 vs 6)；
- Admin 显示完整跨 Pool Seed Table，并允许 Move Up / Move Down 手动调整；
- TV 1 顶部按每个 Active Category 显示 Done / Total、Queue、Live；
- On Deck 的 Expected Court 字样放大；
- Score Corrections 移到 Admin 最后，并按 Category 折叠；
- 保留 v7 的双 Pool A1 vs B2 / A2 vs B1、H2H 排名、图形化 Bracket、Court Category + Pool Routes、Potential Court 等功能。

## 更新已有部署

先阅读：

```text
QUICK_UPDATE_V8_ZH.md
UPDATE_EXISTING_DEPLOYMENT_ZH.md
RELEASE_CHECKLIST_V8_ZH.md
```

现有 Supabase 项目不需要重新建表，也不要重新运行完整 `supabase/schema.sql`。v8 新增字段继续存放在原来的 `public.tournaments.state` JSONB 中。

## 全新部署

阅读：

```text
DEPLOY_ZH.md
```

只有新建 Supabase Project 时才运行：

```text
supabase/schema.sql
```

## 安全结构

- 浏览器只包含 Supabase URL 与 publishable key；
- 公开页面通过 RLS 只读赛事；
- 后台写入经 Vercel `/api/state`；
- Supabase secret key 只存在 Vercel Server Function；
- Staff PIN 存在 Vercel `ADMIN_PIN`；
- Session 使用签名 HttpOnly Cookie；
- 多设备写入使用 optimistic version lock；
- Supabase 保留最近 250 个完整 state snapshots。

## 自动测试

```bash
npm install
npm test
npm run build
```

测试覆盖登录安全、状态验证、Pool H2H、双 Pool 交叉半决赛、三 Pool 六种子排名、手动 Seed 顺序、Court Pool Routes、自动 On Deck，以及忙碌队伍的人工 On Deck。
