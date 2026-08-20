import { createClient } from "@supabase/supabase-js";
import {
  buildPlayoffBracketPlan as buildPlayoffBracketPlanCore,
  computePoolStandings,
  isPoolAllowed,
  selectOnDeckEntries,
} from "./tournament-core.js";
import "./styles.css";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_PUBLISHABLE_KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
const EVENT_SLUG = String(import.meta.env.VITE_EVENT_SLUG || "wulin-annual-2026").trim();
const APP_STATE_VERSION = 8;
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
  raw.version = APP_STATE_VERSION;
  raw.settings = Object.assign(base.settings, raw.settings || {});
  raw.settings.courts = Array.isArray(raw.settings.courts) && raw.settings.courts.length ? raw.settings.courts : base.settings.courts;
  raw.settings.courts.forEach((court, idx) => {
    court.id = court.id || `court${idx+1}`;
    court.name = court.name || `Court ${idx+1}`;
    court.allowAllActive = !!court.allowAllActive;
    court.poolAccess = court.poolAccess && typeof court.poolAccess === "object" && !Array.isArray(court.poolAccess)
      ? court.poolAccess
      : {};
    Object.keys(court.poolAccess).forEach(catId => {
      const poolIds = court.poolAccess[catId];
      court.poolAccess[catId] = Array.isArray(poolIds) ? Array.from(new Set(poolIds.filter(Boolean))) : [];
    });
  });
  raw.settings.dashboardCatIds = Array.isArray(raw.settings.dashboardCatIds) ? raw.settings.dashboardCatIds : [];
  raw.settings.prepareLimit = Math.max(3, Math.min(6, Number(raw.settings.prepareLimit || 6)));
  raw.settings.prepareMatchIds = Array.isArray(raw.settings.prepareMatchIds) ? raw.settings.prepareMatchIds : [];
  raw.categories = Array.isArray(raw.categories) ? raw.categories : [];
  raw.matches = Array.isArray(raw.matches) ? raw.matches : [];
  raw.categories.forEach(cat => {
    cat.id = cat.id || uid("cat");
    cat.name = cat.name || "未命名 Cat";
    cat.status = cat.status || "rr";
    cat.playoffThirdPlace = ["bronze","margin"].includes(cat.playoffThirdPlace) ? cat.playoffThirdPlace : "margin";
    cat.playoffSeedOrder = Array.isArray(cat.playoffSeedOrder)
      ? Array.from(new Set(cat.playoffSeedOrder.filter(teamId => typeof teamId === "string" && teamId)))
      : [];
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
          team.name = team.name || "未命名队伍";
        }
      });
    });
    const categoryTeamIds = new Set(cat.pools.flatMap(pool => pool.teams.map(team => team.id)));
    cat.playoffSeedOrder = cat.playoffSeedOrder.filter(teamId => categoryTeamIds.has(teamId));
  });
  const categoryById = new Map(raw.categories.map(cat => [cat.id, cat]));
  raw.settings.courts.forEach(court => {
    const access = court.poolAccess || {};
    Object.keys(access).forEach(catId => {
      const cat = categoryById.get(catId);
      if (!cat) {
        delete access[catId];
        return;
      }
      const validPoolIds = new Set(cat.pools.map(pool => pool.id));
      access[catId] = (Array.isArray(access[catId]) ? access[catId] : []).filter(poolId => validPoolIds.has(poolId));
      if (access[catId].length === validPoolIds.size && validPoolIds.size > 0) delete access[catId];
    });
  });
  const courtIds = new Set(raw.settings.courts.map(court => court.id));
  raw.matches.forEach((m, idx) => {
    m.id = m.id || uid("match");
    m.status = m.status || "queued";
    m.hold = !!m.hold;
    m.sequence = Number.isFinite(Number(m.sequence)) ? Number(m.sequence) : idx + 1;
    m.prepareCourtId = typeof m.prepareCourtId === "string" && courtIds.has(m.prepareCourtId) ? m.prepareCourtId : "";
  });
  raw.categories.forEach(cat => {
    if (cat.active === null) {
      cat.active = cat.courtIds.length > 0 || raw.matches.some(m => m.catId === cat.id && m.status === "playing");
    }
  });
  return raw;
}

function createEmptyState(){
  return {
    version: APP_STATE_VERSION,
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
let openScoreCorrectionCatIds = new Set();
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
        const court1 = s.settings.courts.find(c => c.id === "court1");
        const court2 = s.settings.courts.find(c => c.id === "court2");
        const court5 = s.settings.courts.find(c => c.id === "court5");
        const court6 = s.settings.courts.find(c => c.id === "court6");
        if (court1) court1.poolAccess[s.categories[0].id] = [s.categories[0].pools[0].id];
        if (court2) court2.poolAccess[s.categories[0].id] = [s.categories[0].pools[1].id];
        if (court5) court5.poolAccess[s.categories[2].id] = [s.categories[2].pools[0].id];
        if (court6) court6.poolAccess[s.categories[2].id] = [s.categories[2].pools[1].id];
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

        const assignLive = (catId, courtIds) => {
          const busy = new Set();
          const candidates = s.matches.filter(m => m.catId === catId && m.stage === "RR" && m.status === "queued");
          courtIds.forEach(courtId => {
            const m = candidates.find(x => !busy.has(x.teamAId) && !busy.has(x.teamBId) && x.status === "queued");
            if (!m) return;
            m.status = "playing";
            m.courtId = courtId;
            busy.add(m.teamAId);
            busy.add(m.teamBId);
          });
        };
        assignLive(s.categories[0].id, ["court1","court2"]);
        assignLive(s.categories[1].id, ["court3","court4"]);
        assignLive(s.categories[2].id, ["court5","court6"]);

        // Completed RR and medal matches for the Results TV preview.
        const medalCat = s.categories[3];
        markDone(medalCat.id, 999);
        medalCat.status = "playoff";
        medalCat.playoffThirdPlace = "bronze";
        const medalTeams = [
          medalCat.pools[0].teams[0], medalCat.pools[1].teams[0],
          medalCat.pools[0].teams[1], medalCat.pools[1].teams[1]
        ];
        let seq = Math.max(...s.matches.map(m => Number(m.sequence || 0))) + 1;
        const finalId = uid("match");
        const bronzeId = uid("match");
        const sf1 = {
          id:uid("match"), catId:medalCat.id, poolId:"", stage:"SF", round:1,
          teamAId:medalTeams[0].id, teamBId:medalTeams[3].id, status:"done", courtId:"",
          scoreA:11, scoreB:7, winnerId:medalTeams[0].id, sequence:seq++, bracketIndex:0,
          feedsTo:finalId, feedsSide:"A", loserFeedsTo:bronzeId, loserFeedsSide:"A", finishedAt:Date.now()-240000
        };
        const sf2 = {
          id:uid("match"), catId:medalCat.id, poolId:"", stage:"SF", round:1,
          teamAId:medalTeams[1].id, teamBId:medalTeams[2].id, status:"done", courtId:"",
          scoreA:9, scoreB:11, winnerId:medalTeams[2].id, sequence:seq++, bracketIndex:1,
          feedsTo:finalId, feedsSide:"B", loserFeedsTo:bronzeId, loserFeedsSide:"B", finishedAt:Date.now()-210000
        };
        const bronze = {
          id:bronzeId, catId:medalCat.id, poolId:"", stage:"BR", round:2,
          teamAId:medalTeams[3].id, teamBId:medalTeams[1].id, teamAFrom:sf1.id, teamBFrom:sf2.id,
          teamAFromType:"loser", teamBFromType:"loser", status:"done", courtId:"",
          scoreA:8, scoreB:11, winnerId:medalTeams[1].id, sequence:seq++, bracketIndex:99, finishedAt:Date.now()-120000
        };
        const final = {
          id:finalId, catId:medalCat.id, poolId:"", stage:"F", round:2,
          teamAId:medalTeams[0].id, teamBId:medalTeams[2].id, teamAFrom:sf1.id, teamBFrom:sf2.id,
          status:"done", courtId:"", scoreA:11, scoreB:9, winnerId:medalTeams[0].id,
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
          playoffSeedOrder: [],
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

      function categoryOperationStats(catId){
        const matches = state.matches.filter(m => m.catId === catId && m.teamAId !== "BYE" && m.teamBId !== "BYE");
        const total = matches.length;
        const done = matches.filter(m => m.status === "done").length;
        const live = matches.filter(m => m.status === "playing").length;
        const queued = matches.filter(m => m.status === "queued" && !m.hold).length;
        const waiting = matches.filter(m => m.status === "waiting").length;
        const percent = total ? Math.round(done / total * 100) : 0;
        return { total, done, live, queued, waiting, percent };
      }
      function statusLabel(status){
        const map = { queued:"QUEUED · 待安排", playing:"LIVE · 进行中", done:"FINAL · 已完成", waiting:"WAITING · 等胜者" };
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
      function isManualOnDeckEligible(m){
        return isMatchReady(m);
      }
      function ensureCourtPoolAccess(court){
        if (!court) return {};
        if (!court.poolAccess || typeof court.poolAccess !== "object" || Array.isArray(court.poolAccess)) court.poolAccess = {};
        return court.poolAccess;
      }
      function courtPoolSelection(court, catId){
        const access = ensureCourtPoolAccess(court);
        if (!Object.prototype.hasOwnProperty.call(access, catId)) return null; // null = all pools
        return Array.isArray(access[catId]) ? access[catId] : [];
      }
      function courtCanRunCat(courtId, catId){
        const cat = getCat(catId);
        const court = getCourt(courtId);
        return !!cat && !!court && !!cat.active && (court.allowAllActive || cat.courtIds.includes(courtId));
      }
      function courtHasCatAccess(court, cat){
        return !!court && !!cat && (cat.courtIds.includes(court.id) || (!!cat.active && !!court.allowAllActive));
      }
      function courtCanRunPool(courtId, catId, poolId){
        const court = getCourt(courtId);
        if (!courtCanRunCat(courtId, catId) || !court) return false;
        if (!poolId) return true;
        return isPoolAllowed(court.poolAccess, catId, poolId);
      }
      function courtCanRunMatch(courtId, match){
        if (!match || !courtCanRunCat(courtId, match.catId)) return false;
        if (match.stage !== "RR" || !match.poolId) return true;
        return courtCanRunPool(courtId, match.catId, match.poolId);
      }
      function setCourtAllActive(courtId, checked){
        const court = getCourt(courtId);
        if (!court) return;
        const activeCats = getActiveCats();
        court.allowAllActive = !!checked;
        activeCats.forEach(cat => {
          if (checked && !cat.courtIds.includes(courtId)) cat.courtIds.push(courtId);
          if (!checked) cat.courtIds = cat.courtIds.filter(id => id !== courtId);
        });
      }
      function setCourtCatAccess(courtId, catId, checked){
        const court = getCourt(courtId);
        const cat = getCat(catId);
        if (!court || !cat) return;
        ensureCourtPoolAccess(court);
        if (court.allowAllActive && !checked) {
          getActiveCats().forEach(activeCat => {
            if (!activeCat.courtIds.includes(courtId)) activeCat.courtIds.push(courtId);
          });
          court.allowAllActive = false;
        } else if (court.allowAllActive && checked) {
          return;
        }
        if (checked && !cat.courtIds.includes(courtId)) cat.courtIds.push(courtId);
        if (!checked) cat.courtIds = cat.courtIds.filter(id => id !== courtId);
      }
      function setCourtAllPools(courtId, catId, checked){
        const court = getCourt(courtId);
        const cat = getCat(catId);
        if (!court || !cat) return;
        const access = ensureCourtPoolAccess(court);
        if (checked) delete access[catId];
        else access[catId] = [];
      }
      function setCourtPoolAccess(courtId, catId, poolId, checked){
        const court = getCourt(courtId);
        const cat = getCat(catId);
        if (!court || !cat || !poolId) return;
        if (!courtHasCatAccess(court, cat)) setCourtCatAccess(courtId, catId, true);
        const allPoolIds = cat.pools.map(pool => pool.id);
        const access = ensureCourtPoolAccess(court);
        let selected = courtPoolSelection(court, catId);
        if (selected === null) selected = allPoolIds.slice();
        else selected = selected.slice();
        if (checked && !selected.includes(poolId)) selected.push(poolId);
        if (!checked) selected = selected.filter(id => id !== poolId);
        selected = selected.filter(id => allPoolIds.includes(id));
        if (selected.length === allPoolIds.length) delete access[catId];
        else access[catId] = selected;
      }
      function configuredCourtsForMatch(m){
        if (!m) return [];
        const cat = getCat(m.catId);
        if (!cat || !cat.active) return [];
        return state.settings.courts.filter(court => courtCanRunMatch(court.id, m));
      }
      function emptyCourts(){
        return state.settings.courts.filter(c => !currentPlayingByCourt(c.id));
      }
      function eligibleMatchesForCourt(courtId, catFilter="all", reservedTeamIds=null){
        const busy = playingTeamIds();
        const reserved = reservedTeamIds || new Set();
        return state.matches
          .filter(m => isMatchReady(m))
          .filter(m => getCat(m.catId)?.active)
          .filter(m => catFilter === "all" || m.catId === catFilter)
          .filter(m => courtCanRunMatch(courtId, m))
          .filter(m => !busy.has(m.teamAId) && !busy.has(m.teamBId))
          .filter(m => !reserved.has(m.teamAId) && !reserved.has(m.teamBId))
          .sort((a,b) => sortByPriorityForCourt(a,b,courtId));
      }
      function eligibleCourtsForMatch(m){
        if (!isMatchReady(m)) return [];
        const busy = playingTeamIds();
        if (busy.has(m.teamAId) || busy.has(m.teamBId)) return [];
        return emptyCourts().filter(c => courtCanRunMatch(c.id, m));
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

      function sortByPriorityForCourt(a,b,courtId){
        const aPlanned = a.prepareCourtId === courtId ? 0 : 1;
        const bPlanned = b.prepareCourtId === courtId ? 0 : 1;
        if (aPlanned !== bPlanned) return aPlanned - bPlanned;
        return sortByPriorityThenMatches(a,b);
      }

      function cleanPrepareMatchIds(){
        const seen = new Set();
        state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => {
          if (seen.has(id)) return false;
          seen.add(id);
          const m = getMatch(id);
          if (!m || !isManualOnDeckEligible(m) || !getCat(m.catId)?.active) return false;
          if (m.prepareCourtId && !getCourt(m.prepareCourtId)) m.prepareCourtId = "";
          return true;
        }).slice(0, 12);
      }

      function setPrepareMatch(matchId, toTop=false){
        const m = getMatch(matchId);
        if (!m || !isManualOnDeckEligible(m)) return false;
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

      function nextPrepareMatches(limit=state.settings.prepareLimit || 6){
        cleanPrepareMatchIds();
        return selectOnDeckEntries({
          matches: state.matches,
          categories: state.categories,
          courts: state.settings.courts,
          manualMatchIds: state.settings.prepareMatchIds,
          limit
        });
      }

      function renderAll(){
        $("eventTitle").textContent = state.settings.eventName || "武林年度赛 Tournament Control";
        const isTv = currentView === "operations" || currentView === "results";
        document.body.classList.toggle("dashboard-mode", isTv);
        document.body.classList.toggle("tv-mode", isTv);
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
        const activeCats = getActiveCats();
        const playing = state.matches.filter(m => m.status === "playing");
        const prepareLimit = Math.max(3, Math.min(6, Number(state.settings.prepareLimit || 6)));
        const prepare = nextPrepareMatches(prepareLimit);

        $("view-operations").innerHTML = `
          <section class="panel tv-banner">
            <div class="tv-banner-topline">
              <div>
                <div class="eyebrow">LIVE OPERATIONS · 赛事实况</div>
                <h2>COURTS & ON DECK</h2>
              </div>
              <div class="tv-stat-row compact">
                <div class="tv-stat"><b>${playing.length}/${state.settings.courts.length}</b><span>LIVE COURTS</span></div>
                <div class="tv-stat"><b>${prepare.length}</b><span>ON DECK</span></div>
              </div>
            </div>
            <div class="session-category-progress" aria-label="Active category progress">
              ${activeCats.length ? activeCats.map(cat => {
                const stats = categoryOperationStats(cat.id);
                return `<div class="session-category-card" title="${escapeHtml(cat.name)}">
                  <div class="session-category-name">${escapeHtml(cat.name)}</div>
                  <div class="session-category-metrics">
                    <span><b>${stats.done}/${stats.total}</b> DONE</span>
                    <span><b>${stats.queued}</b> QUEUE</span>
                    ${stats.live ? `<span class="live"><b>${stats.live}</b> LIVE</span>` : ""}
                  </div>
                  <div class="session-category-track"><span style="width:${stats.percent}%"></span></div>
                </div>`;
              }).join("") : `<div class="session-category-empty">No active categories · 当前没有 Active Cat</div>`}
            </div>
          </section>

          <div class="operations-layout">
            <section class="panel on-deck-panel">
              <div class="panel-title">
                <div>
                  <h2>ON DECK · 候场准备</h2>
                  <div class="subtle">Next ${prepareLimit} matches selected by staff priority, then automatic schedule order.</div>
                </div>
                <span class="pill gold">${prepare.length}/${prepareLimit} READY</span>
              </div>
              <div class="on-deck-grid">
                ${prepare.length ? prepare.map((entry, idx) => renderPrepareCard(entry, idx)).join("") : `<div class="empty-state" style="grid-column:1/-1">No match is ready for On Deck right now. · 暂无候场比赛</div>`}
              </div>
            </section>

            <section class="panel live-courts-panel">
              <div class="panel-title">
                <div>
                  <h2>LIVE COURTS · 场地实况</h2>
                  <div class="subtle">Official court assignments for all six courts.</div>
                </div>
                <span class="pill green">${playing.length}/${state.settings.courts.length} IN PLAY</span>
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
        const court = entry?.courtId ? getCourt(entry.courtId) : null;
        const manual = !!entry?.manual || (state.settings.prepareMatchIds || []).includes(m.id);
        const busyNote = entry?.teamsBusy
          ? `<span class="pill red">FINISHING CURRENT MATCH · 正在比赛</span>`
          : "";
        return `<article class="prepare-card ${manual ? "manual" : "auto"}">
          <div class="num">${String(idx+1).padStart(2,"0")}</div>
          <div class="prepare-card-head">
            <div class="prepare-tags">
              <span class="pill gold">${escapeHtml(cat?.name || "Category")}</span>
              <span class="pill round-focus">${escapeHtml(matchRoundLabel(m))}</span>${pool ? `<span class="pill">${escapeHtml(pool.name)}</span>` : ""}
              ${manual ? `<span class="pill red">STAFF PRIORITY · 优先</span>` : `<span class="pill">AUTO BY COURT</span>`}
              ${busyNote}
            </div>
            <div class="prepare-court-badge ${court ? "assigned" : "pending"}">
              <span>PREPARE FOR</span>
              <strong>${court ? escapeHtml(court.name) : "COURT TBD"}</strong>
            </div>
          </div>
          ${matchTeamsHtml(m)}
          <div class="subtle">Match ${escapeHtml(matchCode(m))} · ${court ? `Expected court assignment · 预计 ${escapeHtml(court.name)}` : "Staff will confirm the court · 等待场地确认"}</div>
        </article>`;
      }

      function renderCourtAccess(court){
        const activeCats = getActiveCats();
        const selectedCats = activeCats.filter(cat => courtHasCatAccess(court, cat));
        const effectiveCount = selectedCats.length;
        const isOpen = openCourtAccessId === court.id;
        const compactSummary = court.allowAllActive
          ? `ALL ${activeCats.length}`
          : (effectiveCount ? `${effectiveCount}/${activeCats.length}` : `0/${activeCats.length}`);
        const catSummary = (cat) => {
          const selected = courtPoolSelection(court, cat.id);
          if (selected === null) return `${cat.name}: All Pools`;
          if (!selected.length) return `${cat.name}: No RR Pool`;
          const names = cat.pools.filter(pool => selected.includes(pool.id)).map(pool => pool.name);
          return `${cat.name}: ${names.join(" / ") || "No RR Pool"}`;
        };
        const selectedNames = selectedCats.length ? selectedCats.map(catSummary).join(" · ") : "Not assigned";
        return `<div class="court-access compact ${isOpen ? "open" : ""}">
          <button type="button" class="court-access-trigger" data-action="toggle-court-access" data-court-id="${court.id}" title="${escapeHtml(selectedNames)}">
            <span class="court-access-trigger-label">ACCESS</span>
            <span class="court-access-trigger-value ${court.allowAllActive ? "all" : ""}">${escapeHtml(compactSummary)}</span>
            <span class="court-access-chevron">▾</span>
          </button>
          <div class="court-access-menu pool-aware">
            <div class="court-access-menu-head">
              <div>
                <div class="court-access-title">Court Assignment Rules · 场地权限</div>
                <div class="court-access-current" title="${escapeHtml(selectedNames)}">${escapeHtml(selectedNames)}</div>
              </div>
              <button type="button" class="ghost tiny" data-action="close-court-access">DONE · 完成</button>
            </div>
            <label class="mini-check ${court.allowAllActive ? "active" : ""}">
              <input type="checkbox" data-action="court-all-active-toggle" data-court-id="${court.id}" ${court.allowAllActive ? "checked" : ""}>
              <span>ALL ACTIVE CATEGORIES · 全部项目</span>
            </label>
            <div class="court-access-cat-list">
              ${activeCats.map(cat => {
                const checked = courtHasCatAccess(court, cat);
                const progress = categoryProgress(cat.id);
                const selectedPools = courtPoolSelection(court, cat.id);
                const allPools = selectedPools === null;
                return `<div class="court-access-cat-row ${checked ? "enabled" : "disabled"}">
                  <label class="court-cat-master mini-check ${checked ? "active" : ""}" title="${escapeHtml(cat.name)} · ${escapeHtml(progress.roundText)}">
                    <input type="checkbox" data-action="court-cat-toggle" data-court-id="${court.id}" data-cat-id="${cat.id}" ${checked ? "checked" : ""}>
                    <span>${escapeHtml(cat.name)}</span><span class="access-progress">${escapeHtml(progress.roundText.replace("RR ", ""))}</span>
                  </label>
                  ${checked ? `<div class="pool-access-options">
                    <label class="pool-chip ${allPools ? "active" : ""}">
                      <input type="checkbox" data-action="court-all-pools-toggle" data-court-id="${court.id}" data-cat-id="${cat.id}" ${allPools ? "checked" : ""}>
                      ALL POOLS
                    </label>
                    ${cat.pools.map(pool => {
                      const poolChecked = allPools || selectedPools.includes(pool.id);
                      return `<label class="pool-chip ${poolChecked ? "active" : ""}">
                        <input type="checkbox" data-action="court-pool-toggle" data-court-id="${court.id}" data-cat-id="${cat.id}" data-pool-id="${pool.id}" ${poolChecked ? "checked" : ""}>
                        ${escapeHtml(pool.name)}
                      </label>`;
                    }).join("")}
                  </div>` : `<div class="pool-access-disabled">Enable the category to choose Pool A / Pool B.</div>`}
                </div>`;
              }).join("")}
              ${activeCats.length ? "" : `<span class="subtle">Select Active Categories in Current Session first. · 请先开启当前项目</span>`}
            </div>
            <div class="court-access-note">Pool rules apply to Round Robin. Playoff matches may use any court enabled for the category. · Pool 限制只用于小组赛</div>
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
              <div class="court-top-actions">${admin ? renderCourtAccess(court) : ""}<span class="pill empty">${admin ? "OPEN · 空场" : "OPEN · 空场"}</span></div>
            </div>
            ${next ? `
              <div class="public-label">${admin ? "NEXT MATCH · 下一场" : "NEXT AVAILABLE · 下一场"}</div>
              <div class="court-match-meta" style="margin-top:8px"><span class="pill gold">${escapeHtml(getCat(next.catId)?.name || "")}</span><span class="pill round-focus">${escapeHtml(matchRoundLabel(next))}</span>${getPool(next.catId,next.poolId) ? `<span class="pill">${escapeHtml(getPool(next.catId,next.poolId).name)}</span>` : ""}</div>
              ${matchTeamsHtml(next, true)}
              ${admin ? `<button class="success" data-action="assign-match" data-match-id="${next.id}" data-court-id="${court.id}">ASSIGN TO COURT · 安排</button>` : `<div class="subtle">Awaiting staff confirmation · 等待工作人员安排</div>`}
            ` : `
              <div class="empty-state">${admin ? "No eligible match is ready. Adjust Category / Pool access above. · 可修改项目小组权限" : "No match is ready for this court. · 暂无可安排比赛"}</div>
            `}
          </article>`;
        }
        const cat = getCat(m.catId);
        const pool = getPool(m.catId, m.poolId);
        return `<article class="court-card playing ${admin ? "admin-court" : ""}">
          <div class="court-top">
            <h3>${escapeHtml(court.name)}</h3>
            <div class="court-top-actions">${admin ? renderCourtAccess(court) : ""}<span class="pill green">${admin ? "LIVE · 进行中" : "LIVE · 进行中"}</span></div>
          </div>
          <div class="court-match-meta"><span class="pill gold">${escapeHtml(cat?.name || "Category")}</span><span class="pill round-focus">${escapeHtml(matchRoundLabel(m))}</span>${pool ? `<span class="pill">${escapeHtml(pool.name)}</span>` : ""}</div>
          ${admin && m.stage === "RR" ? `<div class="court-progress-note">${escapeHtml(pool?.name || "Pool")} · Round ${Number(m.round || 0)}/${rrRoundTotal(m) || "?"}. Open another court above if this pool needs to catch up. · 可临时加场</div>` : ""}
          ${matchTeamsHtml(m, true)}
          ${m.scoreA !== undefined && m.scoreA !== "" ? `<div class="court-score">${escapeHtml(m.scoreA)} : ${escapeHtml(m.scoreB)}</div>` : ""}
          ${admin ? `
            <div class="score-input-row">
              <input id="scoreA_${m.id}" inputmode="numeric" placeholder="Team A score" value="${escapeHtml(m.scoreA ?? "")}">
              <input id="scoreB_${m.id}" inputmode="numeric" placeholder="Team B score" value="${escapeHtml(m.scoreB ?? "")}">
            </div>
            <div class="queue-row-actions">
              <button class="success" data-action="finish-match" data-match-id="${m.id}">FINISH &amp; NEXT · 完成</button>
              <button class="ghost" data-action="return-queue" data-match-id="${m.id}">RETURN TO QUEUE · 退回</button>
            </div>
          ` : `<div class="subtle">Match ${escapeHtml(matchCode(m))} · OFFICIAL ASSIGNMENT</div>`}
        </article>`;
      }

      function renderRankingCard(catId){
        const cat = getCat(catId);
        if (!cat) return "";
        return `<section class="panel rank-card">
          <div class="panel-title">
            <div>
              <div class="eyebrow">ROUND ROBIN STANDINGS · 小组积分榜</div>
              <h2>${escapeHtml(cat.name)}</h2>
              <div class="subtle">Win = 2 pts · Tie-break: head-to-head, then point differential, then points for. · 同分先看交手</div>
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
                    <td>${idx+1}</td><td><strong>${escapeHtml(r.name)}</strong></td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.points}</td><td class="tiebreak-cell">${escapeHtml(r.tieBreakNote || "-")}</td><td>${r.diff > 0 ? "+" : ""}${r.diff}</td><td>${r.for}</td>
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
        return cat?.playoffThirdPlace === "bronze" ? "Play Third Place Match · 三四名赛" : "No Third Place Match · Rank semifinal losers by loss margin";
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

      function playoffSeedLabel(m, side){
        const seed = side === "A" ? m.seedA : m.seedB;
        if (seed && seed.teamId && seed.teamId !== "BYE") {
          const source = `${seed.poolName || "Pool"} #${seed.rank || "-"}`;
          return seed.seedNumber ? `Seed ${seed.seedNumber} · ${source}` : source;
        }
        const fromId = side === "A" ? m.teamAFrom : m.teamBFrom;
        const fromType = side === "A" ? m.teamAFromType : m.teamBFromType;
        if (fromId) {
          const source = getMatch(fromId);
          return `${fromType === "loser" ? "Loser" : "Winner"} ${source ? matchCode(source) : "TBD"}`;
        }
        return "TBD";
      }

      function renderBracketSide(m, side){
        const id = side === "A" ? m.teamAId : m.teamBId;
        const score = side === "A" ? m.scoreA : m.scoreB;
        const label = sideDisplay(m, side);
        const resultClass = m.status === "done" && m.winnerId && id
          ? (m.winnerId === id ? "winner" : "loser")
          : "";
        return `<div class="bracket-side ${resultClass}">
          <span class="bracket-seed">${escapeHtml(playoffSeedLabel(m, side))}</span>
          <strong>${escapeHtml(label)}</strong>
          <b class="bracket-score">${score === "" || score === undefined ? "-" : escapeHtml(score)}</b>
        </div>`;
      }

      function bracketCenterY(match, baseStep, headerHeight){
        if (Number.isFinite(Number(match.bracketY))) {
          return headerHeight + baseStep * Number(match.bracketY);
        }
        const round = Math.max(1, Number(match.round || 1));
        const index = Math.max(0, Number(match.bracketIndex || 0));
        return headerHeight + baseStep * (index * Math.pow(2, round - 1) + Math.pow(2, round - 2));
      }

      function renderPlayoffBracket(catId){
        const all = playoffMatchesForCat(catId);
        const main = all.filter(m => m.stage !== "BR");
        const bronze = all.find(m => m.stage === "BR");
        if (!main.length) return `<div class="empty-state">PLAYOFF NOT STARTED · 淘汰赛尚未开始</div>`;

        const totalRounds = Math.max(...main.map(m => Number(m.round || 1)));
        const firstRoundCount = Math.max(1, main.filter(m => Number(m.round || 1) === 1).length);
        const cardW = 248;
        const cardH = 112;
        const colGap = 92;
        const headerHeight = 44;
        const baseStep = firstRoundCount <= 2 ? 164 : 132;
        const maxExplicitY = Math.max(0, ...main.map(m => Number.isFinite(Number(m.bracketY)) ? Number(m.bracketY) : 0));
        const canvasHeight = Math.max(250, headerHeight + Math.max(firstRoundCount, maxExplicitY + .45) * baseStep + 12);
        const canvasWidth = totalRounds * cardW + Math.max(0, totalRounds - 1) * colGap;
        const byId = new Map(main.map(m => [m.id, m]));

        const paths = main.filter(m => m.feedsTo && byId.has(m.feedsTo)).map(m => {
          const next = byId.get(m.feedsTo);
          const sx = (Number(m.round || 1) - 1) * (cardW + colGap) + cardW;
          const sy = bracketCenterY(m, baseStep, headerHeight);
          const tx = (Number(next.round || 1) - 1) * (cardW + colGap);
          const ty = bracketCenterY(next, baseStep, headerHeight);
          const mid = sx + (tx - sx) / 2;
          return `<path d="M ${sx} ${sy} H ${mid} V ${ty} H ${tx}" />`;
        }).join("");

        const roundLabels = Array.from({length:totalRounds}, (_, idx) => {
          const round = idx + 1;
          const sample = main.find(m => Number(m.round || 1) === round);
          const title = sample ? stageName(sample.stage) : `ROUND ${round}`;
          return `<div class="bracket-round-title" style="left:${idx * (cardW + colGap)}px;width:${cardW}px">${escapeHtml(title)}</div>`;
        }).join("");

        const cards = main.map(m => {
          const x = (Number(m.round || 1) - 1) * (cardW + colGap);
          const centerY = bracketCenterY(m, baseStep, headerHeight);
          const y = centerY - cardH / 2;
          const court = m.courtId ? getCourt(m.courtId) : null;
          return `<article class="bracket-match ${m.status === "done" ? "done" : m.status === "playing" ? "live" : ""}" style="left:${x}px;top:${y}px;width:${cardW}px;height:${cardH}px">
            <div class="bracket-match-head">
              <span>${escapeHtml(matchCode(m))}</span>
              <span class="${statusClass(m.status)}"><i class="status-dot"></i>${escapeHtml(publicStatusLabel(m.status))}</span>
            </div>
            ${renderBracketSide(m,"A")}
            ${renderBracketSide(m,"B")}
            ${court ? `<div class="bracket-court">${escapeHtml(court.name)}</div>` : ""}
          </article>`;
        }).join("");

        return `<div class="playoff-bracket-scroll">
          <div class="playoff-bracket-canvas" style="width:${canvasWidth}px;height:${canvasHeight}px">
            ${roundLabels}
            <svg class="bracket-lines" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" aria-hidden="true">${paths}</svg>
            ${cards}
          </div>
          ${bronze ? `<div class="bronze-branch">
            <div class="bronze-title">THIRD PLACE MATCH · 季军赛</div>
            <article class="bracket-match bronze-card ${bronze.status === "done" ? "done" : bronze.status === "playing" ? "live" : ""}">
              <div class="bracket-match-head"><span>${escapeHtml(matchCode(bronze))}</span><span class="${statusClass(bronze.status)}"><i class="status-dot"></i>${escapeHtml(publicStatusLabel(bronze.status))}</span></div>
              ${renderBracketSide(bronze,"A")}${renderBracketSide(bronze,"B")}
            </article>
          </div>` : ""}
        </div>`;
      }

      function renderPlayoffResultCard(catId){
        const cat = getCat(catId);
        if (!cat) return "";
        const matches = playoffMatchesForCat(catId);
        const done = matches.filter(m => m.status === "done").length;
        const podium = computePodium(catId);
        return `<section class="panel rank-card playoff-result-card">
          <div class="panel-title">
            <div>
              <div class="eyebrow">PLAYOFF BRACKET · 淘汰赛晋级图</div>
              <h2>${escapeHtml(cat.name)}</h2>
              <div class="subtle">Follow each semifinal branch into the Final. Winners are highlighted in green. · 胜者晋级</div>
            </div>
            <span class="pill blue">${done}/${matches.length} FINAL</span>
          </div>
          ${matches.length ? `
            <div class="playoff-summary medal-strip">
              ${podium.length ? podium.map(p => `<span class="medal-card"><strong>${escapeHtml(p.label)}</strong><span>${escapeHtml(p.name)}</span></span>`).join("") : `<span class="medal-card"><strong>PLAYOFF IN PROGRESS</strong><span>淘汰赛进行中</span></span>`}
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
                <h2>STAFF ADMIN · 武林后台</h2>
                <p class="subtle">Enter the staff PIN to assign courts, record scores, manage Categories / Pools and generate Playoffs. All changes sync to Supabase. · 工作人员专用</p>
                <div style="margin:18px 0 10px">
                  <input id="adminPassword" type="password" inputmode="numeric" placeholder="Staff PIN">
                </div>
                <button class="primary" data-action="unlock-admin">OPEN STAFF ADMIN · 打开后台</button>
                <p class="subtle" style="margin-top:12px">The staff PIN is stored in Vercel <span class="kbd">ADMIN_PIN</span>, not in the browser code.</p><div class="cloud-note">Secure HttpOnly staff session · Supabase Secret Key remains server-side. · 安全云端会话</div>
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
          .filter(m => isMatchReady(m) && !!getCat(m.catId)?.active)
          .filter(m => adminCatFilter === "all" || m.catId === adminCatFilter)
          .slice(0, 28);
        const held = state.matches
          .slice()
          .filter(m => m.status === "queued" && m.hold && !!getCat(m.catId)?.active)
          .filter(m => adminCatFilter === "all" || m.catId === adminCatFilter)
          .sort(sortMatches)
          .slice(0, 18);
        const scoreCorrectionGroups = state.categories.map(cat => {
          const matches = state.matches
            .filter(m => m.catId === cat.id && m.status === "done" && m.teamAId !== "BYE" && m.teamBId !== "BYE")
            .sort((a,b) => (Number(b.finishedAt || 0) - Number(a.finishedAt || 0)) || sortMatches(a,b));
          return { cat, matches };
        }).filter(group => group.matches.length > 0);
        const completedCount = scoreCorrectionGroups.reduce((sum, group) => sum + group.matches.length, 0);

        $("view-admin").innerHTML = `
          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>STAFF TOURNAMENT CONTROL · 赛事中控</h2>
                <div class="subtle">Enter team scores, control six courts and move the schedule forward from one screen. · 队伍计分与排场</div><div class="cloud-note">App state v${APP_STATE_VERSION} · Cloud record v${cloudVersion || "-"} · ${pendingSave ? "Changes waiting to sync · 待同步" : "Synced with Supabase · 已同步"} · Version lock protects against silent multi-device overwrites.</div>
              </div>
              <div class="admin-actions">
                <button class="ghost" data-action="show-view" data-view="operations">TV 1 · Courts</button>
                <button class="ghost" data-action="show-view" data-view="results">TV 2 · Results</button>
                <button class="danger" data-action="logout-admin">LOCK ADMIN · 锁定</button>
              </div>
            </div>
            <div class="form-grid-4">
              <div>
                <label>EVENT NAME · 赛事名称</label>
                <input id="eventNameInput" data-action="event-name-input" value="${escapeHtml(state.settings.eventName)}">
              </div>
              <div>
                <label>QUEUE CATEGORY FILTER · 项目筛选</label>
                <select id="adminCatFilter" data-action="admin-cat-filter">${catOptions}</select>
              </div>
              <div>
                <label>AUTO-ASSIGN NEXT MATCH · 自动下一场</label>
                <select id="autoNextSelect" data-action="auto-next">
                  <option value="true" ${state.settings.autoNext ? "selected" : ""}>ON · Finish and assign the next eligible match</option>
                  <option value="false" ${!state.settings.autoNext ? "selected" : ""}>OFF · Release the court only</option>
                </select>
              </div>
              <div>
                <label>TV 1 · ON DECK COUNT · 候场数量</label>
                <select id="prepareLimitSelect" data-action="prepare-limit">
                  ${[3,4,5,6].map(n => `<option value="${n}" ${Number(state.settings.prepareLimit || 6) === n ? "selected" : ""}>Next ${n} games</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="admin-actions" style="margin-top:12px">
              <button class="success" data-action="fill-empty-courts">FILL ALL OPEN COURTS · 填满空场</button>
              <button class="ghost" data-action="export-json">EXPORT BACKUP JSON</button>
              <button class="ghost" data-action="trigger-import">IMPORT JSON</button>
              <button class="warn" data-action="load-sample">LOAD DEMO DATA</button>
              <button class="danger" data-action="clear-data">CLEAR ALL DATA</button>
              <input id="importFile" type="file" accept="application/json" style="display:none">
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>CURRENT SESSION · 当前时段 Active Cats</h2>
                <div class="subtle session-help">Select only the categories running in the current morning or afternoon session. Queue, auto-assignment, Court access and TV 1 use Active Categories only. · 当前时段项目</div>
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
                <div class="subtle">Open ACCESS on each court to choose Active Categories and Pool A / Pool B without leaving the control board. · 场边直接设置</div>
              </div>
              <span class="pill">${state.matches.filter(m => m.status === "playing").length}/${state.settings.courts.length} IN PLAY</span>
            </div>
            <div class="admin-courts">
              ${state.settings.courts.map(c => renderCourtCard(c, true)).join("")}
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>TV 1 · MANUAL ON DECK · 人工候场</h2>
                <div class="subtle">Staff selections appear first on TV 1. Set a Potential Court so players know where to wait. Busy teams may remain listed for their next match. · 可预告场地</div>
              </div>
              <div class="admin-actions">
                <span class="pill gold">NEXT ${Number(state.settings.prepareLimit || 6)}</span>
                <button class="ghost" data-action="clear-prepare-list">CLEAR MANUAL ON DECK</button>
              </div>
            </div>
            <div class="priority-list">
              ${manualPrepare.length ? manualPrepare.map((m, idx) => renderPrepareControlRow(m, idx)).join("") : `<div class="empty-state">No manual selections. Use ADD TO ON DECK in the Queue; remaining TV slots are filled automatically by Court + Category + Pool rules. · 自动补位</div>`}
            </div>
            ${held.length ? `<div style="height:12px"></div><div class="panel-title"><h3>HELD / PLAYER MISSING / CONFLICT · 暂缓</h3><span class="pill red">${held.length}</span></div><div class="priority-list">${held.map(renderHeldRow).join("")}</div>` : ""}
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>MATCH QUEUE · 待安排</h2>
                <div class="subtle">Add future matches to On Deck, pin priority, hold conflicts or assign directly to an eligible open court. Busy teams can still be added manually for a later match. · 后续赛程</div>
              </div>
              <span class="pill">${queued.length} shown</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>#</th><th>CATEGORY</th><th>POOL / RR ROUND</th><th>MATCHUP</th><th>ACTIONS / OPEN COURTS</th></tr></thead>
                <tbody>
                  ${queued.length ? queued.map((m, idx) => renderQueueRow(m, idx)).join("") : `<tr><td colspan="5"><div class="empty-state">No ready match under the current filter. Check waiting Playoff branches or Court Category / Pool access. · 暂无可排比赛</div></td></tr>`}
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>CATEGORY / POOL / PLAYOFF SETTINGS · 赛事设置</h2>
                <div class="subtle">Choose a Category tab, then a Pool tab. Only one settings page stays open for faster operation. · 分页设置</div>
              </div>
              ${settingsCat ? `<span class="pill ${settingsCat.active ? "green" : ""}">${settingsCat.active ? "ACTIVE" : "INACTIVE"}</span>` : ""}
            </div>
            <div class="cat-settings-tabs">
              ${state.categories.map(cat => `<button class="settings-tab ${cat.id === adminSettingsCatId ? "active" : ""}" data-action="cat-settings-tab" data-cat-id="${cat.id}"><span class="state-dot ${cat.active ? "active" : ""}"></span>${escapeHtml(cat.name)}</button>`).join("")}
            </div>
            <div class="cat-list single">
              ${settingsCat ? renderCatCard(settingsCat) : `<div class="empty-state">No Category yet. Create one below. · 请新增项目</div>`}
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <div>
                <h2>ADD CATEGORY · 新增项目</h2>
                <div class="subtle">Enter one team per line. Separate Pools with a blank line and place the Pool name on the first line. · 每队一行</div>
              </div>
            </div>
            <div class="form-grid">
              <div>
                <label>CATEGORY NAME · 项目名称</label>
                <input id="newCatName" placeholder="Example: Men's Doubles 4.0+">
              </div>
              <div>
                <label>DEFAULT QUALIFIERS PER POOL · 每组出线</label>
                <input id="newCatAdvance" type="number" min="1" value="2">
              </div>
            </div>
            <div style="height:10px"></div>
            <label>POOLS &amp; TEAMS · 小组队伍</label>
            <textarea id="newCatPools" spellcheck="false">Pool A
队伍 1 / 队伍 2
队伍 3 / 队伍 4
队伍 5 / 队伍 6

Pool B
队伍 7 / 队伍 8
队伍 9 / 队伍 10
队伍 11 / 队伍 12</textarea>
            <div class="admin-actions" style="margin-top:12px">
              <button class="primary" data-action="add-cat">ADD CATEGORY &amp; GENERATE RR · 新增</button>
            </div>
            <div class="hint" style="margin-top:12px">Example: Pool A in the first block, Pool B in the second. The app generates Round Robin matches inside each Pool. · 自动生成小组循环赛</div>
          </section>

          <section class="panel">
            <div class="panel-title"><h2>COURT NAMES · 场地名称</h2></div>
            <div class="form-grid-3">
              ${state.settings.courts.map(c => `<div><label>${escapeHtml(c.id)}</label><input data-action="court-name-input" data-court-id="${c.id}" value="${escapeHtml(c.name)}"></div>`).join("")}
            </div>
            <div class="qr-dock">
              <div class="subtle">Optional QR assets · 二维码：</div>
              <img src="${WECHAT_QR}" alt="WeChat QR">
              <img src="${COMMUNITY_QR}" alt="Community QR">
            </div>
          </section>

          <section class="panel score-corrections-panel">
            <div class="panel-title">
              <div>
                <h2>SCORE CORRECTIONS · 比分修正</h2>
                <div class="subtle">This low-frequency tool is placed at the end of Admin. Open only the Category you need; RR standings recalculate immediately and a changed Playoff winner resets affected downstream branches. · 按项目展开</div>
              </div>
              <span class="pill">${completedCount} COMPLETED</span>
            </div>
            <div class="score-correction-groups">
              ${scoreCorrectionGroups.length ? scoreCorrectionGroups.map(group => {
                const rrCount = group.matches.filter(match => match.stage === "RR").length;
                const playoffCount = group.matches.length - rrCount;
                const isOpen = openScoreCorrectionCatIds.has(group.cat.id);
                return `<details class="score-correction-group" data-score-correction-cat="${group.cat.id}" ${isOpen ? "open" : ""}>
                  <summary>
                    <span><strong>${escapeHtml(group.cat.name)}</strong><small>${group.matches.length} completed matches · ${rrCount} RR${playoffCount ? ` · ${playoffCount} Playoff` : ""}</small></span>
                    <span class="pill">OPEN DETAILS · 展开</span>
                  </summary>
                  <div class="score-correction-body">
                    ${group.matches.map(renderCompletedScoreRow).join("")}
                  </div>
                </details>`;
              }).join("") : `<div class="empty-state">No completed matches are available for correction. · 暂无已完成比赛</div>`}
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
        const configured = configuredCourtsForMatch(m);
        const busy = playingTeamIds();
        const teamsBusy = busy.has(m.teamAId) || busy.has(m.teamBId);
        const selectedCourt = m.prepareCourtId && configured.some(c => c.id === m.prepareCourtId) ? m.prepareCourtId : "";
        return `<article class="priority-card">
          <div class="priority-topline">
            <div><span class="pill gold">#${idx+1}</span> <span class="pill">${renderMatchMeta(m)}</span>${teamsBusy ? ` <span class="pill red">TEAM CURRENTLY PLAYING · 队伍比赛中</span>` : ""}</div>
            <div class="queue-row-actions">
              <button class="small ghost" data-action="prepare-up" data-match-id="${m.id}">MOVE UP</button>
              <button class="small ghost" data-action="prepare-down" data-match-id="${m.id}">MOVE DOWN</button>
              <button class="small danger" data-action="unprepare-match" data-match-id="${m.id}">REMOVE</button>
            </div>
          </div>
          <div class="prepare-admin-grid">
            <div>${matchTeamsHtml(m, true)}</div>
            <div class="potential-court-control">
              <label>Potential Court · 预计场地</label>
              <select data-action="prepare-court-select" data-match-id="${m.id}">
                <option value="" ${selectedCourt ? "" : "selected"}>AUTO / TO BE CONFIRMED</option>
                ${configured.map(court => `<option value="${court.id}" ${selectedCourt === court.id ? "selected" : ""}>${escapeHtml(court.name)}</option>`).join("")}
              </select>
              <div class="subtle">TV 1 will show this as the expected court. Final assignment can still change.</div>
            </div>
          </div>
        </article>`;
      }

      function renderHeldRow(m){
        return `<article class="priority-card hold">
          <div class="priority-topline">
            <div><span class="pill red">HELD · 暂缓</span> <span class="pill">${renderMatchMeta(m)}</span></div>
            <div class="queue-row-actions">
              <button class="small success" data-action="release-match" data-match-id="${m.id}">RETURN TO QUEUE · 恢复</button>
              <button class="small warn" data-action="release-and-top" data-match-id="${m.id}">RESTORE &amp; PIN TOP · 置顶</button>
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
            <input id="editScoreA_${m.id}" inputmode="numeric" ${lockedAutoBye ? "disabled" : ""} value="${escapeHtml(m.scoreA ?? "")}">
            <input id="editScoreB_${m.id}" inputmode="numeric" ${lockedAutoBye ? "disabled" : ""} value="${escapeHtml(m.scoreB ?? "")}">
          </div>
          <div class="queue-row-actions">
            ${lockedAutoBye ? `<span class="pill">AUTO BYE · 轮空</span>` : `<button class="small success" data-action="save-score-edit" data-match-id="${m.id}">SAVE CORRECTION · 保存</button>`}
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
          <td><div class="queue-round">${escapeHtml(matchRoundLabel(m))}</div><div class="queue-pool">${pool ? escapeHtml(pool.name) : escapeHtml(stageName(m.stage))}</div></td>
          <td><strong>${escapeHtml(sideDisplay(m,"A"))}</strong> vs <strong>${escapeHtml(sideDisplay(m,"B"))}</strong></td>
          <td>
            <div class="queue-row-actions">
              <button class="small warn" data-action="prepare-match" data-match-id="${m.id}">${prepared ? "ON DECK · 已加入" : "ADD TO ON DECK · 候场"}</button>
              <button class="small ghost" data-action="prepare-top" data-match-id="${m.id}">PIN TOP · 置顶</button>
              <button class="small danger" data-action="hold-match" data-match-id="${m.id}">HOLD · 暂缓</button>
              ${blocked ? `<span class="pill red">TEAM IN PLAY · 比赛中</span>` : courts.length ? courts.map(c => `<button class="small success" data-action="assign-match" data-match-id="${m.id}" data-court-id="${c.id}">${escapeHtml(c.name)}</button>`).join("") : `<span class="pill empty">NO OPEN ELIGIBLE COURT · 暂无场地</span>`}
            </div>
          </td>
        </tr>`;
      }

      function collectPlayoffQualifiers(cat){
        if (!cat) return [];
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
              h2hPoints: row.h2hPoints,
              tieBreakNote: row.tieBreakNote,
              diff: row.diff,
              scored: row.for
            });
          });
        });
        return qualifiers;
      }

      function getThreePoolSeedPlan(cat){
        if (!cat || cat.pools.length !== 3 || !cat.pools.every(pool => Number(pool.advance || 0) === 2)) return null;
        const qualifiers = collectPlayoffQualifiers(cat);
        const plan = buildPlayoffBracketPlanCore(cat.pools, qualifiers, {
          manualSeedOrder: cat.playoffSeedOrder || []
        });
        return plan.strategy === "three-pool-six-seed" ? plan : null;
      }

      function renderThreePoolSeedPanel(cat, plan){
        if (!plan) return "";
        const seeds = plan.ordered || [];
        const manualRequested = Array.isArray(cat.playoffSeedOrder) && cat.playoffSeedOrder.length > 0;
        const invalidManual = manualRequested && !plan.manualApplied;
        const seedName = (index) => seeds[index]?.name || "TBD";
        const seedSource = (seed) => `${seed?.poolName || "Pool"} #${seed?.rank || "-"}`;
        return `<div class="three-pool-seeding-panel">
          <div class="three-pool-seeding-head">
            <div>
              <strong>THREE-POOL CROSS-POOL SEEDING · 三组跨池排名</strong>
              <div class="subtle">Auto order: Win Points → same-Pool Head-to-Head → Point Difference → Points For. Teams from different Pools have no direct H2H, so the comparison moves to DIFF/PF. · 可手动调整</div>
            </div>
            <div class="seed-mode-row">
              <span class="pill ${plan.manualApplied ? "blue" : "gold"}">${plan.manualApplied ? "MANUAL ORDER" : "AUTO ORDER"}</span>
              <button class="small ghost" data-action="reset-playoff-seeds" data-cat-id="${cat.id}">RESET AUTO</button>
            </div>
          </div>
          ${invalidManual ? `<div class="sync-warning">The saved manual seed list no longer matches the current six qualifiers, so Auto Order is being used. · 出线队改变，已暂用自动排名</div>` : ""}
          <div class="cross-pool-seed-table-wrap">
            <table class="cross-pool-seed-table">
              <thead><tr><th>SEED</th><th>TEAM</th><th>POOL RESULT</th><th>PTS</th><th>H2H / TB</th><th>DIFF</th><th>PF</th><th>PATH</th><th>MANUAL ORDER</th></tr></thead>
              <tbody>${seeds.map((seed, index) => `<tr>
                <td><span class="seed-number">${index + 1}</span></td>
                <td><strong>${escapeHtml(seed.name)}</strong></td>
                <td>${escapeHtml(seedSource(seed))}</td>
                <td>${Number(seed.points || 0)}</td>
                <td class="tiebreak-cell">${escapeHtml(seed.tieBreakNote || "-")}</td>
                <td>${Number(seed.diff || 0) > 0 ? "+" : ""}${Number(seed.diff || 0)}</td>
                <td>${Number(seed.scored || 0)}</td>
                <td>${index < 2 ? `<span class="pill green">BYE TO SF</span>` : index === 2 ? "QF: Seed 3 vs 6" : index === 3 ? "QF: Seed 4 vs 5" : index === 4 ? "QF: Seed 4 vs 5" : "QF: Seed 3 vs 6"}</td>
                <td><div class="seed-move-actions">
                  <button class="tiny ghost" data-action="seed-up" data-cat-id="${cat.id}" data-team-id="${seed.teamId}" ${index === 0 ? "disabled" : ""}>↑</button>
                  <button class="tiny ghost" data-action="seed-down" data-cat-id="${cat.id}" data-team-id="${seed.teamId}" ${index === seeds.length - 1 ? "disabled" : ""}>↓</button>
                </div></td>
              </tr>`).join("")}</tbody>
            </table>
          </div>
          <div class="six-seed-path-preview">
            <div><span>QUARTERFINAL 1</span><strong>Seed 3 · ${escapeHtml(seedName(2))}</strong><b>VS</b><strong>Seed 6 · ${escapeHtml(seedName(5))}</strong></div>
            <div><span>QUARTERFINAL 2</span><strong>Seed 4 · ${escapeHtml(seedName(3))}</strong><b>VS</b><strong>Seed 5 · ${escapeHtml(seedName(4))}</strong></div>
            <div><span>SEMIFINAL 1</span><strong>Seed 1 · ${escapeHtml(seedName(0))}</strong><b>VS</b><strong>Winner of Seed 4 vs 5</strong></div>
            <div><span>SEMIFINAL 2</span><strong>Seed 2 · ${escapeHtml(seedName(1))}</strong><b>VS</b><strong>Winner of Seed 3 vs 6</strong></div>
          </div>
          <div class="hint">Move a team up or down, then click GENERATE / REGENERATE PLAYOFF to apply the displayed seed order. · 手动调整后需重新生成淘汰赛</div>
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
        const standingsByPool = new Map(cat.pools.map(pool => [pool.id, computeStandings(cat.id, pool.id)]));
        const poolA = cat.pools[0];
        const poolB = cat.pools[1];
        const poolARows = poolA ? (standingsByPool.get(poolA.id) || []) : [];
        const poolBRows = poolB ? (standingsByPool.get(poolB.id) || []) : [];
        const crossoverReady = cat.pools.length === 2 && Number(poolA?.advance || 0) >= 2 && Number(poolB?.advance || 0) >= 2;
        const crossoverPreview = crossoverReady ? [
          { label:"SEMIFINAL 1", left:`${poolA.name} #1 · ${poolARows[0]?.name || "TBD"}`, right:`${poolB.name} #2 · ${poolBRows[1]?.name || "TBD"}` },
          { label:"SEMIFINAL 2", left:`${poolA.name} #2 · ${poolARows[1]?.name || "TBD"}`, right:`${poolB.name} #1 · ${poolBRows[0]?.name || "TBD"}` }
        ] : [];
        const threePoolSeedPlan = getThreePoolSeedPlan(cat);
        return `<article class="cat-card cat-settings-card">
          <div class="panel-title">
            <div>
              <h3>${escapeHtml(cat.name)}</h3>
              <div class="active-summary-row">
                <span class="pill ${cat.active ? "green" : ""}">${cat.active ? "ACTIVE · 当前时段" : "INACTIVE · 未开场"}</span>
                <span class="pill round-focus">${escapeHtml(progress.roundText)}</span>
                <span class="pill">RR ${rrDone}/${rrMatches.length}</span>
                <span class="pill">Playoff ${playoffMatches.length}</span>
              </div>
            </div>
            <span class="pill ${cat.status === "playoff" ? "blue" : "gold"}">${cat.status === "playoff" ? "Playoff" : "RR"}</span>
          </div>

          <div class="inline-edit-grid">
            <div>
              <label>CATEGORY NAME · 项目名称</label>
              <input class="compact-input" data-action="cat-name-input" data-cat-id="${cat.id}" value="${escapeHtml(cat.name)}">
            </div>
            <div>
              <label>CURRENT SESSION STATUS · 时段状态</label>
              <label class="mini-check ${cat.active ? "active" : ""}" style="margin-top:1px">
                <input type="checkbox" data-action="cat-active-toggle" data-cat-id="${cat.id}" ${cat.active ? "checked" : ""}>
                ${cat.active ? "ACTIVE · Included in Queue & Court assignment" : "INACTIVE · Excluded from current scheduling"}
              </label>
            </div>
          </div>

          <div class="settings-section-title">Pool & Teams · 小组与队伍</div>
          <div class="pool-settings-tabs">
            ${cat.pools.map(pool => `<button class="pool-settings-tab ${selectedPool?.id === pool.id ? "active" : ""}" data-action="pool-settings-tab" data-cat-id="${cat.id}" data-pool-id="${pool.id}">${escapeHtml(pool.name)} · ${pool.teams.length} teams</button>`).join("")}
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
              ${selectedPool.teams.map((team, tIdx) => `<label class="team-edit-row"><span>TEAM ${tIdx+1}</span><input data-action="team-name-input" data-cat-id="${cat.id}" data-pool-id="${selectedPool.id}" data-team-id="${team.id}" value="${escapeHtml(team.name)}"></label>`).join("")}
            </div>
            <div class="pool-rank" style="margin-top:12px">
              <table>
                <thead><tr><th colspan="9">${escapeHtml(selectedPool.name)} · FULL STANDINGS · 完整排名</th></tr><tr><th>#</th><th>TEAM</th><th>P</th><th>W</th><th>L</th><th>PTS</th><th>H2H / TB</th><th>DIFF</th><th>PF</th></tr></thead>
                <tbody>${selectedRows.map((r,i) => `<tr class="${i < Number(selectedPool.advance || 0) ? "qualifier" : ""}"><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.points}</td><td class="tiebreak-cell">${escapeHtml(r.tieBreakNote || "-")}</td><td>${r.diff > 0 ? "+" : ""}${r.diff}</td><td>${r.for}</td></tr>`).join("")}</tbody>
              </table>
            </div>
          </div>` : `<div class="empty-state">No Pool has been created for this Category. · 尚未建立小组</div>`}

          <div class="settings-divider"></div>
          <div class="settings-section-title">Court Access · 场地分配</div>
          <div class="subtle">Use the Court Control board above for live changes. This section keeps the Category-level overview. · 场地总览</div>
          <div class="court-checks">
            ${state.settings.courts.map(c => {
              const checked = courtHasCatAccess(c, cat);
              return `<label class="mini-check ${checked ? "active" : ""}" title="${c.allowAllActive ? "此 Court 已开放给全部 Active Cat" : ""}">
                <input type="checkbox" data-action="cat-court-toggle" data-cat-id="${cat.id}" value="${c.id}" ${checked ? "checked" : ""}>
                ${escapeHtml(c.name)}${c.allowAllActive && cat.active ? " · ALL ACTIVE" : ""}
              </label>`;
            }).join("")}
          </div>

          <div class="settings-divider"></div>
          <div class="settings-section-title">Playoff Settings · 淘汰赛</div>
          ${threePoolSeedPlan ? renderThreePoolSeedPanel(cat, threePoolSeedPlan) : crossoverReady ? `<div class="hint playoff-seeding-hint"><strong>TWO-POOL CROSSOVER · 交叉半决赛</strong><div class="crossover-preview">${crossoverPreview.map(row => `<div class="crossover-row"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.left)}</strong><b>VS</b><strong>${escapeHtml(row.right)}</strong></div>`).join("")}</div></div>` : `<div class="hint playoff-seeding-hint">Playoff seeding avoids same-Pool first-round matches where possible. · 尽量跨组配对</div>`}
          <div class="playoff-qualification-title">FULL POOL STANDINGS FOR PLAYOFF CHECK · 出线检查</div>
          <div class="playoff-standings-grid">
            ${cat.pools.map(pool => {
              const rows = standingsByPool.get(pool.id) || [];
              return `<div class="pool-rank"><table><thead><tr><th colspan="8">${escapeHtml(pool.name)} · ${rows.length} TEAMS</th></tr><tr><th>#</th><th>TEAM</th><th>W</th><th>L</th><th>PTS</th><th>H2H</th><th>DIFF</th><th>PF</th></tr></thead><tbody>${rows.map((row,idx) => `<tr class="${idx < Number(pool.advance || 0) ? "qualifier" : ""}"><td>${idx+1}</td><td>${escapeHtml(row.name)}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.points}</td><td class="tiebreak-cell">${escapeHtml(row.tieBreakNote || "-")}</td><td>${row.diff > 0 ? "+" : ""}${row.diff}</td><td>${row.for}</td></tr>`).join("")}</tbody></table></div>`;
            }).join("")}
          </div>
          <div class="inline-edit-grid playoff-rule-grid">
            <div>
              <label>THIRD PLACE RULE · 季军规则</label>
              <select class="compact-input" data-action="cat-thirdplace-input" data-cat-id="${cat.id}">
                <option value="margin" ${cat.playoffThirdPlace !== "bronze" ? "selected" : ""}>NO BRONZE MATCH · Rank semifinal losers by loss margin</option>
                <option value="bronze" ${cat.playoffThirdPlace === "bronze" ? "selected" : ""}>PLAY BRONZE MATCH · Winner takes third place</option>
              </select>
            </div>
            <div>
              <label>CURRENT RULE · 当前规则</label>
              <input class="compact-input" value="${escapeHtml(thirdPlaceRuleLabel(cat))}" disabled>
            </div>
          </div>

          <div class="admin-actions">
            <button class="ghost" data-action="generate-rr" data-cat-id="${cat.id}">REGENERATE RR · 重排</button>
            <button class="primary" data-action="generate-playoff" data-cat-id="${cat.id}">GENERATE PLAYOFF · 生成</button>
            <button class="danger" data-action="delete-cat" data-cat-id="${cat.id}">DELETE CATEGORY · 删除</button>
          </div>
        </article>`;
      }

      function computeStandings(catId, poolId){
        const pool = getPool(catId, poolId);
        if (!pool) return [];
        const completed = state.matches
          .filter(m => m.catId === catId && m.poolId === poolId && m.stage === "RR" && m.status === "done");
        return computePoolStandings(pool.teams, completed, { winPoints: 2 });
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
        const qualifiers = collectPlayoffQualifiers(cat);
        if (qualifiers.length < 2) {
          showToast("至少需要 2 支出线队伍才能生成 Playoff。");
          return 0;
        }

        state.matches = state.matches.filter(m => !(m.catId === catId && m.stage !== "RR"));
        const bracketPlan = buildPlayoffBracketPlan(cat, qualifiers);
        if (bracketPlan.strategy === "three-pool-six-seed") {
          const count = generateThreePoolSixSeedPlayoff(cat, bracketPlan);
          cat.status = "playoff";
          return count;
        }
        const ordered = bracketPlan.ordered;
        const bracketSize = bracketPlan.bracketSize;
        const firstPairs = bracketPlan.firstPairs;

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

      function buildPlayoffBracketPlan(cat, qualifiers){
        return buildPlayoffBracketPlanCore(cat.pools, qualifiers, {
          manualSeedOrder: cat.playoffSeedOrder || []
        });
      }

      function generateThreePoolSixSeedPlayoff(cat, bracketPlan){
        const seeds = bracketPlan.ordered || [];
        if (seeds.length !== 6) return 0;
        let seq = (state.matches.reduce((max, m) => Math.max(max, Number(m.sequence || 0)), 0) || 0) + 1;
        const makeMatch = (overrides) => ({
          id: uid("match"),
          catId: cat.id,
          poolId: "",
          courtId: "",
          scoreA: "",
          scoreB: "",
          winnerId: "",
          status: "waiting",
          sequence: seq++,
          createdAt: Date.now(),
          ...overrides
        });

        // Keep the requested game order in the official schedule:
        // QF1 = Seed 3 v Seed 6, QF2 = Seed 4 v Seed 5.
        const qf36 = makeMatch({
          stage: "QF",
          round: 1,
          bracketIndex: 1,
          bracketY: 2.35,
          teamAId: seeds[2].teamId,
          teamBId: seeds[5].teamId,
          seedA: seeds[2],
          seedB: seeds[5],
          status: "queued"
        });
        const qf45 = makeMatch({
          stage: "QF",
          round: 1,
          bracketIndex: 0,
          bracketY: 0.65,
          teamAId: seeds[3].teamId,
          teamBId: seeds[4].teamId,
          seedA: seeds[3],
          seedB: seeds[4],
          status: "queued"
        });
        const sf1 = makeMatch({
          stage: "SF",
          round: 2,
          bracketIndex: 0,
          bracketY: 0.65,
          teamAId: seeds[0].teamId,
          teamBId: "",
          seedA: seeds[0],
          teamBFrom: qf45.id,
          status: "waiting"
        });
        const sf2 = makeMatch({
          stage: "SF",
          round: 2,
          bracketIndex: 1,
          bracketY: 2.35,
          teamAId: seeds[1].teamId,
          teamBId: "",
          seedA: seeds[1],
          teamBFrom: qf36.id,
          status: "waiting"
        });
        const final = makeMatch({
          stage: "F",
          round: 3,
          bracketIndex: 0,
          bracketY: 1.5,
          teamAId: "",
          teamBId: "",
          teamAFrom: sf1.id,
          teamBFrom: sf2.id,
          status: "waiting"
        });

        qf45.feedsTo = sf1.id;
        qf45.feedsSide = "B";
        qf36.feedsTo = sf2.id;
        qf36.feedsSide = "B";
        sf1.feedsTo = final.id;
        sf1.feedsSide = "A";
        sf2.feedsTo = final.id;
        sf2.feedsSide = "B";

        const generated = [qf36, qf45, sf1, sf2];
        if (cat.playoffThirdPlace === "bronze") {
          const bronze = makeMatch({
            stage: "BR",
            round: 3,
            bracketIndex: 99,
            teamAId: "",
            teamBId: "",
            teamAFrom: sf1.id,
            teamBFrom: sf2.id,
            teamAFromType: "loser",
            teamBFromType: "loser",
            status: "waiting"
          });
          sf1.loserFeedsTo = bronze.id;
          sf1.loserFeedsSide = "A";
          sf2.loserFeedsTo = bronze.id;
          sf2.loserFeedsSide = "B";
          generated.push(bronze);
        }
        generated.push(final);
        state.matches.push(...generated);

        // Keep only a valid manual order. Automatic ranking remains live and
        // will be recalculated from standings until staff moves a seed.
        if (Array.isArray(cat.playoffSeedOrder) && cat.playoffSeedOrder.length && !bracketPlan.manualApplied) {
          cat.playoffSeedOrder = [];
        }
        return generated.length;
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
        m.prepareCourtId = courtId;
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
        if (!courtCanRunMatch(courtId, m)) {
          showToast("This court is not enabled for the match category / pool. · 场地未开放此项目小组");
          return;
        }
        m.status = "playing";
        m.courtId = courtId;
        m.prepareCourtId = courtId;
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
        m.prepareCourtId = m.courtId || m.prepareCourtId || "";
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
        openScoreCorrectionCatIds.add(m.catId);
        saveState();
        renderAll();
        showToast(m.stage === "RR" ? "比分已修改，RR 排名已更新。" : "Playoff 比分已修改，晋级关系已更新。");
      }

      function moveThreePoolSeed(catId, teamId, delta){
        const cat = getCat(catId);
        const plan = getThreePoolSeedPlan(cat);
        if (!cat || !plan || !teamId) return false;
        const ids = plan.ordered.map(seed => seed.teamId);
        const index = ids.indexOf(teamId);
        const nextIndex = Math.max(0, Math.min(ids.length - 1, index + delta));
        if (index < 0 || nextIndex === index) return false;
        const [moved] = ids.splice(index, 1);
        ids.splice(nextIndex, 0, moved);
        cat.playoffSeedOrder = ids;
        return true;
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
      showToast("后台已打开，Supabase 云端写入权限已启用。");
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
    openCourtAccessId = "";
    await logoutAdmin();
    showToast("后台已锁定。");
    return;
  }
  const writeActions = new Set([
    "finish-match","return-queue","assign-match","assign-next","fill-empty-courts",
    "generate-rr","generate-playoff","delete-cat","add-cat","add-court-to-cat",
    "clear-data","load-sample","prepare-match","prepare-top","prepare-up","prepare-down",
    "unprepare-match","clear-prepare-list","hold-match","release-match","release-and-top",
    "save-score-edit","seed-up","seed-down","reset-playoff-seeds"
  ]);
  if (!adminUnlocked && writeActions.has(action)){
    showToast("请先打开后台。所有云端修改都需要工作人员登录。");
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
  if (action === "seed-up" || action === "seed-down"){
    const changed = moveThreePoolSeed(btn.dataset.catId, btn.dataset.teamId, action === "seed-up" ? -1 : 1);
    if (changed) {
      saveState();
      renderAll();
      showToast("Manual cross-pool seed order updated. Regenerate the Playoff to apply it. · 跨池排名已调整");
    }
    return;
  }
  if (action === "reset-playoff-seeds"){
    const cat = getCat(btn.dataset.catId);
    if (!cat) return;
    cat.playoffSeedOrder = [];
    saveState();
    renderAll();
    showToast("Cross-pool seeds returned to automatic ranking. · 已恢复自动排名");
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
    cat.playoffSeedOrder = [];
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
    if (rrNotDone && !confirm("Round Robin is not complete. Generate the Playoff from the current standings anyway? · 小组赛尚未完成")) return;
    const existingPlayoff = state.matches.filter(m => m.catId === cat.id && m.stage !== "RR");
    if (existingPlayoff.length && !confirm(`Replace ${existingPlayoff.length} existing Playoff matches and their scores for ${cat.name}? This is required to apply the new seeding. · 将重建淘汰赛`)) return;
    const count = generatePlayoffForCat(cat.id);
    saveState();
    renderAll();
    showToast(count ? `Generated ${count} Playoff matches · ${thirdPlaceRuleLabel(cat)}` : "No Playoff was generated.");
    return;
  }
  if (action === "delete-cat"){
    const catId = btn.dataset.catId;
    const cat = getCat(catId);
    if (!cat) return;
    if (!confirm(`确认删除 ${cat.name}？相关赛程和比分都会删除。`)) return;
    state.categories = state.categories.filter(c => c.id !== catId);
    state.matches = state.matches.filter(m => m.catId !== catId);
    if (adminSettingsCatId === catId) adminSettingsCatId = "";
    delete adminPoolTabByCat[catId];
    state.settings.dashboardCatIds = state.settings.dashboardCatIds.filter(id => id !== catId);
    state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => state.matches.some(match => match.id === id));
    state.settings.courts.forEach(court => {
      if (court.poolAccess && typeof court.poolAccess === "object") delete court.poolAccess[catId];
    });
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
    adminSettingsCatId = cat.id;
    cat.courtIds = emptyCourts().slice(0, Math.min(2, state.settings.courts.length)).map(c => c.id);
    state.settings.courts.filter(c => c.allowAllActive).forEach(c => { if (!cat.courtIds.includes(c.id)) cat.courtIds.push(c.id); });
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
    adminSettingsCatId = "";
    adminPoolTabByCat = {};
    openScoreCorrectionCatIds = new Set();
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
    adminSettingsCatId = "";
    adminPoolTabByCat = {};
    openScoreCorrectionCatIds = new Set();
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

  const cloudMutationActions = new Set([
    "dashboard-cat-toggle","auto-next","prepare-limit","prepare-court-select","cat-active-toggle",
    "court-all-active-toggle","court-cat-toggle","court-all-pools-toggle","court-pool-toggle","cat-thirdplace-input",
    "cat-court-toggle","pool-advance-input","cat-name-input","pool-name-input","team-name-input"
  ]);
  if (!adminUnlocked && cloudMutationActions.has(action) && action !== "dashboard-cat-toggle"){
    showToast("请先登录工作人员后台后再修改云端设置。");
    renderAll();
    return;
  }

  if (action === "dashboard-cat-toggle"){
    if (!adminUnlocked){
      showToast("TV 2 公布项目由工作人员控制，请先登录后台后再选择。");
      renderResults();
      return;
    }
    const group = el.closest("[data-display-cat-group]") || document;
    const checkedIds = Array.from(group.querySelectorAll('[data-action="dashboard-cat-toggle"]:checked')).map(x => x.value);
    state.settings.dashboardCatIds = Array.from(new Set(checkedIds));
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
    showToast(`TV 1 will display the next ${state.settings.prepareLimit} games.`);
    return;
  }
  if (action === "prepare-court-select"){
    const match = getMatch(el.dataset.matchId);
    if (!match) return;
    const nextCourtId = el.value || "";
    if (nextCourtId && !courtCanRunMatch(nextCourtId, match)) {
      showToast("That court is not enabled for this category / pool. · 该场地未开放此项目小组");
      renderAll();
      return;
    }
    match.prepareCourtId = nextCourtId;
    saveState();
    renderAll();
    showToast(nextCourtId ? `Potential court set to ${getCourt(nextCourtId)?.name || nextCourtId}.` : "Potential court returned to AUTO.");
    return;
  }
  if (action === "cat-active-toggle"){
    const cat = getCat(el.dataset.catId);
    if (!cat) return;
    const nextActive = !!el.checked;
    const liveCount = state.matches.filter(m => m.catId === cat.id && m.status === "playing").length;
    if (!nextActive && liveCount && !confirm(`${cat.name} 仍有 ${liveCount} 场正在进行。停用后不会再自动排新比赛，但进行中比赛仍可完成。确认停用？`)) {
      el.checked = true;
      return;
    }
    cat.active = nextActive;
    if (nextActive) {
      state.settings.courts.filter(c => c.allowAllActive).forEach(c => {
        if (!cat.courtIds.includes(c.id)) cat.courtIds.push(c.id);
      });
    } else {
      state.settings.prepareMatchIds = (state.settings.prepareMatchIds || []).filter(id => getMatch(id)?.catId !== cat.id);
      if (adminCatFilter === cat.id) adminCatFilter = "all";
    }
    cleanPrepareMatchIds();
    saveState();
    renderAll();
    showToast(nextActive ? `${cat.name} 已加入当前时段。` : `${cat.name} 已设为 Inactive，不再进入 Queue 或自动排场。`);
    return;
  }
  if (action === "court-all-active-toggle"){
    setCourtAllActive(el.dataset.courtId, el.checked);
    saveState();
    renderAll();
    showToast(el.checked ? "此 Court 已开放给全部 Active Cat。" : "已清除此 Court 的全部 Active Cat 分配，可重新逐项勾选。");
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
    showToast(el.checked ? "Court opened to all pools in this category." : "Select the pools this court may run.");
    return;
  }
  if (action === "court-pool-toggle"){
    setCourtPoolAccess(el.dataset.courtId, el.dataset.catId, el.dataset.poolId, el.checked);
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
    setCourtCatAccess(el.value, el.dataset.catId, el.checked);
    saveState();
    renderAll();
    return;
  }
  if (action === "pool-advance-input"){
    const pool = getPool(el.dataset.catId, el.dataset.poolId);
    if (!pool) return;
    pool.advance = Math.max(0, Math.min(Number(el.value || 0), pool.teams.length));
    const cat = getCat(el.dataset.catId);
    if (cat) cat.playoffSeedOrder = [];
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
      openScoreCorrectionCatIds = new Set();
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
document.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.dataset.scoreCorrectionCat) return;
  if (details.open) openScoreCorrectionCatIds.add(details.dataset.scoreCorrectionCat);
  else openScoreCorrectionCatIds.delete(details.dataset.scoreCorrectionCat);
}, true);
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "importFile" && e.target.files?.[0]) {
    if (!adminUnlocked){
      showToast("请先打开后台。");
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
