import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_PUBLISHABLE_KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
const EVENT_SLUG = String(import.meta.env.VITE_EVENT_SLUG || "wulin-annual-2026").trim();
const CACHE_KEY = `wulin_cloud_cache_${EVENT_SLUG}`;
const CONFLICT_KEY = `wulin_cloud_conflict_${EVENT_SLUG}`;
const LOGO_DATA = "/assets/Logo_New.jpg";
const WECHAT_QR = "/assets/wechat_QR_only.png";
const COMMUNITY_QR = "/assets/Community_QRonly.png";

const supabase = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
      realtime: { params: { eventsPerSecond: 10 } }
    })
  : null;

const cachedEnvelope = readCachedEnvelope();
let state = cachedEnvelope?.state ? normalizeState(cachedEnvelope.state) : createEmptyState();
let cloudVersion = Number(cachedEnvelope?.version || 0);
let cloudReady = false;
let cloudSaving = false;
let pendingSave = Boolean(cachedEnvelope?.pending);
let saveTimer = null;
let mutationCounter = 0;
let realtimeChannel = null;
let queuedRemoteRecord = null;
let currentView = ["dashboard","schedule","admin"].includes(new URLSearchParams(location.search).get("view"))
  ? new URLSearchParams(location.search).get("view")
  : "dashboard";
let adminUnlocked = false;
let scheduleFilters = { catId: "all", status: "all" };
let adminCatFilter = "all";
let toastTimer = null;

const $ = (id) => document.getElementById(id);

function uid(prefix){
  if (window.crypto && crypto.randomUUID) return prefix + "_" + crypto.randomUUID().slice(0,8);
  return prefix + "_" + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
}

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function normalizeState(raw){
  const base = createEmptyState();
  if (!raw || typeof raw !== "object") return base;
  raw.settings = Object.assign(base.settings, raw.settings || {});
  raw.settings.courts = Array.isArray(raw.settings.courts) && raw.settings.courts.length ? raw.settings.courts : base.settings.courts;
  raw.settings.dashboardCatIds = Array.isArray(raw.settings.dashboardCatIds) ? raw.settings.dashboardCatIds : [];
  raw.settings.prepareMatchIds = Array.isArray(raw.settings.prepareMatchIds) ? raw.settings.prepareMatchIds : [];
  raw.categories = Array.isArray(raw.categories) ? raw.categories : [];
  raw.matches = Array.isArray(raw.matches) ? raw.matches : [];
  raw.categories.forEach(cat => {
    cat.id = cat.id || uid("cat");
    cat.name = cat.name || "未命名 Cat";
    cat.status = cat.status || "rr";
    cat.playoffThirdPlace = ["bronze","margin"].includes(cat.playoffThirdPlace) ? cat.playoffThirdPlace : "margin";
    cat.courtIds = Array.isArray(cat.courtIds) ? cat.courtIds : [];
    cat.pools = Array.isArray(cat.pools) ? cat.pools : [];
    cat.pools.forEach((pool, idx) => {
      pool.id = pool.id || uid("pool");
      pool.name = pool.name || `Pool ${String.fromCharCode(65+idx)}`;
      pool.advance = Number.isFinite(Number(pool.advance)) ? Number(pool.advance) : 2;
      pool.teams = Array.isArray(pool.teams) ? pool.teams : [];
      pool.teams.forEach((team, tIdx) => {
        if (typeof team === "string") {
          pool.teams[tIdx] = { id: uid("team"), name: team };
        } else {
          team.id = team.id || uid("team");
          team.name = team.name || "未命名队伍";
        }
      });
    });
  });
  raw.matches.forEach((m, idx) => {
    m.id = m.id || uid("match");
    m.status = m.status || "queued";
    m.hold = !!m.hold;
    m.sequence = Number.isFinite(Number(m.sequence)) ? Number(m.sequence) : idx + 1;
  });
  return raw;
}

function createEmptyState(){
  return {
    version: 4,
    settings: {
      eventName: "武林年度赛 Tournament Control",
      autoNext: true,
      dashboardCatIds: [],
      prepareMatchIds: [],
      courts: Array.from({length:6}, (_, i) => ({ id: "court" + (i+1), name: "Court " + (i+1) }))
    },
    categories: [],
    matches: []
  };
}

function readCachedEnvelope(){
  try{
    const text = localStorage.getItem(CACHE_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (parsed && parsed.state) return parsed;
    return null;
  }catch(err){
    console.warn("Unable to read local cloud cache", err);
    return null;
  }
}

function deepClone(value){
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function cacheState(snapshot = state, version = cloudVersion){
  try{
    localStorage.setItem(CACHE_KEY, JSON.stringify({ state:snapshot, version, pending:pendingSave, cachedAt:Date.now() }));
  }catch(err){
    console.warn("Unable to cache tournament state", err);
  }
}

function updateCloudStatus(kind, text){
  const el = $("cloudStatus");
  const label = $("cloudStatusText");
  if (!el || !label) return;
  el.className = `cloud-status ${kind || "loading"}`;
  label.textContent = text || "连接云端";
  el.title = `Event: ${EVENT_SLUG} · Cloud version: ${cloudVersion || "-"}`;
}

function saveState(){
  if (state && state.settings && Array.isArray(state.settings.prepareMatchIds)) cleanPrepareMatchIds();
  mutationCounter += 1;
  pendingSave = true;
  cacheState();
  updateCloudStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? "待同步" : "离线待同步");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flushCloudSave(); }, 650);
}

async function fetchCloudRecord(){
  if (!supabase) throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
  const { data, error } = await supabase
    .from("tournaments")
    .select("slug,state,version,updated_at,is_public")
    .eq("slug", EVENT_SLUG)
    .eq("is_public", true)
    .single();
  if (error) throw error;
  return data;
}

function applyRemoteRecord(record, force = false){
  if (!record || !record.state) return;
  const incomingVersion = Number(record.version || 0);
  if (!force && incomingVersion <= cloudVersion) return;
  if (!force && (cloudSaving || pendingSave)){
    queuedRemoteRecord = record;
    return;
  }
  state = normalizeState(deepClone(record.state));
  cloudVersion = incomingVersion;
  cloudReady = true;
  cacheState();
  renderAll();
  updateCloudStatus("live", `实时同步 · v${cloudVersion}`);
}

async function initializeCloud(force = false){
  if (!supabase){
    cloudReady = false;
    updateCloudStatus("error", "缺少 Supabase 配置");
    renderAll();
    return false;
  }
  updateCloudStatus("loading", force ? "重新连接" : "连接云端");
  try{
    const record = await fetchCloudRecord();
    const incomingVersion = Number(record.version || 0);

    // Preserve offline/local edits when reconnecting. If the server has not
    // changed, keep the local pending state and save it against the known
    // version. If another staff device changed the server, stop and surface a
    // conflict rather than overwriting either side.
    if (pendingSave){
      cloudReady = true;
      if (incomingVersion === cloudVersion){
        subscribeRealtime();
        renderAll();
        updateCloudStatus("pending", "已重连 · 待同步");
        return true;
      }
      try{
        localStorage.setItem(CONFLICT_KEY, JSON.stringify({
          attemptedState:state,
          attemptedAt:new Date().toISOString(),
          expectedVersion:cloudVersion,
          serverVersion:incomingVersion
        }));
      }catch(err){ console.warn(err); }
      state = normalizeState(deepClone(record.state));
      cloudVersion = incomingVersion;
      pendingSave = false;
      queuedRemoteRecord = null;
      cacheState();
      subscribeRealtime();
      renderAll();
      updateCloudStatus("conflict", "离线修改冲突");
      showToast("离线期间云端已被另一台后台更新。系统没有覆盖云端；已保留本地冲突备份并加载最新版。");
      return true;
    }

    applyRemoteRecord(record, true);
    subscribeRealtime();
    return true;
  }catch(err){
    console.error("Cloud load failed", err);
    cloudReady = false;
    updateCloudStatus("offline", cachedEnvelope?.state ? "云端不可用 · 显示缓存" : "云端连接失败");
    renderAll();
    return false;
  }
}

function subscribeRealtime(){
  if (!supabase) return;
  if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel(`tournament-${EVENT_SLUG}`)
    .on("postgres_changes", {
      event:"UPDATE",
      schema:"public",
      table:"tournaments",
      filter:`slug=eq.${EVENT_SLUG}`
    }, (payload) => {
      applyRemoteRecord(payload.new, false);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && !cloudSaving && !pendingSave){
        updateCloudStatus("live", `实时同步 · v${cloudVersion}`);
      } else if (["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status)){
        updateCloudStatus("offline", "Realtime 重连中");
      }
    });
}

async function flushCloudSave(keepalive = false){
  clearTimeout(saveTimer);
  if (!pendingSave || cloudSaving || !adminUnlocked) return;
  if (!navigator.onLine){
    updateCloudStatus("offline", "离线待同步");
    return;
  }
  if (!cloudReady){
    const connected = await initializeCloud(true);
    if (!connected) return;
  }

  const saveCounter = mutationCounter;
  const snapshot = deepClone(state);
  const expectedVersion = cloudVersion;
  cloudSaving = true;
  updateCloudStatus("saving", "保存中");

  try{
    const response = await fetch("/api/state", {
      method:"POST",
      credentials:"include",
      keepalive,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ slug:EVENT_SLUG, expectedVersion, state:snapshot })
    });
    const result = await response.json().catch(() => ({}));

    if (response.status === 401){
      adminUnlocked = false;
      pendingSave = true;
      renderAll();
      updateCloudStatus("error", "后台登录已过期");
      showToast("后台登录已过期。请重新输入工作人员密码后再同步。");
      return;
    }

    if (response.status === 409){
      try{
        localStorage.setItem(CONFLICT_KEY, JSON.stringify({
          attemptedState:state,
          attemptedAt:new Date().toISOString(),
          expectedVersion,
          serverVersion:Number(result.version || 0)
        }));
      }catch(err){ console.warn(err); }
      pendingSave = false;
      queuedRemoteRecord = null;
      if (result.state){
        state = normalizeState(deepClone(result.state));
        cloudVersion = Number(result.version || cloudVersion);
        cloudReady = true;
        cacheState();
        renderAll();
      }
      updateCloudStatus("conflict", "多人修改冲突");
      showToast("检测到另一台后台同时更新。系统没有覆盖云端；已加载最新版并保留本地冲突备份，请重新执行刚才操作。");
      return;
    }

    if (!response.ok) throw new Error(result.error || `Save failed (${response.status})`);

    cloudVersion = Number(result.version || (expectedVersion + 1));
    cloudReady = true;
    queuedRemoteRecord = null;
    pendingSave = mutationCounter !== saveCounter;
    cacheState();
    updateCloudStatus(pendingSave ? "pending" : "live", pendingSave ? "仍有变更待同步" : `实时同步 · v${cloudVersion}`);
    if (pendingSave){
      saveTimer = setTimeout(() => { void flushCloudSave(); }, 250);
    }
  }catch(err){
    console.error("Cloud save failed", err);
    pendingSave = true;
    updateCloudStatus("offline", "保存失败 · 待重试");
    if (navigator.onLine) saveTimer = setTimeout(() => { void flushCloudSave(); }, 3500);
  }finally{
    cloudSaving = false;
    if (!pendingSave && queuedRemoteRecord){
      const queued = queuedRemoteRecord;
      queuedRemoteRecord = null;
      applyRemoteRecord(queued, false);
    }
  }
}

async function checkAdminSession(){
  try{
    const response = await fetch("/api/session", { credentials:"include", cache:"no-store" });
    const result = await response.json().catch(() => ({}));
    adminUnlocked = response.ok && result.authenticated === true;
  }catch(err){
    adminUnlocked = false;
  }
  renderAll();
  return adminUnlocked;
}

async function loginAdmin(pin){
  const response = await fetch("/api/login", {
    method:"POST",
    credentials:"include",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ pin:String(pin || ""), slug:EVENT_SLUG })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "密码不正确");
  adminUnlocked = true;
  renderAll();
  return true;
}

async function logoutAdmin(){
  try{
    await fetch("/api/logout", { method:"POST", credentials:"include" });
  }catch(err){ console.warn(err); }
  adminUnlocked = false;
  renderAll();
}

function seedState(){
  const s = createEmptyState();
  addCategoryToState(s, "Adult Doubles A", [
    { name:"Pool A", teams:["李雷 / Han","Ming / Chen","Gold Coast Team 1","Peter / Sam"] },
    { name:"Pool B", teams:["Wulin Tigers","Alice / Emma","Dragon Smash","Kevin / Leo"] }
  ], 2);
  addCategoryToState(s, "Youth Singles B", [
    { name:"Pool A", teams:["小宇","Ethan","Lucas","Noah","Ryan"] }
  ], 2);
  s.categories[0].courtIds = ["court1","court2","court3"];
  s.categories[1].courtIds = ["court4","court5"];
  s.settings.dashboardCatIds = s.categories.map(c => c.id);
  s.categories.forEach(cat => generateRoundRobinForCat(s, cat.id, true));
  return s;
}

function addCategoryToState(targetState, name, poolDefs, defaultAdvance){
  const cat = {
    id: uid("cat"),
    name: name.trim() || "未命名 Cat",
    status: "rr",
    playoffThirdPlace: "margin",
    courtIds: [],
    pools: poolDefs.map((p, idx) => ({
      id: uid("pool"),
      name: p.name || `Pool ${String.fromCharCode(65+idx)}`,
      advance: Number(defaultAdvance || p.advance || 2),
      teams: (p.teams || []).filter(Boolean).map(t => ({ id: uid("team"), name: String(t).trim() }))
    }))
  };
  targetState.categories.push(cat);
  return cat;
}

function startClock(){
  const tick = () => {
    const d = new Date();
    const time = d.toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"});
    const date = d.toLocaleDateString("zh-CN", {weekday:"short", month:"short", day:"numeric"});
    $("clock").innerHTML = `${time}<small>${date}</small>`;
  };
  tick();
  setInterval(tick, 10000);
}

function showToast(msg){
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function getCat(catId){ return state.categories.find(c => c.id === catId); }
function getMatch(matchId){ return state.matches.find(m => m.id === matchId); }
function getCourt(courtId){ return state.settings.courts.find(c => c.id === courtId); }
function getPool(catId, poolId){
  const cat = getCat(catId);
  return cat ? cat.pools.find(p => p.id === poolId) : null;
}
function getTeam(teamId){
  if (!teamId || teamId === "BYE") return null;
  for (const cat of state.categories){
    for (const pool of cat.pools){
      const team = pool.teams.find(t => t.id === teamId);
      if (team) return Object.assign({catId: cat.id, poolId: pool.id}, team);
    }
  }
  return null;
}
function teamName(teamId){
  if (teamId === "BYE") return "BYE";
  const team = getTeam(teamId);
  return team ? team.name : (teamId ? "队伍已删除" : "待定");
}
function matchCode(m){
  const idx = state.matches.filter(x => x.catId === m.catId && x.stage === m.stage).findIndex(x => x.id === m.id) + 1;
  return (m.stage || "M") + "-" + idx;
}
function stageName(stage){
  const map = { RR:"Round Robin", R32:"Round of 32", R16:"Round of 16", QF:"Quarterfinal", SF:"Semifinal", F:"Final", BR:"Third Place" };
  return map[stage] || stage || "Match";
}
function statusLabel(status){
  const map = { queued:"待安排", playing:"进行中", done:"已完成", waiting:"等胜者" };
  return map[status] || status;
}
function statusClass(status){ return "status-" + (status || "queued"); }

function matchTeamsHtml(m, compact=false){
  const left = sideDisplay(m, "A");
  const right = sideDisplay(m, "B");
  return `<div class="match-teams ${compact ? "compact" : ""}">
    <div class="team-box">${escapeHtml(left)}</div>
    <div class="vs">VS</div>
    <div class="team-box">${escapeHtml(right)}</div>
  </div>`;
}

function sideDisplay(m, side){
  const key = side === "A" ? "teamAId" : "teamBId";
  const fromKey = side === "A" ? "teamAFrom" : "teamBFrom";
  const fromTypeKey = side === "A" ? "teamAFromType" : "teamBFromType";
  if (m[key]) return teamName(m[key]);
  if (m[fromKey]) {
    const source = state.matches.find(x => x.id === m[fromKey]);
    const label = m[fromTypeKey] === "loser" ? "败者" : "胜者";
    return source ? `${label} ${matchCode(source)}` : `${label}待定`;
  }
  return "待定";
}

function currentPlayingByCourt(courtId){
  return state.matches.find(m => m.status === "playing" && m.courtId === courtId);
}
function playingTeamIds(){
  const ids = new Set();
  state.matches.filter(m => m.status === "playing").forEach(m => {
    if (m.teamAId && m.teamAId !== "BYE") ids.add(m.teamAId);
    if (m.teamBId && m.teamBId !== "BYE") ids.add(m.teamBId);
  });
  return ids;
}
function isMatchReady(m){
  return m.status === "queued" && !m.hold && !!m.teamAId && !!m.teamBId && m.teamAId !== "BYE" && m.teamBId !== "BYE";
}
function courtCanRunCat(courtId, catId){
  const cat = getCat(catId);
  return !!cat && cat.courtIds.includes(courtId);
}
function emptyCourts(){
  return state.settings.courts.filter(c => !currentPlayingByCourt(c.id));
}
function eligibleMatchesForCourt(courtId, catFilter="all"){
  const busy = playingTeamIds();
  return state.matches
    .filter(m => isMatchReady(m))
    .filter(m => catFilter === "all" || m.catId === catFilter)
    .filter(m => courtCanRunCat(courtId, m.catId))
    .filter(m => !busy.has(m.teamAId) && !busy.has(m.teamBId))
    .sort(sortByPriorityThenMatches);
}
function eligibleCourtsForMatch(m){
  if (!isMatchReady(m)) return [];
  const busy = playingTeamIds();
  if (busy.has(m.teamAId) || busy.has(m.teamBId)) return [];
  const cat = getCat(m.catId);
  if (!cat) return [];
  return emptyCourts().filter(c => cat.courtIds.includes(c.id));
}
function sortMatches(a,b){
  const catA = state.categories.findIndex(c => c.id === a.catId);
  const catB = state.categories.findIndex(c => c.id === b.catId);
  if (a.status !== b.status) return String(a.status).localeCompare(String(b.status));
  if ((a.sequence || 0) !== (b.sequence || 0)) return (a.sequence || 0) - (b.sequence || 0);
  if (catA !== catB) return catA - catB;
  return String(a.id).localeCompare(String(b.id));
}

function preparePriority(matchId){
  const ids = state.settings.prepareMatchIds || [];
  const idx = ids.indexOf(matchId);
  return idx === -1 ? 9999 : idx;
}

function sortByPriorityThenMatches(a,b){
  const pa = preparePriority(a.id);
  const pb = preparePriority(b.id);
  if (pa !== pb) return pa - pb;
  return sortMatches(a,b);
}

function cleanPrepareMatchIds(){
  const seen = new Set();
  state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    const m = getMatch(id);
    return !!m && isMatchReady(m);
  }).slice(0, 12);
}

function setPrepareMatch(matchId, toTop=false){
  const m = getMatch(matchId);
  if (!m || !isMatchReady(m)) return false;
  cleanPrepareMatchIds();
  state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => id !== matchId);
  if (toTop) state.settings.prepareMatchIds.unshift(matchId);
  else state.settings.prepareMatchIds.push(matchId);
  state.settings.prepareMatchIds = state.settings.prepareMatchIds.slice(0, 12);
  return true;
}

function removePrepareMatch(matchId){
  state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => id !== matchId);
}

function movePrepareMatch(matchId, delta){
  cleanPrepareMatchIds();
  const ids = state.settings.prepareMatchIds || [];
  const idx = ids.indexOf(matchId);
  if (idx < 0) return;
  const next = Math.max(0, Math.min(ids.length - 1, idx + delta));
  const [item] = ids.splice(idx, 1);
  ids.splice(next, 0, item);
}

function getDashboardCatIds(){
  const activeCats = state.categories
    .filter(cat => cat.courtIds.length || state.matches.some(m => m.catId === cat.id && ["playing","queued","waiting"].includes(m.status)))
    .map(c => c.id);
  const selected = state.settings.dashboardCatIds.filter(id => activeCats.includes(id));
  return selected.length ? selected : activeCats;
}

function nextPrepareMatches(limit=3){
  cleanPrepareMatchIds();
  const catIds = new Set(getDashboardCatIds());
  const busy = playingTeamIds();
  const manual = (state.settings.prepareMatchIds || [])
    .map(id => getMatch(id))
    .filter(Boolean)
    .filter(m => isMatchReady(m))
    .filter(m => !busy.has(m.teamAId) && !busy.has(m.teamBId));
  const manualIds = new Set(manual.map(m => m.id));
  const auto = state.matches
    .filter(m => isMatchReady(m) && catIds.has(m.catId) && !manualIds.has(m.id))
    .filter(m => !busy.has(m.teamAId) && !busy.has(m.teamBId))
    .sort(sortMatches);
  return manual.concat(auto).slice(0, limit);
}

function renderAll(){
  $("eventTitle").textContent = state.settings.eventName || "武林年度赛 Tournament Control";
  document.body.classList.toggle("dashboard-mode", currentView === "dashboard");
  document.querySelectorAll(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === currentView));
  document.querySelectorAll(".view").forEach(el => el.classList.remove("active"));
  $("view-" + currentView).classList.add("active");
  renderDashboard();
  renderSchedule();
  renderAdmin();
}

function renderDashboard(){
  const catIds = getDashboardCatIds();
  const activeCats = state.categories.filter(cat => cat.courtIds.length || state.matches.some(m => m.catId === cat.id && ["playing","queued","waiting"].includes(m.status)));
  const playing = state.matches.filter(m => m.status === "playing");
  const done = state.matches.filter(m => m.status === "done").length;
  const total = state.matches.length;
  const queued = state.matches.filter(m => m.status === "queued").length;
  const prepare = nextPrepareMatches(3);

  $("view-dashboard").innerHTML = `
    <div class="dashboard-head">
      <section class="panel hero">
        <div>
          <h2>${escapeHtml(state.settings.eventName || "武林年度赛")}</h2>
          <p>大屏给参赛者和义工看：现在谁在打、下一批谁准备、当前 Round Robin 排名和积分。</p>
          <div class="hero-stat">
            <div class="stat-card"><b>${playing.length}</b><span>进行中场次</span></div>
            <div class="stat-card"><b>${queued}</b><span>待安排场次</span></div>
            <div class="stat-card"><b>${done}/${total || 0}</b><span>已完成 / 总场次</span></div>
          </div>
        </div>
        <div class="no-print" style="align-self:flex-start;z-index:1">
          <span class="pill gold">LIVE</span>
        </div>
      </section>
      <section class="panel dash-controls no-print">
        <div class="panel-title">
          <h3>Dashboard 展示 Cat</h3>
          <span class="pill">${activeCats.length} 个可选</span>
        </div>
        <div class="chip-row">
          ${activeCats.length ? activeCats.map(cat => {
            const checked = catIds.includes(cat.id);
            return `<label class="cat-chip ${checked ? "active" : ""}">
              <input type="checkbox" data-action="dashboard-cat-toggle" value="${cat.id}" ${checked ? "checked" : ""} ${adminUnlocked ? "" : "disabled"}>
              ${escapeHtml(cat.name)}
            </label>`;
          }).join("") : `<div class="empty-state">还没有安排到场地的 Cat。</div>`}
        </div>
        <div class="hint">${adminUnlocked ? "工作人员模式：这里的选择会实时同步到所有大屏。" : "此处由工作人员后台统一控制；所有设备会实时看到同一组 Cat。"} 只列出已分配场地或有赛程活动的 Cat。</div>
      </section>
    </div>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-title">
          <h2>请准备 · Next 2-3 Teams</h2>
          <span class="pill gold">${prepare.length} 组</span>
        </div>
        <div class="prepare-list">
          ${prepare.length ? prepare.map((m, idx) => renderPrepareCard(m, idx)).join("") : `<div class="empty-state">目前没有可准备的下一场。可能所有比赛都在等场地、等胜者，或 Cat 尚未分配场地。</div>`}
        </div>
      </section>
      <section class="panel">
        <div class="panel-title">
          <h2>6 个场地正在进行</h2>
          <span class="pill">${playing.length}/${state.settings.courts.length} 使用中</span>
        </div>
        <div class="courts-grid">
          ${state.settings.courts.map(c => renderCourtCard(c, false)).join("")}
        </div>
      </section>
    </div>

    <section>
      <div class="ranking-board">
        ${catIds.length ? catIds.map(catId => renderRankingCard(catId)).join("") : `<div class="panel"><div class="empty-state">选择 Cat 后显示 Round Robin 排名。</div></div>`}
      </div>
    </section>

    <section>
      <div class="playoff-board">
        ${catIds.length ? catIds.map(catId => renderPlayoffResultCard(catId)).filter(Boolean).join("") : ""}
      </div>
    </section>
  `;
}

function renderPrepareCard(m, idx){
  const cat = getCat(m.catId);
  const pool = getPool(m.catId, m.poolId);
  const courtNames = eligibleCourtsForMatch(m).map(c => c.name).join(" / ");
  const manual = (state.settings.prepareMatchIds || []).includes(m.id);
  return `<article class="prepare-card">
    <div class="num">0${idx+1}</div>
    <div>
      <span class="pill gold">${escapeHtml(cat?.name || "Cat")}</span>
      <span class="pill">${escapeHtml(stageName(m.stage))}${pool ? " · " + escapeHtml(pool.name) : ""}</span>
      ${manual ? `<span class="pill red">后台指定</span>` : `<span class="pill">自动顺序</span>`}
    </div>
    ${matchTeamsHtml(m)}
    <div class="subtle">Match ${escapeHtml(matchCode(m))} · 可用场地：${courtNames ? escapeHtml(courtNames) : "等待空场或后台分配场地"}</div>
  </article>`;
}

function renderCourtCard(court, admin){
  const m = currentPlayingByCourt(court.id);
  if (!m){
    const next = eligibleMatchesForCourt(court.id, adminCatFilter).at(0);
    return `<article class="court-card empty ${admin ? "admin-court" : ""}">
      <div class="court-top">
        <h3>${escapeHtml(court.name)}</h3>
        <span class="pill empty">空场</span>
      </div>
      ${next ? `
        <div class="subtle">下一场建议</div>
        <div style="margin-top:8px"><span class="pill">${escapeHtml(getCat(next.catId)?.name || "")}</span> <span class="pill">${escapeHtml(stageName(next.stage))}</span></div>
        ${matchTeamsHtml(next, true)}
        ${admin ? `<button class="success" data-action="assign-match" data-match-id="${next.id}" data-court-id="${court.id}">安排到此场</button>` : `<div class="subtle">请后台确认后上场</div>`}
      ` : `
        <div class="empty-state">没有可立即安排的比赛。后台可把此空场加入某个 Cat。</div>
      `}
    </article>`;
  }
  const cat = getCat(m.catId);
  const pool = getPool(m.catId, m.poolId);
  return `<article class="court-card playing ${admin ? "admin-court" : ""}">
    <div class="court-top">
      <h3>${escapeHtml(court.name)}</h3>
      <span class="pill green">进行中</span>
    </div>
    <div><span class="pill gold">${escapeHtml(cat?.name || "Cat")}</span> <span class="pill">${escapeHtml(stageName(m.stage))}${pool ? " · " + escapeHtml(pool.name) : ""}</span></div>
    ${matchTeamsHtml(m, true)}
    ${m.scoreA !== undefined && m.scoreA !== "" ? `<div class="court-score">${escapeHtml(m.scoreA)} : ${escapeHtml(m.scoreB)}</div>` : ""}
    ${admin ? `
      <div class="score-input-row">
        <input id="scoreA_${m.id}" inputmode="numeric" placeholder="左队分" value="${escapeHtml(m.scoreA ?? "")}">
        <input id="scoreB_${m.id}" inputmode="numeric" placeholder="右队分" value="${escapeHtml(m.scoreB ?? "")}">
      </div>
      <div class="queue-row-actions">
        <button class="success" data-action="finish-match" data-match-id="${m.id}">完成并排下一场</button>
        <button class="ghost" data-action="return-queue" data-match-id="${m.id}">退回队列</button>
      </div>
    ` : `<div class="subtle">Match ${escapeHtml(matchCode(m))}</div>`}
  </article>`;
}

function renderRankingCard(catId){
  const cat = getCat(catId);
  if (!cat) return "";
  return `<section class="panel rank-card">
    <div class="panel-title">
      <div>
        <h2>${escapeHtml(cat.name)}</h2>
        <div class="subtle">Round Robin 排名 · 胜=2分，负=0分；同分按净胜分、总得分排序</div>
      </div>
      <span class="pill ${cat.status === "playoff" ? "blue" : "gold"}">${cat.status === "playoff" ? "Playoff" : "RR"}</span>
    </div>
    ${cat.pools.map(pool => {
      const rows = computeStandings(cat.id, pool.id);
      return `<div class="pool-rank">
        <table>
          <thead><tr><th colspan="8">${escapeHtml(pool.name)} · 出线 ${Number(pool.advance || 0)}</th></tr>
          <tr><th>#</th><th>队伍</th><th>场</th><th>胜</th><th>负</th><th>积分</th><th>净胜</th><th>得分</th></tr></thead>
          <tbody>
            ${rows.map((r, idx) => `<tr class="${idx < Number(pool.advance || 0) ? "qualifier" : ""}">
              <td>${idx+1}</td><td><strong>${escapeHtml(r.name)}</strong></td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.points}</td><td>${r.diff}</td><td>${r.for}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    }).join("")}
  </section>`;
}


function playoffMatchesForCat(catId){
  return state.matches
    .filter(m => m.catId === catId && m.stage !== "RR")
    .slice()
    .sort((a,b) => (a.round || 0) - (b.round || 0) || (a.bracketIndex || 0) - (b.bracketIndex || 0) || sortMatches(a,b));
}

function loserIdOf(m){
  if (!m || m.status !== "done" || !m.winnerId) return "";
  const loserId = m.teamAId === m.winnerId ? (m.teamBId || "") : (m.teamBId === m.winnerId ? (m.teamAId || "") : "");
  return loserId && loserId !== "BYE" ? loserId : "";
}

function semifinalLossInfo(m){
  if (!m || m.stage !== "SF" || m.status !== "done") return null;
  const loserId = loserIdOf(m);
  if (!loserId) return null;
  const a = Number(m.scoreA);
  const b = Number(m.scoreB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const loserScore = loserId === m.teamAId ? a : b;
  const winnerScore = loserId === m.teamAId ? b : a;
  return { match:m, loserId, loserName:teamName(loserId), margin:Math.abs(winnerScore - loserScore), loserScore, winnerScore };
}

function computeThirdBySemiMargin(catId){
  const infos = playoffMatchesForCat(catId)
    .filter(m => m.stage === "SF")
    .map(semifinalLossInfo)
    .filter(Boolean);
  if (infos.length < 2) return {status:"waiting", infos};
  infos.sort((a,b) => a.margin - b.margin || b.loserScore - a.loserScore || a.loserName.localeCompare(b.loserName, "zh-CN"));
  const tied = infos.length > 1 && infos[0].margin === infos[1].margin;
  if (tied) return {status:"tie", infos, tiedNames:infos.filter(x => x.margin === infos[0].margin).map(x => x.loserName)};
  return {status:"resolved", third:infos[0], fourth:infos[1], infos};
}

function thirdPlaceRuleLabel(cat){
  return cat?.playoffThirdPlace === "bronze" ? "生成三四名赛" : "不打三四名赛 · 按半决赛败方输球分差";
}

function computePodium(catId){
  const cat = getCat(catId);
  const matches = playoffMatchesForCat(catId);
  const final = matches.find(m => m.stage === "F");
  const bronze = matches.find(m => m.stage === "BR");
  const rows = [];
  if (final && final.status === "done" && final.winnerId){
    rows.push({label:"冠军", name:teamName(final.winnerId)});
    const runner = loserIdOf(final);
    if (runner) rows.push({label:"亚军", name:teamName(runner)});
  }
  if (bronze){
    if (bronze.status === "done" && bronze.winnerId){
      rows.push({label:"季军", name:teamName(bronze.winnerId)});
      const fourth = loserIdOf(bronze);
      if (fourth) rows.push({label:"第四名", name:teamName(fourth)});
    } else {
      rows.push({label:"季军赛", name:"等待三四名赛结果"});
    }
  } else if (cat?.playoffThirdPlace !== "bronze") {
    const decision = computeThirdBySemiMargin(catId);
    if (decision.status === "resolved"){
      rows.push({label:`季军（SF 输 ${decision.third.margin} 分）`, name:decision.third.loserName});
      rows.push({label:`第四名（SF 输 ${decision.fourth.margin} 分）`, name:decision.fourth.loserName});
    } else if (decision.status === "tie"){
      rows.push({label:"季军待确认", name:`半决赛败方分差相同：${decision.tiedNames.join(" / ")}`});
    }
  }
  return rows;
}

function playoffScoreText(m){
  const a = m.scoreA ?? "";
  const b = m.scoreB ?? "";
  if (a === "" && b === "") return "-";
  return `${a} : ${b}`;
}

function playoffSideHtml(m, side){
  const id = side === "A" ? m.teamAId : m.teamBId;
  const label = sideDisplay(m, side);
  const cls = m.status === "done" && m.winnerId && id
    ? (m.winnerId === id ? "winner-text" : "loser-text")
    : "";
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function renderPlayoffResultCard(catId){
  const cat = getCat(catId);
  if (!cat) return "";
  const matches = playoffMatchesForCat(catId);
  if (!matches.length) return "";
  const done = matches.filter(m => m.status === "done").length;
  const podium = computePodium(catId);
  return `<section class="panel rank-card">
    <div class="panel-title">
      <div>
        <h2>${escapeHtml(cat.name)} · Playoff 结果</h2>
        <div class="subtle">大屏会同步显示胜负、晋级和颁奖参考名次。季军规则：${escapeHtml(thirdPlaceRuleLabel(cat))}</div>
      </div>
      <span class="pill blue">${done}/${matches.length}</span>
    </div>
    <div class="playoff-summary">
      ${podium.length ? podium.map(p => `<span class="medal-card"><strong>${escapeHtml(p.label)}</strong>：${escapeHtml(p.name)}</span>`).join("") : `<span class="medal-card">Playoff 进行中 / 尚未决出名次</span>`}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>阶段</th><th>队伍</th><th>比分</th><th>胜者</th><th>状态</th></tr></thead>
        <tbody>
          ${matches.map(m => `<tr>
            <td>${escapeHtml(stageName(m.stage))}</td>
            <td>${playoffSideHtml(m,"A")} vs ${playoffSideHtml(m,"B")}</td>
            <td>${escapeHtml(playoffScoreText(m))}</td>
            <td>${m.winnerId ? `<span class="winner-text">${escapeHtml(teamName(m.winnerId))}</span>` : "-"}</td>
            <td class="${statusClass(m.status)}"><span class="status-dot"></span>${escapeHtml(statusLabel(m.status))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderSchedule(){
  const catOptions = [`<option value="all">全部 Cat</option>`].concat(state.categories.map(cat => `<option value="${cat.id}" ${scheduleFilters.catId === cat.id ? "selected" : ""}>${escapeHtml(cat.name)}</option>`)).join("");
  const rows = state.matches
    .slice()
    .sort(sortMatches)
    .filter(m => scheduleFilters.catId === "all" || m.catId === scheduleFilters.catId)
    .filter(m => scheduleFilters.status === "all" || m.status === scheduleFilters.status);
  $("view-schedule").innerHTML = `
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>完整赛程表</h2>
          <div class="subtle">包含每个 Cat 的 Round Robin 与 Playoff。后台完成比分后，这里会自动更新状态、场地和晋级。</div>
        </div>
        <div class="admin-actions no-print">
          <button class="ghost" data-action="print-page">打印 / 存 PDF</button>
        </div>
      </div>
      <div class="filters no-print">
        <div><label>Cat</label><select id="scheduleCatFilter" data-action="schedule-filter-cat">${catOptions}</select></div>
        <div><label>状态</label><select id="scheduleStatusFilter" data-action="schedule-filter-status">
          ${["all","queued","playing","waiting","done"].map(s => `<option value="${s}" ${scheduleFilters.status === s ? "selected" : ""}>${s === "all" ? "全部状态" : statusLabel(s)}</option>`).join("")}
        </select></div>
        <button class="ghost" data-action="export-json">导出数据</button>
      </div>
      <div style="height:14px"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Cat</th><th>阶段</th><th>Pool / Round</th><th>队伍</th><th>场地</th><th>状态</th><th>比分</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((m, idx) => renderScheduleRow(m, idx)).join("") : `<tr><td colspan="8"><div class="empty-state">没有符合筛选条件的比赛。</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderScheduleRow(m, idx){
  const cat = getCat(m.catId);
  const pool = getPool(m.catId, m.poolId);
  const court = getCourt(m.courtId);
  const score = m.status === "done" || m.status === "playing" ? `${m.scoreA ?? ""}${m.scoreA !== undefined && m.scoreA !== "" ? " : " : ""}${m.scoreB ?? ""}` : "";
  return `<tr>
    <td>${idx+1}</td>
    <td>${escapeHtml(cat?.name || "")}</td>
    <td>${escapeHtml(stageName(m.stage))}</td>
    <td>${pool ? escapeHtml(pool.name) + " · " : ""}${m.round ? "R" + escapeHtml(m.round) : ""}</td>
    <td><strong>${escapeHtml(sideDisplay(m, "A"))}</strong> vs <strong>${escapeHtml(sideDisplay(m, "B"))}</strong></td>
    <td>${court ? escapeHtml(court.name) : "-"}</td>
    <td class="${statusClass(m.status)}"><span class="status-dot"></span>${escapeHtml(statusLabel(m.status))}</td>
    <td>${escapeHtml(score)}</td>
  </tr>`;
}

function renderAdmin(){
  if (!adminUnlocked){
    $("view-admin").innerHTML = `
      <section class="admin-gate">
        <div class="panel login-card">
          <img src="${LOGO_DATA}" alt="Wulin">
          <h2>后台管理</h2>
          <p class="subtle">输入工作人员 PIN 后可以排场、录入比分、生成 Playoff、管理 Cat 和 Pool；所有修改会同步到 Supabase。</p>
          <div style="margin:18px 0 10px">
            <input id="adminPassword" type="password" inputmode="numeric" placeholder="后台密码">
          </div>
          <button class="primary" data-action="unlock-admin">打开后台</button>
          <p class="subtle" style="margin-top:12px">工作人员 PIN 由 Vercel 的 <span class="kbd">ADMIN_PIN</span> 环境变量设置，不会写进前端代码。</p><div class="cloud-note">当前后台会话由 Vercel Function 签发 HttpOnly Cookie。Supabase secret/service-role key 只存在服务器环境变量中。</div>
        </div>
      </section>`;
    return;
  }

  const catOptions = [`<option value="all">全部 Cat</option>`].concat(state.categories.map(cat => `<option value="${cat.id}" ${adminCatFilter === cat.id ? "selected" : ""}>${escapeHtml(cat.name)}</option>`)).join("");
  cleanPrepareMatchIds();
  const manualPrepare = (state.settings.prepareMatchIds || []).map(id => getMatch(id)).filter(Boolean);
  const queued = state.matches
    .slice()
    .sort(sortByPriorityThenMatches)
    .filter(m => isMatchReady(m))
    .filter(m => adminCatFilter === "all" || m.catId === adminCatFilter)
    .slice(0, 28);
  const held = state.matches
    .slice()
    .filter(m => m.status === "queued" && m.hold)
    .filter(m => adminCatFilter === "all" || m.catId === adminCatFilter)
    .sort(sortMatches)
    .slice(0, 18);
  const completed = state.matches
    .slice()
    .filter(m => m.status === "done" && m.teamAId !== "BYE" && m.teamBId !== "BYE")
    .filter(m => adminCatFilter === "all" || m.catId === adminCatFilter)
    .sort((a,b) => (Number(b.finishedAt || 0) - Number(a.finishedAt || 0)) || sortMatches(a,b))
    .slice(0, 40);

  $("view-admin").innerHTML = `
    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>后台排场与计分</h2>
          <div class="subtle">比分以队伍为单位输入。完成比赛后会自动更新积分、释放场地，并可自动安排下一场。</div><div class="cloud-note">云端版本 v${cloudVersion || "-"} · ${pendingSave ? "有变更待同步" : "已与 Supabase 同步"} · 多设备同时修改时会用版本锁避免静默覆盖。</div>
        </div>
        <div class="admin-actions">
          <button class="ghost" data-action="show-view" data-view="dashboard">返回大屏</button>
          <button class="danger" data-action="logout-admin">锁定后台</button>
        </div>
      </div>
      <div class="form-grid-3">
        <div>
          <label>赛事名称</label>
          <input id="eventNameInput" data-action="event-name-input" value="${escapeHtml(state.settings.eventName)}">
        </div>
        <div>
          <label>排场 Cat 筛选</label>
          <select id="adminCatFilter" data-action="admin-cat-filter">${catOptions}</select>
        </div>
        <div>
          <label>自动排下一场</label>
          <select id="autoNextSelect" data-action="auto-next">
            <option value="true" ${state.settings.autoNext ? "selected" : ""}>开启：完成后自动排同 Cat 下一场</option>
            <option value="false" ${!state.settings.autoNext ? "selected" : ""}>关闭：只释放场地</option>
          </select>
        </div>
      </div>
      <div class="admin-actions" style="margin-top:12px">
        <button class="success" data-action="fill-empty-courts">一键填满所有空场</button>
        <button class="ghost" data-action="export-json">导出备份 JSON</button>
        <button class="ghost" data-action="trigger-import">导入 JSON</button>
        <button class="warn" data-action="load-sample">载入示例数据</button>
        <button class="danger" data-action="clear-data">清空数据</button>
        <input id="importFile" type="file" accept="application/json" style="display:none">
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>6 个场地控制台</h2>
        <span class="pill">${state.matches.filter(m => m.status === "playing").length}/${state.settings.courts.length} 使用中</span>
      </div>
      <div class="admin-courts">
        ${state.settings.courts.map(c => renderCourtCard(c, true)).join("")}
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>Dashboard 下一批准备队伍</h2>
          <div class="subtle">人工指定的队伍会优先显示在大屏，也会优先被「一键填满空场 / 自动排下一场」安排。</div>
        </div>
        <div class="admin-actions">
          <span class="pill gold">大屏取前 3 组</span>
          <button class="ghost" data-action="clear-prepare-list">清空人工准备</button>
        </div>
      </div>
      <div class="priority-list">
        ${manualPrepare.length ? manualPrepare.map((m, idx) => renderPrepareControlRow(m, idx)).join("") : `<div class="empty-state">还没有人工指定。可在下方 Queue 点「加入准备」；如果少于 3 组，大屏会用自动顺序补齐。</div>`}
      </div>
      ${held.length ? `<div style="height:12px"></div><div class="panel-title"><h3>暂缓 / 找不到 / 时间冲突</h3><span class="pill red">${held.length}</span></div><div class="priority-list">${held.map(renderHeldRow).join("")}</div>` : ""}
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>待安排队伍 Queue</h2>
          <div class="subtle">只显示双方都已确定、且当前没有在其他场地比赛的队伍。可直接指定到大屏准备、置顶优先、或暂缓。</div>
        </div>
        <span class="pill">${queued.length} shown</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Cat</th><th>阶段</th><th>队伍</th><th>可安排场地</th></tr></thead>
          <tbody>
            ${queued.length ? queued.map((m, idx) => renderQueueRow(m, idx)).join("") : `<tr><td colspan="5"><div class="empty-state">没有可安排的下一场。可能在等 playoff 胜者、或 Cat 没有分配场地。</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>已完成比分修改</h2>
          <div class="subtle">用于修正输入错误；Round Robin 会立刻重算排名，Playoff 胜者变更时会清空下游已受影响场次。</div>
        </div>
        <span class="pill">最近 ${completed.length} 场</span>
      </div>
      <div>
        ${completed.length ? completed.map(renderCompletedScoreRow).join("") : `<div class="empty-state">当前筛选下还没有已完成比赛。</div>`}
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>Cat / Pool / Playoff 设置</h2>
          <div class="subtle">可以随时改 Cat 名称、Pool 名称和队伍名字；改名不会删除赛程或比分。</div>
        </div>
      </div>
      <div class="cat-list">
        ${state.categories.length ? state.categories.map(cat => renderCatCard(cat)).join("") : `<div class="empty-state">还没有 Cat。请在下方新增。</div>`}
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>新增 Cat</h2>
          <div class="subtle">队伍按行输入；多个 Pool 用空行分隔，每段第一行写 Pool 名称。</div>
        </div>
      </div>
      <div class="form-grid">
        <div>
          <label>Cat 名称</label>
          <input id="newCatName" placeholder="例如：Adult Doubles B">
        </div>
        <div>
          <label>每个 Pool 默认出线人数</label>
          <input id="newCatAdvance" type="number" min="1" value="2">
        </div>
      </div>
      <div style="height:10px"></div>
      <label>Pool 与队伍</label>
      <textarea id="newCatPools" spellcheck="false">Pool A
队伍 1 / 队伍 2
队伍 3 / 队伍 4
队伍 5 / 队伍 6

Pool B
队伍 7 / 队伍 8
队伍 9 / 队伍 10
队伍 11 / 队伍 12</textarea>
      <div class="admin-actions" style="margin-top:12px">
        <button class="primary" data-action="add-cat">新增 Cat 并生成 RR</button>
      </div>
      <div class="hint" style="margin-top:12px">格式示例：第一段是 Pool A，第二段是 Pool B。每一行就是一支队伍；本 app 会自动生成同 Pool 内的 round robin 赛程。</div>
    </section>

    <section class="panel">
      <div class="panel-title"><h2>场地名称</h2></div>
      <div class="form-grid-3">
        ${state.settings.courts.map(c => `<div><label>${escapeHtml(c.id)}</label><input data-action="court-name-input" data-court-id="${c.id}" value="${escapeHtml(c.name)}"></div>`).join("")}
      </div>
      <div class="qr-dock">
        <div class="subtle">可选展示二维码素材：</div>
        <img src="${WECHAT_QR}" alt="WeChat QR">
        <img src="${COMMUNITY_QR}" alt="Community QR">
      </div>
    </section>
  `;
}

function renderMatchMeta(m){
  const cat = getCat(m.catId);
  const pool = getPool(m.catId, m.poolId);
  return `${escapeHtml(cat?.name || "")} · ${escapeHtml(stageName(m.stage))}${pool ? " · " + escapeHtml(pool.name) : ""} · ${escapeHtml(matchCode(m))}`;
}

function renderPrepareControlRow(m, idx){
  return `<article class="priority-card">
    <div class="priority-topline">
      <div><span class="pill gold">#${idx+1}</span> <span class="pill">${renderMatchMeta(m)}</span></div>
      <div class="queue-row-actions">
        <button class="small ghost" data-action="prepare-up" data-match-id="${m.id}">上移</button>
        <button class="small ghost" data-action="prepare-down" data-match-id="${m.id}">下移</button>
        <button class="small danger" data-action="unprepare-match" data-match-id="${m.id}">移除</button>
      </div>
    </div>
    ${matchTeamsHtml(m, true)}
  </article>`;
}

function renderHeldRow(m){
  return `<article class="priority-card hold">
    <div class="priority-topline">
      <div><span class="pill red">暂缓</span> <span class="pill">${renderMatchMeta(m)}</span></div>
      <div class="queue-row-actions">
        <button class="small success" data-action="release-match" data-match-id="${m.id}">恢复到 Queue</button>
        <button class="small warn" data-action="release-and-top" data-match-id="${m.id}">恢复并置顶</button>
      </div>
    </div>
    ${matchTeamsHtml(m, true)}
  </article>`;
}

function renderCompletedScoreRow(m){
  const cat = getCat(m.catId);
  const pool = getPool(m.catId, m.poolId);
  const lockedAutoBye = m.scoreA === "W" || m.scoreB === "W";
  return `<div class="score-edit-row">
    <div>
      <strong>${escapeHtml(cat?.name || "")}</strong>
      <div class="subtle">${escapeHtml(stageName(m.stage))}${pool ? " · " + escapeHtml(pool.name) : ""} · ${escapeHtml(matchCode(m))}</div>
    </div>
    <div><strong>${escapeHtml(sideDisplay(m,"A"))}</strong> vs <strong>${escapeHtml(sideDisplay(m,"B"))}</strong></div>
    <div class="score-edit-inputs">
      <input id="editScoreA_${m.id}" inputmode="numeric" ${lockedAutoBye ? "disabled" : ""} value="${escapeHtml(m.scoreA ?? "")}">
      <input id="editScoreB_${m.id}" inputmode="numeric" ${lockedAutoBye ? "disabled" : ""} value="${escapeHtml(m.scoreB ?? "")}">
    </div>
    <div class="queue-row-actions">
      ${lockedAutoBye ? `<span class="pill">自动轮空</span>` : `<button class="small success" data-action="save-score-edit" data-match-id="${m.id}">保存修改</button>`}
    </div>
  </div>`;
}

function renderQueueRow(m, idx){
  const cat = getCat(m.catId);
  const pool = getPool(m.catId, m.poolId);
  const courts = eligibleCourtsForMatch(m);
  const busy = playingTeamIds();
  const blocked = busy.has(m.teamAId) || busy.has(m.teamBId);
  const prepared = (state.settings.prepareMatchIds || []).includes(m.id);
  return `<tr>
    <td>${idx+1}</td>
    <td>${escapeHtml(cat?.name || "")}</td>
    <td>${escapeHtml(stageName(m.stage))}${pool ? " · " + escapeHtml(pool.name) : ""}</td>
    <td><strong>${escapeHtml(sideDisplay(m,"A"))}</strong> vs <strong>${escapeHtml(sideDisplay(m,"B"))}</strong></td>
    <td>
      <div class="queue-row-actions">
        <button class="small warn" data-action="prepare-match" data-match-id="${m.id}">${prepared ? "已在准备" : "加入准备"}</button>
        <button class="small ghost" data-action="prepare-top" data-match-id="${m.id}">置顶</button>
        <button class="small danger" data-action="hold-match" data-match-id="${m.id}">暂缓</button>
        ${blocked ? `<span class="pill red">队伍正在比赛</span>` : courts.length ? courts.map(c => `<button class="small success" data-action="assign-match" data-match-id="${m.id}" data-court-id="${c.id}">${escapeHtml(c.name)}</button>`).join("") : `<span class="pill empty">无空场 / 未分配场地</span>`}
      </div>
    </td>
  </tr>`;
}

function renderCatCard(cat){
  const rrMatches = state.matches.filter(m => m.catId === cat.id && m.stage === "RR");
  const rrDone = rrMatches.filter(m => m.status === "done").length;
  const playoffMatches = state.matches.filter(m => m.catId === cat.id && m.stage !== "RR");
  const freeAddCourts = emptyCourts().filter(c => !cat.courtIds.includes(c.id));
  return `<article class="cat-card">
    <div class="panel-title">
      <div>
        <h3>${escapeHtml(cat.name)}</h3>
        <div class="subtle">RR ${rrDone}/${rrMatches.length} · Playoff ${playoffMatches.length} · ${escapeHtml(thirdPlaceRuleLabel(cat))}</div>
      </div>
      <span class="pill ${cat.status === "playoff" ? "blue" : "gold"}">${cat.status === "playoff" ? "Playoff" : "RR"}</span>
    </div>

    <div class="inline-edit-grid">
      <div>
        <label>Cat 名称（可随时修改）</label>
        <input class="compact-input" data-action="cat-name-input" data-cat-id="${cat.id}" value="${escapeHtml(cat.name)}">
      </div>
      <div>
        <label>当前状态</label>
        <input class="compact-input" value="${cat.status === "playoff" ? "Playoff" : "Round Robin"}" disabled>
      </div>
    </div>
    ${cat.pools.map(pool => `<div class="pool-rank" style="padding:10px">
      <div class="inline-edit-grid">
        <div>
          <label>Pool 名称</label>
          <input class="compact-input" data-action="pool-name-input" data-cat-id="${cat.id}" data-pool-id="${pool.id}" value="${escapeHtml(pool.name)}">
        </div>
        <div>
          <label>队伍数</label>
          <input class="compact-input" value="${pool.teams.length}" disabled>
        </div>
      </div>
      <div class="team-edit-grid">
        ${pool.teams.map((team, tIdx) => `<label class="team-edit-row"><span>队伍 ${tIdx+1}</span><input data-action="team-name-input" data-cat-id="${cat.id}" data-pool-id="${pool.id}" data-team-id="${team.id}" value="${escapeHtml(team.name)}"></label>`).join("")}
      </div>
    </div>`).join("")}

    <div class="subtle">分配场地</div>
    <div class="court-checks">
      ${state.settings.courts.map(c => `<label class="mini-check ${cat.courtIds.includes(c.id) ? "active" : ""}">
        <input type="checkbox" data-action="cat-court-toggle" data-cat-id="${cat.id}" value="${c.id}" ${cat.courtIds.includes(c.id) ? "checked" : ""}>
        ${escapeHtml(c.name)}
      </label>`).join("")}
    </div>

    <div class="subtle">空场快速加入此 Cat</div>
    <div class="court-checks">
      ${freeAddCourts.length ? freeAddCourts.map(c => `<button class="small ghost" data-action="add-court-to-cat" data-cat-id="${cat.id}" data-court-id="${c.id}">+ ${escapeHtml(c.name)}</button>`).join("") : `<span class="pill">暂无空场</span>`}
    </div>

    <div class="subtle">Pool 出线人数</div>
    <div class="pool-controls">
      ${cat.pools.map(pool => `<label class="mini-check active">${escapeHtml(pool.name)} <input class="advance-input" type="number" min="1" max="${Math.max(1, pool.teams.length)}" data-action="pool-advance-input" data-cat-id="${cat.id}" data-pool-id="${pool.id}" value="${Number(pool.advance || 0)}"></label>`).join("")}
    </div>

    <div class="inline-edit-grid" style="margin-top:12px">
      <div>
        <label>季军规则 / 三四名赛</label>
        <select class="compact-input" data-action="cat-thirdplace-input" data-cat-id="${cat.id}">
          <option value="margin" ${cat.playoffThirdPlace !== "bronze" ? "selected" : ""}>不打三四名赛：按半决赛败方输球分差判季军</option>
          <option value="bronze" ${cat.playoffThirdPlace === "bronze" ? "selected" : ""}>生成三四名赛：胜者为季军</option>
        </select>
      </div>
      <div>
        <label>说明</label>
        <input class="compact-input" value="生成 Playoff 前选择；重新生成会覆盖旧 Playoff" disabled>
      </div>
    </div>

    <div class="admin-actions">
      <button class="ghost" data-action="generate-rr" data-cat-id="${cat.id}">重新生成 RR</button>
      <button class="primary" data-action="generate-playoff" data-cat-id="${cat.id}">生成 Playoff</button>
      <button class="danger" data-action="delete-cat" data-cat-id="${cat.id}">删除 Cat</button>
    </div>

    <div style="margin-top:12px">
      ${cat.pools.map(pool => {
        const rows = computeStandings(cat.id, pool.id).slice(0, Math.max(3, Number(pool.advance || 0)));
        return `<div class="pool-rank">
          <table>
            <thead><tr><th colspan="5">${escapeHtml(pool.name)} 当前排名</th></tr><tr><th>#</th><th>队伍</th><th>场</th><th>积分</th><th>净胜</th></tr></thead>
            <tbody>${rows.map((r,i) => `<tr class="${i < Number(pool.advance || 0) ? "qualifier" : ""}"><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.played}</td><td>${r.points}</td><td>${r.diff}</td></tr>`).join("")}</tbody>
          </table>
        </div>`;
      }).join("")}
    </div>
  </article>`;
}

function computeStandings(catId, poolId){
  const pool = getPool(catId, poolId);
  if (!pool) return [];
  const rows = pool.teams.map(t => ({
    teamId: t.id, name: t.name, played:0, wins:0, losses:0, points:0, for:0, against:0, diff:0
  }));
  const byTeam = new Map(rows.map(r => [r.teamId, r]));
  state.matches
    .filter(m => m.catId === catId && m.poolId === poolId && m.stage === "RR" && m.status === "done")
    .forEach(m => {
      const a = byTeam.get(m.teamAId);
      const b = byTeam.get(m.teamBId);
      if (!a || !b) return;
      const sa = Number(m.scoreA);
      const sb = Number(m.scoreB);
      if (!Number.isFinite(sa) || !Number.isFinite(sb)) return;
      a.played++; b.played++;
      a.for += sa; a.against += sb;
      b.for += sb; b.against += sa;
      if (sa > sb){ a.wins++; b.losses++; a.points += 2; }
      else if (sb > sa){ b.wins++; a.losses++; b.points += 2; }
    });
  rows.forEach(r => r.diff = r.for - r.against);
  rows.sort((a,b) => 
    b.points - a.points ||
    b.wins - a.wins ||
    b.diff - a.diff ||
    b.for - a.for ||
    a.name.localeCompare(b.name, "zh-CN")
  );
  return rows;
}

function parsePoolText(text){
  const chunks = String(text || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (!chunks.length) return [];
  return chunks.map((chunk, idx) => {
    let lines = chunk.split("\n").map(s => s.trim()).filter(Boolean);
    let poolName = `Pool ${String.fromCharCode(65+idx)}`;
    if (lines.length > 1 && /^(pool\b|pool\s+[a-z0-9]+|[a-z]\s*组|[a-z]$|[a-z]\b|组\s*[a-z0-9]+|小组|group\b)/i.test(lines[0])) {
      poolName = lines.shift();
    } else if (lines.length > 1 && /^pool/i.test(lines[0])) {
      poolName = lines.shift();
    }
    const teams = Array.from(new Set(lines.map(s => s.trim()).filter(Boolean)));
    return { name: poolName, teams };
  }).filter(p => p.teams.length >= 2);
}

function generateRoundRobinForCat(targetState, catId, replace){
  const cat = targetState.categories.find(c => c.id === catId);
  if (!cat) return 0;
  if (replace) {
    targetState.matches = targetState.matches.filter(m => !(m.catId === catId && m.stage === "RR"));
  }
  const baseSeq = (targetState.matches.reduce((max, m) => Math.max(max, Number(m.sequence || 0)), 0) || 0) + 1;
  let seq = baseSeq;
  let count = 0;
  cat.pools.forEach(pool => {
    const rounds = roundRobinPairings(pool.teams.map(t => t.id));
    rounds.forEach((pairs, roundIdx) => {
      pairs.forEach(pair => {
        targetState.matches.push({
          id: uid("match"),
          catId: cat.id,
          poolId: pool.id,
          stage: "RR",
          round: roundIdx + 1,
          teamAId: pair[0],
          teamBId: pair[1],
          status: "queued",
          courtId: "",
          scoreA: "",
          scoreB: "",
          winnerId: "",
          sequence: seq++,
          createdAt: Date.now()
        });
        count++;
      });
    });
  });
  cat.status = "rr";
  return count;
}

function roundRobinPairings(teamIds){
  const arr = teamIds.slice();
  if (arr.length % 2 === 1) arr.push(null);
  const n = arr.length;
  const rounds = [];
  for (let round = 0; round < n - 1; round++){
    const pairs = [];
    for (let i = 0; i < n / 2; i++){
      const a = arr[i], b = arr[n - 1 - i];
      if (a && b) pairs.push(round % 2 === 0 ? [a,b] : [b,a]);
    }
    rounds.push(pairs);
    const fixed = arr[0];
    const rotated = [fixed, arr[n-1], ...arr.slice(1, n-1)];
    arr.splice(0, arr.length, ...rotated);
  }
  return rounds;
}

function generatePlayoffForCat(catId){
  const cat = getCat(catId);
  if (!cat) return 0;
  const qualifiers = [];
  cat.pools.forEach(pool => {
    const standings = computeStandings(cat.id, pool.id);
    const take = Math.max(0, Math.min(Number(pool.advance || 0), standings.length));
    standings.slice(0, take).forEach((row, idx) => {
      qualifiers.push({
        teamId: row.teamId,
        name: row.name,
        poolId: pool.id,
        poolName: pool.name,
        rank: idx + 1,
        points: row.points,
        diff: row.diff,
        scored: row.for
      });
    });
  });
  if (qualifiers.length < 2) {
    showToast("至少需要 2 支出线队伍才能生成 Playoff。");
    return 0;
  }

  state.matches = state.matches.filter(m => !(m.catId === catId && m.stage !== "RR"));
  const ordered = seedQualifiers(cat, qualifiers);
  const bracketSize = nextPowerOfTwo(ordered.length);
  const slots = ordered.slice();
  while (slots.length < bracketSize) slots.push({teamId:"BYE", name:"BYE", poolId:"", poolName:"", rank:999});

  const firstPairs = [];
  for (let i = 0; i < bracketSize / 2; i++){
    firstPairs.push([slots[i], slots[bracketSize - 1 - i]]);
  }
  fixSamePoolFirstRound(firstPairs);

  const roundsTotal = Math.log2(bracketSize);
  const roundMatches = [];
  let seq = (state.matches.reduce((max, m) => Math.max(max, Number(m.sequence || 0)), 0) || 0) + 1;
  const firstRound = [];
  firstPairs.forEach((pair, idx) => {
    const m = {
      id: uid("match"),
      catId: cat.id,
      poolId: "",
      stage: playoffStageName(1, roundsTotal),
      round: 1,
      teamAId: pair[0]?.teamId || "",
      teamBId: pair[1]?.teamId || "",
      seedA: pair[0],
      seedB: pair[1],
      status: (pair[0]?.teamId && pair[1]?.teamId && pair[0].teamId !== "BYE" && pair[1].teamId !== "BYE") ? "queued" : "queued",
      courtId: "",
      scoreA: "",
      scoreB: "",
      winnerId: "",
      sequence: seq++,
      bracketIndex: idx,
      createdAt: Date.now()
    };
    firstRound.push(m);
    state.matches.push(m);
  });
  roundMatches.push(firstRound);

  for (let r = 2; r <= roundsTotal; r++){
    const prev = roundMatches[r-2];
    const matches = [];
    for (let i = 0; i < prev.length / 2; i++){
      const m = {
        id: uid("match"),
        catId: cat.id,
        poolId: "",
        stage: playoffStageName(r, roundsTotal),
        round: r,
        teamAId: "",
        teamBId: "",
        teamAFrom: prev[i*2].id,
        teamBFrom: prev[i*2 + 1].id,
        status: "waiting",
        courtId: "",
        scoreA: "",
        scoreB: "",
        winnerId: "",
        sequence: seq++,
        bracketIndex: i,
        createdAt: Date.now()
      };
      prev[i*2].feedsTo = m.id;
      prev[i*2].feedsSide = "A";
      prev[i*2 + 1].feedsTo = m.id;
      prev[i*2 + 1].feedsSide = "B";
      matches.push(m);
      state.matches.push(m);
    }
    roundMatches.push(matches);
  }

  if (cat.playoffThirdPlace === "bronze" && ordered.length >= 4 && roundsTotal >= 2){
    const semiMatches = roundMatches[roundsTotal - 2] || [];
    const finalMatch = (roundMatches[roundsTotal - 1] || [])[0];
    if (semiMatches.length >= 2){
      const bronze = {
        id: uid("match"),
        catId: cat.id,
        poolId: "",
        stage: "BR",
        round: roundsTotal,
        teamAId: "",
        teamBId: "",
        teamAFrom: semiMatches[0].id,
        teamBFrom: semiMatches[1].id,
        teamAFromType: "loser",
        teamBFromType: "loser",
        status: "waiting",
        courtId: "",
        scoreA: "",
        scoreB: "",
        winnerId: "",
        sequence: finalMatch ? Number(finalMatch.sequence || seq) - 0.5 : seq++,
        bracketIndex: 99,
        createdAt: Date.now()
      };
      semiMatches[0].loserFeedsTo = bronze.id;
      semiMatches[0].loserFeedsSide = "A";
      semiMatches[1].loserFeedsTo = bronze.id;
      semiMatches[1].loserFeedsSide = "B";
      state.matches.push(bronze);
    }
  }

  cat.status = "playoff";
  runAutoByes(cat.id);
  return state.matches.filter(m => m.catId === cat.id && m.stage !== "RR").length;
}

function seedQualifiers(cat, qualifiers){
  const byPool = new Map();
  qualifiers.forEach(q => {
    if (!byPool.has(q.poolId)) byPool.set(q.poolId, []);
    byPool.get(q.poolId).push(q);
  });
  for (const arr of byPool.values()){
    arr.sort((a,b) => a.rank - b.rank || b.points - a.points || b.diff - a.diff || b.scored - a.scored);
  }
  const ordered = [];
  const maxRank = Math.max(...qualifiers.map(q => q.rank));
  for (let rank = 1; rank <= maxRank; rank++){
    const pools = rank % 2 === 1 ? cat.pools : cat.pools.slice().reverse();
    pools.forEach(pool => {
      const q = (byPool.get(pool.id) || []).find(x => x.rank === rank);
      if (q) ordered.push(q);
    });
  }
  return ordered;
}

function fixSamePoolFirstRound(pairs){
  for (let i = 0; i < pairs.length; i++){
    const [a,b] = pairs[i];
    if (!a || !b || a.teamId === "BYE" || b.teamId === "BYE") continue;
    if (a.poolId && a.poolId === b.poolId) {
      for (let j = pairs.length - 1; j >= 0; j--){
        if (i === j) continue;
        const candidate = pairs[j][1];
        if (!candidate || candidate.teamId === "BYE") continue;
        if (candidate.poolId !== a.poolId && candidate.poolId !== pairs[j][0]?.poolId) {
          pairs[j][1] = b;
          pairs[i][1] = candidate;
          break;
        }
      }
    }
  }
}

function nextPowerOfTwo(n){
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function playoffStageName(round, totalRounds){
  const remaining = totalRounds - round;
  if (remaining === 0) return "F";
  if (remaining === 1) return "SF";
  if (remaining === 2) return "QF";
  if (remaining === 3) return "R16";
  if (remaining === 4) return "R32";
  return "R" + Math.pow(2, remaining + 1);
}

function runAutoByes(catId){
  let changed = true;
  while (changed){
    changed = false;
    state.matches
      .filter(m => m.catId === catId && m.stage !== "RR")
      .forEach(m => {
        if (m.status === "done") return;
        const aBye = m.teamAId === "BYE";
        const bBye = m.teamBId === "BYE";
        const aReal = m.teamAId && !aBye;
        const bReal = m.teamBId && !bBye;
        if ((aReal && bBye) || (bReal && aBye)){
          m.status = "done";
          m.scoreA = aReal ? "W" : "";
          m.scoreB = bReal ? "W" : "";
          m.winnerId = aReal ? m.teamAId : m.teamBId;
          m.courtId = "";
          propagateMatchResult(m);
          changed = true;
        } else if (aReal && bReal && m.status === "waiting"){
          m.status = "queued";
          changed = true;
        }
      });
  }
}

function finishMatch(matchId){
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  const scoreA = $("scoreA_" + matchId)?.value.trim();
  const scoreB = $("scoreB_" + matchId)?.value.trim();
  const a = Number(scoreA);
  const b = Number(scoreB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    showToast("请输入两边数字比分。");
    return;
  }
  if (a === b) {
    showToast("比分不能相同，请确认胜方。");
    return;
  }
  const courtId = m.courtId;
  const catId = m.catId;
  m.scoreA = String(a);
  m.scoreB = String(b);
  m.winnerId = a > b ? m.teamAId : m.teamBId;
  m.status = "done";
  m.courtId = "";
  removePrepareMatch(m.id);
  m.finishedAt = Date.now();
  if (m.stage !== "RR") {
    propagateMatchResult(m);
  }
  saveState();

  if (state.settings.autoNext && courtId) {
    const assigned = assignNextToCourt(courtId, catId) || assignNextToCourt(courtId, adminCatFilter);
    if (assigned) showToast("已完成，并自动安排下一场。");
    else showToast("已完成。此场地暂无可排比赛。");
  } else {
    showToast("比分已保存，场地已释放。");
  }
  saveState();
  renderAll();
}

function markReadyIfFilled(m){
  if (m.teamAId && m.teamBId && m.teamAId !== "BYE" && m.teamBId !== "BYE" && m.status === "waiting") {
    m.status = "queued";
  }
}

function propagateWinner(m){
  if (!m.feedsTo || !m.winnerId) return;
  const next = state.matches.find(x => x.id === m.feedsTo);
  if (!next) return;
  if (m.feedsSide === "A") next.teamAId = m.winnerId;
  else next.teamBId = m.winnerId;
  markReadyIfFilled(next);
}

function propagateLoser(m){
  if (!m.loserFeedsTo) return;
  const loserId = loserIdOf(m);
  if (!loserId) return;
  const next = state.matches.find(x => x.id === m.loserFeedsTo);
  if (!next) return;
  if (m.loserFeedsSide === "A") next.teamAId = loserId;
  else next.teamBId = loserId;
  markReadyIfFilled(next);
}

function propagateMatchResult(m){
  propagateWinner(m);
  propagateLoser(m);
}

function assignNextToCourt(courtId, catFilter="all"){
  if (currentPlayingByCourt(courtId)) return null;
  const matches = eligibleMatchesForCourt(courtId, catFilter || "all");
  if (!matches.length) return null;
  const m = matches[0];
  m.status = "playing";
  m.courtId = courtId;
  removePrepareMatch(m.id);
  m.startedAt = Date.now();
  return m;
}

function assignSpecific(matchId, courtId){
  if (currentPlayingByCourt(courtId)) {
    showToast("这个场地正在比赛。");
    return;
  }
  const m = state.matches.find(x => x.id === matchId);
  if (!m || !isMatchReady(m)) {
    showToast("这场比赛还不能安排。");
    return;
  }
  const busy = playingTeamIds();
  if (busy.has(m.teamAId) || busy.has(m.teamBId)) {
    showToast("队伍正在其他场地比赛，不能重复安排。");
    return;
  }
  if (!courtCanRunCat(courtId, m.catId)) {
    showToast("这个 Cat 还没有分配到该场地。");
    return;
  }
  m.status = "playing";
  m.courtId = courtId;
  removePrepareMatch(m.id);
  m.startedAt = Date.now();
  saveState();
  renderAll();
  showToast("已安排到 " + (getCourt(courtId)?.name || "场地"));
}

function returnToQueue(matchId){
  const m = state.matches.find(x => x.id === matchId);
  if (!m || m.status !== "playing") return;
  m.status = "queued";
  m.courtId = "";
  m.scoreA = m.scoreA || "";
  m.scoreB = m.scoreB || "";
  saveState();
  renderAll();
  showToast("已退回队列。");
}

function clearDownstreamSlot(sourceMatch){
  if (!sourceMatch) return;
  const links = [];
  if (sourceMatch.feedsTo) links.push({to:sourceMatch.feedsTo, side:sourceMatch.feedsSide});
  if (sourceMatch.loserFeedsTo) links.push({to:sourceMatch.loserFeedsTo, side:sourceMatch.loserFeedsSide});
  links.forEach(link => {
    const next = getMatch(link.to);
    if (!next) return;
    const hadWinner = !!next.winnerId || next.status === "done" || next.status === "playing";
    if (link.side === "A") next.teamAId = "";
    else next.teamBId = "";
    next.scoreA = "";
    next.scoreB = "";
    next.winnerId = "";
    next.courtId = "";
    next.startedAt = "";
    next.finishedAt = "";
    removePrepareMatch(next.id);
    next.status = (next.teamAId && next.teamBId && next.teamAId !== "BYE" && next.teamBId !== "BYE") ? "queued" : "waiting";
    if (hadWinner) clearDownstreamSlot(next);
  });
}

function updateCompletedScore(matchId){
  const m = getMatch(matchId);
  if (!m || m.status !== "done") return;
  if (m.scoreA === "W" || m.scoreB === "W") {
    showToast("自动轮空场次不需要修改比分。");
    return;
  }
  const scoreA = $("editScoreA_" + matchId)?.value.trim();
  const scoreB = $("editScoreB_" + matchId)?.value.trim();
  const a = Number(scoreA);
  const b = Number(scoreB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    showToast("请输入两边数字比分。");
    return;
  }
  if (a === b) {
    showToast("比分不能相同，请确认胜方。");
    return;
  }
  const oldWinner = m.winnerId;
  m.scoreA = String(a);
  m.scoreB = String(b);
  m.winnerId = a > b ? m.teamAId : m.teamBId;
  m.finishedAt = Date.now();
  if (m.stage !== "RR") {
    if (oldWinner && oldWinner !== m.winnerId) clearDownstreamSlot(m);
    propagateMatchResult(m);
    runAutoByes(m.catId);
  }
  saveState();
  renderAll();
  showToast(m.stage === "RR" ? "比分已修改，RR 排名已更新。" : "Playoff 比分已修改，晋级关系已更新。");
}

async function handleClick(e){
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "show-view"){
    currentView = btn.dataset.view;
    renderAll();
    return;
  }
  if (action === "fullscreen"){
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
    return;
  }
  if (action === "print-page"){ window.print(); return; }
  if (action === "unlock-admin"){
    const pwd = $("adminPassword")?.value;
    btn.disabled = true;
    try{
      await loginAdmin(pwd);
      showToast("后台已打开，云端写入权限已启用。");
      if (pendingSave) void flushCloudSave();
    }catch(err){
      showToast(err.message || "密码不正确。");
    }finally{
      btn.disabled = false;
    }
    return;
  }
  if (action === "logout-admin"){
    if (pendingSave) await flushCloudSave();
    await logoutAdmin();
    showToast("后台已锁定。");
    return;
  }
  if (!adminUnlocked && ["finish-match","return-queue","assign-match","fill-empty-courts","generate-rr","generate-playoff","delete-cat","add-cat","clear-data","load-sample","prepare-match","prepare-top","prepare-up","prepare-down","unprepare-match","clear-prepare-list","hold-match","release-match","release-and-top","save-score-edit"].includes(action)){
    showToast("请先打开后台。");
    return;
  }
  if (action === "prepare-match" || action === "prepare-top"){
    const ok = setPrepareMatch(btn.dataset.matchId, action === "prepare-top");
    saveState();
    renderAll();
    showToast(ok ? (action === "prepare-top" ? "已置顶到大屏准备队列。" : "已加入大屏准备队列。") : "这场比赛目前不能加入准备队列。");
    return;
  }
  if (action === "prepare-up" || action === "prepare-down"){
    movePrepareMatch(btn.dataset.matchId, action === "prepare-up" ? -1 : 1);
    saveState();
    renderAll();
    return;
  }
  if (action === "unprepare-match"){
    removePrepareMatch(btn.dataset.matchId);
    saveState();
    renderAll();
    showToast("已从大屏准备队列移除。");
    return;
  }
  if (action === "clear-prepare-list"){
    state.settings.prepareMatchIds = [];
    saveState();
    renderAll();
    showToast("人工准备队列已清空，将恢复自动顺序。");
    return;
  }
  if (action === "hold-match"){
    const m = getMatch(btn.dataset.matchId);
    if (m){
      m.hold = true;
      removePrepareMatch(m.id);
      saveState();
      renderAll();
      showToast("已暂缓此比赛，不会出现在准备队列或自动排场中。");
    }
    return;
  }
  if (action === "release-match" || action === "release-and-top"){
    const m = getMatch(btn.dataset.matchId);
    if (m){
      m.hold = false;
      if (action === "release-and-top") setPrepareMatch(m.id, true);
      saveState();
      renderAll();
      showToast(action === "release-and-top" ? "已恢复并置顶到准备队列。" : "已恢复到 Queue。");
    }
    return;
  }
  if (action === "save-score-edit"){
    updateCompletedScore(btn.dataset.matchId);
    return;
  }
  if (action === "fill-empty-courts"){
    let count = 0;
    emptyCourts().forEach(c => { if (assignNextToCourt(c.id, adminCatFilter)) count++; });
    saveState();
    renderAll();
    showToast(count ? `已安排 ${count} 个空场。` : "没有可安排的空场。");
    return;
  }
  if (action === "assign-next"){
    const m = assignNextToCourt(btn.dataset.courtId, adminCatFilter);
    saveState();
    renderAll();
    showToast(m ? "已安排下一场。" : "没有可安排比赛。");
    return;
  }
  if (action === "assign-match"){
    assignSpecific(btn.dataset.matchId, btn.dataset.courtId);
    return;
  }
  if (action === "finish-match"){
    finishMatch(btn.dataset.matchId);
    return;
  }
  if (action === "return-queue"){
    returnToQueue(btn.dataset.matchId);
    return;
  }
  if (action === "generate-rr"){
    const cat = getCat(btn.dataset.catId);
    if (!cat) return;
    const existing = state.matches.some(m => m.catId === cat.id && m.stage === "RR");
    if (existing && !confirm("重新生成 RR 会删除此 Cat 现有 Round Robin 赛程和已录入比分，然后重新排表。确认继续？")) return;
    state.matches = state.matches.filter(m => !(m.catId === cat.id && m.stage === "RR"));
    generateRoundRobinForCat(state, cat.id, false);
    saveState();
    renderAll();
    showToast("Round Robin 已生成。");
    return;
  }
  if (action === "generate-playoff"){
    const cat = getCat(btn.dataset.catId);
    if (!cat) return;
    const rrNotDone = state.matches.some(m => m.catId === cat.id && m.stage === "RR" && m.status !== "done");
    if (rrNotDone && !confirm("此 Cat 的 RR 还没有全部完成。是否仍按当前排名生成 Playoff？")) return;
    const count = generatePlayoffForCat(cat.id);
    saveState();
    renderAll();
    showToast(count ? `已生成 ${count} 场 Playoff（${thirdPlaceRuleLabel(cat)}）。` : "未生成 Playoff。");
    return;
  }
  if (action === "delete-cat"){
    const catId = btn.dataset.catId;
    const cat = getCat(catId);
    if (!cat) return;
    if (!confirm(`确认删除 ${cat.name}？相关赛程和比分都会删除。`)) return;
    state.categories = state.categories.filter(c => c.id !== catId);
    state.matches = state.matches.filter(m => m.catId !== catId);
    state.settings.dashboardCatIds = state.settings.dashboardCatIds.filter(id => id !== catId);
    saveState();
    renderAll();
    showToast("Cat 已删除。");
    return;
  }
  if (action === "add-court-to-cat"){
    const cat = getCat(btn.dataset.catId);
    if (cat && !cat.courtIds.includes(btn.dataset.courtId)){
      cat.courtIds.push(btn.dataset.courtId);
      saveState();
      renderAll();
      showToast("空场已加入此 Cat。");
    }
    return;
  }
  if (action === "add-cat"){
    const name = $("newCatName")?.value.trim();
    const advance = Number($("newCatAdvance")?.value || 2);
    const pools = parsePoolText($("newCatPools")?.value || "");
    if (!name){ showToast("请输入 Cat 名称。"); return; }
    if (!pools.length){ showToast("请至少输入一个 Pool，且每个 Pool 至少 2 支队伍。"); return; }
    const cat = addCategoryToState(state, name, pools, advance);
    cat.courtIds = emptyCourts().slice(0, Math.min(2, state.settings.courts.length)).map(c => c.id);
    generateRoundRobinForCat(state, cat.id, false);
    state.settings.dashboardCatIds.push(cat.id);
    saveState();
    renderAll();
    showToast("Cat 已新增，并已生成 RR。");
    return;
  }
  if (action === "export-json"){
    exportJson();
    return;
  }
  if (action === "trigger-import"){
    $("importFile")?.click();
    return;
  }
  if (action === "load-sample"){
    if (!confirm("载入示例会覆盖当前数据。确认？")) return;
    state = seedState();
    scheduleFilters = { catId: "all", status: "all" };
    adminCatFilter = "all";
    saveState();
    renderAll();
    showToast("示例数据已载入。");
    return;
  }
  if (action === "clear-data"){
    if (!confirm("确认清空所有数据？建议先导出备份 JSON。")) return;
    state = createEmptyState();
    scheduleFilters = { catId: "all", status: "all" };
    adminCatFilter = "all";
    saveState();
    renderAll();
    showToast("数据已清空。");
    return;
  }
}

function handleChange(e){
  const el = e.target;
  const action = el.dataset.action;
  if (!action) return;

  if (action === "dashboard-cat-toggle"){
    if (!adminUnlocked){
      showToast("Dashboard 展示 Cat 由工作人员后台统一控制，请先打开后台。");
      renderDashboard();
      return;
    }
    const checkedIds = Array.from(document.querySelectorAll('[data-action="dashboard-cat-toggle"]:checked')).map(x => x.value);
    state.settings.dashboardCatIds = checkedIds;
    saveState();
    renderAll();
    return;
  }
  if (action === "schedule-filter-cat"){
    scheduleFilters.catId = el.value;
    renderSchedule();
    return;
  }
  if (action === "schedule-filter-status"){
    scheduleFilters.status = el.value;
    renderSchedule();
    return;
  }
  if (action === "admin-cat-filter"){
    adminCatFilter = el.value;
    renderAll();
    return;
  }
  if (action === "auto-next"){
    state.settings.autoNext = el.value === "true";
    saveState();
    renderAll();
    return;
  }
  if (action === "cat-thirdplace-input"){
    const cat = getCat(el.dataset.catId);
    if (!cat) return;
    cat.playoffThirdPlace = el.value === "bronze" ? "bronze" : "margin";
    saveState();
    renderAll();
    showToast(cat.playoffThirdPlace === "bronze" ? "已设置：生成三四名赛。" : "已设置：不打三四名赛，按半决赛分差判季军。");
    return;
  }
  if (action === "cat-court-toggle"){
    const cat = getCat(el.dataset.catId);
    if (!cat) return;
    if (el.checked && !cat.courtIds.includes(el.value)) cat.courtIds.push(el.value);
    if (!el.checked) cat.courtIds = cat.courtIds.filter(id => id !== el.value);
    saveState();
    renderAll();
    return;
  }
  if (action === "pool-advance-input"){
    const pool = getPool(el.dataset.catId, el.dataset.poolId);
    if (!pool) return;
    pool.advance = Math.max(0, Math.min(Number(el.value || 0), pool.teams.length));
    saveState();
    renderAll();
    return;
  }
  if (["cat-name-input","pool-name-input","team-name-input"].includes(action)){
    saveState();
    renderAll();
    showToast("名称已更新。");
    return;
  }
}

function handleInput(e){
  const el = e.target;
  const action = el.dataset.action;
  if (action === "event-name-input"){
    state.settings.eventName = el.value;
    saveState();
    $("eventTitle").textContent = el.value || "武林年度赛 Tournament Control";
  }
  if (action === "court-name-input"){
    const court = getCourt(el.dataset.courtId);
    if (court) {
      court.name = el.value || court.id;
      saveState();
    }
  }
  if (action === "cat-name-input"){
    const cat = getCat(el.dataset.catId);
    if (cat) {
      cat.name = el.value || "未命名 Cat";
      saveState();
    }
  }
  if (action === "pool-name-input"){
    const pool = getPool(el.dataset.catId, el.dataset.poolId);
    if (pool) {
      pool.name = el.value || "未命名 Pool";
      saveState();
    }
  }
  if (action === "team-name-input"){
    const pool = getPool(el.dataset.catId, el.dataset.poolId);
    const team = pool?.teams.find(t => t.id === el.dataset.teamId);
    if (team) {
      team.name = el.value || "未命名队伍";
      saveState();
    }
  }
}

function exportJson(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wulin_tournament_backup_" + new Date().toISOString().slice(0,10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJsonFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = normalizeState(JSON.parse(reader.result));
      state = parsed;
      scheduleFilters = { catId: "all", status: "all" };
      adminCatFilter = "all";
      saveState();
      renderAll();
      showToast("导入成功。");
    }catch(err){
      console.error(err);
      showToast("导入失败，请确认 JSON 文件格式。");
    }
  };
  reader.readAsText(file);
}

document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("input", handleInput);
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "importFile" && e.target.files?.[0]) {
    importJsonFile(e.target.files[0]);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.activeElement?.id === "adminPassword") {
    const btn = document.querySelector('[data-action="unlock-admin"]');
    btn?.click();
  }
});

async function initializeApp(){
  startClock();
  renderAll();
  updateCloudStatus("loading", "连接云端");
  await Promise.allSettled([initializeCloud(), checkAdminSession()]);
  renderAll();
  if (pendingSave && adminUnlocked) void flushCloudSave();
}

window.addEventListener("online", () => {
  updateCloudStatus("loading", pendingSave ? "网络恢复 · 正在同步" : "网络恢复 · 重新连接");
  void initializeCloud(true).then(() => {
    if (pendingSave && adminUnlocked) void flushCloudSave();
  });
});
window.addEventListener("offline", () => {
  updateCloudStatus("offline", pendingSave ? "离线待同步" : "离线 · 显示缓存");
});
window.addEventListener("beforeunload", (event) => {
  if (pendingSave){
    void flushCloudSave(true);
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && navigator.onLine && !cloudSaving){
    void initializeCloud(true).then(() => {
      if (pendingSave && adminUnlocked) void flushCloudSave();
    });
  }
});

void initializeApp();
