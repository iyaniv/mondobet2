import { useState, useEffect, useCallback, useRef } from "react";
import { api, liveApi, setToken, getToken } from "./api";

const C = {
  bg:"var(--c-bg)", panel:"var(--c-panel)", panel2:"var(--c-panel2)",
  border:"var(--c-border)", text:"var(--c-text)", muted:"var(--c-muted)",
  accent:"var(--c-accent)", accentDk:"var(--c-accent-dk)", accentSoft:"var(--c-accent-soft)", green:"var(--c-green)", red:"var(--c-red)", indigo:"var(--c-indigo)",
};

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
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}
      style={{
        display:"flex", alignItems:"center", gap:10, padding:"9px 13px",
        cursor:"pointer", background:bg, transition:"background .1s",
        borderBottom:`1px solid ${C.border}`,
      }}>
      {/* Rank */}
      <span style={{ width:20, textAlign:"center", fontSize:rankIcon?15:11, flexShrink:0, color:C.muted }}>
        {rankIcon || rank}
      </span>
      {/* Avatar */}
      <div style={{
        width:30, height:30, borderRadius:"50%", flexShrink:0,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:11, fontWeight:700,
        background: selected ? C.accent : C.panel2,
        color: selected ? "#1a1a1a" : C.text,
      }}>
        {initials(entry.name)}
      </div>
      {/* Name */}
      <span style={{ flex:1, fontSize:13, color:selected?C.accent:C.text, fontWeight:selected?600:400 }}>
        {entry.name}
      </span>
      {/* Points */}
      <span style={{ fontSize:12, fontFamily:"monospace", fontWeight:700, color:C.accent, flexShrink:0 }}>
        {entry.total} pts
      </span>
      {selected && <span style={{ fontSize:11, color:C.accent, marginLeft:4 }}>✓</span>}
    </div>
  );
}

// Searchable participant picker with avatars, ranks, and points
function ParticipantPicker({ entries, value, onChange }) {
  const [search, setSearch] = useState("");
  const filtered = entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden", background:C.panel }}>
      {/* Search */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderBottom:`1px solid ${C.border}` }}>
        <span style={{ color:C.muted, fontSize:13, flexShrink:0 }}>🔍</span>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search participants…"
          style={{ border:"none", outline:"none", background:"transparent", fontSize:13, color:C.text, flex:1 }}/>
        {search && (
          <button onClick={()=>setSearch("")} style={{ background:"none", border:0, color:C.muted, cursor:"pointer", fontSize:13, padding:0 }}>✕</button>
        )}
      </div>
      {/* List */}
      <div style={{ maxHeight:280, overflowY:"auto" }}>
        {filtered.length === 0
          ? <div style={{ padding:16, textAlign:"center", color:C.muted, fontSize:13 }}>No participants found</div>
          : filtered.map((e, i) => (
            <ParticipantItem key={e.user_id}
              entry={e}
              rank={entries.indexOf(e) + 1}
              selected={value === e.user_id}
              onClick={()=>onChange(e.user_id)}/>
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
function MatchRow({ match, pred, result, editable, adminResult, roundState, onSave, onResultSave }) {
  const [localA, setLocalA] = useState(pred?.[0]!=null?String(pred[0]):"");
  const [localB, setLocalB] = useState(pred?.[1]!=null?String(pred[1]):"");
  const [resA,   setResA]   = useState(result?.[0]!=null?String(result[0]):"");
  const [resB,   setResB]   = useState(result?.[1]!=null?String(result[1]):"");

  useEffect(()=>{setLocalA(pred?.[0]!=null?String(pred[0]):"");setLocalB(pred?.[1]!=null?String(pred[1]):"");},[pred?.[0],pred?.[1]]);
  useEffect(()=>{setResA(result?.[0]!=null?String(result[0]):"");setResB(result?.[1]!=null?String(result[1]):"");},[result?.[0],result?.[1]]);

  async function savePred(side,val) {
    const a=side===0?val:localA, b=side===1?val:localB;
    if(a===""||b==="") return;
    try { await onSave(match.n,{score_a:Number(a),score_b:Number(b)}); } catch(e){console.error(e);}
  }
  async function saveResult(side,val) {
    const a=side===0?val:resA, b=side===1?val:resB;
    try { await onResultSave(match.n,{score_a:a===""?null:Number(a),score_b:b===""?null:Number(b)}); } catch(e){console.error(e);}
  }

  let ptsEl=null;
  if(result&&pred?.[0]!=null&&pred?.[1]!=null){
    const p1=pred[0],p2=pred[1],r1=result[0],r2=result[1];
    const sign=(x)=>x===0?0:x>0?1:-1;
    const dir=sign(p1-p2)===sign(r1-r2)?5:0;
    let exact=0;
    if(p1===r1&&p2===r2)exact=3;
    else if(p1===r1||p2===r2)exact=1;
    const total=dir+exact;
    const colors={p8:["#052e16","#86efac"],p6:["#1e3a44","#a5f3fc"],p5:["#3a1e44","#e9d5ff"],p1:["#3f2718","#fbbf24"],p0:["#3f3f46","#a1a1aa"]};
    const cls=total===8?"p8":total===6?"p6":total===5?"p5":total===1?"p1":"p0";
    const [bg,fg]=colors[cls];
    ptsEl=<span style={{background:bg,color:fg,padding:"2px 6px",borderRadius:4,fontWeight:700,fontFamily:"monospace",fontSize:12}}>+{total}</span>;
  } else if(roundState==="closed"&&!result){
    ptsEl=<span style={{color:C.muted,fontSize:11}}>awaiting</span>;
  }

  // Winner / loser highlight — used for team name colours
  let winnerSide = null; // 0 = A wins, 1 = B wins, null = draw or no result
  if (result) {
    if (result[0] > result[1]) winnerSide = 0;
    else if (result[1] > result[0]) winnerSide = 1;
  }
  const rowBg=(!editable&&!adminResult)?C.panel:C.panel2;
  return (
    <div style={{display:"grid",gridTemplateColumns:"28px 26px 1fr 44px 12px 44px 1fr auto",alignItems:"center",gap:5,padding:"5px 8px",borderRadius:6,background:rowBg,border:`1px solid ${C.border}`,marginBottom:3,fontSize:13}}>
      <span style={{color:C.muted,fontSize:11}}>#{match.n}</span>
      <span style={{background:C.border,color:C.text,padding:"1px 5px",borderRadius:4,fontSize:11,textAlign:"center"}}>{match.g}</span>
      <span style={{
        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,
        color: winnerSide===0?C.accent:winnerSide===1?C.muted:C.text,
        fontWeight: winnerSide===0?700:400,
        transition:"color .2s",
      }}>{flag(match.a)} {match.a}</span>
      {editable?(
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={localA} onChange={e=>setLocalA(e.target.value)} onBlur={e=>savePred(0,e.target.value)} style={numInput}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={localB} onChange={e=>setLocalB(e.target.value)} onBlur={e=>savePred(1,e.target.value)} style={numInput}/>
        </>
      ):adminResult?(
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={resA} onChange={e=>setResA(e.target.value)} onBlur={e=>saveResult(0,e.target.value)} style={numInput}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={resB} onChange={e=>setResB(e.target.value)} onBlur={e=>saveResult(1,e.target.value)} style={numInput}/>
        </>
      ):(
        <span style={{gridColumn:"span 3",textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:15,background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 0",color:pred?.[0]!=null?C.text:C.muted}}>
          {pred?.[0]!=null?`${pred[0]} : ${pred[1]}`:"—"}
        </span>
      )}
      <span style={{
        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",fontSize:12,
        color: winnerSide===1?C.accent:winnerSide===0?C.muted:C.text,
        fontWeight: winnerSide===1?700:400,
        transition:"color .2s",
      }}>{match.b} {flag(match.b)}</span>
      <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"flex-end",minWidth:96}}>
        {result!=null
          ? <span style={{
              background:"rgba(16,185,129,0.12)",color:C.green,
              border:"1px solid rgba(16,185,129,0.35)",
              padding:"1px 7px",borderRadius:4,
              fontWeight:700,fontFamily:"monospace",fontSize:11,whiteSpace:"nowrap",
            }}>✓ {result[0]}:{result[1]}</span>
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
  const [mode,setMode]=useState("signup");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);

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
        ?await api.signup({name:name.trim(),email:email.trim().toLowerCase(),password})
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
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder={mode==="login"?"Email  (admin: admin)":"Email"} required style={inputStyle}/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" required minLength={4} style={inputStyle}/>
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
function AdminDashboard({ config, setConfig, matches, teams, results, participants, setParticipants, leaderboard, showToast, refreshLb }) {

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
    } catch(e) { showToast(e.message, "err"); }
  }

  const pill = {
    open:   {text:"🟢 Betting round is OPEN",   bg:"rgba(16,185,129,0.1)",  color:C.green, border:`1px solid ${C.green}`},
    closed: {text:"🔒 Betting round is CLOSED", bg:"rgba(239,68,68,0.1)",   color:C.red,   border:`1px solid ${C.red}`},
    idle:   {text:"⏸️ No betting round yet",    bg:"rgba(148,163,184,0.1)", color:C.muted, border:`1px solid ${C.border}`},
  }[config.round_state] || {};

  return (
    <div>
      <div style={{marginBottom:14}}>
        <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,background:pill.bg,color:pill.color,border:pill.border}}>{pill.text}</span>
      </div>
      <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>⚙️ Admin dashboard</h1>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:20}}>
        {[
          {label:"Participants",    value:participants.length,                                          color:C.accent},
          {label:"Paid",            value:`${participants.filter(u=>u.has_paid).length} / ${participants.length}`, color:C.green},
          {label:"Results entered", value:`${Object.keys(results).length} / ${matches.length}`,         color:C.accent},
        ].map(s=>(
          <div key={s.label} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14}}>
            <div style={{color:C.muted,fontSize:12,marginBottom:4}}>{s.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
          </div>
        ))}
      </div>

      <h2 style={{color:C.accent,fontSize:16,margin:"0 0 8px"}}>Round control</h2>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:20}}>
        {config.round_state==="idle"&&<>
          <div style={{flex:1}}><div style={{fontWeight:600,marginBottom:4,color:C.text}}>⏸️ Round is idle.</div><div style={{color:C.muted,fontSize:12}}>Open to start collecting predictions.</div></div>
          <Btn green onClick={()=>setRoundState("open")}>🟢 Open round</Btn>
        </>}
        {config.round_state==="open"&&<>
          <div style={{flex:1}}><div style={{color:C.green,fontWeight:600,marginBottom:4}}>🟢 Round is OPEN.</div><div style={{color:C.muted,fontSize:12}}>Close to lock bets and reveal them.</div></div>
          <Btn red onClick={()=>confirm("Close the round?")&&setRoundState("closed")}>🔒 Close round</Btn>
        </>}
        {config.round_state==="closed"&&<>
          <div style={{flex:1}}><div style={{color:C.red,fontWeight:600,marginBottom:4}}>🔒 Round is CLOSED.</div><div style={{color:C.muted,fontSize:12}}>Enter results in the Results tab.</div></div>
          <Btn ghost onClick={()=>confirm("Reopen? Bets will be hidden again.")&&setRoundState("open")}>Reopen</Btn>
        </>}
      </div>

      <h2 style={{color:C.accent,fontSize:16,margin:"0 0 8px"}}>🏆 Tournament winner</h2>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14,display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:20,position:"relative",zIndex:10}}>
        <TeamPicker value={config.tournament_winner||null} onChange={setWinner} teams={teams} clearable placeholder="— no winner set —"/>
        <span style={{color:C.muted,fontSize:12,alignSelf:"center"}}>Awards +10 pts to everyone who picked correctly.</span>
      </div>

      <h2 style={{color:C.accent,fontSize:16,margin:"0 0 8px"}}>Participants ({participants.length})</h2>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:C.panel2}}>
            {["Name","Email","Points","Winner pick","Paid"].map(h=>(
              <th key={h} style={{padding:"8px 10px",textAlign:"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {participants.length===0
              ? <tr><td colSpan={5} style={{padding:24,textAlign:"center",color:C.muted}}>No participants yet</td></tr>
              : participants.map(u => {
                const entry=leaderboard.find(e=>e.user_id===u.id);
                return (
                  <tr key={u.id}>
                    <td style={td}>{u.name}</td>
                    <td style={{...td,color:C.muted,fontFamily:"monospace",fontSize:12}}>{u.email}</td>
                    <td style={{...td,color:C.accent,fontWeight:700,fontFamily:"monospace"}}>{entry?.total??0}</td>
                    <td style={td}>{entry?.winner_pick?withFlag(entry.winner_pick):"—"}</td>
                    <td style={td}><input type="checkbox" checked={u.has_paid} onChange={e=>togglePaid(u.id,e.target.checked)}/></td>
                  </tr>
                );
              })}
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
  const gm = allMatches.filter(m => m.g === groupLetter);
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
  const gm = allMatches.filter(m => m.g === group);
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
          const isMatchLive = !!liveMatches[m.n];
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
  const useSim = config.round_state==="open" && !user?.is_admin;
  const simPreds = useSim ? myPreds : {};
  const played = Object.keys(results).length;
  const simFilled = useSim
    ? Object.keys(myPreds).filter(n=>!results[n]&&myPreds[n]?.[0]!=null&&myPreds[n]?.[1]!=null).length
    : 0;

  return (
    <div>
      {/* Stage banner */}
      <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,
        padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",
        justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:"var(--c-font-display)",fontSize:20,color:C.accent,letterSpacing:1}}>
            GROUP STAGE
          </span>
          <span style={{fontSize:11,padding:"2px 8px",borderRadius:999,fontWeight:600,
            background:"rgba(16,185,129,0.15)",color:C.green,border:"1px solid rgba(16,185,129,0.3)"}}>
            LIVE · updates with every result
          </span>
        </div>
        <div style={{fontSize:13,color:C.muted}}>
          <b style={{color:C.text}}>{played}</b> / {matches.length} played
          {simFilled>0&&<> · <b style={{color:C.accent}}>{simFilled}</b> from your predictions</>}
        </div>
      </div>

      {useSim&&simFilled>0&&(
        <div style={{background:"var(--c-accent-soft)",border:`1px solid ${C.accent}`,
          borderRadius:6,padding:"7px 14px",marginBottom:14,fontSize:13,color:C.accent}}>
          ✨ Standings include your predictions for unplayed matches
        </div>
      )}

      {/* 12 group cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
        {GROUPS.map(g=>(
          <GroupCard key={g} group={g} allMatches={matches} results={results} simPreds={simPreds} liveMatches={liveMatches}/>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ADMIN MATCH ROW — handles pending / live / final states; outside App
// ─────────────────────────────────────────────────────────────────────────────
function AdminMatchRow({ match, result, liveData, onSaveResult, onGoLive, onUpdateLive, onFinalize }) {
  const isLive  = !!liveData;
  const isFinal = !!result;

  const [resA, setResA] = useState(isLive ? String(liveData.score_a) : isFinal ? String(result[0]) : "");
  const [resB, setResB] = useState(isLive ? String(liveData.score_b) : isFinal ? String(result[1]) : "");
  const [min,  setMin]  = useState(isLive ? String(liveData.minute)  : "");

  useEffect(() => {
    if (liveData) { setResA(String(liveData.score_a)); setResB(String(liveData.score_b)); setMin(String(liveData.minute)); }
    else if (result) { setResA(String(result[0])); setResB(String(result[1])); setMin(""); }
    else { setResA(""); setResB(""); setMin(""); }
  }, [liveData?.score_a, liveData?.score_b, liveData?.minute, result?.[0], result?.[1]]);

  async function handleBlur(side, val) {
    const a = side===0 ? val : resA, b = side===1 ? val : resB;
    if (a===""&&b==="") return;
    const sa=Number(a)||0, sb=Number(b)||0;
    if (isLive) await onUpdateLive(match.n, {score_a:sa, score_b:sb, minute:Number(min)||0});
    else        await onSaveResult(match.n, {score_a:a===""?null:sa, score_b:b===""?null:sb});
  }
  async function handleMinBlur(val) {
    if (!isLive) return;
    await onUpdateLive(match.n, {score_a:Number(resA)||0, score_b:Number(resB)||0, minute:Number(val)||0});
  }

  const effA = Number(resA||0), effB = Number(resB||0);
  const winA = (isLive||isFinal) ? (effA>effB?true:effB>effA?false:null) : null;
  const rowBg    = isLive?"rgba(239,68,68,0.06)":isFinal?"rgba(16,185,129,0.04)":C.panel2;
  const rowBorder= `1px solid ${isLive?"rgba(239,68,68,0.35)":isFinal?"rgba(16,185,129,0.25)":C.border}`;

  return (
    <div style={{display:"grid",gridTemplateColumns:"28px 26px 1fr 44px 12px 44px 1fr auto",
      alignItems:"center",gap:5,padding:"5px 8px",borderRadius:6,
      background:rowBg,border:rowBorder,marginBottom:3,fontSize:13}}>
      <span style={{color:C.muted,fontSize:11}}>#{match.n}</span>
      <span style={{background:C.border,color:C.text,padding:"1px 5px",borderRadius:4,fontSize:11,textAlign:"center"}}>{match.g}</span>
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
            onChange={e=>setResA(e.target.value)} onBlur={e=>handleBlur(0,e.target.value)}
            style={{...numInput,border:`1px solid ${isLive?"rgba(239,68,68,0.5)":C.border}`}}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={resB}
            onChange={e=>setResB(e.target.value)} onBlur={e=>handleBlur(1,e.target.value)}
            style={{...numInput,border:`1px solid ${isLive?"rgba(239,68,68,0.5)":C.border}`}}/>
        </>
      )}
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",fontSize:12,
        color:winA===false?C.accent:winA===true?C.muted:C.text,fontWeight:winA===false?700:400}}>
        {match.b} {flag(match.b)}
      </span>
      <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"flex-end",minWidth:110}}>
        {isLive && <>
          <input type="number" inputMode="numeric" min={0} max={120} value={min} placeholder="0"
            onChange={e=>setMin(e.target.value)} onBlur={e=>handleMinBlur(e.target.value)}
            style={{...numInput,width:34,border:"1px solid rgba(239,68,68,0.4)"}}/>
          <span style={{fontSize:10,color:C.red}}>′</span>
          <button onClick={()=>onFinalize(match.n)} style={{
            background:C.green,color:"white",border:0,padding:"2px 8px",
            borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
            ✓ FINAL
          </button>
        </>}
        {!isLive && !isFinal && (
          <button onClick={()=>onGoLive(match.n)} style={{
            background:"transparent",border:`1px solid ${C.red}`,color:C.red,
            padding:"2px 8px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
            <span className="live-dot" style={{marginRight:4}}/> LIVE
          </button>
        )}
        {!isLive && isFinal && (
          <span style={{width:8,height:8,borderRadius:"50%",background:C.green,display:"inline-block"}}/>
        )}
      </div>
    </div>
  );
}

// LiveNowSection — shown at the top of the Leaderboard when matches are in play
function LiveNowSection({ liveMatches, matches }) {
  const live = Object.entries(liveMatches);
  if (live.length === 0) return null;
  return (
    <div style={{marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
        <span className="live-dot"/>
        <span style={{fontFamily:"var(--c-font-display)",fontSize:18,color:C.red,letterSpacing:1}}>LIVE NOW</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
        {live.map(([mn,ld])=>{
          const m=matches.find(x=>x.n===Number(mn));
          if(!m) return null;
          const winA=ld.score_a>ld.score_b?true:ld.score_b>ld.score_a?false:null;
          return (
            <div key={mn} style={{background:C.panel,border:`1px solid ${C.red}`,borderRadius:8,padding:"10px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:10}}>
                <span style={{color:C.red,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                  <span className="live-dot"/> LIVE {ld.minute}'
                </span>
                <span style={{color:C.muted}}>Group {m.g}</span>
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
        })}
      </div>
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

function SettingsView({ user, leaderboard, onLogout, onNameUpdate, showToast }) {
  // Profile
  const [name,    setName]    = useState(user?.name || "");
  const [saving,  setSaving]  = useState(false);

  // Timezone (localStorage)
  const [tz, setTz] = useState(() => localStorage.getItem("mb_timezone") || "auto");

  // Rivals (localStorage — array of user IDs)
  const [rivals, setRivals] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mb_rivals") || "[]"); }
    catch { return []; }
  });

  const participants = leaderboard.filter(e => e.user_id !== user?.id);

  function saveTz(val) {
    setTz(val);
    localStorage.setItem("mb_timezone", val);
    showToast("Timezone saved");
  }

  function toggleRival(uid) {
    const next = rivals.includes(uid) ? rivals.filter(r=>r!==uid) : [...rivals, uid];
    setRivals(next);
    localStorage.setItem("mb_rivals", JSON.stringify(next));
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

      {/* Account */}
      <div style={sectionStyle}>
        <h2 style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:14}}>Account</h2>
        <Btn red onClick={onLogout}>Log out</Btn>
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
  const [config,setConfig]=useState({round_state:"idle",tournament_winner:null});
  const [myPreds,setMyPreds]=useState({});
  const [myWinner,setMyWinner]=useState(null);
  const [results,setResults]=useState({});
  const [leaderboard,setLeaderboard]=useState([]);
  const [participants,setParticipants]=useState([]);
  const [viewUserId,setViewUserId]=useState(null);
  const [viewUserPreds,setViewUserPreds]=useState({});
  const [viewUserWinner,setViewUserWinner]=useState(null);
  const [toast,setToast]=useState(null);
  const [globalErr,setGlobalErr]=useState("");
  const toastTimer=useRef(null);

  function showToast(msg,kind="ok"){setToast({msg,kind});clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(null),2500);}

  const loadGameData=useCallback(async(isAdmin,userId=null)=>{
    try {
      const [matchData,cfg,res,lb]=await Promise.all([api.getMatches(),api.getConfig(),api.getResults(),api.getLeaderboard()]);
      setMatches(matchData.matches);setTeams(matchData.teams);setConfig(cfg);
      const resMap={};for(const r of res)resMap[r.match_n]=[r.score_a,r.score_b];
      setResults(resMap);setLeaderboard(lb);
      if(!isAdmin&&userId){
        const myEntry=lb.find(e=>e.user_id===userId);
        if(myEntry)setMyWinner(myEntry.winner_pick||null);
        const preds=await api.getMyPredictions();
        const predMap={};for(const p of preds)predMap[p.match_n]=[p.score_a,p.score_b];
        setMyPreds(predMap);
      }
      if(isAdmin){const users=await api.getUsers();setParticipants(users);}
    } catch(e){setGlobalErr(e.message);}
  },[]);

  // Load public config immediately so the round pill is correct on the auth screen
  useEffect(()=>{
    api.getConfig().then(cfg=>setConfig(cfg)).catch(()=>{});
  },[]);

  useEffect(()=>{
    if(!getToken()){setAuthLoading(false);return;}
    api.me().then(async u=>{setUser(u);setTab(u.is_admin?"dashboard":"predictions");await loadGameData(u.is_admin,u.id);}).catch(()=>setToken(null)).finally(()=>setAuthLoading(false));
  },[loadGameData]);

  async function doLogin(userData,token){
    setToken(token);setUser(userData);setTab(userData.is_admin?"dashboard":"predictions");
    await loadGameData(userData.is_admin,userData.id);
    showToast(`Welcome, ${userData.name}!`);
  }
  function doLogout(){setToken(null);setUser(null);setTab("auth");setMyPreds({});setMyWinner(null);setLeaderboard([]);setParticipants([]);}

  async function refreshLive() {
    try {
      const list = await liveApi.getAll();
      const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute};
      setLiveMatches(m);
      localStorage.setItem("mb_live_sync", Date.now().toString());
    } catch(e) { console.error("refreshLive:", e); }
  }

  // Cross-tab sync — when admin updates live score in one tab, other tabs reload
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== "mb_live_sync") return;
      liveApi.getAll().then(list => {
        const m={}; for(const x of list) m[x.match_n]={score_a:x.score_a,score_b:x.score_b,minute:x.minute};
        setLiveMatches(m);
      }).catch(()=>{});
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function refreshLb(){
    const lb=await api.getLeaderboard();setLeaderboard(lb);
    if(user&&!user.is_admin){const e=lb.find(e=>e.user_id===user.id);if(e)setMyWinner(e.winner_pick||null);}
    if(user?.is_admin){const u=await api.getUsers();setParticipants(u);}
  }

  const tabs=!user?[]:user.is_admin
    ?[{id:"dashboard",label:"Dashboard",admin:true},{id:"results",label:"Results",admin:true},{id:"leaderboard",label:"Leaderboard"},{id:"byuser",label:"By participant"},{id:"tournament",label:"🏟 Tournament"},{id:"settings",label:"⚙ Settings"}]
    :[{id:"predictions",label:"My predictions"},{id:"leaderboard",label:"Leaderboard"},...(config.round_state==="closed"?[{id:"byuser",label:"Bets by participant"}]:[]),{id:"tournament",label:"🏟 Tournament"},{id:"settings",label:"⚙ Settings"}];

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
    const myEntry=leaderboard.find(e=>e.user_id===user?.id);
    async function savePred(matchN,data){await api.setPrediction(matchN,data);setMyPreds(p=>({...p,[matchN]:[data.score_a,data.score_b]}));showToast("Saved ✓");}
    async function saveWinner(team){try{await api.setWinnerPick({team:team||null});setMyWinner(team||null);showToast("Winner pick saved ✓");await refreshLb();}catch(e){showToast(e.message,"err");}}
    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill/></div>
        <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>{user?.name}'s predictions</h1>
        {config.round_state==="idle"&&<InfoBlock warn>⏸️ <b>No betting round is open yet.</b> The admin needs to open a round before you can enter predictions.</InfoBlock>}
        {config.round_state==="open"&&<InfoBlock>✏️ <b>Round is open.</b> Predictions save automatically when you leave each field.<br/><b>Scoring:</b> 5 pts correct direction · +3 exact · +1 partial · 10 pts tournament winner.</InfoBlock>}
        {config.round_state==="closed"&&<InfoBlock>🔒 <b>Round closed.</b> Points appear once the admin enters results.</InfoBlock>}
        {myEntry&&(
          <div style={{textAlign:"right",padding:"8px 12px",background:C.panel2,borderRadius:6,marginBottom:16,fontSize:14,color:C.text}}>
            Total: <span style={{color:C.accent,fontWeight:700,fontFamily:"monospace",fontSize:18}}>{myEntry.total}</span>
            &nbsp;·&nbsp;{myEntry.scored_matches}/{matches.length} scored
            {myEntry.winner_bonus>0&&<>&nbsp;·&nbsp;🏆 +10 winner bonus</>}
          </div>
        )}
        {/* Winner pick — TeamPicker */}
        <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:12,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:16,position:"relative",zIndex:10}}>
          <label style={{color:C.text,fontSize:14,flexShrink:0}}>🏆 Tournament winner pick (+10 pts):</label>
          <TeamPicker value={myWinner} onChange={saveWinner} teams={teams} disabled={!editable} placeholder="Choose a team…"/>
          {config.tournament_winner&&<span style={{color:C.muted,fontSize:13}}>🏆 actual: <b style={{color:C.accent}}>{withFlag(config.tournament_winner)}</b></span>}
        </div>
        <SectionHeader>Group stage — {matches.length} matches</SectionHeader>
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
          {matches.map(m=><MatchRow key={m.n} match={m} pred={myPreds[m.n]??null} result={results[m.n]??null} editable={editable} adminResult={false} roundState={config.round_state} onSave={savePred} onResultSave={()=>{}}/>)}
        </div>
      </div>
    );
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────
  function LeaderboardView(){
    const winnerKnown=!!config.tournament_winner;
    const myRivals = (() => { try { return JSON.parse(localStorage.getItem("mb_rivals")||"[]"); } catch { return []; } })();
    return (
      <div>
        <LiveNowSection liveMatches={liveMatches} matches={matches}/>
        <div style={{marginBottom:14}}><RoundPill/></div>
        <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>🏆 Leaderboard</h1>
        {leaderboard.length===0
          ?<div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>No participants yet.</div>
          :(
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
                <thead><tr style={{background:C.panel2}}>
                  {["#","Name","Points","Winner pick"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Points"?"center":"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {leaderboard.map((row,i)=>{
                    const isMe=row.user_id===user?.id;
                    const isRival=!isMe&&myRivals.includes(row.user_id);
                    const rowBg=i===0?"rgba(163,230,53,0.12)":i===1?"rgba(163,230,53,0.07)":i===2?"rgba(163,230,53,0.03)":isRival?"rgba(163,230,53,0.05)":"transparent";
                    // Everyone sees all winner picks — no lock
                    let winnerCell;
                    if(winnerKnown)winnerCell=row.winner_pick?<>{withFlag(row.winner_pick)}{row.winner_bonus>0&&<span style={{color:C.green}}> +10</span>}</>:"—";
                    else winnerCell=row.winner_pick?withFlag(row.winner_pick):"—";
                    return (
                      <tr key={row.user_id} style={{
                        background:rowBg,
                        borderLeft: isMe ? `3px solid ${C.accent}` : isRival ? `3px solid ${C.accent}` : "3px solid transparent",
                      }}>
                        <td style={td}><b>{i+1}</b></td>
                        <td style={td}>{row.name}
                          {isMe&&<span style={{background:C.indigo,color:"white",fontSize:10,padding:"1px 5px",borderRadius:4,marginLeft:6}}>YOU</span>}
                          {isRival&&!isMe&&<span style={{background:"transparent",border:`1px solid ${C.accent}`,color:C.accent,fontSize:10,padding:"1px 5px",borderRadius:4,marginLeft:6}}>★ RIVAL</span>}
                        </td>
                        <td style={{...td,textAlign:"center",color:C.accent,fontWeight:700,fontFamily:"monospace",fontSize:17}}>{row.total}</td>
                        <td style={td}>{winnerCell}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    );
  }

  // ── By User ───────────────────────────────────────────────────────────────
  function ByUser(){
    useEffect(()=>{if(!viewUserId&&leaderboard.length>0)setViewUserId(leaderboard[0].user_id);},[]);
    useEffect(()=>{
      if(!viewUserId)return;
      api.getUserPredictions(viewUserId).then(preds=>{
        const m={};for(const p of preds)m[p.match_n]=[p.score_a,p.score_b];
        setViewUserPreds(m);
        setViewUserWinner(leaderboard.find(e=>e.user_id===viewUserId)?.winner_pick||null);
      }).catch(e=>showToast(e.message,"err"));
    },[viewUserId]);

    if(!user?.is_admin&&config.round_state!=="closed")
      return <InfoBlock warn>Other participants' bets are hidden until the admin closes the betting round.</InfoBlock>;

    const selected=leaderboard.find(e=>e.user_id===viewUserId);
    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill/></div>
        <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>Bets by participant</h1>
        {/* ParticipantPicker */}
        <div style={{marginBottom:16}}>
          <ParticipantPicker entries={leaderboard} value={viewUserId} onChange={setViewUserId}/>
        </div>
        {selected&&(
          <div style={{textAlign:"right",padding:"8px 12px",background:C.panel2,borderRadius:6,marginBottom:12,fontSize:14,color:C.text}}>
            <b>{selected.name}:</b> <span style={{color:C.accent,fontWeight:700,fontFamily:"monospace"}}>{selected.total}</span> pts
            &nbsp;·&nbsp;winner: <b>{viewUserWinner?withFlag(viewUserWinner):"—"}</b>
          </div>
        )}
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
          {matches.map(m=><MatchRow key={m.n} match={m} pred={viewUserPreds[m.n]??null} result={results[m.n]??null} editable={false} adminResult={false} roundState={config.round_state} onSave={()=>{}} onResultSave={()=>{}}/>)}
        </div>
      </div>
    );
  }

  // ── Admin Results ─────────────────────────────────────────────────────────
  function AdminResults(){
    async function saveResult(matchN,data){
      await api.setResult(matchN,data);
      if(data.score_a!=null&&data.score_b!=null)setResults(r=>({...r,[matchN]:[data.score_a,data.score_b]}));
      else setResults(r=>{const n={...r};delete n[matchN];return n;});
      showToast("Result saved ✓");refreshLb();
    }
    async function goLive(matchN){
      try{
        await liveApi.set(matchN,{score_a:0,score_b:0,minute:0});
        await refreshLive();
        showToast("Match is now LIVE");
      }catch(e){showToast(e.message,"err");}
    }
    async function updateLive(matchN,data){
      try{
        await liveApi.set(matchN,data);
        await refreshLive();
      }catch(e){showToast(e.message,"err");}
    }
    async function finalizeLive(matchN){
      try{
        const res=await liveApi.finalize(matchN);
        setResults(r=>({...r,[matchN]:[res.score_a,res.score_b]}));
        await refreshLive();
        showToast("Match finalized ✓");refreshLb();
      }catch(e){showToast(e.message,"err");}
    }
    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill/></div>
        <h1 style={{color:C.accent,fontSize:20,marginBottom:12}}>Enter results</h1>
        {config.round_state==="open"&&<InfoBlock warn>💡 Round is still open. Close it first so participants can't edit after seeing scores.</InfoBlock>}
        {Object.keys(liveMatches).length>0&&(
          <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.25)",
            borderRadius:6,padding:"7px 14px",marginBottom:14,fontSize:13,color:C.red,
            display:"flex",alignItems:"center",gap:8}}>
            <span className="live-dot"/><b>{Object.keys(liveMatches).length}</b> match{Object.keys(liveMatches).length>1?"es":""} currently LIVE
          </div>
        )}
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
          {matches.map(m=>(
            <AdminMatchRow key={m.n}
              match={m}
              result={results[m.n]??null}
              liveData={liveMatches[m.n]??null}
              onSaveResult={saveResult}
              onGoLive={goLive}
              onUpdateLive={updateLive}
              onFinalize={finalizeLive}
            />
          ))}
        </div>
      </div>
    );
  }

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
        {user&&tab==="byuser"&&<ByUser/>}
        {user&&tab==="dashboard"&&(
          <AdminDashboard
            config={config} setConfig={setConfig}
            matches={matches} teams={teams} results={results}
            participants={participants} setParticipants={setParticipants}
            leaderboard={leaderboard}
            showToast={showToast} refreshLb={refreshLb}
          />
        )}
        {user&&tab==="results"&&<AdminResults/>}
        {user&&tab==="tournament"&&<Tournament matches={matches} results={results} liveMatches={liveMatches} myPreds={myPreds} config={config} user={user}/>}
        {user&&tab==="settings"&&<SettingsView user={user} leaderboard={leaderboard} onLogout={doLogout} onNameUpdate={u=>{setUser(u);showToast("Name updated ✓");}} showToast={showToast}/>}
      </div>
      {toast&&(
        <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:toast.kind==="err"?C.red:toast.kind==="warn"?C.accent:C.green,color:toast.kind==="warn"?"#1a1a1a":"white",padding:"8px 16px",borderRadius:6,fontSize:14,zIndex:100,boxShadow:"0 4px 12px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
