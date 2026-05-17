import { useState, useEffect, useCallback, useRef } from "react";
import { api, setToken, getToken } from "./api";

// ── Theme — all values are CSS variable references so they adapt
//   automatically when the .dark class is toggled on the root div.
//   No prop-drilling needed; even components defined outside App benefit. ────
const C = {
  bg:     "var(--c-bg)",
  panel:  "var(--c-panel)",
  panel2: "var(--c-panel2)",
  border: "var(--c-border)",
  text:   "var(--c-text)",
  muted:  "var(--c-muted)",
  amber:  "var(--c-amber)",
  green:  "var(--c-green)",
  red:    "var(--c-red)",
  indigo: "var(--c-indigo)",
};

// ── Team flags ────────────────────────────────────────────────────────────────
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

// ── Shared style constants (all use CSS vars — theme-aware automatically) ───
const inputStyle = {
  display:"block", width:"100%", marginBottom:10,
  background:C.panel2, color:C.text, border:`1px solid ${C.border}`,
  borderRadius:6, padding:10, boxSizing:"border-box", fontSize:14,
};
const numInput = {
  background:C.bg, border:`1px solid ${C.border}`,
  color:C.text, borderRadius:4, padding:4, textAlign:"center", fontSize:14, width:"100%",
};
const selectStyle = {
  background:C.panel2, color:C.text, border:`1px solid ${C.border}`,
  borderRadius:6, padding:"6px 10px", fontSize:13,
};
const td = { padding:"8px 10px", borderBottom:`1px solid ${C.border}` };

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS OUTSIDE App — stable function references prevent React remounting
// ─────────────────────────────────────────────────────────────────────────────

function InfoBlock({ children, warn }) {
  return (
    <div style={{
      background: warn ? "rgba(239,68,68,0.08)" : "rgba(99,102,241,0.08)",
      borderLeft: `3px solid ${warn ? C.red : C.indigo}`,
      padding:"10px 14px", borderRadius:4, marginBottom:16,
      fontSize:13, color: warn ? C.red : C.text, lineHeight:1.5,
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
  const bg = green ? C.green : red ? C.red : ghost ? "transparent" : C.amber;
  const fg = ghost ? C.text : (green || red) ? "white" : "#1a1a1a";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:bg, color:fg,
      border: ghost ? `1px solid ${C.border}` : 0,
      padding:"8px 14px", borderRadius:6,
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight:700, fontSize:13, opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

// MatchRow — outside App so localA/localB survive App re-renders
function MatchRow({ match, pred, result, editable, adminResult, roundState, onSave, onResultSave }) {
  const [localA, setLocalA] = useState(pred?.[0] != null ? String(pred[0]) : "");
  const [localB, setLocalB] = useState(pred?.[1] != null ? String(pred[1]) : "");
  const [resA,   setResA]   = useState(result?.[0] != null ? String(result[0]) : "");
  const [resB,   setResB]   = useState(result?.[1] != null ? String(result[1]) : "");

  useEffect(() => {
    setLocalA(pred?.[0] != null ? String(pred[0]) : "");
    setLocalB(pred?.[1] != null ? String(pred[1]) : "");
  }, [pred?.[0], pred?.[1]]);

  useEffect(() => {
    setResA(result?.[0] != null ? String(result[0]) : "");
    setResB(result?.[1] != null ? String(result[1]) : "");
  }, [result?.[0], result?.[1]]);

  async function savePred(side, val) {
    const a = side === 0 ? val : localA;
    const b = side === 1 ? val : localB;
    if (a === "" || b === "") return;
    try { await onSave(match.n, { score_a: Number(a), score_b: Number(b) }); }
    catch (e) { console.error(e); }
  }

  async function saveResult(side, val) {
    const a = side === 0 ? val : resA;
    const b = side === 1 ? val : resB;
    try {
      await onResultSave(match.n, {
        score_a: a === "" ? null : Number(a),
        score_b: b === "" ? null : Number(b),
      });
    } catch (e) { console.error(e); }
  }

  // Points badge
  let ptsEl = null;
  if (result && pred?.[0] != null && pred?.[1] != null) {
    const p1=pred[0],p2=pred[1],r1=result[0],r2=result[1];
    const sign = (x) => x===0?0:x>0?1:-1;
    const dir = sign(p1-p2)===sign(r1-r2)?5:0;
    let exact=0;
    if (p1===r1&&p2===r2) exact=3;
    else if (p1===r1||p2===r2) exact=1;
    const total=dir+exact;
    const colors={p8:["#052e16","#86efac"],p6:["#1e3a44","#a5f3fc"],p5:["#3a1e44","#e9d5ff"],p1:["#3f2718","#fbbf24"],p0:["#3f3f46","#a1a1aa"]};
    const cls=total===8?"p8":total===6?"p6":total===5?"p5":total===1?"p1":"p0";
    const [bg,fg]=colors[cls];
    ptsEl=<span style={{background:bg,color:fg,padding:"2px 6px",borderRadius:4,fontWeight:700,fontFamily:"monospace",fontSize:12}}>+{total}</span>;
  } else if (roundState==="closed"&&!result) {
    ptsEl=<span style={{color:C.muted,fontSize:11}}>awaiting</span>;
  }

  const rowBg = (!editable && !adminResult) ? C.panel : C.panel2;

  return (
    <div style={{
      display:"grid",
      gridTemplateColumns:"28px 26px 1fr 44px 12px 44px 1fr auto",
      alignItems:"center", gap:5, padding:"5px 8px",
      borderRadius:6, background:rowBg, border:`1px solid ${C.border}`,
      marginBottom:3, fontSize:13,
    }}>
      <span style={{color:C.muted,fontSize:11}}>#{match.n}</span>
      <span style={{background:C.border,color:C.text,padding:"1px 5px",borderRadius:4,fontSize:11,textAlign:"center"}}>{match.g}</span>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12}}>{flag(match.a)} {match.a}</span>

      {editable ? (
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={localA}
            onChange={(e)=>setLocalA(e.target.value)} onBlur={(e)=>savePred(0,e.target.value)}
            style={numInput}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={localB}
            onChange={(e)=>setLocalB(e.target.value)} onBlur={(e)=>savePred(1,e.target.value)}
            style={numInput}/>
        </>
      ) : adminResult ? (
        <>
          <input type="number" inputMode="numeric" min={0} max={20} value={resA}
            onChange={(e)=>setResA(e.target.value)} onBlur={(e)=>saveResult(0,e.target.value)}
            style={numInput}/>
          <span style={{textAlign:"center",color:C.muted}}>:</span>
          <input type="number" inputMode="numeric" min={0} max={20} value={resB}
            onChange={(e)=>setResB(e.target.value)} onBlur={(e)=>saveResult(1,e.target.value)}
            style={numInput}/>
        </>
      ) : (
        <span style={{
          gridColumn:"span 3", textAlign:"center",
          fontFamily:"monospace", fontWeight:700, fontSize:15,
          background:C.bg, border:`1px solid ${C.border}`, borderRadius:4, padding:"4px 0",
          color: pred?.[0]!=null ? C.text : C.muted,
        }}>
          {pred?.[0]!=null ? `${pred[0]} : ${pred[1]}` : "—"}
        </span>
      )}

      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right",fontSize:12}}>{match.b} {flag(match.b)}</span>

      <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"flex-end",minWidth:80}}>
        {result!=null&&(
          <span style={{background:"#14532d",color:"#d1fae5",padding:"1px 6px",borderRadius:4,fontWeight:700,fontFamily:"monospace",fontSize:12}}>
            {result[0]}:{result[1]}
          </span>
        )}
        {ptsEl}
      </div>
    </div>
  );
}

// AuthView — outside App so form state survives App re-renders
function AuthView({ roundState, onSuccess }) {
  const [mode,     setMode]     = useState("signup");
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [loading,  setLoading]  = useState(false);

  const pills = {
    open:   { text:"🟢 Betting round is OPEN",   bg:"rgba(16,185,129,0.1)",   color:C.green,  border:`1px solid ${C.green}` },
    closed: { text:"🔒 Betting round is CLOSED", bg:"rgba(239,68,68,0.1)",    color:C.red,    border:`1px solid ${C.red}` },
    idle:   { text:"⏸️ No betting round yet",    bg:"rgba(148,163,184,0.1)", color:C.muted,  border:`1px solid ${C.border}` },
  };
  const pill = pills[roundState] || pills.idle;

  async function submit(e) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const res = mode==="signup"
        ? await api.signup({ name:name.trim(), email:email.trim().toLowerCase(), password })
        : await api.login({ email:email.trim().toLowerCase(), password });
      onSuccess(res.user, res.token);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{maxWidth:400,margin:"30px auto",padding:"0 16px"}}>
      <div style={{marginBottom:14,textAlign:"center"}}>
        <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,background:pill.bg,color:pill.color,border:pill.border}}>
          {pill.text}
        </span>
      </div>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
        <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:16}}>
          {["signup","login"].map((m)=>(
            <button key={m} onClick={()=>setMode(m)} style={{
              background: mode===m ? C.amber : "transparent",
              color: mode===m ? "#1a1a1a" : C.text,
              border:`1px solid ${mode===m ? C.amber : C.border}`,
              padding:"6px 16px", borderRadius:6, cursor:"pointer", fontWeight:700,
            }}>
              {m==="signup" ? "Sign up" : "Log in"}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          {mode==="signup"&&(
            <input value={name} onChange={(e)=>setName(e.target.value)}
              placeholder="Full name" required style={inputStyle}/>
          )}
          <input value={email} onChange={(e)=>setEmail(e.target.value)}
            placeholder={mode==="login" ? "Email  (admin: admin)" : "Email"}
            required style={inputStyle}/>
          <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)}
            placeholder="Password" required minLength={4} style={inputStyle}/>
          {err&&<p style={{color:C.red,fontSize:13,marginBottom:8}}>{err}</p>}
          <button type="submit" disabled={loading} style={{
            width:"100%", background:C.amber, color:"#1a1a1a", border:0,
            padding:"10px 0", borderRadius:6, fontWeight:700,
            cursor: loading?"not-allowed":"pointer", opacity: loading?0.6:1,
          }}>
            {loading ? "…" : mode==="signup" ? "Create account" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // Theme — default dark, persisted in localStorage
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("wc2026_theme");
    return saved === null ? true : saved === "dark";
  });
  function toggleTheme() {
    setIsDark((d) => {
      const next = !d;
      localStorage.setItem("wc2026_theme", next ? "dark" : "light");
      return next;
    });
  }

  const [user,           setUser]           = useState(null);
  const [authLoading,    setAuthLoading]    = useState(true);
  const [tab,            setTab]            = useState("auth");
  const [matches,        setMatches]        = useState([]);
  const [teams,          setTeams]          = useState([]);
  const [config,         setConfig]         = useState({ round_state:"idle", tournament_winner:null });
  const [myPreds,        setMyPreds]        = useState({});
  const [myWinner,       setMyWinner]       = useState(null);
  const [results,        setResults]        = useState({});
  const [leaderboard,    setLeaderboard]    = useState([]);
  const [participants,   setParticipants]   = useState([]);
  const [viewUserId,     setViewUserId]     = useState(null);
  const [viewUserPreds,  setViewUserPreds]  = useState({});
  const [viewUserWinner, setViewUserWinner] = useState(null);
  const [toast,          setToast]          = useState(null);
  const [globalErr,      setGlobalErr]      = useState("");
  const toastTimer = useRef(null);

  function showToast(msg, kind="ok") {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(null), 2500);
  }

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadGameData = useCallback(async (isAdmin, userId=null) => {
    try {
      const [matchData, cfg, res, lb] = await Promise.all([
        api.getMatches(), api.getConfig(), api.getResults(), api.getLeaderboard(),
      ]);
      setMatches(matchData.matches);
      setTeams(matchData.teams);
      setConfig(cfg);
      const resMap={};
      for (const r of res) resMap[r.match_n]=[r.score_a,r.score_b];
      setResults(resMap);
      setLeaderboard(lb);

      if (!isAdmin && userId) {
        const myEntry = lb.find((e)=>e.user_id===userId);
        if (myEntry) setMyWinner(myEntry.winner_pick||null);
        const preds = await api.getMyPredictions();
        const predMap={};
        for (const p of preds) predMap[p.match_n]=[p.score_a,p.score_b];
        setMyPreds(predMap);
      }
      if (isAdmin) {
        const users = await api.getUsers();
        setParticipants(users);
      }
    } catch(e) { setGlobalErr(e.message); }
  }, []);

  useEffect(()=>{
    if (!getToken()) { setAuthLoading(false); return; }
    api.me()
      .then(async (u)=>{
        setUser(u);
        setTab(u.is_admin?"dashboard":"predictions");
        await loadGameData(u.is_admin, u.id);
      })
      .catch(()=>setToken(null))
      .finally(()=>setAuthLoading(false));
  }, [loadGameData]);

  async function doLogin(userData, token) {
    setToken(token);
    setUser(userData);
    setTab(userData.is_admin?"dashboard":"predictions");
    await loadGameData(userData.is_admin, userData.id);
    showToast(`Welcome, ${userData.name}!`);
  }

  function doLogout() {
    setToken(null); setUser(null); setTab("auth");
    setMyPreds({}); setMyWinner(null); setLeaderboard([]); setParticipants([]);
  }

  async function refreshLb() {
    const lb = await api.getLeaderboard();
    setLeaderboard(lb);
    if (user&&!user.is_admin) {
      const myEntry=lb.find((e)=>e.user_id===user.id);
      if (myEntry) setMyWinner(myEntry.winner_pick||null);
    }
    if (user?.is_admin) { const users=await api.getUsers(); setParticipants(users); }
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const tabs = !user ? [] : user.is_admin
    ? [
        {id:"dashboard",   label:"Dashboard",      admin:true},
        {id:"results",     label:"Results",         admin:true},
        {id:"leaderboard", label:"Leaderboard"},
        {id:"byuser",      label:"By participant"},
      ]
    : [
        {id:"predictions", label:"My predictions"},
        {id:"leaderboard", label:"Leaderboard"},
        ...(config.round_state==="closed" ? [{id:"byuser",label:"Bets by participant"}] : []),
      ];

  // ── Round pill ──────────────────────────────────────────────────────────────
  function RoundPill() {
    const map={
      open:   {text:"🟢 Betting round is OPEN",   bg:"rgba(16,185,129,0.1)",  color:C.green,  border:`1px solid ${C.green}`},
      closed: {text:"🔒 Betting round is CLOSED", bg:"rgba(239,68,68,0.1)",   color:C.red,    border:`1px solid ${C.red}`},
      idle:   {text:"⏸️ No betting round yet",    bg:"rgba(148,163,184,0.1)", color:C.muted,  border:`1px solid ${C.border}`},
    };
    const s=map[config.round_state]||map.idle;
    return (
      <span style={{display:"inline-block",padding:"4px 14px",borderRadius:999,fontSize:13,fontWeight:600,background:s.bg,color:s.color,border:s.border}}>
        {s.text}
      </span>
    );
  }

  // ── My Predictions ──────────────────────────────────────────────────────────
  function MyPredictions() {
    const editable = config.round_state==="open";
    const myEntry  = leaderboard.find((e)=>e.user_id===user?.id);

    async function savePred(matchN, data) {
      await api.setPrediction(matchN, data);
      setMyPreds((p)=>({...p,[matchN]:[data.score_a,data.score_b]}));
      showToast("Saved ✓");
    }
    async function saveWinner(team) {
      try {
        await api.setWinnerPick({team:team||null});
        setMyWinner(team||null);
        showToast("Winner pick saved ✓");
        await refreshLb();
      } catch(e) { showToast(e.message,"err"); }
    }

    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill /></div>
        <h1 style={{color:C.amber,fontSize:20,marginBottom:12}}>{user?.name}'s predictions</h1>

        {config.round_state==="idle"&&(
          <InfoBlock warn>⏸️ <b>No betting round is open yet.</b> The admin needs to open a round before you can enter predictions.</InfoBlock>
        )}
        {config.round_state==="open"&&(
          <InfoBlock>✏️ <b>Round is open.</b> Predictions save automatically when you leave each field.<br/>
            <b>Scoring:</b> 5 pts correct direction · +3 exact · +1 partial · 10 pts tournament winner pick.
          </InfoBlock>
        )}
        {config.round_state==="closed"&&(
          <InfoBlock>🔒 <b>Round closed.</b> Points appear once the admin enters results.</InfoBlock>
        )}

        {myEntry&&(
          <div style={{textAlign:"right",padding:"8px 12px",background:C.panel2,borderRadius:6,marginBottom:16,fontSize:14,color:C.text}}>
            Total: <span style={{color:C.amber,fontWeight:700,fontFamily:"monospace",fontSize:18}}>{myEntry.total}</span>
            &nbsp;·&nbsp;{myEntry.scored_matches}/{matches.length} scored
            {myEntry.winner_bonus>0&&<>&nbsp;·&nbsp;🏆 +10 winner bonus</>}
          </div>
        )}

        <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:12,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:16}}>
          <label style={{color:C.text,fontSize:14}}>🏆 Tournament winner pick (+10 pts):</label>
          <select disabled={!editable} value={myWinner||""}
            onChange={(e)=>saveWinner(e.target.value)}
            style={{...selectStyle,minWidth:220,opacity:editable?1:0.6}}>
            <option value="">— choose a team —</option>
            {teams.map((t)=><option key={t} value={t}>{withFlag(t)}</option>)}
          </select>
          {config.tournament_winner&&(
            <span style={{color:C.muted,fontSize:13}}>🏆 actual: <b style={{color:C.amber}}>{withFlag(config.tournament_winner)}</b></span>
          )}
        </div>

        <SectionHeader>Group stage — {matches.length} matches</SectionHeader>
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
          {matches.map((m)=>(
            <MatchRow key={m.n} match={m} pred={myPreds[m.n]??null} result={results[m.n]??null}
              editable={editable} adminResult={false} roundState={config.round_state}
              onSave={savePred} onResultSave={()=>{}}/>
          ))}
        </div>
      </div>
    );
  }

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  function LeaderboardView() {
    const winnerKnown=!!config.tournament_winner;
    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill /></div>
        <h1 style={{color:C.amber,fontSize:20,marginBottom:12}}>🏆 Leaderboard</h1>
        {leaderboard.length===0
          ? <div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>No participants yet.</div>
          : (
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
                <thead>
                  <tr style={{background:C.panel2}}>
                    {["#","Name","Points","Winner pick"].map((h)=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:h==="Points"?"center":"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row,i)=>{
                    const isMe=row.user_id===user?.id;
                    const rowBg=i===0?"rgba(245,158,11,0.12)":i===1?"rgba(245,158,11,0.07)":i===2?"rgba(245,158,11,0.03)":"transparent";
                    let winnerCell;
                    if (winnerKnown) {
                      winnerCell=row.winner_pick?<>{withFlag(row.winner_pick)}{row.winner_bonus>0&&<span style={{color:C.green}}> +10</span>}</>:"—";
                    } else if (user?.is_admin||config.round_state==="closed"||isMe) {
                      winnerCell=row.winner_pick?withFlag(row.winner_pick):"—";
                    } else {
                      winnerCell=<span style={{color:C.muted}}>🔒</span>;
                    }
                    return (
                      <tr key={row.user_id} style={{background:rowBg,boxShadow:isMe?`inset 3px 0 0 ${C.amber}`:"none"}}>
                        <td style={td}><b>{i+1}</b></td>
                        <td style={td}>{row.name}{isMe&&<span style={{background:C.indigo,color:"white",fontSize:10,padding:"1px 5px",borderRadius:4,marginLeft:6}}>you</span>}</td>
                        <td style={{...td,textAlign:"center",color:C.amber,fontWeight:700,fontFamily:"monospace"}}>{row.total}</td>
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

  // ── By User ─────────────────────────────────────────────────────────────────
  function ByUser() {
    useEffect(()=>{
      if (!viewUserId&&leaderboard.length>0) setViewUserId(leaderboard[0].user_id);
    },[]);
    useEffect(()=>{
      if (!viewUserId) return;
      api.getUserPredictions(viewUserId)
        .then((preds)=>{
          const m={};
          for (const p of preds) m[p.match_n]=[p.score_a,p.score_b];
          setViewUserPreds(m);
          const entry=leaderboard.find((e)=>e.user_id===viewUserId);
          setViewUserWinner(entry?.winner_pick||null);
        })
        .catch((e)=>showToast(e.message,"err"));
    },[viewUserId]);

    if (!user?.is_admin&&config.round_state!=="closed") {
      return <InfoBlock warn>Other participants' bets are hidden until the admin closes the betting round.</InfoBlock>;
    }
    const selected=leaderboard.find((e)=>e.user_id===viewUserId);
    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill /></div>
        <h1 style={{color:C.amber,fontSize:20,marginBottom:12}}>Bets by participant</h1>
        <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
          <label style={{color:C.muted}}>Participant:</label>
          <select value={viewUserId||""} onChange={(e)=>setViewUserId(Number(e.target.value))} style={{...selectStyle,minWidth:200}}>
            {leaderboard.map((e)=><option key={e.user_id} value={e.user_id}>{e.name}</option>)}
          </select>
        </div>
        {selected&&(
          <div style={{textAlign:"right",padding:"8px 12px",background:C.panel2,borderRadius:6,marginBottom:12,fontSize:14,color:C.text}}>
            <b>{selected.name}:</b> <span style={{color:C.amber,fontWeight:700,fontFamily:"monospace"}}>{selected.total}</span> pts
            &nbsp;·&nbsp;winner: <b>{viewUserWinner?withFlag(viewUserWinner):"—"}</b>
          </div>
        )}
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
          {matches.map((m)=>(
            <MatchRow key={m.n} match={m} pred={viewUserPreds[m.n]??null} result={results[m.n]??null}
              editable={false} adminResult={false} roundState={config.round_state}
              onSave={()=>{}} onResultSave={()=>{}}/>
          ))}
        </div>
      </div>
    );
  }

  // ── Admin Dashboard ─────────────────────────────────────────────────────────
  function AdminDashboard() {
    const [winnerSel,setWinnerSel]=useState(config.tournament_winner||"");
    async function setRoundState(state) {
      try { const cfg=await api.updateConfig({round_state:state}); setConfig(cfg); showToast(state==="open"?"Round opened!":"Round closed."); await refreshLb(); }
      catch(e) { showToast(e.message,"err"); }
    }
    async function setWinner() {
      try { const cfg=await api.updateConfig({tournament_winner:winnerSel||null}); setConfig(cfg); showToast("Winner set!"); await refreshLb(); }
      catch(e) { showToast(e.message,"err"); }
    }
    async function togglePaid(uid,val) {
      try { await api.patchUser(uid,{has_paid:val}); setParticipants((p)=>p.map((u)=>u.id===uid?{...u,has_paid:val}:u)); }
      catch(e) { showToast(e.message,"err"); }
    }
    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill /></div>
        <h1 style={{color:C.amber,fontSize:20,marginBottom:12}}>⚙️ Admin dashboard</h1>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:20}}>
          {[
            {label:"Participants",    value:participants.length,                                          color:C.amber},
            {label:"Paid",            value:`${participants.filter(u=>u.has_paid).length} / ${participants.length}`, color:C.green},
            {label:"Results entered", value:`${Object.keys(results).length} / ${matches.length}`,         color:C.amber},
          ].map((s)=>(
            <div key={s.label} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14}}>
              <div style={{color:C.muted,fontSize:12,marginBottom:4}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
            </div>
          ))}
        </div>

        <h2 style={{color:C.amber,fontSize:16,margin:"0 0 8px"}}>Round control</h2>
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:20}}>
          {config.round_state==="idle"&&<>
            <div style={{flex:1}}><div style={{fontWeight:600,marginBottom:4,color:C.text}}>⏸️ Round is idle.</div><div style={{color:C.muted,fontSize:12}}>Open to start collecting predictions.</div></div>
            <Btn green onClick={()=>setRoundState("open")}>🟢 Open round</Btn>
          </>}
          {config.round_state==="open"&&<>
            <div style={{flex:1}}><div style={{color:C.green,fontWeight:600,marginBottom:4}}>🟢 Round is OPEN.</div><div style={{color:C.muted,fontSize:12}}>Close to lock bets and reveal them.</div></div>
            <Btn red onClick={()=>confirm("Close the round? Bets will be revealed to everyone.")&&setRoundState("closed")}>🔒 Close round</Btn>
          </>}
          {config.round_state==="closed"&&<>
            <div style={{flex:1}}><div style={{color:C.red,fontWeight:600,marginBottom:4}}>🔒 Round is CLOSED.</div><div style={{color:C.muted,fontSize:12}}>Enter results in the Results tab.</div></div>
            <Btn ghost onClick={()=>confirm("Reopen? Bets will be hidden again.")&&setRoundState("open")}>Reopen</Btn>
          </>}
        </div>

        <h2 style={{color:C.amber,fontSize:16,margin:"0 0 8px"}}>🏆 Tournament winner</h2>
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:14,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:20}}>
          <select value={winnerSel} onChange={(e)=>setWinnerSel(e.target.value)} style={{...selectStyle,minWidth:220}}>
            <option value="">— none —</option>
            {teams.map((t)=><option key={t} value={t}>{withFlag(t)}</option>)}
          </select>
          <Btn onClick={setWinner}>Set winner</Btn>
          <span style={{color:C.muted,fontSize:12}}>Awards +10 pts to everyone who picked correctly.</span>
        </div>

        <h2 style={{color:C.amber,fontSize:16,margin:"0 0 8px"}}>Participants ({participants.length})</h2>
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{background:C.panel2}}>
                {["Name","Email","Points","Winner pick","Paid"].map((h)=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",color:C.muted,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {participants.length===0
                ? <tr><td colSpan={5} style={{padding:24,textAlign:"center",color:C.muted}}>No participants yet</td></tr>
                : participants.map((u)=>{
                  const entry=leaderboard.find((e)=>e.user_id===u.id);
                  return (
                    <tr key={u.id}>
                      <td style={td}>{u.name}</td>
                      <td style={{...td,color:C.muted,fontFamily:"monospace",fontSize:12}}>{u.email}</td>
                      <td style={{...td,color:C.amber,fontWeight:700,fontFamily:"monospace"}}>{entry?.total??0}</td>
                      <td style={td}>{entry?.winner_pick?withFlag(entry.winner_pick):"—"}</td>
                      <td style={td}><input type="checkbox" checked={u.has_paid} onChange={(e)=>togglePaid(u.id,e.target.checked)}/></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Admin Results ────────────────────────────────────────────────────────────
  function AdminResults() {
    async function saveResult(matchN, data) {
      await api.setResult(matchN, data);
      if (data.score_a!=null&&data.score_b!=null) {
        setResults((r)=>({...r,[matchN]:[data.score_a,data.score_b]}));
      } else {
        setResults((r)=>{const n={...r};delete n[matchN];return n;});
      }
      showToast("Result saved ✓");
      await refreshLb();
    }
    return (
      <div>
        <div style={{marginBottom:14}}><RoundPill /></div>
        <h1 style={{color:C.amber,fontSize:20,marginBottom:12}}>Enter results</h1>
        {config.round_state==="open"&&(
          <InfoBlock warn>💡 Round is still open. Close it first so participants can't edit after seeing scores.</InfoBlock>
        )}
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
          {matches.map((m)=>(
            <MatchRow key={m.n} match={m} pred={null} result={results[m.n]??null}
              editable={false} adminResult={true} roundState={config.round_state}
              onSave={()=>{}} onResultSave={saveResult}/>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className={isDark?"dark":""} style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.muted}}>
        Loading…
      </div>
    );
  }

  return (
    <div className={isDark?"dark":""} style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:'-apple-system,"Segoe UI",Arial,sans-serif'}}>

      {/* Nav */}
      <nav style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"12px 0"}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",justifyContent:"space-between"}}>
          <div style={{fontWeight:800,color:C.amber,fontSize:17}}>⚽ WC 2026 Predictions</div>

          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {tabs.map((t)=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                background: tab===t.id ? (t.admin?C.red:C.amber) : "transparent",
                color: tab===t.id ? "white" : (t.admin?C.red:C.text),
                border:`1px solid ${tab===t.id?(t.admin?C.red:C.amber):C.border}`,
                padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:tab===t.id?700:400,
              }}>{t.label}</button>
            ))}
          </div>

          <div style={{display:"flex",gap:8,alignItems:"center",fontSize:13}}>
            {user&&<span style={{color:C.text}}>Hi <b style={{color:C.amber}}>{user.name}</b>{user.is_admin?" 👑":""}</span>}
            {/* Theme toggle */}
            <button onClick={toggleTheme} title={isDark?"Switch to light mode":"Switch to dark mode"} style={{
              background:"transparent",border:`1px solid ${C.border}`,
              color:C.text,padding:"5px 9px",borderRadius:6,cursor:"pointer",fontSize:15,lineHeight:1,
            }}>
              {isDark ? "☀️" : "🌙"}
            </button>
            {user&&(
              <button onClick={doLogout} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.text,padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12}}>
                Log out
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Global error */}
      {globalErr&&(
        <div style={{background:"rgba(239,68,68,0.1)",borderBottom:`1px solid ${C.red}`,padding:"8px 16px",fontSize:13,color:C.red,display:"flex",justifyContent:"space-between"}}>
          <span>⚠️ {globalErr}</span>
          <button onClick={()=>setGlobalErr("")} style={{background:"none",border:0,color:C.red,cursor:"pointer"}}>✕</button>
        </div>
      )}

      {/* Content */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 16px 40px"}}>
        {!user&&<AuthView roundState={config.round_state} onSuccess={doLogin}/>}
        {user&&tab==="predictions"&&<MyPredictions/>}
        {user&&tab==="leaderboard"&&<LeaderboardView/>}
        {user&&tab==="byuser"&&<ByUser/>}
        {user&&tab==="dashboard"&&<AdminDashboard/>}
        {user&&tab==="results"&&<AdminResults/>}
      </div>

      {/* Toast */}
      {toast&&(
        <div style={{
          position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",
          background:toast.kind==="err"?C.red:toast.kind==="warn"?C.amber:C.green,
          color: toast.kind==="warn"?"#1a1a1a":"white",
          padding:"8px 16px",borderRadius:6,fontSize:14,
          zIndex:100,boxShadow:"0 4px 12px rgba(0,0,0,0.2)",whiteSpace:"nowrap",
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
