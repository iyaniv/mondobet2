import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { api, liveApi, initApi, demoVariantApi, setToken, getToken } from "./api";

const C = {
  bg:"var(--c-bg)", panel:"var(--c-panel)", panel2:"var(--c-panel2)",
  border:"var(--c-border)", text:"var(--c-text)", muted:"var(--c-muted)",
  accent:"var(--c-accent)", accentDk:"var(--c-accent-dk)", accentSoft:"var(--c-accent-soft)", green:"var(--c-green)", red:"var(--c-red)", indigo:"var(--c-indigo)",
};

// Opt-in perf logging — silent for normal users. Enable with `?perf` in the URL
// or `localStorage.mb_perf = "1"`. Purely diagnostic; no behavior change.
// `perfNow()` returns ms since page load (performance.now), so absolute values
// read as "this happened N ms after the page started loading".
const PERF_ON = typeof window !== "undefined" &&
  (window.location.search.includes("perf") ||
   (() => { try { return localStorage.getItem("mb_perf") === "1"; } catch { return false; } })());
const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const perfLog = (...a) => { if (PERF_ON) console.log("[perf]", ...a); };

// Stage definitions — mirrors app/matches.py STAGES
const STAGES = [
  { n:1, name:"Group Stage",   first:1,   last:72  },
  { n:2, name:"Round of 32",   first:73,  last:88  },
  { n:3, name:"Round of 16",   first:89,  last:96  },
  { n:4, name:"Quarterfinals", first:97,  last:100 },
  { n:5, name:"Semi-finals",   first:101, last:102 },
  { n:6, name:"Final & 3rd",   first:103, last:104 },
];
function matchStageObj(n) { return STAGES.find(s => n >= s.first && n <= s.last) || STAGES[0]; }

// Determine who advanced in a knockout match: penalties → extra time →
// 90-min score. Returns "a", "b", or null. Mirrors crud.derive_winner.
function deriveWinner(sa, sb, etA, etB, penA, penB) {
  if (penA != null && penB != null && penA !== penB) return penA > penB ? "a" : "b";
  if (etA  != null && etB  != null && etA  !== etB ) return etA  > etB  ? "a" : "b";
  if (sa   != null && sb   != null && sa   !== sb  ) return sa   > sb   ? "a" : "b";
  return null;
}

// Resolve slot names like "W M73" / "L M101" to actual team names using known results
function resolveTeam(name, results, matches) {
  const m = name.match(/^([WL]) M(\d+)$/);
  if (!m) return name;
  const type = m[1], n = Number(m[2]);
  const res = results[n];
  const src = matches.find(x => x.n === n);
  if (!res || !src) return name; // TBD
  const [sa, sb, winner] = res;
  // Derive winner: explicit field first (ET/pens), then score, then unresolved
  const w = winner || (sa > sb ? 'a' : sb > sa ? 'b' : null);
  if (!w) return name; // genuinely tied with no winner set yet
  return type === 'W' ? (w === 'a' ? src.a : src.b) : (w === 'a' ? src.b : src.a);
}

// Which match the "Match picks" column follows by default (Auto). The current
// game = a live game (pick the lowest-numbered if several run in parallel), else
// the most-recently-kicked-off finished game — but once we're within 10 minutes
// of the next viewable game's kickoff, jump ahead to it so its picks are up
// before kickoff. `viewable(m)` excludes games whose picks are still hidden
// (the open betting stage). Returns a match number, or null if nothing applies.
const MATCH_PICK_LOOKAHEAD_MS = 10 * 60 * 1000;
function computeAutoMatchN(matches, results, liveMatches, nowMs, viewable) {
  const koAt = (m) => { const d = new Date(m.t).getTime(); return isNaN(d) ? 0 : d; };
  const isLive = (m) => !!(liveMatches[m.n] && liveMatches[m.n].is_live);
  const live = matches.filter(isLive).sort((a, b) => a.n - b.n);
  if (live.length) return live[0].n;
  const ended = matches.filter(m => results[m.n]).sort((a, b) => koAt(b) - koAt(a) || b.n - a.n);
  const upcoming = matches
    .filter(m => viewable(m) && !results[m.n] && !isLive(m) && koAt(m) > nowMs)
    .sort((a, b) => koAt(a) - koAt(b) || a.n - b.n);
  const next = upcoming[0];
  if (next && nowMs >= koAt(next) - MATCH_PICK_LOOKAHEAD_MS) return next.n;
  if (ended.length) return ended[0].n;
  return null;
}

// Recursive variant: resolves through multiple rounds using any scores map
// (results or sim preds). Also resolves Stage-2 slot labels: "1st A" / "2nd B"
// (from group standings) and "Best 3rd (N)" (Nth best 3rd-place across groups).
function resolveTeamDeep(name, scoresMap, matchList, depth = 0) {
  if (depth > 8) return name;

  // Stage-2 group-rank slots: "1st A", "2nd B", "3rd C"
  let m = name.match(/^(1st|2nd|3rd)\s+([A-L])$/);
  if (m) {
    const rank = m[1] === "1st" ? 0 : m[1] === "2nd" ? 1 : 2;
    const gm = matchList.filter(x => x.s === 1 && x.g === m[2]);
    if (gm.length === 0) return name;
    // Only resolve once every group match has a final result
    if (!gm.every(x => scoresMap[x.n] != null)) return name;
    const standings = computeGroupStandings(m[2], matchList, scoresMap, {}, {});
    return standings[rank]?.name || name;
  }

  // Stage-2 best-third slots: "Best 3rd (1)" .. "Best 3rd (8)"
  m = name.match(/^Best 3rd \((\d+)\)$/);
  if (m) {
    const idx = Number(m[1]) - 1;
    const groups = ["A","B","C","D","E","F","G","H","I","J","K","L"];
    const allThirds = [];
    for (const g of groups) {
      const gm = matchList.filter(x => x.s === 1 && x.g === g);
      if (gm.length === 0) continue;
      // All groups must be fully decided before "Best 3rd" can rank them
      if (!gm.every(x => scoresMap[x.n] != null)) return name;
      const standings = computeGroupStandings(g, matchList, scoresMap, {}, {});
      if (standings[2]) allThirds.push(standings[2]);
    }
    if (allThirds.length === 0) return name;
    allThirds.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||a.name.localeCompare(b.name));
    return allThirds[idx]?.name || name;
  }

  // Knockout slots: "W M73" / "L M101"
  m = name.match(/^([WL]) M(\d+)$/);
  if (!m) return name;
  const type = m[1], n = Number(m[2]);
  const src = matchList.find(x => x.n === n);
  if (!src) return name;
  const teamA = resolveTeamDeep(src.a, scoresMap, matchList, depth + 1);
  const teamB = resolveTeamDeep(src.b, scoresMap, matchList, depth + 1);
  const res = scoresMap[n];
  if (!res) return name;
  const [sa, sb, winner] = res;
  // Use explicit winner (ET/pens) first, then derive from score
  const w = winner || (sa > sb ? 'a' : sb > sa ? 'b' : null);
  if (!w) return name; // tied with no winner set — bracket TBD
  return type === 'W' ? (w === 'a' ? teamA : teamB) : (w === 'a' ? teamB : teamA);
}

// Wrap a match so its team labels are resolved (e.g. "1st A" → "Mexico").
// Cheap object spread; safe to call on every render.
function resolvedMatch(m, results, allMatches) {
  if (!m || m.s === 1) return m;  // group stage already has real team names
  return {
    ...m,
    a: resolveTeamDeep(m.a, results, allMatches),
    b: resolveTeamDeep(m.b, results, allMatches),
  };
}

// "?" help icon next to the Import CSV button — a click pops a small panel
// with the full how-to (replaces the long button tooltip).
// Hook: returns a ref to attach to the trigger element, plus a style object
// for the popup that keeps it within the viewport using position:fixed.
// position:fixed escapes any overflow:hidden ancestor that would clip an
// absolute popup, while still rendering visually near the trigger button.
function useAnchoredPopup({ open, preferLeft=false, width=340 }) {
  const triggerRef = useRef(null);
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
    if (!open) setRect(null);
  }, [open]);
  let popupStyle = null;
  if (open && rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;
    const popW = Math.min(width, vw - 20);
    const left = preferLeft
      ? Math.max(10, Math.min(rect.left, vw - popW - 10))
      : Math.max(10, Math.min(rect.right - popW, vw - popW - 10));
    // Prefer opening below the trigger; if there's more room above, open upward.
    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 280 && spaceAbove > spaceBelow;
    popupStyle = {
      position:"fixed",
      ...(openUp
        ? { bottom: vh - rect.top + 8, maxHeight: spaceAbove }
        : { top: rect.bottom + 8, maxHeight: spaceBelow }),
      left,
      width: popW,
      overflowY:"auto",
      zIndex:99,
    };
  }
  return { triggerRef, popupStyle };
}

// Shared styling so every stats popup behaves identically: a dimmed-backdrop
// modal that is near-fullscreen on mobile and a centered box on desktop.
const STATS_BACKDROP_STYLE = {position:"fixed",inset:0,zIndex:98,background:"rgba(0,0,0,0.55)"};
function statsModalStyle(isMobile){
  return isMobile
    ? {position:"fixed",inset:12,width:"auto",maxHeight:"calc(100vh - 24px)",overflowY:"auto",zIndex:99,background:C.panel,border:`1px solid ${C.border}`,borderRadius:14,padding:16,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}
    : {position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:"min(460px, calc(100vw - 48px))",maxHeight:"85vh",overflowY:"auto",zIndex:99,background:C.panel,border:`1px solid ${C.border}`,borderRadius:14,padding:18,boxShadow:"0 8px 40px rgba(0,0,0,0.55)"};
}
function StatsCloseBtn({onClick}){
  return <button onClick={onClick} aria-label="Close stats"
    style={{background:"none",border:0,color:C.muted,cursor:"pointer",fontSize:20,lineHeight:1,padding:"2px 4px",fontFamily:"inherit",flexShrink:0}}>✕</button>;
}

function CsvHelp() {
  const [open, setOpen] = useState(false);
  const stop = (e) => e.stopPropagation();
  return (
    <span style={{position:"relative", display:"inline-flex"}} onClick={stop}>
      <button
        onClick={(e)=>{stop(e); setOpen(v=>!v);}}
        aria-label="How CSV import works"
        style={{width:18,height:18,borderRadius:"50%",border:`1px solid ${C.accent}`,
          background:open?C.accent:"transparent",color:open?"#1a1a1a":C.accent,
          fontSize:11,fontWeight:700,cursor:"pointer",lineHeight:1,padding:0,
          display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
        ?
      </button>
      {open && (
        <>
          <div onClick={(e)=>{stop(e); setOpen(false);}}
            style={{position:"fixed",inset:0,zIndex:60}}/>
          <div onClick={stop}
            style={{position:"absolute",top:"calc(100% + 10px)",right:0,zIndex:61,width:330,
              background:C.panel,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.accent}`,
              borderRadius:12,boxShadow:"0 12px 36px rgba(0,0,0,0.5)",overflow:"hidden",
              textAlign:"left",cursor:"default",whiteSpace:"normal"}}>
            {/* Header — badge + title, like the main help dialogs */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px 10px",
              borderBottom:`1px solid ${C.border}`}}>
              <span style={{width:30,height:30,borderRadius:"50%",background:C.accentSoft,
                display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>📄</span>
              <span style={{fontWeight:700,color:C.text,fontSize:14}}>Import from CSV</span>
            </div>
            {/* Body — lime-dot bullets */}
            <div style={{padding:"12px 16px",fontSize:12.5,color:C.muted,lineHeight:1.55}}>
              <ul style={{margin:0,padding:0,listStyle:"none"}}>
                <li style={{position:"relative",paddingLeft:16,marginBottom:9}}>
                  <span style={{position:"absolute",left:0,top:6,width:6,height:6,borderRadius:"50%",background:C.accent}}/>
                  One line per match — <b style={{color:C.text}}>match number, home, away</b>.
                  {" "}<span style={{fontFamily:"monospace",background:C.panel2,border:`1px solid ${C.border}`,borderRadius:4,padding:"1px 5px",color:C.text}}>81,2,1</span> → match #81 ends 2–1.
                </li>
                <li style={{position:"relative",paddingLeft:16}}>
                  <span style={{position:"absolute",left:0,top:6,width:6,height:6,borderRadius:"50%",background:C.accent}}/>
                  A header row (<span style={{fontFamily:"monospace",background:C.panel2,border:`1px solid ${C.border}`,borderRadius:4,padding:"1px 5px",color:C.text}}>match,home,away</span>) is optional.
                </li>
              </ul>
              {/* Submit reminder — accented note */}
              <div style={{marginTop:12,background:C.accentSoft,border:`1px solid ${C.accent}`,
                borderRadius:8,padding:"9px 11px",color:C.text,fontSize:12,fontWeight:600,
                display:"flex",gap:7,alignItems:"flex-start"}}>
                <span style={{fontSize:14,lineHeight:1.2}}>📌</span>
                <span>Don't forget to hit <b style={{color:C.accent}}>Submit</b> after importing — your picks aren't saved until you do.</span>
              </div>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

// Small divider label above the two Stage-6 matches so it's clear which is the
// Final (g="FIN") and which is the 3rd-place play-off (g="3P").
function StageMatchLabel({ m }) {
  if (!m || (m.g !== "FIN" && m.g !== "3P")) return null;
  const fin = m.g === "FIN";
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,margin:"10px 2px 4px",
      fontSize:11,fontWeight:700,letterSpacing:".5px",textTransform:"uppercase",
      color: fin ? C.accent : C.muted}}>
      <span style={{whiteSpace:"nowrap"}}>{fin ? "🏆 Final" : "🥉 3rd place"}</span>
      <span style={{flex:1,height:1,background:C.border}}/>
    </div>
  );
}

const FLAGS = {
  "Algeria":"🇩🇿","Argentina":"🇦🇷","Australia":"🇦🇺","Austria":"🇦🇹",
  "Belgium":"🇧🇪","Bosnia and Herzegovina":"🇧🇦","Brazil":"🇧🇷",
  "Canada":"🇨🇦","Cape Verde":"🇨🇻","Colombia":"🇨🇴","Croatia":"🇭🇷",
  "Curaçao":"🇨🇼","Czech Republic":"🇨🇿","DR Congo":"🇨🇩",
  "Ecuador":"🇪🇨","Egypt":"🇪🇬","England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","France":"🇫🇷",
  "Germany":"🇩🇪","Ghana":"🇬🇭","Haiti":"🇭🇹","Iran":"🇮🇷",
  "Iraq":"🇮🇶","Ivory Coast":"🇨🇮","Japan":"🇯🇵","Jordan":"🇯🇴",
  "Korea Republic":"🇰🇷","Mexico":"🇲🇽","Morocco":"🇲🇦",
  "Netherlands":"🇳🇱","New Zealand":"🇳🇿","Norway":"🇳🇴",
  "Panama":"🇵🇦","Paraguay":"🇵🇾","Portugal":"🇵🇹","Qatar":"🇶🇦",
  "Saudi Arabia":"🇸🇦","Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","Senegal":"🇸🇳",
  "South Africa":"🇿🇦","Spain":"🇪🇸","Sweden":"🇸🇪",
  "Switzerland":"🇨🇭","Tunisia":"🇹🇳","Turkey":"🇹🇷",
  "United States":"🇺🇸","Uruguay":"🇺🇾","Uzbekistan":"🇺🇿",
};
const flag     = (t) => FLAGS[t] || "🏳️";
const withFlag = (t) => `${flag(t)} ${t}`;

// ── Custom confirm modal ─────────────────────────────────────────────────────
// Replaces native confirm() prompts with a themed in-app modal. Call sites use:
//   if (await confirmDialog({ title, message, confirmLabel, danger })) { ... }
// The modal mounts via <ConfirmHost/> at the App root.
let _confirmHandler = null;
function confirmDialog(opts) {
  return new Promise(resolve => {
    if (!_confirmHandler) { resolve(window.confirm(opts?.message || "")); return; }
    _confirmHandler(opts || {}, resolve);
  });
}
function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    _confirmHandler = (opts, resolve) => setState({...opts, _resolve: resolve});
    return () => { _confirmHandler = null; };
  }, []);
  // ESC = cancel, Enter = confirm
  useEffect(() => {
    if (!state) return;
    const onKey = (e) => {
      if (e.key === "Escape") { state._resolve(false); setState(null); }
      else if (e.key === "Enter") { state._resolve(true); setState(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);
  if (!state) return null;
  const close = (ok) => { state._resolve(ok); setState(null); };
  const danger = !!state.danger;
  return (
    <div onClick={()=>close(false)} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",
      zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",
      padding:16,backdropFilter:"blur(4px)",
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:C.panel,border:`1px solid ${C.border}`,borderRadius:14,
        maxWidth:440,width:"100%",padding:20,boxShadow:"0 20px 60px rgba(0,0,0,0.55)",
        animation:"none",
      }}>
        {state.title && (
          <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:8,
            display:"flex",alignItems:"center",gap:8}}>
            {danger && <span>⚠️</span>}
            {state.title}
          </div>
        )}
        {state.message && (
          <div style={{fontSize:14,color:C.muted,whiteSpace:"pre-wrap",
            lineHeight:1.5,marginBottom:18}}>
            {state.message}
          </div>
        )}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>close(false)} style={{
            background:"transparent",border:`1px solid ${C.border}`,color:C.text,
            padding:"8px 16px",borderRadius:8,fontSize:14,fontWeight:600,
            cursor:"pointer",fontFamily:"inherit",
          }}>
            {state.cancelLabel || "Cancel"}
          </button>
          <button onClick={()=>close(true)} autoFocus style={{
            background:danger?C.red:C.accent,
            color:danger?"#fff":"#1a1a1a",border:0,
            padding:"8px 18px",borderRadius:8,fontSize:14,fontWeight:700,
            cursor:"pointer",fontFamily:"inherit",
          }}>
            {state.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reset picker modal ────────────────────────────────────────────────────────
// Opens a user/entry selector before a destructive reset. Returns:
//   { scope:"all" }
//   { scope:"user",  userId }
//   { scope:"entry", userId, entryId }
//   null  — cancelled
//
// Usage:
//   const sel = await resetPickerDialog({ mode:"user-data"|"delete-user" });
//   if (!sel) return;
//   await api.resetUserData({ userId: sel.userId, entryId: sel.entryId });
let _resetPickerHandler = null;
function resetPickerDialog(opts) {
  return new Promise(resolve => {
    if (!_resetPickerHandler) { resolve(null); return; }
    _resetPickerHandler(opts || {}, resolve);
  });
}

function ResetPickerHost() {
  const [state,  setState]  = useState(null); // { mode, _resolve }
  const [users,  setUsers]  = useState([]);   // [{id,name,entries:[{id,name}]}]
  const [loading,setLoading]= useState(false);
  const [scope,  setScope]  = useState("all");      // "all"|"user"|"entry"
  const [userId, setUserId] = useState(null);
  const [entryId,setEntryId]= useState(null);

  useEffect(() => {
    _resetPickerHandler = (opts, resolve) => {
      setScope("all"); setUserId(null); setEntryId(null); setUsers([]);
      setState({...opts, _resolve: resolve});
      // Fetch users + their entries
      setLoading(true);
      api.getAdminParticipants()
        .then(list => {
          // Already grouped by user: [{id, name, entries:[{id,name}]}]
          setUsers(list.map(u => ({
            id: u.id,
            name: u.name,
            entries: (u.entries || []).map(e => ({id: e.id, name: e.name})),
          })));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    };
    return () => { _resetPickerHandler = null; };
  }, []);

  useEffect(() => {
    if (!state) return;
    const onKey = e => { if (e.key==="Escape") close(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;

  const close = (result) => { state._resolve(result); setState(null); };

  const isDeleteUser = state.mode === "delete-user";
  const title        = isDeleteUser ? "Delete user" : "Reset user data";
  const actionLabel  = isDeleteUser ? "Delete" : "Reset";

  // Derive what will be affected
  const selectedUser  = users.find(u => u.id === userId) || null;
  const selectedEntry = selectedUser?.entries.find(e => e.id === entryId) || null;

  function confirm() {
    if (scope === "all")  return close({ scope:"all" });
    if (scope === "user") return close({ scope:"user", userId });
    if (scope === "entry") return close({ scope:"entry", userId, entryId });
  }
  const canConfirm =
    scope === "all" ||
    (scope === "user"  && userId) ||
    (scope === "entry" && userId && entryId);

  const radioStyle = { accentColor:C.accent, marginRight:6, cursor:"pointer" };
  const rowStyle   = { padding:"8px 12px", borderRadius:6, marginBottom:4,
    background:C.panel2, border:`1px solid ${C.border}`, cursor:"pointer",
    display:"flex", alignItems:"center", gap:10 };
  const activeRow  = { ...rowStyle, background:"rgba(163,230,53,0.08)", border:`1px solid ${C.accent}` };

  return (
    <div onClick={()=>close(null)} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",
      zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",
      padding:16,backdropFilter:"blur(4px)",
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:C.panel,border:`1px solid ${C.border}`,borderRadius:14,
        width:"100%",maxWidth:480,padding:22,
        boxShadow:"0 20px 60px rgba(0,0,0,0.6)",
        display:"flex",flexDirection:"column",gap:14,
        maxHeight:"80vh",overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{fontSize:17,fontWeight:700,color:C.text,display:"flex",alignItems:"center",gap:8}}>
          <span>⚠️</span>{title}
        </div>

        {/* Scope selector */}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {/* ALL */}
          <label style={scope==="all"?activeRow:rowStyle} onClick={()=>{setScope("all");setUserId(null);setEntryId(null);}}>
            <input type="radio" name="scope" checked={scope==="all"} onChange={()=>{setScope("all");setUserId(null);setEntryId(null);}} style={radioStyle}/>
            <div>
              <div style={{fontWeight:600,color:C.text,fontSize:13}}>
                All participants ({users.length})
              </div>
              <div style={{fontSize:11,color:C.muted}}>
                {isDeleteUser ? "Delete every non-admin user account and all their data" : "Wipe entries & predictions for all users, reset config"}
              </div>
            </div>
          </label>

          {/* SPECIFIC USER */}
          <label style={(scope==="user"||scope==="entry")?activeRow:rowStyle} onClick={()=>{ if(scope==="all"){setScope("user");} }}>
            <input type="radio" name="scope" checked={scope==="user"||scope==="entry"} onChange={()=>{setScope("user");setEntryId(null);}} style={radioStyle}/>
            <div style={{fontWeight:600,color:C.text,fontSize:13}}>
              Specific user {selectedUser ? `— ${selectedUser.name}` : ""}
            </div>
          </label>

          {/* User list */}
          {(scope==="user"||scope==="entry") && (
            <div style={{marginLeft:24,maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
              {loading && <div style={{fontSize:12,color:C.muted,padding:"6px 0"}}>Loading…</div>}
              {users.map(u => {
                const isSelected = u.id === userId;
                return (
                  <div key={u.id}>
                    <div onClick={()=>{setUserId(u.id);setEntryId(null);setScope("user");}}
                      style={{
                        padding:"6px 10px",borderRadius:5,cursor:"pointer",fontSize:13,
                        background:isSelected?"rgba(163,230,53,0.10)":C.panel2,
                        border:`1px solid ${isSelected?C.accent:C.border}`,
                        fontWeight:isSelected?700:400,color:isSelected?C.accent:C.text,
                        marginBottom:2,
                      }}>
                      {u.name}
                      <span style={{fontSize:11,color:C.muted,marginLeft:8,fontWeight:400}}>
                        {u.entries.length} form{u.entries.length!==1?"s":""}
                      </span>
                    </div>

                    {/* Entry list — shown for user-data mode only */}
                    {!isDeleteUser && isSelected && u.entries.length > 0 && (
                      <div style={{marginLeft:14,marginBottom:4,display:"flex",flexDirection:"column",gap:2}}>
                        {u.entries.map(en => {
                          const isEnt = entryId===en.id && scope==="entry";
                          return (
                            <div key={en.id}
                              onClick={()=>{setEntryId(en.id);setScope("entry");}}
                              style={{
                                padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:12,
                                background:isEnt?"rgba(163,230,53,0.10)":C.bg,
                                border:`1px solid ${isEnt?C.accent:C.border}`,
                                color:isEnt?C.accent:C.muted,
                              }}>
                              📋 {en.name}
                              {isEnt && <span style={{marginLeft:6,fontSize:10,color:C.accent,fontWeight:700}}>selected</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Summary line */}
        <div style={{fontSize:12,color:C.muted,background:C.panel2,borderRadius:6,padding:"7px 10px"}}>
          {scope==="all" && (isDeleteUser
            ? `Will delete ${users.length} user account(s) and all their data.`
            : `Will reset entries & predictions for all ${users.length} participant(s).`)}
          {scope==="user" && selectedUser && (isDeleteUser
            ? `Will delete ${selectedUser.name}'s account and all their data.`
            : `Will reset all entries & predictions for ${selectedUser.name}.`)}
          {scope==="entry" && selectedEntry && selectedUser &&
            `Will delete form "${selectedEntry.name}" from ${selectedUser.name}.`}
          {((scope==="user"&&!selectedUser)||(scope==="entry"&&(!selectedUser||!selectedEntry))) &&
            "← select a target above"}
        </div>

        {/* Actions */}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>close(null)} style={{
            background:"transparent",border:`1px solid ${C.border}`,color:C.text,
            padding:"8px 16px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
          }}>Cancel</button>
          <button onClick={confirm} disabled={!canConfirm} style={{
            background:canConfirm?C.red:"rgba(239,68,68,0.3)",color:"#fff",border:0,
            padding:"8px 18px",borderRadius:8,fontSize:14,fontWeight:700,
            cursor:canConfirm?"pointer":"not-allowed",fontFamily:"inherit",
          }}>{actionLabel}</button>
        </div>
      </div>
    </div>
  );
}

function initials(name) {
  const p = name.trim().split(" ");
  return p.length >= 2 ? (p[0][0] + p[p.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase();
}

// Stable-stringify compare: the polled objects are always rebuilt with the same
// key order each tick, so this reliably detects "nothing changed" and lets the
// setState bail out instead of re-rendering the whole tree on a 10s metronome.
const sameData = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };

const inputStyle = {
  display:"block", width:"100%", marginBottom:10,
  background:C.panel2, color:C.text, border:`1px solid ${C.border}`,
  borderRadius:6, padding:10, boxSizing:"border-box", fontSize:14,
};
const numInput = {
  background:C.bg, border:`1px solid ${C.border}`,
  color:C.text, borderRadius:4, padding:4, textAlign:"center", fontSize:14, width:"100%",
};
const td = { padding:"8px 10px", borderBottom:`1px solid ${C.border}` };

// Responsive breakpoint hook — re-renders when crossing the mobile threshold
function useIsMobile(bp = 520) {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < bp);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, [bp]);
  return mobile;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESTIGE SELECT COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// Searchable team picker with flags
function TeamPicker({ value, onChange, teams, disabled, clearable=false, placeholder="Choose a team…", variant="default", label, highlight=false, autoOpen=false }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const [hov,    setHov]    = useState(null);
  const wrapRef   = useRef(null);
  const searchRef = useRef(null);
  const prevAutoOpen = useRef(false);

  // Auto-open once when the parent signals the champion is the only thing left
  // to do (e.g. all matches filled but no champion yet) — "jump to it".
  useEffect(() => {
    if (autoOpen && !prevAutoOpen.current && !disabled) setOpen(true);
    prevAutoOpen.current = autoOpen;
  }, [autoOpen, disabled]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) { setSearch(""); setTimeout(() => searchRef.current?.focus(), 40); }
  }, [open]);

  const filtered = teams.filter(t => t.toLowerCase().includes(search.toLowerCase()));

  // Clicking a selected team again deselects it (when clearable)
  function select(team) {
    if (clearable && value === team) { onChange(null); }
    else { onChange(team); }
    setOpen(false);
  }

  const isBox = variant === "box";
  const isTile = variant === "tile";

  return (
    <div ref={wrapRef} style={{ position:"relative", minWidth:(isBox||isTile)?0:240, display:(isBox||isTile)?"inline-block":"block" }}>
      {/* Trigger — "box" variant matches the score-input boxes: dark + lime
          border/text when a champion is picked, muted dash when empty. */}
      {isTile ? (
        <button type="button" onClick={() => !disabled && setOpen(o => !o)}
          className={highlight && !value && !open ? "champion-pulse" : undefined}
          title={value || "Pick your champion (+10 pts)"} style={{
          display:"inline-flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1,
          minWidth:96, maxWidth:200, height:"100%", padding:"4px 12px", borderRadius:8, fontFamily:"inherit",
          background:C.bg, border:`1px solid ${value ? C.accent : (open ? C.accent : (highlight ? "#f59e0b" : C.border))}`,
          cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.6:1, outline:"none",
          transition:"border-color .15s",
        }}>
          <span style={{ fontSize:9, letterSpacing:".6px", textTransform:"uppercase", color:highlight&&!value?"#f59e0b":C.muted, fontWeight:700 }}>{label || "Champion"}</span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:5, maxWidth:178, overflow:"hidden",
            fontSize:15, fontWeight:700, lineHeight:1.1, whiteSpace:"nowrap",
            color: value ? C.accent : (highlight ? "#f59e0b" : C.muted) }}>
            <span style={{ fontSize:15, lineHeight:1, flexShrink:0 }}>{value ? flag(value) : "🏆"}</span>
            <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{value || "Pick a team"}</span>
            <span style={{ fontSize:8, opacity:.7, transition:"transform .2s", transform:open?"rotate(180deg)":"none" }}>▾</span>
          </span>
        </button>
      ) : isBox ? (
        <button type="button" onClick={() => !disabled && setOpen(o => !o)} title={value || "Pick your champion (+10 pts)"} style={{
          display:"inline-flex", alignItems:"center", gap:6,
          height:34, padding:"0 12px", borderRadius:6, fontFamily:"inherit",
          justifyContent: value ? "flex-start" : "center",
          background:C.bg, border:`1px solid ${value ? C.accent : (open ? C.accent : C.border)}`,
          color:value ? C.accent : C.muted, fontWeight:value?700:600, fontSize:14,
          cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.6:1, outline:"none",
          minWidth: value ? 64 : 150, maxWidth:200, whiteSpace:"nowrap", transition:"border-color .15s,color .15s",
        }}>
          <span style={{ fontSize:16, lineHeight:1, flexShrink:0 }}>{value ? flag(value) : "🏆"}</span>
          <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{value || "Pick a team"}</span>
          <span style={{ fontSize:9, opacity:.7, transition:"transform .2s", transform:open?"rotate(180deg)":"none" }}>▾</span>
        </button>
      ) : (
        <button type="button" onClick={() => !disabled && setOpen(o => !o)} style={{
          width:"100%", display:"flex", alignItems:"center", gap:10,
          padding:"10px 14px", borderRadius:8, cursor:disabled?"not-allowed":"pointer",
          background:C.panel2, border:`1px solid ${open ? C.accent : C.border}`,
          color:C.text, opacity:disabled?0.6:1, outline:"none",
          transition:"border-color .15s", textAlign:"left",
        }}>
          <span style={{ fontSize:20, lineHeight:1, flexShrink:0 }}>{value ? flag(value) : "🏆"}</span>
          <span style={{ flex:1, fontSize:14, color:value?C.text:C.muted }}>{value || placeholder}</span>
          <span style={{ fontSize:10, color:C.muted, transition:"transform .2s", transform:open?"rotate(180deg)":"none" }}>▼</span>
        </button>
      )}

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, right:(isBox||isTile)?"auto":0, zIndex:200,
          minWidth:(isBox||isTile)?260:undefined,
          background:C.panel, border:`1px solid ${C.border}`, borderRadius:10,
          boxShadow:"0 8px 28px rgba(0,0,0,0.18)", overflow:"hidden",
        }}>
          {/* Search row */}
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderBottom:`1px solid ${C.border}` }}>
            <span style={{ color:C.muted, fontSize:13, flexShrink:0 }}>🔍</span>
            <input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search teams…"
              style={{ border:"none", outline:"none", background:"transparent", fontSize:13, color:C.text, flex:1 }}/>
            {search && (
              <button onClick={()=>setSearch("")} style={{ background:"none", border:0, color:C.muted, cursor:"pointer", fontSize:13, padding:0 }}>✕</button>
            )}
          </div>
          {/* Options */}
          <div style={{ maxHeight:240, overflowY:"auto" }}>
            {filtered.length === 0
              ? <div style={{ padding:16, textAlign:"center", color:C.muted, fontSize:13 }}>No teams found</div>
              : filtered.map(t => {
                const selected = value === t;
                const isHov = hov === t;
                return (
                  <div key={t}
                    onClick={()=>select(t)}
                    onMouseEnter={()=>setHov(t)}
                    onMouseLeave={()=>setHov(null)}
                    style={{
                      display:"flex", alignItems:"center", gap:10,
                      padding:"8px 14px", cursor:"pointer", fontSize:13,
                      background: selected ? "var(--c-accent-soft)" : isHov ? C.panel2 : "transparent",
                      color: selected ? C.accent : C.text,
                      transition:"background .1s",
                    }}>
                    <span style={{ fontSize:18, lineHeight:1, width:24, textAlign:"center", flexShrink:0 }}>{flag(t)}</span>
                    <span style={{ flex:1, fontWeight:selected?600:400 }}>{t}</span>
                    {selected && (
                      <span style={{ fontSize:11, color:C.accent, opacity:0.8 }}>
                        {clearable ? "tap to remove ✓" : "✓"}
                      </span>
                    )}
                  </div>
                );
              })
            }
          </div>
        </div>
      )}
    </div>
  );
}

// Single participant row — own component so hover state doesn't re-render the whole list
function ParticipantItem({ entry, rank, selected, onClick }) {
  const [hov, setHov] = useState(false);
  const bg = selected ? "var(--c-accent-soft)" : hov ? C.panel2 : "transparent";
  const rankIcon = rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":null;

  return (
    <div onClick={onClick}
      data-entry-id={entry.entry_id || entry.user_id}
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}
      style={{
        display:"flex", alignItems:"center", gap:10, padding:"9px 13px",
        cursor:"pointer", background:bg, transition:"background .1s",
        borderBottom:`1px solid ${C.border}`,
      }}>
      <span style={{ width:20, textAlign:"center", fontSize:rankIcon?15:11, flexShrink:0, color:C.muted }}>
        {rankIcon || rank}
      </span>
      <div style={{
        width:30, height:30, borderRadius:"50%", flexShrink:0,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:11, fontWeight:700,
        background: selected ? C.accent : C.panel2,
        color: selected ? "#1a1a1a" : C.text,
      }}>
        {initials(entry.name)}
      </div>
      <span style={{ flex:1, fontSize:13, color:selected?C.accent:C.text, fontWeight:selected?600:400 }}>
        {entry.name}
      </span>
      <span style={{ fontSize:12, fontFamily:"monospace", fontWeight:700, color:C.accent, flexShrink:0 }}>
        {entry.total} pts
      </span>
      {selected && <span style={{ fontSize:11, color:C.accent, marginLeft:4 }}>✓</span>}
    </div>
  );
}

// Searchable participant picker — keyed by entry_id (one row per submitted entry)
function ParticipantPicker({ entries, value, onChange }) {
  const [search, setSearch] = useState("");
  const filtered = entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));
  const listRef = useRef(null);
  const prevValueRef = useRef(value);

  // Scroll the selected row into view whenever `value` changes (e.g. after
  // jumping in from the leaderboard). If a JUMP lands on a row hidden by an
  // active search, clear the search so it shows — but ONLY on a jump, never
  // while the user is typing (clearing on every keystroke wiped the search).
  useEffect(() => {
    if (!value || !listRef.current) return;
    const valueJumped = prevValueRef.current !== value;
    prevValueRef.current = value;
    const isVisible = filtered.some(e => (e.entry_id || e.user_id) === value);
    if (valueJumped && !isVisible && search) {
      setSearch("");
      return; // next effect run (after filter recomputes) will scroll
    }
    const el = listRef.current.querySelector(`[data-entry-id="${value}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [value, search]);

  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden", background:C.panel }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderBottom:`1px solid ${C.border}` }}>
        <span style={{ color:C.muted, fontSize:13, flexShrink:0 }}>🔍</span>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search participants…"
          style={{ border:"none", outline:"none", background:"transparent", fontSize:13, color:C.text, flex:1 }}/>
        {search && (
          <button onClick={()=>setSearch("")} style={{ background:"none", border:0, color:C.muted, cursor:"pointer", fontSize:13, padding:0 }}>✕</button>
        )}
      </div>
      <div ref={listRef} style={{ maxHeight:280, overflowY:"auto" }}>
        {filtered.length === 0
          ? <div style={{ padding:16, textAlign:"center", color:C.muted, fontSize:13 }}>No participants found</div>
          : filtered.map((e) => (
            <ParticipantItem key={e.entry_id}
              entry={e}
              rank={entries.indexOf(e) + 1}
              selected={value === e.entry_id}
              onClick={()=>onChange(e.entry_id)}/>
          ))
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function InfoBlock({ children, warn }) {
  return (
    <div style={{
      background: warn?"rgba(239,68,68,0.08)":"rgba(99,102,241,0.08)",
      borderLeft:`3px solid ${warn?C.red:C.indigo}`,
      padding:"10px 14px", borderRadius:4, marginBottom:16,
      fontSize:13, color:warn?C.red:C.text, lineHeight:1.5,
    }}>{children}</div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      background:C.panel2, padding:"8px 12px", borderRadius:6,
      margin:"16px 0 6px", fontWeight:600, color:C.indigo, fontSize:14,
    }}>{children}</div>
  );
}

function Btn({ children, onClick, green, red, ghost, disabled }) {
  const bg = green?C.green:red?C.red:ghost?"transparent":C.accent;
  const fg = ghost?C.text:(green||red)?"white":"#1a1a1a";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:bg, color:fg,
      border:ghost?`1px solid ${C.border}`:0,
      padding:"8px 14px", borderRadius:6,
      cursor:disabled?"not-allowed":"pointer",
      fontWeight:700, fontSize:13, opacity:disabled?0.5:1,
    }}>{children}</button>
  );
}

// Effective 90-min score for a match: final result wins, else the in-play live
// score. Returns [a,b,(winner?)] or null. Shared by MatchRow + CompareView.
function effScoreOf(result, liveData) {
  if (result) return result;
  if (liveData && liveData.score_a != null) return [liveData.score_a, liveData.score_b, liveData.winner || null];
  return null;
}
// Score one prediction against an effective score, using the same rules as
// MatchRow: +5 for correct direction, +3 for exact (both goals) or +1 for one
// goal. Returns {total, aMatch, bMatch} or null when not scorable.
function scorePrediction(pred, eff) {
  if (!eff || pred?.[0] == null || pred?.[1] == null) return null;
  const sign = (x) => x === 0 ? 0 : x > 0 ? 1 : -1;
  const dir = sign(pred[0] - pred[1]) === sign(eff[0] - eff[1]) ? 5 : 0;
  const goals = (pred[0] === eff[0] ? 1 : 0) + (pred[1] === eff[1] ? 1 : 0);
  const exact = goals === 2 ? 3 : goals === 1 ? 1 : 0;
  return { total: dir + exact, aMatch: pred[0] === eff[0], bMatch: pred[1] === eff[1] };
}

// MatchRow — outside App so localA/localB survive App re-renders
function MatchRow({ match, pred, result, liveData, editable, adminResult, roundState, onSave, onResultSave, tz }) {
  const [localA, setLocalA] = useState(pred?.[0]!=null?String(pred[0]):"");
  const [localB, setLocalB] = useState(pred?.[1]!=null?String(pred[1]):"");
  const [resA,   setResA]   = useState(result?.[0]!=null?String(result[0]):"");
  const [resB,   setResB]   = useState(result?.[1]!=null?String(result[1]):"");
  const isMobile = useIsMobile();

  // Race protection — auto-save + the 10s background poll both refresh
  // props that drive the input value. Skip syncing while the user has an
  // input focused, or while our own save is still in flight, so neither
  // background event wipes the value the user just typed.
  const editingRef    = useRef(false);
  const pendingSaveRef = useRef(false);
  const autoSaveTimer = useRef(null);   // debounce for save-while-typing
  const AUTOSAVE_MS   = 250;
  const handleFocus   = () => { editingRef.current = true; };

  useEffect(()=>{
    if (editingRef.current || pendingSaveRef.current) return;
    setLocalA(pred?.[0]!=null?String(pred[0]):"");
    setLocalB(pred?.[1]!=null?String(pred[1]):"");
  },[pred?.[0],pred?.[1]]);
  useEffect(()=>{
    if (editingRef.current || pendingSaveRef.current) return;
    setResA(result?.[0]!=null?String(result[0]):"");
    setResB(result?.[1]!=null?String(result[1]):"");
  },[result?.[0],result?.[1]]);

  // ── Persist helpers (no editingRef flip — used by both the debounced
  // save-while-typing and the immediate save-on-blur). ──────────────────────
  async function persistPred(a, b) {
    const wasFilled  = pred?.[0]!=null && pred?.[1]!=null;
    const willBeFilled = (a!=="" && a!=null && b!=="" && b!=null);
    // empty → still empty: nothing to do (avoid pointless API calls)
    if (!wasFilled && !willBeFilled) return;
    // No-op edits (focus-only, blur-unchanged, change-then-back) are filtered
    // by the parent's flushPredSaves against its persisted baseline — reporting
    // here is cheap (buffer only) and keeps the baseline check authoritative.
    // If the user cleared either side, the prediction is no longer complete:
    // persist nulls so myPreds / filledCount / the Submit button reflect it.
    const data = willBeFilled
      ? {score_a:Number(a), score_b:Number(b)}
      : {score_a:null,     score_b:null};
    pendingSaveRef.current = true;
    try { await onSave(match.n, data); }
    catch(e){console.error(e);}
    finally { pendingSaveRef.current = false; }
  }
  async function persistResult(a, b) {
    const sa = a===""||a==null ? null : Number(a);
    const sb = b===""||b==null ? null : Number(b);
    // No change vs the saved result → skip (focus-only / edited back).
    if (sa===(result?.[0]??null) && sb===(result?.[1]??null)) return;
    pendingSaveRef.current = true;
    try { await onResultSave(match.n,{score_a:sa,score_b:sb}); }
    catch(e){console.error(e);}
    finally { pendingSaveRef.current = false; }
  }
  // Immediate save on blur — flush any pending debounce first.
  function savePred(side,val) {
    clearTimeout(autoSaveTimer.current);
    editingRef.current = false;
    return persistPred(side===0?val:localA, side===1?val:localB);
  }
  function saveResult(side,val) {
    clearTimeout(autoSaveTimer.current);
    editingRef.current = false;
    return persistResult(side===0?val:resA, side===1?val:resB);
  }
  // Prediction edits report to the parent immediately (onChange → persistPred →
  // onSave); the PARENT batches them into one debounced bulk write, so jumping
  // box-to-box doesn't save per box. (No per-row debounce here for predictions.)
  // Admin RESULT edits have no bulk endpoint, so they keep a per-row debounce.
  useEffect(() => {
    if (!editingRef.current) return;
    autoSaveTimer.current = setTimeout(() => persistResult(resA, resB), AUTOSAVE_MS);
    return () => clearTimeout(autoSaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resA, resB]);

  // Two independent chips with their own colour rules:
  //   Points (+N) — based on total points earned
  //     5+   → green   (direction correct or better)
  //      1   → orange  (only a partial goal match)
  //      0   → red     (miss)
  //   Result (✓ A:B) — based on how many digits the user actually matched
  //      2   → green   (exact score)
  //      1   → orange  (one digit matched) + that digit rendered green
  //      0   → red     (no digit matched, even if direction was right)
  //   Either chip falls back to muted grey if there is no prediction.
  const GREEN  = {bg:"rgba(16,185,129,0.14)", fg:C.green,  border:"rgba(16,185,129,0.4)"};
  const ORANGE = {bg:"rgba(245,158,11,0.14)", fg:"#f59e0b",border:"rgba(245,158,11,0.4)"};
  const RED    = {bg:"rgba(239,68,68,0.14)",  fg:C.red,    border:"rgba(239,68,68,0.4)"};
  const MUTED  = {bg:"rgba(148,163,184,0.10)",color:C.muted, border:`1px solid ${C.border}`};
  // Graduated greens for the +N chip, all with green text like the score box:
  //   8 (exact)  → same green as the result box (strongest)
  //   6          → a bit lighter
  //   5          → lightest (about as faint as the green digits in the box)
  const GREEN8 = {bg:"rgba(16,185,129,0.14)",  fg:C.green, border:"rgba(16,185,129,0.40)"};
  const GREEN6 = {bg:"rgba(16,185,129,0.085)", fg:C.green, border:"rgba(16,185,129,0.28)"};
  const GREEN5 = {bg:"rgba(16,185,129,0.04)",  fg:C.green, border:"rgba(16,185,129,0.18)"};

  // Effective score: final result wins, otherwise the in-motion live score.
  // This way users see their points adjust in real time as the admin enters
  // scores — even before the match is marked FINAL.
  const effectiveScore = result
    ? result
    : (liveData && liveData.score_a != null ? [liveData.score_a, liveData.score_b, liveData.winner||null] : null);
  const isPreliminary = !result && !!effectiveScore;  // score from live, not final
  const isLiveBadge   = !!(liveData && liveData.is_live);

  let ptsEl=null;
  let ptsPalette=null;          // drives both the +N chip and the prediction box colour
  let partialMatchSide=null;    // which digit (0/1) to highlight green in renderPredDigits
  if(effectiveScore&&pred?.[0]!=null&&pred?.[1]!=null){
    const p1=pred[0],p2=pred[1],r1=effectiveScore[0],r2=effectiveScore[1];
    const sign=(x)=>x===0?0:x>0?1:-1;
    const dir=sign(p1-p2)===sign(r1-r2)?5:0;
    const goalsMatched = (p1===r1?1:0) + (p2===r2?1:0);
    const exact = goalsMatched===2 ? 3 : (goalsMatched===1 ? 1 : 0);
    const total=dir+exact;
    // Prediction box + points chip share one palette based on TOTAL points:
    //   ≥5 pts → green  (direction correct, with or without goal bonus)
    //    1 pt  → orange (one goal matched, direction wrong)
    //    0 pts → red    (complete miss)
    ptsPalette = total>=5 ? GREEN : total===1 ? ORANGE : RED;
    // The chip itself uses a graduated green so 5/6/8 are visually distinct.
    const chipPalette = total===0 ? RED : total===1 ? ORANGE
      : total>=8 ? GREEN8 : total>=6 ? GREEN6 : GREEN5;
    if (goalsMatched===1) partialMatchSide = p1===r1 ? 0 : 1;
    ptsEl=<span style={{background:chipPalette.bg,color:chipPalette.fg,border:`1px solid ${chipPalette.border}`,padding:"1px 6px",borderRadius:4,fontWeight:700,fontFamily:"monospace",fontSize:11}}>+{total}</span>;
  }
  const renderResultDigits = (r) => {
    if (partialMatchSide===null) return `${r[0]}:${r[1]}`;
    return (
      <>
        <span style={{color:partialMatchSide===0?C.green:"inherit"}}>{r[0]}</span>
        :
        <span style={{color:partialMatchSide===1?C.green:"inherit"}}>{r[1]}</span>
      </>
    );
  };
  // Colour each digit of the prediction: green if it matched the result, red if not.
  // This way the box background signals overall performance (green=dir correct,
  // orange=partial, red=miss) while the digits themselves always tell the exact story.
  const renderPredDigits = (p, r) => {
    if (!r) return `${p[0]}:${p[1]}`;
    const aMatch = p[0]===r[0];
    const bMatch = p[1]===r[1];
    return (
      <>
        <span style={{color:aMatch?C.green:C.red}}>{p[0]}</span>
        :
        <span style={{color:bMatch?C.green:C.red}}>{p[1]}</span>
      </>
    );
  };

  let winnerSide = null;
  if (effectiveScore) {
    if (effectiveScore[0] > effectiveScore[1]) winnerSide = 0;
    else if (effectiveScore[1] > effectiveScore[0]) winnerSide = 1;
    // Knockout tie decided by ET/pens: use explicit winner from result
    else if (effectiveScore[2] === 'a') winnerSide = 0;
    else if (effectiveScore[2] === 'b') winnerSide = 1;
  }
  // Knockout matches (stage ≥ 2): points are based on 90-min score only
  const isKnockoutMatch = match.s >= 2;
  // Live rows get a red tint + red border so users spot in-play matches in
  // their predictions table. "In-progress" (score saved but not LIVE) rows
  // get a subtle lime tint — same color language as the LIVE-NOW section.
  // Live/preliminary row highlighting removed — the Today's Games panel is now
  // the single place that surfaces what's live, so rows render uniformly.
  const baseRowBg     = (!editable&&!adminResult) ? C.panel : C.panel2;
  const rowBg         = baseRowBg;
  const rowBorderColor= C.border;

  // Shared score / input block used in both layouts
  const scoreBlock = editable ? (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
        <input type="number" inputMode="numeric" min={0} max={20} value={localA}
          onFocus={handleFocus} onChange={e=>{const v=e.target.value.replace(/[^\d]/g,"");setLocalA(v);persistPred(v,localB);}} onBlur={e=>savePred(0,e.target.value)} style={{...numInput,...(localA!==""&&localA!=null?{border:`1px solid ${C.accent}`,color:C.accent,fontWeight:700}:{})}}/>
        <span style={{color:C.muted,fontSize:13}}>:</span>
        <input type="number" inputMode="numeric" min={0} max={20} value={localB}
          onFocus={handleFocus} onChange={e=>{const v=e.target.value.replace(/[^\d]/g,"");setLocalB(v);persistPred(localA,v);}} onBlur={e=>savePred(1,e.target.value)} style={{...numInput,...(localB!==""&&localB!=null?{border:`1px solid ${C.accent}`,color:C.accent,fontWeight:700}:{})}}/>
      </div>
      {isKnockoutMatch && (
        <span style={{fontSize:9,color:C.muted,letterSpacing:".3px",textTransform:"uppercase",fontWeight:500,opacity:0.7}}>
          90 min
        </span>
      )}
    </div>
  ) : adminResult ? (
    <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
      <input type="number" inputMode="numeric" min={0} max={20} value={resA}
        onFocus={handleFocus} onChange={e=>setResA(e.target.value.replace(/[^\d]/g,""))} onBlur={e=>saveResult(0,e.target.value)} style={numInput}/>
      <span style={{color:C.muted,fontSize:13}}>:</span>
      <input type="number" inputMode="numeric" min={0} max={20} value={resB}
        onFocus={handleFocus} onChange={e=>setResB(e.target.value.replace(/[^\d]/g,""))} onBlur={e=>saveResult(1,e.target.value)} style={numInput}/>
    </div>
  ) : (
    <span style={{fontFamily:"monospace",fontWeight:700,fontSize:14,
      color:pred?.[0]!=null?C.text:C.muted,whiteSpace:"nowrap"}}>
      {pred?.[0]!=null ? `${pred[0]} : ${pred[1]}` : "—"}
    </span>
  );

  // ── Result chip — shown on the right when a score exists ─────────────────
  // green ✓ for final, lime for preliminary/live, red for in-play
  const resultChip = effectiveScore!=null ? (
    <span style={{
      background:isLiveBadge?"rgba(239,68,68,0.10)":isPreliminary?"rgba(163,230,53,0.10)":"rgba(48,209,88,0.14)",
      border:`1px solid ${isLiveBadge?"rgba(239,68,68,0.4)":isPreliminary?"rgba(163,230,53,0.35)":"rgba(48,209,88,0.4)"}`,
      color:isLiveBadge?C.red:isPreliminary?C.accent:C.green,
      padding:"1px 7px",borderRadius:4,fontWeight:700,fontFamily:"monospace",
      fontSize:11,whiteSpace:"nowrap",
    }}>
      {isLiveBadge&&<span className="live-dot" style={{marginRight:4}}/>}
      {!isLiveBadge&&!isPreliminary&&"✓ "}
      {effectiveScore[0]}:{effectiveScore[1]}
      {isLiveBadge&&<span style={{marginLeft:4,fontSize:10}}>{liveData.minute===45?"HT":`${liveData.minute}′`}</span>}
    </span>
  ) : null;

  // ── Mobile: two-line layout ────────────────────────────────────────────────
  // Line 1 middle: always shows the participant's prediction (coloured by accuracy).
  // Line 2: actual result chip + points.
  const predChipStyle = effectiveScore!=null
    ? { background:ptsPalette?.bg||C.panel, border:`1px solid ${ptsPalette?.border||C.border}`, color:ptsPalette?.fg||C.text }
    : { background:C.bg, border:`1px solid ${C.border}`, color:pred?.[0]!=null?C.text:C.muted };
  const mobileMiddle = !editable && !adminResult ? (
    <span style={{fontFamily:"monospace",fontWeight:700,fontSize:13,padding:"2px 8px",borderRadius:4,whiteSpace:"nowrap",...predChipStyle}}>
      {pred?.[0]!=null
        ? (effectiveScore!=null ? renderPredDigits(pred,effectiveScore) : `${pred[0]}:${pred[1]}`)
        : "—"}
    </span>
  ) : scoreBlock;
  if (isMobile) {
    return (
      <div data-match-n={match.n} style={{background:rowBg,border:`1px solid ${rowBorderColor}`,borderRadius:6,
        padding:"6px 8px",marginBottom:3,fontSize:12,position:"relative"}}>
        {/* Line 1: flag+name — user's prediction — name+flag */}
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",
          alignItems:"center",gap:6}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
            color:winnerSide===0?C.accent:winnerSide===1?C.muted:C.text,
            fontWeight:winnerSide===0?700:400}}>
            {flag(match.a)} {match.a}
          </span>
          {mobileMiddle}
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
            textAlign:"right",
            color:winnerSide===1?C.accent:winnerSide===0?C.muted:C.text,
            fontWeight:winnerSide===1?700:400}}>
            {match.b} {flag(match.b)}
          </span>
        </div>
        {/* Line 2: result/pts when played, or date/time when upcoming */}
        {(effectiveScore!=null || ptsEl)
          ? <div style={{display:"flex",gap:5,justifyContent:"flex-end",
              alignItems:"center",marginTop:4}}>
              {resultChip}
              {ptsEl}
            </div>
          : (!adminResult&&(()=>{
              const k=kickoffParts(match.t,tz);
              return k
                ? <div style={{display:"flex",justifyContent:"flex-end",marginTop:4}}>
                    <span style={{fontSize:11,color:C.muted}}>
                      <span style={{fontWeight:700,color:C.text}}>{k.time}</span> · {k.md}
                    </span>
                  </div>
                : null;
            })())
        }
      </div>
    );
  }

  // ── Desktop: single-row grid layout ───────────────────────────────────────
  // Middle (spans 3 cols): user's prediction — coloured by accuracy when a result exists.
  // Right panel: actual result chip + points.
  return (
    <div data-match-n={match.n} style={{display:"grid",gridTemplateColumns:"28px 1fr 44px 12px 44px 1fr auto",alignItems:"center",gap:5,padding:"5px 8px",borderRadius:6,background:rowBg,border:`1px solid ${rowBorderColor}`,marginBottom:3,fontSize:13,position:"relative"}}>
      <span style={{color:C.muted,fontSize:11}}>#{match.n}</span>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,
        color:winnerSide===0?C.accent:winnerSide===1?C.muted:C.text,
        fontWeight:winnerSide===0?700:400,transition:"color .2s",
      }}>{flag(match.a)} {match.a}</span>
      {editable?(
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={localA} onFocus={handleFocus} onChange={e=>{const v=e.target.value.replace(/[^\d]/g,"");setLocalA(v);persistPred(v,localB);}} onBlur={e=>savePred(0,e.target.value)} style={{...numInput,...(localA!==""&&localA!=null?{border:`1px solid ${C.accent}`,color:C.accent,fontWeight:700}:{})}}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={localB} onFocus={handleFocus} onChange={e=>{const v=e.target.value.replace(/[^\d]/g,"");setLocalB(v);persistPred(localA,v);}} onBlur={e=>savePred(1,e.target.value)} style={{...numInput,...(localB!==""&&localB!=null?{border:`1px solid ${C.accent}`,color:C.accent,fontWeight:700}:{})}}/>
        </>
      ):adminResult?(
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={resA} onFocus={handleFocus} onChange={e=>setResA(e.target.value.replace(/[^\d]/g,""))} onBlur={e=>saveResult(0,e.target.value)} style={numInput}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={resB} onFocus={handleFocus} onChange={e=>setResB(e.target.value.replace(/[^\d]/g,""))} onBlur={e=>saveResult(1,e.target.value)} style={numInput}/>
        </>
      ):(
        // Prediction always in the centre, coloured by accuracy when result known
        <span style={{
          gridColumn:"span 3",textAlign:"center",fontFamily:"monospace",
          fontWeight:700,fontSize:15,padding:"4px 0",borderRadius:4,
          ...(effectiveScore!=null
            ? { background:ptsPalette?.bg||C.panel,
                border:`1px solid ${ptsPalette?.border||C.border}`,
                color:ptsPalette?.fg||C.text }
            : { background:C.bg, border:`1px solid ${C.border}`,
                color:pred?.[0]!=null?C.text:C.muted }),
        }}>
          {pred?.[0]!=null
            ? (effectiveScore!=null ? renderPredDigits(pred,effectiveScore) : `${pred[0]} : ${pred[1]}`)
            : "—"}
        </span>
      )}
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",fontSize:12,
        color:winnerSide===1?C.accent:winnerSide===0?C.muted:C.text,
        fontWeight:winnerSide===1?700:400,transition:"color .2s",
      }}>{match.b} {flag(match.b)}</span>
      <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"flex-end",minWidth:96}}>
        {effectiveScore!=null
          ? resultChip
          : (!adminResult&&(()=>{
              const k=kickoffParts(match.t,tz);
              return k
                ? <span style={{textAlign:"right",lineHeight:1.25}}>
                    <span style={{display:"block",fontSize:12,fontWeight:700,color:C.text,whiteSpace:"nowrap"}}>{k.time}</span>
                    <span style={{display:"block",fontSize:10,color:C.muted,whiteSpace:"nowrap"}}>{k.md}</span>
                  </span>
                : <span style={{color:C.muted,fontSize:11,fontFamily:"monospace"}}>vs</span>;
            })())
        }
        {ptsEl}
      </div>
    </div>
  );
}

// AuthView — outside App so form state survives App re-renders
function AuthView({ roundState, onSuccess }) {
  const [mode,setMode]=useState("login");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [phone,setPhone]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [showPsw,setShowPsw]=useState(false);
  // reset-password sub-flow
  const [resetMode,setResetMode]=useState(false);
  const [resetEmail,setResetEmail]=useState("");
  const [resetPhone,setResetPhone]=useState("");
  const [resetPsw,setResetPsw]=useState("");
  const [resetConfirm,setResetConfirm]=useState("");
  const [resetDone,setResetDone]=useState(false);

  const pills={
    open:  {text:"🟢 Betting round is OPEN",  bg:"rgba(16,185,129,0.1)",  color:C.green, border:`1px solid ${C.green}`},
    closed:{text:"🔒 Betting round is CLOSED",bg:"rgba(239,68,68,0.1)",   color:C.red,   border:`1px solid ${C.red}`},
    idle:  {text:"⏸️ No betting round yet",   bg:"rgba(148,163,184,0.1)",color:C.muted, border:`1px solid ${C.border}`},
  };
  const pill=pills[roundState]||pills.idle;

  async function submit(e) {
    e.preventDefault(); setErr("");
    if (mode==="signup" && !/^\d{10}$/.test(phone.trim())) {
      setErr("Enter a valid 10-digit phone number.");
      return;
    }
    if (mode==="signup" && password !== confirmPassword) {
      setErr("The two passwords don't match — please re-check.");
      return;
    }
    setLoading(true);
    try {
      const res=mode==="signup"
        ?await api.signup({name:name.trim(),email:email.trim().toLowerCase(),phone:phone.trim(),password})
        :await api.login({email:email.trim().toLowerCase(),password});
      onSuccess(res.user,res.token);
    } catch(e){setErr(e.message);}
    finally{setLoading(false);}
  }

  async function submitReset(e) {
    e.preventDefault(); setErr("");
    if (resetPsw !== resetConfirm) { setErr("Passwords don't match."); return; }
    setLoading(true);
    try {
      await api.resetPassword({email:resetEmail.trim().toLowerCase(),phone:resetPhone.trim(),new_password:resetPsw});
      setResetDone(true);
    } catch(ex){setErr(ex.message);}
    finally{setLoading(false);}
  }

  function exitReset(){setResetMode(false);setResetDone(false);setErr("");setResetEmail("");setResetPhone("");setResetPsw("");setResetConfirm("");}

  return (
    <div style={{maxWidth:400,margin:"30px auto",padding:"0 16px"}}>
      <div style={{marginBottom:14,textAlign:"center"}}>
        <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,background:pill.bg,color:pill.color,border:pill.border}}>{pill.text}</span>
      </div>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
        {resetMode ? (
          <>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
              <button type="button" onClick={exitReset} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:18,lineHeight:1,padding:0}}>←</button>
              <span style={{fontWeight:700,fontSize:15}}>Reset password</span>
            </div>
            {resetDone ? (
              <div style={{textAlign:"center",padding:"12px 0"}}>
                <p style={{color:C.green,fontWeight:600,marginBottom:12}}>✓ Password updated!</p>
                <button onClick={exitReset} style={{background:C.accent,color:"#1a1a1a",border:0,padding:"8px 20px",borderRadius:6,fontWeight:700,cursor:"pointer"}}>Back to login</button>
              </div>
            ) : (
              <form onSubmit={submitReset}>
                <input value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="Email" required type="email" style={inputStyle}/>
                <input value={resetPhone} onChange={e=>setResetPhone(e.target.value.replace(/\D/g,"").slice(0,10))} placeholder="Phone (10 digits)" required type="tel" inputMode="numeric" maxLength={10} style={inputStyle}/>
                <input type="password" value={resetPsw} onChange={e=>setResetPsw(e.target.value)} placeholder="New password" required minLength={4} style={inputStyle}/>
                <input type="password" value={resetConfirm} onChange={e=>setResetConfirm(e.target.value)} placeholder="Confirm new password" required minLength={4} onPaste={e=>e.preventDefault()} style={inputStyle}/>
                {err&&<p style={{color:C.red,fontSize:13,marginBottom:8}}>{err}</p>}
                <button type="submit" disabled={loading} style={{width:"100%",background:C.accent,color:"#1a1a1a",border:0,padding:"10px 0",borderRadius:6,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.6:1}}>
                  {loading?"…":"Set new password"}
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:16}}>
              {["signup","login"].map(m=>(
                <button key={m} onClick={()=>setMode(m)} style={{background:mode===m?C.accent:"transparent",color:mode===m?"#1a1a1a":C.text,border:`1px solid ${mode===m?C.accent:C.border}`,padding:"6px 16px",borderRadius:6,cursor:"pointer",fontWeight:700}}>
                  {m==="signup"?"Sign up":"Log in"}
                </button>
              ))}
            </div>
            <form onSubmit={submit}>
              {mode==="signup"&&<input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" required style={inputStyle}/>}
              {mode==="signup"&&<input value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,"").slice(0,10))} placeholder="Phone (10 digits, e.g. 0501234567)" required type="tel" inputMode="numeric" maxLength={10} style={inputStyle}/>}
              <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" required type={mode==="signup"?"email":"text"} style={inputStyle}/>
              <div style={{position:"relative"}}>
                <input type={showPsw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" required minLength={4} style={{...inputStyle,marginBottom:0,paddingRight:36}}/>
                <button type="button" onClick={()=>setShowPsw(v=>!v)} tabIndex={-1} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16,lineHeight:1,padding:"2px 4px"}}>
                  {showPsw?"🙈":"👁️"}
                </button>
              </div>
              {mode==="signup"&&<input type={showPsw?"text":"password"} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Confirm password" required minLength={4} onPaste={e=>e.preventDefault()} style={{...inputStyle,marginTop:10}}/>}
              {err&&<p style={{color:C.red,fontSize:13,marginBottom:8}}>{err}</p>}
              <button type="submit" disabled={loading} style={{width:"100%",background:C.accent,color:"#1a1a1a",border:0,padding:"10px 0",borderRadius:6,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.6:1}}>
                {loading?"…":mode==="signup"?"Create account":"Log in"}
              </button>
            </form>
            {mode==="login"&&(
              <p style={{textAlign:"center",marginTop:12,marginBottom:0,fontSize:13}}>
                <button type="button" onClick={()=>{setResetMode(true);setErr("");}} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,textDecoration:"underline",fontSize:13,padding:0}}>
                  Forgot password?
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD — outside App so TeamPicker never remounts on App re-renders
// ─────────────────────────────────────────────────────────────────────────────
function AdminDashboard({ config, setConfig, matches, teams, results, participants, setParticipants, adminParticipants, setAdminParticipants, leaderboard, showToast, refreshLb }) {
  const [expandedUsers,setExpandedUsers]=useState(new Set());
  const tableData=adminParticipants.length>0?adminParticipants:null;
  const statData=tableData||participants;
  const multiEntryUsers=tableData?tableData.filter(u=>(u.entries||[]).length>1):[];
  function toggleExpand(uid){setExpandedUsers(s=>{const n=new Set(s);n.has(uid)?n.delete(uid):n.add(uid);return n;});}

  // Stage management
  const currentStage = config.current_stage || 1;

  // Per-form per-stage badge row — green ✓ for submitted, orange with filled/total
  // for the current open stage, muted for future stages, red for past stages
  // that somehow stayed unsubmitted.
  const renderStageBadges = (entry) => {
    const submitted   = entry.stages_submitted || {};
    const stageFilled = entry.stage_filled || {};
    const stageTotals = entry.stage_totals || {};
    return (
      <span style={{display:"inline-flex",gap:3,flexWrap:"wrap",alignItems:"center"}}>
        {STAGES.map(s => {
          const isSubmitted = !!(submitted[s.n] ?? submitted[String(s.n)]);
          const isCurrent   = s.n === currentStage;
          const isFuture    = s.n >  currentStage;
          const filled = stageFilled[s.n] ?? stageFilled[String(s.n)] ?? 0;
          const total  = stageTotals[s.n] ?? stageTotals[String(s.n)] ?? 0;
          let bg, fg, border, label, title;
          if (isSubmitted) {
            label = `S${s.n}✓`;
            bg = "rgba(16,185,129,0.15)"; fg = C.green; border = "rgba(16,185,129,0.4)";
            title = `Stage ${s.n} — ${s.name}: submitted`;
          } else if (isCurrent) {
            label = `S${s.n} ${filled}/${total}`;
            bg = "rgba(245,158,11,0.10)"; fg = "#f59e0b"; border = "rgba(245,158,11,0.35)";
            title = `Stage ${s.n} — ${s.name}: ${filled}/${total} filled, not submitted`;
          } else if (isFuture) {
            label = `S${s.n}`;
            bg = "transparent"; fg = C.muted; border = C.border;
            title = `Stage ${s.n} — ${s.name}: not yet open`;
          } else {
            label = `S${s.n}!`;
            bg = "rgba(239,68,68,0.10)"; fg = C.red; border = "rgba(239,68,68,0.35)";
            title = `Stage ${s.n} — ${s.name}: past stage not submitted`;
          }
          return (
            <span key={s.n} title={title} style={{
              padding:"1px 5px",borderRadius:3,fontSize:10,fontWeight:700,fontFamily:"monospace",
              background:bg,color:fg,border:`1px solid ${border}`,whiteSpace:"nowrap",lineHeight:1.5,
            }}>
              {label}
            </span>
          );
        })}
      </span>
    );
  };
  const stageStats = STAGES.map(s => {
    const stageMatches = matches.filter(m => m.n >= s.first && m.n <= s.last);
    const done = stageMatches.filter(m => results[m.n] != null).length;
    return { ...s, total: stageMatches.length, done };
  });
  const curStat = stageStats[currentStage - 1] || stageStats[0];
  const currentStageComplete = curStat && curStat.done === curStat.total && curStat.total > 0;
  const canOpenNextStage = currentStageComplete && currentStage < 6;

  async function openNextStage() {
    if (!canOpenNextStage) return;
    const next = currentStage + 1;
    try {
      const cfg = await api.updateConfig({ current_stage: next });
      setConfig(cfg);
      showToast(`Stage ${next} — ${STAGES[next-1].name} opened! 🎯`);
    } catch(e) { showToast(e.message, "err"); }
  }

  async function adminDeleteEntry(entryId, userId){
    const ok = await confirmDialog({
      title: "Delete draft form?",
      message: "This removes the draft from the user's account. Submitted forms cannot be deleted from here.",
      confirmLabel: "Delete",
      danger: true,
    });
    if(!ok)return;
    try{
      await api.deleteEntry(entryId);
      setAdminParticipants(prev=>prev.map(u=>{
        if(u.id!==userId)return u;
        const entries=(u.entries||[]).filter(e=>e.id!==entryId);
        return{...u,entries,draft_count:Math.max(0,(u.draft_count||1)-1)};
      }).filter(u=>(u.entries||[]).length>0||(u.submitted_count||0)>0));
      showToast("Form deleted");
    }catch(e){showToast(e.message,"err");}
  }

  async function setRoundState(state) {
    try {
      const cfg = await api.updateConfig({round_state: state});
      setConfig(cfg);
      showToast(state==="open" ? "Round opened!" : state==="closed" ? "Round closed." : "Round reset.");
      refreshLb();
    } catch(e) { showToast(e.message, "err"); }
  }

  async function setWinner(team) {
    // Show feedback immediately; update state only after the API confirms.
    // No optimistic setConfig — that would trigger App re-render → this
    // component would re-render and TeamPicker would lose its open state.
    showToast(team ? "Winner set! 🏆" : "Winner removed");
    try {
      // Pass tournament_winner explicitly (null = clear, string = set).
      // The backend uses model_fields_set so null is properly handled.
      const cfg = await api.updateConfig({ tournament_winner: team ?? null });
      setConfig(cfg);
      refreshLb();
    } catch(e) { showToast(e.message, "err"); }
  }

  async function togglePaid(uid, val) {
    try {
      await api.patchUser(uid, {has_paid: val});
      setParticipants(p => p.map(u => u.id===uid ? {...u, has_paid: val} : u));
      setAdminParticipants(p => p.map(u => u.id===uid ? {...u, has_paid: val} : u));
    } catch(e) { showToast(e.message, "err"); }
  }

  return (
    <div>
      <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>⚙️ Admin dashboard</h1>

      {(() => {
        // Stage-aware denominator: only count matches whose stage is at or
        // below the currently-open stage. Until admin advances past stage 1,
        // "Results entered" reads as N/72 (group stage only), not N/104.
        const openStage   = config?.current_stage || 1;
        const openMatches = matches.filter(m => m.s <= openStage);
        const resultsIn   = openMatches.filter(m => results[m.n]).length;
        // Form submission totals (only available from the admin participant
        // feed, which carries submitted_count / draft_count per user).
        const formsSubmitted = (tableData||[]).reduce((a,u)=>a+(u.submitted_count||0),0);
        const formsPending   = (tableData||[]).reduce((a,u)=>a+(u.draft_count||0),0);
        return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:20}}>
        {[
          {label:"Users",               value:statData.length,                                                   color:C.accent},
          {label:"Forms submitted",     value:formsSubmitted,                                                    color:C.green},
          {label:"Forms not submitted", value:formsPending,                                                      color:"#f59e0b"},
          {label:"Paid",                value:`${statData.filter(u=>u.has_paid).length} / ${statData.length}`,   color:C.green},
          {label:`Results · stage ${openStage}`, value:`${resultsIn} / ${openMatches.length}`,                   color:C.accent},
        ].map(s=>(
          <div key={s.label} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14}}>
            <div style={{color:C.muted,fontSize:12,marginBottom:4}}>{s.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
          </div>
        ))}
      </div>
        );
      })()}

      <h2 style={{color:C.accent,fontSize:16,margin:"0 0 8px"}}>🗂️ Stage control</h2>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:20}}>
        {/* Stage + round state row */}
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:14}}>
          <span style={{background:"rgba(99,102,241,0.12)",color:C.indigo,border:`1px solid ${C.indigo}`,
            padding:"4px 12px",borderRadius:999,fontSize:13,fontWeight:700}}>
            ▶ Stage {currentStage} — {curStat.name}
          </span>
          <span style={{fontSize:13,color:C.muted}}>{curStat.done}/{curStat.total} results entered</span>
          {config.round_state==="open" && (
            <span style={{fontSize:12,padding:"2px 8px",borderRadius:999,fontWeight:600,
              background:"rgba(16,185,129,0.12)",color:C.green,border:`1px solid ${C.green}`}}>
              🟢 predictions open
            </span>
          )}
          {config.round_state==="closed" && (
            <span style={{fontSize:12,padding:"2px 8px",borderRadius:999,fontWeight:600,
              background:"rgba(239,68,68,0.1)",color:C.red,border:`1px solid ${C.red}`}}>
              🔒 predictions closed
            </span>
          )}
          {config.round_state==="idle" && (
            <span style={{fontSize:12,padding:"2px 8px",borderRadius:999,fontWeight:600,
              background:"rgba(148,163,184,0.1)",color:C.muted,border:`1px solid ${C.border}`}}>
              ⏸️ not started
            </span>
          )}
        </div>

        {/* Open / Close predictions */}
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
          {config.round_state!=="open" && (
            <Btn green onClick={()=>setRoundState("open")}>🟢 Open predictions</Btn>
          )}
          {config.round_state==="open" && (
            <Btn red onClick={async ()=>{
              const ok = await confirmDialog({
                title: "Close predictions for this stage?",
                message: "Users won't be able to edit or submit their forms while predictions are closed. You can re-open them later.",
                confirmLabel: "Close predictions",
                danger: true,
              });
              if (ok) setRoundState("closed");
            }}>🔒 Close predictions</Btn>
          )}
          <span style={{fontSize:12,color:C.muted}}>
            {config.round_state==="open"
              ? "Users can enter and edit predictions."
              : config.round_state==="closed"
              ? "Predictions locked. Enter results in the Results tab."
              : "Open to let users fill in predictions."}
          </span>
        </div>

        {/* Advance to next stage */}
        {currentStage < 6 ? (
          canOpenNextStage ? (
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",
              borderTop:`1px solid ${C.border}`,paddingTop:12}}>
              <Btn green onClick={openNextStage}>
                🎯 Advance to Stage {currentStage + 1} — {STAGES[currentStage].name}
              </Btn>
              <span style={{fontSize:12,color:C.muted}}>
                All results entered. Users will be able to fill Stage {currentStage + 1} predictions.
              </span>
            </div>
          ) : (
            <div style={{fontSize:12,color:C.muted,padding:"8px 12px",background:C.panel2,borderRadius:6,
              borderTop:`1px solid ${C.border}`,marginTop:2,paddingTop:10}}>
              ⏳ Enter all {curStat.total} Stage {currentStage} results ({curStat.done}/{curStat.total} done) to unlock Stage {currentStage + 1}.
            </div>
          )
        ) : (
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
            <span style={{fontSize:13,color:C.green,fontWeight:600}}>🏆 All stages complete — tournament done!</span>
          </div>
        )}

      </div>

      <h2 style={{color:C.accent,fontSize:16,margin:"0 0 8px"}}>🏆 Tournament winner</h2>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14,display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:20,position:"relative",zIndex:10}}>
        <TeamPicker value={config.tournament_winner||null} onChange={setWinner} teams={teams} clearable placeholder="— no winner set —"/>
        <span style={{color:C.muted,fontSize:12,alignSelf:"center"}}>Awards +10 pts to everyone who picked correctly.</span>
      </div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <h2 style={{color:C.accent,fontSize:16,margin:0}}>Participants ({statData.length})</h2>
        {tableData&&multiEntryUsers.length>0&&(
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setExpandedUsers(new Set(multiEntryUsers.map(u=>u.id)))}
              style={{background:"transparent",border:`1px solid ${C.accent}`,color:C.accent,padding:"3px 12px",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600}}>
              Expand all
            </button>
            <button onClick={()=>setExpandedUsers(new Set())}
              style={{background:"transparent",border:`1px solid ${C.accent}`,color:C.accent,padding:"3px 12px",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600}}>
              Collapse all
            </button>
          </div>
        )}
      </div>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:C.panel2}}>
            {(tableData
              ?[{h:"",w:28},{h:"Name"},{h:"Forms"},{h:"Best total",a:"right"},{h:"Paid",a:"center"}]
              :[{h:"Name"},{h:"Forms"},{h:"Best total",a:"right"},{h:"Paid",a:"center"}]
            ).map(({h,w,a})=>(
              <th key={h} style={{padding:"9px 12px",textAlign:a||"left",color:C.muted,fontWeight:600,
                borderBottom:`1px solid ${C.border}`,width:w||undefined,whiteSpace:"nowrap"}}>
                {h}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {tableData
              ? tableData.length===0
                ? <tr><td colSpan={5} style={{padding:24,textAlign:"center",color:C.muted}}>No participants yet</td></tr>
                : tableData.map(u=>{
                  const uEntries=u.entries||[];
                  const multi=uEntries.length>1;
                  const expanded=expandedUsers.has(u.id);
                  return (
                    <Fragment key={u.id}>
                      {/* User row */}
                      <tr onClick={()=>multi&&toggleExpand(u.id)}
                        style={{cursor:multi?"pointer":"default",borderTop:`1px solid ${C.border}`}}>
                        <td style={{...td,width:28,paddingRight:0}}>
                          {multi&&<span style={{display:"inline-block",transition:"transform .2s",
                            transform:expanded?"rotate(90deg)":"none",fontSize:10,color:C.muted}}>▶</span>}
                        </td>
                        <td style={{...td,paddingLeft:6}}>
                          <div style={{fontWeight:600,color:C.text}}>{u.name}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:1}}>{u.email}</div>
                          {u.phone&&<div style={{fontSize:11,color:C.muted,marginTop:1}}>📞 <a href={`tel:${u.phone}`} style={{color:C.muted,textDecoration:"none"}}>{u.phone}</a></div>}
                        </td>
                        <td style={td}>
                          {uEntries.length===0
                            ? <span style={{color:C.muted}}>no forms</span>
                            : multi
                              ? <span style={{fontSize:12,color:C.muted}}>
                                  <b style={{color:C.text}}>{uEntries.length}</b> forms ·{" "}
                                  <span style={{color:C.green,fontWeight:600}}>{u.submitted_count??0} submitted</span> ·{" "}
                                  <span style={{color:"#f59e0b",fontWeight:600}}>{u.draft_count??0} not</span>
                                  <span> — click to expand</span>
                                </span>
                              : renderStageBadges(uEntries[0])
                          }
                        </td>
                        <td style={{...td,textAlign:"right",color:C.accent,fontWeight:700,fontFamily:"monospace",fontSize:14}}>
                          {u.best_total??0}
                        </td>
                        <td style={{...td,textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                          <input type="checkbox" checked={u.has_paid} onChange={e=>togglePaid(u.id,e.target.checked)}/>
                        </td>
                      </tr>
                      {/* Entry sub-rows — only for multi-form users when expanded */}
                      {multi&&expanded&&uEntries.map(entry=>{
                        const isDraft=!entry.submitted_at;
                        return (
                          <tr key={entry.id} style={{background:C.bg,borderTop:`1px solid ${C.border}`}}>
                            <td style={td}/>
                            <td style={{...td,paddingLeft:28}}>
                              <span style={{color:C.muted,marginRight:4}}>↳</span>
                              <span style={{fontWeight:500}}>{entry.name}</span>
                              {entry.winner_pick&&<span style={{marginLeft:8,color:C.muted,fontSize:11}}>· winner: <b style={{color:C.accent}}>{withFlag(entry.winner_pick)}</b></span>}
                            </td>
                            <td style={td}>
                              {renderStageBadges(entry)}
                            </td>
                            <td style={{...td,textAlign:"right",fontFamily:"monospace",fontWeight:700}}>
                              {entry.points!=null
                                ?<span style={{color:C.accent}}>{entry.points}</span>
                                :<span style={{color:C.muted}}>—</span>}
                            </td>
                            <td style={{...td,textAlign:"center"}}>
                              {isDraft&&(
                                <button onClick={()=>adminDeleteEntry(entry.id,u.id)} title="Delete draft" style={{
                                  background:"transparent",border:`1px solid ${C.border}`,color:C.red,
                                  padding:"2px 8px",borderRadius:4,cursor:"pointer",fontSize:11,lineHeight:1,
                                }}>✕</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })
              : participants.length===0
                ? <tr><td colSpan={4} style={{padding:24,textAlign:"center",color:C.muted}}>No participants yet</td></tr>
                : participants.map(u=>{
                  const entry=leaderboard.find(e=>e.user_id===u.id);
                  return (
                    <tr key={u.id} style={{borderTop:`1px solid ${C.border}`}}>
                      <td style={td}>
                        <div style={{fontWeight:600}}>{u.name}</div>
                        <div style={{fontSize:11,color:C.muted}}>{u.email}</div>
                        {u.phone&&<div style={{fontSize:11,color:C.muted}}>📞 <a href={`tel:${u.phone}`} style={{color:C.muted,textDecoration:"none"}}>{u.phone}</a></div>}
                      </td>
                      <td style={td}>{entry?.winner_pick?withFlag(entry.winner_pick):"—"}</td>
                      <td style={{...td,textAlign:"right",color:C.accent,fontWeight:700,fontFamily:"monospace"}}>{entry?.total??0}</td>
                      <td style={{...td,textAlign:"center"}}><input type="checkbox" checked={u.has_paid} onChange={e=>togglePaid(u.id,e.target.checked)}/></td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// TOURNAMENT TAB — group standings + match list (outside App, never remounts)
// ─────────────────────────────────────────────────────────────────────────────

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

function computeGroupStandings(groupLetter, allMatches, results, simPreds={}, liveMatches={}) {
  // Stage-1 filter is defence in depth: bracket labels ("FIN"/"3P") could
  // someday collide with a real group letter (the Final used to be tagged
  // "F", which polluted Group F's standings until we renamed it).
  const gm = allMatches.filter(m => m.s === 1 && m.g === groupLetter);
  const teams = [...new Set(gm.flatMap(m => [m.a, m.b]))];
  const s = {};
  teams.forEach(t => { s[t]={P:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,Pts:0}; });
  for (const m of gm) {
    const ld=liveMatches[m.n];
    const r = results[m.n]
      ?? (ld ? [ld.score_a, ld.score_b] : null)
      ?? (simPreds[m.n]?.[0]!=null && simPreds[m.n]?.[1]!=null ? simPreds[m.n] : null);
    if (!r) continue;
    const [ga,gb]=[Number(r[0]),Number(r[1])];
    const a=s[m.a], b=s[m.b];
    a.P++;b.P++;
    a.GF+=ga;a.GA+=gb;a.GD=a.GF-a.GA;
    b.GF+=gb;b.GA+=ga;b.GD=b.GF-b.GA;
    if(ga>gb){a.W++;a.Pts+=3;b.L++;}
    else if(gb>ga){b.W++;b.Pts+=3;a.L++;}
    else{a.D++;a.Pts++;b.D++;b.Pts++;}
  }
  return teams.map(t=>({name:t,...s[t]}))
    .sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||a.name.localeCompare(b.name));
}

function GroupCard({ group, allMatches, results, simPreds, liveMatches={} }) {
  // Stage-1 only — see computeGroupStandings for the rationale.
  const gm = allMatches.filter(m => m.s === 1 && m.g === group);
  const standings = computeGroupStandings(group, allMatches, results, simPreds, liveMatches);
  // A live score counts as "played" too — the standings already fold it in
  // (results ?? live ?? sim), so the counter + match list must match.
  const played = gm.filter(m => results[m.n] || liveMatches[m.n]).length;

  return (
    <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
      {/* Header */}
      <div style={{background:C.panel2,padding:"8px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontFamily:"var(--c-font-display)",fontSize:20,color:C.text,letterSpacing:1}}>
          Group {group}
        </span>
        <span style={{fontSize:11,color:C.muted}}>{played}/{gm.length} played</span>
      </div>

      {/* Standings */}
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead>
          <tr style={{background:C.panel2}}>
            {["#","Team","P","W","D","L","GF","GA","GD","Pts"].map(h=>(
              <th key={h} style={{padding:"3px 5px",color:C.muted,fontWeight:600,
                textAlign:h==="Team"?"left":"center",borderBottom:`1px solid ${C.border}`}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.map((t,i)=>{
            const qual = i<2?"advance":i===2?"maybe":"out";
            const rowBg = qual==="advance"?"rgba(16,185,129,0.07)":qual==="maybe"?"rgba(163,230,53,0.07)":"transparent";
            const posClr = qual==="advance"?C.green:qual==="maybe"?C.accent:C.muted;
            return (
              <tr key={t.name} style={{background:rowBg}}>
                <td style={{padding:"4px 5px",textAlign:"center",color:posClr,fontWeight:700,fontSize:11}}>{i+1}</td>
                <td style={{padding:"4px 5px",color:C.text,fontWeight:i<2?600:400,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:130}}>
                  {flag(t.name)} {t.name}
                </td>
                {["P","W","D","L","GF","GA","GD","Pts"].map(col=>(
                  <td key={col} style={{padding:"4px 5px",textAlign:"center",fontFamily:"monospace",
                    fontWeight:col==="Pts"?700:400,
                    color:col==="Pts"?C.accent:col==="GD"&&t.GD>0?C.green:col==="GD"&&t.GD<0?C.red:C.text,
                  }}>{t[col]}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{display:"flex",gap:12,padding:"4px 8px 6px",fontSize:10}}>
        <span style={{color:C.green}}>● advance</span>
        <span style={{color:C.accent}}>● may advance</span>
      </div>

      {/* Match list */}
      <div style={{borderTop:`1px solid ${C.border}`}}>
        {gm.map(m=>{
          const ld = liveMatches[m.n];
          // Fall back to the live score (results ?? live), mirroring the
          // standings — a score saved as "live" still shows here and counts.
          const res = results[m.n] ?? (ld ? [ld.score_a, ld.score_b] : null);
          const sim = !res && simPreds[m.n]?.[0]!=null ? simPreds[m.n] : null;
          const isMatchLive = !!(ld && ld.is_live);
          const eff = res||sim;
          const isSim = !res&&!!sim;
          const winA = eff ? (eff[0]>eff[1]?true:eff[1]>eff[0]?false:null) : null;
          return (
            <div key={m.n} style={{
              display:"grid",gridTemplateColumns:"1fr 58px 1fr",
              alignItems:"center",gap:4,padding:"4px 10px",
              borderBottom:`1px solid ${C.border}`,opacity:isSim?0.75:1,
            }}>
              <span style={{fontSize:11,textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                color:winA===true?C.accent:winA===false?C.muted:C.text,fontWeight:winA===true?700:400}}>
                {m.a} {flag(m.a)}
              </span>
              <span style={{fontSize:11,fontFamily:"monospace",fontWeight:700,textAlign:"center",
                color:isMatchLive?C.red:eff?C.green:C.muted,
                background:isMatchLive?"rgba(239,68,68,0.10)":eff?"rgba(16,185,129,0.10)":"transparent",
                border:isMatchLive?"1px solid rgba(239,68,68,0.3)":eff?"1px solid rgba(16,185,129,0.25)":"1px solid transparent",
                padding:"1px 4px",borderRadius:4,
              }}>
                {eff ? `${isSim?"~":""}${eff[0]}:${eff[1]}` : "vs"}
              </span>
              <span style={{fontSize:11,textAlign:"left",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                color:winA===false?C.accent:winA===true?C.muted:C.text,fontWeight:winA===false?700:400}}>
                {flag(m.b)} {m.b}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Kickoff-time helpers — honor the user's Settings timezone ("auto"=browser).
// Resolve a timezone arg to an Intl `timeZone` value. Accepts an explicit tz
// (preferred — passed from App state so changes re-render instantly), falling
// back to the persisted setting. "auto" → undefined (use the browser's tz).
function _resolveTz(tz){ const r=tz||(typeof localStorage!=="undefined"&&localStorage.getItem("mb_timezone"))||"auto"; return r==="auto"?undefined:r; }
function kickoffParts(t, tz){
  if(!t) return null;
  const d=new Date(t); if(isNaN(d.getTime())) return null;
  const z=_resolveTz(tz);
  // hourCycle:"h23" forces 00-23 range on every locale/browser without exception.
  const f=(o)=>new Intl.DateTimeFormat("en-GB",{...o,timeZone:z,hourCycle:"h23"}).format(d);
  return {
    time:  f({hour:"2-digit",minute:"2-digit"}),   // always "HH:MM" e.g. "22:00"
    md:    f({month:"short",day:"numeric"}),
    short: f({weekday:"short",month:"short",day:"numeric"}),
    long:  f({weekday:"long", month:"long", day:"numeric"}),
    dayKey:new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:z}).format(d),
    at:    d.getTime(),
  };
}
function todayKey(tz){ return new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:_resolveTz(tz)}).format(new Date()); }
function yesterdayKey(tz){ return new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:_resolveTz(tz)}).format(new Date(Date.now()-86400000)); }
function todayLabel(tz){ return new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric",timeZone:_resolveTz(tz)}).format(new Date()); }

// ── "Today's Games" panel — pinned at the top of the Tournament & Leaderboard
// tabs. Shows games kicking off today (plus any currently-live match), flagged
// LIVE / FULL TIME / UPCOMING, with kickoff time in the user's timezone.
function TodaysGames({ matches=[], results={}, liveMatches={}, tz }){
  const z = _resolveTz(tz);
  const tKey = todayKey(tz);
  const yKey = yesterdayKey(tz);
  const tomorrowKey = new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:z}).format(new Date(Date.now()+86400000));
  const koHour = (t) => parseInt(new Intl.DateTimeFormat("en-US",{hour:"numeric",hour12:false,timeZone:z}).format(new Date(t)));
  const all = matches.map(m=>({m,k:kickoffParts(m.t,tz)}));
  const list = all
    .filter(({m,k}) => {
      if(liveMatches[m.n]&&liveMatches[m.n].is_live) return true;   // currently live, any day
      if(!k) return false;
      if(k.dayKey===tKey) return true;                             // everything kicking off today
      // Yesterday's games, but only the ones that are actually over (have a score).
      if(k.dayKey===yKey) return !!results[m.n] || !!liveMatches[m.n];
      // Tomorrow's games that kick off before noon (first 12 h of the next day)
      if(k.dayKey===tomorrowKey && koHour(m.t)<12) return true;
      return false;
    })
    .sort((a,b)=>(a.k?.at||0)-(b.k?.at||0));
  const liveCount = list.filter(({m})=>liveMatches[m.n]&&liveMatches[m.n].is_live).length;

  // Auto-focus the strip on the most relevant game: the live one if any, else
  // the latest game that's already over (the rightmost finished). Keeps the
  // action in view on first paint without the user having to scroll past
  // earlier/older cards — on both mobile and web.
  const focusN = (()=>{
    const liveItem = list.find(({m})=>liveMatches[m.n]&&liveMatches[m.n].is_live);
    if(liveItem) return liveItem.m.n;
    let lastFin=null;
    for(const {m} of list){
      const live=liveMatches[m.n], res=results[m.n];
      const isLive=!!(live&&live.is_live);
      const hasScore=res?true:!!(live&&live.score_a!=null);
      if(!isLive&&hasScore) lastFin=m.n;
    }
    return lastFin;
  })();
  const stripRef = useRef(null);
  useEffect(()=>{
    if(focusN==null) return;
    const strip=stripRef.current; if(!strip) return;
    const card=strip.querySelector(`[data-mn="${focusN}"]`);
    if(!card) return;
    const delta=(card.getBoundingClientRect().left - strip.getBoundingClientRect().left) - 12;
    strip.scrollTo({left: strip.scrollLeft + delta, behavior: "smooth"});
  // Only re-scrolls when the focus game changes (or cards are added) — so a
  // user's manual scroll between polls isn't yanked back every 10s.
  },[focusN, list.length]);

  const panel = {
    background:C.panel, border:`1px solid ${C.border}`, borderTop:`2px solid ${C.accent}`,
    borderRadius:12, padding:"14px 16px 16px", marginBottom:16, boxShadow:"0 6px 18px rgba(0,0,0,0.35)",
  };
  const head = (
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,marginBottom:list.length?12:0,flexWrap:"wrap"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontFamily:"var(--c-font-display)",fontSize:23,letterSpacing:1,color:C.text}}>⚽ Today's Games</span>
        <span style={{color:C.muted,fontSize:13,fontWeight:600}}>{todayLabel(tz)}</span>
      </div>
      {liveCount>0 && (
        <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",
          background:"rgba(239,68,68,0.12)",color:C.red,border:"1px solid rgba(239,68,68,0.4)",padding:"3px 10px",borderRadius:999}}>
          <span className="live-dot"/> {liveCount} live now
        </span>
      )}
    </div>
  );

  if(!list.length){
    const next = all.filter(({k})=>k && k.dayKey>tKey).sort((a,b)=>a.k.at-b.k.at)[0];
    return (
      <div style={panel}>
        {head}
        <div style={{color:C.muted,fontSize:13,padding:"4px 2px"}}>
          {next ? (()=>{ const rm=resolvedMatch(next.m,results,matches); return (
            <>No matches scheduled today. Next up: <b style={{color:C.text}}>{flag(rm.a)} {rm.a} vs {rm.b} {flag(rm.b)}</b> — {next.k.long} · {next.k.time}</>
          ); })() : "No matches scheduled today."}
        </div>
      </div>
    );
  }

  return (
    <div style={panel}>
      {head}
      <div ref={stripRef} style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:4}}>
        {list.map(({m})=>{
          const rm=resolvedMatch(m,results,matches);
          const live=liveMatches[m.n];
          const res=results[m.n];
          const isLive=!!(live&&live.is_live);
          const score=res?[res[0],res[1]]:(live?[live.score_a,live.score_b]:null);
          const finished=!isLive&&!!score;
          const k=kickoffParts(m.t,tz);
          const winA=score?(score[0]>score[1]?true:score[1]>score[0]?false:(res&&res[2]==='a'?true:res&&res[2]==='b'?false:null)):null;
          const badge = isLive
            ? <span style={{display:"inline-flex",alignItems:"center",gap:5,color:C.red,fontWeight:800,letterSpacing:".5px",whiteSpace:"nowrap",flexShrink:0}}><span className="live-dot"/> LIVE {live.minute===45?"HT":live.minute!=null?`${live.minute}'`:""}</span>
            : finished
              ? <span style={{color:C.green,fontWeight:800,letterSpacing:".5px",whiteSpace:"nowrap",flexShrink:0}}>✓ FULL TIME</span>
              : <span style={{color:C.accent,fontWeight:800,letterSpacing:".5px",whiteSpace:"nowrap",flexShrink:0}}>◷ UPCOMING</span>;
          // Red cards per side — live-only signal (gone once finalized).
          const redA = live ? (live.red_a||0) : 0;
          const redB = live ? (live.red_b||0) : 0;
          const redChip = (n) => n>0 ? (
            <span title={`${n} red card${n>1?"s":""}`} style={{display:"inline-flex",alignItems:"center",gap:2,flexShrink:0}}>
              <span style={{display:"inline-block",width:9,height:12,borderRadius:1.5,background:C.red,boxShadow:"0 0 0 1px rgba(0,0,0,0.25)"}}/>
              {n>1 && <span style={{fontSize:10,fontWeight:800,color:C.red,fontVariantNumeric:"tabular-nums"}}>{n}</span>}
            </span>
          ) : null;
          const teamRow=(name,won,sc,reds=0)=>(
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:14,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                color:won===true?C.accent:won===false?C.muted:C.text}}>
                <span style={{fontSize:15,flexShrink:0}}>{flag(name)}</span>
                <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{name}</span>
              </span>
              <span style={{display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>
                {redChip(reds)}
                {score
                  ? <span style={{fontFamily:"var(--c-font-display)",fontSize:17,letterSpacing:.5,minWidth:14,textAlign:"right",color:won===true?C.accent:won===false?C.muted:(isLive?C.red:C.text)}}>{sc}</span>
                  : <span style={{color:C.muted,fontSize:11}}>{won==="lead"?"vs":""}</span>}
              </span>
            </div>
          );
          return (
            <div key={m.n} data-mn={m.n} style={{flex:"0 0 178px",background:C.bg,
              border:`1px solid ${isLive?"rgba(239,68,68,0.45)":C.border}`,
              ...(isLive?{background:"rgba(239,68,68,0.05)"}:{}),
              borderRadius:10,padding:"7px 10px",display:"flex",flexDirection:"column",gap:6}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:11,gap:6}}>
                {badge}
                {/* A live game whose scheduled day isn't today keeps its original
                    date + time so it's clear when it was actually played. */}
                {/* Option A: once a game is live or finished the kickoff hour is
                    secondary, so it shrinks + dims and the badge wins the eye. */}
                <span style={{color:C.muted,fontWeight:600,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",
                  ...((isLive||finished) ? {fontSize:10,opacity:0.55} : {})}}>
                  {k ? (k.dayKey!==tKey ? `${k.md} · ${k.time}` : k.time) : ""}
                </span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {teamRow(rm.a, winA===true?true:(winA===false?false:(score?null:"lead")), score?score[0]:null, redA)}
                {teamRow(rm.b, winA===false?true:(winA===true?false:null), score?score[1]:null, redB)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tournament({ matches, results, liveMatches={}, myPreds, config, user, tz }) {
  const openStage = config.current_stage || 1;
  const visibleStages = user?.is_admin ? STAGES : STAGES.filter(s => s.n <= openStage);
  const [activeStage, setActiveStage] = useState(openStage);
  // Clamp active stage to visible list
  const effectiveStage = visibleStages.find(s => s.n === activeStage)
    ? activeStage
    : (visibleStages[visibleStages.length - 1]?.n || 1);

  const stageObj = STAGES.find(s => s.n === effectiveStage) || STAGES[0];
  const stageMatchList = matches.filter(m => m.n >= stageObj.first && m.n <= stageObj.last);

  const groupMatches = matches.filter(m => m.s === 1);
  const groupPlayed  = groupMatches.filter(m => results[m.n] || liveMatches[m.n]).length;
  const knockoutDone = stageMatchList.filter(m => results[m.n] || liveMatches[m.n]).length;

  return (
    <div>
      <TodaysGames matches={matches} results={results} liveMatches={liveMatches} tz={tz}/>
      {/* ── Stage tabs ── */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {visibleStages.map(s => {
          const isActive  = s.n === effectiveStage;
          const isCurrent = s.n === openStage;
          const sMatches  = matches.filter(m => m.n >= s.first && m.n <= s.last);
          const sDone     = sMatches.filter(m => results[m.n]).length;
          return (
            <button key={s.n} onClick={() => setActiveStage(s.n)} style={{
              padding:"6px 14px", borderRadius:6, cursor:"pointer", fontSize:13,
              background: isActive ? C.accent : C.panel2,
              color: isActive ? "#1a1a1a" : C.text,
              border: `1px solid ${isActive ? C.accent : (isCurrent && !isActive ? C.indigo : C.border)}`,
              fontWeight: isActive ? 700 : 400,
            }}>
              {isCurrent && !isActive && <span style={{color:C.indigo,marginRight:4}}>▶</span>}
              {s.name}
              {sDone > 0 && (
                <span style={{marginLeft:6,fontSize:11,opacity:0.65,fontWeight:400}}>
                  {sDone}/{sMatches.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Group Stage (stage 1) ── */}
      {effectiveStage === 1 && (
        <div>
          <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,
            padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",
            justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontFamily:"var(--c-font-display)",fontSize:20,color:C.accent,letterSpacing:1}}>
                GROUP STAGE
              </span>
              <span style={{fontSize:11,padding:"2px 8px",borderRadius:999,fontWeight:600,
                background:"rgba(16,185,129,0.15)",color:C.green,border:"1px solid rgba(16,185,129,0.3)"}}>
                updates with every result
              </span>
            </div>
            <div style={{fontSize:13,color:C.muted}}>
              <b style={{color:C.text}}>{groupPlayed}</b> / {groupMatches.length} played
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
            {GROUPS.map(g=>(
              <GroupCard key={g} group={g} allMatches={matches} results={results}
                simPreds={{}} liveMatches={liveMatches}/>
            ))}
          </div>
        </div>
      )}

      {/* ── Knockout stages (2-6) ── */}
      {effectiveStage > 1 && (
        <KnockoutBracket
          matches={matches}
          results={results}
          liveMatches={liveMatches}
          currentStage={effectiveStage}
          tz={tz}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// KNOCKOUT BRACKET — bracket view for stages 2+
// ─────────────────────────────────────────────────────────────────────────────
function KnockoutBracket({ matches, results, liveMatches={}, currentStage, tz }) {
  const wrapRef = useRef(null);
  const knockoutStages = STAGES.filter(s => s.n >= 2);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cols = wrap.querySelectorAll('[data-round-col]');
    knockoutStages.slice(0, -1).forEach((s, ci) => {
      const svg = wrap.querySelector(`[data-conn-svg="${s.n}"]`);
      if (!svg) return;
      svg.innerHTML = '';
      const svgRect = svg.getBoundingClientRect();
      const leftCards  = cols[ci]?.querySelectorAll('[data-matchup]') || [];
      const rightCards = cols[ci+1]?.querySelectorAll('[data-matchup]') || [];
      const stroke = s.n === currentStage ? 'rgba(163,230,53,.35)' : 'var(--c-border)';
      for (let ri = 0; ri < rightCards.length; ri++) {
        const li1 = leftCards[ri * 2];
        const li2 = leftCards[ri * 2 + 1];
        const rm  = rightCards[ri];
        if (!li1 || !rm) continue;
        const r1 = li1.getBoundingClientRect();
        const r2 = (li2 || li1).getBoundingClientRect();
        const rr = rm.getBoundingClientRect();
        const y1 = (r1.top + r1.bottom) / 2 - svgRect.top;
        const y2 = (r2.top + r2.bottom) / 2 - svgRect.top;
        const yM = (y1 + y2) / 2;
        const yT = (rr.top + rr.bottom) / 2 - svgRect.top;
        const d = `M0,${y1} H12 M0,${y2} H12 M12,${y1} V${y2} M12,${yM} H28`;
        const path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', stroke);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
      }
    });
  });

  function renderMatchup(m) {
    const teamA   = resolveTeamDeep(m.a, results, matches);
    const teamB   = resolveTeamDeep(m.b, results, matches);
    const live    = liveMatches[m.n];
    const res     = results[m.n];
    const isLive  = !!(live && live.is_live);
    const isDone  = !!res;
    const scoreA  = isLive ? live.score_a : (res ? res[0] : null);
    const scoreB  = isLive ? live.score_b : (res ? res[1] : null);
    const winner  = isLive ? live.winner  : (res ? res[2] : null);
    const winA    = scoreA != null
      ? (scoreA > scoreB ? true : scoreB > scoreA ? false
         : winner === 'a' ? true : winner === 'b' ? false : null)
      : null;
    const border  = isLive ? `1px solid ${C.red}` : isDone ? `1px solid rgba(16,185,129,0.2)` : `1px solid ${C.border}`;
    const pending = !isLive && !isDone;

    const rowA = {display:'flex',alignItems:'center',gap:5,padding:'6px 8px',
      borderBottom:`1px solid ${C.border}`,
      background: winA===true ? 'rgba(163,230,53,.07)' : 'transparent'};
    const rowB = {display:'flex',alignItems:'center',gap:5,padding:'6px 8px',
      background: winA===false ? 'rgba(163,230,53,.07)' : 'transparent'};
    const nameStyle = (won) => ({fontSize:12,fontWeight:won?700:400,flex:1,
      whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
      color: won===false ? C.muted : C.text});
    const scoreStyle = (won) => ({fontSize:12,fontWeight:700,fontFamily:'monospace',
      minWidth:18,textAlign:'right',
      color: won===true ? C.accent : isDone ? C.muted : C.muted});

    const koParts = pending ? kickoffParts(m.t, tz) : null;
    return (
      <div data-matchup={m.n} style={{background:C.panel,border,borderRadius:8,overflow:'hidden',opacity:pending?0.6:1,margin:'0 3px'}}>
          <div style={rowA}>
            <span style={{fontSize:14,width:20,textAlign:'center',flexShrink:0}}>{flag(teamA)}</span>
            <span style={nameStyle(winA===true)}>{teamA}</span>
            {isLive
              ? <span className="live-dot" style={{width:6,height:6}}/>
              : <span style={scoreStyle(winA===true)}>{scoreA != null ? scoreA : '–'}</span>}
          </div>
          <div style={rowB}>
            <span style={{fontSize:14,width:20,textAlign:'center',flexShrink:0}}>{flag(teamB)}</span>
            <span style={nameStyle(winA===false)}>{teamB}</span>
            {isLive
              ? <span className="live-dot" style={{width:6,height:6}}/>
              : <span style={scoreStyle(winA===false)}>{scoreB != null ? scoreB : '–'}</span>}
          </div>
          {koParts && (
            <div style={{padding:'3px 8px 4px',fontSize:10,fontWeight:600,color:C.muted,
              borderTop:`1px solid ${C.border}`,textAlign:'center',whiteSpace:'nowrap',
              letterSpacing:'.01em'}}>
              {koParts.md} · {koParts.time}
            </div>
          )}
        </div>
    );
  }

  // Slot-based layout: each card lives in a slot whose height doubles each round.
  // R32 = 1×, R16 = 2×, QF = 4×, SF = 8× base slot.
  // Stage 6 (Final & 3rd): the Final gets the full 16-slot height (centred between
  // both SF matches). The 3rd-place match floats below — no bracket lines connect to it.
  const MATCH_COUNTS  = {2:16, 3:8, 4:4, 5:2};   // stage 6 handled separately
  const BASE_COUNT    = 16;
  const BASE_SLOT_PX  = 80;
  const LABEL_H       = 16;

  function aboveCardLabel(m) {
    const res = results[m.n];
    const live = liveMatches[m.n];
    const isLive = !!(live && live.is_live);
    const winner = isLive ? live.winner : (res ? res[2] : null);
    if (res && winner) {
      const wt = winner==='a'
        ? resolveTeamDeep(m.a, results, matches)
        : resolveTeamDeep(m.b, results, matches);
      return <span style={{fontSize:10,fontWeight:700,color:C.muted,
        whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
        {flag(wt)} <span style={{color:C.accent}}>{wt}</span> wins
      </span>;
    }
    if (isLive) return <span style={{fontSize:10,fontWeight:700,
      display:'flex',alignItems:'center',gap:3}}>
      <span className="live-dot" style={{width:6,height:6}}/>
      <span style={{color:C.red}}>LIVE</span>
    </span>;
    return null;
  }

  function slotCard(m, slotPx) {
    return (
      <div key={m.n} style={{
        height:slotPx, display:'flex', flexDirection:'column',
        justifyContent:'center', paddingTop:LABEL_H, position:'relative',
      }}>
        <div style={{position:'absolute',top:0,left:4,right:4,height:LABEL_H,
          overflow:'hidden',display:'flex',alignItems:'flex-end'}}>
          {aboveCardLabel(m)}
        </div>
        {renderMatchup(m)}
      </div>
    );
  }

  return (
    <div style={{overflowX:'auto',overflowY:'visible',paddingBottom:8}}>
      <div ref={wrapRef} style={{display:'flex',alignItems:'flex-start',minWidth:'min-content'}}>
        {knockoutStages.map((s, colIdx) => {
          const isCurrent  = s.n === currentStage;
          const stageMs    = matches.filter(m => m.n >= s.first && m.n <= s.last);
          const isFinalStage = s.n === 6;
          const count      = MATCH_COUNTS[s.n] || 1;
          const slotPx     = (BASE_COUNT / count) * BASE_SLOT_PX;

          // Stage 6: Final gets a single slot spanning the full bracket height;
          // 3rd place is a floating card below (outside the slot layout, no connectors).
          const finalMatch = isFinalStage ? stageMs.find(m => m.g === 'FIN') : null;
          const thirdMatch = isFinalStage ? stageMs.find(m => m.g === '3P')  : null;
          const bracketMs  = isFinalStage ? (finalMatch ? [finalMatch] : stageMs.slice(0,1)) : stageMs;
          const finalSlotPx = isFinalStage ? (BASE_COUNT / 1) * BASE_SLOT_PX : slotPx;

          return (
            <Fragment key={s.n}>
              <div data-round-col={s.n} style={{display:'flex',flexDirection:'column',
                width:160, flexShrink:0, opacity:isCurrent?1:0.5}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',
                  padding:'0 4px 8px',textAlign:'center',height:24,
                  color:isCurrent?C.accent:C.muted}}>
                  {s.name}
                </div>
                {/* Normal bracket cards */}
                {bracketMs.map(m => slotCard(m, isFinalStage ? finalSlotPx : slotPx))}
                {/* 3rd place — floating below, not connected to bracket lines */}
                {thirdMatch && (
                  <div style={{marginTop:4,padding:'0 3px'}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.muted,
                      padding:'0 0 4px',letterSpacing:'.06em',textTransform:'uppercase'}}>
                      🥉 3rd place
                    </div>
                    {renderMatchup(thirdMatch)}
                  </div>
                )}
              </div>
              {colIdx < knockoutStages.length - 1 && (
                <div style={{width:28,flexShrink:0,alignSelf:'stretch',position:'relative'}}>
                  <svg data-conn-svg={s.n} width="28" height="100%"
                    style={{position:'absolute',inset:0,overflow:'visible'}}/>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN MATCH ROW — handles pending / live / final states; outside App
// ─────────────────────────────────────────────────────────────────────────────
function AdminMatchRow({ match, result, liveData, onSaveResult, onGoLive, onUpdateLive, onFinalize, tz }) {
  const hasScore   = !!liveData;                  // any in-motion score saved
  const isShownLive= !!(liveData && liveData.is_live);  // admin clicked LIVE
  const isFinal    = !!result;
  // Knockout matches (stages 2+) must have a winner; may be decided by ET/pens
  const isKnockout = match.s >= 2;

  const sStr = (v) => (v==null ? "" : String(v));
  const numOrNull = (v) => (v==="" || v==null) ? null : (Number(v)||0);

  const [resA, setResA] = useState(hasScore ? sStr(liveData.score_a) : isFinal ? sStr(result[0]) : "");
  const [resB, setResB] = useState(hasScore ? sStr(liveData.score_b) : isFinal ? sStr(result[1]) : "");
  // Extra-time (cumulative) + penalty-shootout scores — knockout matches only.
  const [etA, setEtA]   = useState(hasScore ? sStr(liveData.et_a)  : isFinal ? sStr(result[3]) : "");
  const [etB, setEtB]   = useState(hasScore ? sStr(liveData.et_b)  : isFinal ? sStr(result[4]) : "");
  const [penA, setPenA] = useState(hasScore ? sStr(liveData.pen_a) : isFinal ? sStr(result[5]) : "");
  const [penB, setPenB] = useState(hasScore ? sStr(liveData.pen_b) : isFinal ? sStr(result[6]) : "");
  // Red cards per side — live-only UI signal (no result equivalent).
  const [redA, setRedA] = useState(hasScore ? sStr(liveData.red_a) : "");
  const [redB, setRedB] = useState(hasScore ? sStr(liveData.red_b) : "");

  // Race protection — the 10s background poll + cross-tab sync both flush
  // liveMatches state from props. Without these guards, polling could wipe
  // what the admin just typed (before save completes) OR clobber freshly-
  // saved values with a stale poll response that was in flight.
  //   editingRef    — true while ANY input is focused (user is typing)
  //   pendingSaveRef — true while our own onUpdateLive() is in flight
  const editingRef    = useRef(false);
  const pendingSaveRef = useRef(false);

  useEffect(() => {
    // Don't clobber the user's in-progress typing, and don't replace freshly
    // saved data with whatever a concurrent poll happened to return.
    if (editingRef.current || pendingSaveRef.current) return;
    if (liveData) {
      setResA(sStr(liveData.score_a)); setResB(sStr(liveData.score_b));
      setEtA(sStr(liveData.et_a)); setEtB(sStr(liveData.et_b));
      setPenA(sStr(liveData.pen_a)); setPenB(sStr(liveData.pen_b));
      setRedA(sStr(liveData.red_a)); setRedB(sStr(liveData.red_b));
    } else if (result) {
      setResA(sStr(result[0])); setResB(sStr(result[1]));
      setEtA(sStr(result[3])); setEtB(sStr(result[4]));
      setPenA(sStr(result[5])); setPenB(sStr(result[6]));
      setRedA(""); setRedB("");
    } else {
      setResA(""); setResB(""); setEtA(""); setEtB(""); setPenA(""); setPenB("");
      setRedA(""); setRedB("");
    }
  }, [liveData?.score_a, liveData?.score_b, liveData?.et_a, liveData?.et_b,
      liveData?.pen_a, liveData?.pen_b, liveData?.red_a, liveData?.red_b,
      result?.[0], result?.[1],
      result?.[3], result?.[4], result?.[5], result?.[6]]);

  const handleFocus = () => { editingRef.current = true; };

  // Auto-advance: after a digit is entered, jump focus to the next score box.
  // We query the live DOM (after a tick, so a freshly-revealed ET/pen input is
  // present) and move to the input following the one that was just edited.
  const rowRef = useRef(null);
  function focusNextInput(currentEl) {
    const root = rowRef.current;
    if (!root) return;
    const inputs = Array.from(root.querySelectorAll('input[type="number"]'));
    const i = inputs.indexOf(currentEl);
    if (i >= 0 && i + 1 < inputs.length) inputs[i + 1].focus();
  }
  function onScoreChange(setter, e) {
    setter(e.target.value);
    if (e.target.value !== "") {
      const el = e.target;          // capture before React reuses the event
      setTimeout(() => focusNextInput(el), 0);
    }
  }

  // Any score edit saves the whole in-motion record (90-min + ET + pens). The
  // just-blurred field is passed via `ov` since setState hasn't flushed yet.
  // onUpdateLive does an optimistic local update + background persist, so this
  // returns instantly and never blocks typing the next box.
  function saveAll(ov = {}) {
    editingRef.current = false;
    const sa = ov.sa!==undefined ? ov.sa : resA;
    const sb = ov.sb!==undefined ? ov.sb : resB;
    if (sa===""&&sb==="") return;   // nothing entered yet
    onUpdateLive(match.n, {
      score_a: Number(sa)||0,
      score_b: Number(sb)||0,
      minute: liveData?.minute || 0,
      is_live: !!liveData?.is_live,
      et_a:  numOrNull(ov.ea!==undefined ? ov.ea : etA),
      et_b:  numOrNull(ov.eb!==undefined ? ov.eb : etB),
      pen_a: numOrNull(ov.pa!==undefined ? ov.pa : penA),
      pen_b: numOrNull(ov.pb!==undefined ? ov.pb : penB),
      red_a: numOrNull(ov.ra!==undefined ? ov.ra : redA),
      red_b: numOrNull(ov.rb!==undefined ? ov.rb : redB),
    });
  }

  // Current winner derived live from whatever's typed (pens → ET → 90-min)
  const curWinner = deriveWinner(
    numOrNull(resA), numOrNull(resB), numOrNull(etA), numOrNull(etB),
    numOrNull(penA), numOrNull(penB),
  );
  const winA = (hasScore||isFinal)
    ? (curWinner==='a' ? true : curWinner==='b' ? false : null)
    : null;
  // Knockout matches (stage 2+) can't end in a draw — block FINAL until a
  // winner is decided (90-min, then extra-time, then penalties).
  const finalBlocked = isKnockout && !curWinner;
  // Progressive disclosure: ET appears when 90-min is a draw, pens when ET ties.
  const ftDraw  = isKnockout && resA!=="" && resB!=="" && Number(resA)===Number(resB);
  const etDraw  = ftDraw && etA!=="" && etB!=="" && Number(etA)===Number(etB);
  const showEt  = ftDraw && !isFinal;
  const showPen = etDraw && !isFinal;
  // Row palette: red for shown-as-live, green for final, lime tint for
  // "score saved but not yet marked LIVE", default panel for empty.
  const rowBg = isShownLive ? "rgba(239,68,68,0.06)"
              : isFinal     ? "rgba(16,185,129,0.04)"
              : hasScore    ? "rgba(163,230,53,0.04)"
              : C.panel2;
  const rowBorder = `1px solid ${
      isShownLive ? "rgba(239,68,68,0.35)"
    : isFinal     ? "rgba(16,185,129,0.25)"
    : hasScore    ? "rgba(163,230,53,0.25)"
    : C.border}`;
  const inputBorder = isShownLive ? "rgba(239,68,68,0.5)"
                    : hasScore    ? "rgba(163,230,53,0.4)"
                    : C.border;
  const isMobile = useIsMobile();

  // For final knockout matches, the advancing team's name (when 90-min tied)
  const finalWinnerName = isFinal && result[0]===result[1]
    ? (result[2]==='a' ? match.a : result[2]==='b' ? match.b : null)
    : null;
  // Small label + a pair of mini score inputs (for ET / pens rows)
  const miniInput = {...numInput, width:30, padding:"1px 3px", fontSize:12};
  const tierRow = (label, aVal, setA, bVal, setB, aKey, bKey) => (
    <div style={{display:"flex",alignItems:"center",gap:3}}>
      <span style={{fontSize:9,color:C.muted,width:32,textAlign:"right",
        textTransform:"uppercase",letterSpacing:".3px"}}>{label}</span>
      <input type="number" inputMode="numeric" min={0} max={30} value={aVal}
        onFocus={handleFocus} onChange={e=>onScoreChange(setA,e)}
        onBlur={e=>saveAll({[aKey]:e.target.value})}
        style={{...miniInput,border:`1px solid ${inputBorder}`}}/>
      <span style={{color:C.muted,fontSize:11}}>:</span>
      <input type="number" inputMode="numeric" min={0} max={30} value={bVal}
        onFocus={handleFocus} onChange={e=>onScoreChange(setB,e)}
        onBlur={e=>saveAll({[bKey]:e.target.value})}
        style={{...miniInput,border:`1px solid ${inputBorder}`}}/>
    </div>
  );

  // Score / inputs block shared across layouts
  const scoreBlock = isFinal ? (
    <div style={{textAlign:"center",lineHeight:1.3}}>
      <span style={{fontFamily:"monospace",fontWeight:700,fontSize:14,whiteSpace:"nowrap",
        color:C.green}}>✓ {result[0]}:{result[1]}</span>
      {result[3]!=null && (
        <div style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>
          a.e.t. {result[3]}:{result[4]}
        </div>
      )}
      {result[5]!=null && (
        <div style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>
          pen {result[5]}:{result[6]}
        </div>
      )}
      {finalWinnerName && (
        <div style={{fontSize:10,color:C.accent,fontWeight:700}}>
          {result[2]==='a' ? `◀ ${finalWinnerName}` : `${finalWinnerName} ▶`}
        </div>
      )}
    </div>
  ) : (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <div style={{display:"flex",alignItems:"center",gap:3}}>
        {isKnockout && <span style={{fontSize:9,color:C.muted,width:32,textAlign:"right",textTransform:"uppercase",letterSpacing:".3px"}}>90'</span>}
        <input type="number" inputMode="numeric" min={0} max={20} value={resA}
          onFocus={handleFocus}
          onChange={e=>onScoreChange(setResA,e)} onBlur={e=>saveAll({sa:e.target.value})}
          style={{...(isKnockout?miniInput:numInput),border:`1px solid ${inputBorder}`}}/>
        <span style={{color:C.muted,fontSize:13}}>:</span>
        <input type="number" inputMode="numeric" min={0} max={20} value={resB}
          onFocus={handleFocus}
          onChange={e=>onScoreChange(setResB,e)} onBlur={e=>saveAll({sb:e.target.value})}
          style={{...(isKnockout?miniInput:numInput),border:`1px solid ${inputBorder}`}}/>
      </div>
      {showEt  && tierRow("a.e.t.", etA, setEtA, etB, setEtB, "ea", "eb")}
      {showPen && tierRow("pen",   penA, setPenA, penB, setPenB, "pa", "pb")}
      {hasScore && tierRow("🟥", redA, setRedA, redB, setRedB, "ra", "rb")}
      {isKnockout && hasScore && curWinner && (
        <div style={{fontSize:10,color:C.accent,fontWeight:700}}>
          {curWinner==='a' ? `◀ ${match.a}` : `${match.b} ▶`}
        </div>
      )}
    </div>
  );

  // Controls:
  //   • match has score but not yet marked LIVE → ● LIVE button + ✓ FINAL
  //   • match marked LIVE                        → LIVE indicator + ✓ FINAL
  //   • match final                              → small green dot
  //   • empty                                     → nothing
  const controls = (
    <div style={{display:"flex",gap:4,alignItems:"center"}}>
      {hasScore && !isFinal && !isShownLive && (
        <button onClick={()=>onGoLive(match.n)} style={{
          background:"transparent",border:`1px solid ${C.red}`,color:C.red,
          padding:"2px 8px",borderRadius:4,cursor:"pointer",
          fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
          <span className="live-dot" style={{marginRight:4}}/> LIVE
        </button>
      )}
      {isShownLive && (
        <span style={{display:"inline-flex",alignItems:"center",gap:4,
          color:C.red,fontSize:11,fontWeight:600,marginRight:4}}>
          <span className="live-dot"/> LIVE
        </span>
      )}
      {hasScore && !isFinal && (
        <button
          onClick={()=>{ if(finalBlocked) return; onFinalize(match.n, {
            score_a: Number(resA)||0, score_b: Number(resB)||0,
            minute: liveData?.minute||0, is_live: !!liveData?.is_live,
            et_a: numOrNull(etA), et_b: numOrNull(etB),
            pen_a: numOrNull(penA), pen_b: numOrNull(penB),
            red_a: numOrNull(redA), red_b: numOrNull(redB),
          }); }}
          disabled={finalBlocked}
          title={finalBlocked ? "A knockout match can't end in a draw — enter extra-time / penalties to decide a winner first" : undefined}
          style={{
          background:finalBlocked?C.panel2:C.green,color:finalBlocked?C.muted:"white",
          border:finalBlocked?`1px solid ${C.border}`:0,padding:"2px 8px",
          borderRadius:4,cursor:finalBlocked?"not-allowed":"pointer",
          fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
          ✓ FINAL
        </button>
      )}
      {!hasScore && isFinal && (
        <span style={{width:8,height:8,borderRadius:"50%",background:C.green,display:"inline-block"}}
              title="Final result"/>
      )}
      {!hasScore && !isFinal && (()=>{
        const k = kickoffParts(match.t, tz);
        return k ? <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>
          <span style={{fontWeight:700,color:C.text}}>{k.time}</span> · {k.md}
        </span> : null;
      })()}
    </div>
  );

  // ── Mobile: two-line layout ────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div ref={rowRef} style={{background:rowBg,border:rowBorder,borderRadius:6,
        padding:"6px 8px",marginBottom:3,fontSize:12}}>
        {/* Line 1: flag+name — score — name+flag */}
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",
          alignItems:"center",gap:6}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
            color:winA===true?C.accent:winA===false?C.muted:C.text,fontWeight:winA===true?700:400}}>
            {flag(match.a)} {match.a}
          </span>
          {scoreBlock}
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",
            color:winA===false?C.accent:winA===true?C.muted:C.text,fontWeight:winA===false?700:400}}>
            {match.b} {flag(match.b)}
          </span>
        </div>
        {/* Line 2: live controls / status */}
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:4}}>
          {controls}
        </div>
      </div>
    );
  }

  // ── Desktop: original single-row grid layout ───────────────────────────────
  return (
    <div ref={rowRef} style={{display:"grid",gridTemplateColumns:"28px 1fr 44px 12px 44px 1fr auto",
      alignItems:"center",gap:5,padding:"5px 8px",borderRadius:6,
      background:rowBg,border:rowBorder,marginBottom:3,fontSize:13}}>
      <span style={{color:C.muted,fontSize:11}}>#{match.n}</span>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,
        color:winA===true?C.accent:winA===false?C.muted:C.text,fontWeight:winA===true?700:400}}>
        {flag(match.a)} {match.a}
      </span>
      <div style={{gridColumn:"span 3",display:"flex",justifyContent:"center",
        ...(isFinal ? {background:"rgba(16,185,129,0.10)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:4,padding:"3px 0"} : {})}}>
        {scoreBlock}
      </div>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",fontSize:12,
        color:winA===false?C.accent:winA===true?C.muted:C.text,fontWeight:winA===false?700:400}}>
        {match.b} {flag(match.b)}
      </span>
      <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"flex-end",minWidth:110}}>
        {controls}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN RESULTS — module-level so its identity is stable across App re-renders.
// Defining it inside App would create a new function reference on every render,
// causing React to unmount+remount the whole tree and reset AdminMatchRow inputs.
// ─────────────────────────────────────────────────────────────────────────────
function AdminResults({ config, matches, results, liveMatches, setResults, setLiveMatches, refreshLb, refreshLive, showToast, tz }) {
  const currentStage = config.current_stage || 1;
  // All stages except current start collapsed
  const [collapsedStages, setCollapsedStages] = useState(
    () => new Set(STAGES.filter(s => s.n !== currentStage).map(s => s.n))
  );
  const toggleStage = n => setCollapsedStages(prev => {
    const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next;
  });

  async function saveResult(matchN, data) {
    await api.setResult(matchN, data);
    if (data.score_a != null && data.score_b != null) {
      const w = deriveWinner(data.score_a, data.score_b, data.et_a, data.et_b, data.pen_a, data.pen_b);
      setResults(r => ({...r, [matchN]: [data.score_a, data.score_b, w, data.et_a??null, data.et_b??null, data.pen_a??null, data.pen_b??null]}));
    } else
      setResults(r => { const n = {...r}; delete n[matchN]; return n; });
    showToast("Result saved ✓"); refreshLb();
  }
  async function goLive(matchN) {
    try {
      await liveApi.markLive(matchN);
      await refreshLive();
      showToast("Match marked LIVE");
    } catch(e) { showToast(e.message, "err"); }
  }
  function updateLive(matchN, data) {
    // 1) Optimistic local update FIRST — instant, never blocks typing the
    //    next box. This is the source of truth for the admin's own edits.
    setLiveMatches(prev => {
      const p = prev[matchN] || {};
      const sa = data.score_a ?? p.score_a ?? 0;
      const sb = data.score_b ?? p.score_b ?? 0;
      const etA  = data.et_a  !== undefined ? data.et_a  : (p.et_a  ?? null);
      const etB  = data.et_b  !== undefined ? data.et_b  : (p.et_b  ?? null);
      const penA = data.pen_a !== undefined ? data.pen_a : (p.pen_a ?? null);
      const penB = data.pen_b !== undefined ? data.pen_b : (p.pen_b ?? null);
      const redA = data.red_a !== undefined ? data.red_a : (p.red_a ?? null);
      const redB = data.red_b !== undefined ? data.red_b : (p.red_b ?? null);
      return {
        ...prev,
        [matchN]: {
          ...p, score_a: sa, score_b: sb,
          minute:  data.minute  ?? p.minute  ?? 0,
          is_live: data.is_live ?? p.is_live ?? false,
          et_a: etA, et_b: etB, pen_a: penA, pen_b: penB,
          red_a: redA, red_b: redB,
          winner: deriveWinner(sa, sb, etA, etB, penA, penB),
        },
      };
    });
    // 2) Persist + refresh leaderboard in the BACKGROUND (fire-and-forget).
    //    No await, no refreshLive() refetch — that re-render was what blocked
    //    the admin from typing the next result. The 10s poll reconciles drift.
    Promise.resolve()
      .then(() => liveApi.set(matchN, data))
      .then(() => refreshLb())
      .catch(e => showToast(e.message, "err"));
  }
  async function finalizeLive(matchN, data) {
    try {
      // Flush the latest typed values FIRST (awaited) so finalize can't race
      // the fire-and-forget per-keystroke save and persist a stale score.
      if (data) await liveApi.set(matchN, data);
      const res = await liveApi.finalize(matchN);
      setResults(r => ({...r, [matchN]: [res.score_a, res.score_b, res.winner??null, res.et_a??null, res.et_b??null, res.pen_a??null, res.pen_b??null]}));
      await refreshLive();
      showToast("Match finalized ✓"); refreshLb();
    } catch(e) { showToast(e.message, "err"); }
  }

  const roundPill = {
    open:   {text:"🟢 Betting round is OPEN",   bg:"rgba(16,185,129,0.1)",  color:C.green, border:`1px solid ${C.green}`},
    closed: {text:"🔒 Betting round is CLOSED",  bg:"rgba(239,68,68,0.1)",   color:C.red,   border:`1px solid ${C.red}`},
    idle:   {text:"⏸️ No betting round yet",     bg:"rgba(148,163,184,0.1)", color:C.muted, border:`1px solid ${C.border}`},
  }[config.round_state] || {};

  return (
    <div>
      <div style={{marginBottom:14}}>
        <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,
          fontWeight:600,background:roundPill.bg,color:roundPill.color,border:roundPill.border}}>
          {roundPill.text}
        </span>
      </div>
      <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>Enter results</h1>
      {config.round_state==="open" && (
        <InfoBlock warn>💡 Round is still open. Close it first so participants can't edit after seeing scores.</InfoBlock>
      )}
      {Object.keys(liveMatches).length > 0 && (
        <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.25)",
          borderRadius:6,padding:"7px 14px",marginBottom:14,fontSize:13,color:C.red,
          display:"flex",alignItems:"center",gap:8}}>
          <span className="live-dot"/>
          <b>{Object.keys(liveMatches).length}</b> match{Object.keys(liveMatches).length!==1?"es":""} currently LIVE
        </div>
      )}
      {STAGES.map(s => {
        const stageMatches = matches.filter(m => m.n >= s.first && m.n <= s.last);
        if (stageMatches.length === 0) return null;
        const done = stageMatches.filter(m => results[m.n] != null).length;
        const isCurrent = currentStage === s.n;
        const isCollapsed = collapsedStages.has(s.n);
        return (
          <div key={s.n}>
            <div onClick={() => toggleStage(s.n)} style={{
              background:C.panel2, padding:"8px 12px", borderRadius:6,
              margin:"16px 0 6px", fontWeight:600, color:C.indigo, fontSize:14,
              cursor:"pointer", display:"flex", alignItems:"center",
              justifyContent:"space-between", userSelect:"none",
            }}>
              <span>
                {isCurrent && <span style={{marginRight:6}}>▶</span>}
                Stage {s.n}: {s.name}
                <span style={{marginLeft:8,fontSize:12,fontWeight:400,color:C.muted}}>
                  {done}/{stageMatches.length} results
                </span>
                {done === stageMatches.length && stageMatches.length > 0 && (
                  <span style={{marginLeft:8,fontSize:11,color:C.green,fontWeight:600}}>✓ complete</span>
                )}
              </span>
              <span style={{fontSize:13,color:C.muted,lineHeight:1}}>
                {isCollapsed ? "▸" : "▾"}
              </span>
            </div>
            {!isCollapsed && (
              <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10,marginBottom:8}}>
                {stageMatches.map(m => (
                  <Fragment key={m.n}>
                    <StageMatchLabel m={m}/>
                    <AdminMatchRow
                      match={resolvedMatch(m, results, matches)}
                      result={results[m.n] ?? null}
                      liveData={liveMatches[m.n] ?? null}
                      onSaveResult={saveResult}
                      onGoLive={goLive}
                      onUpdateLive={updateLive}
                      onFinalize={finalizeLive}
                      tz={tz}
                    />
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// LiveNowSection — shown at the top of the Leaderboard when matches are in play
function LiveNowSection({ liveMatches, matches }) {
  // Show every match that has an in-motion score: admin-marked-LIVE first
  // (red, with the minute and the pulsing dot), then "saved" scores the
  // admin has entered without flipping the LIVE switch yet (lime border).
  const entries = Object.entries(liveMatches);
  if (entries.length === 0) return null;
  const liveNow = entries.filter(([,ld]) => ld?.is_live);
  const inMotion = entries.filter(([,ld]) => !ld?.is_live);
  const Card = ({mn, ld, shownLive}) => {
    const m = matches.find(x=>x.n===Number(mn));
    if(!m) return null;
    const winA=ld.score_a>ld.score_b?true:ld.score_b>ld.score_a?false:null;
    const accent = shownLive ? C.red : C.accent;
    return (
      <div key={mn} style={{background:C.panel,border:`1px solid ${accent}`,borderRadius:8,padding:"10px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:10}}>
          <span style={{color:accent,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
            {shownLive
              ? <><span className="live-dot"/> LIVE {ld.minute===45?"HT":`${ld.minute}'`}</>
              : <>● IN PROGRESS</>}
          </span>
          <span style={{color:C.muted}}>#{m.n}{m.g?` · ${m.g}`:""}</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:6}}>
          <span style={{fontSize:12,textAlign:"right",
            color:winA===true?C.accent:winA===false?C.muted:C.text,fontWeight:winA===true?700:400}}>
            {flag(m.a)} {m.a}
          </span>
          <span style={{fontSize:20,fontFamily:"monospace",fontWeight:700,color:C.text,padding:"0 6px"}}>
            {ld.score_a}:{ld.score_b}
          </span>
          <span style={{fontSize:12,textAlign:"left",
            color:winA===false?C.accent:winA===true?C.muted:C.text,fontWeight:winA===false?700:400}}>
            {flag(m.b)} {m.b}
          </span>
        </div>
      </div>
    );
  };
  return (
    <div style={{marginBottom:20}}>
      {liveNow.length > 0 && (
        <>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span className="live-dot"/>
            <span style={{fontFamily:"var(--c-font-display)",fontSize:18,color:C.red,letterSpacing:1}}>LIVE NOW</span>
            <span style={{fontSize:11,color:C.muted}}>({liveNow.length})</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10,marginBottom:14}}>
            {liveNow.map(([mn,ld]) => <Card key={mn} mn={mn} ld={ld} shownLive/>)}
          </div>
        </>
      )}
      {inMotion.length > 0 && (
        <>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:C.accent,display:"inline-block"}}/>
            <span style={{fontFamily:"var(--c-font-display)",fontSize:18,color:C.accent,letterSpacing:1}}>IN PROGRESS</span>
            <span style={{fontSize:11,color:C.muted}}>({inMotion.length})</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
            {inMotion.map(([mn,ld]) => <Card key={mn} mn={mn} ld={ld} shownLive={false}/>)}
          </div>
        </>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS VIEW — outside App so form inputs survive App re-renders
// ─────────────────────────────────────────────────────────────────────────────

const TIMEZONES = [
  { label:"Auto (browser)", value:"auto" },
  { label:"UTC",            value:"UTC" },
  { label:"Israel",         value:"Asia/Jerusalem" },
  { label:"UK",             value:"Europe/London" },
  { label:"Paris",          value:"Europe/Paris" },
  { label:"Athens",         value:"Europe/Athens" },
  { label:"USA — Eastern",  value:"America/New_York" },
  { label:"USA — Central",  value:"America/Chicago" },
  { label:"USA — Mountain", value:"America/Denver" },
  { label:"USA — Pacific",  value:"America/Los_Angeles" },
  { label:"Mexico",         value:"America/Mexico_City" },
  { label:"Toronto",        value:"America/Toronto" },
  { label:"São Paulo",      value:"America/Sao_Paulo" },
  { label:"Sydney",         value:"Australia/Sydney" },
  { label:"Tokyo",          value:"Asia/Tokyo" },
];

// ─────────────────────────── Onboarding help system ────────────────────────
//
// Per-user, per-tab one-time popup. First login lands on My predictions, the
// "welcome" dialog covers the intro + that tab. Subsequent unseen tabs each
// show a smaller dialog. Closing shrinks the dialog toward the ⓘ help button
// in the nav, then the button blinks twice so the user remembers where to find
// help. Clicking the button later re-opens the current tab's dialog.
//
// State lives in localStorage at `mb_help_seen_v1_<userId>` (JSON map of
// {welcome,tournament,leaderboard,byuser,predictions,settings,results,dashboard}).

// help_seen now lives on the user row (DB / demo store). The localStorage
// helpers below are kept ONLY as a one-time migration: if an older client
// already flagged tabs locally, we surface those flags on first load so the
// popups don't replay, then clear them. New writes go straight to the API.
const HELP_VERSION = "v1";
const HELP_CONTENT = {
  welcome: {
    badge: "👋",
    title: "Welcome to MondoBet",
    body: [
      "**How it works** — MondoBet is a World Cup prediction game. For every match you predict the final **90-minute** score (extra time / penalties don't count).",
      "**Scoring** — **5 pts** if you call the direction right, **+3 bonus** for the exact score, **+1** if you got one side's score right, and **+10** for picking the tournament winner.",
      { text: "**Five tabs at the top:**", subs: [
        "**Tournament** — a **Today's Games** panel up top, plus the full bracket and schedule with live scores and your picks alongside the real results.",
        "**Leaderboard** — live rankings across every form, plus a Simulate mode that shows where you'd land if your remaining picks come true.",
        "**By participant** — peek at any other player's submitted forms once the stage is closed.",
        "**My predictions** — where you fill in scores, pick a tournament winner, and submit each stage.",
        "**Settings** — your timezone, theme, and reset the onboarding tips.",
      ]},
      "**Important** — a form must submit its **stage 1** picks before stage 1 closes. Otherwise it's parked and can't be edited or submitted for the rest of the tournament.",
    ],
  },
  predictions: {
    badge: "📝",
    title: "My predictions",
    body: [
      "Fill in scores for every match. They save automatically as you type.",
      "**Scoring** — **5 pts** if you call the direction right, **+3 bonus** for the exact score, **+1** if you got one side's score right, and **+10** for picking the tournament winner.",
      "Pick a **tournament winner** (+10 pts) — locked once stage 1 closes.",
      "Hit **Submit** when you're ready and have filled in all the matches for the stage. You can keep editing and re-submit as many times as you like until the stage closes.",
      "Stuck on multiple strategies? Click **+ Add form** to maintain another set of picks.",
      "**Rename a form** — click the ✏️ on a form's tab to give it a name (e.g. \"Risky\", \"Safe\").",
      "**Import CSV** — fill a whole stage from a spreadsheet (one line per match: `match number,home,away`). Tap the **?** beside the button for the full how-to.",
    ],
  },
  tournament: {
    badge: "🏟",
    title: "Tournament",
    body: [
      "**Today's Games** (top) — every match kicking off today: 🔴 **live** ones show the minute, finished show the score, upcoming show the kickoff time. It refreshes on its own as games start, update, and end.",
      "Browse the full schedule grouped by stage.",
      "See actual results, **live** scores, and your own picks side by side.",
      "Kickoff times follow the timezone in your Settings.",
    ],
  },
  leaderboard: {
    badge: "🏆",
    title: "Leaderboard",
    body: [
      "**Today's Games** (top) — today's matches with 🔴 **live** scores, finished results, and upcoming kickoff times. It updates live as games start, change, and finish.",
      "Rankings across every submitted form, updated as results come in. The **#** column shows your rank; a green/red number below it shows how much you've climbed or dropped since the stage started or since yesterday.",
      "Click any form to **compare it against yours** — your picks and theirs side by side, with the points each of you earned per match.",
      "Tap the **★** next to any name to favorite that form — your own forms are always favorited. Tap the **★** in the column header to show only your favorites.",
      "**Simulate** — flip to *Simulate* mode to see where you'd land *if* every remaining pick of yours came true. Type a number in the banner to cap how many matches to simulate. If you have multiple forms, chip buttons appear so you can pick which form drives the simulation. Only you see it.",
      "**Match picks** (👁 toggle) — reveals a column showing what every form predicted for one specific match. Use the dropdown in the column header to switch between games.",
    ],
  },
  settings: {
    badge: "⚙️",
    title: "Settings",
    body: [
      "Set your timezone — kickoff times in **Today's Games** and across the schedule use it.",
      "Toggle dark / light from the moon/sun button in the nav.",
      "Use **Reset onboarding** below to see these tips again.",
    ],
  },
  results: {
    badge: "🛠",
    title: "Results (admin)",
    body: [
      "Enter final scores and live scores per match.",
      "Saving a score immediately updates the leaderboard. The **LIVE** flag only controls the banner.",
      "When you're done with a stage, advance it from the Dashboard tab.",
    ],
  },
  dashboard: {
    badge: "📊",
    title: "Dashboard (admin)",
    body: [
      "Open / close the betting round, advance stage, and set the tournament winner.",
      "Use **Testing tools** lower down to force-set stages or seed live data.",
    ],
  },
};
// Tabs that should never auto-open a dialog (welcome is special; auth isn't a real tab).
const HELP_TABS = ["predictions","tournament","leaderboard","settings","results","dashboard"];

// Read any pre-existing localStorage flags from older builds so a returning
// user doesn't see the welcome again. Wipe the key after reading.
function consumeLegacyHelpSeen(userId){
  if(!userId) return {};
  const key = `mb_help_seen_${HELP_VERSION}_${userId}`;
  try {
    const raw = localStorage.getItem(key);
    if(!raw) return {};
    localStorage.removeItem(key);
    return JSON.parse(raw) || {};
  } catch { return {}; }
}

// Tiny markdown: **bold** → <strong>, *italic* → <em>. No HTML otherwise.
function renderHelpLine(text, boldStyle){
  const parts = [];
  let i=0, key=0;
  while(i < text.length){
    const bStart = text.indexOf("**", i);
    const iStart = text.indexOf("*", i);
    // Prefer bold if it's earlier or tied
    if(bStart !== -1 && (iStart === -1 || iStart >= bStart)){
      if(bStart > i) parts.push(text.slice(i, bStart));
      const bEnd = text.indexOf("**", bStart+2);
      if(bEnd === -1){ parts.push(text.slice(bStart)); break; }
      parts.push(<strong key={key++} style={boldStyle}>{text.slice(bStart+2, bEnd)}</strong>);
      i = bEnd+2;
    } else if(iStart !== -1){
      if(iStart > i) parts.push(text.slice(i, iStart));
      const iEnd = text.indexOf("*", iStart+1);
      if(iEnd === -1){ parts.push(text.slice(iStart)); break; }
      parts.push(<em key={key++}>{text.slice(iStart+1, iEnd)}</em>);
      i = iEnd+1;
    } else {
      parts.push(text.slice(i));
      break;
    }
  }
  return parts;
}

function HelpDialog({ entry, onClose, helpBtnRef }){
  // entry: { badge, title, body[] } | null
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef(null);
  // Phone-friendly layout: shrink paddings + fonts + cap height with scroll.
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < 520
  );
  useEffect(()=>{
    const onResize = ()=> setIsMobile(window.innerWidth < 520);
    window.addEventListener("resize", onResize);
    return ()=> window.removeEventListener("resize", onResize);
  }, []);

  // Esc closes
  useEffect(()=>{
    if(!entry) return;
    const onKey = (e)=>{ if(e.key === "Escape") triggerClose(); };
    window.addEventListener("keydown", onKey);
    return ()=> window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  function triggerClose(){
    if(closing || !dialogRef.current) { onClose?.(); return; }
    // Compute translate to the help button's rect.
    let dx = 200, dy = -100;
    try{
      const d = dialogRef.current.getBoundingClientRect();
      const b = helpBtnRef?.current?.getBoundingClientRect();
      if(b){
        dx = (b.left + b.width/2) - (d.left + d.width/2);
        dy = (b.top + b.height/2) - (d.top + d.height/2);
      }
    }catch{}
    const el = dialogRef.current;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(0.08)`;
    el.style.opacity = "0";
    setClosing(true);
    setTimeout(()=> onClose?.(), 320);
  }

  if(!entry) return null;
  // Responsive size knobs — desktop vs phone.
  const sz = isMobile
    ? { wrapPad:"10px", radius:14, hdrPad:"14px 16px", badge:32, badgeFs:18, gap:10,
        titleFs:17, closeFs:22, closePad:"4px 6px", bodyPad:"16px 18px 12px",
        bodyFs:14, lineHeight:1.5, introFs:14.5, introMb:12, bulletGap:11,
        subGap:5, ftrPad:"12px 16px", tipFs:12, btnPad:"8px 16px", btnFs:13 }
    : { wrapPad:"24px", radius:16, hdrPad:"20px 26px", badge:40, badgeFs:22, gap:14,
        titleFs:20, closeFs:24, closePad:"4px 10px", bodyPad:"22px 28px 18px",
        bodyFs:15, lineHeight:1.65, introFs:15.5, introMb:16, bulletGap:14,
        subGap:6, ftrPad:"16px 26px", tipFs:13, btnPad:"9px 20px", btnFs:14 };
  return (
    <div
      onClick={(e)=>{ if(e.target === e.currentTarget) triggerClose(); }}
      style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",
        justifyContent:"center",padding:sz.wrapPad,background:"transparent"}}>
      <div
        ref={dialogRef}
        className="dialog-shrinking"
        style={{
          background:C.bg, color:C.text,
          border:`1px solid ${C.border}`, borderRadius:sz.radius,
          maxWidth:680, width:"100%",
          maxHeight:"calc(100vh - 20px)",
          boxShadow:"0 24px 60px rgba(0,0,0,.32), 0 8px 18px rgba(0,0,0,.18)",
          overflow:"hidden", transformOrigin:"top right",
          display:"flex", flexDirection:"column",
        }}>
        <div style={{display:"flex",alignItems:"center",gap:sz.gap,
          padding:sz.hdrPad, borderBottom:`1px solid ${C.border}`,
          background:`linear-gradient(180deg, var(--c-accent-soft) 0%, transparent 100%)`,
          flexShrink:0}}>
          <span style={{background:C.accent,color:"white",width:sz.badge,height:sz.badge,borderRadius:"50%",
            display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:sz.badgeFs,flexShrink:0}}>
            {entry.badge}
          </span>
          <h3 style={{margin:0,fontSize:sz.titleFs,fontWeight:700,color:C.text,flex:1,letterSpacing:0.2}}>
            {entry.title}
          </h3>
          <button onClick={triggerClose} title="Close (Esc)"
            style={{background:"transparent",border:0,color:C.muted,fontSize:sz.closeFs,
              cursor:"pointer",lineHeight:1,padding:sz.closePad}}>×</button>
        </div>
        <div style={{padding:sz.bodyPad,fontSize:sz.bodyFs,lineHeight:sz.lineHeight,color:C.text,
          overflowY:"auto",flex:1,WebkitOverflowScrolling:"touch"}}>
          {entry.body.map((item, idx) => {
            // String item that doesn't use any markdown → intro paragraph (no bullet).
            if(typeof item === "string"){
              const isIntro = idx === 0 && !item.includes("**") && !item.startsWith("*");
              if(isIntro) return (
                <p key={idx} style={{margin:`0 0 ${sz.introMb}px`,fontSize:sz.introFs,color:C.text}}>
                  {renderHelpLine(item)}
                </p>
              );
            }
            return null;
          })}
          <ul style={{margin:"0",paddingLeft:isMobile?16:22,listStyle:"none"}}>
            {entry.body.map((item, idx) => {
              if(typeof item === "string"){
                const isIntro = idx === 0 && !item.includes("**") && !item.startsWith("*");
                if(isIntro) return null;
                return (
                  <li key={idx} style={{marginBottom:sz.bulletGap, paddingLeft:14, position:"relative"}}>
                    <span style={{position:"absolute", left:-2, top:isMobile?9:11,
                      width:6, height:6, borderRadius:"50%",
                      background:C.accent, display:"inline-block"}}/>
                    {renderHelpLine(item)}
                  </li>
                );
              }
              // Object item: { text, subs:[] } — main bullet + nested sub-bullets.
              const { text, subs } = item;
              return (
                <li key={idx} style={{marginBottom:sz.bulletGap, paddingLeft:14, position:"relative"}}>
                  <span style={{position:"absolute", left:-2, top:isMobile?9:11,
                    width:6, height:6, borderRadius:"50%",
                    background:C.accent, display:"inline-block"}}/>
                  {renderHelpLine(text)}
                  <ul style={{margin:"8px 0 2px",padding:`2px 0 2px ${isMobile?12:16}px`,
                    listStyle:"none", borderLeft:`2px solid ${C.accentSoft}`}}>
                    {subs.map((s, j) => (
                      <li key={j} style={{marginBottom:j===subs.length-1?0:sz.subGap, color:C.muted}}>
                        {renderHelpLine(s, {color:C.accent, fontWeight:600})}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
        <div style={{padding:sz.ftrPad,borderTop:`1px solid ${C.border}`,
          background:C.panel,display:"flex",alignItems:"center",justifyContent:"space-between",
          gap:10,flexWrap:"wrap",flexShrink:0}}>
          <span style={{fontSize:sz.tipFs,color:C.muted,flex:isMobile?"1 1 100%":"unset",
            order:isMobile?2:1}}>
            Tip: re-open this anytime via the <b style={{color:C.accent}}>ⓘ</b> button in the nav.
          </span>
          <button onClick={triggerClose}
            style={{background:C.accent,color:"white",fontWeight:700,border:0,
              borderRadius:8,padding:sz.btnPad,cursor:"pointer",fontSize:sz.btnFs,
              order:isMobile?1:2,alignSelf:isMobile?"flex-end":"auto"}}>
            Got it →
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsView({ user, leaderboard, onLogout, onNameUpdate, showToast, config, setConfig, matches=[], results={}, setResults, liveMatches={}, refreshLive, refreshLb, onResetOnboarding, tz="auto", onTzChange, showLivePreds=true, onLivePredsChange }) {
  // Timezone is owned by App (lifted) so a change re-renders every time display
  // immediately. We just call back up and confirm with a toast.
  function saveTz(val) {
    onTzChange?.(val);
    showToast("Timezone saved");
  }

  const sectionStyle = {
    background:C.panel, border:`1px solid ${C.border}`, borderRadius:10,
    padding:"16px 20px", marginBottom:16,
  };
  const labelStyle = { fontSize:12, color:C.muted, fontWeight:600, marginBottom:6, display:"block", textTransform:"uppercase", letterSpacing:"0.05em" };

  return (
    <div style={{maxWidth:520}}>
      <h1 style={{fontFamily:"var(--c-font-display)",fontSize:26,color:C.accent,letterSpacing:1,marginBottom:20}}>
        Settings
      </h1>

      {/* Profile */}
      <div style={sectionStyle}>
        <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:14}}>Profile</h2>
        <label style={labelStyle}>Display name</label>
        <div style={{fontSize:14,color:C.muted,padding:"8px 10px",background:C.panel2,borderRadius:6,marginBottom:12}}>
          {user?.name}
        </div>
        <label style={labelStyle}>Email</label>
        <div style={{fontSize:14,color:C.muted,padding:"8px 10px",background:C.panel2,borderRadius:6,marginBottom:12}}>
          {user?.email}
        </div>
        <label style={labelStyle}>Phone</label>
        <div style={{fontSize:14,color:C.muted,padding:"8px 10px",background:C.panel2,borderRadius:6}}>
          {user?.phone || <span style={{color:C.border,fontStyle:"italic"}}>not provided</span>}
        </div>
      </div>

      {/* Timezone */}
      <div style={sectionStyle}>
        <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:14}}>Timezone</h2>
        <label style={labelStyle}>Match times shown in</label>
        <select value={tz} onChange={e=>saveTz(e.target.value)}
          style={{...inputStyle,marginBottom:0,cursor:"pointer"}}>
          {TIMEZONES.map(t=>(
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {/* Live preview — pick the first upcoming (or first overall) match */}
        {(() => {
          const sample = matches.find(m => !results[m.n]) || matches[0];
          if (!sample) return null;
          const k = kickoffParts(sample.t, tz);
          if (!k) return null;
          return (
            <div style={{marginTop:10,padding:"8px 12px",background:C.bg,
              border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,
              display:"flex",alignItems:"center",gap:8}}>
              <span style={{color:C.muted,fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Preview</span>
              <span style={{color:C.text}}>{flag(sample.a)} {sample.a} vs {sample.b} {flag(sample.b)}</span>
              <span style={{marginLeft:"auto",fontWeight:700,color:C.accent,fontVariantNumeric:"tabular-nums"}}>
                {k.short} · {k.time}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Leaderboard preferences */}
      <div style={sectionStyle}>
        <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:14}}>Leaderboard</h2>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,cursor:"pointer"}}
          onClick={onLivePredsChange}>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:C.text}}>Match picks column open by default</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3,lineHeight:1.5}}>
              Show everyone's predictions for the selected game when you open the leaderboard.
            </div>
          </div>
          <div style={{
            width:36,height:20,borderRadius:999,flexShrink:0,position:"relative",transition:"all .15s",
            background:showLivePreds?"rgba(163,230,53,0.25)":C.panel2,
            border:`1px solid ${showLivePreds?C.accent:C.border}`}}>
            <div style={{
              position:"absolute",top:2,width:16,height:16,borderRadius:999,transition:"all .15s",
              left:showLivePreds?16:2,background:showLivePreds?C.accent:C.muted}}/>
          </div>
        </div>
      </div>

      {/* Help & onboarding — everyone */}
      {!user?.is_admin && onResetOnboarding && (
        <div style={sectionStyle}>
          <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:4}}>Help &amp; onboarding</h2>
          <p style={{fontSize:13,color:C.muted,marginBottom:12}}>
            Tap the <b style={{color:C.accent}}>ⓘ</b> button in the top nav anytime to see the help for the current tab.
            Reset below to walk through the first-time tips again.
          </p>
          <button
            onClick={()=>{
              onResetOnboarding();
              showToast("Onboarding reset — tips will show again");
            }}
            style={{background:"transparent",border:`1px solid ${C.border}`,color:C.text,
              padding:"6px 14px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600}}>
            Reset onboarding
          </button>
        </div>
      )}

      {/* Data source — admin only */}
      {user?.is_admin&&(
        <div style={sectionStyle}>
          <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:4}}>Data source</h2>
          <p style={{fontSize:13,color:C.muted,marginBottom:12}}>How match results are entered.</p>
          {[
            {
              value:"manual",
              label:"Manual entry",
              desc:"Admin starts each match, edits the live score and ends it manually.",
            },
            {
              value:"realtime",
              label:"Realtime data feed",
              desc:<>Matches move to LIVE and to FINAL automatically — no admin action needed.<br/><em style={{color:C.muted}}>In production this syncs live scores from football-data.org; in the demo it's simulated (auto-progresses every 4 seconds).</em></>,
            },
          ].map((opt,i)=>(
            <label key={opt.value} style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer",marginBottom:i===0?12:0}}>
              <input type="radio" name="data_source" value={opt.value}
                checked={(config?.data_source||"manual")===opt.value}
                onChange={async()=>{
                  try{
                    const cfg=await api.updateConfig({data_source:opt.value});
                    setConfig(cfg);
                  }catch(e){showToast(e.message,"err");}
                }}
                style={{marginTop:3,accentColor:C.accent,flexShrink:0}}
              />
              <div>
                <div style={{fontWeight:700,color:C.text,fontSize:14}}>{opt.label}</div>
                <div style={{color:C.muted,fontSize:12,marginTop:2,lineHeight:1.5}}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      {/* Demo variant switcher — only visible in demo mode */}
      {demoVariantApi.get() && (
        <div style={sectionStyle}>
          <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>Demo</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:14,marginTop:0}}>
            Switch between two preset demos. Each one keeps its own state — what
            you do in one doesn't affect the other. The page will reload.
          </p>
          {(() => {
            const current = demoVariantApi.get();
            const Btn2 = ({value, title, desc}) => {
              const active = current === value;
              return (
                <button onClick={()=>active||demoVariantApi.set(value)}
                  style={{
                    flex:1,minWidth:200,textAlign:"left",cursor:active?"default":"pointer",
                    padding:"12px 14px",borderRadius:8,
                    background:active?"rgba(163,230,53,0.10)":C.panel,
                    border:`1px solid ${active?C.accent:C.border}`,
                    borderLeftWidth:3,borderLeftColor:active?C.accent:"transparent",
                    color:C.text,fontSize:13,display:"flex",flexDirection:"column",gap:2,
                  }}>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontWeight:active?700:600}}>
                    <span style={{color:active?C.accent:C.text}}>{title}</span>
                    {active && <span style={{fontSize:10,color:C.accent,fontWeight:700,padding:"1px 7px",borderRadius:999,border:`1px solid ${C.accent}`}}>ACTIVE</span>}
                  </div>
                  <div style={{fontSize:11,color:C.muted}}>{desc}</div>
                </button>
              );
            };
            return (
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <Btn2 value="current" title="Mid-tournament" desc="Group stage done · R32 in progress · 12 submitted forms"/>
                <Btn2 value="fresh"   title="Fresh start"     desc="Round open · no results · no forms yet · stage 1 ready"/>
              </div>
            );
          })()}
        </div>
      )}

      {/* Testing tools — admin-only */}
      {user?.is_admin && (
        <div style={sectionStyle}>
          <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>🧪 Testing tools</h2>
          <p style={{margin:"0 0 16px",fontSize:13,color:C.muted}}>
            Admin-only helpers for driving the tournament end-to-end.
            Destructive actions require double confirmation.
          </p>

          {/* ── Force set stage ── */}
          <div style={{marginBottom:18}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:700,
              textTransform:"uppercase",letterSpacing:"0.06em"}}>
              Force set stage
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {STAGES.map(s=>{
                const cur = config?.current_stage || 1;
                const isActive = s.n === cur;
                return (
                  <button key={s.n} onClick={async()=>{
                    if(isActive)return;
                    const ok=await confirmDialog({
                      title:`Force stage ${s.n} — ${s.name}?`,
                      message:`Overrides normal progression. Users will see Stage ${s.n} as the active stage regardless of results entered.`,
                      confirmLabel:`Set Stage ${s.n}`,
                      danger:true,
                    });
                    if(!ok)return;
                    try{
                      const cfg=await api.updateConfig({current_stage:s.n});
                      setConfig(cfg);
                      showToast(`Stage set to ${s.n} — ${s.name}`);
                    }catch(e){showToast(e.message,"err");}
                  }}
                  style={{
                    padding:"4px 12px",borderRadius:6,fontSize:12,fontWeight:600,
                    cursor:isActive?"default":"pointer",
                    border:`1px solid ${isActive?C.accent:C.border}`,
                    background:isActive?"rgba(163,230,53,0.12)":C.panel2,
                    color:isActive?C.accent:C.muted,
                    transition:"all .15s",
                  }}>
                    {isActive?"▶ ":""}{s.n}. {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Random-fill results ── */}
          <div style={{marginBottom:18}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:700,
              textTransform:"uppercase",letterSpacing:"0.06em"}}>
              Random-fill results
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {STAGES.map(s => {
                const stageMatches = matches.filter(m => m.n >= s.first && m.n <= s.last);
                if (stageMatches.length === 0) return null;
                const empty = stageMatches.filter(m => !results[m.n] && !liveMatches[m.n]).length;
                const disabled = empty === 0;
                return (
                  <button key={s.n}
                    onClick={async () => {
                      if (disabled) return;
                      const ok = await confirmDialog({
                        title: `Random-fill Stage ${s.n}?`,
                        message: `Fill ${empty} match${empty===1?"":"es"} in ${s.name} with random scores (0–3 each side) as FINAL results.`
                          + (s.n >= 2 ? " Draws are settled by random extra-time or penalties so every match has a winner." : ""),
                        confirmLabel: "Fill randomly",
                        danger: false,
                      });
                      if (!ok) return;
                      const rand = () => Math.floor(Math.random() * 4);
                      const isKO = s.n >= 2;  // stage 2+ must produce a winner
                      let filled = 0;
                      for (const m of stageMatches) {
                        if (results[m.n] || liveMatches[m.n]) continue;
                        const sa = rand(), sb = rand();
                        const payload = {score_a: sa, score_b: sb};
                        // Knockout draw at 90' → decide via extra time or penalties
                        if (isKO && sa === sb) {
                          if (Math.random() < 0.5) {
                            // Settled in extra time — one side nets 1–2 more
                            const extra = 1 + Math.floor(Math.random() * 2);
                            if (Math.random() < 0.5) { payload.et_a = sa + extra; payload.et_b = sb; }
                            else                     { payload.et_a = sa; payload.et_b = sb + extra; }
                          } else {
                            // Still level after ET → penalty shootout
                            payload.et_a = sa; payload.et_b = sb;
                            let pa = 3 + Math.floor(Math.random() * 3);  // 3–5
                            let pb = 3 + Math.floor(Math.random() * 3);
                            if (pa === pb) { Math.random() < 0.5 ? pa++ : pb++; }
                            payload.pen_a = pa; payload.pen_b = pb;
                          }
                        }
                        try {
                          await api.setResult(m.n, payload);
                          const w = deriveWinner(payload.score_a, payload.score_b, payload.et_a, payload.et_b, payload.pen_a, payload.pen_b);
                          setResults?.(r => ({...r, [m.n]: [payload.score_a, payload.score_b, w, payload.et_a??null, payload.et_b??null, payload.pen_a??null, payload.pen_b??null]}));
                          filled++;
                        } catch(e) { console.error("random-fill", m.n, e); }
                      }
                      if (typeof refreshLive === "function") await refreshLive();
                      if (typeof refreshLb === "function") await refreshLb();
                      showToast(`Random-filled ${filled} match${filled===1?"":"es"} 🎲`);
                    }}
                    disabled={disabled}
                    title={disabled ? "Stage already fully resulted" : `Random-fill ${empty} remaining`}
                    style={{
                      padding:"6px 12px",borderRadius:6,fontSize:12,fontWeight:600,
                      border:`1px solid ${disabled?C.border:C.accent}`,
                      background:disabled?"transparent":"rgba(163,230,53,0.10)",
                      color:disabled?C.muted:C.accent,
                      cursor:disabled?"not-allowed":"pointer",
                    }}>
                    🎲 Stage {s.n} <span style={{opacity:0.7,fontWeight:400}}>({empty} left)</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Danger zone ── */}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
            <div style={{fontSize:11,color:C.red,marginBottom:10,fontWeight:700,
              textTransform:"uppercase",letterSpacing:"0.06em"}}>
              ⚠️ Danger zone
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>

              {/* Reset results only */}
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <button
                  onClick={async () => {
                    const ok1 = await confirmDialog({
                      title: "Reset all admin-entered scores?",
                      message: "Wipes every final result and every live record. Predictions, entries, users, winner picks and config are untouched.",
                      confirmLabel: "Yes, continue",
                      danger: true,
                    });
                    if (!ok1) return;
                    const ok2 = await confirmDialog({
                      title: "Are you absolutely sure?",
                      message: "This cannot be undone. All match results and live scores will be permanently deleted.",
                      confirmLabel: "Delete all results",
                      danger: true,
                    });
                    if (!ok2) return;
                    try {
                      const r = await api.resetAllResults();
                      setResults?.({});
                      if (typeof refreshLive === "function") await refreshLive();
                      if (typeof refreshLb === "function") await refreshLb();
                      showToast(`Cleared ${r?.deleted?.results||0} results + ${r?.deleted?.live||0} live`);
                    } catch(e) { showToast(e.message, "err"); }
                  }}
                  style={{padding:"7px 14px",borderRadius:6,fontSize:12,fontWeight:700,
                    border:`1px solid ${C.red}`,background:"transparent",color:C.red,cursor:"pointer"}}>
                  🔄 Reset all results &amp; live
                </button>
                <span style={{fontSize:11,color:C.muted}}>Keeps all user accounts, entries and predictions.</span>
              </div>

              {/* Reset user data */}
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <button
                  onClick={async () => {
                    const sel = await resetPickerDialog({ mode:"user-data" });
                    if (!sel) return;
                    const scopeLabel =
                      sel.scope==="entry" ? "this form" :
                      sel.scope==="user"  ? "this user's data" :
                      "all user data";
                    const ok = await confirmDialog({
                      title: `Reset ${scopeLabel}?`,
                      message: sel.scope==="entry"
                        ? "This form's predictions and winner pick will be permanently deleted. The user account and other forms are untouched."
                        : sel.scope==="user"
                        ? "All entries, predictions and winner picks for this user will be permanently deleted. Their account stays intact."
                        : "All entries, predictions and winner picks for every participant will be permanently deleted. User accounts survive but config resets to idle / stage 1. There is no undo.",
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      const r = await api.resetUserData({
                        userId:  sel.userId,
                        entryId: sel.entryId,
                      });
                      if (sel.scope==="all") {
                        setResults?.({});
                        if (typeof refreshLive === "function") await refreshLive();
                      }
                      if (typeof refreshLb === "function") await refreshLb();
                      showToast(`Reset — ${r?.entries_deleted||0} form(s) deleted`);
                    } catch(e) { showToast(e.message, "err"); }
                  }}
                  style={{padding:"7px 14px",borderRadius:6,fontSize:12,fontWeight:700,
                    border:`1px solid ${C.red}`,background:"transparent",color:C.red,cursor:"pointer"}}>
                  👤 Reset user data
                </button>
                <span style={{fontSize:11,color:C.muted}}>Removes entries &amp; predictions. User accounts survive.</span>
              </div>

              {/* Delete users */}
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <button
                  onClick={async () => {
                    const sel = await resetPickerDialog({ mode:"delete-user" });
                    if (!sel) return;
                    const scopeLabel =
                      sel.scope==="user" ? "this user" : "all users";
                    const ok = await confirmDialog({
                      title: `Delete ${scopeLabel}?`,
                      message: sel.scope==="user"
                        ? "This user's account and ALL their data (entries, predictions, winner picks) will be permanently deleted. There is no undo."
                        : "Every non-admin user account and ALL their data will be permanently deleted. Results and live scores are also wiped. Config resets to idle / stage 1. Admin accounts survive. There is absolutely no undo.",
                      confirmLabel: sel.scope==="user" ? "Delete user" : "☢️ Wipe everything",
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      const r = await api.resetFullSystem({ userId: sel.userId });
                      if (sel.scope==="all") {
                        setResults?.({});
                        if (typeof refreshLive === "function") await refreshLive();
                      }
                      if (typeof refreshLb === "function") await refreshLb();
                      showToast(sel.scope==="user"
                        ? "User deleted"
                        : `System reset — ${r?.users_deleted||0} users removed`);
                    } catch(e) { showToast(e.message, "err"); }
                  }}
                  style={{padding:"7px 14px",borderRadius:6,fontSize:12,fontWeight:700,
                    border:`1px solid ${C.red}`,background:C.red,color:"#fff",cursor:"pointer"}}>
                  ☢️ Delete users
                </button>
                <span style={{fontSize:11,color:C.muted}}>Deletes user account(s) entirely. Admin accounts survive.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backup & restore — admin-only */}
      {user?.is_admin && (
        <div style={sectionStyle}>
          <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>💾 Backup &amp; restore</h2>
          <p style={{margin:"0 0 16px",fontSize:13,color:C.muted}}>
            Download a full snapshot of everything — users, forms, predictions, results,
            winner picks and game settings — as a single JSON file, or restore one to roll
            the whole game back to that point.
          </p>

          {/* Download backup */}
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:12}}>
            <button
              onClick={async () => {
                try {
                  const backup = await api.adminBackup();
                  const d = new Date();
                  const pad = (n) => String(n).padStart(2, "0");
                  const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
                  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"});
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `mondobet-backup-${stamp}.json`;
                  document.body.appendChild(a); a.click(); a.remove();
                  URL.revokeObjectURL(url);
                  const c = backup.counts || {};
                  showToast(`Backup downloaded — ${c.users||0} users, ${c.entries||0} forms`);
                } catch(e) { showToast(e.message, "err"); }
              }}
              style={{padding:"7px 14px",borderRadius:6,fontSize:12,fontWeight:700,
                border:`1px solid ${C.accent}`,background:"rgba(163,230,53,0.10)",color:C.accent,cursor:"pointer"}}>
              ⬇️ Download backup
            </button>
            <span style={{fontSize:11,color:C.muted}}>Saves a timestamped <code>.json</code> file to your device. Contains all game data — keep it private.</span>
          </div>

          {/* Restore backup */}
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <label
              style={{padding:"7px 14px",borderRadius:6,fontSize:12,fontWeight:700,
                border:`1px solid ${C.red}`,background:"transparent",color:C.red,cursor:"pointer",
                display:"inline-block"}}>
              ⬆️ Restore from file…
              <input type="file" accept=".json,application/json" style={{display:"none"}}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";  // allow re-picking the same file later
                  if (!file) return;
                  let payload;
                  try { payload = JSON.parse(await file.text()); }
                  catch { showToast("Couldn't read that file as JSON", "err"); return; }
                  if (!payload || payload.version !== 1 || !payload.counts) {
                    showToast("That doesn't look like a MondoBet backup", "err"); return;
                  }
                  const c = payload.counts || {};
                  const when = payload.created_at ? new Date(payload.created_at).toLocaleString() : "an unknown date";
                  const ok1 = await confirmDialog({
                    title: "Restore this backup?",
                    message: `Backup from ${when} — ${c.users||0} users · ${c.entries||0} forms · ${c.predictions||0} predictions · ${c.results||0} results · ${c.winner_picks||0} winner picks. Restoring REPLACES all current data with this snapshot.`,
                    confirmLabel: "Continue",
                    danger: true,
                  });
                  if (!ok1) return;
                  const ok2 = await confirmDialog({
                    title: "Are you absolutely sure?",
                    message: "Every current user, form, prediction, result and setting will be permanently overwritten by this backup. This cannot be undone. Your admin login is preserved.",
                    confirmLabel: "Overwrite everything",
                    danger: true,
                  });
                  if (!ok2) return;
                  try {
                    await api.adminRestore(payload);
                    showToast("Backup restored — reloading…");
                    setTimeout(() => window.location.reload(), 900);
                  } catch(err) { showToast(err.message, "err"); }
                }} />
            </label>
            <span style={{fontSize:11,color:C.muted}}>Replaces <b>all</b> current data with the file's snapshot. You'll confirm twice first.</span>
          </div>
        </div>
      )}

      {/* Account */}
      <div style={sectionStyle}>
        <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:14}}>Account</h2>
        <Btn red onClick={onLogout}>Log out</Btn>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// COMPARE VIEW — shown in place of the leaderboard table when a form is clicked.
// Side-by-side: your pick + pts | match + result | their pick + pts, per match.
// ─────────────────────────────────────────────────────────────────────────────
function CompareView({ matches, results, liveMatches, isMobile,
                       myName, myPreds, myTotal, myRank, myWinner,
                       myForms=[], myKey, onMyPick,
                       theirKey, theirName, theirPreds, theirTotal, theirRank, theirWinner, winnersRevealed,
                       forms, loading, onBack, onPick, tz }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [myMenuOpen, setMyMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const [showTop, setShowTop] = useState(false);
  const [liveInView, setLiveInView] = useState(false);
  const [latestInView, setLatestInView] = useState(false);
  const liveRef = useRef(null);
  const latestRef = useRef(null);
  // Show a floating "↑ Top" once the user has scrolled down (the auto-scroll to
  // the live match can leave them deep in the list). Also track whether the live
  // (or, with no live game, the latest-finished) row is on-screen, so the jump
  // button can hide once we're on it.
  useEffect(() => {
    const inView = (el) => !!el && (() => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })();
    const onScroll = () => {
      setShowTop(window.scrollY > 400);
      setLiveInView(inView(liveRef.current));
      setLatestInView(inView(latestRef.current));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const h = () => setMenuOpen(false);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menuOpen]);
  useEffect(() => {
    if (!myMenuOpen) return;
    const h = () => setMyMenuOpen(false);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [myMenuOpen]);
  useEffect(() => {
    if (menuOpen) { setSearch(""); setTimeout(() => searchRef.current?.focus(), 40); }
  }, [menuOpen]);
  // Auto-scroll to the live match once the compared form has loaded. The rows'
  // horizontal-scroll wrapper (overflow-x:auto) is also a vertical scroll
  // container, which eats scrollIntoView — so scroll the WINDOW to the row's
  // computed position instead.
  useEffect(() => {
    if (loading) return;
    // Re-center the live row a few times over ~1.2s. A single timed jump gets
    // clamped back to the top when the list height briefly shrinks (a follow-up
    // data refresh, or React's dev double-render). Re-asserting until the layout
    // settles is reliable; once the row is centered, each pass is a no-op.
    let n = 0;
    const id = setInterval(() => {
      const el = liveRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, r.top + window.scrollY - (window.innerHeight / 2) + (r.height / 2)), behavior: "auto" });
      }
      if (++n >= 8) clearInterval(id);
    }, 150);
    return () => clearInterval(id);
  }, [theirKey, loading]);

  const GREEN="#10b981", ORANGE="#f59e0b", RED="#ef4444";
  const palBg = (t) => t>=5?"rgba(16,185,129,0.14)":t===1?"rgba(245,158,11,0.14)":"rgba(239,68,68,0.14)";
  const palFg = (t) => t>=5?GREEN:t===1?ORANGE:RED;
  const boxBase = {fontFamily:"monospace",fontWeight:700,fontSize:14,padding:"3px 9px",borderRadius:5,whiteSpace:"nowrap"};
  const predBox = (pred, eff) => {
    if (pred?.[0]==null) return <span style={{...boxBase,background:C.bg,border:`1px solid ${C.border}`,color:C.muted}}>—</span>;
    if (!eff) return <span style={{...boxBase,background:C.bg,border:`1px solid ${C.border}`,color:C.text}}>{pred[0]}:{pred[1]}</span>;
    const sc=scorePrediction(pred,eff);
    return <span style={{...boxBase,background:palBg(sc.total),border:`1px solid ${palFg(sc.total)}`}}>
      <span style={{color:sc.aMatch?GREEN:RED}}>{pred[0]}</span>:<span style={{color:sc.bMatch?GREEN:RED}}>{pred[1]}</span></span>;
  };
  const ptsChip = (pred, eff) => {
    const sc=scorePrediction(pred,eff); if(!sc) return null;
    return <span style={{fontFamily:"monospace",fontWeight:700,fontSize:11,padding:"1px 6px",borderRadius:4,background:palBg(sc.total),border:`1px solid ${palFg(sc.total)}`,color:palFg(sc.total)}}>+{sc.total}</span>;
  };
  const resChip = (eff, live) => {
    if(!eff) return <span style={{fontFamily:"monospace",fontWeight:700,fontSize:11,padding:"1px 7px",borderRadius:4,background:C.panel2,border:`1px solid ${C.border}`,color:C.muted}}>— : —</span>;
    const isLive=!!(live&&live.is_live);
    return <span style={{fontFamily:"monospace",fontWeight:700,fontSize:11,padding:"1px 7px",borderRadius:4,whiteSpace:"nowrap",
      background:isLive?"rgba(239,68,68,0.10)":"rgba(48,209,88,0.14)",border:`1px solid ${isLive?"rgba(239,68,68,0.4)":"rgba(48,209,88,0.4)"}`,color:isLive?RED:GREEN}}>
      {isLive&&<span className="live-dot" style={{marginRight:4}}/>}{!isLive&&"✓ "}{eff[0]}:{eff[1]}{isLive&&<span style={{marginLeft:4,fontSize:10}}>{live.minute===45?"HT":`${live.minute}′`}</span>}</span>;
  };

  const displayMatches = matches
    .filter(m => myPreds[m.n]?.[0]!=null || theirPreds[m.n]?.[0]!=null || results[m.n]!=null || liveMatches[m.n]!=null)
    .sort((a,b)=>{ const sa=matchStageObj(a.n).n,sb=matchStageObj(b.n).n; if(sa!==sb)return sa-sb; return a.t<b.t?-1:a.t>b.t?1:a.n-b.n; });
  const hasLive = displayMatches.some(m => liveMatches[m.n]?.is_live);
  // With no live game, the FAB instead jumps to the latest match that has a
  // score — the bottom-most played row in the (stage-then-kickoff sorted) list.
  let latestN = null;
  for (let i = displayMatches.length - 1; i >= 0; i--) {
    const m = displayMatches[i];
    if (effScoreOf(results[m.n], liveMatches[m.n])) { latestN = m.n; break; }
  }
  // Re-center a row in the viewport (the rows live in the window scroll,
  // matching the auto-scroll logic above).
  const scrollToRow = (el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, r.top + window.scrollY - (window.innerHeight / 2) + (r.height / 2)), behavior: "smooth" });
  };
  const scrollToLive = () => scrollToRow(liveRef.current);
  const scrollToLatest = () => scrollToRow(latestRef.current);
  const gap = myTotal - theirTotal;
  const tileBox={display:"inline-flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,minWidth:62,padding:"5px 12px",borderRadius:8,background:C.bg,border:`1px solid ${C.border}`};
  const tileLabel={fontSize:9,letterSpacing:".6px",textTransform:"uppercase",color:C.muted,fontWeight:700};
  const tileVal={fontSize:19,fontFamily:"monospace",fontWeight:800,lineHeight:1.15};
  const groupBox={display:"flex",alignItems:"stretch",gap:8,border:`1px solid ${C.border}`,borderRadius:10,padding:6,background:C.panel};
  // Fixed-width center column so every row's boxes line up (an auto/flex center
  // would size per-row and make the columns jitter). Long names wrap inside it.
  const GRID = "44px 1fr 210px 1fr 44px";

  let lastStage=null;
  const rowEls=[];
  displayMatches.forEach(m=>{
    const stg=matchStageObj(m.n);
    if(stg.n!==lastStage){ lastStage=stg.n; rowEls.push(<div key={"s"+stg.n} style={{color:C.indigo,fontWeight:700,fontSize:13,margin:"14px 0 6px",padding:"6px 10px",background:C.panel2,borderRadius:6}}>▸ {stg.name}</div>); }
    const eff=effScoreOf(results[m.n], liveMatches[m.n]);
    const live=liveMatches[m.n];
    const isLive=!!(live&&live.is_live);
    let ws=null; if(eff){ if(eff[0]>eff[1])ws=0; else if(eff[1]>eff[0])ws=1; else if(eff[2]==='a')ws=0; else if(eff[2]==='b')ws=1; }
    const rowBg = isLive?"rgba(239,68,68,0.05)":C.panel;
    const rowBorder = `1px solid ${isLive?"rgba(239,68,68,0.55)":C.border}`;
    const teams = (
      <span style={{fontSize:11,whiteSpace:"normal",textAlign:"center",lineHeight:1.3}}>
        <span style={{color:ws===0?C.accent:C.text,fontWeight:ws===0?700:400}}>{flag(m.a)} {m.a}</span>
        <span style={{color:C.muted}}> v </span>
        <span style={{color:ws===1?C.accent:C.text,fontWeight:ws===1?700:400}}>{m.b} {flag(m.b)}</span>
      </span>
    );
    const cmpKo = !eff ? kickoffParts(m.t, tz) : null;
    rowEls.push(isMobile ? (
      // Mobile: two lines — match + result on top, your pick vs their pick below.
      <div key={m.n} ref={isLive?liveRef:(m.n===latestN?latestRef:undefined)} style={{background:rowBg,border:rowBorder,borderRadius:7,padding:"7px 10px",marginBottom:5}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,marginBottom:6}}>{teams}{resChip(eff,live)}</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:6}}>{ptsChip(myPreds[m.n],eff)}{predBox(myPreds[m.n],eff)}</span>
          <span style={{display:"inline-flex",alignItems:"center",gap:6}}>{predBox(theirPreds[m.n],eff)}{ptsChip(theirPreds[m.n],eff)}</span>
        </div>
        {cmpKo && <div style={{fontSize:10,color:C.muted,textAlign:"center",marginTop:5,paddingTop:5,borderTop:`1px solid ${C.border}`}}>
          <span style={{fontWeight:700,color:C.text}}>{cmpKo.time}</span> · {cmpKo.md}
        </div>}
      </div>
    ) : (
      <div key={m.n} ref={isLive?liveRef:(m.n===latestN?latestRef:undefined)} style={{display:"grid",gridTemplateColumns:GRID,alignItems:"center",gap:6,
        background:rowBg,border:rowBorder,borderRadius:7,padding:"6px 8px",marginBottom:4}}>
        <span style={{textAlign:"right"}}>{ptsChip(myPreds[m.n],eff)}</span>
        <span style={{display:"flex",justifyContent:"flex-end"}}>{predBox(myPreds[m.n],eff)}</span>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:0}}>
          {teams}
          {resChip(eff,live)}
          {cmpKo && <span style={{fontSize:10,color:C.muted,whiteSpace:"nowrap"}}>
            <span style={{fontWeight:700,color:C.text}}>{cmpKo.time}</span> · {cmpKo.md}
          </span>}
        </div>
        <span style={{display:"flex",justifyContent:"flex-start"}}>{predBox(theirPreds[m.n],eff)}</span>
        <span style={{textAlign:"left"}}>{ptsChip(theirPreds[m.n],eff)}</span>
      </div>
    ));
  });

  // Header sub-blocks (composed differently for desktop vs mobile).
  const youNameBlk = myForms.length > 1 ? (
    <div style={{position:"relative"}}>
      <button onClick={(e)=>{e.stopPropagation();setMyMenuOpen(o=>!o);}} title="Switch your form"
        style={{display:"inline-flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,
          minWidth:120,maxWidth:220,height:"100%",padding:"5px 12px",borderRadius:8,
          background:C.bg,border:`1px solid ${C.indigo}`,fontFamily:"inherit",cursor:"pointer"}}>
        <span style={tileLabel}>Your form</span>
        <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:15,fontWeight:700,color:C.indigo,whiteSpace:"nowrap",maxWidth:200,overflow:"hidden"}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{myName}</span>
          <span style={{fontSize:8,opacity:.7,transition:"transform .2s",transform:myMenuOpen?"rotate(180deg)":"none"}}>▾</span>
        </span>
        <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200,marginTop:1}}>🏆 {myWinner?withFlag(myWinner):"—"}</span>
      </button>
      {myMenuOpen&&(
        <div onClick={e=>e.stopPropagation()}
          style={{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:200,background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",zIndex:40,overflow:"hidden",padding:4}}>
          {myForms.map(f=>{
            const isActive=f.key===myKey;
            return (
              <div key={f.key} onClick={()=>{onMyPick(f.key);setMyMenuOpen(false);}}
                style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",cursor:"pointer",borderRadius:6,
                  background:isActive?"rgba(99,102,241,0.15)":"transparent",transition:"background .1s"}}
                onMouseEnter={e=>{if(!isActive)e.currentTarget.style.background=C.panel2;}}
                onMouseLeave={e=>{if(!isActive)e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:14,color:C.indigo,width:16,flexShrink:0}}>{isActive?"✓":""}</span>
                <span style={{fontSize:13,fontWeight:600,color:C.text,flex:1}}>{f.name}</span>
                <span style={{fontSize:11,color:C.muted,fontFamily:"monospace"}}>#{f.rank}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  ) : (
    <div style={{display:"inline-flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,padding:"5px 12px",minWidth:110,maxWidth:200}}>
      <span style={tileLabel}>Your form</span>
      <span style={{fontSize:15,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:180}}>{myName}</span>
      <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:180,marginTop:1}}>🏆 {myWinner?withFlag(myWinner):"—"}</span>
    </div>
  );
  const youRankTile  = <div style={tileBox}><span style={tileLabel}>Rank</span><b style={{...tileVal,color:C.text}}>{myRank?`#${myRank}`:"—"}</b></div>;
  const youPtsTile   = <div style={tileBox}><span style={tileLabel}>Points</span><b style={{...tileVal,color:C.accent}}>{myTotal}</b></div>;
  const theirRankTile= <div style={tileBox}><span style={tileLabel}>Rank</span><b style={{...tileVal,color:C.text}}>{theirRank?`#${theirRank}`:"—"}</b></div>;
  const theirPtsTile = <div style={tileBox}><span style={tileLabel}>Points</span><b style={{...tileVal,color:gap<0?C.green:C.accent}}>{theirTotal}</b></div>;
  const gapBlock = (
    <div style={{display:"flex",flexDirection:isMobile?"row":"column",alignItems:"center",justifyContent:"center",gap:isMobile?8:0,minWidth:56}}>
      <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".4px",color:C.muted}}>gap</span>
      <b style={{fontSize:isMobile?18:22,fontFamily:"monospace",lineHeight:1.1,color:gap>0?C.green:gap<0?C.red:C.muted}}>{gap>0?`+${gap}`:gap}</b>
    </div>
  );
  const theirPicker = (
    <div style={{position:"relative"}}>
      <button onClick={(e)=>{e.stopPropagation();setMenuOpen(o=>!o);}} title="Change the form to compare" style={{
        display:"inline-flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,minWidth:120,maxWidth:220,height:"100%",
        padding:"5px 12px",borderRadius:8,background:C.bg,border:`1px solid ${C.accent}`,fontFamily:"inherit",cursor:"pointer"}}>
        <span style={tileLabel}>Compare to</span>
        <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:15,fontWeight:700,color:C.accent,whiteSpace:"nowrap",maxWidth:200,overflow:"hidden"}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{theirName}</span>
          <span style={{fontSize:8,opacity:.7,transition:"transform .2s",transform:menuOpen?"rotate(180deg)":"none"}}>▾</span>
        </span>
        <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200,marginTop:1}}>{winnersRevealed ? <>🏆 {theirWinner?withFlag(theirWinner):"—"}</> : "🔒 champion hidden"}</span>
      </button>
      {menuOpen&&(
        <div onClick={e=>e.stopPropagation()}
          style={{position:"absolute",top:"calc(100% + 4px)",left:isMobile?0:"auto",right:isMobile?"auto":0,minWidth:220,maxWidth:"calc(100vw - 28px)",background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",zIndex:40,overflow:"hidden"}}>
          {/* Search row */}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:`1px solid ${C.border}`}}>
            <span style={{color:C.muted,fontSize:13,flexShrink:0}}>🔍</span>
            <input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search forms…"
              style={{border:"none",outline:"none",background:"transparent",fontSize:13,color:C.text,flex:1,fontFamily:"inherit"}}/>
            {search&&(
              <button onClick={()=>setSearch("")} style={{background:"none",border:0,color:C.muted,cursor:"pointer",fontSize:13,padding:0,fontFamily:"inherit"}}>✕</button>
            )}
          </div>
          {/* List */}
          <div style={{maxHeight:260,overflowY:"auto",padding:4}}>
            {(()=>{
              const filtered = forms.filter(f=>f.name.toLowerCase().includes(search.toLowerCase()));
              if(filtered.length===0) return <div style={{padding:16,textAlign:"center",color:C.muted,fontSize:13}}>No forms found</div>;
              return filtered.map((f,i)=>{
                const origIdx = forms.indexOf(f);
                const showDivider = !search && origIdx>0 && forms[origIdx-1].fav && !f.fav;
                return (
                <Fragment key={f.key}>
                  {showDivider && <div style={{height:1,background:C.border,margin:"4px 6px"}}/>}
                  <div onClick={()=>{setMenuOpen(false);onPick(f.key);}}
                    style={{padding:"8px 10px",borderRadius:6,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:8,
                      background:f.key===theirKey?"rgba(163,230,53,0.08)":"transparent",
                      color:f.key===theirKey?C.accent:C.text,fontWeight:f.key===theirKey?700:400,
                      transition:"background .1s"}}>
                    <span style={{width:12,flexShrink:0,color:"#facc15",fontSize:12}}>{f.fav?"★":""}</span>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",flex:1}}>{f.name}</span>
                    <span style={{color:C.muted,fontFamily:"monospace",fontSize:11}}>#{f.rank}</span>
                  </div>
                </Fragment>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
        <button onClick={onBack} style={{
          display:"inline-flex",alignItems:"center",gap:7,fontFamily:"inherit",cursor:"pointer",
          fontSize:13.5,fontWeight:700,color:C.accent,background:"rgba(163,230,53,0.10)",
          border:`1px solid ${C.accent}`,borderRadius:8,padding:"9px 18px",whiteSpace:"nowrap"}}>
          <span style={{fontSize:16,lineHeight:1}}>←</span> Back to leaderboard
        </button>
        <span style={{flex:1}}/>
      </div>
      {/* Scoreboard — desktop: mirrored & centered 3-col (names on the outer
          edges, rank/points toward the gap). Mobile: the two forms stacked, the
          gap inline between them. */}
      {isMobile ? (
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
          <div style={{...groupBox,justifyContent:"space-between"}}>{youNameBlk}{youRankTile}{youPtsTile}</div>
          {gapBlock}
          <div style={{...groupBox,justifyContent:"space-between"}}>{theirPicker}{theirRankTile}{theirPtsTile}</div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:10,alignItems:"stretch",marginBottom:10}}>
          <div style={{...groupBox,justifyContent:"center"}}>{youNameBlk}{youRankTile}{youPtsTile}</div>
          {gapBlock}
          <div style={{...groupBox,justifyContent:"center"}}>{theirPtsTile}{theirRankTile}{theirPicker}</div>
        </div>
      )}
      {(() => {
        const body = (
          <div style={{opacity:loading?0.5:1,transition:"opacity .2s"}}>
            {loading && <div style={{textAlign:"center",padding:16,color:C.muted,fontSize:13}}>Loading predictions…</div>}
            {!loading && displayMatches.length===0 && <div style={{textAlign:"center",padding:24,color:C.muted,fontSize:13}}>No comparable matches yet — check back once games kick off.</div>}
            {!loading && rowEls}
          </div>
        );
        if (isMobile) return (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",padding:"0 10px",marginBottom:6,fontSize:10,textTransform:"uppercase",letterSpacing:".4px",color:C.muted,fontWeight:700}}>
              <span>Your pick · pts</span><span>pts · their pick</span>
            </div>
            {body}
          </div>
        );
        return (
          <div style={{overflowX:"auto"}}>
            <div style={{minWidth:520}}>
              <div style={{display:"grid",gridTemplateColumns:GRID,gap:6,padding:"0 8px",marginBottom:6,fontSize:10,textTransform:"uppercase",letterSpacing:".4px",color:C.muted,fontWeight:700}}>
                <span style={{gridColumn:"1 / 3",textAlign:"right"}}>Your pick · pts</span>
                <span style={{gridColumn:"3",textAlign:"center"}}>Match · result</span>
                <span style={{gridColumn:"4 / 6",textAlign:"left"}}>pts · their pick</span>
              </div>
              {body}
            </div>
          </div>
        );
      })()}
      {/* Floating FABs — jump to the live match, and scroll to top. Matches the
          leaderboard FAB style. */}
      <div style={{position:"fixed",bottom:20,right:18,zIndex:200,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
        {(() => {
          // Live game → jump to the live row. None live → jump to the latest
          // played row. Hide once that row is on-screen (or nothing's started).
          const showJump = hasLive ? !liveInView : (latestN!=null && !latestInView);
          return (
            <div style={{pointerEvents:showJump?"auto":"none",opacity:showJump?1:0,
              transform:showJump?"translateY(0)":"translateY(10px)",transition:"opacity .22s,transform .22s"}}>
              <div onClick={hasLive?scrollToLive:scrollToLatest}
                style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,cursor:"pointer",
                  borderRadius:22,padding:"8px 14px",boxShadow:"0 4px 18px rgba(0,0,0,.55)",
                  background:C.panel2,border:`1px solid ${C.border}`,color:C.muted}}>
                {hasLive ? <><span className="live-dot"/> Live score</> : <>↓ Latest</>}
              </div>
            </div>
          );
        })()}
        <div style={{pointerEvents:showTop?"auto":"none",opacity:showTop?1:0,
          transform:showTop?"translateY(0)":"translateY(10px)",transition:"opacity .22s,transform .22s"}}>
          <div onClick={()=>window.scrollTo({top:0,behavior:"smooth"})}
            style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,cursor:"pointer",
              borderRadius:22,padding:"8px 14px",boxShadow:"0 4px 18px rgba(0,0,0,.55)",
              background:C.panel2,border:`1px solid ${C.border}`,color:C.muted}}>
            ↑ Top
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [isDark,setIsDark]=useState(()=>{const s=localStorage.getItem("wc2026_theme");return s===null?true:s==="dark";});
  function toggleTheme(){setIsDark(d=>{const n=!d;localStorage.setItem("wc2026_theme",n?"dark":"light");return n;});}

  // Hydrate the signed-in user from a cached copy so a refresh renders the app
  // (and the Today's Games panel) IMMEDIATELY instead of showing a full-screen
  // "Loading…" for the entire api.me() round-trip — which on a serverless cold
  // start can be ~10s. We still validate/refresh the session in the background.
  const _cachedUser = (()=>{ try{ return getToken() ? JSON.parse(localStorage.getItem("mb_user")||"null") : null; }catch{ return null; } })();
  const [user,setUser]=useState(_cachedUser);
  const [authLoading,setAuthLoading]=useState(()=> getToken() ? !_cachedUser : false);
  const [tab,setTab]=useState("auth");
  const [matches,setMatches]=useState([]);
  const [teams,setTeams]=useState([]);
  // Hydrate config from cache too, so the default-tab pick (and round state) is
  // right on first paint instead of defaulting to "idle" until /api/config loads.
  const [config,setConfig]=useState(()=>{
    try{ const c=JSON.parse(localStorage.getItem("mb_config")||"null"); if(c&&c.round_state) return c; }catch{}
    return {round_state:"idle",tournament_winner:null,data_source:"manual",current_stage:1};
  });
  const [myPreds,setMyPreds]=useState({});
  const [myWinner,setMyWinner]=useState(null);
  // Batched prediction auto-save: edits buffer here and flush as ONE bulk write
  // ~500ms after the last change, so rapid box-to-box edits don't fire a save
  // per box. (Refs live in App so they survive MyPredictions' inline re-render.)
  const predSaveBuf   = useRef({});     // {match_n: {score_a, score_b}}
  const predSaveEntry = useRef(null);   // entry the buffered edits belong to
  const predSaveTimer = useRef(null);
  // Last PERSISTED prediction values for the active form, {match_n: [a,b]}.
  // Only advanced on a real save/load — never on optimistic typing — so the
  // flush can drop no-op edits (focus+blur, or change-then-change-back).
  const predBaseline  = useRef({});
  const [results,setResults]=useState({});
  const [leaderboard,setLeaderboard]=useState([]);
  const [rankSnapshots,setRankSnapshots]=useState({});
  const [participants,setParticipants]=useState([]);
  const [adminParticipants,setAdminParticipants]=useState([]);
  const [entries,setEntries]=useState([]);
  const [activeEntryId,setActiveEntryId]=useState(null);
  const [lockedWinner,setLockedWinner]=useState(null);
  // The 10s poll's effect deps don't include activeEntryId/lockedWinner, so the
  // long-lived interval closes over stale values. refreshLb() reads these refs
  // instead, so it always syncs the winner pick against the CURRENT active form
  // (otherwise a newly-created empty form gets the previous form's champion).
  const activeEntryIdRef = useRef(activeEntryId); activeEntryIdRef.current = activeEntryId;
  const lockedWinnerRef  = useRef(lockedWinner);  lockedWinnerRef.current  = lockedWinner;
  // In-place form comparison (replaces the old By-participant tab). compareKey
  // is the entry_id|user_id of the form being compared against the active form.
  const [compareKey,setCompareKey]=useState(null);
  const [comparePreds,setComparePreds]=useState({});
  const [compareWinner,setCompareWinner]=useState(null);
  const [compareLoading,setCompareLoading]=useState(false);
  // Fetch the compared form's predictions. The backend restricts non-admins to
  // the other form's picks on matches that have a result or are live (privacy).
  useEffect(()=>{
    if(!compareKey){ setComparePreds({}); setCompareWinner(null); return; }
    const lbEntry=leaderboard.find(e=>(e.entry_id||e.user_id)===compareKey);
    if(!lbEntry) return;
    setCompareLoading(true);
    api.getUserPredictions(lbEntry.user_id, lbEntry.entry_id||null)
      .then(preds=>{ const m={}; for(const p of preds) m[p.match_n]=[p.score_a,p.score_b]; setComparePreds(m); setCompareWinner(lbEntry.winner_pick||null); })
      .catch(e=>showToast(e.message,"err"))
      .finally(()=>setCompareLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[compareKey]);
  // "My form" picker inside compare view — lets multi-entry users switch which
  // of their forms is shown on the left side.
  const [compareMyKey,setCompareMyKey]=useState(null); // null = use active entry
  const [compareMyPreds,setCompareMyPreds]=useState(null); // null = use myPreds
  const [compareMyWinner,setCompareMyWinner]=useState(null);
  useEffect(()=>{
    if(!compareMyKey){ setCompareMyPreds(null); setCompareMyWinner(null); return; }
    const lbEntry=leaderboard.find(e=>(e.entry_id||e.user_id)===compareMyKey);
    if(!lbEntry) return;
    api.getUserPredictions(lbEntry.user_id, lbEntry.entry_id||null)
      .then(preds=>{ const m={}; for(const p of preds) m[p.match_n]=[p.score_a,p.score_b]; setCompareMyPreds(m); setCompareMyWinner(lbEntry.winner_pick||null); })
      .catch(e=>showToast(e.message,"err"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[compareMyKey]);
  // Leave compare mode when navigating away from the leaderboard tab.
  useEffect(()=>{ if(tab!=="leaderboard"){ setCompareKey(null); setCompareMyKey(null); setMatchSimMode(false); setMatchSimA(""); setMatchSimB(""); } },[tab]);
  const [liveMatches,setLiveMatches]=useState({});
  const [predsLoaded,setPredsLoaded]=useState(false);
  // True once the leaderboard has resolved at least once, so the table can show
  // a loading state instead of the "No participants yet." empty state on first load.
  const [lbLoaded,setLbLoaded]=useState(false);
  const [toast,setToast]=useState(null);
  const [globalErr,setGlobalErr]=useState("");
  const toastTimer=useRef(null);

  // ── Predictions-tab UI state ────────────────────────────────────────────────
  // Lifted out of the MyPredictions render function so that view can be called
  // INLINE without its own hooks. Previously MyPredictions was rendered as
  // <MyPredictions/> while being defined inside App, so every App re-render
  // (e.g. the 10s poll, or saving a score) created a new component type and
  // REMOUNTED the whole subtree — which reset child state and slammed the
  // TeamPicker dropdown shut. Keeping the state here makes the subtree stable.
  const [submitting,setSubmitting]=useState(false);
  const [renamingEntryId,setRenamingEntryId]=useState(null);
  const [renameVal,setRenameVal]=useState("");
  const [showNewMenu,setShowNewMenu]=useState(false);
  const [collapsedStages,setCollapsedStages]=useState(()=>new Set());
  // Timezone for all kickoff displays. Lifted to App state (was local to
  // Settings) so changing it instantly re-renders the Today's Games panel and
  // any other time display, instead of lagging until the next poll/tab switch.
  const [tz,setTz]=useState(()=>localStorage.getItem("mb_timezone")||"auto");
  function saveTz(v){ setTz(v); try{ localStorage.setItem("mb_timezone",v); }catch{} }
  // Collapse stages below the current open stage by default (re-applied when
  // the admin advances the stage). Manual toggles persist until then.
  useEffect(()=>{
    setCollapsedStages(new Set(STAGES.filter(s=>s.n<(config.current_stage||1)).map(s=>s.n)));
  },[config.current_stage]);

  // ── Leaderboard-tab UI state ────────────────────────────────────────────────
  // Lifted out of LeaderboardView so that view can render inline without
  // remounting on every App re-render. As <LeaderboardView/> it was remounted
  // by the 10s poll (setLeaderboard), which reset the Simulate / Favorites toggles
  // back to "Actual" after a few seconds.
  const [favOnly,setFavOnly]=useState(false);
  // "Live picks" — opt-in leaderboard columns showing every form's prediction
  // for the currently in-play matches. Per-user view preference (device-local,
  // like the theme/timezone), OFF by default. The toggle chip only surfaces
  // while ≥1 match is live; the columns themselves come and go with the games.
  const [showLivePreds,setShowLivePreds]=useState(()=>{
    try { return localStorage.getItem("mb_show_live_preds")!=="0"; } catch { return true; }
  });
  const toggleLivePreds=useCallback(()=>{
    setShowLivePreds(v=>{ const n=!v; try{ localStorage.setItem("mb_show_live_preds",n?"1":"0"); }catch{} return n; });
  },[]);
  // "Match picks" game selection. The column follows the current game by default
  // (Auto), but the user can PIN it to any game via the header dropdown.
  // pinnedMatchN===null ⇒ Auto. Persisted per device.
  const [pinnedMatchN,setPinnedMatchN]=useState(()=>{
    try { const v=localStorage.getItem("mb_pinned_match"); return v!=null&&v!==""?Number(v):null; } catch { return null; }
  });
  const setPinned=useCallback((n)=>{
    setPinnedMatchN(n);
    try { if(n==null) localStorage.removeItem("mb_pinned_match"); else localStorage.setItem("mb_pinned_match",String(n)); } catch {}
  },[]);
  // Dropdown (game selector) UI state — lifted here so the 10s leaderboard poll
  // doesn't reset it (LeaderboardView is rendered inline).
  const [gameMenuOpen,setGameMenuOpen]=useState(false);
  const [gameMenuPos,setGameMenuPos]=useState(null);
  const gameBtnRef=useRef(null);
  const [matchSimMode,setMatchSimMode]=useState(false);
  const [matchSimA,setMatchSimA]=useState("");
  const [matchSimB,setMatchSimB]=useState("");
  const gameMenuSelectedRef=useRef(null);
  const gameMenuAutoRef=useRef(null);
  useEffect(()=>{
    // On open, bring the live / most-recent game (the Auto target) into view —
    // not whatever's pinned — so the dropdown always opens focused on the
    // current action. Falls back to the selected row if Auto isn't listed.
    if(gameMenuOpen) setTimeout(()=>{ (gameMenuAutoRef.current||gameMenuSelectedRef.current)?.scrollIntoView({block:"start"}); },30);
  },[gameMenuOpen]);
  // A match's picks are viewable unless it's in the still-open betting stage.
  const matchViewable=useCallback((m)=>!(config.round_state==="open"&&m.s===(config.current_stage||1)),[config.round_state,config.current_stage]);
  // Auto target (recomputed each render so the −10min look-ahead fires on the
  // 10s poll). Selected = the pinned game if it's still valid, else Auto.
  const autoMatchN=computeAutoMatchN(matches,results,liveMatches,Date.now(),matchViewable);
  const selectedMatchN=(pinnedMatchN!=null&&matches.some(m=>m.n===pinnedMatchN))?pinnedMatchN:autoMatchN;
  // When a game STARTS, snap the Match picks selection back onto the live game
  // — once — overriding whatever the user had pinned. A "start" = a game newly
  // entering the in-play set: it just went live, or it crossed into the 10-min
  // pre-kickoff look-ahead window (the same window computeAutoMatchN jumps to).
  // We track that set and act only when a NEW number appears, so a game ENDING
  // (leaving the set) never overrides a pin. Clearing the pin lets the column
  // follow Auto onto the started game; the user can re-pin afterward and we
  // won't override again until the NEXT game starts. The ref skips the initial
  // mount so a saved pin survives a reload.
  const startingSet=(()=>{
    const now=Date.now(), s=[];
    for(const m of matches){
      const lv=liveMatches[m.n];
      if(lv&&lv.is_live){ s.push(m.n); continue; }
      if(results[m.n]||!matchViewable(m)) continue;
      const ko=new Date(m.t).getTime();
      if(!isNaN(ko)&&ko>now&&ko-now<=MATCH_PICK_LOOKAHEAD_MS) s.push(m.n);
    }
    return s;
  })();
  const startingKey=startingSet.join(",");
  const startingSetRef=useRef(null);
  useEffect(()=>{
    if(!matches.length) return;                    // data not loaded yet — don't baseline on the empty render
    const prev=startingSetRef.current;
    startingSetRef.current=startingSet;
    if(prev===null) return;                        // first real observation — baseline only, never override on load
    const prevSet=new Set(prev);
    if(startingSet.some(n=>!prevSet.has(n))) setPinned(null);
  // keyed on the set contents (+ matches load); startingSet/setPinned read fresh via closure
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[startingKey,matches.length]);
  // Reset match sim mode whenever the focused game changes
  useEffect(()=>{ setMatchSimMode(false); setMatchSimA(""); setMatchSimB(""); },[selectedMatchN]);
  // Cache of {match_n: {entry_id:[a,b]}} for games not covered by the rows'
  // spotlight_preds (i.e. a pinned/older game). Fetched on demand.
  const [matchPicks,setMatchPicks]=useState({});
  useEffect(()=>{
    if(selectedMatchN==null||!showLivePreds) return;
    const selM=matches.find(m=>m.n===selectedMatchN);
    if(selM&&!matchViewable(selM)) return;                  // locked — nothing to fetch
    if(matchPicks[selectedMatchN]) return;                  // already cached
    // Covered by the leaderboard payload (the auto/live game)? then no fetch.
    if(leaderboard.some(r=>r.spotlight_preds&&(String(selectedMatchN) in r.spotlight_preds))) return;
    let cancelled=false;
    api.getMatchPredictions(selectedMatchN)
      .then(d=>{ if(!cancelled) setMatchPicks(p=>({...p,[selectedMatchN]:d||{}})); })
      .catch(()=>{});
    return ()=>{cancelled=true;};
  },[selectedMatchN,showLivePreds,leaderboard,matchViewable,matchPicks]);
  // Favorites = leaderboard rows (forms) the user starred, persisted per user
  // in localStorage. Keyed by row id (entry_id, falling back to user_id) so two
  // forms from the same player can be favorited independently. Selected right on
  // the Leaderboard via the ★ in each row; the ★ in the table header toggles the
  // "favorites only" filter.
  const favoritesKey = user?.id ? `mb_favorites_${user.id}` : null;
  const [favorites,setFavorites]=useState([]);
  useEffect(()=>{
    if(!favoritesKey){ setFavorites([]); return; }
    try { setFavorites(JSON.parse(localStorage.getItem(favoritesKey)||"[]")); }
    catch { setFavorites([]); }
  },[favoritesKey]);
  const toggleFavorite=useCallback((rowKey)=>{
    if(!favoritesKey||rowKey==null) return;
    setFavorites(prev=>{
      const next = prev.includes(rowKey) ? prev.filter(k=>k!==rowKey) : [...prev,rowKey];
      try { localStorage.setItem(favoritesKey, JSON.stringify(next)); } catch {}
      return next;
    });
  },[favoritesKey]);
  // The user's own forms are ALWAYS favorited and can't be un-starred — that's
  // enforced at render time (isMe ⇒ favorited, locked star), so it doesn't need
  // to live in the persisted `favorites` list. Only other people's forms are
  // toggled into/out of localStorage.
  // One-time "you can favorite & filter" hint, shown above the leaderboard while
  // the user hasn't starred anyone yet. Dismissal persists per user.
  const favHintKey = user?.id ? `mb_favhint_dismissed_${user.id}` : null;
  const [favHintDismissed,setFavHintDismissed]=useState(true);
  useEffect(()=>{
    if(!favHintKey){ setFavHintDismissed(true); return; }
    try { setFavHintDismissed(localStorage.getItem(favHintKey)==="1"); }
    catch { setFavHintDismissed(false); }
  },[favHintKey]);
  const dismissFavHint=useCallback(()=>{
    setFavHintDismissed(true);
    if(favHintKey){ try{ localStorage.setItem(favHintKey,"1"); }catch{} }
  },[favHintKey]);
  const [hoveredRow,setHoveredRow]=useState(null);
  // Refs for scroll-to-my-row and floating action buttons.
  const lbScrollRef = useRef(null);
  const myLbRowRef  = useRef(null);
  const [lbFabState,setLbFabState]=useState({showTop:false,showMe:false,meAbove:false});
  // (Auto-scroll-to-my-row on landing removed — users found it jarring. The
  //  "↑ My form" FAB still lets them jump there manually.)
  // Lifted so LeaderboardView (called inline, not mounted) can branch its
  // layout responsively without itself calling a hook conditionally.
  const isMobile = useIsMobile();
  // Per-stage rank movement is driven by config.stage_baseline (a server-side
  // snapshot of the standings taken when the stage last advanced) — see
  // LeaderboardView. No client-side tracking needed.
  const [simMode,setSimMode]=useState(false);
  const [simLb,setSimLb]=useState(null);
  const [simLoading,setSimLoading]=useState(false);
  const [simLimit,setSimLimit]=useState(null); // null = all unplayed, number = cap
  // When the user owns multiple forms, they can pick which form's predictions
  // drive the simulation. Defaults to the currently active form. Other forms'
  // predictions are fetched on demand and cached here.
  const [simEntryId,setSimEntryId]=useState(null);
  const [simPredsByEntry,setSimPredsByEntry]=useState({}); // {entryId: {match_n:[a,b]}}
  const [statsOpen,setStatsOpen]=useState(false);
  const [userStatsOpen,setUserStatsOpen]=useState(false);
  const [groupStatsOpen,setGroupStatsOpen]=useState(false);
  const [groupStatsData,setGroupStatsData]=useState(null);
  const statsPopup      = useAnchoredPopup({open:statsOpen,      preferLeft:false, width:340});
  const userStatsPopup  = useAnchoredPopup({open:userStatsOpen,  preferLeft:false, width:300});
  const groupStatsPopup = useAnchoredPopup({open:groupStatsOpen, preferLeft:true,  width:380}); // {top3_scores:[{score,count}]}
  // The active form is always available via myPreds — seed it into the cache
  // so picking the active form costs no fetch.
  useEffect(()=>{
    if(!activeEntryId) return;
    setSimPredsByEntry(p=>({ ...p, [activeEntryId]: myPreds }));
  },[activeEntryId,myPreds]);
  // Default the picker to the active form whenever it changes.
  useEffect(()=>{
    if(activeEntryId && simEntryId==null) setSimEntryId(activeEntryId);
  },[activeEntryId,simEntryId]);
  // The form actually being simulated right now.
  const effectiveSimEntryId = simEntryId || activeEntryId;
  const simPreds = (effectiveSimEntryId && simPredsByEntry[effectiveSimEntryId]) || myPreds;
  const unplayedPredMatches = matches.filter(m=>!results[m.n]&&!liveMatches[m.n]&&simPreds?.[m.n]?.[0]!=null).sort((a,b)=>a.t<b.t?-1:a.t>b.t?1:a.n-b.n);
  // Simulate / Actual toggle is always available for a stable UI. When there
  // are no unplayed predictions the simulated leaderboard equals the actual
  // one, so flipping the toggle is just a no-op rather than the button
  // disappearing.
  const canSim = !!user;
  // Fetch the simulated leaderboard when Simulate turns on, or when the user
  // switches which form to simulate from. Unplayed matches resolve to the
  // chosen form's predictions (and, if no champion yet, my winner pick).
  const simMatches = simLimit!=null ? unplayedPredMatches.slice(0,simLimit) : unplayedPredMatches;
  useEffect(()=>{
    if(!simMode||!canSim){ setSimLb(null); return; }
    const override={};
    for(const m of simMatches){ const p=simPreds[m.n]; if(p?.[0]!=null&&p?.[1]!=null) override[m.n]=[p[0],p[1]]; }
    setSimLoading(true);
    api.getSimulatedLeaderboard(override,null)
      .then(rows=>setSimLb(rows)).catch(()=>setSimLb(null)).finally(()=>setSimLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[simMode,effectiveSimEntryId,simPreds,simLimit]);
  // Fetch predictions for the chosen form if we don't already have them cached.
  useEffect(()=>{
    if(!simMode||!effectiveSimEntryId) return;
    if(simPredsByEntry[effectiveSimEntryId]) return;
    api.getMyPredictions(effectiveSimEntryId)
      .then(list=>{
        const map={};
        for(const p of list){ map[p.match_n]=[p.score_a,p.score_b]; }
        setSimPredsByEntry(prev=>({...prev,[effectiveSimEntryId]:map}));
      })
      .catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[simMode,effectiveSimEntryId]);

  // Simulation is "active" once the simulated leaderboard has loaded. While
  // active, every view (By-participant, bracket) should treat unplayed matches
  // as resolved to MY predictions — purely client-side, only on my screen.
  // We deliberately DON'T require unplayed matches: flipping Simulate should
  // always feel like sim mode (banner + indigo styling on), even when nothing
  // actually changes because there's nothing to simulate yet.
  const simActive = simMode && canSim && !!simLb;
  const simResults = (() => {
    if (!simActive) return results;
    const merged = { ...results };
    for (const m of unplayedPredMatches) {
      const p = simPreds[m.n];
      if (p?.[0] != null && p?.[1] != null) merged[m.n] = [p[0], p[1]];
    }
    return merged;
  })();
  const effResults = simActive ? simResults : results;
  const effLeaderboard = simActive ? (simLb || leaderboard) : leaderboard;

  function showToast(msg,kind="ok"){setToast({msg,kind});clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(null),2500);}

  const loadGameData=useCallback(async(isAdmin,userId=null)=>{
    const _t0 = perfNow();
    try {
      perfLog(`init: requesting /api/init/ at t=${_t0.toFixed(0)}ms`);
      // Single round-trip: /api/init/ returns everything at once
      const d = await initApi.load();
      perfLog(
        `init: /api/init/ resolved — round-trip ${(perfNow()-_t0).toFixed(0)}ms · ` +
        `${Math.round(JSON.stringify(d).length/1024)}KB · ` +
        `lb=${d.leaderboard?.length ?? 0} results=${d.results?.length ?? 0} live=${d.live?.length ?? 0}` +
        (d.entries!=null?` entries=${d.entries.length}`:"") +
        (d.participants!=null?` participants=${d.participants.length}`:"")
      );

      // Matches are static — cache in sessionStorage to skip re-fetch
      if (d.matches) {
        setMatches(d.matches);
        setTeams(d.teams);
        try { sessionStorage.setItem("mb_matches", JSON.stringify({m:d.matches,t:d.teams})); } catch {}
      } else {
        try {
          const cached = JSON.parse(sessionStorage.getItem("mb_matches")||"null");
          if (cached) { setMatches(cached.m); setTeams(cached.t); }
        } catch {}
      }

      setConfig(d.config);
      const resMap={};for(const r of d.results)resMap[r.match_n]=[r.score_a,r.score_b,r.winner??null,r.et_a??null,r.et_b??null,r.pen_a??null,r.pen_b??null];
      setResults(resMap);
      setLeaderboard(d.leaderboard);
      setLbLoaded(true);
      perfLog(`init: leaderboard state set ${(perfNow()-_t0).toFixed(0)}ms after request start (state applied; React render/paint follows)`);
      api.getRankSnapshot().then(snap=>setRankSnapshots(snap||{today:{},yesterday:{}})).catch(()=>{});

      // Live matches (may not exist yet if table not created)
      if (d.live) {
        const liveMap={};for(const m of d.live)liveMap[m.match_n]={score_a:m.score_a,score_b:m.score_b,minute:m.minute,is_live:!!m.is_live,winner:m.winner??null,et_a:m.et_a??null,et_b:m.et_b??null,pen_a:m.pen_a??null,pen_b:m.pen_b??null,red_a:m.red_a??null,red_b:m.red_b??null};
        setLiveMatches(liveMap);
      }

      // /api/init/ only READS the live table — it never syncs the upstream feed.
      // So a user logging in mid-match sees a score that's only as fresh as the
      // last poller wrote. Kick off ONE immediate live refresh (GET /api/live/
      // syncs the feed) so the freshly-synced score lands in ~1-5s instead of
      // waiting for the first 10s poll tick. Gated on a round being in motion,
      // same as the tick; the 10s upstream cache means this can't spam the feed.
      if (d.config?.round_state !== "idle") refreshLiveAndResults();

      if(!isAdmin&&userId){
        if(d.entries&&d.entries.length>0){
          setEntries(d.entries);
          // Sync preds/winner to the CURRENTLY-active form if one is set (the
          // user may have created/switched forms before this load resolved);
          // only fall back to the first entry when nothing is active yet. Using
          // entries[0] unconditionally desyncs a non-first active form — its
          // winner picker would jump to the first form's champion.
          const activeId=activeEntryIdRef.current;
          const active=(activeId&&d.entries.find(e=>e.id===activeId))||d.entries[0];
          setActiveEntryId(id=>id||active.id);
          const predMap={};for(const p of(active.predictions||[]))predMap[p.match_n]=[p.score_a,p.score_b];
          setMyPreds(predMap);
          predBaseline.current={...predMap};
          setMyWinner(active.winner_pick||(d.locked_winner??null));
        }else if(d.my_predictions){
          const predMap={};for(const p of d.my_predictions)predMap[p.match_n]=[p.score_a,p.score_b];
          setMyPreds(predMap);
          predBaseline.current={...predMap};
          const myEntry=d.leaderboard.find(e=>e.user_id===userId);
          if(myEntry)setMyWinner(myEntry.winner_pick||null);
        }
        if(d.locked_winner!==undefined)setLockedWinner(d.locked_winner);
      }
      if(isAdmin&&d.participants){
        setAdminParticipants(d.participants);
        setParticipants(d.users||d.participants.map(p=>({id:p.id,name:p.name,email:p.email,phone:p.phone||"",has_paid:p.has_paid,is_admin:false})));
      }else if(isAdmin&&d.users){
        setParticipants(d.users);
      }
      setPredsLoaded(true); // always clear loading state
    } catch(e){setGlobalErr(e.message);}
  },[]);

  // Perf: log when the leaderboard first becomes ready — this effect runs right
  // after React commits the DOM that replaces the spinner with the table.
  useEffect(()=>{
    if(lbLoaded) perfLog(`leaderboard committed to DOM at t=${perfNow().toFixed(0)}ms since page load`);
  },[lbLoaded]);

  // Pre-load config + cached matches immediately (before auth check)
  useEffect(()=>{
    api.getConfig().then(cfg=>setConfig(cfg)).catch(()=>{});
    // Restore static matches + last-known results/live from sessionStorage so the
    // page (incl. the Today's Games panel) paints WITH data on a refresh, instead
    // of flashing empty until /api/init resolves a few seconds later.
    try {
      const cached = JSON.parse(sessionStorage.getItem("mb_matches")||"null");
      if (cached && cached.m?.length) { setMatches(cached.m); setTeams(cached.t); }
    } catch {}
    try {
      const lc = JSON.parse(sessionStorage.getItem("mb_livecache")||"null");
      if (lc) { if (lc.results) setResults(lc.results); if (lc.live) setLiveMatches(lc.live); }
    } catch {}
  },[]);

  // Keep that cache fresh: persist results + live on every change (initial load,
  // poll, admin edits) so the next refresh has the latest snapshot to paint from.
  // Guard: never overwrite a good cache with the empty initial state on mount —
  // that's what would otherwise wipe the snapshot before hydration applies.
  useEffect(()=>{
    if(!Object.keys(results).length && !Object.keys(liveMatches).length) return;
    try { sessionStorage.setItem("mb_livecache", JSON.stringify({results, live:liveMatches})); } catch {}
  },[results, liveMatches]);

  // Persist the user so the next refresh can render optimistically (see above).
  useEffect(()=>{
    try{ if(user) localStorage.setItem("mb_user",JSON.stringify(user)); else localStorage.removeItem("mb_user"); }catch{}
  },[user]);
  // Persist config so the default tab + round state are correct on first paint.
  useEffect(()=>{
    try{ localStorage.setItem("mb_config",JSON.stringify(config)); }catch{}
  },[config]);

  useEffect(()=>{
    if(!getToken()){setAuthLoading(false);return;}
    // Already rendering from the cached user? Kick off the data load now so the
    // cached panel/leaderboard refresh ASAP, without waiting on api.me().
    if(_cachedUser) loadGameData(_cachedUser.is_admin,_cachedUser.id);
    // Validate / refresh the session in the background.
    api.me().then(u=>{
      setUser(u); setAuthLoading(false);
      if(!_cachedUser) loadGameData(u.is_admin,u.id);
    }).catch(()=>{ setToken(null); setUser(null); setAuthLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loadGameData]);

  async function doLogin(userData,token){
    setToken(token);setUser(userData);
    showToast(`Welcome, ${userData.name}!`);
    loadGameData(userData.is_admin,userData.id); // background — UI already visible
  }

  // Pick the default tab once after auth, based on the current round state.
  //   admin                 → Results (their primary tab)
  //   round CLOSED          → Leaderboard
  //   anything else         → My predictions
  // Runs once per logged-in user (a ref one-shots it).
  const tabInitForUserRef = useRef(null);
  useEffect(() => {
    if (!user) { tabInitForUserRef.current = null; return; }
    if (tabInitForUserRef.current === user.id) return;
    if (user.is_admin) { setTab("results"); tabInitForUserRef.current = user.id; return; }
    // In demo mode always land on predictions so date/time is immediately visible.
    const isDemoMode = import.meta.env.MODE === "demo";
    setTab(!isDemoMode && config.round_state === "closed" ? "leaderboard" : "predictions");
    tabInitForUserRef.current = user.id;
  }, [user?.id, config.round_state]);

  // ── Onboarding (per-user, per-tab) ──────────────────────────────────────
  // Seen-state lives on the user row (DB / demo store) — `user.help_seen` is
  // the source of truth, persisted via api.setHelpSeen so the popups don't
  // re-trigger on a new device or after a localStorage wipe.
  const helpBtnRef = useRef(null);
  const [helpEntry, setHelpEntry]   = useState(null);       // currently shown HelpDialog payload
  const [helpBlink, setHelpBlink]   = useState(false);      // triggers the 2× pulse on the nav button
  // Locally-mirrored seen map for snappy UI; sync'd with the user record on every change.
  const helpSeen = user?.help_seen || {};

  // One-time migration: if an older client wrote flags to localStorage, push
  // them up to the server now and wipe the local copy.
  useEffect(()=>{
    if(!user || user.is_admin) return;
    const legacy = consumeLegacyHelpSeen(user.id);
    if(!Object.keys(legacy).length) return;
    const merged = { ...(user.help_seen||{}), ...legacy };
    setUser({ ...user, help_seen: merged });
    api.setHelpSeen(merged).catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Auto-open: welcome (first ever) or current tab's dialog (first visit to that tab).
  useEffect(()=>{
    if(!user || user.is_admin) return;          // skip admins — they know the app
    if(helpEntry) return;                        // already showing something
    if(!HELP_TABS.includes(tab)) return;
    const seen = helpSeen;
    if(!seen.welcome){
      // Welcome flags ONLY itself. Once it's closed this effect re-runs and,
      // since the current tab is still unseen, opens that tab's dialog next.
      setHelpEntry({ ...HELP_CONTENT.welcome, _flagKeys: ["welcome"] });
      return;
    }
    if(!seen[tab]){
      setHelpEntry({ ...HELP_CONTENT[tab], _flagKeys: [tab] });
    }
  }, [user?.id, user?.is_admin, tab, helpSeen, helpEntry]);

  function closeHelp(){
    if(!helpEntry){ return; }
    const flagKeys = helpEntry._flagKeys || [];
    if(user && flagKeys.length){
      const next = { ...helpSeen };
      for(const k of flagKeys) next[k] = true;
      // Optimistic local update, then fire-and-forget server sync.
      setUser({ ...user, help_seen: next });
      api.setHelpSeen(next).catch(()=>{});
    }
    setHelpEntry(null);
    // Blink the ⓘ button 2× so the user notices where the help moved to.
    setHelpBlink(true);
    setTimeout(()=> setHelpBlink(false), 1300);
  }
  function openHelpForCurrentTab(){
    if(!user) return;
    const key = HELP_TABS.includes(tab) ? tab : "welcome";
    const c = HELP_CONTENT[key] || HELP_CONTENT.welcome;
    setHelpEntry({ ...c, _flagKeys: [] }); // manual re-open doesn't toggle seen
  }
  function resetOnboarding(){
    if(!user) return;
    setUser({ ...user, help_seen: {} });
    setHelpEntry(null);
    api.setHelpSeen({}).catch(()=>{});
  }
  function doLogout(){setToken(null);setUser(null);setTab("auth");setMyPreds({});setMyWinner(null);setLeaderboard([]);setLbLoaded(false);setParticipants([]);setEntries([]);setActiveEntryId(null);setLockedWinner(null);setAdminParticipants([]);}

  async function refreshLive() {
    try {
      const list = await liveApi.getAll();
      const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute,is_live:!!x.is_live,winner:x.winner??null,et_a:x.et_a??null,et_b:x.et_b??null,pen_a:x.pen_a??null,pen_b:x.pen_b??null,red_a:x.red_a??null,red_b:x.red_b??null};
      setLiveMatches(m);
      localStorage.setItem("mb_live_sync", Date.now().toString());
    } catch(e) { console.error("refreshLive:", e); }
  }

  // Cross-tab sync — when admin updates live score in one tab, other tabs reload
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== "mb_live_sync") return;
      // Don't clobber an admin's in-progress result entry from another tab's sync.
      if (user?.is_admin && tab === "results") return;
      liveApi.getAll().then(list => {
        const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute,is_live:!!x.is_live,winner:x.winner??null,et_a:x.et_a??null,et_b:x.et_b??null,pen_a:x.pen_a??null,pen_b:x.pen_b??null,red_a:x.red_a??null,red_b:x.red_b??null};
        setLiveMatches(m);
      }).catch(()=>{});
      // A finalize in another tab moves a match from live → results, so pull
      // the updated standings + finalized results here too.
      refreshLb(); refreshResults();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user?.is_admin, tab]);

  async function refreshLb(){
    try {
      const lb=await api.getLeaderboard();setLeaderboard(prev=>sameData(prev,lb)?prev:lb);
      // Sync winner pick only for the currently-active entry so a newly-created
      // empty form doesn't inherit another entry's pick. Read activeEntryId /
      // lockedWinner from refs — the polled caller closes over stale state.
      if(user&&!user.is_admin){
        const e=lb.find(e=>e.entry_id===activeEntryIdRef.current);
        if(e&&!lockedWinnerRef.current)setMyWinner(e.winner_pick||null);
      }
      if(user?.is_admin){
        const [u,p]=await Promise.all([api.getUsers(),api.getAdminParticipants()]);
        setParticipants(prev=>sameData(prev,u)?prev:u);setAdminParticipants(prev=>sameData(prev,p)?prev:p);
      }
    } catch(e) { console.error("refreshLb:", e); }
  }

  // Re-fetch finalized results so the Tournament grid and By-participant scoring
  // reflect admin updates without a page reload. Skipped while the admin is on
  // the Results tab (they're the source of truth there and shouldn't be clobbered).
  async function refreshResults(){
    if(user?.is_admin && tab==="results") return;
    try {
      const list=await api.getResults();
      const m={}; for(const r of list) m[r.match_n]=[r.score_a,r.score_b,r.winner??null,r.et_a??null,r.et_b??null,r.pen_a??null,r.pen_b??null];
      setResults(m);
    } catch(e) { console.error("refreshResults:", e); }
  }

  // Poll helper used by the 10s tick. The GET /api/live/ has a side effect: it
  // syncs fresh scores from the upstream feed and, for any game that just hit
  // full-time, finalizes it — writing the score into results and DELETING the
  // live row. So we must fetch live FIRST (let that finalize happen) and only
  // THEN fetch results, so the freshly-finalized score is in this same pass.
  // Both state writes are applied synchronously → React batches them into one
  // render. Doing it as two independent concurrent fetches (the old behaviour)
  // raced: the game vanished from liveMatches before its result arrived, so the
  // Today's Games card flipped to "UPCOMING" until the next refresh.
  async function refreshLiveAndResults(){
    if(user?.is_admin && tab==="results") return;
    try {
      const liveList = await liveApi.getAll();
      const resList  = await api.getResults();
      const lm={}; for(const x of liveList) lm[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute,is_live:!!x.is_live,winner:x.winner??null,et_a:x.et_a??null,et_b:x.et_b??null,pen_a:x.pen_a??null,pen_b:x.pen_b??null,red_a:x.red_a??null,red_b:x.red_b??null};
      const rm={};   for(const r of resList)  rm[r.match_n]=[r.score_a,r.score_b,r.winner??null,r.et_a??null,r.et_b??null,r.pen_a??null,r.pen_b??null];
      setLiveMatches(prev=>sameData(prev,lm)?prev:lm);
      setResults(prev=>sameData(prev,rm)?prev:rm);
      localStorage.setItem("mb_live_sync", Date.now().toString());
    } catch(e) { console.error("refreshLiveAndResults:", e); }
  }

  // Re-fetch round config (round_state, current_stage, tournament_winner) so the
  // admin's state transitions — open/close the round, advance the stage, set the
  // tournament winner — propagate to every client without a reload. Skipped on
  // the admin's Dashboard, where they're the ones driving those changes.
  async function refreshConfig(){
    if(user?.is_admin && tab==="dashboard") return;
    try { const cfg=await api.getConfig(); setConfig(prev=>sameData(prev,cfg)?prev:cfg); }
    catch(e) { console.error("refreshConfig:", e); }
  }

  // ── Live-update polling ───────────────────────────────────────────────────
  // While the user is signed in, poll the backend every ~10s so all clients see
  // admin changes without a reload. Config is polled even while idle, so an
  // idle→open transition (admin opens the round) propagates; live scores, the
  // leaderboard and finalized results are only polled once a round is in motion.
  useEffect(() => {
    if (!user) return;
    // Pause polling while the admin is actively entering results. The poll
    // re-fetches and REPLACES liveMatches, which was wiping freshly-typed
    // scores and yanking the cursor out mid-edit. The admin is the source of
    // truth on this tab — their own edits persist via updateLive regardless —
    // so there's nothing to poll for here. Resumes on any other tab.
    if (user.is_admin && tab === "results") return;
    const tick = () => {
      // Don't burn CPU/network while the tab is in the background — that's what
      // trips Chrome's "tab slowing your browser" prompt. We refresh on return.
      if (document.hidden) return;
      refreshConfig();                                       // even while idle
      if (config.round_state !== "idle") { refreshLiveAndResults(); refreshLb(); }
    };
    const id = setInterval(tick, 10000);
    const onVisible = () => { if (!document.hidden) { setPinned(null); tick(); } };  // reset pin + catch up when the tab comes back
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, config.round_state, tab]);

  const tabs=!user?[]:user.is_admin
    ?[{id:"tournament",label:"🏟 Tournament"},{id:"leaderboard",label:"Leaderboard"},{id:"results",label:"Results",admin:true},{id:"dashboard",label:"Dashboard",admin:true},{id:"settings",label:"⚙ Settings"}]
    :[{id:"tournament",label:"🏟 Tournament"},{id:"leaderboard",label:"Leaderboard"},{id:"predictions",label:"My predictions"},{id:"settings",label:"⚙ Settings"}];

  function RoundPill(){
    const map={
      open:  {text:"🟢 Betting round is OPEN",  bg:"rgba(16,185,129,0.1)",  color:C.green, border:`1px solid ${C.green}`},
      closed:{text:"🔒 Betting round is CLOSED",bg:"rgba(239,68,68,0.1)",   color:C.red,   border:`1px solid ${C.red}`},
      idle:  {text:"⏸️ No betting round yet",   bg:"rgba(148,163,184,0.1)",color:C.muted, border:`1px solid ${C.border}`},
    };
    const s=map[config.round_state]||map.idle;
    return <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,background:s.bg,color:s.color,border:s.border}}>{s.text}</span>;
  }

  // ── My Predictions ────────────────────────────────────────────────────────
  function MyPredictions(){
    const activeEntry=entries.find(e=>e.id===activeEntryId)||entries[0]||null;
    const openStage = config.current_stage || 1;
    // A form is "active" if either we're still in stage 1 (anyone can submit
    // for the first time), OR the form already submitted stage 1 before it
    // closed. Forms that missed the stage-1 deadline become inactive — they
    // can be viewed but not edited or submitted in any later stage.
    // No-entry (brand-new user) is treated as active so they can still add
    // a form during stage 1.
    const isFormActive = (e) =>
      !e || openStage === 1 || !!(e.stages_submitted||{})["1"];
    const activeFormActive = isFormActive(activeEntry);
    const editable = config.round_state==="open" && activeFormActive;
    const openMatches = matches.filter(m => matchStageObj(m.n).n <= openStage);
    // Each entry now tracks per-stage submission. The "submitted_at" legacy
    // field is just the earliest stage submission; the source of truth is
    // activeEntry.stages_submitted[stage].
    const stagesSubmitted = activeEntry?.stages_submitted || {};
    const currentStageSubmitted = !!stagesSubmitted[openStage];
    // Submit only requires the matches the user CAN actually predict — the
    // current stage's matches that don't yet have a result.
    const submittableMatches = matches.filter(m =>
      matchStageObj(m.n).n === openStage
      && !results[m.n]
      && !liveMatches[m.n]
    );
    const filledCount = submittableMatches.filter(m => myPreds[m.n]?.[0] != null && myPreds[m.n]?.[1] != null).length;
    // Winner pick is required on stage 1 submission — and it's PER FORM: each
    // form needs its own champion (matches the backend's per-entry winner; a
    // user-level lockedWinner must NOT let a fresh form submit with an empty
    // picker).
    const winnerNeededForSubmit = openStage === 1 && !myWinner;
    const canSubmit = filledCount === submittableMatches.length
                   && submittableMatches.length > 0
                   && !winnerNeededForSubmit
                   && !currentStageSubmitted
                   && editable;
    // NOTE: submitting / renamingEntryId / renameVal / showNewMenu /
    // collapsedStages live in App (lifted out) so this view can be rendered
    // inline as {MyPredictions()} without remounting on every App re-render.
    const toggleStage=n=>setCollapsedStages(prev=>{
      const next=new Set(prev);
      if(next.has(n))next.delete(n);else next.add(n);
      return next;
    });

    function switchEntry(entryId){
      flushPredSaves();   // persist any pending edits on the current form first
      setActiveEntryId(entryId);
      const entry=entries.find(e=>e.id===entryId);
      if(entry){
        const m={};for(const p of(entry.predictions||[]))m[p.match_n]=[p.score_a,p.score_b];
        setMyPreds(m);
        predBaseline.current={...m};
        setMyWinner(entry.winner_pick||(lockedWinner??null));
      }
    }

    // Flush buffered prediction edits as ONE bulk write. Returns a promise so
    // submit can await it. Safe to call when empty.
    function flushPredSaves(){
      if(predSaveTimer.current){ clearTimeout(predSaveTimer.current); predSaveTimer.current=null; }
      const entryId=predSaveEntry.current;
      const buf=predSaveBuf.current; predSaveBuf.current={};
      // Drop no-op edits vs the last-persisted baseline. Covers focusing a box
      // without typing, blurring unchanged, and editing then changing back.
      const base=predBaseline.current||{};
      const changed=Object.keys(buf).filter(n=>{
        const b=base[n]; const ba=b?(b[0]??null):null, bb=b?(b[1]??null):null;
        return !(ba===buf[n].score_a && bb===buf[n].score_b);
      });
      if(!entryId||!changed.length) return Promise.resolve();
      const items=changed.map(n=>({match_n:Number(n),score_a:buf[n].score_a,score_b:buf[n].score_b}));
      // A genuine change invalidates the affected stages' submissions → draft.
      const stages=new Set(changed.map(n=>matchStageObj(Number(n)).n));
      setEntries(es=>es.map(e=>{
        if(e.id!==entryId) return e;
        const ss={...(e.stages_submitted||{})};
        stages.forEach(s=>{ delete ss[s]; delete ss[String(s)]; });
        return {...e, stages_submitted: ss};
      }));
      // Advance the baseline so a later change-back to these values is a no-op.
      changed.forEach(n=>{ predBaseline.current[n]=[buf[n].score_a,buf[n].score_b]; });
      return api.setPredictionsBulk(items, entryId)
        .then(()=>{ refreshLb(); showToast("Saved ✓"); })
        .catch(()=>showToast("Couldn't save your changes — please try again","err"));
    }

    // onSave from MatchRow — update the UI immediately, then batch the network
    // write (debounced bulk) so jumping box-to-box doesn't save once per box.
    function savePred(matchN,data){
      // Optimistic scores so the boxes / filled-count update at once. The draft
      // flag is only cleared in flushPredSaves, and only for a REAL change vs the
      // baseline — so a focus-only touch or a change-back doesn't enter draft.
      setMyPreds(p=>({...p,[matchN]:[data.score_a,data.score_b]}));
      setEntries(es=>es.map(e=>{
        if (e.id !== activeEntryId) return e;
        const preds = [...(e.predictions||[]).filter(p=>p.match_n!==matchN),
                       {match_n:matchN,score_a:data.score_a,score_b:data.score_b}];
        return {...e, predictions: preds};
      }));
      // Buffer + debounce the bulk write (locked onto the active form).
      if(predSaveEntry.current && predSaveEntry.current!==activeEntryId) flushPredSaves();
      predSaveEntry.current = activeEntryId;
      predSaveBuf.current[matchN] = data;
      clearTimeout(predSaveTimer.current);
      predSaveTimer.current = setTimeout(flushPredSaves, 500);
    }

    // Random fill — fills the given stage's empty / no-score-yet predictions
    // with random 0-3 scores. Won't touch matches that already have a result
    // or a live score. Available while the stage is current and round is open
    // — re-submission is allowed, so it's fine even after Submit.
    function randomFillStage(stageN) {
      if (!editable || !activeEntry) return;
      const stage = STAGES.find(s => s.n === stageN);
      if (!stage) return;
      // Lock onto the form we started on. The user may switch forms while this
      // runs in the background — all saves must still land on THIS form, and
      // the optimistic UI update must not leak into whatever form is shown.
      const targetId = activeEntryId;
      const targetEntry = entries.find(e => e.id === targetId);
      if (!targetEntry) return;
      const targetPreds = {};
      (targetEntry.predictions || []).forEach(p => { targetPreds[p.match_n] = [p.score_a, p.score_b]; });
      const todo = matches.filter(m =>
        m.n >= stage.first && m.n <= stage.last
        && !results[m.n] && !liveMatches[m.n]
        && (targetPreds[m.n]?.[0] == null || targetPreds[m.n]?.[1] == null)
      );
      if (todo.length === 0) { showToast("Nothing left to fill", "warn"); return; }
      const rand = () => Math.floor(Math.random() * 4);
      const filled = todo.map(m => ({ n: m.n, a: rand(), b: rand() }));

      // 1) Optimistic update — instant (whole stage at once, not game-by-game).
      //    Scope it to the target form's entry; only touch the visible myPreds
      //    if that form is still the one on screen (it is at click time).
      setEntries(es => es.map(e => {
        if (e.id !== targetId) return e;
        const keep = (e.predictions || []).filter(p => !filled.some(f => f.n === p.match_n));
        const preds = [...keep, ...filled.map(f => ({ match_n: f.n, score_a: f.a, score_b: f.b }))];
        const ss = { ...(e.stages_submitted || {}) };
        delete ss[stageN]; delete ss[String(stageN)];   // editing invalidates submission
        return { ...e, predictions: preds, stages_submitted: ss };
      }));
      setMyPreds(p => {
        const np = { ...p };
        filled.forEach(f => { np[f.n] = [f.a, f.b]; });
        return np;
      });
      if(targetId===activeEntryId) filled.forEach(f=>{ predBaseline.current[f.n]=[f.a,f.b]; });
      showToast(`Random-filled ${filled.length} match${filled.length===1?"":"es"} · stage ${stageN} 🎲`);

      // 2) Persist in the BACKGROUND as ONE bulk write (not N concurrent PUTs).
      api.setPredictionsBulk(filled.map(f => ({match_n:f.n, score_a:f.a, score_b:f.b})), targetId)
        .then(() => { refreshLb(); })
        .catch(() => {});
    }

    // Import predictions from a CSV. Format: "match,home,away" per line
    // (match = match number, home/away = predicted scores). A header row is
    // optional — any row whose first cell isn't an integer is skipped. When a
    // stageN is given (the per-stage button next to Random Results) only that
    // stage's editable matches are applied; otherwise any currently-editable
    // match. Rows for closed/finished matches are skipped. Mirrors
    // randomFillStage: optimistic update + background persist, user still
    // submits afterwards.
    function importCsv(file, stageN){
      if(!editable||!activeEntry){ showToast("Open the round before importing","warn"); return; }
      const targetId = activeEntryId;
      const reader = new FileReader();
      reader.onerror = () => showToast("Couldn't read that file","err");
      reader.onload = () => {
        try {
          // Strip a UTF-8 BOM (Excel/Sheets add one — it would break row 1),
          // accept comma / semicolon / tab delimiters, and tolerate quoted
          // cells like "1","2","1" — all common spreadsheet exports.
          const raw = String(reader.result||"").replace(/^﻿/, "");
          const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
          const parsed = [];
          for(const line of lines){
            const c = line.split(/[,;\t]/).map(x=>x.trim().replace(/^"(.*)"$/, "$1").trim());
            const n=Number(c[0]), a=Number(c[1]), b=Number(c[2]);
            if(!Number.isInteger(n)) continue;                 // header / junk row
            if(!Number.isFinite(a)||!Number.isFinite(b)) continue;
            parsed.push({ n, a:Math.max(0,Math.round(a)), b:Math.max(0,Math.round(b)) });
          }
          const editableNs = new Set(
            matches.filter(m =>
              (stageN ? matchStageObj(m.n).n === stageN : matchStageObj(m.n).n <= openStage)
              && !results[m.n] && !liveMatches[m.n]
            ).map(m=>m.n)
          );
          const apply = parsed.filter(p => editableNs.has(p.n));
          const skipped = parsed.length - apply.length;
          if(apply.length===0){ showToast(parsed.length?`No editable matches in that file (${skipped} skipped)`:"No valid rows found in CSV","warn"); return; }
          // How many of this stage's matches are still empty afterwards, so the
          // user knows if their file was partial and Submit will stay blocked.
          const filledNow = new Set(apply.map(f=>f.n));
          for(const mm of matches){ if(editableNs.has(mm.n) && myPreds[mm.n]?.[0]!=null && myPreds[mm.n]?.[1]!=null) filledNow.add(mm.n); }
          const remaining = editableNs.size - filledNow.size;
          const affected = new Set(apply.map(p=>matchStageObj(p.n).n));
          const targetEntry = entries.find(e=>e.id===targetId);
          if(!targetEntry) return;
          // Optimistic update — scoped to the target form; invalidate the
          // affected stages' submissions so Submit reappears.
          setEntries(es=>es.map(e=>{
            if(e.id!==targetId) return e;
            const keep=(e.predictions||[]).filter(p=>!apply.some(f=>f.n===p.match_n));
            const preds=[...keep, ...apply.map(f=>({match_n:f.n,score_a:f.a,score_b:f.b}))];
            const ss={...(e.stages_submitted||{})};
            affected.forEach(sn=>{ delete ss[sn]; delete ss[String(sn)]; });
            return {...e, predictions:preds, stages_submitted:ss};
          }));
          setMyPreds(p=>{ const np={...p}; apply.forEach(f=>{ np[f.n]=[f.a,f.b]; }); return np; });
          if(targetId===activeEntryId) apply.forEach(f=>{ predBaseline.current[f.n]=[f.a,f.b]; });
          showToast(
            `Imported ${apply.length} match${apply.length===1?"":"es"}${skipped?` · ${skipped} skipped`:""}`
            + (remaining>0?` · ${remaining} still empty — fill & Submit` : "") + " 📄",
            remaining>0?"warn":"ok"
          );
          api.setPredictionsBulk(apply.map(f=>({match_n:f.n,score_a:f.a,score_b:f.b})), targetId)
            .then(()=>refreshLb())
            .catch(()=>showToast("Couldn't save the import — please try again","err"));
        } catch { showToast("Couldn't parse that CSV","err"); }
      };
      reader.readAsText(file);
    }

    async function saveWinner(team){
      const prev=myWinner;
      setMyWinner(team||null);
      try{
        await api.setWinnerPick({team:team||null},activeEntryId);
        // Winner pick lives in stage 1 — changing it invalidates the stage 1
        // submission (mirror the server), so Submit reappears immediately.
        setEntries(es=>es.map(e=>{
          if(e.id!==activeEntryId) return e;
          const stagesSub={...(e.stages_submitted||{})};
          delete stagesSub[1]; delete stagesSub["1"];
          return {...e,winner_pick:team||null,stages_submitted:stagesSub};
        }));
        showToast("Saved · re-submit to confirm");
        refreshLb();
      }catch(e){setMyWinner(prev);showToast(e.message,"err");}
    }

    // Jump the user to whatever's still blocking Submit: the first empty match
    // (scroll + focus its score box) or, if scores are done, the champion box.
    function jumpToFirstMissing(){
      const m = submittableMatches.find(mm => !(myPreds[mm.n]?.[0]!=null && myPreds[mm.n]?.[1]!=null));
      if(m){
        const stageN = matchStageObj(m.n).n;
        setCollapsedStages(prev=>{ if(!prev.has(stageN)) return prev; const n=new Set(prev); n.delete(stageN); return n; });
        setTimeout(()=>{
          const row=document.querySelector(`[data-match-n="${m.n}"]`);
          if(row){ row.scrollIntoView({behavior:"smooth",block:"center"});
            const inp=row.querySelector('input[type="number"]'); if(inp) setTimeout(()=>inp.focus(),320); }
        },50);
        return;
      }
      if(winnerNeededForSubmit){
        const box=document.querySelector('[data-champion-box] button');
        if(box){ box.scrollIntoView({behavior:"smooth",block:"center"}); box.click(); }
      }
    }

    async function createEntry(copyFromEntryId){
      setShowNewMenu(false);
      try{
        const body=copyFromEntryId?{copy_from_entry_id:copyFromEntryId}:{};
        const entry=await api.createEntry(body);
        const src = copyFromEntryId ? entries.find(e=>e.id===copyFromEntryId) : null;
        const seedPreds = src ? (src.predictions||[]) : [];
        // Winner pick is never copied — the user must choose it fresh on
        // the new form, whether it's a copy or a blank.
        const seedWinner = null;
        // Important: explicitly reset local state instead of relying on
        // switchEntry's lookup against the not-yet-updated entries list.
        // Otherwise a newly-created empty form briefly shows the previously
        // active entry's data until the next switch.
        setEntries(es => [...es, {...entry, predictions: seedPreds, winner_pick: seedWinner}]);
        setActiveEntryId(entry.id);
        setMyPreds(Object.fromEntries(seedPreds.map(p=>[p.match_n,[p.score_a,p.score_b]])));
        setMyWinner(seedWinner);
        setRenameVal(entry.name);
        setRenamingEntryId(entry.id);
      }catch(e){showToast(e.message,"err");}
    }

    function startRename(e,entry){
      e.stopPropagation();
      setRenameVal(entry.name);
      setRenamingEntryId(entry.id);
    }

    async function commitRename(entryId){
      const val=renameVal.trim();
      const prevName=entries.find(e=>e.id===entryId)?.name;
      setRenamingEntryId(null);
      if(!val||val===prevName)return;            // nothing to do
      // Optimistic: show the new name immediately so it never appears to
      // "snap back" during the request. Roll back + explain only if the
      // server actually rejects it (e.g. a duplicate form name).
      setEntries(es=>es.map(e=>e.id===entryId?{...e,name:val}:e));
      try{
        await api.renameEntry(entryId,{name:val});
        showToast("Form renamed ✓");
      }catch(e){
        setEntries(es=>es.map(e=>e.id===entryId?{...e,name:prevName}:e));
        showToast(e.message||"Couldn't rename form.","err");
      }
    }

    async function submitEntry(){
      if(!canSubmit||submitting)return;
      setSubmitting(true);
      try{
        await flushPredSaves();   // persist any buffered edits before submitting
        await api.submitEntry(activeEntryId);
        const now=new Date().toISOString();
        setEntries(es=>es.map(e=>e.id!==activeEntryId?e:{
          ...e,
          submitted_at: e.submitted_at || now,
          stages_submitted: {...(e.stages_submitted||{}), [openStage]: now},
          submitted_snapshot_at: now,   // a snapshot now exists → Reset draft armed
        }));
        refreshLb();
        // If the user has OTHER active forms that haven't submitted this stage
        // yet, NAG them with a popup so it's impossible to miss. Locked /
        // inactive forms (missed the stage-1 deadline) are excluded — they
        // can't submit anyway.
        const stageKey = String(openStage);
        const pending = entries.filter(e =>
          e.id !== activeEntryId
          && isFormActive(e)
          && !((e.stages_submitted||{})[stageKey] || (e.stages_submitted||{})[openStage])
        );
        if (pending.length === 0) {
          showToast(`Stage ${openStage} submitted! 🎉`);
        } else {
          showToast(`Stage ${openStage} submitted ✓`);
          // Defer slightly so the green toast paints before the modal — gives
          // the user a moment to register "ok, that one's done" before the
          // warning lands.
          const next = pending[0];
          const list = pending.map(e => `• ${e.name}`).join("\n");
          setTimeout(async () => {
            const goNext = await confirmDialog({
              title: `Don't forget your other form${pending.length>1?"s":""}!`,
              message:
                `You still have ${pending.length} form${pending.length>1?"s":""} that haven't submitted stage ${openStage}:\n\n` +
                `${list}\n\n` +
                `Submit them before stage ${openStage} closes or they won't count.`,
              confirmLabel: `Open "${next.name}"`,
              cancelLabel: "Later",
            });
            if (goNext) switchEntry(next.id);
          }, 250);
        }
      }catch(e){showToast(e.message,"err");}
      finally{setSubmitting(false);}
    }

    // Reset draft — discard edits since the last submit and restore that
    // submitted version (scores + champion). Server-side snapshot; one level.
    async function resetDraft(){
      const at = activeEntry?.submitted_snapshot_at;
      const when = at ? `your last submission${(()=>{const k=kickoffParts(at,tz);return k?` (${k.short} · ${k.time})`:"";})()}` : "your last submission";
      const ok = await confirmDialog({
        title: "Reset draft?",
        message: `This discards the changes you've made since ${when} and restores that version — scores and champion.\n\nThis can't be undone.`,
        confirmLabel: "Reset to last submission",
        cancelLabel: "Cancel",
        danger: true,
      });
      if(!ok) return;
      // Discard any buffered edits — we're reverting to the last submission.
      if(predSaveTimer.current){ clearTimeout(predSaveTimer.current); predSaveTimer.current=null; }
      predSaveBuf.current={};
      try{
        const res = await api.resetDraft(activeEntryId);
        const m={}; for(const p of (res.predictions||[])) m[p.match_n]=[p.score_a,p.score_b];
        setMyPreds(m);
        predBaseline.current={...m};
        setMyWinner(res.winner||null);
        setEntries(es=>es.map(e=>e.id!==activeEntryId?e:{
          ...e,
          ...(res.entry||{}),
          predictions: (res.predictions||[]),
          winner_pick: res.winner||null,
        }));
        showToast("Reverted to your last submission ↩");
        refreshLb();
      }catch(e){showToast(e.message,"err");}
    }

    async function deleteEntryById(entryId){
      const ok = await confirmDialog({
        title: "Delete this form?",
        message: "All predictions and the winner pick on this form will be removed. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if(!ok)return;
      // Drop any buffered edits for the form being deleted.
      if(predSaveEntry.current===entryId){
        if(predSaveTimer.current){ clearTimeout(predSaveTimer.current); predSaveTimer.current=null; }
        predSaveBuf.current={};
      }
      try{
        await api.deleteEntry(entryId);
        const next=entries.filter(e=>e.id!==entryId);
        setEntries(next);
        if(activeEntryId===entryId){
          if(next[0])switchEntry(next[0].id);
          else{setActiveEntryId(null);setMyPreds({});setMyWinner(lockedWinner||null);}
        }
        showToast("Form deleted");
      }catch(e){showToast(e.message,"err");}
    }

    const myLbEntry=leaderboard.find(e=>e.entry_id===activeEntryId);
    const rstate=config.round_state;
    const rs= rstate==="open"
      ? {text:"🟢 Round OPEN", color:C.green}
      : rstate==="closed"
      ? {text:"🔒 Round CLOSED", color:C.red}
      : {text:"⏸️ Round idle",   color:C.muted};
    // Quick lookup of total per entry, for tab subtitles
    const lbByEntry = Object.fromEntries(leaderboard.map(e => [e.entry_id, e]));
    return (
      <div>
        {/* Slim round-status line on top */}
        <div style={{fontSize:12,color:rs.color,marginBottom:12,display:"flex",alignItems:"center",gap:6,fontWeight:600}}>
          {rs.text}
        </div>

        {/* Forms list — horizontal cards above the table. Always shown when
            editing is allowed so a brand-new user with zero forms can still
            click "+ Add form" to create their first one. */}
        {(entries.length>0 || (editable && openStage===1)) && (
          <div style={{marginBottom:0}}>
            <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",
              padding:"0 0 6px",fontWeight:600}}>My forms ({entries.length})</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"stretch"}}>
              {entries.map(e=>{
                const isActive=e.id===activeEntryId;
                const stageSub = !!(e.stages_submitted||{})[openStage];
                const submitted=stageSub; // visual "✓" follows the current stage
                // Count predictions for matches in the current stage that are
                // still editable (no result, not live) — same scope as Submit.
                const filled=(e.predictions||[]).filter(p=>
                  matchStageObj(p.match_n).n===openStage
                  && !results[p.match_n] && !liveMatches[p.match_n]
                  && p.score_a!=null && p.score_b!=null
                ).length;
                const lbE = lbByEntry[e.id];
                const rank = lbE ? leaderboard.indexOf(lbE) + 1 : null;
                const rankBadge = rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":rank?`#${rank}`:null;
                const isRenaming=renamingEntryId===e.id;
                return (
                  <div key={e.id} onClick={()=>!isRenaming&&switchEntry(e.id)} style={{
                    padding:"10px 14px",borderRadius:6,cursor:isRenaming?"default":"pointer",
                    background:isActive?C.panel:C.panel2,
                    borderLeft:`3px solid ${isActive?C.accent:"transparent"}`,
                    border:`1px solid ${isActive?C.accent:C.border}`,
                    borderLeftWidth:3,borderLeftColor:isActive?C.accent:"transparent",
                    transition:"all .12s",display:"flex",flexDirection:"column",gap:3,
                    minWidth:170,
                    // Active card is a real tab merging into the panel below:
                    //  • bg == panel bg → no colour seam at the bottom
                    //  • squared bottom + a panel-coloured bottom border that
                    //    overlaps the panel's lime top edge (so it reads "open")
                    //  • lime top/left/right border flows into the panel outline
                    ...(isActive?{
                      borderBottomLeftRadius:0,borderBottomRightRadius:0,
                      borderBottom:`2px solid ${C.panel}`,marginBottom:-2,
                      position:"relative",zIndex:2,
                    }:{}),
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:8,
                      fontSize:14,fontWeight:isActive?700:600,
                      color:isActive?C.accent:C.text}}>
                      {isRenaming?(
                        <input autoFocus value={renameVal}
                          onChange={ev=>setRenameVal(ev.target.value)}
                          onBlur={()=>commitRename(e.id)}
                          onKeyDown={ev=>{if(ev.key==="Enter")commitRename(e.id);if(ev.key==="Escape"){setRenamingEntryId(null);}}}
                          onClick={ev=>ev.stopPropagation()}
                          style={{background:"transparent",border:"none",outline:"none",
                            color:C.text,fontWeight:"inherit",fontSize:"inherit",
                            width:Math.max(80,renameVal.length*8)+"px",minWidth:80,maxWidth:200}}/>
                      ):(
                        <>
                          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",opacity:isFormActive(e)?1:0.55}}>{e.name}</span>
                          {(() => {
                            // One unified status badge — same size + shape regardless of state
                            // so users can scan the row of forms at a glance.
                            const base = {
                              display:"inline-flex",alignItems:"center",justifyContent:"center",
                              width:24,height:24,borderRadius:"50%",
                              fontSize:14,fontWeight:800,lineHeight:1,flexShrink:0,
                            };
                            if(!isFormActive(e)) return (
                              <span title="Inactive — didn't submit stage 1 before it closed"
                                style={{...base,background:"rgba(120,119,116,0.18)",color:C.muted,fontSize:13}}>🔒</span>
                            );
                            if(submitted) return (
                              <span title={`Submitted for stage ${openStage}`}
                                style={{...base,background:"rgba(16,185,129,0.20)",color:C.green,
                                  border:`1px solid ${C.green}`}}>✓</span>
                            );
                            if(config.round_state==="open") return (
                              <span title={`Not submitted for stage ${openStage}`}
                                style={{...base,background:"rgba(245,158,11,0.22)",color:"#f59e0b",
                                  border:`1px solid #f59e0b`,fontSize:16}}>●</span>
                            );
                            return (
                              <span title={`Not submitted — stage ${openStage} is closed`}
                                style={{...base,background:"rgba(239,68,68,0.20)",color:C.red,
                                  border:`1px solid ${C.red}`,fontSize:16}}>●</span>
                            );
                          })()}
                          {openStage===1&&config.round_state==="open"&&(
                            <span onClick={ev=>startRename(ev,e)} title="Rename form" style={{
                              fontSize:13,opacity:isActive?0.65:0.35,cursor:"pointer",lineHeight:1,
                              padding:"1px 4px",borderRadius:3,flexShrink:0,
                              transition:"opacity .15s",
                            }}
                            onMouseEnter={ev=>ev.currentTarget.style.opacity="1"}
                            onMouseLeave={ev=>ev.currentTarget.style.opacity=isActive?"0.65":"0.35"}
                            >✎</span>
                          )}
                        </>
                      )}
                    </div>
                    {lbE ? (
                      <div style={{display:"flex",alignItems:"baseline",gap:10,marginTop:2}}>
                        <span title={`Rank ${rank} of ${leaderboard.length}`}
                          style={{
                            fontSize:rank<=3?20:16,
                            fontFamily:rank<=3?"inherit":"monospace",
                            color:rank<=3?C.accent:(isActive?C.text:C.muted),
                            fontWeight:700,lineHeight:1,
                          }}>{rankBadge}</span>
                        <span style={{
                          fontFamily:"monospace",fontWeight:700,
                          fontSize:18,color:C.accent,lineHeight:1,
                        }}>{lbE.total}</span>
                        <span style={{
                          fontSize:11,color:isActive?C.muted:"rgba(107,122,153,0.85)",
                          letterSpacing:".5px",textTransform:"uppercase",fontWeight:600,
                        }}>pts</span>
                      </div>
                    ) : (
                      <div style={{fontSize:12,fontFamily:"monospace",
                        color:isActive?C.muted:"rgba(107,122,153,0.85)"}}>
                        {stageSub
                          ? `stage ${openStage} submitted`
                          : `${filled}/${submittableMatches.length} filled · stage ${openStage}`}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add form button — available while stage 1 is still the
                  current open stage. Once admin advances past stage 1, new
                  forms would skip prior stages and that's not fair. */}
              {editable && openStage===1 && (
                <div style={{position:"relative",display:"flex",alignItems:"stretch"}}>
                  <button onClick={()=>setShowNewMenu(v=>!v)} title="Add form" style={{
                    padding:"10px 16px",borderRadius:6,cursor:"pointer",
                    background:showNewMenu?C.panel2:"transparent",color:C.muted,
                    border:`1px dashed ${showNewMenu?C.accent:C.border}`,fontSize:13,minWidth:130,
                  }}>＋ Add form</button>
                  {showNewMenu&&(
                    <div style={{
                      position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:100,
                      background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,
                      minWidth:200,width:"max-content",maxWidth:340,
                      boxShadow:"0 4px 16px rgba(0,0,0,0.4)",overflow:"hidden",
                    }}
                    onMouseLeave={()=>setShowNewMenu(false)}>
                      <div style={{padding:"6px 12px",fontSize:11,color:C.muted,borderBottom:`1px solid ${C.border}`,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>Add form</div>
                      <button onClick={()=>createEntry(null)} style={{
                        display:"block",width:"100%",textAlign:"left",padding:"9px 14px",
                        background:"transparent",border:"none",color:C.text,cursor:"pointer",fontSize:13,
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background=C.panel}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                      >New empty form</button>
                      {entries.length>0&&<div style={{height:1,background:C.border}}/>}
                      {entries.map(src=>(
                        <button key={src.id} onClick={()=>createEntry(src.id)} style={{
                          display:"block",width:"100%",textAlign:"left",padding:"9px 14px",
                          background:"transparent",border:"none",color:C.text,cursor:"pointer",fontSize:13,
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                        }}
                        onMouseEnter={e=>e.currentTarget.style.background=C.panel}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                        >Copy from <strong>{src.name}</strong></button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Connected tab panel — the selected form card above merges into this
            panel (browser-tab metaphor). The active card's bg matches this
            panel's bg so there's no seam, and the lime outlines the tab and
            continues along this panel's top edge. */}
        <div style={activeEntry ? {
          background:C.panel, border:`1px solid ${C.border}`,
          borderTop:`2px solid ${C.accent}`, borderRadius:"0 8px 8px 8px",
          padding:"16px 16px 6px",
        } : {}}>

        {/* Standalone banners that replace dedicated rows in the toolbar. */}
        {config.round_state==="idle"&&<InfoBlock warn>⏸️ <b>No betting round is open yet.</b> The admin needs to open a round before you can enter predictions.</InfoBlock>}
        {activeEntry&&!activeFormActive&&<InfoBlock warn>🔒 <b>This form is inactive.</b> It didn't submit stage 1 before it closed, so it can't be edited or submitted in any later stage. You can still view its predictions and stage 1 points.</InfoBlock>}

        {/* Sticky action bar — sits under the form tabs and pins to the top of
            the table on scroll. Progress + champion on the left, Delete +
            Submit on the right. Submit only enables once the form is complete
            (all matches filled + a champion picked). */}
        {activeEntry&&activeFormActive&&(() => {
          const total = submittableMatches.length;
          const complete = total > 0 && filledCount === total;
          const winnerLocked = openStage > 1 || !editable;
          const shownWinner  = myWinner || lockedWinner;
          const blockers = [];
          if (filledCount < total) blockers.push(`🎯 ${total-filledCount} match${total-filledCount===1?"":"es"} to fill`);
          if (winnerNeededForSubmit) blockers.push("🏆 pick a champion");
          // Submit is off and the champion is the missing piece → draw the eye to
          // the picker; if it's the *only* thing left, pop it open automatically.
          const championBlocking    = winnerNeededForSubmit && !canSubmit;
          const championOnlyBlocker = championBlocking && complete;
          const showDelete = !activeEntry.submitted_at && entries.length>1 && editable;
          // Draft = a submission snapshot exists AND the current stage isn't
          // submitted (i.e. the user edited after submitting) → offer Reset draft.
          const snapAt = activeEntry.submitted_snapshot_at;
          const inDraft = editable && !currentStageSubmitted && !!snapAt;
          const snapWhen = snapAt ? (()=>{ const k=kickoffParts(snapAt,tz); return k?`${k.short} · ${k.time}`:""; })() : "";
          // Rank for the middle of the bar (points come from myLbEntry.total).
          const rank = myLbEntry ? leaderboard.indexOf(myLbEntry)+1 : null;
          // Shared tile look for the centered Champion / Rank / Points group.
          const tileBase = {display:"inline-flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,minWidth:62,padding:"4px 12px",borderRadius:8,background:C.bg,border:`1px solid ${C.border}`};
          const tileLabel = {fontSize:9,letterSpacing:".6px",textTransform:"uppercase",color:C.muted,fontWeight:700};
          const tileVal = {fontSize:19,fontFamily:"monospace",fontWeight:800,lineHeight:1.15};
          return (
            <div style={{position:"sticky",top:0,zIndex:30,marginBottom:14}}>
            <div style={{
              background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.accent}`,
              borderRadius:10,padding:"9px 12px",boxShadow:"0 6px 18px rgba(0,0,0,0.35)",
              ...(isMobile
                ? {display:"flex",flexDirection:"column",gap:8}
                : {display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:12}),
            }}>
              {/* LEFT — progress + champion */}
              <div style={{display:"flex",alignItems:"stretch",gap:10,minWidth:0}}>
                <span style={{
                  display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:999,
                  fontSize:12,fontWeight:600,whiteSpace:"nowrap",alignSelf:"center",
                  background: complete ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                  color: complete ? C.green : "#f59e0b",
                  border: `1px solid ${complete ? "rgba(16,185,129,0.4)" : "rgba(245,158,11,0.4)"}`,
                }}>
                  {complete ? "✓" : "🏁"} <b style={{fontFamily:"monospace"}}>{filledCount}/{total}</b> filled
                </span>
                {winnerLocked ? (
                  <div title="Tournament winner pick (+10 pts)" style={tileBase}>
                    <span style={tileLabel}>Champion</span>
                    <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:14,fontWeight:700,color:C.accent,maxWidth:178,whiteSpace:"nowrap",overflow:"hidden"}}>
                      <span style={{flexShrink:0}}>{shownWinner?flag(shownWinner):"🏆"}</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{shownWinner||"—"}</span>
                      <span style={{fontSize:9,opacity:.8}}>🔒</span>
                    </span>
                  </div>
                ) : (
                  <span data-champion-box style={{display:"inline-flex"}}>
                    <TeamPicker value={myWinner} onChange={saveWinner} teams={teams} disabled={false} variant="tile" label="Champion" highlight={championBlocking} autoOpen={championOnlyBlocker}/>
                  </span>
                )}
              </div>

              {/* CENTER + RIGHT — on mobile these merge into one row */}
              <div style={isMobile
                ? {display:"flex",alignItems:"center",gap:8,justifyContent:"space-between"}
                : {display:"contents"}}>
              {/* CENTER — Rank · Points */}
              <div style={{justifySelf:"center", display:"flex", alignItems:"stretch", gap:8, transform: isMobile?undefined:"translateX(-34px)"}}>
                <div style={tileBase}>
                  <span style={tileLabel}>Rank</span>
                  <b style={{...tileVal,color:C.text}}>{rank?`#${rank}`:"—"}</b>
                </div>
                <div title={myLbEntry?`"${activeEntry.name}" — ${myLbEntry.total} pts`:"Submit to get on the leaderboard"} style={tileBase}>
                  <span style={tileLabel}>Points</span>
                  <b style={{...tileVal,color:C.accent}}>{myLbEntry?myLbEntry.total:0}</b>
                </div>
              </div>

              {/* RIGHT — Stats 📊 + Delete + Submit/badge. */}
              <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end",flexWrap:"nowrap",minWidth:0}}>
                {/* ── Form-level stats 📊 ── */}
                {myLbEntry&&(()=>{
                  const leader=leaderboard[0];
                  const gapLeader=myLbEntry.total-(leader?.total||0);
                  const favRows=leaderboard.filter(e=>(e.entry_id||e.user_id)!==(myLbEntry.entry_id||myLbEntry.user_id)&&favorites.includes(e.entry_id||e.user_id));
                  const closestFav=favRows.length?favRows.reduce((a,b)=>Math.abs(b.total-myLbEntry.total)<Math.abs(a.total-myLbEntry.total)?b:a):null;
                  const gapFav=closestFav?myLbEntry.total-closestFav.total:null;
                  const freq={};
                  Object.values(myPreds).forEach(p=>{if(p&&p[0]!=null&&p[1]!=null){const [lo,hi]=[Math.min(p[0],p[1]),Math.max(p[0],p[1])];const k=`${lo}:${hi}`;freq[k]=(freq[k]||0)+1;}});
                  const top3scores=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,3);
                  const cards=[
                    {label:"From leader",value:gapLeader===0?"+0":(gapLeader>0?`+${gapLeader}`:gapLeader),sub:(leader?.name||"")+" · "+(leader?.total||0)+" pts",border:gapLeader>=0?C.green:C.red,icon:"📉"},
                    closestFav?{label:"From favorite",value:gapFav===0?"+0":(gapFav>0?`+${gapFav}`:gapFav),sub:closestFav.name+" · "+closestFav.total+" pts"+(gapFav>0?" ↓":" ↑"),border:"#facc15",icon:"★"}:{label:"Your rank",value:`#${leaderboard.indexOf(myLbEntry)+1}`,sub:`of ${leaderboard.length}`,border:C.indigo,icon:"🏅"},
                    {label:"Correct direction",value:`${myLbEntry.scored_matches>0?Math.round(myLbEntry.correct_dir/myLbEntry.scored_matches*100):0}%`,sub:`${myLbEntry.correct_dir} of ${myLbEntry.scored_matches}`,border:C.green,icon:"↗️"},
                    {label:"Exact scores",value:`${myLbEntry.exact}/${myLbEntry.scored_matches}`,sub:`${myLbEntry.scored_matches>0?Math.round(myLbEntry.exact/myLbEntry.scored_matches*100):0}% of matches`,border:C.accent,icon:"🎯"},
                  ];
                  return (
                    <div ref={statsPopup.triggerRef} style={{position:"relative"}}>
                      <button onClick={()=>setStatsOpen(o=>!o)} title="Form stats"
                        style={{background:statsOpen?"rgba(163,230,53,0.08)":"transparent",border:`1px solid ${statsOpen?C.accent:"transparent"}`,borderRadius:8,padding:"4px 8px",cursor:"pointer",color:statsOpen?C.accent:C.muted,display:"flex",alignItems:"center",fontSize:18,lineHeight:1,fontFamily:"inherit",transition:"all .15s"}}>
                        📊
                      </button>
                      {statsOpen&&(
                        <>
                          <div onClick={()=>setStatsOpen(false)} style={STATS_BACKDROP_STYLE}/>
                          <div style={statsModalStyle(isMobile)}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
                              <div style={{fontSize:11,color:C.text,display:"flex",alignItems:"center",gap:6}}>
                                <span style={{background:"rgba(163,230,53,0.1)",color:C.accent,border:`1px solid rgba(163,230,53,0.25)`,borderRadius:999,padding:"2px 9px",fontSize:11,fontWeight:700}}>{myLbEntry.name}</span>
                                <span>{myLbEntry.scored_matches} matches with results</span>
                              </div>
                              <StatsCloseBtn onClick={()=>setStatsOpen(false)}/>
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:7,marginBottom:top3scores.length?10:0}}>
                              {cards.map((s,i)=>(
                                <div key={i} style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${s.border}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                                  <div style={{fontSize:13,marginBottom:2}}>{s.icon}</div>
                                  <div style={{fontSize:18,fontWeight:700,lineHeight:1.1,marginBottom:2,color:C.text}}>{s.value}</div>
                                  <div style={{fontSize:11,color:C.text,marginBottom:1}}>{s.label}</div>
                                  <div style={{fontSize:10,color:C.text}}>{s.sub}</div>
                                </div>
                              ))}
                            </div>
                            {top3scores.length>0&&(
                              <div>
                                <div style={{fontSize:11,color:C.text,marginBottom:6}}>My top predicted scores</div>
                                <div style={{display:"flex",gap:6}}>
                                  {top3scores.map(([score,count],i)=>(
                                    <div key={i} style={{flex:1,background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 6px",textAlign:"center"}}>
                                      <div style={{fontSize:15,fontWeight:700,color:C.text}}>{score}</div>
                                      <div style={{fontSize:10,color:C.text,marginTop:2}}>{count}×</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
                {showDelete && (
                  <Btn ghost red onClick={()=>deleteEntryById(activeEntry.id)}>Delete</Btn>
                )}
                {editable && currentStageSubmitted ? (
                  <span style={{
                    background:"rgba(16,185,129,0.10)",color:C.green,
                    border:"1px solid rgba(16,185,129,0.35)",
                    padding:"6px 14px",borderRadius:8,fontSize:13,fontWeight:700,whiteSpace:"nowrap",
                  }}>✓ Stage {openStage} submitted</span>
                ) : editable ? (
                  <button
                    onClick={submitEntry}
                    disabled={!canSubmit||submitting}
                    className={canSubmit&&!submitting?"submit-ready":undefined}
                    title={!canSubmit&&blockers.length?`To submit: ${blockers.join(" · ")}`:""}
                    style={{
                      border:0,borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,
                      fontFamily:"inherit",whiteSpace:"nowrap",
                      cursor:(!canSubmit||submitting)?"not-allowed":"pointer",
                      background:(!canSubmit||submitting)?"#23304a":C.green,
                      color:(!canSubmit||submitting)?"#5d7290":"#fff",
                    }}>
                    {submitting ? "…" : entries.length>1 ? `Submit "${activeEntry?.name||"this form"}"` : "Submit"}
                  </button>
                ) : null}
              </div>
              </div>{/* end mobile CENTER+RIGHT wrapper */}
            </div>
            {/* Reset draft strip — appears when the form has un-submitted edits
                (a submission snapshot exists + current stage not submitted). */}
            {inDraft && (
              <div style={{
                display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",
                marginTop:8,background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.35)",
                borderRadius:8,padding:"7px 12px",
              }}>
                <span style={{color:"#f59e0b",fontSize:12.5,fontWeight:600}}>
                  ✎ You have unsaved changes since your last submission
                  {snapWhen && <span style={{color:C.muted,fontWeight:400}}> · {snapWhen}</span>}
                </span>
                <button onClick={resetDraft} style={{
                  display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",fontFamily:"inherit",
                  color:"#f59e0b",fontWeight:700,fontSize:12,whiteSpace:"nowrap",
                  background:"rgba(245,158,11,0.10)",border:"1px solid rgba(245,158,11,0.45)",
                  padding:"5px 11px",borderRadius:999,
                }}>↩ Reset draft</button>
              </div>
            )}
            </div>
          );
        })()}

        {!predsLoaded&&config.round_state==="open"&&(
          <div style={{textAlign:"center",padding:"10px",color:C.muted,fontSize:13,marginBottom:8}}>
            Loading your predictions…
          </div>
        )}

        {STAGES.map(s => {
          const stageMatches = matches.filter(m => m.n >= s.first && m.n <= s.last).sort((a,b)=>a.t<b.t?-1:a.t>b.t?1:a.n-b.n);
          if (stageMatches.length === 0) return null;
          const isCollapsed = collapsedStages.has(s.n);

          // Locked stage: show fixtures with dates, collapsed by default
          if (s.n > openStage) {
            const lockedCollapsed = collapsedStages.has(s.n);
            return (
              <div key={s.n}>
                <div onClick={()=>toggleStage(s.n)} style={{
                  background:C.panel2,padding:"8px 12px",borderRadius:6,
                  margin:"16px 0 6px",fontWeight:600,color:C.muted,fontSize:14,
                  cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",
                  userSelect:"none",
                }}>
                  <span>
                    <span style={{marginRight:6}}>🔒</span>
                    Stage {s.n}: {s.name}
                    <span style={{marginLeft:8,fontSize:12,fontWeight:400}}>locked</span>
                  </span>
                  <span style={{fontSize:13,color:C.muted,lineHeight:1}}>{lockedCollapsed?"▸":"▾"}</span>
                </div>
                {!lockedCollapsed && (
                  <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:8}}>
                    {stageMatches.map(m=>(
                      <MatchRow key={m.n} match={resolvedMatch(m,results,matches)}
                        pred={null} result={null} liveData={null}
                        editable={false} adminResult={false} roundState="closed"
                        onSave={null} onResultSave={null} tz={tz}/>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          const stageFilled = stageMatches.filter(m => myPreds[m.n]?.[0] != null && myPreds[m.n]?.[1] != null).length;
          const stageDone   = stageMatches.filter(m => results[m.n]).length;
          const isCurrent = openStage === s.n;
          const isPast    = s.n < openStage;
          // A match is editable while its stage is the current open one,
          // the round is open, and the match has no result / isn't live.
          // Editing after Submit is now allowed — savePred invalidates the
          // stage submission so the user has to click Submit again. The
          // backend mirrors the same rule.
          const matchEditable = (m) =>
            isCurrent
            && editable
            && !results[m.n]
            && !liveMatches[m.n];

          // Header colors / icon vary per stage state
          const headerColor = isPast ? C.muted : isCurrent ? C.indigo : C.muted;
          const headerIcon  = isPast ? "✓" : isCurrent ? "▶" : "·";
          const stageStatus = isPast
            ? `${stageDone}/${stageMatches.length} played · stage closed`
            : isCurrent
              ? (editable
                  ? `${stageFilled}/${stageMatches.length} filled · open for predictions`
                  : `${stageFilled}/${stageMatches.length} filled · round closed`)
              : `${stageFilled}/${stageMatches.length} filled`;

          return (
            <div key={s.n}>
              {/* Clickable collapsible header */}
              <div onClick={()=>toggleStage(s.n)} style={{
                background:isPast?C.panel2:isCurrent?"rgba(99,102,241,0.08)":C.panel2,
                padding:"8px 12px",borderRadius:6,
                margin:"16px 0 6px",fontWeight:600,color:headerColor,fontSize:14,
                cursor:"pointer",display:"flex",alignItems:"center",
                justifyContent:"space-between",userSelect:"none",
                border:isCurrent?`1px solid rgba(99,102,241,0.35)`:`1px solid ${C.border}`,
              }}>
                <span>
                  <span style={{marginRight:6,opacity:isPast?0.7:1}}>{headerIcon}</span>
                  Stage {s.n}: {s.name}
                  <span style={{marginLeft:8,fontSize:12,fontWeight:400,color:C.muted}}>
                    {stageStatus}
                  </span>
                </span>
                <span style={{display:"flex",alignItems:"center",gap:10}}>
                  {/* Per-stage Random Results — visible only while THIS stage
                      is the open one, the round is open, and the user
                      hasn't already submitted this stage on this form. */}
                  {isCurrent && editable && !(activeEntry?.stages_submitted||{})[s.n] && (
                    <button
                      onClick={(ev)=>{ ev.stopPropagation(); randomFillStage(s.n); }}
                      title="Fill empty matches in this stage with random scores"
                      style={{
                        padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,
                        background:"transparent",color:C.accent,border:`1px solid ${C.accent}`,cursor:"pointer",
                      }}>
                      🎲 Random Results
                    </button>
                  )}
                  {/* Import CSV stays available for the whole time the stage is
                      open — even after you've submitted — so you can re-import a
                      revised file. Importing re-opens the affected stage for
                      editing (clears its submission), so you just Submit again. */}
                  {isCurrent && editable && (
                    <>
                      <label
                        onClick={(ev)=>ev.stopPropagation()}
                        title="Import predictions from a CSV"
                        style={{
                          display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",
                          padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,
                          background:"transparent",color:C.accent,border:`1px solid ${C.accent}`,
                        }}>
                        ⬆ Import CSV
                        <input type="file" accept=".csv,text/csv" style={{display:"none"}}
                          onChange={(e)=>{const f=e.target.files&&e.target.files[0]; if(f) importCsv(f, s.n); e.target.value="";}}/>
                      </label>
                      <CsvHelp/>
                    </>
                  )}
                  <span style={{fontSize:13,color:C.muted,lineHeight:1}}>
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                </span>
              </div>
              {!isCollapsed && (
                <div style={{
                  background:isPast?"rgba(20,28,52,0.5)":C.panel,
                  border:`1px solid ${isCurrent?"rgba(99,102,241,0.25)":C.border}`,
                  borderRadius:8,padding:10,
                  opacity:!predsLoaded&&config.round_state==="open"?0.6:1,
                  transition:"opacity .3s",marginBottom:8,
                }}>
                  {stageMatches.map(m=>(
                    <Fragment key={m.n}>
                      <StageMatchLabel m={m}/>
                      <MatchRow match={resolvedMatch(m, results, matches)}
                        pred={myPreds[m.n]??null}
                        result={results[m.n]??null}
                        liveData={liveMatches[m.n]??null}
                        editable={matchEditable(m)}
                        adminResult={false}
                        roundState={config.round_state}
                        onSave={savePred}
                        onResultSave={()=>{}}
                        tz={tz}/>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>{/* /connected tab panel */}
      </div>
    );
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────
  function LeaderboardView(){
    const winnerKnown=!!config.tournament_winner;
    // Fair play: don't reveal other players' champions while stage 1 is still
    // open (a pick can still change then). Once stage 1 closes — i.e. round 1
    // has started (round_state "closed") or the admin has advanced past it —
    // every pick is locked, so it's safe to reveal to all. Your own always shows.
    const winnersRevealed=config.round_state==="closed"||(config.current_stage||1)>1;
    // Favorites (favorites array + favOnly filter + toggleFavorite) are lifted to
    // App so the 10s leaderboard poll doesn't reset them. A row is favorited by
    // its key (entry_id, falling back to user_id).
    const rowKeyOf = (row) => row.entry_id || row.user_id;
    // The user's own forms are always favorited (and locked); other rows are
    // favorited only if explicitly starred into the persisted list.
    const isFavRow = (row) => row.user_id===user?.id || favorites.includes(rowKeyOf(row));
    // NOTE: favOnly / hoveredRow / simMode / simLb / simLoading and the sim
    // fetch effect live in App (lifted) so this view can be called inline as
    // {LeaderboardView()} without remounting on the 10s poll.
    // Clicking a leaderboard row jumps to that participant's bets. Allow it
    // whenever the By-participant tab itself is available (i.e. there are
    // entries on the board) — the backend still gates WHAT is shown (the
    // current open stage stays hidden for non-admins while the round is open,
    // and is revealed once it's closed). Previously this also required a
    // result to already exist, which made the rows non-clickable on a freshly
    // closed stage even though the By-participant tab worked.
    const canJumpToParticipant = !!user && (user.is_admin || leaderboard.length > 0);
    // The active user's own row on the board (their active form, else any row
    // of theirs) — used as the "your form" side of a comparison.
    const myLbRow = leaderboard.find(e=>e.entry_id===activeEntryId) || leaderboard.find(e=>e.user_id===user?.id) || null;
    const myLbKey = myLbRow ? (myLbRow.entry_id || myLbRow.user_id) : null;
    // Clicking a leaderboard row compares that form against the active form,
    // in place (the table is swapped for the compare view — same tab).
    const jumpToParticipant = (row) => {
      if (!canJumpToParticipant) return;
      const key = row.entry_id || row.user_id;
      if (key === myLbKey) return;   // can't compare a form with itself
      setMatchSimMode(false); setMatchSimA(""); setMatchSimB("");
      setCompareKey(key);
    };

    // ── Compare mode: swap the table for the side-by-side compare view ───────
    if (compareKey) {
      const themRow = leaderboard.find(e=>(e.entry_id||e.user_id)===compareKey) || null;
      const myRank  = myLbRow  ? leaderboard.indexOf(myLbRow)+1  : null;
      const themRank= themRow  ? leaderboard.indexOf(themRow)+1  : null;
      // Dropdown list: favorited forms first (own forms + starred), then the
      // rest — each group kept in leaderboard (rank) order. Sort is stable.
      const isFavForm = (e)=> e.user_id===user?.id || favorites.includes(e.entry_id||e.user_id);
      const compareForms = leaderboard
        .filter(e=>(e.entry_id||e.user_id)!==myLbKey)
        .map(e=>({key:e.entry_id||e.user_id, name:e.name, rank:leaderboard.indexOf(e)+1, fav:isFavForm(e)}))
        .sort((a,b)=>(b.fav?1:0)-(a.fav?1:0) || a.name.localeCompare(b.name));
      // All leaderboard entries belonging to the current user (for multi-entry picker)
      const myForms = leaderboard
        .filter(e=>e.user_id===user?.id)
        .map(e=>({key:e.entry_id||e.user_id, name:e.name, rank:leaderboard.indexOf(e)+1}));
      // Resolve which "my" row/preds to use based on compareMyKey
      const activeMyKey = compareMyKey || myLbKey;
      const activeMyRow = compareMyKey ? leaderboard.find(e=>(e.entry_id||e.user_id)===compareMyKey) : myLbRow;
      const activeMyPreds = compareMyPreds ?? myPreds;
      const activeMyWinner = compareMyKey ? compareMyWinner : myWinner;
      const activeMyRank = activeMyRow ? leaderboard.indexOf(activeMyRow)+1 : myRank;
      return (
        <div>
          <TodaysGames matches={matches} results={results} liveMatches={liveMatches} tz={tz}/>
          <CompareView
            matches={matches} results={results} liveMatches={liveMatches} isMobile={isMobile}
            myName={activeMyRow?activeMyRow.name:"Your form"} myPreds={activeMyPreds} myTotal={activeMyRow?activeMyRow.total:0} myRank={activeMyRank} myWinner={activeMyWinner}
            myForms={myForms} myKey={activeMyKey} onMyPick={(k)=>{ setCompareMyKey(k===myLbKey?null:k); }}
            theirKey={compareKey} theirName={themRow?themRow.name:"—"}
            theirPreds={comparePreds} theirTotal={themRow?themRow.total:0} theirRank={themRank} theirWinner={compareWinner} winnersRevealed={config.round_state==="closed"||(config.current_stage||1)>1}
            forms={compareForms} loading={compareLoading}
            onBack={()=>{ setCompareKey(null); setCompareMyKey(null); }} onPick={(k)=>setCompareKey(k)}
            tz={tz}/>
        </div>
      );
    }

    // Simulate mode — state + fetch effect live in App (see lifted block);
    // unplayedPredMatches / canSim / simMode / simLb / simLoading are in scope
    // here via closure.
    // Per-row "diff vs actual" badge data
    const actualTotalsByEntry = Object.fromEntries(leaderboard.map(e => [e.entry_id, e.total]));
    const actualRankByEntry = Object.fromEntries(leaderboard.map((e,i) => [e.entry_id, i+1]));

    const displayLb = (simMode && simLb)
      ? simLb.map(e => ({...e, _simDiff: e.total - (actualTotalsByEntry[e.entry_id] ?? e.total)}))
      : leaderboard;

    // Favorites filter — every row (including the user's own forms) can be a
    // favorite, so the filter is a straight "is this row favorited" check.
    const filteredLb = favOnly ? displayLb.filter(isFavRow) : displayLb;
    const hasFavs = displayLb.some(isFavRow);
    // Discoverability hint: show while the user hasn't starred anyone else yet
    // (their own form doesn't count), the filter is off, and there's at least
    // one other form to star. Gold ★/☆ + a dismissible banner teach the filter.
    const showFavHint = !favHintDismissed && !favOnly
      && favorites.length===0
      && displayLb.some(r=>r.user_id!==user?.id);
    const HINT_GOLD = "#facc15";

    // Per-stage rank movement: standings snapshot taken when the current stage
    // opened (server-side, in config.stage_baseline). A row's movement = its
    // rank at the start of this stage minus its current rank (+N climbed,
    // -N dropped). Only for the current stage's baseline, and not in Simulate.
    const baselineRanks = (config.stage_baseline
      && config.stage_baseline.stage === (config.current_stage || 1))
      ? config.stage_baseline.ranks : null;

    // "Match picks" — a single column (right of Points) showing every form's
    // prediction for ONE game, chosen via the header dropdown. By default the
    // column follows the current game (Auto: live → latest-finished → next game
    // 10min before kickoff; see computeAutoMatchN); the user can pin any game.
    // Played/live games tint each pick by points (digits green/red, box by
    // total); upcoming games just list the picks. Gated behind showLivePreds.
    const isLiveM = (m)=> !!(liveMatches[m.n] && liveMatches[m.n].is_live);
    const selMatch = selectedMatchN!=null ? matches.find(m=>m.n===selectedMatchN) : null;
    const selLive = !!(selMatch && isLiveM(selMatch));
    const selRes = selMatch ? results[selMatch.n] : null;
    const selLiveData = selMatch ? liveMatches[selMatch.n] : null;
    const selScore = selMatch
      ? (selLive ? [selLiveData.score_a, selLiveData.score_b] : (selRes ? [selRes[0], selRes[1]] : null))
      : null;
    const selKoParts = selMatch ? kickoffParts(selMatch.t, tz) : null;
    const selPinned = pinnedMatchN!=null && selMatch && pinnedMatchN===selMatch.n;
    const hasFocus = !!selMatch;
    const showFocusCols = showLivePreds && hasFocus && (!simMode || matchSimMode);
    // "Since last game-day" rank indicator: visible after the last game of a
    // game-day finishes and hidden once the next game-day's first kickoff passes.
    //
    // Game-days are grouped in CT (the canonical tournament timezone) — in CT
    // the WC schedule clusters cleanly into calendar days (~14:00–23:00 CT, never
    // crossing CT midnight), and daily snapshots are keyed by CT date too. Using
    // the viewer's display tz here would split one game-day across two calendar
    // days for far-east timezones and never match the CT-keyed snapshots.
    const ctDayKey = (t) => new Intl.DateTimeFormat("en-CA", {
      year:"numeric", month:"2-digit", day:"2-digit", timeZone:"America/Chicago"
    }).format(new Date(t));
    const matchesByDay = {};
    for (const m of matches) {
      if (!m.t) continue;
      const day = ctDayKey(m.t);
      if (!matchesByDay[day]) matchesByDay[day] = [];
      matchesByDay[day].push(m);
    }
    const lastCompletedDay = Object.entries(matchesByDay)
      .filter(([, ms]) => ms.every(m => results[m.n]))
      .map(([day]) => day)
      .sort()
      .pop() || null;
    const nextGameKickoffs = lastCompletedDay
      ? matches
          .filter(m => m.t && ctDayKey(m.t) > lastCompletedDay)
          .map(m => new Date(m.t).getTime())
      : [];
    const nextDayStarted = nextGameKickoffs.length > 0 && Math.min(...nextGameKickoffs) <= Date.now();
    const showPrevRankIndicator = !!lastCompletedDay && !nextDayStarted;
    // Snapshots are keyed by CT date — same grouping as above, so the last
    // completed game-day's key is the snapshot key directly.
    const prevRankSnapshot = lastCompletedDay ? (rankSnapshots[lastCompletedDay] || {}) : {};
    // Per-row pick for the selected game: the leaderboard payload covers the
    // auto/live game (spotlight_preds); a pinned/older game comes from the
    // on-demand matchPicks cache.
    const pickFor = (row)=> (matchPicks[selectedMatchN]?.[row.entry_id]) ?? row.spotlight_preds?.[selectedMatchN];
    // Games offered in the dropdown: all matches, newest-relevant first
    // (live, then by kickoff descending), resolved to real team codes.
    const gameOptions = matches
      .map(m=>({m, ko:(()=>{const d=new Date(m.t).getTime();return isNaN(d)?0:d;})(),
        a:resolveTeamDeep(m.a,results,matches), b:resolveTeamDeep(m.b,results,matches),
        live:isLiveM(m), ended:!!results[m.n], viewable:matchViewable(m)}))
      .sort((x,y)=> x.ko-y.ko || x.m.n-y.m.n);

    // Per-form picker chips (only when the user owns 2+ forms). Shared between
    // the desktop (slide-in beside the toggle) and mobile (wrap below) layouts.
    const formChips = entries.map((e) => {
      const isThisActive = effectiveSimEntryId === e.id;
      return (
        <button key={e.id}
          onClick={()=>setSimEntryId(e.id)}
          title={`Simulate using "${e.name}"`}
          style={{
            padding:"4px 12px",borderRadius:999,
            border:`1px solid ${C.indigo}`,cursor:"pointer",fontSize:12,
            fontWeight:600,whiteSpace:"nowrap",fontFamily:"inherit",
            background:isThisActive?C.indigo:"transparent",
            color:isThisActive?"white":C.indigo,
            transition:"all .15s",
            maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",
          }}>
          {e.name}
        </button>
      );
    });

    return (
      <div>
        {/* Today's Games subsumes the old standalone LIVE NOW banner. */}
        <TodaysGames matches={matches} results={results} liveMatches={liveMatches} tz={tz}/>
        <div style={{marginBottom:14}}><RoundPill/></div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          marginBottom:12,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <h1 style={{color:C.accent,fontSize:20,margin:0}}>🏆 Leaderboard</h1>
            {/* ── Group stats 📊 (moved here, 👥 block below removed) ── */}
            {false && (() => {
              const myRow = leaderboard.find(e => e.entry_id === activeEntryId);
              if (!myRow) return null;
              const leader = leaderboard[0];
              const favRows = leaderboard.filter(e =>
                (e.entry_id||e.user_id) !== (myRow.entry_id||myRow.user_id) &&
                favorites.includes(e.entry_id||e.user_id)
              );
              const closestFav = favRows.length
                ? favRows.reduce((a,b) => Math.abs(b.total-myRow.total) < Math.abs(a.total-myRow.total) ? b : a)
                : null;
              const gapLeader = myRow.total - leader.total;
              const gapFav = closestFav ? myRow.total - closestFav.total : null;
              return (
                <div style={{position:"relative"}}>
                  <button
                    onClick={()=>setStatsOpen(o=>!o)}
                    title="My stats"
                    style={{
                      background:statsOpen?"rgba(163,230,53,0.08)":"transparent",
                      border:`1px solid ${statsOpen?C.accent:"transparent"}`,
                      borderRadius:8,padding:"4px 6px",cursor:"pointer",
                      color:statsOpen?C.accent:C.muted,
                      display:"flex",alignItems:"center",
                      fontSize:18,lineHeight:1,fontFamily:"inherit",
                      transition:"all .15s",
                    }}>
                    📊
                  </button>
                  {/* floating dropdown */}
                  {statsOpen && (
                    <>
                      {/* backdrop to close on outside click */}
                      <div onClick={()=>setStatsOpen(false)} style={STATS_BACKDROP_STYLE}/>
                      <div style={statsModalStyle(isMobile)}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
                          <div style={{fontSize:11,color:C.text,display:"flex",alignItems:"center",gap:6}}>
                            <span style={{background:"rgba(163,230,53,0.1)",color:C.accent,border:`1px solid rgba(163,230,53,0.25)`,borderRadius:999,padding:"2px 9px",fontSize:11,fontWeight:700}}>
                              {myRow.name}
                            </span>
                            <span>{myRow.scored_matches} matches with results</span>
                          </div>
                          <StatsCloseBtn onClick={()=>setStatsOpen(false)}/>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:7,marginBottom:10}}>
                          {[
                            {label:"From leader",value:gapLeader===0?"+0":(gapLeader>0?`+${gapLeader}`:gapLeader),sub:leader.name+" · "+leader.total+" pts",border:gapLeader>=0?C.green:C.red,icon:"📉"},
                            {label:"Correct direction",value:`${myRow.scored_matches>0?Math.round(myRow.correct_dir/myRow.scored_matches*100):0}%`,sub:`${myRow.correct_dir} of ${myRow.scored_matches}`,border:C.green,icon:"↗️"},
                            {label:"Exact scores",value:`${myRow.exact}/${myRow.scored_matches}`,sub:`${myRow.scored_matches>0?Math.round(myRow.exact/myRow.scored_matches*100):0}% of matches`,border:C.accent,icon:"🎯"},
                            closestFav
                              ? {label:"From favorite",value:gapFav===0?"+0":(gapFav>0?`+${gapFav}`:gapFav),sub:closestFav.name+" · "+closestFav.total+" pts"+(gapFav>0?" ↓":" ↑"),border:"#facc15",icon:"★"}
                              : {label:"Your rank",value:`#${leaderboard.indexOf(myRow)+1}`,sub:`of ${leaderboard.length}`,border:C.indigo,icon:"🏅"},
                          ].map((s,i)=>(
                            <div key={i} style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${s.border}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                              <div style={{fontSize:13,marginBottom:2}}>{s.icon}</div>
                              <div style={{fontSize:18,fontWeight:700,lineHeight:1.1,marginBottom:2,color:C.text}}>{s.value}</div>
                              <div style={{fontSize:11,color:C.text,marginBottom:1}}>{s.label}</div>
                              <div style={{fontSize:10,color:C.text}}>{s.sub}</div>
                            </div>
                          ))}
                        </div>
                        {/* top 3 most-predicted scores for this form */}
                        {(()=>{
                          const freq={};
                          Object.values(myPreds).forEach(p=>{if(p&&p[0]!=null&&p[1]!=null){const [lo,hi]=[Math.min(p[0],p[1]),Math.max(p[0],p[1])];const k=`${lo}:${hi}`;freq[k]=(freq[k]||0)+1;}});
                          const top3=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,3);
                          if(!top3.length) return null;
                          return (
                            <div>
                              <div style={{fontSize:11,color:C.text,marginBottom:6}}>My top predicted scores</div>
                              <div style={{display:"flex",gap:6}}>
                                {top3.map(([score,count],i)=>(
                                  <div key={i} style={{flex:1,background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 6px",textAlign:"center"}}>
                                    <div style={{fontSize:15,fontWeight:700,color:C.text}}>{score}</div>
                                    <div style={{fontSize:10,color:C.text,marginTop:2}}>{count}×</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {/* ── Group stats 📊 ── */}
            {leaderboard.length>0&&(()=>{
              const stageForStats=config.round_state==="open"?(config.current_stage||1)-1:(config.current_stage||1);
              if(stageForStats<1) return null;
              const handleOpen=()=>{
                setGroupStatsOpen(o=>{
                  if(!o && !groupStatsData){
                    api.getGroupStats(stageForStats).then(d=>setGroupStatsData(d)).catch(()=>{});
                  }
                  return !o;
                });
              };
              return (
                <div ref={groupStatsPopup.triggerRef} style={{position:"relative"}}>
                  <button onClick={handleOpen} title="Group stats"
                    style={{background:groupStatsOpen?"rgba(163,230,53,0.08)":"transparent",border:`1px solid ${groupStatsOpen?C.accent:"transparent"}`,borderRadius:8,padding:"4px 6px",cursor:"pointer",color:groupStatsOpen?C.accent:C.muted,display:"flex",alignItems:"center",fontSize:18,lineHeight:1,fontFamily:"inherit",transition:"all .15s"}}>
                    📊
                  </button>
                  {groupStatsOpen&&(()=>{
                    // Stats are computed lazily — only when the panel is open — so the
                    // leaderboard render/poll doesn't pay for them while it's closed.
                    const pickCounts={};
                    leaderboard.forEach(e=>{if(e.winner_pick){pickCounts[e.winner_pick]=(pickCounts[e.winner_pick]||0)+1;}});
                    const top3picks=Object.entries(pickCounts).sort((a,b)=>b[1]-a[1]).slice(0,3);
                    const totalExact=leaderboard.reduce((s,e)=>s+(e.exact||0),0);
                    const totalDir=leaderboard.reduce((s,e)=>s+(e.correct_dir||0),0);
                    const totalScored=leaderboard.reduce((s,e)=>s+(e.scored_matches||0),0);
                    const avgExactPct=totalScored>0?Math.round(totalExact/totalScored*100):0;
                    const avgDirPct=totalScored>0?Math.round(totalDir/totalScored*100):0;
                    const stageLabel=config.round_state==="open"?`Stage ${stageForStats} (closed)`:`Stage ${stageForStats}`;
                    // ── Real-score stats (across all played games) ──
                    const playedMatches=matches.filter(m=>{const r=results[m.n];return r&&r.length>=2&&r[0]!=null&&r[1]!=null;});
                    const scorelineCounts={};
                    const tFor={},tAg={},tApp={};
                    playedMatches.forEach(m=>{
                      const r=results[m.n];const ga=r[0],gb=r[1];
                      const key=`${Math.max(ga,gb)}–${Math.min(ga,gb)}`;
                      scorelineCounts[key]=(scorelineCounts[key]||0)+1;
                      tFor[m.a]=(tFor[m.a]||0)+ga;tAg[m.a]=(tAg[m.a]||0)+gb;tApp[m.a]=(tApp[m.a]||0)+1;
                      tFor[m.b]=(tFor[m.b]||0)+gb;tAg[m.b]=(tAg[m.b]||0)+ga;tApp[m.b]=(tApp[m.b]||0)+1;
                    });
                    const scorelineSorted=Object.entries(scorelineCounts).sort((a,b)=>b[1]-a[1]);
                    const topScoreline=scorelineSorted[0];
                    const maxSL=topScoreline?topScoreline[1]:0;
                    const eligibleTeams=Object.keys(tApp).filter(t=>tApp[t]>=2);
                    const topScorer=eligibleTeams.map(t=>({team:t,avg:tFor[t]/tApp[t],gms:tApp[t]})).sort((a,b)=>b.avg-a.avg)[0];
                    const bestDef=eligibleTeams.map(t=>({team:t,avg:tAg[t]/tApp[t],gms:tApp[t]})).sort((a,b)=>a.avg-b.avg)[0];
                    return (
                    <>
                      <div onClick={()=>setGroupStatsOpen(false)} style={STATS_BACKDROP_STYLE}/>
                      <div style={statsModalStyle(isMobile)}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
                          <div style={{fontSize:11,color:C.text}}>{stageLabel} · {leaderboard.length} participants</div>
                          <StatsCloseBtn onClick={()=>setGroupStatsOpen(false)}/>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
                          <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.accent}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                            <div style={{fontSize:13,marginBottom:2}}>🎯</div>
                            <div style={{fontSize:18,fontWeight:700,lineHeight:1.1,marginBottom:2,color:C.text}}>{avgExactPct}%</div>
                            <div style={{fontSize:11,color:C.text,marginBottom:1}}>Avg exact score</div>
                            <div style={{fontSize:10,color:C.text}}>{totalExact} of {totalScored}</div>
                          </div>
                          <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.indigo}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                            <div style={{fontSize:13,marginBottom:2}}>↗️</div>
                            <div style={{fontSize:18,fontWeight:700,lineHeight:1.1,marginBottom:2,color:C.text}}>{avgDirPct}%</div>
                            <div style={{fontSize:11,color:C.text,marginBottom:1}}>Avg correct direction</div>
                            <div style={{fontSize:10,color:C.text}}>across all forms</div>
                          </div>
                        </div>
                        {/* top 3 most-predicted scores across all users */}
                        {groupStatsData?.top3_scores?.length>0&&(
                          <div style={{marginTop:10}}>
                            <div style={{fontSize:11,color:C.text,marginBottom:6}}>Most predicted scores</div>
                            <div style={{display:"flex",gap:6}}>
                              {groupStatsData.top3_scores.map(({score,count},i)=>(
                                <div key={i} style={{flex:1,background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 6px",textAlign:"center"}}>
                                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>{score}</div>
                                  <div style={{fontSize:10,color:C.text,marginTop:2}}>{count}×</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* ── Real-score stats ── */}
                        {playedMatches.length>0&&(
                          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                            <div style={{fontSize:11,color:C.text,marginBottom:8}}>Real scores · {playedMatches.length} games played</div>
                            {(topScorer||bestDef)&&(
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
                                {topScorer&&(
                                  <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.accent}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                                    <div style={{fontSize:13,marginBottom:2}}>⚽</div>
                                    <div style={{fontSize:13,fontWeight:700,lineHeight:1.15,marginBottom:2,color:C.text}}>{withFlag(topScorer.team)}</div>
                                    <div style={{fontSize:11,color:C.text,marginBottom:1}}>Top scoring</div>
                                    <div style={{fontSize:10,color:C.text}}>{topScorer.avg.toFixed(1)} goals/gm</div>
                                  </div>
                                )}
                                {bestDef&&(
                                  <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.indigo}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                                    <div style={{fontSize:13,marginBottom:2}}>🛡️</div>
                                    <div style={{fontSize:13,fontWeight:700,lineHeight:1.15,marginBottom:2,color:C.text}}>{withFlag(bestDef.team)}</div>
                                    <div style={{fontSize:11,color:C.text,marginBottom:1}}>Best defense</div>
                                    <div style={{fontSize:10,color:C.text}}>{bestDef.avg.toFixed(1)} conceded/gm</div>
                                  </div>
                                )}
                              </div>
                            )}
                            {scorelineSorted.length>0&&(
                              <div>
                                <div style={{fontSize:11,color:C.text,marginBottom:6}}>Most common: <span style={{fontWeight:700}}>{topScoreline[0]}</span> ({topScoreline[1]}×)</div>
                                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                                  {scorelineSorted.slice(0,6).map(([key,count],i)=>{
                                    const pct=Math.round(count/maxSL*100);
                                    return (
                                      <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
                                        <span style={{fontSize:12,fontWeight:600,color:C.text,width:34}}>{key}</span>
                                        <div style={{flex:1,background:C.border,borderRadius:4,height:8}}>
                                          <div style={{width:`${pct}%`,height:8,borderRadius:4,background:C.accent}}/>
                                        </div>
                                        <span style={{fontSize:11,color:C.text,opacity:0.7,width:24,textAlign:"right"}}>{count}×</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {top3picks.length>0&&(
                          <div style={{marginTop:10}}>
                            <div style={{fontSize:11,color:C.text,marginBottom:6}}>Top champion picks</div>
                            <div style={{display:"flex",flexDirection:"column",gap:5}}>
                              {top3picks.map(([team,count],i)=>{
                                const pct=Math.round(count/leaderboard.length*100);
                                return (
                                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
                                    <span style={{fontSize:13,width:20,textAlign:"center"}}>{["🥇","🥈","🥉"][i]}</span>
                                    <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>{withFlag(team)}</span>
                                    <span style={{fontSize:12,color:C.text,opacity:0.7}}>{count} picks</span>
                                    <div style={{width:50,background:C.border,borderRadius:4,height:4}}>
                                      <div style={{width:`${pct}%`,height:4,borderRadius:4,background:C.indigo}}/>
                                    </div>
                                    <span style={{fontSize:11,color:C.text,opacity:0.7,width:28,textAlign:"right"}}>{pct}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",
            justifyContent:"flex-start"}}>
            {hasFocus&&(
              <span onClick={toggleLivePreds}
                role="switch" aria-checked={showLivePreds}
                title={showLivePreds?"Hide the Match picks column":"Show what every form predicted for a game"}
                style={{display:"inline-flex",alignItems:"center",gap:7,cursor:"pointer",userSelect:"none",
                  background:showLivePreds?"rgba(163,230,53,0.08)":C.panel,
                  border:`1px solid ${showLivePreds?C.accent:C.border}`,borderRadius:999,
                  padding:"4px 11px 4px 9px",fontSize:12,fontWeight:600,
                  color:showLivePreds?C.accent:C.muted,transition:"all .15s",whiteSpace:"nowrap"}}>
                <span style={{fontSize:13,lineHeight:1}}>👁</span>
                Match picks
                {selLive&&<span className="live-dot" style={{width:5,height:5}}/>}
                <span style={{position:"relative",width:30,height:17,borderRadius:999,flex:"0 0 auto",
                  background:showLivePreds?"rgba(163,230,53,0.25)":C.panel2,
                  border:`1px solid ${showLivePreds?C.accent:C.border}`,transition:"all .15s"}}>
                  <span style={{position:"absolute",top:1.5,left:1.5,width:12,height:12,borderRadius:"50%",
                    background:showLivePreds?C.accent:C.muted,
                    transform:showLivePreds?"translateX(13px)":"translateX(0)",transition:"all .15s"}}/>
                </span>
              </span>
            )}
            {canSim&&(
              // Option B layout: classic Actual / Simulate toggle. When the
              // user has 2+ forms AND Simulate is ON, indigo pill-chips slide
              // in to the right of the toggle, one per form. Picking a chip
              // switches which form drives the simulation. Chips fade out
              // when Simulate is turned off (the toggle itself stays in
              // place, so the primary on/off is always a single click away).
              <div style={{display:"inline-flex",
                flexDirection:"row",alignItems:"center",gap:0,width:"auto"}}>
                <div style={{display:"flex",background:C.panel,
                  border:`1px solid ${C.border}`,borderRadius:6,overflow:"hidden",
                  fontSize:12}}>
                  <button onClick={()=>{setSimMode(false);setSimLimit(null);}} style={{
                    padding:"4px 12px",border:"none",cursor:"pointer",
                    background:!simMode?C.accent:"transparent",
                    color:!simMode?"#1a1a1a":C.muted,fontWeight:!simMode?700:400,
                    transition:"all .15s",whiteSpace:"nowrap",
                  }}>Actual</button>
                  <button onClick={()=>setSimMode(true)} style={{
                    padding:"4px 12px",border:"none",cursor:"pointer",
                    borderLeft:`1px solid ${C.border}`,
                    background:simMode?C.accent:"transparent",
                    color:simMode?"#1a1a1a":C.muted,fontWeight:simMode?700:400,
                    transition:"all .15s",whiteSpace:"nowrap",
                  }}>Simulate</button>
                </div>
                {/* Desktop: chip cluster sits in a collapsible box that expands
                    to the right of the toggle when Simulate is ON. On mobile the
                    chips render as a separate full-width row below (see below) so
                    the two toggles can sit side by side. */}
                {entries.length > 1 && !isMobile && (
                  <div style={{
                    display:"inline-flex",alignItems:"center",
                    overflow:"hidden",
                    maxWidth:simMode?600:0,
                    marginLeft:simMode?10:0,
                    transition:"max-width .55s cubic-bezier(.4,0,.2,1), margin-left .55s cubic-bezier(.4,0,.2,1)",
                  }}>
                    <div style={{
                      display:"inline-flex",gap:6,
                      opacity:simMode?1:0,
                      transform:simMode?"translateX(0)":"translateX(-10px)",
                      pointerEvents:simMode?"auto":"none",
                      transition:"opacity .4s ease .12s, transform .5s cubic-bezier(.4,0,.2,1)",
                    }}>
                      {formChips}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Mobile: chips can't fit beside the toggle, so they wrap to their
                own full-width row below the two side-by-side toggles, expanding
                down when Simulate is ON. */}
            {isMobile && canSim && entries.length > 1 && (
              <div style={{width:"100%",overflow:"hidden",
                maxHeight:simMode?260:0,opacity:simMode?1:0,
                pointerEvents:simMode?"auto":"none",
                transition:"max-height .45s cubic-bezier(.4,0,.2,1), opacity .35s ease"}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,paddingTop:2}}>
                  {formChips}
                </div>
              </div>
            )}
          </div>
        </div>

        {simMode&&(
          <div style={{background:"rgba(99,102,241,0.12)",border:`1px solid ${C.indigo}`,
            borderRadius:6,padding:"7px 14px",marginBottom:14,fontSize:13,color:C.indigo}}>
            {unplayedPredMatches.length>0
              ? <>✨ Simulating{" "}
                  <input
                    type="number"
                    min={1}
                    max={unplayedPredMatches.length}
                    value={simLimit!=null?simLimit:unplayedPredMatches.length}
                    onChange={e=>{
                      const v=parseInt(e.target.value,10);
                      if(isNaN(v)||v<1) return;
                      setSimLimit(Math.min(v,unplayedPredMatches.length));
                    }}
                    style={{width:44,border:"none",borderBottom:`1px solid ${C.indigo}`,
                      background:"transparent",color:C.indigo,fontWeight:700,fontSize:13,
                      textAlign:"center",outline:"none",padding:"0 2px",MozAppearance:"textfield"}}
                  />{" "}
                  of {unplayedPredMatches.length} unplayed match{unplayedPredMatches.length!==1?"es":""} with <b>your</b> predictions as results — all users' scores are recomputed accordingly{simLoading?" · loading…":""}
                </>
              : <>✨ <b>Simulation mode is on.</b> No unplayed predictions to apply — the standings here match the actual leaderboard.</>}
          </div>
        )}

        {leaderboard.length===0
          ?(!lbLoaded
            ?<div style={{textAlign:"center",padding:"40px 20px",color:C.muted,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
               <span className="lb-spinner" style={{width:16,height:16,border:`2px solid ${C.border}`,borderTopColor:C.muted,borderRadius:"50%",display:"inline-block"}}/>
               Loading leaderboard…
             </div>
            :<div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>No participants yet.</div>)
          :(
            <>
            {showFavHint&&(
              <div style={{display:"flex",alignItems:"flex-start",gap:10,
                background:"rgba(250,204,21,0.08)",border:"1px solid rgba(250,204,21,0.35)",
                borderRadius:8,padding:"11px 13px",marginBottom:12,fontSize:13,color:C.text,lineHeight:1.5}}>
                <span style={{fontSize:17,lineHeight:1.2}}>⭐</span>
                <span>Tap the <b>☆</b> next to any name to <b>favorite</b> that form — then tap the{" "}
                  <b style={{color:HINT_GOLD}}>★</b> in the column header to <b>show only your favorites</b>.</span>
                <button onClick={dismissFavHint} title="Dismiss" style={{marginLeft:"auto",background:"none",
                  border:0,color:C.muted,cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 2px",fontFamily:"inherit"}}>✕</button>
              </div>
            )}
            {favOnly&&!hasFavs&&(
              <div style={{textAlign:"center",padding:"14px 20px",color:C.muted,fontSize:13,marginBottom:10,background:C.panel,border:`1px solid ${C.border}`,borderRadius:8}}>
                No favorites yet — turn the ★ filter off and tap <span style={{color:C.muted}}>☆</span> on any row to add one.
              </div>
            )}
            {filteredLb.length>0&&(
            <div className="lb-table-wrap" ref={lbScrollRef}
              onScroll={()=>{
                const el=lbScrollRef.current; if(!el) return;
                const st=el.scrollTop;
                const maxSc=el.scrollHeight-el.clientHeight;
                const canSc=maxSc>10;
                const meAbove=myLbRowRef.current
                  ?myLbRowRef.current.getBoundingClientRect().top>el.getBoundingClientRect().bottom-20
                  :false;
                setLbFabState({showTop:st>30,showMe:canSc,meAbove});
                if(gameMenuOpen) setGameMenuOpen(false);
              }}
              style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,minWidth:320}}>
                <thead><tr style={{background:C.panel2}}>
                  <th style={{padding:"8px 4px",width:40,textAlign:"center",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>#</th>
                  <th style={{padding:"8px 4px",width:40,textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                    {(()=>{
                      const otherFavCount=favorites.length;
                      const hasFavs=otherFavCount>0;
                      const starColor=favOnly?HINT_GOLD:hasFavs?C.accent:showFavHint?HINT_GOLD:C.muted;
                      const starChar=(favOnly||hasFavs||showFavHint)?"★":"☆";
                      return (
                        <span onClick={()=>setFavOnly(v=>!v)}
                          title={favOnly?"Showing favorites only — click to show all":"Show favorites only"}
                          style={{cursor:"pointer",userSelect:"none",display:"inline-flex",flexDirection:"column",
                            alignItems:"center",gap:1,position:"relative",verticalAlign:"middle"}}>
                          <span className={favorites.length===0&&!favOnly?"lb-star-blink":""}
                            style={{fontSize:17,lineHeight:1,color:favorites.length===0&&!favOnly?undefined:starColor,transition:"color .2s"}}>{starChar}</span>
                          {hasFavs&&!favOnly&&(
                            <span style={{position:"absolute",top:-2,right:-4,width:7,height:7,borderRadius:"50%",
                              background:HINT_GOLD,border:`1.5px solid ${C.panel2}`}}/>
                          )}
                          {hasFavs&&!favOnly&&(
                            <span style={{fontSize:9,fontWeight:700,color:HINT_GOLD,lineHeight:1,marginTop:1}}>
                              {otherFavCount}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </th>
                  {["Name","Points"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Points"?"center":"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
                  {showFocusCols&&(()=>{
                    const ca=resolveTeamDeep(selMatch.a,results,matches), cb=resolveTeamDeep(selMatch.b,results,matches);
                    const badge = selLive
                      ? <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:9,fontWeight:800,color:C.red,background:"rgba(239,68,68,0.12)",border:`1px solid rgba(239,68,68,0.35)`,borderRadius:999,padding:"1px 6px"}}>{selPinned&&"📌"}<span className="live-dot"/>{selLiveData.minute!=null?`${selLiveData.minute}'`:"LIVE"}</span>
                      : selRes
                        ? <span style={{fontSize:9,fontWeight:800,color:C.green,background:"rgba(16,185,129,0.12)",border:`1px solid rgba(16,185,129,0.35)`,borderRadius:999,padding:"1px 6px"}}>{selPinned&&"📌 "}FT</span>
                        : <span style={{fontSize:9,fontWeight:800,color:C.muted,background:C.panel2,border:`1px solid ${C.border}`,borderRadius:999,padding:"1px 6px"}}>{selPinned&&"📌 "}{selKoParts?selKoParts.time:"—"}</span>;
                    const menuStyle = gameMenuPos
                      ? {position:"fixed",top:gameMenuPos.bottom+5,left:Math.max(8,Math.min(gameMenuPos.left+gameMenuPos.width/2-124,(typeof window!=="undefined"?window.innerWidth:1000)-256))}
                      : {position:"absolute",top:"100%",left:0};
                    const simScoreA = matchSimA!==""?parseInt(matchSimA,10):null;
                    const simScoreB = matchSimB!==""?parseInt(matchSimB,10):null;
                    const hasSimScore = simScoreA!=null && simScoreB!=null;
                    return (
                    <th style={{padding:"6px 8px",textAlign:"center",color:C.text,fontWeight:600,
                      borderBottom:`1px solid ${C.border}`,borderLeft:`1px solid ${C.border}`,
                      background:matchSimMode?(selLive?"rgba(239,68,68,0.14)":"rgba(99,102,241,0.18)"):selLive?"rgba(239,68,68,0.05)":"rgba(99,102,241,0.05)",
                      whiteSpace:"nowrap",position:"relative",transition:"background .2s"}}>
                      {matchSimMode ? (
                        /* ── SIMULATE mode header ── */
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:9,fontWeight:800,color:selLive?"rgba(255,160,160,1)":"rgba(180,170,255,1)",letterSpacing:".06em"}}>SIMULATE</span>
                            <button onClick={()=>{setMatchSimMode(false);setMatchSimA("");setMatchSimB("");}}
                              title="Exit simulate"
                              style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",borderRadius:5,color:"rgba(160,150,255,0.8)",fontSize:14,lineHeight:1,fontFamily:"inherit",display:"inline-flex",alignItems:"center"}}>
                              ✕
                            </button>
                          </div>
                          <div style={{display:"flex",alignItems:"flex-end",gap:5}}>
                            <span style={{fontSize:14}}>{flag(ca)}</span>
                            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              <span style={{fontSize:9,color:selLive?"rgba(255,150,150,0.7)":"rgba(160,150,255,0.7)",fontWeight:600}}>{ca}</span>
                              <input
                                autoFocus
                                type="number" min="0" max="20"
                                value={matchSimA}
                                onChange={e=>setMatchSimA(e.target.value===""?"":String(Math.max(0,Math.min(20,parseInt(e.target.value,10)||0))))}
                                placeholder="–"
                                style={{width:36,height:32,borderRadius:6,
                                  border:`1px solid ${selLive?"rgba(239,68,68,0.5)":"rgba(130,120,255,0.55)"}`,
                                  background:selLive?"rgba(239,68,68,0.12)":"rgba(99,102,241,0.18)",
                                  color:selLive?"#ffaaaa":"#c4c0ff",fontFamily:"monospace",
                                  fontSize:17,fontWeight:700,textAlign:"center",outline:"none",
                                  MozAppearance:"textfield",appearance:"textfield"}}/>
                            </div>
                            <span style={{fontSize:12,color:selLive?"rgba(200,100,100,0.8)":"rgba(120,110,200,0.8)",paddingBottom:8}}>–</span>
                            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              <span style={{fontSize:9,color:selLive?"rgba(255,150,150,0.7)":"rgba(160,150,255,0.7)",fontWeight:600}}>{cb}</span>
                              <input
                                type="number" min="0" max="20"
                                value={matchSimB}
                                onChange={e=>setMatchSimB(e.target.value===""?"":String(Math.max(0,Math.min(20,parseInt(e.target.value,10)||0))))}
                                placeholder="–"
                                style={{width:36,height:32,borderRadius:6,
                                  border:`1px solid ${selLive?"rgba(239,68,68,0.5)":"rgba(130,120,255,0.55)"}`,
                                  background:selLive?"rgba(239,68,68,0.12)":"rgba(99,102,241,0.18)",
                                  color:selLive?"#ffaaaa":"#c4c0ff",fontFamily:"monospace",
                                  fontSize:17,fontWeight:700,textAlign:"center",outline:"none",
                                  MozAppearance:"textfield",appearance:"textfield"}}/>
                            </div>
                            <span style={{fontSize:14}}>{flag(cb)}</span>
                          </div>
                        </div>
                      ) : (
                        /* ── normal (idle) header ── */
                        <div style={{display:"inline-flex",alignItems:"center",gap:5}}>
                          <button ref={gameBtnRef} onClick={(e)=>{e.stopPropagation();const r=gameBtnRef.current?.getBoundingClientRect();setGameMenuPos(r||null);setGameMenuOpen(o=>!o);}}
                            title="Pick which game's predictions to show"
                            style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",border:0,background:"transparent",
                              padding:0,margin:0,fontFamily:"inherit",color:C.text}}>
                            <span style={{fontSize:14}}>{flag(ca)}</span>
                            {selScore
                              ? <b style={{fontFamily:"monospace",fontSize:14}}>{selScore[0]}–{selScore[1]}</b>
                              : <span style={{color:C.muted,fontSize:11,fontWeight:600}}>v</span>}
                            <span style={{fontSize:14}}>{flag(cb)}</span>
                            {badge}
                            <span style={{fontSize:8,color:gameMenuOpen?C.accent:C.muted}}>▾</span>
                          </button>
                          {!selRes&&(
                            <button onClick={()=>setMatchSimMode(true)}
                              title="Simulate a score"
                              style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",borderRadius:5,
                                color:selLive?"rgba(239,68,68,0.5)":C.muted,fontSize:13,lineHeight:1,fontFamily:"inherit",display:"inline-flex",alignItems:"center",
                                transition:"color .15s,background .15s"}}
                              onMouseEnter={e=>{e.currentTarget.style.color=selLive?C.red:C.indigo;e.currentTarget.style.background=selLive?"rgba(239,68,68,0.12)":"rgba(99,102,241,0.12)";}}
                              onMouseLeave={e=>{e.currentTarget.style.color=selLive?"rgba(239,68,68,0.5)":C.muted;e.currentTarget.style.background="none";}}>
                              ✏️
                            </button>
                          )}
                          {gameMenuOpen&&(
                            <>
                              <div onClick={()=>setGameMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:98}}/>
                              <div onClick={e=>e.stopPropagation()} style={{...menuStyle,width:248,zIndex:99,
                                background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 12px 34px rgba(0,0,0,0.55)",overflow:"hidden",textAlign:"left"}}>
                                <div style={{maxHeight:264,overflowY:"auto",padding:3}}>
                                  <div onClick={()=>{setPinned(null);setGameMenuOpen(false);}}
                                    style={{display:"flex",alignItems:"center",gap:8,padding:"6px 9px",margin:3,borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700,
                                      border:`1px dashed ${C.indigo}`,color:pinnedMatchN==null?C.accent:C.indigo,background:pinnedMatchN==null?"rgba(163,230,53,0.08)":"transparent"}}>
                                    <span style={{flex:1}}>⟳ Auto — follow the current game</span>
                                    {pinnedMatchN==null&&<span style={{color:C.accent}}>●</span>}
                                  </div>
                                  {(()=>{
                                    const opts=gameOptions;
                                    if(!opts.length) return <div style={{padding:14,textAlign:"center",color:C.muted,fontSize:12}}>No games found</div>;
                                    return opts.map(o=>{
                                      const isSel=o.m.n===selectedMatchN;
                                      const locked=!o.viewable;
                                      return (
                                        <div key={o.m.n}
                                          ref={o.m.n===autoMatchN?gameMenuAutoRef:(isSel?gameMenuSelectedRef:null)}
                                          onClick={locked?undefined:()=>{setPinned(o.m.n);setGameMenuOpen(false);}}
                                          title={locked?"Hidden until this stage closes":undefined}
                                          style={{display:"flex",alignItems:"center",gap:7,padding:"6px 9px",borderRadius:6,fontSize:12,fontWeight:isSel?700:600,
                                            cursor:locked?"default":"pointer",opacity:locked?0.5:1,
                                            background:isSel?"rgba(163,230,53,0.10)":"transparent",color:isSel?C.accent:C.text}}>
                                          <span style={{flex:1,display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                            <span>{flag(o.a)}</span><span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{o.a}</span>
                                            <span style={{color:C.muted,fontWeight:400}}>v</span>
                                            <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{o.b}</span><span>{flag(o.b)}</span>
                                          </span>
                                          {o.live&&<span className="live-dot" style={{width:5,height:5,flexShrink:0}}/>}
                                          {locked&&<span style={{flexShrink:0,fontSize:11}}>🔒</span>}
                                          {isSel&&<span style={{color:C.accent,flexShrink:0}}>●</span>}
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </th>
                    );
                  })()}
                  <th style={{padding:"8px 10px",textAlign:"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>Winner pick</th>
                  {canJumpToParticipant&&<th style={{padding:"8px 6px",width:28,borderBottom:`1px solid ${C.border}`}}/>}
                </tr></thead>
                <tbody>
                  {(()=>{
                    // Pre-compute match-sim rank changes once for the whole list.
                    // Only active when matchSimMode is on and both digits are typed.
                    const _simA = matchSimA!==""?parseInt(matchSimA,10):null;
                    const _simB = matchSimB!==""?parseInt(matchSimB,10):null;
                    const _hasSimScore = matchSimMode && _simA!=null && _simB!=null;
                    const matchSimRankDelta = {};
                    const matchSimTotalMap = {};
                    if(_hasSimScore){
                      const sg=(x)=>x===0?0:x>0?1:-1;
                      const simPts=(pred)=>{
                        if(!pred||pred[0]==null||pred[1]==null) return 0;
                        const dir=sg(pred[0]-pred[1])===sg(_simA-_simB)?5:0;
                        const g=(pred[0]===_simA?1:0)+(pred[1]===_simB?1:0);
                        return dir+(g===2?3:g===1?1:0);
                      };
                      const realPts=(pred)=>{
                        if(!selScore||!pred||pred[0]==null||pred[1]==null) return 0;
                        const dir=sg(pred[0]-pred[1])===sg(selScore[0]-selScore[1])?5:0;
                        const g=(pred[0]===selScore[0]?1:0)+(pred[1]===selScore[1]?1:0);
                        return dir+(g===2?3:g===1?1:0);
                      };
                      const withSim = displayLb.map(r=>({
                        id:r.entry_id,
                        simTotal:r.total - realPts(pickFor(r)) + simPts(pickFor(r)),
                      }));
                      const sorted=[...withSim].sort((a,b)=>b.simTotal-a.simTotal);
                      const sortedRankMap=new Map(sorted.map((s,idx)=>[s.id,idx]));
                      withSim.forEach((r,currentIdx)=>{
                        const simIdx=sortedRankMap.get(r.id);
                        matchSimRankDelta[r.id]=currentIdx-simIdx;
                        matchSimTotalMap[r.id]=r.simTotal;
                      });
                    }
                  const simSortedAll = _hasSimScore
                    ? [...displayLb].sort((a,b)=>(matchSimTotalMap[b.entry_id]??b.total)-(matchSimTotalMap[a.entry_id]??a.total))
                    : null;
                  const renderLb = _hasSimScore
                    ? [...filteredLb].sort((a,b)=>(matchSimTotalMap[b.entry_id]??b.total)-(matchSimTotalMap[a.entry_id]??a.total))
                    : filteredLb;
                  // Prebuild rank lookups once (O(n)) so per-row rank isn't an O(n) indexOf → O(n²) over the table.
                  const baseRankMap = new Map(displayLb.map((r,idx)=>[r,idx+1]));
                  const simRankAllMap = simSortedAll ? new Map(simSortedAll.map((r,idx)=>[r,idx+1])) : null;
                  return renderLb.map((row)=>{
                    // Rank = global position across all users (sim-sorted when sim active)
                    const globalRank = simRankAllMap
                      ? simRankAllMap.get(row)
                      : baseRankMap.get(row);
                    const isMe=row.user_id===user?.id;
                    const isFav=isFavRow(row);
                    // Visual sim-mode (indigo row + total) is on whenever the
                    // user toggled Simulate. The "+N sim" diff badge is only
                    // shown when this row's total actually moved.
                    const isSim=simMode;
                    const simDiff=row._simDiff||0;
                    const hasSimDiff=simMode&&row._simDiff!=null&&row._simDiff!==0;
                    const matchSimRd = matchSimRankDelta[row.entry_id]||0;
                    const i = globalRank - 1;
                    const rowBg=i===0?"rgba(163,230,53,0.12)":i===1?"rgba(163,230,53,0.07)":i===2?"rgba(163,230,53,0.03)":isFav?"rgba(163,230,53,0.05)":"transparent";
                    let winnerCell;
                    if(!winnersRevealed && !isMe) winnerCell=<span style={{color:C.muted}} title="Champions are revealed once stage 1 closes">🔒</span>;
                    else if(winnerKnown)winnerCell=row.winner_pick?<>{withFlag(row.winner_pick)}{row.winner_bonus>0&&<span style={{color:C.green}}> +10</span>}</>:"—";
                    else winnerCell=row.winner_pick?withFlag(row.winner_pick):"—";
                    const rowKey=row.entry_id||row.user_id;
                    const isHovered=hoveredRow===rowKey;
                    const baseBg=isSim?"rgba(99,102,241,0.06)":rowBg;
                    const hoverBg=isMe?"rgba(163,230,53,0.22)":isFav?"rgba(163,230,53,0.15)":"rgba(163,230,53,0.08)";
                    return (
                      <tr key={rowKey}
                          ref={isMe?myLbRowRef:undefined}
                          onMouseEnter={canJumpToParticipant?()=>setHoveredRow(rowKey):undefined}
                          onMouseLeave={canJumpToParticipant?()=>setHoveredRow(null):undefined}
                          onClick={canJumpToParticipant?()=>jumpToParticipant(row):undefined}
                          title={canJumpToParticipant?"View this form's predictions":undefined}
                          style={{
                            background:(canJumpToParticipant&&isHovered)?hoverBg:baseBg,
                            borderLeft: isMe ? `3px solid ${C.indigo}` : isFav ? `3px solid ${C.accent}` : "3px solid transparent",
                            cursor:canJumpToParticipant?"pointer":"default",
                            transition:"background .12s",
                          }}>
                        <td style={{...td,textAlign:"center",width:40,padding:"8px 4px"}}>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                          <b>{globalRank}</b>
                          {(() => {
                            if (simMode || matchSimMode || !baselineRanks) return null;
                            const baseRank = baselineRanks[String(row.entry_id)];
                            if (baseRank == null) return null;
                            const delta = baseRank - globalRank;   // +climbed / -dropped
                            if (delta === 0) return null;
                            return (
                              <div style={{fontSize:10,fontWeight:700,lineHeight:1,
                                color:delta>0?C.green:C.red}}
                                title={delta>0?`Up ${delta} place${delta===1?"":"s"} this stage`:`Down ${-delta} place${delta===-1?"":"s"} this stage`}>
                                {delta>0?`+${delta}`:`${delta}`}
                              </div>
                            );
                          })()}
                          {(()=>{
                            if (simMode || matchSimMode || !showPrevRankIndicator) return null;
                            const prevRank = prevRankSnapshot[String(row.entry_id)];
                            if (prevRank==null) return null;
                            const delta = prevRank - globalRank; // positive = climbed
                            if (delta === 0) return null;
                            return (
                              <div style={{fontSize:9,fontWeight:700,
                                color:delta>0?C.green:C.red,lineHeight:1}}
                                title={delta>0?`↑ Up ${delta} since yesterday`:`↓ Down ${Math.abs(delta)} since yesterday`}>
                                {delta>0?`↑${delta}`:`↓${Math.abs(delta)}`}
                              </div>
                            );
                          })()}
                          {simMode&&(()=>{
                            const origRank = actualRankByEntry[row.entry_id];
                            if (origRank==null) return null;
                            const delta = origRank - globalRank; // +climbed / -dropped
                            if (delta===0) return null;
                            return (
                              <div style={{fontSize:10,fontWeight:700,lineHeight:1,
                                color:delta>0?C.indigo:C.red,opacity:0.9}}
                                title={delta>0?`Would move up ${delta}`:`Would move down ${-delta}`}>
                                {delta>0?`▲${delta}`:`▼${-delta}`}
                              </div>
                            );
                          })()}
                          {matchSimRd!==0&&(
                            <div style={{fontSize:10,fontWeight:700,lineHeight:1,
                              color:matchSimRd>0?C.indigo:C.red,
                              opacity:0.9}}
                              title={matchSimRd>0?`Would move up ${matchSimRd}`:`Would move down ${-matchSimRd}`}>
                              {matchSimRd>0?`▲${matchSimRd}`:`▼${-matchSimRd}`}
                            </div>
                          )}
                          </div>
                        </td>
                        <td style={{...td,textAlign:"center",width:40,padding:"8px 4px"}}>
                          {isMe?(
                            <span
                              onClick={(e)=>e.stopPropagation()}
                              title="Your own form — always in your favorites"
                              style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
                                width:22,height:22,borderRadius:"50%",border:`2px solid ${C.indigo}`,
                                fontSize:13,color:C.accent,userSelect:"none",cursor:"default"}}>
                              ★
                            </span>
                          ):(
                            <span
                              onClick={(e)=>{e.stopPropagation();toggleFavorite(rowKey);}}
                              title={isFav?"Remove from favorites":"Add to favorites"}
                              style={{cursor:"pointer",fontSize:16,lineHeight:1,userSelect:"none",
                                color:isFav?C.accent:showFavHint?HINT_GOLD:C.muted,
                                opacity:isFav?1:showFavHint?0.95:0.5,transition:"all .15s"}}>
                              {isFav?"★":"☆"}
                            </span>
                          )}
                        </td>
                        <td style={td}>{row.name}
                          {isMe&&<span style={{background:C.indigo,color:"white",fontSize:10,padding:"1px 5px",borderRadius:4,marginLeft:6}}>YOU</span>}
                        </td>
                        <td style={{...td,textAlign:"center",color:(isSim||matchSimRd!==0||matchSimTotalMap[row.entry_id]!=null)?C.indigo:C.accent,fontWeight:700,fontFamily:"monospace",fontSize:17}}>
                          {matchSimTotalMap[row.entry_id]??row.total}
                          {hasSimDiff&&<span style={{display:"inline-flex",alignItems:"center",gap:2,marginLeft:6,background:"rgba(99,102,241,0.12)",color:C.indigo,border:`1px solid ${C.indigo}`,padding:"1px 6px",borderRadius:4,fontSize:10,fontWeight:700,verticalAlign:"middle"}}>{simDiff>0?"+":""}{simDiff} sim</span>}
                        </td>
                        {showFocusCols&&(()=>{
                          const pred=pickFor(row);
                          // When matchSimMode is active and a score is typed, use that as the
                          // effective score for colouring. Otherwise fall back to the real score.
                          const simScoreA = matchSimA!==""?parseInt(matchSimA,10):null;
                          const simScoreB = matchSimB!==""?parseInt(matchSimB,10):null;
                          const effectiveScore = (matchSimMode && simScoreA!=null && simScoreB!=null)
                            ? [simScoreA, simScoreB]
                            : selScore;
                          let bd=C.border,bg=C.bg,tick=null,g0=false,g1=false,plain=!effectiveScore;
                          if(pred&&effectiveScore){
                            const sa=effectiveScore[0],sb=effectiveScore[1];
                            const sg=(x)=>x===0?0:x>0?1:-1;
                            const dir=sg(pred[0]-pred[1])===sg(sa-sb)?5:0;
                            g0=pred[0]===sa; g1=pred[1]===sb;
                            const goals=(g0?1:0)+(g1?1:0);
                            const total=dir+(goals===2?3:goals===1?1:0);
                            if(total>=5){bd=C.green;bg="rgba(16,185,129,0.12)";if(goals===2)tick="✓";}
                            else if(total===1){bd="#f59e0b";bg="rgba(245,158,11,0.12)";}
                            else {bd=C.red;bg="rgba(239,68,68,0.10)";}
                          }
                          return (
                            <td style={{...td,textAlign:"center",borderLeft:`1px solid ${C.border}`,
                              background:matchSimMode?(selLive?"rgba(239,68,68,0.06)":"rgba(99,102,241,0.07)"):selLive?"rgba(239,68,68,0.02)":"rgba(99,102,241,0.02)"}}>
                              {pred?(
                                <span style={{display:"inline-flex",alignItems:"center",gap:1,fontFamily:"monospace",fontSize:15,fontWeight:700,
                                  padding:"2px 8px",borderRadius:7,border:`1px solid ${plain?C.border:bd}`,background:plain?C.bg:bg}}>
                                  <span style={{color:plain?C.text:(g0?C.green:C.red)}}>{pred[0]}</span>
                                  <span style={{color:C.muted}}>–</span>
                                  <span style={{color:plain?C.text:(g1?C.green:C.red)}}>{pred[1]}</span>
                                  {tick&&<span style={{fontSize:10,marginLeft:3,color:C.green}}>{tick}</span>}
                                </span>
                              ):(
                                <span style={{color:C.muted,fontSize:13}}>—</span>
                              )}
                            </td>
                          );
                        })()}
                        <td style={td}>{winnerCell}</td>
                        {canJumpToParticipant&&(
                          <td style={{...td,textAlign:"right",paddingRight:12,width:isMe?0:80}}>
                            {!isMe&&(
                              <span style={{display:"inline-flex",alignItems:"center",gap:4,
                                color:C.accent,fontSize:11,fontWeight:700,whiteSpace:"nowrap",letterSpacing:".3px",
                                opacity:isHovered?1:0,transform:isHovered?"translateX(0)":"translateX(6px)",
                                transition:"opacity .15s,transform .15s"}}>
                                Compare →
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  });})()}
                </tbody>
              </table>
            </div>
            )}
            </>
          )}
        {/* Floating chips — scroll-to-top + scroll-to-my-row */}
        {leaderboard.length>0&&(
          <div style={{position:"fixed",bottom:20,left:0,right:0,
            display:"flex",justifyContent:"space-between",padding:"0 18px",
            pointerEvents:"none",zIndex:200}}>
            <div onClick={()=>lbScrollRef.current?.scrollTo({top:0,behavior:"smooth"})}
              style={{pointerEvents:lbFabState.showTop?"auto":"none",
                opacity:lbFabState.showTop?1:0,transform:lbFabState.showTop?"translateY(0)":"translateY(10px)",
                transition:"opacity .22s,transform .22s",
                display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,cursor:"pointer",
                borderRadius:22,padding:"8px 14px",boxShadow:"0 4px 18px rgba(0,0,0,.55)",
                background:C.panel2,border:`1px solid ${C.border}`,color:C.muted}}>
              ↑ Top
            </div>
            <div onClick={()=>{
                const row=myLbRowRef.current;
                if(row) row.scrollIntoView({behavior:"smooth",block:"center"});
              }}
              style={{pointerEvents:lbFabState.showMe?"auto":"none",
                opacity:lbFabState.showMe?1:0,transform:lbFabState.showMe?"translateY(0)":"translateY(10px)",
                transition:"opacity .22s,transform .22s",
                display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,cursor:"pointer",
                borderRadius:22,padding:"8px 14px",boxShadow:"0 4px 18px rgba(0,0,0,.55)",
                background:C.panel2,border:`1px solid ${C.border}`,color:C.text}}>
              {lbFabState.meAbove?"↓":"↑"} My form
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── By User ───────────────────────────────────────────────────────────────
  // ByUser moved outside App — see module-level definition above

  // ── Render ────────────────────────────────────────────────────────────────
  if(authLoading){
    return <div data-theme={isDark?"dark":"light"} style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.muted}}>Loading…</div>;
  }
  return (
    <div data-theme={isDark?"dark":"light"} style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:'var(--c-font-ui)'}}>
      <nav style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"12px 0"}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",justifyContent:"space-between"}}>
          <div style={{fontFamily:'var(--c-font-display)',fontWeight:400,color:C.accent,fontSize:24,letterSpacing:1}}>MondoBet</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>{ setTab(t.id); if(t.id==="leaderboard") setCompareKey(null); }} style={{background:tab===t.id?(t.admin?C.red:C.accent):"transparent",color:tab===t.id?(t.admin?"#fff":"#0b1020"):(t.admin?C.red:C.text),border:`1px solid ${tab===t.id?(t.admin?C.red:C.accent):C.border}`,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:tab===t.id?700:400}}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",fontSize:13}}>
            {user&&<span style={{color:C.text}}>Hi <b style={{color:C.accent}}>{user.name}</b>{user.is_admin?" 👑":""}</span>}
            {/* ── User-level stats 👤 ── */}
            {user&&leaderboard.length>0&&(()=>{
              const myRows=leaderboard.filter(e=>e.user_id===user.id);
              if(!myRows.length) return null;
              const totalExact=myRows.reduce((s,e)=>s+(e.exact||0),0);
              const totalDir=myRows.reduce((s,e)=>s+(e.correct_dir||0),0);
              const totalScored=myRows.reduce((s,e)=>s+(e.scored_matches||0),0);
              const dirPct=totalScored>0?Math.round(totalDir/totalScored*100):0;
              const allPreds={...myPreds};
              Object.values(simPredsByEntry).forEach(ep=>Object.assign(allPreds,ep));
              const freq={};
              Object.values(allPreds).forEach(p=>{if(p&&p[0]!=null&&p[1]!=null){const [lo,hi]=[Math.min(p[0],p[1]),Math.max(p[0],p[1])];const k=`${lo}:${hi}`;freq[k]=(freq[k]||0)+1;}});
              const top3=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,3);
              return (
                <div ref={userStatsPopup.triggerRef} style={{position:"relative"}}>
                  <button onClick={()=>setUserStatsOpen(o=>!o)} title="My stats across all forms"
                    style={{background:userStatsOpen?"rgba(163,230,53,0.08)":"transparent",border:`1px solid ${userStatsOpen?C.accent:"transparent"}`,borderRadius:8,padding:"4px 6px",cursor:"pointer",color:userStatsOpen?C.accent:C.muted,display:"flex",alignItems:"center",fontSize:16,lineHeight:1,fontFamily:"inherit",transition:"all .15s"}}>
                    📊
                  </button>
                  {userStatsOpen&&(
                    <>
                      <div onClick={()=>setUserStatsOpen(false)} style={STATS_BACKDROP_STYLE}/>
                      <div style={statsModalStyle(isMobile)}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
                          <div style={{fontSize:11,color:C.text}}>
                            {user.name} · {myRows.length} form{myRows.length!==1?"s":""} · {totalScored} matches
                          </div>
                          <StatsCloseBtn onClick={()=>setUserStatsOpen(false)}/>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:top3.length?10:0}}>
                          <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.green}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                            <div style={{fontSize:13,marginBottom:2}}>↗️</div>
                            <div style={{fontSize:18,fontWeight:700,lineHeight:1.1,marginBottom:2,color:C.text}}>{dirPct}%</div>
                            <div style={{fontSize:11,color:C.text,marginBottom:1}}>Correct direction</div>
                            <div style={{fontSize:10,color:C.text}}>{totalDir} of {totalScored}</div>
                          </div>
                          <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderTop:`2px solid ${C.accent}`,borderRadius:9,padding:"10px 8px",textAlign:"center"}}>
                            <div style={{fontSize:13,marginBottom:2}}>🎯</div>
                            <div style={{fontSize:18,fontWeight:700,lineHeight:1.1,marginBottom:2,color:C.text}}>{totalExact}<span style={{fontSize:12,fontWeight:400,color:C.text}}>/{totalScored}</span></div>
                            <div style={{fontSize:11,color:C.text,marginBottom:1}}>Exact scores</div>
                            <div style={{fontSize:10,color:C.text}}>{totalScored>0?Math.round(totalExact/totalScored*100):0}% of matches</div>
                          </div>
                        </div>
                        {top3.length>0&&(
                          <div>
                            <div style={{fontSize:11,color:C.text,marginBottom:6}}>My top predicted scores</div>
                            <div style={{display:"flex",gap:6}}>
                              {top3.map(([score,count],i)=>(
                                <div key={i} style={{flex:1,background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 6px",textAlign:"center"}}>
                                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>{score}</div>
                                  <div style={{fontSize:10,color:C.text,marginTop:2}}>{count}×</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            {user&&!user.is_admin&&(
              <button
                ref={helpBtnRef}
                onClick={openHelpForCurrentTab}
                title="Show help for this tab"
                className={helpBlink?"help-blink":""}
                style={{background:"transparent",border:`1px solid ${C.accent}`,color:C.accent,
                  width:30,height:30,borderRadius:"50%",cursor:"pointer",fontSize:15,
                  lineHeight:1,display:"inline-flex",alignItems:"center",justifyContent:"center",
                  fontWeight:700,padding:0}}>
                ⓘ
              </button>
            )}
            <button onClick={toggleTheme} title={isDark?"Switch to light mode":"Switch to dark mode"} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.text,padding:"5px 9px",borderRadius:6,cursor:"pointer",fontSize:15,lineHeight:1}}>
              {isDark?"☀️":"🌙"}
            </button>
            {user&&<button onClick={doLogout} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.text,padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12}}>Log out</button>}
          </div>
        </div>
      </nav>
      {globalErr&&(
        <div style={{background:"rgba(239,68,68,0.08)",borderBottom:`1px solid ${C.red}`,padding:"8px 16px",fontSize:13,color:C.red,display:"flex",justifyContent:"space-between"}}>
          <span>⚠️ {globalErr}</span>
          <button onClick={()=>setGlobalErr("")} style={{background:"none",border:0,color:C.red,cursor:"pointer"}}>✕</button>
        </div>
      )}
      {/* Simulation banner slides down/up smoothly when sim mode toggles.
          The wrapper stays rendered so we can animate max-height + opacity. */}
      {(() => {
        const showBanner = (simActive && ["leaderboard","byuser","tournament"].includes(tab))
          || (matchSimMode && tab==="leaderboard");
        const isMatchSim = matchSimMode && tab==="leaderboard" && !simActive;
        return (
          <div style={{
            overflow:"hidden",
            maxHeight:showBanner?80:0,
            opacity:showBanner?1:0,
            transition:"max-height .55s cubic-bezier(.4,0,.2,1), opacity .4s ease",
            borderBottom:showBanner?`1px solid ${C.indigo}`:`1px solid transparent`,
          }}>
            <div style={{background:"rgba(99,102,241,0.12)",
              padding:"8px 16px",fontSize:13,color:C.indigo,display:"flex",alignItems:"center",
              justifyContent:"space-between",gap:10,flexWrap:"wrap",fontWeight:600}}>
              {isMatchSim
                ? <span>✏️ <b>Score simulate</b> — type a hypothetical score in the match picks column to see how every prediction would score. Only you see this.</span>
                : <span>🔮 <b>Simulation</b> — unplayed games are shown as if they finish exactly as <b>your</b> predictions. Scores &amp; standings are hypothetical (only you see this).</span>
              }
              <button
                onClick={isMatchSim
                  ? ()=>{ setMatchSimMode(false); setMatchSimA(""); setMatchSimB(""); }
                  : ()=>{ setSimMode(false); setSimLimit(null); }}
                style={{background:C.indigo,color:"white",
                  border:0,borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>
                Exit simulation
              </button>
            </div>
          </div>
        );
      })()}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 16px 40px"}}>
        {!user&&<AuthView roundState={config.round_state} onSuccess={doLogin}/>}
        {user&&tab==="predictions"&&MyPredictions()}
        {user&&tab==="leaderboard"&&LeaderboardView()}
        {user&&tab==="dashboard"&&(
          <AdminDashboard
            config={config} setConfig={setConfig}
            matches={matches} teams={teams} results={results}
            participants={participants} setParticipants={setParticipants}
            adminParticipants={adminParticipants} setAdminParticipants={setAdminParticipants}
            leaderboard={leaderboard}
            showToast={showToast} refreshLb={refreshLb}
          />
        )}
        {user&&tab==="results"&&<AdminResults
          config={config} matches={matches} results={results} liveMatches={liveMatches}
          setResults={setResults} setLiveMatches={setLiveMatches} refreshLb={refreshLb} refreshLive={refreshLive} showToast={showToast} tz={tz}
        />}
        {user&&tab==="tournament"&&<Tournament matches={matches} results={effResults} liveMatches={liveMatches} myPreds={myPreds} config={config} user={user} tz={tz}/>}
        {user&&tab==="settings"&&<SettingsView user={user} leaderboard={leaderboard} onLogout={doLogout} onNameUpdate={u=>{setUser(u);showToast("Name updated ✓");}} showToast={showToast} config={config} setConfig={setConfig} matches={matches} results={results} setResults={setResults} liveMatches={liveMatches} refreshLive={refreshLive} refreshLb={refreshLb} onResetOnboarding={resetOnboarding} tz={tz} onTzChange={saveTz} showLivePreds={showLivePreds} onLivePredsChange={toggleLivePreds}/>}
      </div>
      {toast&&(
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:toast.kind==="err"?C.red:toast.kind==="warn"?C.accent:C.green,color:toast.kind==="warn"?"#1a1a1a":"white",padding:"8px 16px",borderRadius:6,fontSize:14,zIndex:100,boxShadow:"0 4px 12px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>
          {toast.msg}
        </div>
      )}
      <ConfirmHost/>
      <ResetPickerHost/>
      <HelpDialog entry={helpEntry} onClose={closeHelp} helpBtnRef={helpBtnRef}/>
    </div>
  );
}
