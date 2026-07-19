# 武林年度赛 · Supabase + Vercel 实时版

这是从离线 localStorage 版本升级而来的正式云端版本。

- **Vercel**：部署 Vite 前端和受保护的 Serverless API。
- **Supabase**：保存唯一共享赛程状态、历史快照，并通过 Realtime 推送到大屏和观众设备。
- **公开页面**：匿名只读，可查看 Dashboard、完整赛程、RR 排名、Playoff 结果和颁奖名次。
- **工作人员后台**：输入 PIN 后获得 HttpOnly Cookie；所有写入通过 Vercel API，Supabase secret key 不会进入浏览器。
- **并发保护**：每次保存使用数据库版本号进行乐观锁；两台后台同时修改时不会静默覆盖。

详细部署说明见：[`DEPLOY_ZH.md`](./DEPLOY_ZH.md)  
架构与安全边界见：[`ARCHITECTURE.md`](./ARCHITECTURE.md)

## 本地目录

```text
api/                         Vercel Functions：登录、会话、保存状态
server/                      服务器端安全、Session、Supabase 管理客户端
src/app.js                   比赛管理前端逻辑
src/styles.css               武林风格界面
public/assets/               Logo、合作方和二维码素材
supabase/schema.sql          数据库、RLS、Realtime、保存 RPC
supabase/verify.sql          部署后检查
supabase/restore-example.sql 历史版本紧急恢复模板
tests/                       服务器端安全和数据结构测试
```

## 主要功能

- 6 个或更多场地的当前比赛展示与后台计分。
- Cat 可自由分配场地，只运行当天当前时段选择的 Cat。
- 后台人工指定、置顶、调整或暂缓下一批 2–3 组准备队伍。
- Round Robin 自动排程、积分、净胜分、排名与出线人数控制。
- Cat、Pool、队伍名称随时修改。
- 已完成 RR / Playoff 比分可修正，并重新计算晋级关系。
- 多 Pool Playoff。
- 可选择生成三四名赛；不打时按两名半决赛败方的输球分差判季军。
- Dashboard 显示 Playoff 每场结果、冠军、亚军、季军和第四名。
- JSON 导入/导出备份。
- 多设备实时同步和冲突保护。

## 快速命令

```bash
npm install
npm run dev       # 使用 Vercel CLI，同时启动前端和 /api Functions
npm test
npm run build
```

本项目没有包含任何真实 Supabase key、工作人员 PIN 或 Session secret。
