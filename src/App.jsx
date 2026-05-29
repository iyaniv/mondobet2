import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { api, liveApi, initApi, demoVariantApi, setToken, getToken } from "./api";

const C = {
  bg:"var(--c-bg)", panel:"var(--c-panel)", panel2:"var(--c-panel2)",
  border:"var(--c-border)", text:"var(--c-text)", muted:"var(--c-muted)",
  accent:"var(--c-accent)", accentDk:"var(--c-accent-dk)", accentSoft:"var(--c-accent-soft)", green:"var(--c-green)", red:"var(--c-red)", indigo:"var(--c-indigo)",
};

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
            style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:61,width:320,
              background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,
              boxShadow:"0 8px 28px rgba(0,0,0,0.45)",padding:"12px 14px",
              fontSize:12.5,color:C.muted,lineHeight:1.55,textAlign:"left",
              fontWeight:400,cursor:"default",whiteSpace:"normal"}}>
            <div style={{fontWeight:700,color:C.text,marginBottom:8,fontSize:13}}>📄 Import predictions from CSV</div>
            <ul style={{margin:0,paddingLeft:16}}>
              <li style={{marginBottom:6}}>One line per match — <b style={{color:C.text}}>match number, home score, away score</b>. E.g. <code>81,2,1</code> = match #81 ends 2–1.</li>
              <li style={{marginBottom:6}}>A header row (<code>match,home,away</code>) is optional; any line that doesn't start with a match number is skipped.</li>
              <li style={{marginBottom:6}}>Match numbers are shown as <b style={{color:C.text}}>#NN</b> on every row.</li>
              <li>Only this stage's still-editable matches are filled; closed / finished rows are skipped (a toast says how many). Nothing auto-submits — review, then hit <b style={{color:C.text}}>Submit</b>.</li>
            </ul>
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
function TeamPicker({ value, onChange, teams, disabled, clearable=false, placeholder="Choose a team…" }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const [hov,    setHov]    = useState(null);
  const wrapRef   = useRef(null);
  const searchRef = useRef(null);

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

  return (
    <div ref={wrapRef} style={{ position:"relative", minWidth:240 }}>
      {/* Trigger */}
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

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:200,
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

  // Scroll the selected row into view whenever `value` changes (e.g. after
  // jumping in from the leaderboard). If the row is filtered out by search,
  // clear the search so it becomes visible.
  useEffect(() => {
    if (!value || !listRef.current) return;
    const isVisible = filtered.some(e => (e.entry_id || e.user_id) === value);
    if (!isVisible && search) {
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

// MatchRow — outside App so localA/localB survive App re-renders
function MatchRow({ match, pred, result, liveData, editable, adminResult, roundState, onSave, onResultSave }) {
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

  async function savePred(side,val) {
    editingRef.current = false;
    const a=side===0?val:localA, b=side===1?val:localB;
    const wasFilled  = pred?.[0]!=null && pred?.[1]!=null;
    const willBeFilled = (a!=="" && b!=="");
    // empty → still empty: nothing to do (avoid pointless API calls)
    if (!wasFilled && !willBeFilled) return;
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
  async function saveResult(side,val) {
    editingRef.current = false;
    const a=side===0?val:resA, b=side===1?val:resB;
    pendingSaveRef.current = true;
    try { await onResultSave(match.n,{score_a:a===""?null:Number(a),score_b:b===""?null:Number(b)}); }
    catch(e){console.error(e);}
    finally { pendingSaveRef.current = false; }
  }

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
  } else if(roundState==="closed"&&!effectiveScore){
    ptsEl=<span style={{color:C.muted,fontSize:11}}>awaiting</span>;
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
  const baseRowBg     = (!editable&&!adminResult) ? C.panel : C.panel2;
  const rowBg         = isLiveBadge ? "rgba(239,68,68,0.07)"
                      : isPreliminary ? "rgba(163,230,53,0.04)"
                      : baseRowBg;
  const rowBorderColor= isLiveBadge ? "rgba(239,68,68,0.4)"
                      : isPreliminary ? "rgba(163,230,53,0.25)"
                      : C.border;

  // Shared score / input block used in both layouts
  const scoreBlock = editable ? (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
        <input type="number" inputMode="numeric" min={0} max={20} value={localA}
          onFocus={handleFocus} onChange={e=>setLocalA(e.target.value)} onBlur={e=>savePred(0,e.target.value)} style={numInput}/>
        <span style={{color:C.muted,fontSize:13}}>:</span>
        <input type="number" inputMode="numeric" min={0} max={20} value={localB}
          onFocus={handleFocus} onChange={e=>setLocalB(e.target.value)} onBlur={e=>savePred(1,e.target.value)} style={numInput}/>
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
        onFocus={handleFocus} onChange={e=>setResA(e.target.value)} onBlur={e=>saveResult(0,e.target.value)} style={numInput}/>
      <span style={{color:C.muted,fontSize:13}}>:</span>
      <input type="number" inputMode="numeric" min={0} max={20} value={resB}
        onFocus={handleFocus} onChange={e=>setResB(e.target.value)} onBlur={e=>saveResult(1,e.target.value)} style={numInput}/>
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
      {isLiveBadge&&<span style={{marginLeft:4,fontSize:10}}>{liveData.minute}′</span>}
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
        {/* Line 2: actual result chip + pts */}
        {(effectiveScore!=null || ptsEl) && (
          <div style={{display:"flex",gap:5,justifyContent:"flex-end",
            alignItems:"center",marginTop:4}}>
            {resultChip}
            {ptsEl}
          </div>
        )}
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
          <input type="number" inputMode="numeric" min={0} max={20} value={localA} onFocus={handleFocus} onChange={e=>setLocalA(e.target.value)} onBlur={e=>savePred(0,e.target.value)} style={numInput}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={localB} onFocus={handleFocus} onChange={e=>setLocalB(e.target.value)} onBlur={e=>savePred(1,e.target.value)} style={numInput}/>
        </>
      ):adminResult?(
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={resA} onFocus={handleFocus} onChange={e=>setResA(e.target.value)} onBlur={e=>saveResult(0,e.target.value)} style={numInput}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={resB} onFocus={handleFocus} onChange={e=>setResB(e.target.value)} onBlur={e=>saveResult(1,e.target.value)} style={numInput}/>
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
          : (!editable&&!adminResult&&
              <span style={{color:C.muted,fontSize:11,fontFamily:"monospace"}}>vs</span>)
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
  const [phone,setPhone]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [showPsw,setShowPsw]=useState(false);

  const pills={
    open:  {text:"🟢 Betting round is OPEN",  bg:"rgba(16,185,129,0.1)",  color:C.green, border:`1px solid ${C.green}`},
    closed:{text:"🔒 Betting round is CLOSED",bg:"rgba(239,68,68,0.1)",   color:C.red,   border:`1px solid ${C.red}`},
    idle:  {text:"⏸️ No betting round yet",   bg:"rgba(148,163,184,0.1)",color:C.muted, border:`1px solid ${C.border}`},
  };
  const pill=pills[roundState]||pills.idle;

  async function submit(e) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const res=mode==="signup"
        ?await api.signup({name:name.trim(),email:email.trim().toLowerCase(),phone:phone.trim(),password})
        :await api.login({email:email.trim().toLowerCase(),password});
      onSuccess(res.user,res.token);
    } catch(e){setErr(e.message);}
    finally{setLoading(false);}
  }

  return (
    <div style={{maxWidth:400,margin:"30px auto",padding:"0 16px"}}>
      <div style={{marginBottom:14,textAlign:"center"}}>
        <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,background:pill.bg,color:pill.color,border:pill.border}}>{pill.text}</span>
      </div>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
        <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:16}}>
          {["signup","login"].map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{background:mode===m?C.accent:"transparent",color:mode===m?"#1a1a1a":C.text,border:`1px solid ${mode===m?C.accent:C.border}`,padding:"6px 16px",borderRadius:6,cursor:"pointer",fontWeight:700}}>
              {m==="signup"?"Sign up":"Log in"}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          {mode==="signup"&&<input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" required style={inputStyle}/>}
          {mode==="signup"&&<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone number" required type="tel" minLength={7} style={inputStyle}/>}
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder={mode==="login"?"Email  (admin: admin)":"Email"} required style={inputStyle}/>
          <div style={{position:"relative"}}>
            <input type={showPsw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" required minLength={4} style={{...inputStyle,marginBottom:0,paddingRight:36}}/>
            <button type="button" onClick={()=>setShowPsw(v=>!v)} tabIndex={-1} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16,lineHeight:1,padding:"2px 4px"}}>
              {showPsw?"🙈":"👁️"}
            </button>
          </div>
          {err&&<p style={{color:C.red,fontSize:13,marginBottom:8}}>{err}</p>}
          <button type="submit" disabled={loading} style={{width:"100%",background:C.accent,color:"#1a1a1a",border:0,padding:"10px 0",borderRadius:6,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.6:1}}>
            {loading?"…":mode==="signup"?"Create account":"Log in"}
          </button>
        </form>
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

  // Result-edit audit log — who changed which result, when. Fetched on mount
  // and on demand; collapsed by default to keep the dashboard tidy.
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const loadAudit = useCallback(() => {
    setAuditLoading(true);
    api.getResultAudit().then(setAudit).catch(()=>{}).finally(()=>setAuditLoading(false));
  }, []);
  useEffect(() => { loadAudit(); }, [loadAudit]);

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
        return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:20}}>
        {[
          {label:"Participants",    value:statData.length,                                                       color:C.accent},
          {label:"Paid",            value:`${statData.filter(u=>u.has_paid).length} / ${statData.length}`,       color:C.green},
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

      {/* ── Result history (audit log) ──────────────────────────────────── */}
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8,flexWrap:"wrap"}}>
          <h2 style={{color:C.accent,fontSize:16,margin:0}}>🧾 Result history</h2>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={loadAudit} title="Refresh the log"
              style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,padding:"3px 10px",borderRadius:4,cursor:"pointer",fontSize:12}}>
              ↻ Refresh
            </button>
            <button onClick={()=>setAuditOpen(v=>!v)}
              style={{background:"transparent",border:`1px solid ${C.accent}`,color:C.accent,padding:"3px 12px",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600}}>
              {auditOpen ? "Hide" : `Show (${audit.length})`}
            </button>
          </div>
        </div>
        {auditOpen && (
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            {auditLoading && audit.length===0
              ? <div style={{padding:16,color:C.muted,fontSize:13,textAlign:"center"}}>Loading…</div>
              : audit.length===0
                ? <div style={{padding:16,color:C.muted,fontSize:13,textAlign:"center"}}>No result edits recorded yet.</div>
                : (
                  <div style={{maxHeight:340,overflowY:"auto"}}>
                    {audit.map(a => {
                      const m = matches.find(x=>x.n===a.match_n);
                      const matchLabel = a.match_n==null ? "All results"
                        : (m ? `#${a.match_n} ${m.a}–${m.b}` : `#${a.match_n}`);
                      const palette = a.action==="finalize" ? C.green
                        : (a.action==="clear"||a.action==="reset_all") ? C.red : C.accent;
                      return (
                        <div key={a.id} style={{display:"flex",gap:10,alignItems:"baseline",padding:"8px 12px",
                          borderBottom:`1px solid ${C.border}`,fontSize:12.5,flexWrap:"wrap"}}>
                          <span style={{color:C.muted,fontFamily:"monospace",fontSize:11,whiteSpace:"nowrap"}}>
                            {new Date(a.created_at).toLocaleString()}
                          </span>
                          <span style={{textTransform:"uppercase",fontWeight:700,fontSize:10,color:palette,
                            border:`1px solid ${palette}`,borderRadius:4,padding:"1px 6px",whiteSpace:"nowrap"}}>
                            {a.action}
                          </span>
                          <span style={{color:C.text,fontWeight:600,whiteSpace:"nowrap"}}>{matchLabel}</span>
                          <span style={{color:C.muted}}>
                            {a.old_value ? <><span style={{textDecoration:"line-through",opacity:0.65}}>{a.old_value}</span>{" → "}</> : null}
                            <span style={{color:C.text}}>{a.new_value || "—"}</span>
                          </span>
                          <span style={{marginLeft:"auto",color:C.indigo,fontWeight:600,whiteSpace:"nowrap"}}>by {a.admin_name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
          </div>
        )}
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
                        </td>
                        <td style={td}>
                          {uEntries.length===0
                            ? <span style={{color:C.muted}}>no forms</span>
                            : multi
                              ? <span style={{fontSize:12,color:C.muted}}>
                                  <b style={{color:C.text}}>{uEntries.length}</b> form{uEntries.length===1?"":"s"} — click to expand
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
  const played = gm.filter(m => results[m.n]).length;

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
          const res = results[m.n];
          const sim = !res && simPreds[m.n]?.[0]!=null ? simPreds[m.n] : null;
          const isMatchLive = !!(liveMatches[m.n] && liveMatches[m.n].is_live);
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

function Tournament({ matches, results, liveMatches={}, myPreds, config, user }) {
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
  const groupPlayed  = groupMatches.filter(m => results[m.n]).length;
  const knockoutDone = stageMatchList.filter(m => results[m.n]).length;

  return (
    <div>
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
        <div>
          <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,
            padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",
            justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontFamily:"var(--c-font-display)",fontSize:20,color:C.accent,letterSpacing:1}}>
                {stageObj.name.toUpperCase()}
              </span>
              <span style={{fontSize:13,color:C.muted}}>
                <b style={{color:C.text}}>{knockoutDone}</b> / {stageMatchList.length} played
              </span>
            </div>
          </div>

          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
            {stageMatchList.map(m => {
              const resolvedA = resolveTeamDeep(m.a, results, matches);
              const resolvedB = resolveTeamDeep(m.b, results, matches);
              const res       = results[m.n];
              const live      = liveMatches[m.n];
              const isMatchLive = !!(live && live.is_live);
              const dispScore = live ? [live.score_a, live.score_b] : res ?? null;
              // Extra-time / penalty scores + the advancing side ("a"/"b").
              // For a knockout draw at 90', the winner is decided by these —
              // so users (not just the admin) see who went through.
              const winnerField = live ? (live.winner ?? null) : (res ? res[2] : null);
              const etA  = live ? (live.et_a  ?? null) : (res ? res[3] : null);
              const etB  = live ? (live.et_b  ?? null) : (res ? res[4] : null);
              const penA = live ? (live.pen_a ?? null) : (res ? res[5] : null);
              const penB = live ? (live.pen_b ?? null) : (res ? res[6] : null);
              const winA      = dispScore
                ? (dispScore[0] > dispScore[1] ? true
                   : dispScore[1] > dispScore[0] ? false
                   : winnerField === 'a' ? true
                   : winnerField === 'b' ? false
                   : null)
                : null;
              const rowBg     = isMatchLive ? "rgba(239,68,68,0.06)"
                              : res         ? "rgba(16,185,129,0.04)"
                              : live        ? C.panel2
                              : C.panel2;
              const rowBd     = `1px solid ${isMatchLive ? "rgba(239,68,68,0.35)"
                              : res                       ? "rgba(16,185,129,0.2)"
                              : C.border}`;
              return (
                <Fragment key={m.n}>
                <StageMatchLabel m={m}/>
                <div style={{
                  display:"grid",gridTemplateColumns:"32px 1fr 88px 1fr",
                  alignItems:"center",gap:6,padding:"7px 10px",borderRadius:6,
                  marginBottom:4,background:rowBg,border:rowBd,fontSize:13,
                }}>
                  <span style={{color:C.muted,fontSize:11,fontFamily:"monospace"}}>#{m.n}</span>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                    color:winA===true?C.accent:winA===false?C.muted:C.text,fontWeight:winA===true?700:400}}>
                    {flag(resolvedA)} {resolvedA}
                  </span>
                  <div style={{textAlign:"center"}}>
                    {isMatchLive ? (
                      <>
                        <div style={{fontFamily:"monospace",fontWeight:700,color:C.red,fontSize:15}}>
                          {live.score_a}:{live.score_b}
                        </div>
                        {(etA!=null&&etB!=null)&&<div style={{fontSize:9,color:C.muted,fontFamily:"monospace"}}>a.e.t. {etA}:{etB}</div>}
                        {(penA!=null&&penB!=null)&&<div style={{fontSize:9,color:C.muted,fontFamily:"monospace"}}>pen {penA}:{penB}</div>}
                        <div style={{fontSize:10,color:C.red,display:"flex",alignItems:"center",gap:2,justifyContent:"center"}}>
                          <span className="live-dot"/>{live.minute}′
                        </div>
                      </>
                    ) : dispScore ? (
                      <>
                        <div style={{fontFamily:"monospace",fontWeight:700,
                          color:res?C.green:C.text,fontSize:15}}>
                          {dispScore[0]}:{dispScore[1]}
                        </div>
                        {(etA!=null&&etB!=null)&&<div style={{fontSize:9,color:C.muted,fontFamily:"monospace"}}>a.e.t. {etA}:{etB}</div>}
                        {(penA!=null&&penB!=null)&&<div style={{fontSize:9,color:C.muted,fontFamily:"monospace"}}>pen {penA}:{penB}</div>}
                      </>
                    ) : (
                      <span style={{color:C.muted,fontSize:12}}>vs</span>
                    )}
                  </div>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",
                    color:winA===false?C.accent:winA===true?C.muted:C.text,fontWeight:winA===false?700:400}}>
                    {resolvedB} {flag(resolvedB)}
                  </span>
                </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ADMIN MATCH ROW — handles pending / live / final states; outside App
// ─────────────────────────────────────────────────────────────────────────────
function AdminMatchRow({ match, result, liveData, onSaveResult, onGoLive, onUpdateLive, onFinalize }) {
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
    } else if (result) {
      setResA(sStr(result[0])); setResB(sStr(result[1]));
      setEtA(sStr(result[3])); setEtB(sStr(result[4]));
      setPenA(sStr(result[5])); setPenB(sStr(result[6]));
    } else {
      setResA(""); setResB(""); setEtA(""); setEtB(""); setPenA(""); setPenB("");
    }
  }, [liveData?.score_a, liveData?.score_b, liveData?.et_a, liveData?.et_b,
      liveData?.pen_a, liveData?.pen_b, result?.[0], result?.[1],
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
function AdminResults({ config, matches, results, liveMatches, setResults, setLiveMatches, refreshLb, refreshLive, showToast }) {
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
      return {
        ...prev,
        [matchN]: {
          ...p, score_a: sa, score_b: sb,
          minute:  data.minute  ?? p.minute  ?? 0,
          is_live: data.is_live ?? p.is_live ?? false,
          et_a: etA, et_b: etB, pen_a: penA, pen_b: penB,
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
              ? <><span className="live-dot"/> LIVE {ld.minute}'</>
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
      "**How it works** — for every match, predict the 90-minute score. You can run multiple **forms** in parallel to try different strategies.",
      "**Scoring** — **5 pts** if you call the direction right, **+3 bonus** for the exact score, **+1** if you got one side's score right, and **+10** for picking the tournament winner.",
      { text: "**Five tabs at the top:**", subs: [
        "**Tournament** — full bracket and schedule, with live scores and your picks alongside the real results.",
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
      "Hit **Submit** when a stage is complete. You can keep editing the current stage and re-submit until it closes.",
      "Stuck on multiple strategies? Click **+ Add form** to maintain another set of picks.",
      "**Import CSV** — fill a whole stage from a spreadsheet (one line per match: `match number,home,away`). Tap the **?** beside the button for the full how-to.",
    ],
  },
  tournament: {
    badge: "🏟",
    title: "Tournament",
    body: [
      "Browse the full schedule grouped by stage.",
      "See actual results, **live** scores, and your own picks side by side.",
      "Kickoff times follow the timezone in your Settings.",
    ],
  },
  leaderboard: {
    badge: "🏆",
    title: "Leaderboard",
    body: [
      "Rankings across every submitted form, updated as results come in.",
      "Click a row to see that participant's full picks (or your own).",
      "Tap the **★** next to any name to favorite that form — your own forms are always favorited. Tap the **★** in the column header to show only your favorites.",
      "**Simulate** ▾ — see hypothetical standings *if* every remaining pick of yours comes true. Only you see the simulation.",
    ],
  },
  byuser: {
    badge: "👥",
    title: "By participant",
    body: [
      "Browse anyone's submitted forms.",
      "While a stage is still open, others' picks for that stage stay hidden — fair play.",
    ],
  },
  settings: {
    badge: "⚙️",
    title: "Settings",
    body: [
      "Set your timezone for kickoff times in the Tournament tab.",
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
const HELP_TABS = ["predictions","tournament","leaderboard","byuser","settings","results","dashboard"];

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

function SettingsView({ user, leaderboard, onLogout, onNameUpdate, showToast, config, setConfig, matches=[], results={}, setResults, liveMatches={}, refreshLive, refreshLb, onResetOnboarding }) {
  // Timezone (localStorage)
  const [tz, setTz] = useState(() => localStorage.getItem("mb_timezone") || "auto");

  function saveTz(val) {
    setTz(val);
    localStorage.setItem("mb_timezone", val);
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
        <p style={{fontSize:12,color:C.muted,marginTop:8}}>
          Affects kickoff times in the Tournament tab.
        </p>
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
              desc:<>Live matches auto-progress every 4 seconds — minutes advance, occasional goals, and matches finish automatically past minute 90.<br/><em style={{color:C.muted}}>In production this would connect to a real football API (e.g. football-data.org); in the demo it's simulated.</em></>,
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

      {/* Account */}
      <div style={sectionStyle}>
        <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:14}}>Account</h2>
        <Btn red onClick={onLogout}>Log out</Btn>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// BY USER — outside App so ParticipantPicker never remounts on App re-renders
// ─────────────────────────────────────────────────────────────────────────────
function ByUser({ config, leaderboard, results, liveMatches, matches, user,
                  viewUserId, setViewUserId, viewUserPreds, setViewUserPreds,
                  viewUserWinner, setViewUserWinner, showToast }) {
  const [predsLoading, setPredsLoading] = useState(false);

  // Select first entry once leaderboard arrives
  useEffect(() => {
    if (!viewUserId && leaderboard.length > 0) setViewUserId(leaderboard[0].entry_id||leaderboard[0].user_id);
  }, [leaderboard.length]);

  // Fetch preds when selection changes
  useEffect(() => {
    if (!viewUserId) return;
    const lbEntry = leaderboard.find(e => (e.entry_id||e.user_id) === viewUserId);
    if (!lbEntry) return;
    setPredsLoading(true);
    api.getUserPredictions(lbEntry.user_id, lbEntry.entry_id||null)
      .then(preds => {
        const m = {}; for (const p of preds) m[p.match_n] = [p.score_a, p.score_b];
        setViewUserPreds(m);
        setViewUserWinner(lbEntry.winner_pick || null);
      })
      .catch(e => showToast(e.message, "err"))
      .finally(() => setPredsLoading(false));
  }, [viewUserId]);

  const pillMap = {
    open:   {text:"🟢 Betting round is OPEN",  bg:"rgba(16,185,129,0.1)",  color:C.green, border:`1px solid ${C.green}`},
    closed: {text:"🔒 Betting round is CLOSED",bg:"rgba(239,68,68,0.1)",   color:C.red,   border:`1px solid ${C.red}`},
    idle:   {text:"⏸️ No betting round yet",   bg:"rgba(148,163,184,0.1)", color:C.muted, border:`1px solid ${C.border}`},
  };
  const pill = pillMap[config.round_state] || pillMap.idle;

  const selected = leaderboard.find(e => (e.entry_id||e.user_id) === viewUserId);
  // Show every match for which we have something to display — either the
  // participant has a prediction OR the match has been started/finished.
  // For admins the backend returns the full prediction set, so they see
  // every match the participant bet on. For non-admin viewers the backend
  // already restricts to matches with results/live (privacy), so unplayed
  // predictions on others won't appear regardless.
  const displayMatches = matches.filter(m =>
       viewUserPreds[m.n]?.[0] != null
    || results[m.n] != null
    || liveMatches[m.n] != null
  );
  const playedCount = matches.filter(m => results[m.n] || liveMatches[m.n]).length;

  const roundOpen = config.round_state === "open";
  const openStage = config.current_stage || 1;

  return (
    <div>
      <div style={{marginBottom:14}}>
        <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,
          background:pill.bg,color:pill.color,border:pill.border}}>{pill.text}</span>
      </div>
      <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>By participant</h1>
      <InfoBlock>
        Only <b>submitted</b> forms are shown here. Showing <b>{displayMatches.length}</b> prediction{displayMatches.length!==1?"s":""} for this form ({playedCount} with a result so far).
      </InfoBlock>
      <div style={{marginBottom:16}}>
        <ParticipantPicker entries={leaderboard} value={viewUserId} onChange={setViewUserId}/>
      </div>
      {selected&&(
        <div style={{textAlign:"right",padding:"8px 12px",background:C.panel2,borderRadius:6,marginBottom:12,fontSize:14,color:C.text}}>
          <b>{selected.name}:</b> <span style={{color:C.accent,fontWeight:700,fontFamily:"monospace"}}>{selected.total}</span> pts
          &nbsp;·&nbsp;winner: <b>{viewUserWinner?withFlag(viewUserWinner):"—"}</b>
        </div>
      )}
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10,
        opacity:predsLoading?0.5:1,transition:"opacity .25s"}}>
        {predsLoading&&<div style={{textAlign:"center",padding:16,color:C.muted,fontSize:13}}>Loading predictions…</div>}
        {displayMatches.map(m=>(
          <MatchRow key={m.n} match={resolvedMatch(m, results, matches)}
            pred={viewUserPreds[m.n]??null} result={results[m.n]??null}
            liveData={liveMatches[m.n]??null}
            editable={false} adminResult={false} roundState={config.round_state}
            onSave={()=>{}} onResultSave={()=>{}}/>
        ))}
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

  const [user,setUser]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [tab,setTab]=useState("auth");
  const [matches,setMatches]=useState([]);
  const [teams,setTeams]=useState([]);
  const [config,setConfig]=useState({round_state:"idle",tournament_winner:null,data_source:"manual",current_stage:1});
  const [myPreds,setMyPreds]=useState({});
  const [myWinner,setMyWinner]=useState(null);
  const [results,setResults]=useState({});
  const [leaderboard,setLeaderboard]=useState([]);
  const [participants,setParticipants]=useState([]);
  const [adminParticipants,setAdminParticipants]=useState([]);
  const [entries,setEntries]=useState([]);
  const [activeEntryId,setActiveEntryId]=useState(null);
  const [lockedWinner,setLockedWinner]=useState(null);
  const [viewEntryId,setViewEntryId]=useState(null);
  const [viewUserPreds,setViewUserPreds]=useState({});
  const [viewUserWinner,setViewUserWinner]=useState(null);
  const [liveMatches,setLiveMatches]=useState({});
  const [predsLoaded,setPredsLoaded]=useState(false);
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
  const [hoveredRow,setHoveredRow]=useState(null);
  // Lifted so LeaderboardView (called inline, not mounted) can branch its
  // layout responsively without itself calling a hook conditionally.
  const isMobile = useIsMobile();
  // Per-stage rank movement is driven by config.stage_baseline (a server-side
  // snapshot of the standings taken when the stage last advanced) — see
  // LeaderboardView. No client-side tracking needed.
  const [simMode,setSimMode]=useState(false);
  const [simLb,setSimLb]=useState(null);
  const [simLoading,setSimLoading]=useState(false);
  // When the user owns multiple forms, they can pick which form's predictions
  // drive the simulation. Defaults to the currently active form. Other forms'
  // predictions are fetched on demand and cached here.
  const [simEntryId,setSimEntryId]=useState(null);
  const [simPredsByEntry,setSimPredsByEntry]=useState({}); // {entryId: {match_n:[a,b]}}
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
  const unplayedPredMatches = matches.filter(m=>!results[m.n]&&!liveMatches[m.n]&&simPreds?.[m.n]?.[0]!=null);
  // Simulate / Actual toggle is always available for a stable UI. When there
  // are no unplayed predictions the simulated leaderboard equals the actual
  // one, so flipping the toggle is just a no-op rather than the button
  // disappearing.
  const canSim = !!user;
  // Fetch the simulated leaderboard when Simulate turns on, or when the user
  // switches which form to simulate from. Unplayed matches resolve to the
  // chosen form's predictions (and, if no champion yet, my winner pick).
  useEffect(()=>{
    if(!simMode||!canSim){ setSimLb(null); return; }
    const override={};
    for(const m of unplayedPredMatches){ const p=simPreds[m.n]; if(p?.[0]!=null&&p?.[1]!=null) override[m.n]=[p[0],p[1]]; }
    const winnerPick = lockedWinner||myWinner;
    const winnerOverride = (!config.tournament_winner&&winnerPick)?winnerPick:null;
    setSimLoading(true);
    api.getSimulatedLeaderboard(override,winnerOverride)
      .then(rows=>setSimLb(rows)).catch(()=>setSimLb(null)).finally(()=>setSimLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[simMode,effectiveSimEntryId,simPreds]);
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
    try {
      // Single round-trip: /api/init/ returns everything at once
      const d = await initApi.load();

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

      // Live matches (may not exist yet if table not created)
      if (d.live) {
        const liveMap={};for(const m of d.live)liveMap[m.match_n]={score_a:m.score_a,score_b:m.score_b,minute:m.minute,is_live:!!m.is_live,winner:m.winner??null,et_a:m.et_a??null,et_b:m.et_b??null,pen_a:m.pen_a??null,pen_b:m.pen_b??null};
        setLiveMatches(liveMap);
      }

      if(!isAdmin&&userId){
        if(d.entries&&d.entries.length>0){
          setEntries(d.entries);
          setActiveEntryId(id=>id||d.entries[0].id);
          const first=d.entries[0];
          const predMap={};for(const p of(first.predictions||[]))predMap[p.match_n]=[p.score_a,p.score_b];
          setMyPreds(predMap);
          setMyWinner(first.winner_pick||(d.locked_winner??null));
        }else if(d.my_predictions){
          const predMap={};for(const p of d.my_predictions)predMap[p.match_n]=[p.score_a,p.score_b];
          setMyPreds(predMap);
          const myEntry=d.leaderboard.find(e=>e.user_id===userId);
          if(myEntry)setMyWinner(myEntry.winner_pick||null);
        }
        if(d.locked_winner!==undefined)setLockedWinner(d.locked_winner);
      }
      if(isAdmin&&d.participants){
        setAdminParticipants(d.participants);
        setParticipants(d.users||d.participants.map(p=>({id:p.id,name:p.name,email:p.email,has_paid:p.has_paid,is_admin:false})));
      }else if(isAdmin&&d.users){
        setParticipants(d.users);
      }
      setPredsLoaded(true); // always clear loading state
    } catch(e){setGlobalErr(e.message);}
  },[]);

  // Pre-load config + cached matches immediately (before auth check)
  useEffect(()=>{
    api.getConfig().then(cfg=>setConfig(cfg)).catch(()=>{});
    // Restore static matches from sessionStorage for instant render
    try {
      const cached = JSON.parse(sessionStorage.getItem("mb_matches")||"null");
      if (cached && cached.m?.length) { setMatches(cached.m); setTeams(cached.t); }
    } catch {}
  },[]);

  useEffect(()=>{
    if(!getToken()){setAuthLoading(false);return;}
    api.me().then(u=>{setUser(u);setAuthLoading(false);loadGameData(u.is_admin,u.id);}).catch(()=>{setToken(null);setAuthLoading(false);});
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
    setTab(config.round_state === "closed" ? "leaderboard" : "predictions");
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
      // Welcome covers My predictions too — flip both seen flags on close.
      setHelpEntry({ ...HELP_CONTENT.welcome, _flagKeys: ["welcome","predictions"] });
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
  function doLogout(){setToken(null);setUser(null);setTab("auth");setMyPreds({});setMyWinner(null);setLeaderboard([]);setParticipants([]);setEntries([]);setActiveEntryId(null);setLockedWinner(null);setAdminParticipants([]);}

  async function refreshLive() {
    try {
      const list = await liveApi.getAll();
      const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute,is_live:!!x.is_live,winner:x.winner??null,et_a:x.et_a??null,et_b:x.et_b??null,pen_a:x.pen_a??null,pen_b:x.pen_b??null};
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
        const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute,is_live:!!x.is_live,winner:x.winner??null,et_a:x.et_a??null,et_b:x.et_b??null,pen_a:x.pen_a??null,pen_b:x.pen_b??null};
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
      const lb=await api.getLeaderboard();setLeaderboard(lb);
      // Sync winner pick only for the currently-active entry so a newly-created
      // empty form doesn't inherit another entry's pick via user_id lookup.
      if(user&&!user.is_admin){
        const e=lb.find(e=>e.entry_id===activeEntryId);
        if(e&&!lockedWinner)setMyWinner(e.winner_pick||null);
      }
      if(user?.is_admin){
        const [u,p]=await Promise.all([api.getUsers(),api.getAdminParticipants()]);
        setParticipants(u);setAdminParticipants(p);
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

  // Re-fetch round config (round_state, current_stage, tournament_winner) so the
  // admin's state transitions — open/close the round, advance the stage, set the
  // tournament winner — propagate to every client without a reload. Skipped on
  // the admin's Dashboard, where they're the ones driving those changes.
  async function refreshConfig(){
    if(user?.is_admin && tab==="dashboard") return;
    try { const cfg=await api.getConfig(); setConfig(cfg); }
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
      refreshConfig();                                       // even while idle
      if (config.round_state !== "idle") { refreshLive(); refreshLb(); refreshResults(); }
    };
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, config.round_state, tab]);

  const tabs=!user?[]:user.is_admin
    ?[{id:"tournament",label:"🏟 Tournament"},{id:"leaderboard",label:"Leaderboard"},{id:"byuser",label:"By participant"},{id:"results",label:"Results",admin:true},{id:"dashboard",label:"Dashboard",admin:true},{id:"settings",label:"⚙ Settings"}]
    :[{id:"tournament",label:"🏟 Tournament"},{id:"leaderboard",label:"Leaderboard"},...(leaderboard.length>0?[{id:"byuser",label:"By participant"}]:[]),{id:"predictions",label:"My predictions"},{id:"settings",label:"⚙ Settings"}];

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
    // Winner pick is required only on stage 1 submission.
    const winnerNeededForSubmit = openStage === 1 && !(myWinner || lockedWinner);
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
      setActiveEntryId(entryId);
      const entry=entries.find(e=>e.id===entryId);
      if(entry){
        const m={};for(const p of(entry.predictions||[]))m[p.match_n]=[p.score_a,p.score_b];
        setMyPreds(m);
        setMyWinner(entry.winner_pick||(lockedWinner??null));
      }
    }

    async function savePred(matchN,data){
      await api.setPrediction(matchN,data,activeEntryId);
      setMyPreds(p=>({...p,[matchN]:[data.score_a,data.score_b]}));
      // Editing a prediction invalidates this stage's submission — user has
      // to re-click "Submit stage N" to confirm the changes. Mirror the
      // server (set_prediction clears the same key) in local state so the
      // Submit button reappears immediately.
      const stageOfMatch = matchStageObj(matchN).n;
      setEntries(es=>es.map(e=>{
        if (e.id !== activeEntryId) return e;
        const preds = [...(e.predictions||[]).filter(p=>p.match_n!==matchN),
                       {match_n:matchN,score_a:data.score_a,score_b:data.score_b}];
        const stagesSub = {...(e.stages_submitted||{})};
        delete stagesSub[stageOfMatch];
        delete stagesSub[String(stageOfMatch)];
        return {...e, predictions: preds, stages_submitted: stagesSub};
      }));
      showToast("Saved · re-submit to confirm");
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
      showToast(`Random-filled ${filled.length} match${filled.length===1?"":"es"} · stage ${stageN} 🎲`);

      // 2) Persist in the BACKGROUND, all in parallel (fast), to the target form.
      Promise.allSettled(
        filled.map(f => api.setPrediction(f.n, { score_a: f.a, score_b: f.b }, targetId))
      ).then(() => { refreshLb(); });
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
          const lines = String(reader.result||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
          const parsed = [];
          for(const line of lines){
            const c = line.split(",").map(x=>x.trim());
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
          showToast(`Imported ${apply.length} match${apply.length===1?"":"es"}${skipped?` · ${skipped} skipped`:""} 📄`);
          Promise.allSettled(apply.map(f=>api.setPrediction(f.n,{score_a:f.a,score_b:f.b},targetId))).then(()=>refreshLb());
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
        await api.submitEntry(activeEntryId);
        const now=new Date().toISOString();
        setEntries(es=>es.map(e=>e.id!==activeEntryId?e:{
          ...e,
          submitted_at: e.submitted_at || now,
          stages_submitted: {...(e.stages_submitted||{}), [openStage]: now},
        }));
        if(openStage===1 && !lockedWinner) setLockedWinner(myWinner);
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

    async function deleteEntryById(entryId){
      const ok = await confirmDialog({
        title: "Delete this form?",
        message: "All predictions and the winner pick on this form will be removed. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if(!ok)return;
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
                          {openStage===1&&(
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

        {/* Unified action toolbar — merges Submit + blockers, the winner pick,
            the Total pill, the scoring legend (now a hover) and Delete onto a
            single row, instead of three stacked blocks. Wraps cleanly on
            narrow screens. */}
        {activeEntry&&activeFormActive&&(() => {
          const missing = Math.max(0, submittableMatches.length - filledCount);
          const blockers = [];
          if (missing > 0) blockers.push(`🎯 ${missing} match${missing===1?"":"es"} still to fill`);
          if (winnerNeededForSubmit) blockers.push("🏆 winner pick needed");
          const winnerLocked = openStage > 1 || !editable;
          const shownWinner  = myWinner || lockedWinner;
          return (
            <div style={{
              background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"8px 12px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",
              marginBottom:14,position:"relative",zIndex:10,
            }}>
              {/* Left: Submit / Submitted badge */}
              {editable&&!currentStageSubmitted&&(
                <>
                  <Btn green onClick={submitEntry} disabled={!canSubmit||submitting}
                    title={blockers.length ? `Can't submit yet: ${blockers.join(", ")}` : ""}>
                    {submitting
                      ? "…"
                      : entries.length > 1
                        ? `Submit "${activeEntry?.name||"this form"}"`
                        : "Submit"}
                  </Btn>
                  {!canSubmit&&blockers.length>0&&(
                    <span style={{
                      display:"inline-flex",alignItems:"center",gap:6,
                      background:"rgba(245,158,11,0.10)",color:"#f59e0b",
                      border:"1px solid rgba(245,158,11,0.35)",
                      padding:"4px 10px",borderRadius:999,fontSize:12,fontWeight:500,whiteSpace:"nowrap",
                    }}>{blockers.join(" · ")}</span>
                  )}
                </>
              )}
              {editable&&currentStageSubmitted&&(
                <span style={{
                  background:"rgba(16,185,129,0.10)",color:C.green,
                  border:"1px solid rgba(16,185,129,0.35)",
                  padding:"5px 12px",borderRadius:999,fontSize:12,fontWeight:600,whiteSpace:"nowrap",
                }}>✓ Stage {openStage} submitted</span>
              )}

              {!activeEntry.submitted_at&&entries.length>1&&editable&&(
                <Btn ghost red onClick={()=>deleteEntryById(activeEntry.id)}>Delete</Btn>
              )}

              {/* Push the winner chip + total pill to the right edge */}
              <span style={{flex:1,minWidth:0}}/>

              {/* Winner pick (compact chip when locked, full picker while editable) */}
              {winnerLocked ? (
                <span title="Tournament winner pick (+10 pts)" style={{
                  display:"inline-flex",alignItems:"center",gap:6,fontSize:13,
                  background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 10px",whiteSpace:"nowrap",
                }}>
                  🏆 <b style={{fontWeight:700}}>{shownWinner?withFlag(shownWinner):"—"}</b>
                  <span style={{background:"rgba(99,102,241,0.12)",color:C.indigo,border:`1px solid ${C.indigo}`,padding:"1px 6px",borderRadius:4,fontSize:10,fontWeight:700}}>🔒</span>
                </span>
              ) : (
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>🏆 Winner (+10):</span>
                  <TeamPicker value={myWinner} onChange={saveWinner} teams={teams} disabled={false} placeholder="Choose a team…"/>
                </div>
              )}
              {config.tournament_winner&&<span style={{color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>🏆 actual: <b style={{color:C.accent}}>{withFlag(config.tournament_winner)}</b></span>}

              {/* Total points pill */}
              {myLbEntry&&(
                <div style={{
                  display:"inline-flex",alignItems:"baseline",gap:7,
                  background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,
                  padding:"5px 11px",fontSize:12,color:C.muted,whiteSpace:"nowrap",
                }} title={`Total for "${activeEntry.name}"`}>
                  <span style={{color:C.muted,fontWeight:600,letterSpacing:".5px",textTransform:"uppercase",fontSize:10}}>Total</span>
                  <b style={{color:C.accent,fontSize:18,fontFamily:"monospace",fontWeight:700,lineHeight:1}}>{myLbEntry.total}</b>
                  <span>pts · {myLbEntry.scored_matches}/{matches.length}</span>
                  {myLbEntry.winner_bonus>0&&<span style={{color:C.green,fontWeight:600}}>· 🏆 +10</span>}
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

        {/* Jump-to-live banner — appears when any of the user's submittable
            matches has been marked live by the admin. One click and the
            first live match scrolls into view. */}
        {(() => {
          const liveNums = Object.entries(liveMatches)
            .filter(([,ld]) => ld?.is_live)
            .map(([n]) => Number(n))
            .sort((a,b) => a - b);
          if (liveNums.length === 0) return null;
          const jumpTo = (n) => {
            // Make sure the stage containing this match is expanded so the
            // scroll target actually exists in the DOM.
            const stageN = matchStageObj(n).n;
            setCollapsedStages(prev => {
              if (!prev.has(stageN)) return prev;
              const next = new Set(prev); next.delete(stageN); return next;
            });
            // requestAnimationFrame so the DOM has updated after the toggle.
            requestAnimationFrame(() => {
              const el = document.querySelector(`[data-match-n="${n}"]`);
              if (el) {
                el.scrollIntoView({block:"center",behavior:"smooth"});
                el.animate(
                  [{boxShadow:"0 0 0 2px "+C.red},{boxShadow:"0 0 0 0 transparent"}],
                  {duration:1400,easing:"ease-out"}
                );
              }
            });
          };
          return (
            <div style={{
              display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
              background:"rgba(239,68,68,0.08)",border:`1px solid rgba(239,68,68,0.35)`,
              borderRadius:8,padding:"7px 12px",marginBottom:10,
            }}>
              <span style={{display:"inline-flex",alignItems:"center",gap:6,color:C.red,fontWeight:600,fontSize:13}}>
                <span className="live-dot"/>
                {liveNums.length} match{liveNums.length===1?"":"es"} live now
              </span>
              <span style={{flex:1,minWidth:0}}/>
              {liveNums.slice(0,4).map(n => (
                <button key={n} onClick={()=>jumpTo(n)} style={{
                  background:"transparent",border:`1px solid ${C.red}`,color:C.red,
                  padding:"3px 9px",borderRadius:999,fontSize:11,fontWeight:600,cursor:"pointer",
                  fontFamily:"monospace",
                }}>#{n}</button>
              ))}
              <button onClick={()=>jumpTo(liveNums[0])} style={{
                background:C.red,color:"#fff",border:0,padding:"5px 12px",borderRadius:999,
                fontSize:12,fontWeight:700,cursor:"pointer",
              }}>
                Jump to live →
              </button>
            </div>
          );
        })()}

        {STAGES.map(s => {
          const stageMatches = matches.filter(m => m.n >= s.first && m.n <= s.last);
          if (stageMatches.length === 0) return null;
          const isCollapsed = collapsedStages.has(s.n);

          // Locked stage: non-interactive header only
          if (s.n > openStage) {
            return (
              <div key={s.n}>
                <div style={{
                  background:C.panel2,padding:"8px 12px",borderRadius:6,
                  margin:"16px 0 6px",fontWeight:600,color:C.muted,fontSize:14,
                  display:"flex",alignItems:"center",justifyContent:"space-between",
                }}>
                  <span>
                    <span style={{marginRight:6}}>🔒</span>
                    Stage {s.n}: {s.name}
                    <span style={{marginLeft:8,fontSize:12,fontWeight:400}}>locked</span>
                  </span>
                </div>
                <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,
                  padding:"10px 14px",marginBottom:8,fontSize:13,color:C.muted,
                  display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:16}}>🔒</span>
                  <span>Stage {s.n} predictions open after admin advances the tournament.</span>
                </div>
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
                  {isCurrent && editable && !(activeEntry?.stages_submitted||{})[s.n] && (
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
                        onResultSave={()=>{}}/>
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
    const jumpToParticipant = (row) => {
      if (!canJumpToParticipant) return;
      setViewEntryId(row.entry_id || row.user_id);
      setTab("byuser");
    };

    // Simulate mode — state + fetch effect live in App (see lifted block);
    // unplayedPredMatches / canSim / simMode / simLb / simLoading are in scope
    // here via closure.
    // Per-row "diff vs actual" badge data
    const actualTotalsByEntry = Object.fromEntries(leaderboard.map(e => [e.entry_id, e.total]));

    const displayLb = (simMode && simLb)
      ? simLb.map(e => ({...e, _simDiff: e.total - (actualTotalsByEntry[e.entry_id] ?? e.total)}))
      : leaderboard;

    // Favorites filter — every row (including the user's own forms) can be a
    // favorite, so the filter is a straight "is this row favorited" check.
    const filteredLb = favOnly ? displayLb.filter(isFavRow) : displayLb;
    const hasFavs = displayLb.some(isFavRow);

    // Per-stage rank movement: standings snapshot taken when the current stage
    // opened (server-side, in config.stage_baseline). A row's movement = its
    // rank at the start of this stage minus its current rank (+N climbed,
    // -N dropped). Only for the current stage's baseline, and not in Simulate.
    const baselineRanks = (config.stage_baseline
      && config.stage_baseline.stage === (config.current_stage || 1))
      ? config.stage_baseline.ranks : null;

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
        <LiveNowSection liveMatches={liveMatches} matches={matches}/>
        <div style={{marginBottom:14}}><RoundPill/></div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          marginBottom:12,flexWrap:"wrap",gap:8}}>
          <h1 style={{color:C.accent,fontSize:20,margin:0}}>🏆 Leaderboard</h1>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {canSim&&(
              // Option B layout: classic Actual / Simulate toggle. When the
              // user has 2+ forms AND Simulate is ON, indigo pill-chips slide
              // in to the right of the toggle, one per form. Picking a chip
              // switches which form drives the simulation. Chips fade out
              // when Simulate is turned off (the toggle itself stays in
              // place, so the primary on/off is always a single click away).
              <div style={{display:"inline-flex",
                flexDirection:isMobile?"column":"row",
                alignItems:isMobile?"flex-start":"center",
                gap:isMobile?8:0,
                width:isMobile?"100%":"auto"}}>
                <div style={{display:"flex",background:C.panel,
                  border:`1px solid ${C.border}`,borderRadius:6,overflow:"hidden",
                  fontSize:12}}>
                  <button onClick={()=>setSimMode(false)} style={{
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
                {entries.length > 1 && (isMobile ? (
                  // Mobile: there's no horizontal room beside the toggle, so the
                  // chips wrap onto their own row(s) below it, revealed by a
                  // vertical (max-height) expand instead of a sideways slide.
                  <div style={{
                    width:"100%",overflow:"hidden",
                    maxHeight:simMode?260:0,
                    opacity:simMode?1:0,
                    pointerEvents:simMode?"auto":"none",
                    transition:"max-height .45s cubic-bezier(.4,0,.2,1), opacity .35s ease",
                  }}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,paddingTop:2}}>
                      {formChips}
                    </div>
                  </div>
                ) : (
                  // Desktop: chip cluster sits in a collapsible box — when
                  // Simulate is OFF the box has 0 width (overflow clipped), so
                  // the toggle sits at its natural rightmost position. Flipping
                  // Simulate ON expands it, sliding the toggle left while the
                  // chips fade + slide in.
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
                ))}
              </div>
            )}
          </div>
        </div>

        {simMode&&(
          <div style={{background:"rgba(99,102,241,0.12)",border:`1px solid ${C.indigo}`,
            borderRadius:6,padding:"7px 14px",marginBottom:14,fontSize:13,color:C.indigo}}>
            {unplayedPredMatches.length>0
              ? <>✨ Simulating <b>{unplayedPredMatches.length}</b> unplayed match{unplayedPredMatches.length!==1?"es":""} with <b>your</b> predictions as results — all users' scores are recomputed accordingly{simLoading?" · loading…":""}</>
              : <>✨ <b>Simulation mode is on.</b> No unplayed predictions to apply — the standings here match the actual leaderboard.</>}
          </div>
        )}

        {leaderboard.length===0
          ?<div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>No participants yet.</div>
          :(
            <>
            {favOnly&&!hasFavs&&(
              <div style={{textAlign:"center",padding:"14px 20px",color:C.muted,fontSize:13,marginBottom:10,background:C.panel,border:`1px solid ${C.border}`,borderRadius:8}}>
                No favorites yet — turn the ★ filter off and tap <span style={{color:C.muted}}>☆</span> on any row to add one.
              </div>
            )}
            {filteredLb.length>0&&(
            <div className="lb-table-wrap" style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,minWidth:320}}>
                <thead><tr style={{background:C.panel2}}>
                  <th style={{padding:"8px 4px",width:40,textAlign:"center",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>#</th>
                  <th style={{padding:"8px 4px",width:40,textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                    <span
                      onClick={()=>setFavOnly(v=>!v)}
                      title={favOnly?"Showing favorites only — click to show all":"Show favorites only"}
                      style={{cursor:"pointer",fontSize:17,lineHeight:1,userSelect:"none",
                        color:favOnly?C.accent:C.muted,opacity:favOnly?1:0.7,transition:"all .15s"}}>
                      {favOnly?"★":"☆"}
                    </span>
                  </th>
                  {["Name","Points","Winner pick"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Points"?"center":"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
                  {canJumpToParticipant&&<th style={{padding:"8px 6px",width:28,borderBottom:`1px solid ${C.border}`}}/>}
                </tr></thead>
                <tbody>
                  {filteredLb.map((row)=>{
                    // Always show global rank (position in the unfiltered display list)
                    const globalRank = displayLb.indexOf(row) + 1;
                    const isMe=row.user_id===user?.id;
                    const isFav=isFavRow(row);
                    // Visual sim-mode (indigo row + total) is on whenever the
                    // user toggled Simulate. The "+N sim" diff badge is only
                    // shown when this row's total actually moved.
                    const isSim=simMode;
                    const simDiff=row._simDiff||0;
                    const hasSimDiff=simMode&&row._simDiff!=null&&row._simDiff!==0;
                    const i = globalRank - 1;
                    const rowBg=i===0?"rgba(163,230,53,0.12)":i===1?"rgba(163,230,53,0.07)":i===2?"rgba(163,230,53,0.03)":isFav?"rgba(163,230,53,0.05)":"transparent";
                    let winnerCell;
                    if(winnerKnown)winnerCell=row.winner_pick?<>{withFlag(row.winner_pick)}{row.winner_bonus>0&&<span style={{color:C.green}}> +10</span>}</>:"—";
                    else winnerCell=row.winner_pick?withFlag(row.winner_pick):"—";
                    const rowKey=row.entry_id||row.user_id;
                    const isHovered=hoveredRow===rowKey;
                    const baseBg=isSim?"rgba(99,102,241,0.06)":rowBg;
                    const hoverBg=isMe?"rgba(163,230,53,0.22)":isFav?"rgba(163,230,53,0.15)":"rgba(163,230,53,0.08)";
                    return (
                      <tr key={rowKey}
                          onMouseEnter={canJumpToParticipant?()=>setHoveredRow(rowKey):undefined}
                          onMouseLeave={canJumpToParticipant?()=>setHoveredRow(null):undefined}
                          onClick={canJumpToParticipant?()=>jumpToParticipant(row):undefined}
                          title={canJumpToParticipant?"View this form's predictions":undefined}
                          style={{
                            background:(canJumpToParticipant&&isHovered)?hoverBg:baseBg,
                            borderLeft: isMe ? `3px solid ${C.accent}` : isFav ? `3px solid ${C.accent}` : "3px solid transparent",
                            cursor:canJumpToParticipant?"pointer":"default",
                            transition:"background .12s",
                          }}>
                        <td style={{...td,textAlign:"center",width:40,padding:"8px 4px"}}>
                          <b>{globalRank}</b>
                          {(() => {
                            if (simMode || !baselineRanks) return null;
                            const baseRank = baselineRanks[row.entry_id];
                            if (baseRank == null) return null;
                            const delta = baseRank - globalRank;   // +climbed / -dropped
                            if (delta === 0) return null;
                            return (
                              <div style={{fontSize:10,fontWeight:700,lineHeight:1,marginTop:2,
                                color:delta>0?C.green:C.red}}
                                title={delta>0?`Up ${delta} place${delta===1?"":"s"} this stage`:`Down ${-delta} place${delta===-1?"":"s"} this stage`}>
                                {delta>0?`+${delta}`:`${delta}`}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{...td,textAlign:"center",width:40,padding:"8px 4px"}}>
                          {isMe?(
                            <span
                              onClick={(e)=>e.stopPropagation()}
                              title="Your own form — always in your favorites"
                              style={{fontSize:16,lineHeight:1,userSelect:"none",cursor:"default",color:C.accent}}>
                              ★
                            </span>
                          ):(
                            <span
                              onClick={(e)=>{e.stopPropagation();toggleFavorite(rowKey);}}
                              title={isFav?"Remove from favorites":"Add to favorites"}
                              style={{cursor:"pointer",fontSize:16,lineHeight:1,userSelect:"none",
                                color:isFav?C.accent:C.muted,opacity:isFav?1:0.5,transition:"all .15s"}}>
                              {isFav?"★":"☆"}
                            </span>
                          )}
                        </td>
                        <td style={td}>{row.name}
                          {isMe&&<span style={{background:C.indigo,color:"white",fontSize:10,padding:"1px 5px",borderRadius:4,marginLeft:6}}>YOU</span>}
                        </td>
                        <td style={{...td,textAlign:"center",color:isSim?C.indigo:C.accent,fontWeight:700,fontFamily:"monospace",fontSize:17}}>
                          {row.total}
                          {hasSimDiff&&<span style={{display:"inline-flex",alignItems:"center",gap:2,marginLeft:6,background:"rgba(99,102,241,0.12)",color:C.indigo,border:`1px solid ${C.indigo}`,padding:"1px 6px",borderRadius:4,fontSize:10,fontWeight:700,verticalAlign:"middle"}}>{simDiff>0?"+":""}{simDiff} sim</span>}
                        </td>
                        <td style={td}>{winnerCell}</td>
                        {canJumpToParticipant&&(
                          <td style={{...td,textAlign:"right",color:isHovered?C.accent:C.muted,fontSize:16,opacity:isHovered?1:0.35,transition:"all .12s",width:28,paddingRight:12}}>
                            →
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
            </>
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
              <button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?(t.admin?C.red:C.accent):"transparent",color:tab===t.id?"white":(t.admin?C.red:C.text),border:`1px solid ${tab===t.id?(t.admin?C.red:C.accent):C.border}`,padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:tab===t.id?700:400}}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",fontSize:13}}>
            {user&&<span style={{color:C.text}}>Hi <b style={{color:C.accent}}>{user.name}</b>{user.is_admin?" 👑":""}</span>}
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
        const showBanner = simActive && ["leaderboard","byuser","tournament"].includes(tab);
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
              <span>🔮 <b>Simulation</b> — unplayed games are shown as if they finish exactly as <b>your</b> predictions. Scores &amp; standings are hypothetical (only you see this).</span>
              <button onClick={()=>setSimMode(false)} style={{background:C.indigo,color:"white",
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
        {user&&tab==="byuser"&&(
          <ByUser
            config={config} leaderboard={effLeaderboard} results={effResults}
            liveMatches={liveMatches} matches={matches} user={user} simActive={simActive}
            viewUserId={viewEntryId} setViewUserId={setViewEntryId}
            viewUserPreds={viewUserPreds} setViewUserPreds={setViewUserPreds}
            viewUserWinner={viewUserWinner} setViewUserWinner={setViewUserWinner}
            showToast={showToast}
          />
        )}
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
          setResults={setResults} setLiveMatches={setLiveMatches} refreshLb={refreshLb} refreshLive={refreshLive} showToast={showToast}
        />}
        {user&&tab==="tournament"&&<Tournament matches={matches} results={effResults} liveMatches={liveMatches} myPreds={myPreds} config={config} user={user}/>}
        {user&&tab==="settings"&&<SettingsView user={user} leaderboard={leaderboard} onLogout={doLogout} onNameUpdate={u=>{setUser(u);showToast("Name updated ✓");}} showToast={showToast} config={config} setConfig={setConfig} matches={matches} results={results} setResults={setResults} liveMatches={liveMatches} refreshLive={refreshLive} refreshLb={refreshLb} onResetOnboarding={resetOnboarding}/>}
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
