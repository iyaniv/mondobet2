/**
 * api.demo.js — in-memory mock backend. No server or DB required.
 * Activated via: npm run demo  (uses vite.config.demo.js)
 *
 * Pre-seeded accounts:
 *   admin / admin           ← admin dashboard
 *   alice@demo.com / alice  ← submitted form, high score
 *   bob@demo.com   / bob    ← submitted form, medium score
 *   charlie@demo.com / charlie ← submitted form, low score
 *   (or sign up with any new email)
 *
 * State persists in localStorage. To reset: window._resetDemo()
 */

// ── Match data (mirrors app/matches.py) ─────────────────────────────────────
const MATCHES = [
  {n:1,g:"A",a:"Mexico",b:"South Africa"},
  {n:2,g:"A",a:"Korea Republic",b:"Czech Republic"},
  {n:3,g:"B",a:"Canada",b:"Bosnia and Herzegovina"},
  {n:4,g:"D",a:"United States",b:"Paraguay"},
  {n:5,g:"C",a:"Haiti",b:"Scotland"},
  {n:6,g:"D",a:"Australia",b:"Turkey"},
  {n:7,g:"C",a:"Brazil",b:"Morocco"},
  {n:8,g:"B",a:"Qatar",b:"Switzerland"},
  {n:9,g:"E",a:"Ivory Coast",b:"Ecuador"},
  {n:10,g:"E",a:"Germany",b:"Curaçao"},
  {n:11,g:"F",a:"Netherlands",b:"Japan"},
  {n:12,g:"F",a:"Sweden",b:"Tunisia"},
  {n:13,g:"H",a:"Saudi Arabia",b:"Uruguay"},
  {n:14,g:"H",a:"Spain",b:"Cape Verde"},
  {n:15,g:"G",a:"Iran",b:"New Zealand"},
  {n:16,g:"G",a:"Belgium",b:"Egypt"},
  {n:17,g:"I",a:"France",b:"Senegal"},
  {n:18,g:"I",a:"Iraq",b:"Norway"},
  {n:19,g:"J",a:"Argentina",b:"Algeria"},
  {n:20,g:"J",a:"Austria",b:"Jordan"},
  {n:21,g:"L",a:"Ghana",b:"Panama"},
  {n:22,g:"L",a:"England",b:"Croatia"},
  {n:23,g:"K",a:"Portugal",b:"DR Congo"},
  {n:24,g:"K",a:"Uzbekistan",b:"Colombia"},
  {n:25,g:"A",a:"Czech Republic",b:"South Africa"},
  {n:26,g:"B",a:"Switzerland",b:"Bosnia and Herzegovina"},
  {n:27,g:"B",a:"Canada",b:"Qatar"},
  {n:28,g:"A",a:"Mexico",b:"Korea Republic"},
  {n:29,g:"C",a:"Brazil",b:"Haiti"},
  {n:30,g:"C",a:"Scotland",b:"Morocco"},
  {n:31,g:"D",a:"United States",b:"Australia"},
  {n:32,g:"D",a:"Turkey",b:"Paraguay"},
  {n:33,g:"E",a:"Germany",b:"Ivory Coast"},
  {n:34,g:"E",a:"Ecuador",b:"Curaçao"},
  {n:35,g:"F",a:"Netherlands",b:"Sweden"},
  {n:36,g:"F",a:"Tunisia",b:"Japan"},
  {n:37,g:"H",a:"Uruguay",b:"Cape Verde"},
  {n:38,g:"H",a:"Spain",b:"Saudi Arabia"},
  {n:39,g:"G",a:"Belgium",b:"Iran"},
  {n:40,g:"G",a:"New Zealand",b:"Egypt"},
  {n:41,g:"I",a:"Norway",b:"Senegal"},
  {n:42,g:"I",a:"France",b:"Iraq"},
  {n:43,g:"J",a:"Argentina",b:"Austria"},
  {n:44,g:"J",a:"Jordan",b:"Algeria"},
  {n:45,g:"L",a:"England",b:"Ghana"},
  {n:46,g:"L",a:"Panama",b:"Croatia"},
  {n:47,g:"K",a:"Portugal",b:"Uzbekistan"},
  {n:48,g:"K",a:"Colombia",b:"DR Congo"},
  {n:49,g:"C",a:"Scotland",b:"Brazil"},
  {n:50,g:"C",a:"Morocco",b:"Haiti"},
  {n:51,g:"B",a:"Switzerland",b:"Canada"},
  {n:52,g:"B",a:"Bosnia and Herzegovina",b:"Qatar"},
  {n:53,g:"A",a:"Czech Republic",b:"Mexico"},
  {n:54,g:"A",a:"South Africa",b:"Korea Republic"},
  {n:55,g:"E",a:"Curaçao",b:"Ivory Coast"},
  {n:56,g:"E",a:"Ecuador",b:"Germany"},
  {n:57,g:"F",a:"Japan",b:"Sweden"},
  {n:58,g:"F",a:"Tunisia",b:"Netherlands"},
  {n:59,g:"D",a:"Turkey",b:"United States"},
  {n:60,g:"D",a:"Paraguay",b:"Australia"},
  {n:61,g:"I",a:"Norway",b:"France"},
  {n:62,g:"I",a:"Senegal",b:"Iraq"},
  {n:63,g:"G",a:"Egypt",b:"Iran"},
  {n:64,g:"G",a:"New Zealand",b:"Belgium"},
  {n:65,g:"H",a:"Cape Verde",b:"Saudi Arabia"},
  {n:66,g:"H",a:"Uruguay",b:"Spain"},
  {n:67,g:"L",a:"Panama",b:"England"},
  {n:68,g:"L",a:"Croatia",b:"Ghana"},
  {n:69,g:"J",a:"Algeria",b:"Austria"},
  {n:70,g:"J",a:"Jordan",b:"Argentina"},
  {n:71,g:"K",a:"Colombia",b:"Portugal"},
  {n:72,g:"K",a:"DR Congo",b:"Uzbekistan"},
];
const TEAMS = [...new Set(MATCHES.flatMap(m=>[m.a,m.b]))].sort();

// ── Scoring ──────────────────────────────────────────────────────────────────
function matchPts(pred, result) {
  if (!pred||pred[0]==null||!result) return 0;
  const [pa,pb]=[pred[0],pred[1]],[ra,rb]=[result[0],result[1]];
  const sgn=x=>x===0?0:x>0?1:-1;
  return (sgn(pa-pb)===sgn(ra-rb)?5:0) + (pa===ra&&pb===rb?3:pa===ra||pb===rb?1:0);
}

function calcTotals(preds, results, live, winnerPick, tournamentWinner) {
  let total=0,exact=0,correctDir=0,scored=0,livePoints=0,liveCount=0;
  const sgn=x=>x===0?0:x>0?1:-1;
  for (const [n,r] of Object.entries(results)) {
    const p=preds[Number(n)]; if(!p||p[0]==null) continue;
    const pts=matchPts(p,r); total+=pts; scored++;
    if(p[0]===r[0]&&p[1]===r[1]) exact++;
    if(sgn(p[0]-p[1])===sgn(r[0]-r[1])) correctDir++;
  }
  for (const [n,ld] of Object.entries(live)) {
    const mn=Number(n); if(results[mn]) continue;
    const p=preds[mn]; if(!p||p[0]==null) continue;
    const pts=matchPts(p,[ld.score_a,ld.score_b]);
    livePoints+=pts; liveCount++;
  }
  const winnerBonus=tournamentWinner&&winnerPick===tournamentWinner?10:0;
  total+=winnerBonus;
  return {total,exact,correct_dir:correctDir,scored_matches:scored,winner_pick:winnerPick,winner_bonus:winnerBonus,live_points:livePoints,live_matches_count:liveCount};
}

// ── Seeded RNG for deterministic demo predictions ────────────────────────────
function srng(seed) {
  let s=seed>>>0;
  return ()=>{s=((s*1664525)+1013904223)>>>0; return s/0x100000000;};
}

function genPreds(seed, skill) {
  const r=srng(seed);
  const out={};
  const RESULTS={1:[2,1],2:[1,1],3:[2,0],4:[1,2],5:[0,3],6:[1,1],7:[3,1],8:[0,2],9:[1,2],10:[4,0],11:[2,1],12:[2,2],13:[1,0],14:[3,0],15:[0,1],16:[2,1],17:[2,0],18:[1,2],19:[3,1],20:[2,0]};
  for (const m of MATCHES) {
    const res=RESULTS[m.n];
    let pa,pb;
    const x=r();
    if (skill===1&&res) {
      if(x<0.55){pa=res[0];pb=res[1];}
      else if(x<0.80){pa=res[0];pb=Math.max(0,res[1]+(r()<.5?1:-1));}
      else if(x<0.92){pa=Math.max(0,res[0]+(r()<.5?1:-1));pb=res[1];}
      else{pa=Math.floor(r()*3);pb=Math.floor(r()*3);}
    } else if(skill===2&&res){
      if(x<0.25){pa=res[0];pb=res[1];}
      else if(x<0.55){pa=res[0];pb=Math.max(0,res[1]+(r()<.5?1:-1));}
      else{pa=Math.floor(r()*3);pb=Math.floor(r()*3);}
    } else {
      pa=Math.floor(r()*3);pb=Math.floor(r()*3);
    }
    out[m.n]=[pa,pb];
  }
  return out;
}

// ── Initial state ────────────────────────────────────────────────────────────
const SEED_RESULTS = {1:[2,1],2:[1,1],3:[2,0],4:[1,2],5:[0,3],6:[1,1],7:[3,1],8:[0,2],9:[1,2],10:[4,0],11:[2,1],12:[2,2],13:[1,0],14:[3,0],15:[0,1],16:[2,1],17:[2,0],18:[1,2],19:[3,1],20:[2,0]};
const SEED_LIVE   = {21:{score_a:1,score_b:0,minute:34},22:{score_a:2,score_b:2,minute:67}};

function buildInitialState() {
  return {
    config:{round_state:"open",tournament_winner:null},
    users:{
      1:{id:1,name:"Admin",email:"admin",password:"admin",is_admin:true,has_paid:false,created_at:"2026-01-01T00:00:00Z",locked_winner:null},
      2:{id:2,name:"Alice",email:"alice@demo.com",password:"alice",is_admin:false,has_paid:true,created_at:"2026-01-02T00:00:00Z",locked_winner:"France"},
      3:{id:3,name:"Bob",email:"bob@demo.com",password:"bob",is_admin:false,has_paid:true,created_at:"2026-01-03T00:00:00Z",locked_winner:"Argentina"},
      4:{id:4,name:"Charlie",email:"charlie@demo.com",password:"charlie",is_admin:false,has_paid:false,created_at:"2026-01-04T00:00:00Z",locked_winner:"Brazil"},
    },
    entries:{
      "ea1":{id:"ea1",user_id:2,name:"Alice",created_at:"2026-05-01T10:00:00Z",submitted_at:"2026-05-01T10:30:00Z"},
      "eb1":{id:"eb1",user_id:3,name:"Bob",created_at:"2026-05-01T11:00:00Z",submitted_at:"2026-05-01T11:30:00Z"},
      "ec1":{id:"ec1",user_id:4,name:"Charlie",created_at:"2026-05-01T12:00:00Z",submitted_at:"2026-05-01T12:30:00Z"},
    },
    predictions:{
      "ea1":genPreds(20001,1),
      "eb1":genPreds(30001,2),
      "ec1":genPreds(40001,3),
    },
    winner_picks:{"ea1":"France","eb1":"Argentina","ec1":"Brazil"},
    results:{...SEED_RESULTS},
    live:{...SEED_LIVE},
    next_user_id:5,
    next_entry_seq:10,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────
const STORAGE_KEY = "mb_demo_v1";
function loadState() {
  try { const s=localStorage.getItem(STORAGE_KEY); if(s) return JSON.parse(s); } catch{}
  return buildInitialState();
}
function save(s) {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(s)); } catch{}
}

let S = loadState();

window._resetDemo = () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("wc2026_token");
  location.reload();
};

console.log('%c🎮 MondoBet — Demo Mode (no server needed)', 'color:#a3e635;font-size:13px;font-weight:bold');
console.log('Accounts: admin/admin · alice@demo.com/alice · bob@demo.com/bob · charlie@demo.com/charlie');
console.log('Or sign up with any email. Call window._resetDemo() to wipe all data and restart.');

// ── Token / auth ─────────────────────────────────────────────────────────────
let _token = localStorage.getItem("wc2026_token") || null;

export function setToken(t) {
  _token = t;
  if (t) localStorage.setItem("wc2026_token", t);
  else   localStorage.removeItem("wc2026_token");
}
export function getToken() { return _token; }

function currentUid() {
  if (!_token) return null;
  const m = _token.match(/^demo_(\d+)$/);
  return m ? Number(m[1]) : null;
}
function getUser() {
  const uid = currentUid();
  return uid ? S.users[uid] || null : null;
}
function requireUser() {
  const u = getUser();
  if (!u) throw new Error("Not authenticated");
  return u;
}
function requireAdmin() {
  const u = requireUser();
  if (!u.is_admin) throw new Error("Admin only");
  return u;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const delay = (ms=70) => new Promise(r => setTimeout(r, ms + Math.random()*30));

function userOut(u) {
  return {id:u.id,name:u.name,email:u.email,is_admin:u.is_admin,has_paid:u.has_paid,locked_winner:u.locked_winner||null};
}
function entryOut(e) {
  return {id:e.id,name:e.name,created_at:e.created_at,submitted_at:e.submitted_at||null};
}

function resolveEntryId(user, entryId) {
  if (entryId) {
    const e = S.entries[entryId];
    if (!e||e.user_id!==user.id) throw new Error("Entry not found");
    return entryId;
  }
  const all = Object.values(S.entries)
    .filter(e=>e.user_id===user.id)
    .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const draft = all.find(e=>!e.submitted_at);
  return (draft||all[all.length-1])?.id;
}

// ── Leaderboard computation ──────────────────────────────────────────────────
function computeLeaderboard() {
  const rows = [];
  for (const user of Object.values(S.users)) {
    if (user.is_admin) continue;
    for (const entry of Object.values(S.entries).filter(e=>e.user_id===user.id&&e.submitted_at)) {
      const preds = S.predictions[entry.id]||{};
      const wp    = S.winner_picks[entry.id]||null;
      const t     = calcTotals(preds,S.results,S.live,wp,S.config.tournament_winner);
      const filled = Object.values(preds).filter(p=>p[0]!=null&&p[1]!=null).length;
      rows.push({
        entry_id:entry.id, user_id:user.id, name:entry.name,
        total:t.total, exact:t.exact, correct_dir:t.correct_dir,
        scored_matches:t.scored_matches, winner_pick:wp, winner_bonus:t.winner_bonus,
        has_paid:user.has_paid, submitted_count:filled,
        live_points:t.live_points, live_matches_count:t.live_matches_count,
      });
    }
  }
  return rows.sort((a,b)=>b.total-a.total);
}

// ── Admin participants computation ───────────────────────────────────────────
function computeAdminParticipants() {
  return Object.values(S.users).filter(u=>!u.is_admin).map(user=>{
    const userEntries = Object.values(S.entries)
      .filter(e=>e.user_id===user.id)
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    const entriesData = userEntries.map(e=>{
      const preds = S.predictions[e.id]||{};
      const wp    = S.winner_picks[e.id]||null;
      const filled = Object.values(preds).filter(p=>p[0]!=null&&p[1]!=null).length;
      let points=null,livePoints=0;
      if (e.submitted_at) {
        const t=calcTotals(preds,S.results,S.live,wp,S.config.tournament_winner);
        points=t.total; livePoints=t.live_points;
      }
      return {id:e.id,name:e.name,submitted_at:e.submitted_at||null,filled,total_matches:MATCHES.length,winner_pick:wp,locked_winner:user.locked_winner||null,points,live_points:livePoints};
    });
    const submittedCount = userEntries.filter(e=>e.submitted_at).length;
    const draftCount = userEntries.length - submittedCount;
    const bestTotal = Math.max(0,...entriesData.filter(e=>e.points!=null).map(e=>e.points),0);
    return {id:user.id,name:user.name,email:user.email,has_paid:user.has_paid,locked_winner:user.locked_winner||null,entries:entriesData,submitted_count:submittedCount,draft_count:draftCount,best_total:bestTotal};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}

// ── API ───────────────────────────────────────────────────────────────────────
export const api = {
  // ── Auth
  signup: async (d) => {
    await delay();
    const email = d.email.trim().toLowerCase();
    if (Object.values(S.users).find(u=>u.email===email)) throw new Error("Email already registered");
    const id = S.next_user_id++;
    const user = {id,name:d.name.trim(),email,password:d.password,is_admin:false,has_paid:false,created_at:new Date().toISOString(),locked_winner:null};
    S.users[id] = user;
    const entryId = `entry-u${id}-1`;
    S.entries[entryId] = {id:entryId,user_id:id,name:d.name.trim(),created_at:new Date().toISOString(),submitted_at:null};
    S.predictions[entryId] = {};
    save(S);
    return {user:userOut(user), token:`demo_${id}`};
  },

  login: async (d) => {
    await delay();
    const email = d.email.trim().toLowerCase();
    const user = Object.values(S.users).find(u=>u.email===email);
    if (!user||user.password!==d.password) throw new Error("Invalid email or password");
    return {user:userOut(user), token:`demo_${user.id}`};
  },

  me: async () => {
    await delay(30);
    const u = getUser();
    if (!u) throw new Error("Not authenticated");
    return userOut(u);
  },

  // ── Game data
  getMatches:     async () => { await delay(30); return MATCHES; },
  getConfig:      async () => { await delay(30); return S.config; },
  getResults:     async () => { await delay(30); return Object.entries(S.results).map(([n,r])=>({match_n:Number(n),score_a:r[0],score_b:r[1]})); },
  getLeaderboard: async () => { await delay(50); return computeLeaderboard(); },

  // ── Entries
  getMyEntries: async () => {
    await delay();
    const user = requireUser();
    return Object.values(S.entries)
      .filter(e=>e.user_id===user.id)
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))
      .map(entryOut);
  },

  createEntry: async (d) => {
    await delay();
    const user = requireUser();
    if (S.config.round_state !== "open") throw new Error("Round is not open");
    const existing = Object.values(S.entries).filter(e=>e.user_id===user.id);
    const names = existing.map(e=>e.name);
    let name = d?.name?.trim() || user.name;
    if (names.includes(name)) { let n=2; while(names.includes(`${user.name} ${n}`)) n++; name=`${user.name} ${n}`; }
    const eid = `entry-u${user.id}-${++S.next_entry_seq}`;
    const entry = {id:eid,user_id:user.id,name,created_at:new Date().toISOString(),submitted_at:null};
    S.entries[eid] = entry;
    S.predictions[eid] = {};
    if (user.locked_winner) S.winner_picks[eid] = user.locked_winner;
    save(S);
    return entryOut(entry);
  },

  renameEntry: async (id, d) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry||entry.user_id!==user.id) throw new Error("Entry not found");
    entry.name = d.name.trim();
    save(S);
    return entryOut(entry);
  },

  deleteEntry: async (id) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry||entry.user_id!==user.id) throw new Error("Entry not found");
    if (entry.submitted_at) throw new Error("Cannot delete a submitted entry");
    delete S.entries[id];
    delete S.predictions[id];
    delete S.winner_picks[id];
    save(S);
    return null;
  },

  submitEntry: async (id) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry||entry.user_id!==user.id) throw new Error("Entry not found");
    if (entry.submitted_at) return entryOut(entry);
    const preds = S.predictions[id]||{};
    const filled = Object.values(preds).filter(p=>p[0]!=null&&p[1]!=null).length;
    if (filled < MATCHES.length) throw new Error(`Fill all ${MATCHES.length} predictions first (${filled} done)`);
    if (!S.winner_picks[id]) throw new Error("Set a tournament winner pick first");
    entry.submitted_at = new Date().toISOString();
    // Winner lock on first submit
    if (!user.locked_winner) {
      user.locked_winner = S.winner_picks[id];
      for (const e of Object.values(S.entries)) {
        if (e.user_id===user.id && e.id!==id) S.winner_picks[e.id] = user.locked_winner;
      }
    }
    save(S);
    return entryOut(entry);
  },

  getEntryPreds: async (id) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry||entry.user_id!==user.id) throw new Error("Entry not found");
    return Object.entries(S.predictions[id]||{}).map(([n,p])=>({match_n:Number(n),score_a:p[0],score_b:p[1]}));
  },

  // ── Predictions
  getMyPredictions: async (entryId) => {
    await delay(30);
    const user = requireUser();
    const eid = resolveEntryId(user,entryId);
    if (!eid) return [];
    return Object.entries(S.predictions[eid]||{}).map(([n,p])=>({match_n:Number(n),score_a:p[0],score_b:p[1]}));
  },

  setPrediction: async (matchN, d, entryId) => {
    await delay(30);
    const user = requireUser();
    if (S.config.round_state !== "open") throw new Error("Round is not open");
    const eid = resolveEntryId(user,entryId);
    if (!eid) throw new Error("No entry");
    const entry = S.entries[eid];
    if (entry.submitted_at) throw new Error("Entry already submitted");
    if (!S.predictions[eid]) S.predictions[eid] = {};
    S.predictions[eid][matchN] = [d.score_a, d.score_b];
    save(S);
    return {match_n:matchN,score_a:d.score_a,score_b:d.score_b};
  },

  setWinnerPick: async (d, entryId) => {
    await delay(30);
    const user = requireUser();
    if (S.config.round_state !== "open") throw new Error("Round is not open");
    if (user.locked_winner) throw new Error("Winner is locked after first submission");
    const eid = resolveEntryId(user,entryId);
    if (!eid) throw new Error("No entry");
    const entry = S.entries[eid];
    if (entry.submitted_at) throw new Error("Entry already submitted");
    if (d.team) S.winner_picks[eid] = d.team;
    else delete S.winner_picks[eid];
    save(S);
    return {entry_id:eid,team:d.team||null};
  },

  getUserPredictions: async (uid, entryId) => {
    await delay();
    const caller = getUser();
    if (!caller) throw new Error("Not authenticated");
    if (!caller.is_admin && S.config.round_state !== "closed") throw new Error("Predictions hidden until round closes");
    const eid = entryId || Object.values(S.entries)
      .filter(e=>e.user_id===Number(uid)&&e.submitted_at)
      .sort((a,b)=>new Date(a.submitted_at)-new Date(b.submitted_at))[0]?.id;
    if (!eid) return [];
    return Object.entries(S.predictions[eid]||{}).map(([n,p])=>({match_n:Number(n),score_a:p[0],score_b:p[1]}));
  },

  // ── Admin
  updateConfig: async (d) => {
    await delay();
    requireAdmin();
    if (d.round_state !== undefined) S.config.round_state = d.round_state;
    if ("tournament_winner" in d) S.config.tournament_winner = d.tournament_winner||null;
    save(S);
    return S.config;
  },

  setResult: async (n, d) => {
    await delay();
    requireAdmin();
    if (d.score_a!=null&&d.score_b!=null) { S.results[n]=[d.score_a,d.score_b]; delete S.live[n]; }
    else delete S.results[n];
    save(S);
    return {match_n:n,...d};
  },

  getUsers: async () => {
    await delay();
    requireAdmin();
    return Object.values(S.users).filter(u=>!u.is_admin).map(userOut);
  },

  patchUser: async (uid, d) => {
    await delay();
    requireAdmin();
    const user = S.users[uid];
    if (!user) throw new Error("User not found");
    if (d.has_paid !== undefined) user.has_paid = d.has_paid;
    save(S);
    return userOut(user);
  },

  updateMe: async (d) => {
    await delay();
    const user = requireUser();
    if (d.name) user.name = d.name.trim();
    save(S);
    return userOut(user);
  },

  getAdminParticipants: async () => {
    await delay();
    requireAdmin();
    return computeAdminParticipants();
  },
};

// ── Live API ──────────────────────────────────────────────────────────────────
export const liveApi = {
  getAll: async () => {
    await delay(30);
    return Object.entries(S.live).map(([n,ld])=>({match_n:Number(n),...ld}));
  },
  set: async (n, d) => {
    await delay();
    requireAdmin();
    S.live[Number(n)] = {score_a:d.score_a,score_b:d.score_b,minute:d.minute};
    save(S);
    return {match_n:Number(n),...d};
  },
  remove: async (n) => {
    await delay();
    requireAdmin();
    delete S.live[Number(n)];
    save(S);
    return null;
  },
  finalize: async (n) => {
    await delay();
    requireAdmin();
    const ld = S.live[Number(n)];
    if (!ld) throw new Error("Match is not live");
    S.results[Number(n)] = [ld.score_a, ld.score_b];
    delete S.live[Number(n)];
    save(S);
    return {match_n:Number(n),score_a:ld.score_a,score_b:ld.score_b};
  },
};

// ── Init (bootstrap) ─────────────────────────────────────────────────────────
export const initApi = {
  load: async () => {
    await delay(80);
    const user = getUser();
    const leaderboard = computeLeaderboard();
    const resultsArr = Object.entries(S.results).map(([n,r])=>({match_n:Number(n),score_a:r[0],score_b:r[1]}));
    const liveArr = Object.entries(S.live).map(([n,ld])=>({match_n:Number(n),...ld}));

    const out = {
      matches: MATCHES,
      teams: TEAMS,
      config: S.config,
      results: resultsArr,
      live: liveArr,
      leaderboard,
    };

    if (user && !user.is_admin) {
      const userEntries = Object.values(S.entries)
        .filter(e=>e.user_id===user.id)
        .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))
        .map(e=>({
          id:e.id, name:e.name, created_at:e.created_at, submitted_at:e.submitted_at||null,
          predictions:Object.entries(S.predictions[e.id]||{}).map(([n,p])=>({match_n:Number(n),score_a:p[0],score_b:p[1]})),
          winner_pick:S.winner_picks[e.id]||null,
        }));
      out.entries = userEntries;
      out.locked_winner = user.locked_winner||null;
      // backward-compat
      const first = userEntries[0];
      if (first) { out.my_predictions=first.predictions; out.my_winner_pick=first.winner_pick; }
    }

    if (user && user.is_admin) {
      const participants = computeAdminParticipants();
      out.participants = participants;
      out.users = participants.map(p=>({id:p.id,name:p.name,email:p.email,is_admin:false,has_paid:p.has_paid,locked_winner:p.locked_winner}));
    }

    return out;
  },
};
