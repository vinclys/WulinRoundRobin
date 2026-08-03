import { createClient } from "@supabase/supabase-js";
import { calculateStandings, buildFirstRoundPairs } from "./tournament-logic.js";
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
  raw.version = 7;
  raw.settings = Object.assign(base.settings, raw.settings || {});
  raw.settings.courts = Array.isArray(raw.settings.courts) && raw.settings.courts.length ? raw.settings.courts : base.settings.courts;
  raw.settings.courts.forEach((court, idx) => {
    court.id = court.id || `court${idx+1}`;
    court.name = court.name || `Court ${idx+1}`;
    court.allowAllActive = !!court.allowAllActive;
    court.poolAccess = court.poolAccess && typeof court.poolAccess === "object" && !Array.isArray(court.poolAccess) ? court.poolAccess : {};
  });
  raw.settings.dashboardCatIds = Array.isArray(raw.settings.dashboardCatIds) ? raw.settings.dashboardCatIds : [];
  raw.settings.prepareLimit = Math.max(3, Math.min(6, Number(raw.settings.prepareLimit || 6)));
  raw.settings.prepareMatchIds = Array.isArray(raw.settings.prepareMatchIds) ? raw.settings.prepareMatchIds : [];
  raw.categories = Array.isArray(raw.categories) ? raw.categories : [];
  raw.matches = Array.isArray(raw.matches) ? raw.matches : [];
  raw.categories.forEach(cat => {
    cat.id = cat.id || uid("cat");
    cat.name = cat.name || "Unnamed Category · 未命名项目";
    cat.status = cat.status || "rr";
    cat.playoffThirdPlace = ["bronze","margin"].includes(cat.playoffThirdPlace) ? cat.playoffThirdPlace : "margin";
    cat.courtIds = Array.isArray(cat.courtIds) ? cat.courtIds : [];
    cat.active = typeof cat.active === "boolean" ? cat.active : null;
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
          team.name = team.name || "Unnamed Team · 未命名队伍";
        }
      });
    });
  });
  raw.matches.forEach((m, idx) => {
    m.id = m.id || uid("match");
    m.status = m.status || "queued";
    m.hold = !!m.hold;
    m.sequence = Number.isFinite(Number(m.sequence)) ? Number(m.sequence) : idx + 1;
    m.preferredCourtId = typeof m.preferredCourtId === "string" ? m.preferredCourtId : "";
  });
  raw.categories.forEach(cat => {
    if (cat.active === null) {
      cat.active = cat.courtIds.length > 0 || raw.matches.some(m => m.catId === cat.id && m.status === "playing");
    }
  });
  const validCourtIds = new Set(raw.settings.courts.map(court => court.id));
  const validCats = new Map(raw.categories.map(cat => [cat.id, new Set(cat.pools.map(pool => pool.id))]));
  raw.settings.courts.forEach(court => {
    const nextAccess = {};
    Object.entries(court.poolAccess || {}).forEach(([catId, poolIds]) => {
      const validPoolIds = validCats.get(catId);
      if (!validPoolIds || !Array.isArray(poolIds)) return;
      if (poolIds.includes("*")) {
        nextAccess[catId] = ["*"];
        return;
      }
      const cleaned = Array.from(new Set(poolIds.filter(poolId => validPoolIds.has(poolId))));
      if (cleaned.length) nextAccess[catId] = cleaned;
    });
    court.poolAccess = nextAccess;
  });
  raw.matches.forEach(match => {
    if (match.preferredCourtId && !validCourtIds.has(match.preferredCourtId)) match.preferredCourtId = "";
  });
  return raw;
}

function createEmptyState(){
  return {
    version: 7,
    settings: {
      eventName: "武林年度赛 Tournament Control",
      autoNext: true,
      dashboardCatIds: [],
      prepareLimit: 6,
      prepareMatchIds: [],
      courts: Array.from({length:6}, (_, i) => ({ id: "court" + (i+1), name: "Court " + (i+1), allowAllActive: false, poolAccess: {} }))
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

const cachedEnvelope = readCachedEnvelope();
let state = cachedEnvelope?.state ? normalizeState(deepClone(cachedEnvelope.state)) : createEmptyState();
let cloudVersion = Number(cachedEnvelope?.version || 0);
let cloudReady = false;
let cloudSaving = false;
let pendingSave = Boolean(cachedEnvelope?.pending);
let saveTimer = null;
let mutationCounter = 0;
let realtimeChannel = null;
let queuedRemoteRecord = null;
const requestedView = new URLSearchParams(window.location.search).get("view");
let currentView = requestedView === "dashboard" ? "operations" : (["operations","results","schedule","admin"].includes(requestedView) ? requestedView : "operations");
let adminUnlocked = false;
let scheduleFilters = { catId: "all", status: "all" };
let adminCatFilter = "all";
let adminSettingsCatId = "";
let adminPoolTabByCat = {};
let openCourtAccessId = "";
let toastTimer = null;

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
        const defs = [
          {name:"Men's Doubles 4.0+", pools:[
            {name:"Pool A", teams:["Wulin Dragons","Kevin / Leo","Daniel / Marcus","Stanley / Ryan"]},
            {name:"Pool B", teams:["Gold Coast Team","Peter / Sam","Chris / Andrew","Jason / Ming"]}
          ]},
          {name:"Women's Doubles 3.5+", pools:[
            {name:"Pool A", teams:["Alice / Emma","Cindy / Grace","May / Lily","Sophia / Chloe","Ivy / Nina","Jenny / Kelly","Laura / Kate","Mia / Eva"]}
          ]},
          {name:"Mixed Doubles 3.5–4.0", pools:[
            {name:"Pool A", teams:["Han / Michelle","Leo / Vivian","Eric / Amy","Sam / Jessica"]},
            {name:"Pool B", teams:["Tony / Rachel","Ben / Karen","Andy / Zoe","Mike / Wendy"]}
          ]},
          {name:"Men's Doubles 3.5–4.0", pools:[
            {name:"Pool A", teams:["North Shaolin","Brooklyn Smash","Queens United","Flushing Aces"]},
            {name:"Pool B", teams:["Dragon Gate","Manhattan Spin","Long Island Lobbers","Jersey Warriors"]}
          ]},
          {name:"Women's Doubles 3.0–3.5", pools:[
            {name:"Pool A", teams:["Team Jade","Team Lotus","Team Phoenix","Team Crane","Team Plum","Team Bamboo"]}
          ]},
          {name:"Mixed Doubles 3.0–3.5", pools:[
            {name:"Pool A", teams:["Red Team","Blue Team","Gold Team","Black Team","White Team","Green Team"]}
          ]}
        ];

        defs.forEach(def => addCategoryToState(s, def.name, def.pools, 2));
        s.categories.forEach((cat, idx) => { cat.active = idx < 3; });
        s.categories[0].courtIds = ["court1","court2"];
        s.categories[1].courtIds = ["court3","court4"];
        s.categories[2].courtIds = ["court5","court6"];
        // Preview routes demonstrate the tournament-day setup: one Court per Pool where needed.
        const setPreviewRoute = (courtId, cat, poolIds) => {
          const court = s.settings.courts.find(item => item.id === courtId);
          if (!court || !cat) return;
          court.allowAllActive = false;
          court.poolAccess[cat.id] = poolIds.slice();
        };
        setPreviewRoute("court1", s.categories[0], [s.categories[0].pools[0].id]);
        setPreviewRoute("court2", s.categories[0], [s.categories[0].pools[1].id]);
        setPreviewRoute("court3", s.categories[1], [s.categories[1].pools[0].id]);
        setPreviewRoute("court4", s.categories[1], [s.categories[1].pools[0].id]);
        setPreviewRoute("court5", s.categories[2], [s.categories[2].pools[0].id]);
        setPreviewRoute("court6", s.categories[2], [s.categories[2].pools[1].id]);
        s.categories.forEach(cat => generateRoundRobinForCat(s, cat.id, true));

        const markDone = (catId, count) => {
          s.matches.filter(m => m.catId === catId && m.stage === "RR").slice(0, count).forEach((m, idx) => {
            const leftWins = idx % 3 !== 1;
            m.status = "done";
            m.scoreA = leftWins ? 11 : 8;
            m.scoreB = leftWins ? (5 + (idx % 5)) : 11;
            m.winnerId = leftWins ? m.teamAId : m.teamBId;
            m.finishedAt = Date.now() - (count - idx) * 60000;
          });
        };
        markDone(s.categories[0].id, 4);
        markDone(s.categories[1].id, 4);
        markDone(s.categories[2].id, 4);

        const assignLive = (catId, routes) => {
          const busy = new Set();
          const candidates = s.matches.filter(m => m.catId === catId && m.stage === "RR" && m.status === "queued");
          routes.forEach(({courtId, poolId}) => {
            const m = candidates.find(x => x.poolId === poolId && !busy.has(x.teamAId) && !busy.has(x.teamBId) && x.status === "queued");
            if (!m) return;
            m.status = "playing";
            m.courtId = courtId;
            busy.add(m.teamAId);
            busy.add(m.teamBId);
          });
        };
        assignLive(s.categories[0].id, [
          {courtId:"court1", poolId:s.categories[0].pools[0].id},
          {courtId:"court2", poolId:s.categories[0].pools[1].id}
        ]);
        assignLive(s.categories[1].id, [
          {courtId:"court3", poolId:s.categories[1].pools[0].id},
          {courtId:"court4", poolId:s.categories[1].pools[0].id}
        ]);
        assignLive(s.categories[2].id, [
          {courtId:"court5", poolId:s.categories[2].pools[0].id},
          {courtId:"court6", poolId:s.categories[2].pools[1].id}
        ]);

        // Completed RR and medal matches for the Results TV preview.
        const medalCat = s.categories[3];
        markDone(medalCat.id, 999);
        medalCat.status = "playoff";
        medalCat.playoffThirdPlace = "bronze";
        const medalStandings = medalCat.pools.map(pool => calculateStandings(
          pool.teams,
          s.matches.filter(match => match.catId === medalCat.id && match.poolId === pool.id && match.stage === "RR"),
          "en"
        ));
        const byId = teamId => medalCat.pools.flatMap(pool => pool.teams).find(team => team.id === teamId);
        const poolA1 = byId(medalStandings[0][0].teamId);
        const poolA2 = byId(medalStandings[0][1].teamId);
        const poolB1 = byId(medalStandings[1][0].teamId);
        const poolB2 = byId(medalStandings[1][1].teamId);
        let seq = Math.max(...s.matches.map(m => Number(m.sequence || 0))) + 1;
        const finalId = uid("match");
        const bronzeId = uid("match");
        const sf1 = {
          id:uid("match"), catId:medalCat.id, poolId:"", stage:"SF", round:1,
          teamAId:poolA1.id, teamBId:poolB2.id, status:"done", courtId:"", preferredCourtId:"",
          seedA:{teamId:poolA1.id,name:poolA1.name,poolId:medalCat.pools[0].id,poolName:medalCat.pools[0].name,rank:1},
          seedB:{teamId:poolB2.id,name:poolB2.name,poolId:medalCat.pools[1].id,poolName:medalCat.pools[1].name,rank:2},
          scoreA:11, scoreB:7, winnerId:poolA1.id, sequence:seq++, bracketIndex:0,
          feedsTo:finalId, feedsSide:"A", loserFeedsTo:bronzeId, loserFeedsSide:"A", finishedAt:Date.now()-240000
        };
        const sf2 = {
          id:uid("match"), catId:medalCat.id, poolId:"", stage:"SF", round:1,
          teamAId:poolA2.id, teamBId:poolB1.id, status:"done", courtId:"", preferredCourtId:"",
          seedA:{teamId:poolA2.id,name:poolA2.name,poolId:medalCat.pools[0].id,poolName:medalCat.pools[0].name,rank:2},
          seedB:{teamId:poolB1.id,name:poolB1.name,poolId:medalCat.pools[1].id,poolName:medalCat.pools[1].name,rank:1},
          scoreA:9, scoreB:11, winnerId:poolB1.id, sequence:seq++, bracketIndex:1,
          feedsTo:finalId, feedsSide:"B", loserFeedsTo:bronzeId, loserFeedsSide:"B", finishedAt:Date.now()-210000
        };
        const bronze = {
          id:bronzeId, catId:medalCat.id, poolId:"", stage:"BR", round:2,
          teamAId:poolB2.id, teamBId:poolA2.id, teamAFrom:sf1.id, teamBFrom:sf2.id,
          teamAFromType:"loser", teamBFromType:"loser", status:"done", courtId:"", preferredCourtId:"",
          scoreA:8, scoreB:11, winnerId:poolA2.id, sequence:seq++, bracketIndex:99, finishedAt:Date.now()-120000
        };
        const final = {
          id:finalId, catId:medalCat.id, poolId:"", stage:"F", round:2,
          teamAId:poolA1.id, teamBId:poolB1.id, teamAFrom:sf1.id, teamBFrom:sf2.id,
          status:"done", courtId:"", preferredCourtId:"", scoreA:11, scoreB:9, winnerId:poolA1.id,
          sequence:seq++, bracketIndex:0, finishedAt:Date.now()-60000
        };
        s.matches.push(sf1, sf2, bronze, final);

        s.settings.dashboardCatIds = [medalCat.id];
        s.settings.prepareLimit = 6;
        return s;
      }

      function addCategoryToState(targetState, name, poolDefs, defaultAdvance){
        const cat = {
          id: uid("cat"),
          name: name.trim() || "未命名 Cat",
          active: true,
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
        return team ? team.name : (teamId ? "Team removed · 队伍已删除" : "TBD · 待定");
      }
      function matchCode(m){
        const idx = state.matches.filter(x => x.catId === m.catId && x.stage === m.stage).findIndex(x => x.id === m.id) + 1;
        return (m.stage || "M") + "-" + idx;
      }
      function stageName(stage){
        const map = { RR:"Round Robin", R32:"Round of 32", R16:"Round of 16", QF:"Quarterfinal", SF:"Semifinal", F:"Final", BR:"Third Place" };
        return map[stage] || stage || "Match";
      }
      function rrRoundTotal(m){
        if (!m || m.stage !== "RR") return 0;
        return state.matches
          .filter(x => x.catId === m.catId && x.poolId === m.poolId && x.stage === "RR")
          .reduce((max, x) => Math.max(max, Number(x.round || 0)), 0);
      }
      function matchRoundLabel(m){
        if (!m) return "Match";
        if (m.stage === "RR") {
          const total = rrRoundTotal(m);
          return `RR ROUND ${Number(m.round || 0) || "?"}/${total || "?"}`;
        }
        return stageName(m.stage).toUpperCase();
      }
      function categoryProgress(catId){
        const rr = state.matches.filter(m => m.catId === catId && m.stage === "RR");
        const total = rr.length;
        const done = rr.filter(m => m.status === "done").length;
        const totalRounds = rr.reduce((max, m) => Math.max(max, Number(m.round || 0)), 0);
        const liveRounds = Array.from(new Set(rr.filter(m => m.status === "playing").map(m => Number(m.round || 0)).filter(Boolean))).sort((a,b) => a-b);
        const pendingRounds = Array.from(new Set(rr.filter(m => m.status !== "done").map(m => Number(m.round || 0)).filter(Boolean))).sort((a,b) => a-b);
        const shownRounds = liveRounds.length ? liveRounds : pendingRounds.slice(0,1);
        let roundText = total ? (done === total ? `RR COMPLETE · ${totalRounds} ROUNDS` : shownRounds.length > 1 ? `RR R${shownRounds[0]}–${shownRounds[shownRounds.length-1]}/${totalRounds}` : `RR R${shownRounds[0] || 1}/${totalRounds || 1}`) : "NO RR SCHEDULE";
        const percent = total ? Math.round(done / total * 100) : 0;
        return { total, done, totalRounds, roundText, percent };
      }
      function poolProgress(catId, poolId){
        const rr = state.matches.filter(match => match.catId === catId && match.poolId === poolId && match.stage === "RR");
        const total = rr.length;
        const done = rr.filter(match => match.status === "done").length;
        const totalRounds = rr.reduce((max, match) => Math.max(max, Number(match.round || 0)), 0);
        const liveRounds = Array.from(new Set(rr.filter(match => match.status === "playing").map(match => Number(match.round || 0)).filter(Boolean))).sort((a,b) => a-b);
        const pendingRounds = Array.from(new Set(rr.filter(match => match.status !== "done").map(match => Number(match.round || 0)).filter(Boolean))).sort((a,b) => a-b);
        const currentRound = liveRounds[0] || pendingRounds[0] || totalRounds || 0;
        return { total, done, totalRounds, currentRound, label: total ? `R${currentRound || totalRounds}/${totalRounds}` : "NO RR" };
      }

      function statusLabel(status){
        const map = {
          queued:"QUEUED · 待安排",
          playing:"LIVE · 进行中",
          done:"FINAL · 已完成",
          waiting:"WAITING · 等胜者"
        };
        return map[status] || status;
      }


      function publicStatusLabel(status){
        const map = { queued:"QUEUED · 待安排", playing:"LIVE · 进行中", done:"FINAL · 已完成", waiting:"WAITING · 等胜者" };
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
          const label = m[fromTypeKey] === "loser" ? "Loser 败者" : "Winner 胜者";
          return source ? `${label} ${matchCode(source)}` : `${label} · TBD`;
        }
        return "TBD · 待定";
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
      function ensureCourtPoolAccess(court){
        if (!court) return {};
        if (!court.poolAccess || typeof court.poolAccess !== "object" || Array.isArray(court.poolAccess)) court.poolAccess = {};
        return court.poolAccess;
      }
      function courtCanRunCat(courtId, catId){
        const cat = getCat(catId);
        const court = getCourt(courtId);
        return !!cat && !!court && !!cat.active && (court.allowAllActive || cat.courtIds.includes(courtId));
      }
      function courtHasCatAccess(court, cat){
        return !!court && !!cat && (cat.courtIds.includes(court.id) || (!!cat.active && !!court.allowAllActive));
      }
      function courtUsesAllPools(court, cat){
        if (!courtHasCatAccess(court, cat)) return false;
        if (court.allowAllActive) return true;
        const raw = ensureCourtPoolAccess(court)[cat.id];
        return !Array.isArray(raw) || !raw.length || raw.includes("*");
      }
      function allowedPoolIdsForCourtCat(court, cat){
        if (!courtHasCatAccess(court, cat)) return [];
        if (courtUsesAllPools(court, cat)) return cat.pools.map(pool => pool.id);
        const validIds = new Set(cat.pools.map(pool => pool.id));
        return ensureCourtPoolAccess(court)[cat.id].filter(poolId => validIds.has(poolId));
      }
      function courtCanRunMatch(courtId, match){
        const court = getCourt(courtId);
        const cat = getCat(match?.catId);
        if (!court || !cat || !cat.active || !courtHasCatAccess(court, cat)) return false;
        // Cross-pool playoff matches can use any court opened for the category.
        if (match.stage !== "RR" || !match.poolId) return true;
        return allowedPoolIdsForCourtCat(court, cat).includes(match.poolId);
      }
      function materializeAllActiveCourt(court){
        if (!court?.allowAllActive) return;
        const access = ensureCourtPoolAccess(court);
        getActiveCats().forEach(activeCat => {
          if (!activeCat.courtIds.includes(court.id)) activeCat.courtIds.push(court.id);
          access[activeCat.id] = ["*"];
        });
        court.allowAllActive = false;
      }
      function setCourtAllActive(courtId, checked){
        const court = getCourt(courtId);
        if (!court) return;
        const activeCats = getActiveCats();
        const access = ensureCourtPoolAccess(court);
        court.allowAllActive = !!checked;
        activeCats.forEach(cat => {
          if (checked) {
            if (!cat.courtIds.includes(courtId)) cat.courtIds.push(courtId);
            access[cat.id] = ["*"];
          } else {
            cat.courtIds = cat.courtIds.filter(id => id !== courtId);
            delete access[cat.id];
          }
        });
        if (!checked) {
          state.matches.forEach(match => {
            if (match.preferredCourtId === courtId && match.status === "queued") match.preferredCourtId = "";
          });
        }
      }
      function setCourtCatAccess(courtId, catId, checked){
        const court = getCourt(courtId);
        const cat = getCat(catId);
        if (!court || !cat) return;
        if (court.allowAllActive) materializeAllActiveCourt(court);
        const access = ensureCourtPoolAccess(court);
        if (checked) {
          if (!cat.courtIds.includes(courtId)) cat.courtIds.push(courtId);
          if (!Array.isArray(access[cat.id]) || !access[cat.id].length) access[cat.id] = ["*"];
        } else {
          cat.courtIds = cat.courtIds.filter(id => id !== courtId);
          delete access[cat.id];
          state.matches.forEach(match => {
            if (match.catId === catId && match.preferredCourtId === courtId && match.status === "queued") match.preferredCourtId = "";
          });
        }
      }
      function setCourtAllPools(courtId, catId, checked){
        const court = getCourt(courtId);
        const cat = getCat(catId);
        if (!court || !cat) return;
        if (court.allowAllActive) materializeAllActiveCourt(court);
        if (!cat.courtIds.includes(courtId)) cat.courtIds.push(courtId);
        const access = ensureCourtPoolAccess(court);
        access[catId] = checked ? ["*"] : cat.pools.map(pool => pool.id);
      }
      function setCourtPoolAccess(courtId, catId, poolId, checked){
        const court = getCourt(courtId);
        const cat = getCat(catId);
        if (!court || !cat || !cat.pools.some(pool => pool.id === poolId)) return;
        if (court.allowAllActive) materializeAllActiveCourt(court);
        if (!cat.courtIds.includes(courtId)) cat.courtIds.push(courtId);
        const access = ensureCourtPoolAccess(court);
        let selected = courtUsesAllPools(court, cat)
          ? cat.pools.map(pool => pool.id)
          : (access[catId] || []).slice();
        selected = selected.filter(id => id !== "*");
        if (checked && !selected.includes(poolId)) selected.push(poolId);
        if (!checked) selected = selected.filter(id => id !== poolId);
        selected = cat.pools.map(pool => pool.id).filter(id => selected.includes(id));
        if (!selected.length) {
          setCourtCatAccess(courtId, catId, false);
          return;
        }
        access[catId] = selected;
        state.matches.forEach(match => {
          if (match.catId === catId && match.poolId && !selected.includes(match.poolId) && match.preferredCourtId === courtId && match.status === "queued") {
            match.preferredCourtId = "";
          }
        });
      }
      function emptyCourts(){
        return state.settings.courts.filter(c => !currentPlayingByCourt(c.id));
      }
      function isManuallyPrepared(matchId){
        return (state.settings.prepareMatchIds || []).includes(matchId);
      }
      function potentialCourtsForMatch(m){
        if (!m || !getCat(m.catId)?.active) return [];
        return state.settings.courts.filter(court => courtCanRunMatch(court.id, m));
      }
      function preferredCourtForMatch(m){
        if (!m?.preferredCourtId) return null;
        const court = getCourt(m.preferredCourtId);
        return court && courtCanRunMatch(court.id, m) ? court : null;
      }
      function eligibleMatchesForCourt(courtId, catFilter="all", options={}){
        const busy = playingTeamIds();
        const respectPreferred = options.respectPreferred !== false;
        return state.matches
          .filter(m => isMatchReady(m))
          .filter(m => getCat(m.catId)?.active)
          .filter(m => catFilter === "all" || m.catId === catFilter)
          .filter(m => courtCanRunMatch(courtId, m))
          .filter(m => !busy.has(m.teamAId) && !busy.has(m.teamBId))
          .filter(m => !respectPreferred || !isManuallyPrepared(m.id) || !m.preferredCourtId || m.preferredCourtId === courtId)
          .sort((a,b) => {
            const aPreferred = isManuallyPrepared(a.id) && a.preferredCourtId === courtId ? 0 : 1;
            const bPreferred = isManuallyPrepared(b.id) && b.preferredCourtId === courtId ? 0 : 1;
            return aPreferred - bPreferred || sortByPriorityThenMatches(a,b);
          });
      }
      function eligibleCourtsForMatch(m){
        if (!isMatchReady(m)) return [];
        const busy = playingTeamIds();
        if (busy.has(m.teamAId) || busy.has(m.teamBId)) return [];
        return emptyCourts().filter(c => courtCanRunMatch(c.id, m));
      }
      function plannedCourtName(m){
        const court = preferredCourtForMatch(m);
        return court ? court.name : "Court TBD";
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
          if (m?.preferredCourtId && !courtCanRunMatch(m.preferredCourtId, m)) m.preferredCourtId = "";
          return !!m && isMatchReady(m) && !!getCat(m.catId)?.active;
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
        if (!m.preferredCourtId) {
          const potential = potentialCourtsForMatch(m);
          if (potential.length === 1) m.preferredCourtId = potential[0].id;
        }
        return true;
      }

      function removePrepareMatch(matchId){
        state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => id !== matchId);
        const match = getMatch(matchId);
        if (match && match.status === "queued") match.preferredCourtId = "";
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

      function getActiveCats(){
        return state.categories.filter(cat => !!cat.active);
      }

      function getActiveCatIds(){
        return getActiveCats().map(c => c.id);
      }

      function getDashboardCatIds(){
        const available = state.categories.map(c => c.id);
        const selected = (state.settings.dashboardCatIds || []).filter(id => available.includes(id));
        return selected.length ? selected : available.slice(0, Math.min(2, available.length));
      }

      function nextPrepareEntries(limit=state.settings.prepareLimit || 6){
        cleanPrepareMatchIds();
        limit = Math.max(3, Math.min(6, Number(limit || 6)));
        const busy = playingTeamIds();
        const chosenIds = new Set();
        const reservedAutoTeams = new Set(busy);
        const reservedFirstPassCourts = new Set();
        const entries = [];

        const addEntry = (match, courtId, manual, busyNow=false) => {
          if (!match || chosenIds.has(match.id) || entries.length >= limit) return false;
          chosenIds.add(match.id);
          entries.push({ match, courtId: courtId || "", manual: !!manual, busyNow: !!busyNow });
          if (courtId) reservedFirstPassCourts.add(courtId);
          if (!manual) {
            reservedAutoTeams.add(match.teamAId);
            reservedAutoTeams.add(match.teamBId);
          } else {
            // Automatic call-board fill should not duplicate a manually announced team.
            if (match.teamAId) reservedAutoTeams.add(match.teamAId);
            if (match.teamBId) reservedAutoTeams.add(match.teamBId);
          }
          return true;
        };

        // Staff choices always remain visible, even when one of the teams is still finishing another match.
        (state.settings.prepareMatchIds || []).map(id => getMatch(id)).forEach(match => {
          if (entries.length >= limit || !match || !isMatchReady(match) || !getCat(match.catId)?.active) return;
          const preferred = preferredCourtForMatch(match);
          const validPreferred = preferred && courtCanRunMatch(preferred.id, match) ? preferred.id : "";
          const busyNow = busy.has(match.teamAId) || busy.has(match.teamBId);
          addEntry(match, validPreferred, true, busyNow);
        });

        const courtList = state.settings.courts.slice();
        let pass = 0;
        let progressed = true;
        while (entries.length < limit && progressed && pass < 3) {
          progressed = false;
          for (const court of courtList) {
            if (entries.length >= limit) break;
            if (pass === 0 && reservedFirstPassCourts.has(court.id)) continue;
            const candidate = state.matches
              .filter(match => isMatchReady(match))
              .filter(match => getCat(match.catId)?.active)
              .filter(match => !isManuallyPrepared(match.id))
              .filter(match => !chosenIds.has(match.id))
              .filter(match => courtCanRunMatch(court.id, match))
              .filter(match => !busy.has(match.teamAId) && !busy.has(match.teamBId))
              .filter(match => !reservedAutoTeams.has(match.teamAId) && !reservedAutoTeams.has(match.teamBId))
              .sort(sortMatches)[0];
            if (candidate && addEntry(candidate, court.id, false, false)) progressed = true;
          }
          pass += 1;
        }
        return entries;
      }

      function renderAll(){
        $("eventTitle").textContent = state.settings.eventName || "武林年度赛 Tournament Control";
        const isTv = currentView === "operations" || currentView === "results";
        document.body.classList.toggle("dashboard-mode", isTv);
        document.body.classList.toggle("tv-mode", isTv);
        document.body.classList.toggle("operations-mode", currentView === "operations");
        document.body.classList.toggle("results-mode", currentView === "results");
        document.body.classList.toggle("admin-mode", currentView === "admin");
        document.querySelectorAll(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === currentView));
        document.querySelectorAll(".view").forEach(el => el.classList.remove("active"));
        const activeView = $("view-" + currentView);
        if (activeView) activeView.classList.add("active");
        renderOperations();
        renderResults();
        renderSchedule();
        renderAdmin();
      }

      function renderOperations(){
        const activeCatIds = new Set(getActiveCatIds());
        const activeMatches = state.matches.filter(m => activeCatIds.has(m.catId));
        const playing = state.matches.filter(m => m.status === "playing");
        const done = activeMatches.filter(m => m.status === "done").length;
        const total = activeMatches.length;
        const queued = activeMatches.filter(m => m.status === "queued" && !m.hold).length;
        const prepareLimit = Math.max(3, Math.min(6, Number(state.settings.prepareLimit || 6)));
        const prepare = nextPrepareEntries(prepareLimit);

        $("view-operations").innerHTML = `
          <section class="panel tv-banner operations-summary">
            <div class="operations-title">
              <div class="eyebrow">LIVE OPERATIONS · 赛事实况</div>
              <h2>COURTS & ON DECK</h2>
              <span>Check your court and stay nearby when called. · 请留意场地与候场</span>
            </div>
            <div class="tv-stat-row">
              <div class="tv-stat"><b>${playing.length}/${state.settings.courts.length}</b><span>LIVE COURTS</span></div>
              <div class="tv-stat"><b>${prepare.length}</b><span>ON DECK</span></div>
              <div class="tv-stat"><b>${done}/${total || 0}</b><span>COMPLETED</span></div>
              <div class="tv-stat"><b>${queued}</b><span>IN QUEUE</span></div>
            </div>
          </section>

          <div class="operations-layout">
            <section class="panel on-deck-panel">
              <div class="panel-title operations-panel-title">
                <div>
                  <h2>ON DECK · 候场准备</h2>
                  <div class="subtle">Staff priority first, then one next matchup per configured Court route.</div>
                </div>
                <span class="pill gold">NEXT ${prepareLimit}</span>
              </div>
              <div class="on-deck-grid">
                ${prepare.length ? prepare.map((entry, idx) => renderPrepareCard(entry, idx)).join("") : `<div class="empty-state" style="grid-column:1/-1">No match is ready for On Deck. · 暂无候场比赛</div>`}
              </div>
            </section>

            <section class="panel live-courts-panel">
              <div class="panel-title operations-panel-title">
                <div>
                  <h2>LIVE COURTS · 场地实况</h2>
                  <div class="subtle">Official assignments across all six Courts.</div>
                </div>
                <span class="pill green">${playing.length}/${state.settings.courts.length} LIVE</span>
              </div>
              <div class="courts-grid">
                ${state.settings.courts.map(c => renderCourtCard(c, false)).join("")}
              </div>
            </section>
          </div>
        `;
      }


      function renderResults(){
        const catIds = getDashboardCatIds();
        const completed = state.matches.filter(m => m.status === "done").length;
        const playoffDone = state.matches.filter(m => m.stage !== "RR" && m.status === "done").length;

        $("view-results").innerHTML = `
          <div class="dashboard-head results-head">
            <section class="panel hero">
              <div>
                <div class="eyebrow">OFFICIAL RESULTS · 武林榜</div>
                <h2>STANDINGS & PLAYOFF</h2>
                <p>Round Robin standings, playoff results and medal positions for the categories selected for public display.</p>
                <div class="hero-stat">
                  <div class="stat-card"><b>${catIds.length}</b><span>DISPLAYED CATEGORIES</span></div>
                  <div class="stat-card"><b>${completed}</b><span>MATCHES FINAL</span></div>
                  <div class="stat-card"><b>${playoffDone}</b><span>PLAYOFF RESULTS</span></div>
                </div>
              </div>
              <div class="no-print" style="align-self:flex-start;z-index:1"><span class="pill gold">OFFICIAL</span></div>
            </section>

            <section class="panel dash-controls no-print">
              <div class="panel-title">
                <div>
                  <h3>DISPLAY CATEGORIES</h3>
                  <div class="subtle">选择需要在 TV 2 公布的 Cat</div>
                </div>
                <span class="pill">${state.categories.length} AVAILABLE</span>
              </div>
              <div class="chip-row" data-display-cat-group>
                ${state.categories.length ? state.categories.map(cat => {
                  const checked = catIds.includes(cat.id);
                  return `<label class="cat-chip ${checked ? "active" : ""}">
                    <input type="checkbox" data-action="dashboard-cat-toggle" value="${cat.id}" ${checked ? "checked" : ""}>
                    ${escapeHtml(cat.name)}
                  </label>`;
                }).join("") : `<div class="empty-state">No categories have been created. · 尚未建立 Cat</div>`}
              </div>
              <div class="hint">For the clearest TV layout, display one category at a time. Enter full screen after making the selection. · 建议每次展示 1 个项目</div>
            </section>
          </div>

          <div class="results-category-board">
            ${catIds.length ? catIds.map(catId => `<div class="result-category-stack">${renderRankingCard(catId)}${renderPlayoffResultCard(catId)}</div>`).join("") : `<section class="panel"><div class="empty-state">Select at least one category for public display. · 请选择公布项目</div></section>`}
          </div>
        `;
      }

      function renderPrepareCard(entry, idx){
        const m = entry?.match || entry;
        const cat = getCat(m.catId);
        const pool = getPool(m.catId, m.poolId);
        const expectedCourt = getCourt(entry?.courtId || m.preferredCourtId || "");
        const potentialCourts = potentialCourtsForMatch(m).map(c => c.name).join(" / ");
        const manual = typeof entry?.manual === "boolean" ? entry.manual : isManuallyPrepared(m.id);
        const busyNow = !!entry?.busyNow;
        return `<article class="prepare-card ${busyNow ? "busy-next" : ""}">
          <div class="prepare-topline">
            <span class="deck-number">${String(idx+1).padStart(2,"0")}</span>
            <div class="prepare-tags">
              <span class="pill gold">${escapeHtml(cat?.name || "Category")}</span>
              <span class="pill round-focus">${escapeHtml(matchRoundLabel(m))}</span>
              ${pool ? `<span class="pill">${escapeHtml(pool.name)}</span>` : ""}
              ${manual ? `<span class="pill red">STAFF · 人工</span>` : ""}
              ${busyNow ? `<span class="pill blue">PLAYING NOW · 打完接场</span>` : ""}
            </div>
            <div class="expected-court ${expectedCourt ? "assigned" : "pending"}">
              <small>${manual ? "EXPECTED" : "NEXT FOR"}</small>
              <strong>${expectedCourt ? escapeHtml(expectedCourt.name) : "COURT TBD"}</strong>
            </div>
          </div>
          ${matchTeamsHtml(m)}
          <div class="prepare-footer">
            <span>${escapeHtml(matchCode(m))}</span>
            <span>${expectedCourt ? "WAIT NEAR THIS COURT · 请到附近候场" : potentialCourts ? `ROUTE: ${escapeHtml(potentialCourts)}` : "NO COURT ROUTE · 未开放场地"}</span>
          </div>
        </article>`;
      }


      function courtAccessSummary(court){
        const activeCats = getActiveCats();
        if (court.allowAllActive) return activeCats.length ? `ALL ACTIVE · ${activeCats.length} CATS` : "ALL ACTIVE";
        const parts = activeCats.filter(cat => courtHasCatAccess(court, cat)).map(cat => {
          if (courtUsesAllPools(court, cat)) return `${cat.name}: All Pools`;
          const poolNames = allowedPoolIdsForCourtCat(court, cat)
            .map(poolId => getPool(cat.id, poolId)?.name)
            .filter(Boolean);
          return `${cat.name}: ${poolNames.join(" / ") || "No Pool"}`;
        });
        return parts.length ? parts.join(" · ") : "Not assigned · 未开放";
      }

      function renderCourtAccess(court){
        const activeCats = getActiveCats();
        const selectedCats = activeCats.filter(cat => courtHasCatAccess(court, cat));
        const isOpen = openCourtAccessId === court.id;
        const routeCount = selectedCats.reduce((count, cat) => count + (courtUsesAllPools(court, cat) ? Math.max(1, cat.pools.length) : allowedPoolIdsForCourtCat(court, cat).length), 0);
        const compactSummary = court.allowAllActive ? `ALL ${activeCats.length}` : `${selectedCats.length}C/${routeCount}P`;
        const selectedNames = courtAccessSummary(court);
        return `<div class="court-access compact ${isOpen ? "open" : ""}">
          <button type="button" class="court-access-trigger" data-action="toggle-court-access" data-court-id="${court.id}" title="${escapeHtml(selectedNames)}">
            <span class="court-access-trigger-label">ROUTES</span>
            <span class="court-access-trigger-value ${court.allowAllActive ? "all" : ""}">${escapeHtml(compactSummary)}</span>
            <span class="court-access-chevron">▾</span>
          </button>
          <div class="court-access-menu">
            <div class="court-access-menu-head">
              <div>
                <div class="court-access-title">Court Routes · 可排 Cat / Pool</div>
                <div class="court-access-current" title="${escapeHtml(selectedNames)}">${escapeHtml(selectedNames)}</div>
              </div>
              <button type="button" class="ghost tiny" data-action="close-court-access">DONE · 完成</button>
            </div>
            <div class="court-access-note">Round Robin follows the selected Pool routes. Cross-pool Playoff matches may use any court opened for that Cat. · RR 按 Pool 分配</div>
            <div class="court-access-options">
              <label class="mini-check all-active-route ${court.allowAllActive ? "active" : ""}">
                <input type="checkbox" data-action="court-all-active-toggle" data-court-id="${court.id}" ${court.allowAllActive ? "checked" : ""}>
                <span>ALL ACTIVE CATS + ALL POOLS · 全部</span>
              </label>
              ${activeCats.map(cat => {
                const checked = courtHasCatAccess(court, cat);
                const progress = categoryProgress(cat.id);
                const allPools = checked && courtUsesAllPools(court, cat);
                const allowed = new Set(checked ? allowedPoolIdsForCourtCat(court, cat) : []);
                return `<div class="court-route-cat ${checked ? "active" : ""}">
                  <label class="mini-check cat-route-toggle ${checked ? "active" : ""}" title="${escapeHtml(cat.name)} · ${escapeHtml(progress.roundText)}">
                    <input type="checkbox" data-action="court-cat-toggle" data-court-id="${court.id}" data-cat-id="${cat.id}" ${checked ? "checked" : ""}>
                    <span>${escapeHtml(cat.name)}</span><span class="access-progress">${escapeHtml(progress.roundText.replace("RR ", ""))}</span>
                  </label>
                  ${checked ? `<div class="pool-route-options">
                    <label class="pool-route-chip all ${allPools ? "active" : ""}">
                      <input type="checkbox" data-action="court-all-pools-toggle" data-court-id="${court.id}" data-cat-id="${cat.id}" ${allPools ? "checked" : ""}>
                      ALL POOLS
                    </label>
                    ${cat.pools.map(pool => `<label class="pool-route-chip ${allowed.has(pool.id) ? "active" : ""}">
                      <input type="checkbox" data-action="court-pool-toggle" data-court-id="${court.id}" data-cat-id="${cat.id}" data-pool-id="${pool.id}" ${allowed.has(pool.id) ? "checked" : ""}>
                      ${escapeHtml(pool.name)}
                    </label>`).join("")}
                  </div>` : ""}
                </div>`;
              }).join("")}
              ${activeCats.length ? "" : `<span class="subtle">Enable categories in Current Session first. · 请先开启 Active Cat</span>`}
            </div>
          </div>
        </div>`;
      }


      function renderCourtCard(court, admin){
        const m = currentPlayingByCourt(court.id);
        if (!m){
          const next = eligibleMatchesForCourt(court.id, admin ? adminCatFilter : "all").at(0);
          return `<article class="court-card empty ${admin ? "admin-court" : ""}">
            <div class="court-top">
              <h3>${escapeHtml(court.name)}</h3>
              <div class="court-top-actions">${admin ? renderCourtAccess(court) : ""}<span class="pill empty">OPEN · 空场</span></div>
            </div>
            ${next ? `
              <div class="public-label">${admin ? "NEXT SUGGESTION · 下一场建议" : "NEXT AVAILABLE · 下一场"}</div>
              <div class="court-match-meta" style="margin-top:8px"><span class="pill gold">${escapeHtml(getCat(next.catId)?.name || "")}</span><span class="pill round-focus">${escapeHtml(matchRoundLabel(next))}</span>${getPool(next.catId,next.poolId) ? `<span class="pill">${escapeHtml(getPool(next.catId,next.poolId).name)}</span>` : ""}</div>
              ${matchTeamsHtml(next, true)}
              ${admin ? `<button class="success" data-action="assign-match" data-match-id="${next.id}" data-court-id="${court.id}">ASSIGN TO COURT · 安排到此场</button>` : `<div class="subtle">Awaiting staff confirmation · 等待工作人员安排</div>`}
            ` : `
              <div class="empty-state">${admin ? "No ready match fits this court route. Use ROUTES above to enable an Active Category / Pool. · 可在上方开放项目或小组" : "No match is ready for this court. · 暂无可安排比赛"}</div>
            `}
          </article>`;
        }
        const cat = getCat(m.catId);
        const pool = getPool(m.catId, m.poolId);
        return `<article class="court-card playing ${admin ? "admin-court" : ""}">
          <div class="court-top">
            <h3>${escapeHtml(court.name)}</h3>
            <div class="court-top-actions">${admin ? renderCourtAccess(court) : ""}<span class="pill green">LIVE · 进行中</span></div>
          </div>
          <div class="court-match-meta"><span class="pill gold">${escapeHtml(cat?.name || "Category")}</span><span class="pill round-focus">${escapeHtml(matchRoundLabel(m))}</span>${pool ? `<span class="pill">${escapeHtml(pool.name)}</span>` : ""}</div>
          ${admin && m.stage === "RR" ? `<div class="court-progress-note">${escapeHtml(pool?.name || "Pool")} is on Round ${Number(m.round || 0)}/${rrRoundTotal(m) || "?"}. Open another compatible court above when this Pool needs to catch up. · 可临时加场</div>` : ""}
          ${matchTeamsHtml(m, true)}
          ${m.scoreA !== undefined && m.scoreA !== "" ? `<div class="court-score">${escapeHtml(m.scoreA)} : ${escapeHtml(m.scoreB)}</div>` : ""}
          ${admin ? `
            <div class="score-input-row">
              <input id="scoreA_${m.id}" inputmode="numeric" placeholder="TEAM A SCORE" aria-label="Team A score" value="${escapeHtml(m.scoreA ?? "")}">
              <input id="scoreB_${m.id}" inputmode="numeric" placeholder="TEAM B SCORE" aria-label="Team B score" value="${escapeHtml(m.scoreB ?? "")}">
            </div>
            <div class="queue-row-actions">
              <button class="success" data-action="finish-match" data-match-id="${m.id}">SAVE RESULT & NEXT · 完成</button>
              <button class="ghost" data-action="return-queue" data-match-id="${m.id}">RETURN TO QUEUE · 退回</button>
            </div>
          ` : `<div class="subtle">Match ${escapeHtml(matchCode(m))} · OFFICIAL ASSIGNMENT</div>`}
        </article>`;
      }


      function standingsTieBreakText(row){
        if (!row?.tieBreakLabel) return "—";
        return `${row.tieBreakLabel}${row.tieBreakDetail ? " · " + row.tieBreakDetail : ""}`;
      }

      function renderRankingCard(catId){
        const cat = getCat(catId);
        if (!cat) return "";
        return `<section class="panel rank-card">
          <div class="panel-title">
            <div>
              <div class="eyebrow">ROUND ROBIN STANDINGS · 小组积分榜</div>
              <h2>${escapeHtml(cat.name)}</h2>
              <div class="subtle">Win = 2 pts · Tie-break order: head-to-head, then point differential, then points for. · 同分先看交手</div>
            </div>
            <span class="pill ${cat.status === "playoff" ? "blue" : "gold"}">${cat.status === "playoff" ? "PLAYOFF" : "ROUND ROBIN"}</span>
          </div>
          ${cat.pools.map(pool => {
            const rows = computeStandings(cat.id, pool.id);
            return `<div class="pool-rank">
              <table>
                <thead><tr><th colspan="9">${escapeHtml(pool.name)} · QUALIFIERS ${Number(pool.advance || 0)} · 出线 ${Number(pool.advance || 0)}</th></tr>
                <tr><th>RANK</th><th>TEAM</th><th>P</th><th>W</th><th>L</th><th>PTS</th><th>H2H / TB</th><th>DIFF</th><th>PF</th></tr></thead>
                <tbody>
                  ${rows.map((r, idx) => `<tr class="${idx < Number(pool.advance || 0) ? "qualifier" : ""}">
                    <td>${idx+1}</td><td><strong>${escapeHtml(r.name)}</strong></td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.points}</td><td class="tie-break-cell">${escapeHtml(standingsTieBreakText(r))}</td><td>${r.diff > 0 ? "+" : ""}${r.diff}</td><td>${r.for}</td>
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
        return cat?.playoffThirdPlace === "bronze"
          ? "THIRD PLACE MATCH · 进行季军赛"
          : "SEMIFINAL LOSS MARGIN · 按半决赛败方分差";
      }


      function computePodium(catId){
        const cat = getCat(catId);
        const matches = playoffMatchesForCat(catId);
        const final = matches.find(m => m.stage === "F");
        const bronze = matches.find(m => m.stage === "BR");
        const rows = [];
        if (final && final.status === "done" && final.winnerId){
          rows.push({label:"Champion 冠军", name:teamName(final.winnerId)});
          const runner = loserIdOf(final);
          if (runner) rows.push({label:"Runner-up 亚军", name:teamName(runner)});
        }
        if (bronze){
          if (bronze.status === "done" && bronze.winnerId){
            rows.push({label:"Third Place 季军", name:teamName(bronze.winnerId)});
            const fourth = loserIdOf(bronze);
            if (fourth) rows.push({label:"4th Place 第四名", name:teamName(fourth)});
          } else {
            rows.push({label:"Third Place Match 季军赛", name:"Waiting for result · 等待结果"});
          }
        } else if (cat?.playoffThirdPlace !== "bronze") {
          const decision = computeThirdBySemiMargin(catId);
          if (decision.status === "resolved"){
            rows.push({label:`Third Place 季军 · SF margin ${decision.third.margin}`, name:decision.third.loserName});
            rows.push({label:`4th Place 第四名 · SF margin ${decision.fourth.margin}`, name:decision.fourth.loserName});
          } else if (decision.status === "tie"){
            rows.push({label:"Third Place Pending · 季军待确认", name:`Semifinal margins tied: ${decision.tiedNames.join(" / ")}`});
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


      function playoffSeedLabel(m, side){
        const seed = side === "A" ? m.seedA : m.seedB;
        if (seed && seed.teamId && seed.teamId !== "BYE") {
          const poolLabel = seed.poolName || getPool(m.catId, seed.poolId)?.name || "Seed";
          return `${poolLabel} #${Number(seed.rank || 0) || "?"}`;
        }
        const fromId = side === "A" ? m.teamAFrom : m.teamBFrom;
        const fromType = side === "A" ? m.teamAFromType : m.teamBFromType;
        if (fromId) {
          const source = getMatch(fromId);
          return `${fromType === "loser" ? "Loser" : "Winner"} ${source ? matchCode(source) : "TBD"}`;
        }
        return "";
      }

      function bracketTeamRow(m, side){
        const id = side === "A" ? m.teamAId : m.teamBId;
        const score = side === "A" ? m.scoreA : m.scoreB;
        const isWinner = m.status === "done" && !!id && m.winnerId === id;
        const isLoser = m.status === "done" && !!id && !!m.winnerId && m.winnerId !== id;
        const label = sideDisplay(m, side);
        const seedLabel = playoffSeedLabel(m, side);
        return `<div class="bracket-team ${isWinner ? "winner" : ""} ${isLoser ? "loser" : ""}">
          <span class="bracket-seed">${escapeHtml(seedLabel || " ")}</span>
          <strong>${escapeHtml(label)}</strong>
          <b>${score === "" || score === undefined || score === null ? "–" : escapeHtml(score)}</b>
        </div>`;
      }

      function renderBracketMatch(m, pos){
        const stage = stageName(m.stage).toUpperCase();
        const finalClass = m.stage === "F" ? " final-match" : "";
        const liveClass = m.status === "playing" ? " live-match" : "";
        return `<article class="bracket-match${finalClass}${liveClass}" style="left:${pos.x}px;top:${pos.y}px;width:${pos.width}px;height:${pos.height}px">
          <div class="bracket-match-head">
            <span>${escapeHtml(stage)} · ${escapeHtml(matchCode(m))}</span>
            <span class="${statusClass(m.status)}"><span class="status-dot"></span>${escapeHtml(publicStatusLabel(m.status))}</span>
          </div>
          ${bracketTeamRow(m, "A")}
          ${bracketTeamRow(m, "B")}
        </article>`;
      }

      function buildBracketLayout(catId){
        const mainMatches = playoffMatchesForCat(catId).filter(m => m.stage !== "BR");
        if (!mainMatches.length) return null;
        const rounds = Array.from(new Set(mainMatches.map(m => Number(m.round || 1)))).sort((a,b) => a-b);
        const byRound = rounds.map(round => mainMatches
          .filter(m => Number(m.round || 1) === round)
          .sort((a,b) => Number(a.bracketIndex || 0) - Number(b.bracketIndex || 0) || sortMatches(a,b)));
        const firstCount = Math.max(1, byRound[0]?.length || 1);
        const cardWidth = 268;
        const cardHeight = 116;
        const columnGap = 112;
        const slotHeight = 148;
        const canvasHeight = Math.max(170, firstCount * slotHeight);
        const canvasWidth = Math.max(cardWidth, rounds.length * cardWidth + Math.max(0, rounds.length - 1) * columnGap);
        const positions = new Map();

        byRound.forEach((list, roundIndex) => {
          list.forEach((match, index) => {
            let centerY;
            if (roundIndex === 0) {
              centerY = (index + 0.5) * slotHeight;
            } else {
              const feederY = [match.teamAFrom, match.teamBFrom]
                .map(id => positions.get(id)?.centerY)
                .filter(value => Number.isFinite(value));
              if (feederY.length === 2) centerY = (feederY[0] + feederY[1]) / 2;
              else if (feederY.length === 1) centerY = feederY[0];
              else centerY = (index + 0.5) * (canvasHeight / Math.max(1, list.length));
            }
            const x = roundIndex * (cardWidth + columnGap);
            positions.set(match.id, {
              x,
              y: Math.max(28, centerY - cardHeight / 2),
              centerY,
              width: cardWidth,
              height: cardHeight,
              roundIndex
            });
          });
        });

        const connectors = [];
        byRound.slice(1).flat().forEach(target => {
          const targetPos = positions.get(target.id);
          [target.teamAFrom, target.teamBFrom].filter(Boolean).forEach(sourceId => {
            const sourcePos = positions.get(sourceId);
            if (!sourcePos || !targetPos) return;
            const x1 = sourcePos.x + sourcePos.width;
            const y1 = sourcePos.centerY;
            const x2 = targetPos.x;
            const y2 = targetPos.centerY;
            const mid = x1 + (x2 - x1) / 2;
            connectors.push(`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
          });
        });

        return { mainMatches, rounds, byRound, positions, connectors, canvasWidth, canvasHeight, cardWidth, cardHeight };
      }

      function renderPlayoffBracket(catId){
        const layout = buildBracketLayout(catId);
        const bronze = playoffMatchesForCat(catId).find(m => m.stage === "BR");
        if (!layout) return `<div class="empty-state">PLAYOFF NOT STARTED · 淘汰赛尚未开始</div>`;
        const roundLabels = layout.rounds.map((round, idx) => {
          const sample = layout.byRound[idx]?.[0];
          const left = idx * (layout.cardWidth + 112);
          return `<div class="bracket-round-label" style="left:${left}px;width:${layout.cardWidth}px">${escapeHtml(stageName(sample?.stage).toUpperCase())}</div>`;
        }).join("");
        const paths = layout.connectors.map(path => `<path d="${path}" />`).join("");
        const cards = layout.mainMatches.map(match => renderBracketMatch(match, layout.positions.get(match.id))).join("");
        return `<div class="playoff-bracket-shell">
          <div class="playoff-bracket-scroll">
            <div class="playoff-bracket" style="width:${layout.canvasWidth}px;height:${layout.canvasHeight + 34}px">
              ${roundLabels}
              <svg class="bracket-lines" viewBox="0 0 ${layout.canvasWidth} ${layout.canvasHeight}" width="${layout.canvasWidth}" height="${layout.canvasHeight}" aria-hidden="true">${paths}</svg>
              <div class="bracket-card-layer" style="height:${layout.canvasHeight}px">${cards}</div>
            </div>
          </div>
          ${bronze ? `<div class="bronze-bracket-lane">
            <div class="bronze-lane-title">THIRD PLACE MATCH · 季军赛</div>
            <div class="bronze-card-wrap">${renderBracketMatch(bronze, {x:0,y:0,width:320,height:116})}</div>
          </div>` : ""}
        </div>`;
      }

      function renderPlayoffResultCard(catId){
        const cat = getCat(catId);
        if (!cat) return "";
        const matches = playoffMatchesForCat(catId);
        const done = matches.filter(m => m.status === "done").length;
        const podium = computePodium(catId);
        return `<section class="panel rank-card playoff-bracket-card">
          <div class="panel-title">
            <div>
              <div class="eyebrow">PLAYOFF BRACKET · 淘汰赛晋级图</div>
              <h2>${escapeHtml(cat.name)}</h2>
              <div class="subtle">Follow each branch from the opening matchup to the Final. · 清楚显示对阵与晋级路线</div>
            </div>
            <span class="pill blue">${done}/${matches.length} FINAL</span>
          </div>
          ${matches.length ? `
            <div class="playoff-summary">
              ${podium.length ? podium.map(p => `<span class="medal-card"><strong>${escapeHtml(p.label)}</strong>: ${escapeHtml(p.name)}</span>`).join("") : `<span class="medal-card">PLAYOFF IN PROGRESS · 淘汰赛进行中</span>`}
            </div>
            ${renderPlayoffBracket(catId)}
          ` : `<div class="empty-state">PLAYOFF NOT STARTED · 淘汰赛尚未开始</div>`}
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

      function renderActiveCatControl(cat){
        const progress = categoryProgress(cat.id);
        const playing = state.matches.filter(m => m.catId === cat.id && m.status === "playing").length;
        const queued = state.matches.filter(m => m.catId === cat.id && m.status === "queued" && !m.hold).length;
        return `<label class="active-cat-control ${cat.active ? "active" : "inactive"}">
          <input type="checkbox" data-action="cat-active-toggle" data-cat-id="${cat.id}" ${cat.active ? "checked" : ""}>
          <div>
            <div class="active-cat-name">${escapeHtml(cat.name)}</div>
            <div class="active-cat-meta">
              <span class="pill ${cat.active ? "green" : ""}">${cat.active ? "ACTIVE · 当前时段" : "INACTIVE · 未开场"}</span>
              <span class="pill round-focus">${escapeHtml(progress.roundText)}</span>
              <span class="pill">${progress.done}/${progress.total} DONE</span>
              ${playing ? `<span class="pill red">${playing} LIVE</span>` : ""}
              ${queued ? `<span class="pill">${queued} QUEUED</span>` : ""}
            </div>
            <div class="progress-track"><span style="width:${progress.percent}%"></span></div>
          </div>
        </label>`;
      }

      function renderAdmin(){
        if (!adminUnlocked){
          $("view-admin").innerHTML = `
            <section class="admin-gate">
              <div class="panel login-card">
                <img src="${LOGO_DATA}" alt="Wulin">
                <h2>STAFF ADMIN · 后台管理</h2>
                <p class="subtle">Sign in to schedule courts, enter or correct scores, control On Deck, and generate Playoffs. All changes sync through Supabase. · 工作人员专用</p>
                <div style="margin:18px 0 10px">
                  <input id="adminPassword" type="password" inputmode="numeric" placeholder="STAFF PIN · 工作人员密码">
                </div>
                <button class="primary" data-action="unlock-admin">OPEN STAFF ADMIN · 打开后台</button>
                <p class="subtle" style="margin-top:12px">The PIN is stored in Vercel as <span class="kbd">ADMIN_PIN</span>, not in browser code.</p>
                <div class="cloud-note">A Vercel Function issues an HttpOnly staff-session cookie. The Supabase Secret Key remains server-side only. · 云端安全写入</div>
              </div>
            </section>`;
          return;
        }

        const activeCats = getActiveCats();
        if (adminCatFilter !== "all" && !activeCats.some(cat => cat.id === adminCatFilter)) adminCatFilter = "all";
        if (!state.categories.some(cat => cat.id === adminSettingsCatId)) adminSettingsCatId = activeCats[0]?.id || state.categories[0]?.id || "";
        const settingsCat = getCat(adminSettingsCatId);
        const catOptions = [`<option value="all">ALL ACTIVE CATEGORIES · 全部</option>`].concat(activeCats.map(cat => `<option value="${cat.id}" ${adminCatFilter === cat.id ? "selected" : ""}>${escapeHtml(cat.name)}</option>`)).join("");
        cleanPrepareMatchIds();
        const manualPrepare = (state.settings.prepareMatchIds || []).map(id => getMatch(id)).filter(Boolean);
        const queued = state.matches
          .slice()
          .sort(sortByPriorityThenMatches)
          .filter(match => isMatchReady(match) && !!getCat(match.catId)?.active)
          .filter(match => adminCatFilter === "all" || match.catId === adminCatFilter)
          .slice(0, 40);
        const held = state.matches
          .slice()
          .filter(match => match.status === "queued" && match.hold && !!getCat(match.catId)?.active)
          .filter(match => adminCatFilter === "all" || match.catId === adminCatFilter)
          .sort(sortMatches)
          .slice(0, 24);
        const completed = state.matches
          .slice()
          .filter(match => match.status === "done" && match.teamAId !== "BYE" && match.teamBId !== "BYE" && !!getCat(match.catId)?.active)
          .filter(match => adminCatFilter === "all" || match.catId === adminCatFilter)
          .sort((a,b) => (Number(b.finishedAt || 0) - Number(a.finishedAt || 0)) || sortMatches(a,b))
          .slice(0, 50);

        $("view-admin").innerHTML = `
          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>TOURNAMENT CONTROL · 赛事中控</h2>
                <div class="subtle">Team-based scoring, live court scheduling, standings and Playoff control. · 队伍赛计分与排场</div>
                <div class="cloud-note">Cloud row v${cloudVersion || "-"} · ${pendingSave ? "CHANGES WAITING TO SYNC · 待同步" : "SYNCED WITH SUPABASE · 已同步"} · Optimistic version locking prevents silent overwrite.</div>
              </div>
              <div class="admin-actions">
                <button class="ghost" data-action="show-view" data-view="operations">OPEN TV 1 · COURTS</button>
                <button class="ghost" data-action="show-view" data-view="results">OPEN TV 2 · RESULTS</button>
                <button class="danger" data-action="logout-admin">LOCK ADMIN · 锁定后台</button>
              </div>
            </div>
            <div class="form-grid-4">
              <div>
                <label>EVENT NAME · 赛事名称</label>
                <input id="eventNameInput" data-action="event-name-input" value="${escapeHtml(state.settings.eventName)}">
              </div>
              <div>
                <label>QUEUE FILTER · 排场筛选</label>
                <select id="adminCatFilter" data-action="admin-cat-filter">${catOptions}</select>
              </div>
              <div>
                <label>AUTO-SCHEDULE NEXT · 自动排下一场</label>
                <select id="autoNextSelect" data-action="auto-next">
                  <option value="true" ${state.settings.autoNext ? "selected" : ""}>ON · Use the same Court route</option>
                  <option value="false" ${!state.settings.autoNext ? "selected" : ""}>OFF · Release court only</option>
                </select>
              </div>
              <div>
                <label>TV 1 ON DECK COUNT · 候场数量</label>
                <select id="prepareLimitSelect" data-action="prepare-limit">
                  ${[3,4,5,6].map(count => `<option value="${count}" ${Number(state.settings.prepareLimit || 6) === count ? "selected" : ""}>NEXT ${count} GAMES</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="admin-actions" style="margin-top:12px">
              <button class="success" data-action="fill-empty-courts">FILL ALL OPEN COURTS · 填满空场</button>
              <button class="ghost" data-action="export-json">EXPORT BACKUP JSON · 导出</button>
              <button class="ghost" data-action="trigger-import">IMPORT JSON · 导入</button>
              <button class="warn" data-action="load-sample">LOAD DEMO DATA · 示例</button>
              <button class="danger" data-action="clear-data">CLEAR ALL DATA · 清空</button>
              <input id="importFile" type="file" accept="application/json" style="display:none">
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>CURRENT SESSION · 当前时段</h2>
                <div class="subtle session-help">Enable only the Categories running in the current morning or afternoon session. Queue, automatic scheduling, Court routes and TV 1 use Active Categories only. · 上午下午分别开启</div>
              </div>
              <span class="pill green">${activeCats.length}/${state.categories.length} ACTIVE</span>
            </div>
            <div class="active-session-grid">
              ${state.categories.length ? state.categories.map(renderActiveCatControl).join("") : `<div class="empty-state">Create a Category first. · 请先新增项目</div>`}
            </div>
          </section>

          <section class="panel court-control-panel">
            <div class="panel-title">
              <div>
                <h2>SIX-COURT CONTROL · 六场地中控</h2>
                <div class="subtle">Use ROUTES on each Court to choose eligible Active Categories and Pools. All six courts remain visible in a 3 × 2 landscape grid. · 一眼查看六场</div>
              </div>
              <span class="pill">${state.matches.filter(match => match.status === "playing").length}/${state.settings.courts.length} IN USE</span>
            </div>
            <div class="admin-courts">
              ${state.settings.courts.map(court => renderCourtCard(court, true)).join("")}
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>TV 1 ON DECK · 候场队伍</h2>
                <div class="subtle">Staff choices stay at the top, can show an expected future Court, and remain visible even while a team is finishing its current match. · 可预排接场</div>
              </div>
              <div class="admin-actions">
                <span class="pill gold">SHOW NEXT ${Number(state.settings.prepareLimit || 6)}</span>
                <button class="ghost" data-action="clear-prepare-list">CLEAR STAFF PICKS · 清空人工准备</button>
              </div>
            </div>
            <div class="priority-list">
              ${manualPrepare.length ? manualPrepare.map((match, index) => renderPrepareControlRow(match, index)).join("") : `<div class="empty-state">No staff-priority match yet. Use ADD ON DECK below; remaining TV slots are filled automatically by Court Category / Pool routes. · 其余自动补位</div>`}
            </div>
            ${held.length ? `<div style="height:12px"></div><div class="panel-title"><h3>ON HOLD · 暂缓 / 找不到 / 时间冲突</h3><span class="pill red">${held.length}</span></div><div class="priority-list">${held.map(renderHeldRow).join("")}</div>` : ""}
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>MATCH QUEUE · 待安排比赛</h2>
                <div class="subtle">Ready matches include teams that may still be playing: staff can pre-plan them for late-stage back-to-back play, while direct Court assignment remains blocked until both teams are free. · 可提前加入 On Deck</div>
              </div>
              <span class="pill">${queued.length} SHOWN</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>#</th><th>CATEGORY</th><th>POOL / RR ROUND</th><th>TEAMS</th><th>ON DECK / COURT ACTION</th></tr></thead>
                <tbody>
                  ${queued.length ? queued.map((match, index) => renderQueueRow(match, index)).join("") : `<tr><td colspan="5"><div class="empty-state">No ready match. A Playoff may be waiting for winners, or the Category / Pool has no Court route. · 暂无可排比赛</div></td></tr>`}
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>SCORE CORRECTIONS · 已完成比分修改</h2>
                <div class="subtle">Round Robin standings recalculate immediately. If a Playoff winner changes, affected downstream slots are cleared and rebuilt. · 修正后自动更新</div>
              </div>
              <span class="pill">LATEST ${completed.length}</span>
            </div>
            <div>
              ${completed.length ? completed.map(renderCompletedScoreRow).join("") : `<div class="empty-state">No completed match under the current filter. · 暂无已完成比赛</div>`}
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>CATEGORY / POOL / PLAYOFF SETUP · 项目设置</h2>
                <div class="subtle">Choose a Category tab, then a Pool tab. Playoff setup now shows every team in every Pool for staff verification. · 完整排名核对</div>
              </div>
              ${settingsCat ? `<span class="pill ${settingsCat.active ? "green" : ""}">${settingsCat.active ? "ACTIVE" : "INACTIVE"}</span>` : ""}
            </div>
            <div class="cat-settings-tabs">
              ${state.categories.map(cat => `<button class="settings-tab ${cat.id === adminSettingsCatId ? "active" : ""}" data-action="cat-settings-tab" data-cat-id="${cat.id}"><span class="state-dot ${cat.active ? "active" : ""}"></span>${escapeHtml(cat.name)}</button>`).join("")}
            </div>
            <div class="cat-list single">
              ${settingsCat ? renderCatCard(settingsCat) : `<div class="empty-state">No Category yet. Add one below. · 尚未建立项目</div>`}
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>ADD CATEGORY · 新增项目</h2>
                <div class="subtle">Enter one team per line. Separate multiple Pools with a blank line; make the first line of each block the Pool name. · 每行一队</div>
              </div>
            </div>
            <div class="form-grid">
              <div>
                <label>CATEGORY NAME · 项目名称</label>
                <input id="newCatName" placeholder="Example: Men's Doubles 4.0+">
              </div>
              <div>
                <label>DEFAULT QUALIFIERS PER POOL · 每组出线人数</label>
                <input id="newCatAdvance" type="number" min="1" value="2">
              </div>
            </div>
            <div style="height:10px"></div>
            <label>POOLS & TEAMS · 小组与队伍</label>
            <textarea id="newCatPools" spellcheck="false">Pool A
Team 1 / Team 2
Team 3 / Team 4
Team 5 / Team 6

Pool B
Team 7 / Team 8
Team 9 / Team 10
Team 11 / Team 12</textarea>
            <div class="admin-actions" style="margin-top:12px">
              <button class="primary" data-action="add-cat">ADD CATEGORY & GENERATE RR · 新增并排表</button>
            </div>
            <div class="hint" style="margin-top:12px">Each line is one team. Round Robin is generated within each Pool; two-Pool Playoff seeding crosses A1 v B2 and A2 v B1. · 双 Pool 交叉出线</div>
          </section>

          <section class="panel">
            <div class="panel-title"><h2>COURT NAMES · 场地名称</h2></div>
            <div class="form-grid-3">
              ${state.settings.courts.map(court => `<div><label>${escapeHtml(court.id)}</label><input data-action="court-name-input" data-court-id="${court.id}" value="${escapeHtml(court.name)}"></div>`).join("")}
            </div>
            <div class="qr-dock">
              <div class="subtle">Optional community QR assets · 可选二维码：</div>
              <img src="${WECHAT_QR}" alt="WeChat QR">
              <img src="${COMMUNITY_QR}" alt="Community QR">
            </div>
          </section>
        `;
      }



      function renderMatchMeta(m){
        const cat = getCat(m.catId);
        const pool = getPool(m.catId, m.poolId);
        return `${escapeHtml(cat?.name || "")} · ${escapeHtml(matchRoundLabel(m))}${pool ? " · " + escapeHtml(pool.name) : ""} · ${escapeHtml(matchCode(m))}`;
      }

      function renderPrepareControlRow(m, idx){
        const potentialCourts = potentialCourtsForMatch(m);
        const busy = playingTeamIds();
        const busyNow = busy.has(m.teamAId) || busy.has(m.teamBId);
        return `<article class="priority-card ${busyNow ? "busy-next" : ""}">
          <div class="priority-topline">
            <div><span class="pill gold">#${idx+1}</span> <span class="pill">${renderMatchMeta(m)}</span>${busyNow ? ` <span class="pill blue">PLAYING NOW · 打完接场</span>` : ""}</div>
            <div class="queue-row-actions">
              <button class="small ghost" data-action="prepare-up" data-match-id="${m.id}">MOVE UP · 上移</button>
              <button class="small ghost" data-action="prepare-down" data-match-id="${m.id}">MOVE DOWN · 下移</button>
              <button class="small danger" data-action="unprepare-match" data-match-id="${m.id}">REMOVE · 移除</button>
            </div>
          </div>
          <div class="prepare-admin-grid">
            <div>${matchTeamsHtml(m, true)}</div>
            <label class="future-court-select">
              <span>EXPECTED COURT · 预定场地</span>
              <select data-action="prepare-court-select" data-match-id="${m.id}">
                <option value="" ${m.preferredCourtId ? "" : "selected"}>COURT TBD · 待定</option>
                ${potentialCourts.map(court => `<option value="${court.id}" ${m.preferredCourtId === court.id ? "selected" : ""}>${escapeHtml(court.name)}</option>`).join("")}
              </select>
              <small>${potentialCourts.length ? "Shown on TV 1 so players know where to wait. · 大屏显示预计场地" : "No court route accepts this Category / Pool yet. · 尚未开放场地"}</small>
            </label>
          </div>
        </article>`;
      }



      function renderHeldRow(m){
        return `<article class="priority-card hold">
          <div class="priority-topline">
            <div><span class="pill red">HOLD · 暂缓</span> <span class="pill">${renderMatchMeta(m)}</span></div>
            <div class="queue-row-actions">
              <button class="small success" data-action="release-match" data-match-id="${m.id}">RETURN TO QUEUE · 恢复</button>
              <button class="small warn" data-action="release-and-top" data-match-id="${m.id}">RESTORE & PRIORITY · 恢复置顶</button>
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
            <div class="subtle">${escapeHtml(matchRoundLabel(m))}${pool ? " · " + escapeHtml(pool.name) : ""} · ${escapeHtml(matchCode(m))}</div>
          </div>
          <div><strong>${escapeHtml(sideDisplay(m,"A"))}</strong> vs <strong>${escapeHtml(sideDisplay(m,"B"))}</strong></div>
          <div class="score-edit-inputs">
            <input id="editScoreA_${m.id}" inputmode="numeric" aria-label="Team A corrected score" ${lockedAutoBye ? "disabled" : ""} value="${escapeHtml(m.scoreA ?? "")}">
            <input id="editScoreB_${m.id}" inputmode="numeric" aria-label="Team B corrected score" ${lockedAutoBye ? "disabled" : ""} value="${escapeHtml(m.scoreB ?? "")}">
          </div>
          <div class="queue-row-actions">
            ${lockedAutoBye ? `<span class="pill">AUTO BYE · 自动轮空</span>` : `<button class="small success" data-action="save-score-edit" data-match-id="${m.id}">SAVE CORRECTION · 保存修改</button>`}
          </div>
        </div>`;
      }



      function renderQueueRow(m, idx){
        const cat = getCat(m.catId);
        const pool = getPool(m.catId, m.poolId);
        const courts = eligibleCourtsForMatch(m);
        const potential = potentialCourtsForMatch(m);
        const busy = playingTeamIds();
        const blocked = busy.has(m.teamAId) || busy.has(m.teamBId);
        const prepared = isManuallyPrepared(m.id);
        const preferred = preferredCourtForMatch(m);
        return `<tr>
          <td>${idx+1}</td>
          <td>${escapeHtml(cat?.name || "")}</td>
          <td><div class="queue-round">${escapeHtml(matchRoundLabel(m))}</div><div class="queue-pool">${pool ? escapeHtml(pool.name) : escapeHtml(stageName(m.stage))}</div></td>
          <td><strong>${escapeHtml(sideDisplay(m,"A"))}</strong> vs <strong>${escapeHtml(sideDisplay(m,"B"))}</strong>${preferred ? `<div class="queue-pool">ON DECK → ${escapeHtml(preferred.name)}</div>` : ""}</td>
          <td>
            <div class="queue-row-actions">
              <button class="small warn" data-action="prepare-match" data-match-id="${m.id}">${prepared ? "ON DECK · 已加入" : "ADD ON DECK · 加入准备"}</button>
              <button class="small ghost" data-action="prepare-top" data-match-id="${m.id}">PRIORITY · 置顶</button>
              <button class="small danger" data-action="hold-match" data-match-id="${m.id}">HOLD · 暂缓</button>
              ${blocked ? `<span class="pill blue">PLAYING NOW · MAY PLAN NEXT · 可预排</span>` : courts.length ? courts.map(court => `<button class="small success" data-action="assign-match" data-match-id="${m.id}" data-court-id="${court.id}">${escapeHtml(court.name)}</button>`).join("") : `<span class="pill empty">${potential.length ? "COURTS BUSY · 场地使用中" : "NO ROUTE · 未分配 Cat/Pool"}</span>`}
            </div>
          </td>
        </tr>`;
      }



      function collectQualifiersForCat(cat){
        if (!cat) return [];
        const qualifiers = [];
        cat.pools.forEach(pool => {
          const standings = computeStandings(cat.id, pool.id);
          const take = Math.max(0, Math.min(Number(pool.advance || 0), standings.length));
          standings.slice(0, take).forEach((row, index) => {
            qualifiers.push({
              teamId: row.teamId,
              name: row.name,
              poolId: pool.id,
              poolName: pool.name,
              rank: index + 1,
              points: row.points,
              diff: row.diff,
              scored: row.for
            });
          });
        });
        return qualifiers;
      }

      function renderAdminFullStandings(cat){
        return `<div class="admin-standings-grid">
          ${cat.pools.map(pool => {
            const rows = computeStandings(cat.id, pool.id);
            return `<div class="pool-rank admin-full-ranking">
              <table>
                <thead>
                  <tr><th colspan="9">${escapeHtml(pool.name)} · FULL STANDINGS · 完整排名</th></tr>
                  <tr><th>#</th><th>TEAM</th><th>P</th><th>W</th><th>L</th><th>PTS</th><th>H2H / TB</th><th>DIFF</th><th>PF</th></tr>
                </thead>
                <tbody>
                  ${rows.length ? rows.map((row, index) => `<tr class="${index < Number(pool.advance || 0) ? "qualifier" : ""}">
                    <td>${index + 1}</td>
                    <td><strong>${escapeHtml(row.name)}</strong></td>
                    <td>${row.played}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.points}</td>
                    <td class="tie-break-cell">${escapeHtml(standingsTieBreakText(row))}</td>
                    <td>${row.diff > 0 ? "+" : ""}${row.diff}</td><td>${row.for}</td>
                  </tr>`).join("") : `<tr><td colspan="9">No teams · 暂无队伍</td></tr>`}
                </tbody>
              </table>
            </div>`;
          }).join("")}
        </div>`;
      }

      function renderPlayoffSeedAudit(cat){
        const qualifiers = collectQualifiersForCat(cat);
        const bracketSize = qualifiers.length >= 2 ? nextPowerOfTwo(qualifiers.length) : 0;
        const pairs = qualifiers.length >= 2 ? buildFirstRoundPairs(cat.pools, qualifiers, bracketSize) : [];
        return `<div class="playoff-audit">
          <div class="playoff-audit-head">
            <div>
              <strong>QUALIFIER CHECK · 出线核对</strong>
              <div class="subtle">All Pool standings are shown below. Two-Pool Top-2 format is always A1 v B2 and A2 v B1. · 双 Pool 交叉半决赛</div>
            </div>
            <span class="pill gold">${qualifiers.length} QUALIFIERS</span>
          </div>
          ${renderAdminFullStandings(cat)}
          <div class="opening-pairings">
            <div class="settings-section-title">EXPECTED OPENING ROUND · 预计首轮对阵</div>
            ${pairs.length ? `<div class="opening-pair-grid">${pairs.map((pair, index) => {
              const left = pair[0];
              const right = pair[1];
              const seedText = seed => seed?.teamId === "BYE" ? "BYE" : `${seed?.poolName || "Pool"} #${seed?.rank || "?"}`;
              return `<article class="opening-pair-card">
                <span class="pill blue">MATCH ${index + 1}</span>
                <div><small>${escapeHtml(seedText(left))}</small><strong>${escapeHtml(left?.name || "TBD")}</strong></div>
                <b>VS</b>
                <div><small>${escapeHtml(seedText(right))}</small><strong>${escapeHtml(right?.name || "TBD")}</strong></div>
              </article>`;
            }).join("")}</div>` : `<div class="empty-state">At least two qualified teams are required. · 至少需要两支出线队伍</div>`}
          </div>
        </div>`;
      }

      function renderCatCard(cat){
        const rrMatches = state.matches.filter(m => m.catId === cat.id && m.stage === "RR");
        const rrDone = rrMatches.filter(m => m.status === "done").length;
        const playoffMatches = state.matches.filter(m => m.catId === cat.id && m.stage !== "RR");
        const progress = categoryProgress(cat.id);
        const rememberedPoolId = adminPoolTabByCat[cat.id];
        const selectedPool = cat.pools.find(pool => pool.id === rememberedPoolId) || cat.pools[0] || null;
        if (selectedPool) adminPoolTabByCat[cat.id] = selectedPool.id;
        const selectedRows = selectedPool ? computeStandings(cat.id, selectedPool.id) : [];
        return `<article class="cat-card cat-settings-card">
          <div class="panel-title">
            <div>
              <h3>${escapeHtml(cat.name)}</h3>
              <div class="active-summary-row">
                <span class="pill ${cat.active ? "green" : ""}">${cat.active ? "ACTIVE · 当前时段" : "INACTIVE · 未开场"}</span>
                <span class="pill round-focus">${escapeHtml(progress.roundText)}</span>
                <span class="pill">RR ${rrDone}/${rrMatches.length}</span>
                <span class="pill">PLAYOFF ${playoffMatches.length}</span>
              </div>
            </div>
            <span class="pill ${cat.status === "playoff" ? "blue" : "gold"}">${cat.status === "playoff" ? "PLAYOFF" : "ROUND ROBIN"}</span>
          </div>

          <div class="inline-edit-grid">
            <div>
              <label>CATEGORY NAME · 项目名称</label>
              <input class="compact-input" data-action="cat-name-input" data-cat-id="${cat.id}" value="${escapeHtml(cat.name)}">
            </div>
            <div>
              <label>CURRENT SESSION STATUS · 当前时段</label>
              <label class="mini-check ${cat.active ? "active" : ""}" style="margin-top:1px">
                <input type="checkbox" data-action="cat-active-toggle" data-cat-id="${cat.id}" ${cat.active ? "checked" : ""}>
                ${cat.active ? "ACTIVE · Included in Queue" : "INACTIVE · Not scheduling"}
              </label>
            </div>
          </div>

          <div class="settings-section-title">POOL & TEAMS · 小组与队伍</div>
          <div class="pool-settings-tabs">
            ${cat.pools.map(pool => `<button class="pool-settings-tab ${selectedPool?.id === pool.id ? "active" : ""}" data-action="pool-settings-tab" data-cat-id="${cat.id}" data-pool-id="${pool.id}">${escapeHtml(pool.name)} · ${pool.teams.length} TEAMS</button>`).join("")}
          </div>
          ${selectedPool ? `<div class="pool-rank selected-pool-editor">
            <div class="inline-edit-grid">
              <div>
                <label>POOL NAME · 小组名称</label>
                <input class="compact-input" data-action="pool-name-input" data-cat-id="${cat.id}" data-pool-id="${selectedPool.id}" value="${escapeHtml(selectedPool.name)}">
              </div>
              <div>
                <label>PLAYOFF QUALIFIERS · 出线人数</label>
                <input class="compact-input" type="number" min="0" max="${Math.max(1, selectedPool.teams.length)}" data-action="pool-advance-input" data-cat-id="${cat.id}" data-pool-id="${selectedPool.id}" value="${Number(selectedPool.advance || 0)}">
              </div>
            </div>
            <div class="team-edit-grid">
              ${selectedPool.teams.map((team, teamIndex) => `<label class="team-edit-row"><span>TEAM ${teamIndex+1}</span><input data-action="team-name-input" data-cat-id="${cat.id}" data-pool-id="${selectedPool.id}" data-team-id="${team.id}" value="${escapeHtml(team.name)}"></label>`).join("")}
            </div>
            <div class="pool-rank" style="margin-top:12px">
              <table>
                <thead><tr><th colspan="9">${escapeHtml(selectedPool.name)} · FULL STANDINGS · 完整排名</th></tr><tr><th>#</th><th>TEAM</th><th>P</th><th>W</th><th>L</th><th>PTS</th><th>H2H / TB</th><th>DIFF</th><th>PF</th></tr></thead>
                <tbody>${selectedRows.map((row,index) => `<tr class="${index < Number(selectedPool.advance || 0) ? "qualifier" : ""}"><td>${index+1}</td><td><strong>${escapeHtml(row.name)}</strong></td><td>${row.played}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.points}</td><td class="tie-break-cell">${escapeHtml(standingsTieBreakText(row))}</td><td>${row.diff > 0 ? "+" : ""}${row.diff}</td><td>${row.for}</td></tr>`).join("")}</tbody>
              </table>
            </div>
          </div>` : `<div class="empty-state">No Pool has been created for this Category. · 尚未建立 Pool</div>`}

          <div class="settings-divider"></div>
          <div class="settings-section-title">COURT ACCESS · 场地分配</div>
          <div class="subtle">For live operations, edit Category and Pool routes directly from each Court card above. · 日常调整建议使用上方 Court ROUTES</div>
          <div class="court-checks">
            ${state.settings.courts.map(court => {
              const checked = courtHasCatAccess(court, cat);
              return `<label class="mini-check ${checked ? "active" : ""}" title="${court.allowAllActive ? "This court accepts every Active Category" : ""}">
                <input type="checkbox" data-action="cat-court-toggle" data-cat-id="${cat.id}" value="${court.id}" ${checked ? "checked" : ""}>
                ${escapeHtml(court.name)}${court.allowAllActive && cat.active ? " · ALL ACTIVE" : ""}
              </label>`;
            }).join("")}
          </div>

          <div class="settings-divider"></div>
          <div class="settings-section-title">PLAYOFF SETTINGS · 淘汰赛</div>
          <div class="inline-edit-grid">
            <div>
              <label>THIRD PLACE RULE · 季军规则</label>
              <select class="compact-input" data-action="cat-thirdplace-input" data-cat-id="${cat.id}">
                <option value="margin" ${cat.playoffThirdPlace !== "bronze" ? "selected" : ""}>NO BRONZE MATCH · Rank semifinal losers by loss margin</option>
                <option value="bronze" ${cat.playoffThirdPlace === "bronze" ? "selected" : ""}>PLAY THIRD PLACE MATCH · 生成三四名赛</option>
              </select>
            </div>
            <div>
              <label>CURRENT RULE · 当前规则</label>
              <input class="compact-input" value="${escapeHtml(thirdPlaceRuleLabel(cat))}" disabled>
            </div>
          </div>

          ${renderPlayoffSeedAudit(cat)}

          <div class="admin-actions">
            <button class="ghost" data-action="generate-rr" data-cat-id="${cat.id}">REGENERATE ROUND ROBIN · 重排 RR</button>
            <button class="primary" data-action="generate-playoff" data-cat-id="${cat.id}">${playoffMatches.length ? "REGENERATE PLAYOFF · 重排淘汰赛" : "GENERATE PLAYOFF · 生成淘汰赛"}</button>
            <button class="danger" data-action="delete-cat" data-cat-id="${cat.id}">DELETE CATEGORY · 删除</button>
          </div>
        </article>`;
      }



      function computeStandings(catId, poolId){
        const pool = getPool(catId, poolId);
        if (!pool) return [];
        const rrMatches = state.matches.filter(match => match.catId === catId && match.poolId === poolId && match.stage === "RR");
        return calculateStandings(pool.teams, rrMatches, "en");
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
                preferredCourtId: "",
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
        const qualifiers = collectQualifiersForCat(cat);
        if (qualifiers.length < 2) {
          showToast("At least two qualified teams are required. · 至少需要 2 支出线队伍");
          return 0;
        }

        state.matches = state.matches.filter(match => !(match.catId === catId && match.stage !== "RR"));
        const bracketSize = nextPowerOfTwo(qualifiers.length);
        const firstPairs = buildFirstRoundPairs(cat.pools, qualifiers, bracketSize);

        const roundsTotal = Math.log2(bracketSize);
        const roundMatches = [];
        let sequence = (state.matches.reduce((max, match) => Math.max(max, Number(match.sequence || 0)), 0) || 0) + 1;
        const firstRound = [];
        firstPairs.forEach((pair, index) => {
          const match = {
            id: uid("match"),
            catId: cat.id,
            poolId: "",
            stage: playoffStageName(1, roundsTotal),
            round: 1,
            teamAId: pair[0]?.teamId || "",
            teamBId: pair[1]?.teamId || "",
            seedA: pair[0],
            seedB: pair[1],
            status: "queued",
            courtId: "",
            preferredCourtId: "",
            scoreA: "",
            scoreB: "",
            winnerId: "",
            sequence: sequence++,
            bracketIndex: index,
            createdAt: Date.now()
          };
          firstRound.push(match);
          state.matches.push(match);
        });
        roundMatches.push(firstRound);

        for (let round = 2; round <= roundsTotal; round += 1){
          const previous = roundMatches[round - 2];
          const matches = [];
          for (let index = 0; index < previous.length / 2; index += 1){
            const match = {
              id: uid("match"),
              catId: cat.id,
              poolId: "",
              stage: playoffStageName(round, roundsTotal),
              round,
              teamAId: "",
              teamBId: "",
              teamAFrom: previous[index * 2].id,
              teamBFrom: previous[index * 2 + 1].id,
              status: "waiting",
              courtId: "",
              preferredCourtId: "",
              scoreA: "",
              scoreB: "",
              winnerId: "",
              sequence: sequence++,
              bracketIndex: index,
              createdAt: Date.now()
            };
            previous[index * 2].feedsTo = match.id;
            previous[index * 2].feedsSide = "A";
            previous[index * 2 + 1].feedsTo = match.id;
            previous[index * 2 + 1].feedsSide = "B";
            matches.push(match);
            state.matches.push(match);
          }
          roundMatches.push(matches);
        }

        if (cat.playoffThirdPlace === "bronze" && qualifiers.length >= 4 && roundsTotal >= 2){
          const semifinalMatches = roundMatches[roundsTotal - 2] || [];
          const finalMatch = (roundMatches[roundsTotal - 1] || [])[0];
          if (semifinalMatches.length >= 2){
            const bronze = {
              id: uid("match"),
              catId: cat.id,
              poolId: "",
              stage: "BR",
              round: roundsTotal,
              teamAId: "",
              teamBId: "",
              teamAFrom: semifinalMatches[0].id,
              teamBFrom: semifinalMatches[1].id,
              teamAFromType: "loser",
              teamBFromType: "loser",
              status: "waiting",
              courtId: "",
              preferredCourtId: "",
              scoreA: "",
              scoreB: "",
              winnerId: "",
              sequence: finalMatch ? Number(finalMatch.sequence || sequence) - 0.5 : sequence++,
              bracketIndex: 99,
              createdAt: Date.now()
            };
            semifinalMatches[0].loserFeedsTo = bronze.id;
            semifinalMatches[0].loserFeedsSide = "A";
            semifinalMatches[1].loserFeedsTo = bronze.id;
            semifinalMatches[1].loserFeedsSide = "B";
            state.matches.push(bronze);
          }
        }

        cat.status = "playoff";
        runAutoByes(cat.id);
        return state.matches.filter(match => match.catId === cat.id && match.stage !== "RR").length;
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
          showToast("Enter a numeric score for both teams. · 请输入两边比分");
          return;
        }
        if (a === b) {
          showToast("The scores cannot be tied. Confirm the winner. · 比分不能相同");
          return;
        }
        const courtId = m.courtId;
        const catId = m.catId;
        m.scoreA = String(a);
        m.scoreB = String(b);
        m.winnerId = a > b ? m.teamAId : m.teamBId;
        m.status = "done";
        m.courtId = "";
        m.preferredCourtId = "";
        removePrepareMatch(m.id);
        m.finishedAt = Date.now();
        if (m.stage !== "RR") {
          propagateMatchResult(m);
        }
        saveState();

        if (state.settings.autoNext && courtId) {
          const assigned = assignNextToCourt(courtId, catId) || assignNextToCourt(courtId, adminCatFilter);
          if (assigned) showToast("Score saved and the next eligible match was loaded. · 已完成并自动排下一场");
          else showToast("Score saved. No eligible next match fits this Court route. · 此场暂无可排比赛");
        } else {
          showToast("Score saved and the Court is now open. · 比分已保存");
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
        m.preferredCourtId = "";
        removePrepareMatch(m.id);
        m.startedAt = Date.now();
        return m;
      }

      function assignSpecific(matchId, courtId){
        if (currentPlayingByCourt(courtId)) {
          showToast("This Court is already in use. · 场地正在比赛");
          return;
        }
        const m = state.matches.find(x => x.id === matchId);
        if (!m || !isMatchReady(m)) {
          showToast("This match is not ready to be scheduled. · 比赛尚未就绪");
          return;
        }
        const busy = playingTeamIds();
        if (busy.has(m.teamAId) || busy.has(m.teamBId)) {
          showToast("One of these teams is already playing on another Court. · 队伍正在比赛");
          return;
        }
        if (!courtCanRunMatch(courtId, m)) {
          showToast("This court is not enabled for this category / pool. · 该场地未开放给此项目或 Pool");
          return;
        }
        m.status = "playing";
        m.courtId = courtId;
        m.preferredCourtId = "";
        removePrepareMatch(m.id);
        m.startedAt = Date.now();
        saveState();
        renderAll();
        showToast("Match started on " + (getCourt(courtId)?.name || "Court") + ". · 已安排");
      }

      function returnToQueue(matchId){
        const m = state.matches.find(x => x.id === matchId);
        if (!m || m.status !== "playing") return;
        m.status = "queued";
        m.courtId = "";
        m.preferredCourtId = "";
        m.scoreA = m.scoreA || "";
        m.scoreB = m.scoreB || "";
        saveState();
        renderAll();
        showToast("Match returned to the Queue. · 已退回队列");
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
          showToast("An automatic BYE result does not need score correction. · 自动轮空无需修改");
          return;
        }
        const scoreA = $("editScoreA_" + matchId)?.value.trim();
        const scoreB = $("editScoreB_" + matchId)?.value.trim();
        const a = Number(scoreA);
        const b = Number(scoreB);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          showToast("Enter a numeric score for both teams. · 请输入两边比分");
          return;
        }
        if (a === b) {
          showToast("The scores cannot be tied. Confirm the winner. · 比分不能相同");
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
        showToast(m.stage === "RR" ? "Score corrected; Round Robin standings updated. · 排名已更新" : "Playoff score corrected; downstream bracket updated. · 晋级已更新");
      }

async function handleClick(e){
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "show-view"){
    currentView = btn.dataset.view;
    if (currentView !== "admin") openCourtAccessId = "";
    const url = new URL(window.location.href);
    url.searchParams.set("view", currentView);
    window.history.replaceState({}, "", url);
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
      showToast("Staff Admin unlocked; cloud write access is active. · 后台已打开");
      if (pendingSave) void flushCloudSave();
    }catch(err){
      showToast(err.message || "Incorrect staff PIN. · 密码不正确");
    }finally{
      btn.disabled = false;
    }
    return;
  }
  if (action === "logout-admin"){
    if (pendingSave) await flushCloudSave();
    openCourtAccessId = "";
    await logoutAdmin();
    showToast("Staff Admin locked. · 后台已锁定");
    return;
  }
  const writeActions = new Set([
    "finish-match","return-queue","assign-match","assign-next","fill-empty-courts",
    "generate-rr","generate-playoff","delete-cat","add-cat","add-court-to-cat",
    "clear-data","load-sample","prepare-match","prepare-top","prepare-up","prepare-down",
    "unprepare-match","clear-prepare-list","hold-match","release-match","release-and-top",
    "save-score-edit"
  ]);
  if (!adminUnlocked && writeActions.has(action)){
    showToast("Open Staff Admin before changing cloud data. · 请先登录后台");
    return;
  }
  if (action === "cat-settings-tab"){
    adminSettingsCatId = btn.dataset.catId || "";
    renderAdmin();
    return;
  }
  if (action === "pool-settings-tab"){
    adminSettingsCatId = btn.dataset.catId || adminSettingsCatId;
    adminPoolTabByCat[btn.dataset.catId] = btn.dataset.poolId;
    renderAdmin();
    return;
  }
  if (action === "toggle-court-access"){
    const courtId = btn.dataset.courtId || "";
    openCourtAccessId = openCourtAccessId === courtId ? "" : courtId;
    renderAdmin();
    return;
  }
  if (action === "close-court-access"){
    openCourtAccessId = "";
    renderAdmin();
    return;
  }
  if (action === "prepare-match" || action === "prepare-top"){
    const ok = setPrepareMatch(btn.dataset.matchId, action === "prepare-top");
    saveState();
    renderAll();
    showToast(ok ? (action === "prepare-top" ? "Pinned to the top of TV 1 On Deck. · 已置顶" : "Added to TV 1 On Deck. · 已加入候场") : "This match cannot be added to On Deck yet. · 尚不能加入候场");
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
    showToast("Removed from staff-priority On Deck. · 已移除候场");
    return;
  }
  if (action === "clear-prepare-list"){
    const previousPrepareIds = new Set(state.settings.prepareMatchIds || []);
    state.matches.forEach(match => {
      if (previousPrepareIds.has(match.id) && match.status === "queued") match.preferredCourtId = "";
    });
    state.settings.prepareMatchIds = [];
    saveState();
    renderAll();
    showToast("Staff-priority On Deck cleared; automatic Court routing will fill the board. · 已恢复自动候场");
    return;
  }
  if (action === "hold-match"){
    const m = getMatch(btn.dataset.matchId);
    if (m){
      m.hold = true;
      removePrepareMatch(m.id);
      saveState();
      renderAll();
      showToast("Match placed On Hold and removed from automatic scheduling. · 已暂缓");
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
      showToast(action === "release-and-top" ? "Returned to Queue and pinned to On Deck. · 已恢复置顶" : "Returned to the Queue. · 已恢复");
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
    showToast(count ? `${count} open Court(s) filled. · 已安排空场` : "No eligible match fits the open Court routes. · 暂无可安排比赛");
    return;
  }
  if (action === "assign-next"){
    const m = assignNextToCourt(btn.dataset.courtId, adminCatFilter);
    saveState();
    renderAll();
    showToast(m ? "Next eligible match loaded. · 已安排下一场" : "No eligible match fits this Court. · 暂无可安排比赛");
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
    if (existing && !confirm("Rebuilding Round Robin deletes this Category’s existing RR schedule and scores. Continue? · 重排会删除现有 RR 比分")) return;
    state.matches = state.matches.filter(m => !(m.catId === cat.id && m.stage === "RR"));
    generateRoundRobinForCat(state, cat.id, false);
    saveState();
    renderAll();
    showToast("Round Robin schedule rebuilt. · RR 已生成");
    return;
  }
  if (action === "generate-playoff"){
    const cat = getCat(btn.dataset.catId);
    if (!cat) return;
    const rrNotDone = state.matches.some(match => match.catId === cat.id && match.stage === "RR" && match.status !== "done");
    if (rrNotDone && !confirm("Round Robin is not complete. Generate Playoff from the current standings anyway? · RR 尚未全部完成，是否继续？")) return;
    const existingPlayoff = state.matches.filter(match => match.catId === cat.id && match.stage !== "RR");
    if (existingPlayoff.length && !confirm(`REGENERATE PLAYOFF for ${cat.name}? This deletes the existing ${existingPlayoff.length} Playoff match(es), scores and downstream results. Round Robin results remain unchanged. · 会删除现有淘汰赛结果，确认继续？`)) return;
    const count = generatePlayoffForCat(cat.id);
    saveState();
    renderAll();
    showToast(count ? `${count} Playoff matches generated · ${thirdPlaceRuleLabel(cat)}` : "Playoff was not generated. · 未生成");
    return;
  }
  if (action === "delete-cat"){
    const catId = btn.dataset.catId;
    const cat = getCat(catId);
    if (!cat) return;
    if (!confirm(`Delete ${cat.name}? Its schedule and scores will also be removed. · 确认删除项目？`)) return;
    state.categories = state.categories.filter(c => c.id !== catId);
    state.matches = state.matches.filter(m => m.catId !== catId);
    if (adminSettingsCatId === catId) adminSettingsCatId = "";
    delete adminPoolTabByCat[catId];
    state.settings.dashboardCatIds = state.settings.dashboardCatIds.filter(id => id !== catId);
    saveState();
    renderAll();
    showToast("Category deleted. · 项目已删除");
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
    if (!name){ showToast("Enter a Category name. · 请输入项目名称"); return; }
    if (!pools.length){ showToast("Enter at least one Pool with at least two teams. · 每组至少两队"); return; }
    const cat = addCategoryToState(state, name, pools, advance);
    adminSettingsCatId = cat.id;
    cat.courtIds = emptyCourts().slice(0, Math.min(2, state.settings.courts.length)).map(c => c.id);
    state.settings.courts.filter(c => c.allowAllActive).forEach(c => { if (!cat.courtIds.includes(c.id)) cat.courtIds.push(c.id); });
    generateRoundRobinForCat(state, cat.id, false);
    state.settings.dashboardCatIds.push(cat.id);
    saveState();
    renderAll();
    showToast("Category added and Round Robin created. · 已新增项目");
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
    if (!confirm("Loading demo data overwrites the current tournament state. Continue? · 示例会覆盖数据")) return;
    state = seedState();
    scheduleFilters = { catId: "all", status: "all" };
    adminCatFilter = "all";
    adminSettingsCatId = "";
    adminPoolTabByCat = {};
    saveState();
    renderAll();
    showToast("Demo data loaded. · 示例已载入");
    return;
  }
  if (action === "clear-data"){
    if (!confirm("Clear all tournament data? Export a JSON backup first. · 确认清空？")) return;
    state = createEmptyState();
    scheduleFilters = { catId: "all", status: "all" };
    adminCatFilter = "all";
    adminSettingsCatId = "";
    adminPoolTabByCat = {};
    saveState();
    renderAll();
    showToast("Tournament data cleared. · 数据已清空");
    return;
  }
}

function handleChange(e){
  const el = e.target;
  const action = el.dataset.action;
  if (!action) return;

  const cloudMutationActions = new Set([
    "dashboard-cat-toggle","auto-next","prepare-limit","cat-active-toggle",
    "court-all-active-toggle","court-cat-toggle","court-all-pools-toggle","court-pool-toggle",
    "prepare-court-select","cat-thirdplace-input","cat-court-toggle","pool-advance-input",
    "cat-name-input","pool-name-input","team-name-input"
  ]);
  if (!adminUnlocked && cloudMutationActions.has(action) && action !== "dashboard-cat-toggle"){
    showToast("Staff sign-in is required to change cloud settings. · 请先登录后台");
    renderAll();
    return;
  }

  if (action === "dashboard-cat-toggle"){
    if (!adminUnlocked){
      showToast("TV 2 display categories are staff-controlled. · 请先登录后台");
      renderResults();
      return;
    }
    const group = el.closest("[data-display-cat-group]") || document;
    state.settings.dashboardCatIds = Array.from(new Set(
      Array.from(group.querySelectorAll('[data-action="dashboard-cat-toggle"]:checked')).map(item => item.value)
    ));
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
  if (action === "prepare-limit"){
    state.settings.prepareLimit = Math.max(3, Math.min(6, Number(el.value || 6)));
    saveState();
    renderAll();
    showToast(`TV 1 will display the next ${state.settings.prepareLimit} games. · 候场数量已更新`);
    return;
  }
  if (action === "cat-active-toggle"){
    const cat = getCat(el.dataset.catId);
    if (!cat) return;
    const nextActive = !!el.checked;
    const liveCount = state.matches.filter(match => match.catId === cat.id && match.status === "playing").length;
    if (!nextActive && liveCount && !confirm(`${cat.name} still has ${liveCount} live match(es). It will stop receiving new matches, but live matches can be completed. Continue? · 确认停用？`)) {
      el.checked = true;
      return;
    }
    cat.active = nextActive;
    if (nextActive) {
      state.settings.courts.filter(court => court.allowAllActive).forEach(court => {
        if (!cat.courtIds.includes(court.id)) cat.courtIds.push(court.id);
        ensureCourtPoolAccess(court)[cat.id] = ["*"];
      });
    } else {
      state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => getMatch(id)?.catId !== cat.id);
      state.matches.filter(match => match.catId === cat.id && match.status === "queued").forEach(match => { match.preferredCourtId = ""; });
      if (adminCatFilter === cat.id) adminCatFilter = "all";
    }
    cleanPrepareMatchIds();
    saveState();
    renderAll();
    showToast(nextActive ? `${cat.name} is ACTIVE. · 已加入当前时段` : `${cat.name} is INACTIVE. · 已停止自动排场`);
    return;
  }
  if (action === "court-all-active-toggle"){
    setCourtAllActive(el.dataset.courtId, el.checked);
    saveState();
    renderAll();
    showToast(el.checked ? "Court accepts all Active Categories and Pools. · 已开放全部" : "Court routes cleared; select individual Categories / Pools. · 请重新选择");
    return;
  }
  if (action === "court-cat-toggle"){
    setCourtCatAccess(el.dataset.courtId, el.dataset.catId, el.checked);
    saveState();
    renderAll();
    return;
  }
  if (action === "court-all-pools-toggle"){
    setCourtAllPools(el.dataset.courtId, el.dataset.catId, el.checked);
    saveState();
    renderAll();
    showToast(el.checked ? "All Pools enabled for this Court. · 已开放全部 Pool" : "Pool routes can now be edited individually. · 可逐个选择 Pool");
    return;
  }
  if (action === "court-pool-toggle"){
    setCourtPoolAccess(el.dataset.courtId, el.dataset.catId, el.dataset.poolId, el.checked);
    saveState();
    renderAll();
    return;
  }
  if (action === "prepare-court-select"){
    const match = getMatch(el.dataset.matchId);
    if (!match || !isManuallyPrepared(match.id)) return;
    const courtId = el.value || "";
    if (courtId && !courtCanRunMatch(courtId, match)) {
      showToast("That Court route does not accept this Category / Pool. · 该场地未开放");
      renderAll();
      return;
    }
    match.preferredCourtId = courtId;
    saveState();
    renderAll();
    showToast(courtId ? `Expected Court: ${getCourt(courtId)?.name || courtId}. · 已设置预计场地` : "Expected Court cleared. · 已取消预计场地");
    return;
  }
  if (action === "cat-thirdplace-input"){
    const cat = getCat(el.dataset.catId);
    if (!cat) return;
    cat.playoffThirdPlace = el.value === "bronze" ? "bronze" : "margin";
    saveState();
    renderAll();
    showToast(cat.playoffThirdPlace === "bronze" ? "Third Place Match enabled. · 已设置季军赛" : "Third place will use semifinal loss margin. · 按半决赛分差");
    return;
  }
  if (action === "cat-court-toggle"){
    setCourtCatAccess(el.value, el.dataset.catId, el.checked);
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
    showToast("Name updated. · 名称已更新");
  }
}

function handleInput(e){
  const el = e.target;
  const action = el.dataset.action;
  if (action && !adminUnlocked){
    return;
  }
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
      adminSettingsCatId = "";
      adminPoolTabByCat = {};
      saveState();
      renderAll();
      showToast("JSON import completed. · 导入成功");
    }catch(err){
      console.error(err);
      showToast("JSON import failed. Check the file format. · 导入失败");
    }
  };
  reader.readAsText(file);
}


document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("input", handleInput);
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "importFile" && e.target.files?.[0]) {
    if (!adminUnlocked){
      showToast("Open Staff Admin first. · 请先打开后台");
      return;
    }
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
