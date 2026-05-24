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

// Resolve slot names like "W M73" / "L M101" to actual team names using known results
function resolveTeam(name, results, matches) {
  const m = name.match(/^([WL]) M(\d+)$/);
  if (!m) return name;
  const type = m[1], n = Number(m[2]);
  const res = results[n];
  const src = matches.find(x => x.n === n);
  if (!res || !src) return name; // TBD
  const [sa, sb] = res;
  if (sa === sb) return name;   // Draw — shouldn't happen in KO rounds
  return type === 'W' ? (sa > sb ? src.a : src.b) : (sa > sb ? src.b : src.a);
}

// Recursive variant: resolves through multiple rounds using any scores map (results or sim preds)
function resolveTeamDeep(name, scoresMap, matchList, depth = 0) {
  if (depth > 8) return name;
  const m = name.match(/^([WL]) M(\d+)$/);
  if (!m) return name;
  const type = m[1], n = Number(m[2]);
  const src = matchList.find(x => x.n === n);
  if (!src) return name;
  const teamA = resolveTeamDeep(src.a, scoresMap, matchList, depth + 1);
  const teamB = resolveTeamDeep(src.b, scoresMap, matchList, depth + 1);
  const res = scoresMap[n];
  if (!res) return name;
  const [sa, sb] = res;
  if (sa === sb) return name;
  return type === 'W' ? (sa > sb ? teamA : teamB) : (sa > sb ? teamB : teamA);
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
    if(a===""||b==="") return;
    pendingSaveRef.current = true;
    try { await onSave(match.n,{score_a:Number(a),score_b:Number(b)}); }
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

  // Effective score: final result wins, otherwise the in-motion live score.
  // This way users see their points adjust in real time as the admin enters
  // scores — even before the match is marked FINAL.
  const effectiveScore = result
    ? result
    : (liveData && liveData.score_a != null ? [liveData.score_a, liveData.score_b] : null);
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
    if (goalsMatched===1) partialMatchSide = p1===r1 ? 0 : 1;
    ptsEl=<span style={{background:ptsPalette.bg,color:ptsPalette.fg,border:`1px solid ${ptsPalette.border}`,padding:"1px 6px",borderRadius:4,fontWeight:700,fontFamily:"monospace",fontSize:11}}>+{total}</span>;
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
  }
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
    <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
      <input type="number" inputMode="numeric" min={0} max={20} value={localA}
        onFocus={handleFocus} onChange={e=>setLocalA(e.target.value)} onBlur={e=>savePred(0,e.target.value)} style={numInput}/>
      <span style={{color:C.muted,fontSize:13}}>:</span>
      <input type="number" inputMode="numeric" min={0} max={20} value={localB}
        onFocus={handleFocus} onChange={e=>setLocalB(e.target.value)} onBlur={e=>savePred(1,e.target.value)} style={numInput}/>
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
                  const formsText=[
                    u.submitted_count>0?`${u.submitted_count} submitted`:"",
                    u.draft_count>0?`${u.draft_count} draft`:"",
                  ].filter(Boolean).join(" · ")||"no forms";
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
                          <span style={{fontWeight:600}}>{formsText}</span>
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
                        const badge=isDraft
                          ?<span style={{marginLeft:7,padding:"1px 7px",borderRadius:4,fontSize:11,fontWeight:700,background:"rgba(245,158,11,0.15)",color:"#f59e0b",border:"1px solid rgba(245,158,11,0.35)"}}>DRAFT</span>
                          :<span style={{marginLeft:7,padding:"1px 7px",borderRadius:4,fontSize:11,fontWeight:700,background:"rgba(245,158,11,0.15)",color:"#f59e0b",border:"1px solid rgba(245,158,11,0.35)"}}>{entry.filled}/{entry.total_matches}</span>;
                        return (
                          <tr key={entry.id} style={{background:C.bg,borderTop:`1px solid ${C.border}`}}>
                            <td style={td}/>
                            <td style={{...td,paddingLeft:28}}>
                              <span style={{color:C.muted,marginRight:4}}>↳</span>
                              <span style={{fontWeight:500}}>{entry.name}</span>
                              {badge}
                            </td>
                            <td style={td}>
                              <span style={{color:C.muted,fontSize:12}}>
                                {entry.filled}/{entry.total_matches} matches filled
                                {entry.winner_pick&&<> · winner: <b style={{color:C.accent}}>{withFlag(entry.winner_pick)}</b></>}
                              </span>
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
              const winA      = dispScore
                ? (dispScore[0] > dispScore[1] ? true : dispScore[0] < dispScore[1] ? false : null)
                : null;
              const rowBg     = isMatchLive ? "rgba(239,68,68,0.06)"
                              : res         ? "rgba(16,185,129,0.04)"
                              : live        ? C.panel2
                              : C.panel2;
              const rowBd     = `1px solid ${isMatchLive ? "rgba(239,68,68,0.35)"
                              : res                       ? "rgba(16,185,129,0.2)"
                              : C.border}`;
              return (
                <div key={m.n} style={{
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
                        <div style={{fontSize:10,color:C.red,display:"flex",alignItems:"center",gap:2,justifyContent:"center"}}>
                          <span className="live-dot"/>{live.minute}′
                        </div>
                      </>
                    ) : dispScore ? (
                      <div style={{fontFamily:"monospace",fontWeight:700,
                        color:res?C.green:C.text,fontSize:15}}>
                        {dispScore[0]}:{dispScore[1]}
                      </div>
                    ) : (
                      <span style={{color:C.muted,fontSize:12}}>vs</span>
                    )}
                  </div>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",
                    color:winA===false?C.accent:winA===true?C.muted:C.text,fontWeight:winA===false?700:400}}>
                    {resolvedB} {flag(resolvedB)}
                  </span>
                </div>
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

  const [resA, setResA] = useState(hasScore ? String(liveData.score_a) : isFinal ? String(result[0]) : "");
  const [resB, setResB] = useState(hasScore ? String(liveData.score_b) : isFinal ? String(result[1]) : "");

  // Race protection — the 10s background poll + cross-tab sync both flush
  // liveMatches state from props. Without these guards, polling could wipe
  // what the admin just typed (before save completes) OR clobber freshly-
  // saved values with a stale poll response that was in flight.
  //   editingRef    — true while EITHER input is focused (user is typing)
  //   pendingSaveRef — true while our own onUpdateLive() is in flight
  const editingRef    = useRef(false);
  const pendingSaveRef = useRef(false);

  useEffect(() => {
    // Don't clobber the user's in-progress typing, and don't replace freshly
    // saved data with whatever a concurrent poll happened to return.
    if (editingRef.current || pendingSaveRef.current) return;
    if (liveData) { setResA(String(liveData.score_a)); setResB(String(liveData.score_b)); }
    else if (result) { setResA(String(result[0])); setResB(String(result[1])); }
    else { setResA(""); setResB(""); }
  }, [liveData?.score_a, liveData?.score_b, result?.[0], result?.[1]]);

  // Typing a score saves the in-motion data BUT does NOT mark the match as
  // visibly LIVE. The LIVE badge appears only when the admin explicitly
  // clicks ▶ LIVE. The row stays editable until the admin clicks ✓ FINAL.
  async function handleBlur(side, val) {
    editingRef.current = false;   // input lost focus
    const a = side===0 ? val : resA, b = side===1 ? val : resB;
    if (a===""&&b==="") return;
    const sa=Number(a)||0, sb=Number(b)||0;
    pendingSaveRef.current = true;
    try {
      // Preserve current is_live state (false unless admin already toggled it)
      await onUpdateLive(match.n, {
        score_a:sa, score_b:sb,
        minute: liveData?.minute || 0,
        is_live: !!liveData?.is_live,
      });
    } finally {
      pendingSaveRef.current = false;
    }
  }
  const handleFocus = () => { editingRef.current = true; };

  const effA = Number(resA||0), effB = Number(resB||0);
  const winA = (hasScore||isFinal) ? (effA>effB?true:effB>effA?false:null) : null;
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

  // Score / inputs block shared across layouts
  const scoreBlock = isFinal ? (
    <span style={{fontFamily:"monospace",fontWeight:700,fontSize:14,whiteSpace:"nowrap",
      color:C.green}}>✓ {result[0]}:{result[1]}</span>
  ) : (
    <div style={{display:"flex",alignItems:"center",gap:3}}>
      <input type="number" inputMode="numeric" min={0} max={20} value={resA}
        onFocus={handleFocus}
        onChange={e=>setResA(e.target.value)} onBlur={e=>handleBlur(0,e.target.value)}
        style={{...numInput,border:`1px solid ${inputBorder}`}}/>
      <span style={{color:C.muted,fontSize:13}}>:</span>
      <input type="number" inputMode="numeric" min={0} max={20} value={resB}
        onFocus={handleFocus}
        onChange={e=>setResB(e.target.value)} onBlur={e=>handleBlur(1,e.target.value)}
        style={{...numInput,border:`1px solid ${inputBorder}`}}/>
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
        <button onClick={()=>onFinalize(match.n)} style={{
          background:C.green,color:"white",border:0,padding:"2px 8px",
          borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
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
      <div style={{background:rowBg,border:rowBorder,borderRadius:6,
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
    <div style={{display:"grid",gridTemplateColumns:"28px 1fr 44px 12px 44px 1fr auto",
      alignItems:"center",gap:5,padding:"5px 8px",borderRadius:6,
      background:rowBg,border:rowBorder,marginBottom:3,fontSize:13}}>
      <span style={{color:C.muted,fontSize:11}}>#{match.n}</span>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,
        color:winA===true?C.accent:winA===false?C.muted:C.text,fontWeight:winA===true?700:400}}>
        {flag(match.a)} {match.a}
      </span>
      {isFinal ? (
        <span style={{gridColumn:"span 3",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:14,
          background:"rgba(16,185,129,0.10)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:4,padding:"3px 0",color:C.green}}>
          ✓ {result[0]}:{result[1]}
        </span>
      ) : (
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={resA}
            onFocus={handleFocus}
            onChange={e=>setResA(e.target.value)} onBlur={e=>handleBlur(0,e.target.value)}
            style={{...numInput,border:`1px solid ${inputBorder}`}}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={resB}
            onFocus={handleFocus}
            onChange={e=>setResB(e.target.value)} onBlur={e=>handleBlur(1,e.target.value)}
            style={{...numInput,border:`1px solid ${inputBorder}`}}/>
        </>
      )}
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
function AdminResults({ config, matches, results, liveMatches, setResults, refreshLb, refreshLive, showToast }) {
  const currentStage = config.current_stage || 1;
  // All stages except current start collapsed
  const [collapsedStages, setCollapsedStages] = useState(
    () => new Set(STAGES.filter(s => s.n !== currentStage).map(s => s.n))
  );
  const toggleStage = n => setCollapsedStages(prev => {
    const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next;
  });

  // On mount: expand the stage containing the first live match, then scroll to it
  useEffect(() => {
    const liveNs = Object.keys(liveMatches).map(Number).sort((a,b)=>a-b);
    if (liveNs.length === 0) return;
    const firstN = liveNs[0];
    const stageN = matchStageObj(firstN).n;
    setCollapsedStages(prev => {
      if (!prev.has(stageN)) return prev;
      const next = new Set(prev); next.delete(stageN); return next;
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`[data-match-n="${firstN}"]`)
        ?.scrollIntoView({ behavior:"smooth", block:"center" });
    }));
  }, []);

  async function saveResult(matchN, data) {
    await api.setResult(matchN, data);
    if (data.score_a != null && data.score_b != null)
      setResults(r => ({...r, [matchN]: [data.score_a, data.score_b]}));
    else
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
  async function updateLive(matchN, data) {
    try { await liveApi.set(matchN, data); await refreshLive(); }
    catch(e) { showToast(e.message, "err"); }
  }
  async function finalizeLive(matchN) {
    try {
      const res = await liveApi.finalize(matchN);
      setResults(r => ({...r, [matchN]: [res.score_a, res.score_b]}));
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
                  <AdminMatchRow key={m.n}
                    match={m}
                    result={results[m.n] ?? null}
                    liveData={liveMatches[m.n] ?? null}
                    onSaveResult={saveResult}
                    onGoLive={goLive}
                    onUpdateLive={updateLive}
                    onFinalize={finalizeLive}
                  />
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

function SettingsView({ user, leaderboard, onLogout, onNameUpdate, showToast, config, setConfig, matches=[], results={}, setResults, liveMatches={}, refreshLive, refreshLb }) {
  // Profile
  const [name,    setName]    = useState(user?.name || "");
  const [saving,  setSaving]  = useState(false);

  // Timezone (localStorage)
  const [tz, setTz] = useState(() => localStorage.getItem("mb_timezone") || "auto");

  // Rivals (localStorage — array of user IDs, keyed per user)
  const rivalsKey = `mb_rivals_${user?.id}`;
  const [rivals, setRivals] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`mb_rivals_${user?.id}`) || "[]"); }
    catch { return []; }
  });

  const seen=new Set();
  const participants=leaderboard.filter(e=>{if(e.user_id===user?.id||seen.has(e.user_id))return false;seen.add(e.user_id);return true;});

  function saveTz(val) {
    setTz(val);
    localStorage.setItem("mb_timezone", val);
    showToast("Timezone saved");
  }

  function toggleRival(uid) {
    const next = rivals.includes(uid) ? rivals.filter(r=>r!==uid) : [...rivals, uid];
    setRivals(next);
    localStorage.setItem(rivalsKey, JSON.stringify(next));
  }

  async function saveName(e) {
    e.preventDefault();
    if (!name.trim() || name.trim() === user?.name) return;
    setSaving(true);
    try {
      const updated = await api.updateMe({ name: name.trim() });
      onNameUpdate(updated);
      showToast("Name updated ✓");
    } catch(err) { showToast(err.message, "err"); }
    finally { setSaving(false); }
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
        <form onSubmit={saveName}>
          <label style={labelStyle}>Display name</label>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <input value={name} onChange={e=>setName(e.target.value)}
              style={{...inputStyle,marginBottom:0,flex:1}}
              placeholder="Your name"/>
            <Btn disabled={saving||!name.trim()||name.trim()===user?.name}>
              {saving?"…":"Save"}
            </Btn>
          </div>
        </form>
        <label style={labelStyle}>Email</label>
        <div style={{fontSize:14,color:C.muted,padding:"8px 10px",background:C.panel2,borderRadius:6}}>
          {user?.email}
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

      {/* Rivals — participants only */}
      {!user?.is_admin && (
        <div style={sectionStyle}>
          <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:4}}>My rivals</h2>
          <p style={{fontSize:13,color:C.muted,marginBottom:12}}>
            Rivals are highlighted with a ★ badge in the leaderboard.
          </p>
          {participants.length === 0
            ? <p style={{fontSize:13,color:C.muted}}>No other participants yet.</p>
            : participants.map(p => {
              const isRival = rivals.includes(p.user_id);
              return (
                <div key={p.user_id} onClick={()=>toggleRival(p.user_id)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
                    borderRadius:8,cursor:"pointer",marginBottom:4,
                    background:isRival?"rgba(163,230,53,0.07)":C.panel2,
                    border:`1px solid ${isRival?C.accent:C.border}`,
                    transition:"all .15s"}}>
                  <span style={{fontSize:16}}>{isRival?"★":"☆"}</span>
                  <div style={{flex:1}}>
                    <span style={{fontSize:13,color:C.text,fontWeight:isRival?600:400}}>{p.name}</span>
                    <span style={{fontSize:11,color:C.muted,marginLeft:8}}>{p.total} pts</span>
                  </div>
                  {isRival&&<span style={{fontSize:11,color:C.accent,fontWeight:600}}>RIVAL</span>}
                </div>
              );
            })
          }
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

      {/* Testing tools — admin-only. Quick helpers to drive the demo. */}
      {user?.is_admin && (
        <div style={sectionStyle}>
          <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>🧪 Testing tools</h2>
          <p style={{margin:"0 0 14px",fontSize:13,color:C.muted}}>
            Quick helpers for driving the tournament end-to-end. Both actions
            touch only admin-entered scores — predictions, entries, users,
            winner picks and stage state are left as they are.
          </p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
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
                      message: `Fill ${empty} match${empty===1?"":"es"} in ${s.name} with random scores (0–3 each side) as FINAL results. This counts toward all submitted users' totals.`,
                      confirmLabel: "Fill randomly",
                      danger: false,
                    });
                    if (!ok) return;
                    const rand = () => Math.floor(Math.random() * 4);
                    let filled = 0;
                    for (const m of stageMatches) {
                      if (results[m.n] || liveMatches[m.n]) continue;
                      const sa = rand(), sb = rand();
                      try {
                        await api.setResult(m.n, {score_a: sa, score_b: sb});
                        setResults?.(r => ({...r, [m.n]: [sa, sb]}));
                        filled++;
                      } catch(e) { console.error("random-fill", m.n, e); }
                    }
                    if (typeof refreshLive === "function") await refreshLive();
                    if (typeof refreshLb === "function") await refreshLb();
                    showToast(`Random-filled ${filled} match${filled===1?"":"es"} 🎲`);
                  }}
                  disabled={disabled}
                  title={disabled ? "Stage already fully resulted" : `Random-fill ${empty} remaining match(es)`}
                  style={{
                    padding:"7px 12px",borderRadius:6,fontSize:12,fontWeight:600,
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
          <button
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Reset ALL admin-entered scores?",
                message: "Wipes every final result AND every live record. Predictions, entries, users, winner picks and config are untouched.\n\nThere is no undo.",
                confirmLabel: "Reset everything",
                danger: true,
              });
              if (!ok) return;
              try {
                const r = await api.resetAllResults();
                setResults?.({});
                if (typeof refreshLive === "function") await refreshLive();
                if (typeof refreshLb === "function") await refreshLb();
                showToast(`Reset · ${r?.deleted?.results||0} results + ${r?.deleted?.live||0} live cleared`);
              } catch(e) { showToast(e.message, "err"); }
            }}
            style={{
              padding:"8px 14px",borderRadius:6,fontSize:13,fontWeight:700,border:0,cursor:"pointer",
              background:C.red,color:"#fff",
            }}>
            🔄 Reset all results &amp; live
          </button>
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

  // On mount: scroll to first live match (flat list — no stage collapsing needed).
  // Also re-scroll when the selected participant changes so the live row
  // stays in view when jumping from the leaderboard.
  useEffect(() => {
    const liveNs = Object.keys(liveMatches).map(Number).sort((a,b)=>a-b);
    if (liveNs.length === 0) return;
    // Wait one frame so predictions have rendered
    requestAnimationFrame(() => {
      document.querySelector(`[data-match-n="${liveNs[0]}"]`)
        ?.scrollIntoView({ behavior:"smooth", block:"center" });
    });
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

  return (
    <div>
      <div style={{marginBottom:14}}>
        <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,
          background:pill.bg,color:pill.color,border:pill.border}}>{pill.text}</span>
      </div>
      <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>Bets by participant</h1>
      <InfoBlock>
        Only <b>submitted</b> forms are shown here.
        {user?.is_admin
          ? <> Showing <b>{displayMatches.length}</b> prediction{displayMatches.length!==1?"s":""} for this form ({playedCount} with a result so far).</>
          : <> Predictions are revealed as matches are played — {playedCount} result{playedCount!==1?"s":""} in so far.</>}
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
          <MatchRow key={m.n} match={m}
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
      const resMap={};for(const r of d.results)resMap[r.match_n]=[r.score_a,r.score_b];
      setResults(resMap);
      setLeaderboard(d.leaderboard);

      // Live matches (may not exist yet if table not created)
      if (d.live) {
        const liveMap={};for(const m of d.live)liveMap[m.match_n]={score_a:m.score_a,score_b:m.score_b,minute:m.minute,is_live:!!m.is_live};
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
    api.me().then(u=>{setUser(u);setTab(u.is_admin?"results":"predictions");setAuthLoading(false);loadGameData(u.is_admin,u.id);}).catch(()=>{setToken(null);setAuthLoading(false);});
  },[loadGameData]);

  async function doLogin(userData,token){
    setToken(token);setUser(userData);setTab(userData.is_admin?"results":"predictions");
    showToast(`Welcome, ${userData.name}!`);
    loadGameData(userData.is_admin,userData.id); // background — UI already visible
  }
  function doLogout(){setToken(null);setUser(null);setTab("auth");setMyPreds({});setMyWinner(null);setLeaderboard([]);setParticipants([]);setEntries([]);setActiveEntryId(null);setLockedWinner(null);setAdminParticipants([]);}

  async function refreshLive() {
    try {
      const list = await liveApi.getAll();
      const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute,is_live:!!x.is_live};
      setLiveMatches(m);
      localStorage.setItem("mb_live_sync", Date.now().toString());
    } catch(e) { console.error("refreshLive:", e); }
  }

  // Cross-tab sync — when admin updates live score in one tab, other tabs reload
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== "mb_live_sync") return;
      liveApi.getAll().then(list => {
        const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute,is_live:!!x.is_live};
        setLiveMatches(m);
      }).catch(()=>{});
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function refreshLb(){
    try {
      const lb=await api.getLeaderboard();setLeaderboard(lb);
      if(user&&!user.is_admin){const e=lb.find(e=>e.user_id===user.id);if(e&&!lockedWinner)setMyWinner(e.winner_pick||null);}
      if(user?.is_admin){
        const [u,p]=await Promise.all([api.getUsers(),api.getAdminParticipants()]);
        setParticipants(u);setAdminParticipants(p);
      }
    } catch(e) { console.error("refreshLb:", e); }
  }

  // ── Live-update polling ───────────────────────────────────────────────────
  // While the user is signed in and a round is in motion (open or closed —
  // anything other than 'idle'), poll the backend every ~10s so that all
  // clients see admin-entered scores and the leaderboard re-sort in real
  // time, not only after a refresh. Stops when there's nothing to update.
  useEffect(() => {
    if (!user) return;
    if (config.round_state === "idle") return;
    const tick = () => { refreshLive(); refreshLb(); };
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, config.round_state]);

  const tabs=!user?[]:user.is_admin
    ?[{id:"results",label:"Results",admin:true},{id:"tournament",label:"🏟 Tournament"},{id:"leaderboard",label:"Leaderboard"},{id:"byuser",label:"By participant"},{id:"dashboard",label:"Dashboard",admin:true},{id:"settings",label:"⚙ Settings"}]
    :[{id:"predictions",label:"My predictions"},{id:"leaderboard",label:"Leaderboard"},...(leaderboard.length>0?[{id:"byuser",label:"Bets by participant"}]:[]),{id:"tournament",label:"🏟 Tournament"},{id:"settings",label:"⚙ Settings"}];

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
    const editable=config.round_state==="open";
    const activeEntry=entries.find(e=>e.id===activeEntryId)||entries[0]||null;
    const openStage = config.current_stage || 1;
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
    const [submitting,setSubmitting]=useState(false);
    const [renamingEntryId,setRenamingEntryId]=useState(null);
    const [renameVal,setRenameVal]=useState("");
    const [showNewMenu,setShowNewMenu]=useState(false);
    // Stages < current open stage start collapsed; current stage starts open
    const [collapsedStages,setCollapsedStages]=useState(
      ()=>new Set(STAGES.filter(s=>s.n<openStage).map(s=>s.n))
    );
    const toggleStage=n=>setCollapsedStages(prev=>{
      const next=new Set(prev);
      if(next.has(n))next.delete(n);else next.add(n);
      return next;
    });

    // On mount: expand the stage containing the first live match, then scroll to it
    useEffect(()=>{
      const liveNs=Object.keys(liveMatches).map(Number).sort((a,b)=>a-b);
      if(liveNs.length===0) return;
      const firstN=liveNs[0];
      const stageN=matchStageObj(firstN).n;
      setCollapsedStages(prev=>{
        if(!prev.has(stageN)) return prev;
        const next=new Set(prev); next.delete(stageN); return next;
      });
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        document.querySelector(`[data-match-n="${firstN}"]`)
          ?.scrollIntoView({behavior:"smooth",block:"center"});
      }));
    },[]);

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
    async function randomFillStage(stageN) {
      if (!editable || !activeEntry) return;
      const stage = STAGES.find(s => s.n === stageN);
      if (!stage) return;
      const todo = matches.filter(m =>
        m.n >= stage.first && m.n <= stage.last
        && !results[m.n] && !liveMatches[m.n]
        && (myPreds[m.n]?.[0] == null || myPreds[m.n]?.[1] == null)
      );
      if (todo.length === 0) { showToast("Nothing left to fill", "warn"); return; }
      const rand = () => Math.floor(Math.random() * 4);
      let ok = 0;
      for (const m of todo) {
        try {
          await savePred(m.n, {score_a: rand(), score_b: rand()});
          ok++;
        } catch(e) { console.error("randomFill", m.n, e); }
      }
      showToast(`Random results filled · stage ${stageN} 🎲`);
    }

    async function saveWinner(team){
      const prev=myWinner;
      setMyWinner(team||null);
      try{
        await api.setWinnerPick({team:team||null},activeEntryId);
        setEntries(es=>es.map(e=>e.id===activeEntryId?{...e,winner_pick:team||null}:e));
        showToast("Winner pick saved ✓");
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
        // Copying inherits the source's winner pick. A brand-new empty form
        // starts with NO winner pre-selected (user picks it themselves).
        const seedWinner = src ? (src.winner_pick ?? null) : null;
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
      setRenamingEntryId(null);
      if(!val)return;
      try{
        await api.renameEntry(entryId,{name:val});
        setEntries(es=>es.map(e=>e.id===entryId?{...e,name:val}:e));
      }catch(e){showToast(e.message,"err");}
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
        showToast(`Stage ${openStage} submitted! 🎉`);
        refreshLb();
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
          <div style={{marginBottom:14}}>
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
                    background:isActive?"rgba(163,230,53,0.12)":C.panel2,
                    borderLeft:`3px solid ${isActive?C.accent:"transparent"}`,
                    border:`1px solid ${isActive?"rgba(163,230,53,0.3)":C.border}`,
                    borderLeftWidth:3,borderLeftColor:isActive?C.accent:"transparent",
                    transition:"all .12s",display:"flex",flexDirection:"column",gap:3,
                    minWidth:170,
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
                          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</span>
                          {submitted&&<span style={{fontSize:13,color:C.green,fontWeight:700}}>✓</span>}
                          {isActive&&editable&&!submitted&&(
                            <span onClick={ev=>startRename(ev,e)} title="Rename" style={{
                              fontSize:11,opacity:0.55,cursor:"pointer",lineHeight:1,padding:"1px 3px",borderRadius:3,
                            }}>✎</span>
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
                      minWidth:180,boxShadow:"0 4px 16px rgba(0,0,0,0.4)",overflow:"hidden",
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

        {/* Entry controls */}
        {activeEntry&&(
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            {editable&&!currentStageSubmitted&&(() => {
              const missing = Math.max(0, submittableMatches.length - filledCount);
              const blockers = [];
              if (missing > 0) blockers.push(`🎯 ${missing} match${missing===1?"":"es"} still to fill`);
              if (winnerNeededForSubmit) blockers.push("🏆 winner pick needed");
              return (
                <>
                  <Btn green onClick={submitEntry} disabled={!canSubmit||submitting}
                    title={blockers.length ? `Can't submit yet: ${blockers.join(", ")}` : ""}>
                    {submitting?"…":`Submit stage ${openStage}`}
                  </Btn>
                  {!canSubmit && blockers.length>0 && (
                    <span style={{
                      display:"inline-flex",alignItems:"center",gap:6,
                      background:"rgba(245,158,11,0.10)",color:"#f59e0b",
                      border:"1px solid rgba(245,158,11,0.35)",
                      padding:"4px 10px",borderRadius:999,fontSize:12,fontWeight:500,
                    }}>
                      {blockers.join(" · ")}
                    </span>
                  )}
                </>
              );
            })()}
            {editable&&currentStageSubmitted&&(
              <span style={{
                background:"rgba(16,185,129,0.10)",color:C.green,
                border:"1px solid rgba(16,185,129,0.35)",
                padding:"5px 12px",borderRadius:999,fontSize:12,fontWeight:600,
              }}>
                ✓ Stage {openStage} submitted
              </span>
            )}
            {!activeEntry.submitted_at&&entries.length>1&&editable&&(
              <Btn ghost red onClick={()=>deleteEntryById(activeEntry.id)}>Delete</Btn>
            )}
          </div>
        )}

        {config.round_state==="idle"&&<InfoBlock warn>⏸️ <b>No betting round is open yet.</b> The admin needs to open a round before you can enter predictions.</InfoBlock>}
        {config.round_state==="open"&&<InfoBlock>✏️ <b>Round is open.</b> Predictions save automatically when you leave each field.<br/><b>Scoring:</b> 5 pts correct direction · +3 exact · +1 partial · 10 pts tournament winner.</InfoBlock>}
        {config.round_state==="closed"&&<InfoBlock>🔒 <b>Round closed.</b> Points appear once the admin enters results.</InfoBlock>}

        {/* Winner pick — editable while stage 1 is still the current open
            stage. Once admin advances past stage 1 the pick is locked. */}
        {(() => {
          const winnerLocked = openStage > 1 || !editable;
          const shownWinner  = myWinner || lockedWinner;
          return (
        <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:12,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:16,position:"relative",zIndex:10}}>
          <label style={{color:C.text,fontSize:14,flexShrink:0}}>🏆 Tournament winner pick (+10 pts):</label>
          {winnerLocked ? (
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14,color:C.text,fontWeight:600}}>{shownWinner?withFlag(shownWinner):"—"}</span>
              <span style={{background:"rgba(99,102,241,0.12)",color:C.indigo,border:`1px solid ${C.indigo}`,padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:700}}>🔒 locked</span>
            </div>
          ):(
            <TeamPicker value={myWinner} onChange={saveWinner} teams={teams} disabled={false} placeholder="Choose a team…"/>
          )}
          {config.tournament_winner&&<span style={{color:C.muted,fontSize:13}}>🏆 actual: <b style={{color:C.accent}}>{withFlag(config.tournament_winner)}</b></span>}
          <span style={{flex:1,minWidth:0}}/>
          {/* Total points pill — visible whenever the selected form has a leaderboard entry */}
          {myLbEntry&&(
            <div style={{
              display:"inline-flex",alignItems:"baseline",gap:8,
              background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"6px 12px",fontSize:12,color:C.muted,
            }} title={activeEntry?`Total for "${activeEntry.name}"`:""}>
              <span style={{color:C.muted,fontWeight:600,letterSpacing:".5px",textTransform:"uppercase",fontSize:10}}>Total</span>
              <b style={{color:C.accent,fontSize:20,fontFamily:"monospace",fontWeight:700,lineHeight:1}}>{myLbEntry.total}</b>
              <span>pts · {myLbEntry.scored_matches}/{matches.length} scored</span>
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
                    <MatchRow key={m.n} match={m}
                      pred={myPreds[m.n]??null}
                      result={results[m.n]??null}
                      liveData={liveMatches[m.n]??null}
                      editable={matchEditable(m)}
                      adminResult={false}
                      roundState={config.round_state}
                      onSave={savePred}
                      onResultSave={()=>{}}/>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────
  function LeaderboardView(){
    const winnerKnown=!!config.tournament_winner;
    const myRivals = (() => { try { return JSON.parse(localStorage.getItem(`mb_rivals_${user?.id}`)||"[]"); } catch { return []; } })();
    const [rivalsOnly, setRivalsOnly] = useState(false);

    // Track hovered row for the "jump-to-form" affordance
    const [hoveredRow, setHoveredRow] = useState(null);
    // "Bets by participant" tab is accessible to everyone once any result exists
    const canJumpToParticipant = !!user && (user.is_admin || Object.keys(results).length > 0);
    const jumpToParticipant = (row) => {
      if (!canJumpToParticipant) return;
      setViewEntryId(row.entry_id || row.user_id);
      setTab("byuser");
    };

    // ── Simulate mode ──────────────────────────────────────────────────────
    // Unplayed matches the user has predicted (excluding live — already counted)
    const unplayedPredMatches = matches.filter(m=>
      !results[m.n] && !liveMatches[m.n] && myPreds?.[m.n]?.[0]!=null
    );
    const canSim = !user?.is_admin && unplayedPredMatches.length > 0;
    const [simMode,setSimMode] = useState(false);
    const [simLb, setSimLb] = useState(null);
    const [simLoading, setSimLoading] = useState(false);

    // Fetch simulated leaderboard when sim mode turns on (uses my predictions
    // as ground truth for unplayed games — scores every user accordingly).
    useEffect(() => {
      if (!simMode || !canSim) { setSimLb(null); return; }
      const override = {};
      for (const m of unplayedPredMatches) {
        const p = myPreds[m.n];
        if (p?.[0]!=null && p?.[1]!=null) override[m.n] = [p[0], p[1]];
      }
      const winnerPick = lockedWinner || myWinner;
      const winnerOverride = (!config.tournament_winner && winnerPick) ? winnerPick : null;
      setSimLoading(true);
      api.getSimulatedLeaderboard(override, winnerOverride)
        .then(rows => setSimLb(rows))
        .catch(()=>setSimLb(null))
        .finally(()=>setSimLoading(false));
    }, [simMode]);

    // Per-row "diff vs actual" badge data
    const actualTotalsByEntry = Object.fromEntries(leaderboard.map(e => [e.entry_id, e.total]));

    const displayLb = (simMode && simLb)
      ? simLb.map(e => ({...e, _simDiff: e.total - (actualTotalsByEntry[e.entry_id] ?? e.total)}))
      : leaderboard;

    // Rivals filter — always keeps current user in view
    const filteredLb = rivalsOnly
      ? displayLb.filter(row => row.user_id===user?.id || myRivals.includes(row.user_id))
      : displayLb;

    return (
      <div>
        <LiveNowSection liveMatches={liveMatches} matches={matches}/>
        <div style={{marginBottom:14}}><RoundPill/></div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          marginBottom:12,flexWrap:"wrap",gap:8}}>
          <h1 style={{color:C.accent,fontSize:20,margin:0}}>🏆 Leaderboard</h1>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {myRivals.length>0&&!user?.is_admin&&(
              <div style={{display:"flex",background:C.panel,border:`1px solid ${C.border}`,
                borderRadius:6,overflow:"hidden",fontSize:12}}>
                <button onClick={()=>setRivalsOnly(false)} style={{
                  padding:"4px 12px",border:"none",cursor:"pointer",
                  background:!rivalsOnly?C.accent:"transparent",
                  color:!rivalsOnly?"#1a1a1a":C.muted,fontWeight:!rivalsOnly?700:400,transition:"all .15s",
                }}>All</button>
                <button onClick={()=>setRivalsOnly(true)} style={{
                  padding:"4px 12px",border:"none",cursor:"pointer",
                  background:rivalsOnly?C.accent:"transparent",
                  color:rivalsOnly?"#1a1a1a":C.muted,fontWeight:rivalsOnly?700:400,transition:"all .15s",
                }}>★ Rivals</button>
              </div>
            )}
            {canSim&&(
              <div style={{display:"flex",background:C.panel,border:`1px solid ${C.border}`,
                borderRadius:6,overflow:"hidden",fontSize:12}}>
                <button onClick={()=>setSimMode(false)} style={{
                  padding:"4px 12px",border:"none",cursor:"pointer",
                  background:!simMode?C.accent:"transparent",
                  color:!simMode?"#1a1a1a":C.muted,fontWeight:!simMode?700:400,transition:"all .15s",
                }}>Actual</button>
                <button onClick={()=>setSimMode(true)} style={{
                  padding:"4px 12px",border:"none",cursor:"pointer",
                  background:simMode?C.accent:"transparent",
                  color:simMode?"#1a1a1a":C.muted,fontWeight:simMode?700:400,transition:"all .15s",
                }}>Simulate</button>
              </div>
            )}
          </div>
        </div>

        {simMode&&(
          <div style={{background:"var(--c-accent-soft)",border:`1px solid ${C.accent}`,
            borderRadius:6,padding:"7px 14px",marginBottom:14,fontSize:13,color:C.accent}}>
            ✨ Simulating <b>{unplayedPredMatches.length}</b> unplayed match{unplayedPredMatches.length!==1?"es":""} with <b>your</b> predictions as results — all users' scores are recomputed accordingly{simLoading?" · loading…":""}
          </div>
        )}

        {leaderboard.length===0
          ?<div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>No participants yet.</div>
          :(
            <>
            {rivalsOnly&&filteredLb.length===0&&(
              <div style={{textAlign:"center",padding:"30px 20px",color:C.muted,fontSize:14}}>
                No rivals yet — add them from the Settings tab.
              </div>
            )}
            {filteredLb.length>0&&(
            <div className="lb-table-wrap" style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,minWidth:320}}>
                <thead><tr style={{background:C.panel2}}>
                  {["#","Name","Points","Winner pick"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Points"?"center":"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
                  {canJumpToParticipant&&<th style={{padding:"8px 6px",width:28,borderBottom:`1px solid ${C.border}`}}/>}
                </tr></thead>
                <tbody>
                  {filteredLb.map((row)=>{
                    // Always show global rank (position in the unfiltered display list)
                    const globalRank = displayLb.indexOf(row) + 1;
                    const isMe=row.user_id===user?.id;
                    const isRival=!isMe&&myRivals.includes(row.user_id);
                    const isSim=simMode&&row._simDiff!=null&&row._simDiff!==0;
                    const simDiff=row._simDiff||0;
                    const i = globalRank - 1;
                    const rowBg=i===0?"rgba(163,230,53,0.12)":i===1?"rgba(163,230,53,0.07)":i===2?"rgba(163,230,53,0.03)":isRival?"rgba(163,230,53,0.05)":"transparent";
                    let winnerCell;
                    if(winnerKnown)winnerCell=row.winner_pick?<>{withFlag(row.winner_pick)}{row.winner_bonus>0&&<span style={{color:C.green}}> +10</span>}</>:"—";
                    else winnerCell=row.winner_pick?withFlag(row.winner_pick):"—";
                    const rowKey=row.entry_id||row.user_id;
                    const isHovered=hoveredRow===rowKey;
                    const baseBg=isSim?"rgba(99,102,241,0.06)":rowBg;
                    const hoverBg=isMe?"rgba(163,230,53,0.22)":isRival?"rgba(163,230,53,0.15)":"rgba(163,230,53,0.08)";
                    return (
                      <tr key={rowKey}
                          onMouseEnter={canJumpToParticipant?()=>setHoveredRow(rowKey):undefined}
                          onMouseLeave={canJumpToParticipant?()=>setHoveredRow(null):undefined}
                          onClick={canJumpToParticipant?()=>jumpToParticipant(row):undefined}
                          title={canJumpToParticipant?"View this form's predictions":undefined}
                          style={{
                            background:(canJumpToParticipant&&isHovered)?hoverBg:baseBg,
                            borderLeft: isMe ? `3px solid ${C.accent}` : isRival ? `3px solid ${C.accent}` : "3px solid transparent",
                            cursor:canJumpToParticipant?"pointer":"default",
                            transition:"background .12s",
                          }}>
                        <td style={td}><b>{globalRank}</b></td>
                        <td style={td}>{row.name}
                          {isMe&&<span style={{background:C.indigo,color:"white",fontSize:10,padding:"1px 5px",borderRadius:4,marginLeft:6}}>YOU</span>}
                          {isRival&&!isMe&&<span style={{background:"transparent",border:`1px solid ${C.accent}`,color:C.accent,fontSize:10,padding:"1px 5px",borderRadius:4,marginLeft:6}}>★ RIVAL</span>}
                        </td>
                        <td style={{...td,textAlign:"center",color:isSim?C.indigo:C.accent,fontWeight:700,fontFamily:"monospace",fontSize:17}}>
                          {row.total}
                          {isSim&&<span style={{display:"inline-flex",alignItems:"center",gap:2,marginLeft:6,background:"rgba(99,102,241,0.12)",color:C.indigo,border:`1px solid ${C.indigo}`,padding:"1px 6px",borderRadius:4,fontSize:10,fontWeight:700,verticalAlign:"middle"}}>{simDiff>0?"+":""}{simDiff} sim</span>}
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
      <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 16px 40px"}}>
        {!user&&<AuthView roundState={config.round_state} onSuccess={doLogin}/>}
        {user&&tab==="predictions"&&<MyPredictions/>}
        {user&&tab==="leaderboard"&&<LeaderboardView/>}
        {user&&tab==="byuser"&&(
          <ByUser
            config={config} leaderboard={leaderboard} results={results}
            liveMatches={liveMatches} matches={matches} user={user}
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
          setResults={setResults} refreshLb={refreshLb} refreshLive={refreshLive} showToast={showToast}
        />}
        {user&&tab==="tournament"&&<Tournament matches={matches} results={results} liveMatches={liveMatches} myPreds={myPreds} config={config} user={user}/>}
        {user&&tab==="settings"&&<SettingsView user={user} leaderboard={leaderboard} onLogout={doLogout} onNameUpdate={u=>{setUser(u);showToast("Name updated ✓");}} showToast={showToast} config={config} setConfig={setConfig} matches={matches} results={results} setResults={setResults} liveMatches={liveMatches} refreshLive={refreshLive} refreshLb={refreshLb}/>}
      </div>
      {toast&&(
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:toast.kind==="err"?C.red:toast.kind==="warn"?C.accent:C.green,color:toast.kind==="warn"?"#1a1a1a":"white",padding:"8px 16px",borderRadius:6,fontSize:14,zIndex:100,boxShadow:"0 4px 12px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>
          {toast.msg}
        </div>
      )}
      <ConfirmHost/>
    </div>
  );
}
