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
// Demo uses real team names for all known knockout matchups (based on simulated
// group stage results). Slot labels like "W M81" appear only for TBD fixtures.
const MATCHES = [
  // ── Group Stage ─────────────────────────────────────────────────────────
  {n:1, s:1,g:"A",a:"Mexico",b:"South Africa"},
  {n:2, s:1,g:"A",a:"Korea Republic",b:"Czech Republic"},
  {n:3, s:1,g:"B",a:"Canada",b:"Bosnia and Herzegovina"},
  {n:4, s:1,g:"D",a:"United States",b:"Paraguay"},
  {n:5, s:1,g:"C",a:"Haiti",b:"Scotland"},
  {n:6, s:1,g:"D",a:"Australia",b:"Turkey"},
  {n:7, s:1,g:"C",a:"Brazil",b:"Morocco"},
  {n:8, s:1,g:"B",a:"Qatar",b:"Switzerland"},
  {n:9, s:1,g:"E",a:"Ivory Coast",b:"Ecuador"},
  {n:10,s:1,g:"E",a:"Germany",b:"Curaçao"},
  {n:11,s:1,g:"F",a:"Netherlands",b:"Japan"},
  {n:12,s:1,g:"F",a:"Sweden",b:"Tunisia"},
  {n:13,s:1,g:"H",a:"Saudi Arabia",b:"Uruguay"},
  {n:14,s:1,g:"H",a:"Spain",b:"Cape Verde"},
  {n:15,s:1,g:"G",a:"Iran",b:"New Zealand"},
  {n:16,s:1,g:"G",a:"Belgium",b:"Egypt"},
  {n:17,s:1,g:"I",a:"France",b:"Senegal"},
  {n:18,s:1,g:"I",a:"Iraq",b:"Norway"},
  {n:19,s:1,g:"J",a:"Argentina",b:"Algeria"},
  {n:20,s:1,g:"J",a:"Austria",b:"Jordan"},
  {n:21,s:1,g:"L",a:"Ghana",b:"Panama"},
  {n:22,s:1,g:"L",a:"England",b:"Croatia"},
  {n:23,s:1,g:"K",a:"Portugal",b:"DR Congo"},
  {n:24,s:1,g:"K",a:"Uzbekistan",b:"Colombia"},
  {n:25,s:1,g:"A",a:"Czech Republic",b:"South Africa"},
  {n:26,s:1,g:"B",a:"Switzerland",b:"Bosnia and Herzegovina"},
  {n:27,s:1,g:"B",a:"Canada",b:"Qatar"},
  {n:28,s:1,g:"A",a:"Mexico",b:"Korea Republic"},
  {n:29,s:1,g:"C",a:"Brazil",b:"Haiti"},
  {n:30,s:1,g:"C",a:"Scotland",b:"Morocco"},
  {n:31,s:1,g:"D",a:"United States",b:"Australia"},
  {n:32,s:1,g:"D",a:"Turkey",b:"Paraguay"},
  {n:33,s:1,g:"E",a:"Germany",b:"Ivory Coast"},
  {n:34,s:1,g:"E",a:"Ecuador",b:"Curaçao"},
  {n:35,s:1,g:"F",a:"Netherlands",b:"Sweden"},
  {n:36,s:1,g:"F",a:"Tunisia",b:"Japan"},
  {n:37,s:1,g:"H",a:"Uruguay",b:"Cape Verde"},
  {n:38,s:1,g:"H",a:"Spain",b:"Saudi Arabia"},
  {n:39,s:1,g:"G",a:"Belgium",b:"Iran"},
  {n:40,s:1,g:"G",a:"New Zealand",b:"Egypt"},
  {n:41,s:1,g:"I",a:"Norway",b:"Senegal"},
  {n:42,s:1,g:"I",a:"France",b:"Iraq"},
  {n:43,s:1,g:"J",a:"Argentina",b:"Austria"},
  {n:44,s:1,g:"J",a:"Jordan",b:"Algeria"},
  {n:45,s:1,g:"L",a:"England",b:"Ghana"},
  {n:46,s:1,g:"L",a:"Panama",b:"Croatia"},
  {n:47,s:1,g:"K",a:"Portugal",b:"Uzbekistan"},
  {n:48,s:1,g:"K",a:"Colombia",b:"DR Congo"},
  {n:49,s:1,g:"C",a:"Scotland",b:"Brazil"},
  {n:50,s:1,g:"C",a:"Morocco",b:"Haiti"},
  {n:51,s:1,g:"B",a:"Switzerland",b:"Canada"},
  {n:52,s:1,g:"B",a:"Bosnia and Herzegovina",b:"Qatar"},
  {n:53,s:1,g:"A",a:"Czech Republic",b:"Mexico"},
  {n:54,s:1,g:"A",a:"South Africa",b:"Korea Republic"},
  {n:55,s:1,g:"E",a:"Curaçao",b:"Ivory Coast"},
  {n:56,s:1,g:"E",a:"Ecuador",b:"Germany"},
  {n:57,s:1,g:"F",a:"Japan",b:"Sweden"},
  {n:58,s:1,g:"F",a:"Tunisia",b:"Netherlands"},
  {n:59,s:1,g:"D",a:"Turkey",b:"United States"},
  {n:60,s:1,g:"D",a:"Paraguay",b:"Australia"},
  {n:61,s:1,g:"I",a:"Norway",b:"France"},
  {n:62,s:1,g:"I",a:"Senegal",b:"Iraq"},
  {n:63,s:1,g:"G",a:"Egypt",b:"Iran"},
  {n:64,s:1,g:"G",a:"New Zealand",b:"Belgium"},
  {n:65,s:1,g:"H",a:"Cape Verde",b:"Saudi Arabia"},
  {n:66,s:1,g:"H",a:"Uruguay",b:"Spain"},
  {n:67,s:1,g:"L",a:"Panama",b:"England"},
  {n:68,s:1,g:"L",a:"Croatia",b:"Ghana"},
  {n:69,s:1,g:"J",a:"Algeria",b:"Austria"},
  {n:70,s:1,g:"J",a:"Jordan",b:"Argentina"},
  {n:71,s:1,g:"K",a:"Colombia",b:"Portugal"},
  {n:72,s:1,g:"K",a:"DR Congo",b:"Uzbekistan"},
  // ── Round of 32 ─────────────────────────────────────────────────────────
  // Group qualifiers: A:CzechRep/Mexico · B:Canada/Switzerland · C:Brazil/Morocco
  // D:Paraguay/USA · E:Germany/Ecuador · F:Netherlands/Japan · G:Belgium/Egypt
  // H:Spain/Uruguay · I:France/Senegal · J:Argentina/Austria · K:Portugal/Colombia
  // L:England/Croatia
  // Best 3rd: Saudi Arabia · Norway · Scotland · South Africa · Ivory Coast ·
  //           Algeria · Ghana · New Zealand
  {n:73, s:2,g:"R32",a:"Czech Republic",b:"Switzerland"},
  {n:74, s:2,g:"R32",a:"Canada",b:"Mexico"},
  {n:75, s:2,g:"R32",a:"Brazil",b:"United States"},
  {n:76, s:2,g:"R32",a:"Paraguay",b:"Morocco"},
  {n:77, s:2,g:"R32",a:"Germany",b:"Japan"},
  {n:78, s:2,g:"R32",a:"Netherlands",b:"Ecuador"},
  {n:79, s:2,g:"R32",a:"Belgium",b:"Uruguay"},
  {n:80, s:2,g:"R32",a:"Spain",b:"Egypt"},
  {n:81, s:2,g:"R32",a:"France",b:"Austria"},
  {n:82, s:2,g:"R32",a:"Argentina",b:"Senegal"},
  {n:83, s:2,g:"R32",a:"Portugal",b:"Croatia"},
  {n:84, s:2,g:"R32",a:"England",b:"Colombia"},
  {n:85, s:2,g:"R32",a:"Saudi Arabia",b:"Scotland"},
  {n:86, s:2,g:"R32",a:"Norway",b:"South Africa"},
  {n:87, s:2,g:"R32",a:"Ivory Coast",b:"Algeria"},
  {n:88, s:2,g:"R32",a:"Ghana",b:"New Zealand"},
  // ── Round of 16 ─────────────────────────────────────────────────────────
  // 89-92 use actual team names (winners of 73-80 are known from demo results)
  {n:89, s:3,g:"R16",a:"Czech Republic",b:"Mexico"},
  {n:90, s:3,g:"R16",a:"Brazil",b:"Morocco"},
  {n:91, s:3,g:"R16",a:"Germany",b:"Ecuador"},
  {n:92, s:3,g:"R16",a:"Belgium",b:"Spain"},
  {n:93, s:3,g:"R16",a:"W M81",b:"W M82"},
  {n:94, s:3,g:"R16",a:"W M83",b:"W M84"},
  {n:95, s:3,g:"R16",a:"W M85",b:"W M86"},
  {n:96, s:3,g:"R16",a:"W M87",b:"W M88"},
  // ── Quarterfinals ────────────────────────────────────────────────────────
  {n:97, s:4,g:"QF",a:"W M89",b:"W M90"},
  {n:98, s:4,g:"QF",a:"W M91",b:"W M92"},
  {n:99, s:4,g:"QF",a:"W M93",b:"W M94"},
  {n:100,s:4,g:"QF",a:"W M95",b:"W M96"},
  // ── Semi-finals ──────────────────────────────────────────────────────────
  {n:101,s:5,g:"SF",a:"W M97",b:"W M98"},
  {n:102,s:5,g:"SF",a:"W M99",b:"W M100"},
  // ── Final & 3rd place ────────────────────────────────────────────────────
  // Note: bracket labels are "FIN"/"3P", not "F" — Group F is a real group
  // stage group letter, so using "F" here would collide and pull the Final
  // into Group F's standings.
  {n:103,s:6,g:"3P",a:"L M101",b:"L M102"},
  {n:104,s:6,g:"FIN",a:"W M101",b:"W M102"},
];
// Kickoff times (UTC) keyed by match number — mirrors app/matches.py so demo and
// production show identical schedules. Time is tied to the slot (n), not teams.
const KICKOFFS = {
  1:"2026-06-11T08:00:00Z",2:"2026-06-11T15:00:00Z",3:"2026-06-12T08:00:00Z",4:"2026-06-12T14:00:00Z",
  5:"2026-06-13T14:00:00Z",6:"2026-06-13T17:00:00Z",7:"2026-06-13T11:00:00Z",8:"2026-06-13T08:00:00Z",
  9:"2026-06-14T12:00:00Z",10:"2026-06-14T06:00:00Z",11:"2026-06-14T09:00:00Z",12:"2026-06-14T15:00:00Z",
  13:"2026-06-15T11:00:00Z",14:"2026-06-15T05:00:00Z",15:"2026-06-15T14:00:00Z",16:"2026-06-15T08:00:00Z",
  17:"2026-06-16T08:00:00Z",18:"2026-06-16T11:00:00Z",19:"2026-06-16T14:00:00Z",20:"2026-06-16T17:00:00Z",
  21:"2026-06-17T12:00:00Z",22:"2026-06-17T09:00:00Z",23:"2026-06-17T06:00:00Z",24:"2026-06-17T15:00:00Z",
  25:"2026-06-18T05:00:00Z",26:"2026-06-18T08:00:00Z",27:"2026-06-18T11:00:00Z",28:"2026-06-18T14:00:00Z",
  29:"2026-06-19T13:30:00Z",30:"2026-06-19T11:00:00Z",31:"2026-06-19T19:00:00Z",32:"2026-06-20T03:00:00Z",
  33:"2026-06-20T09:00:00Z",34:"2026-06-20T13:00:00Z",35:"2026-06-20T06:00:00Z",36:"2026-06-20T17:00:00Z",
  37:"2026-06-21T11:00:00Z",38:"2026-06-21T05:00:00Z",39:"2026-06-21T08:00:00Z",40:"2026-06-21T14:00:00Z",
  41:"2026-06-22T13:00:00Z",42:"2026-06-22T09:00:00Z",43:"2026-06-22T06:00:00Z",44:"2026-06-22T16:00:00Z",
  45:"2026-06-23T09:00:00Z",46:"2026-06-23T12:00:00Z",47:"2026-06-23T06:00:00Z",48:"2026-06-23T15:00:00Z",
  49:"2026-06-24T11:00:00Z",50:"2026-06-24T11:00:00Z",51:"2026-06-24T08:00:00Z",52:"2026-06-24T08:00:00Z",
  53:"2026-06-24T14:00:00Z",54:"2026-06-24T14:00:00Z",55:"2026-06-25T09:00:00Z",56:"2026-06-25T09:00:00Z",
  57:"2026-06-25T12:00:00Z",58:"2026-06-25T12:00:00Z",59:"2026-06-25T15:00:00Z",60:"2026-06-25T15:00:00Z",
  61:"2026-06-26T08:00:00Z",62:"2026-06-26T08:00:00Z",63:"2026-06-26T16:00:00Z",64:"2026-06-26T16:00:00Z",
  65:"2026-06-26T13:00:00Z",66:"2026-06-26T13:00:00Z",67:"2026-06-27T10:00:00Z",68:"2026-06-27T10:00:00Z",
  69:"2026-06-27T15:00:00Z",70:"2026-06-27T15:00:00Z",71:"2026-06-27T12:30:00Z",72:"2026-06-27T12:30:00Z",
  73:"2026-06-28T14:00:00Z",74:"2026-06-28T18:00:00Z",75:"2026-06-29T14:00:00Z",76:"2026-06-29T18:00:00Z",
  77:"2026-06-30T14:00:00Z",78:"2026-06-30T18:00:00Z",79:"2026-07-01T14:00:00Z",80:"2026-07-01T18:00:00Z",
  81:"2026-07-02T14:00:00Z",82:"2026-07-02T18:00:00Z",83:"2026-07-03T14:00:00Z",84:"2026-07-03T18:00:00Z",
  85:"2026-07-04T12:00:00Z",86:"2026-07-04T15:00:00Z",87:"2026-07-04T18:00:00Z",88:"2026-07-04T21:00:00Z",
  89:"2026-07-05T14:00:00Z",90:"2026-07-05T18:00:00Z",91:"2026-07-06T14:00:00Z",92:"2026-07-06T18:00:00Z",
  93:"2026-07-07T14:00:00Z",94:"2026-07-07T18:00:00Z",95:"2026-07-08T14:00:00Z",96:"2026-07-08T18:00:00Z",
  97:"2026-07-09T18:00:00Z",98:"2026-07-10T18:00:00Z",99:"2026-07-11T18:00:00Z",100:"2026-07-12T18:00:00Z",
  101:"2026-07-14T18:00:00Z",102:"2026-07-15T18:00:00Z",103:"2026-07-18T17:00:00Z",104:"2026-07-19T19:00:00Z",
};
MATCHES.forEach(m => { m.t = KICKOFFS[m.n]; });
// TEAMS = real country names from group stage only (for winner picker)
const TEAMS = [...new Set(MATCHES.filter(m=>m.s===1).flatMap(m=>[m.a,m.b]))].sort();

// ── Scoring ──────────────────────────────────────────────────────────────────
function matchPts(pred, result) {
  if (!pred||pred[0]==null||!result) return 0;
  const [pa,pb]=[pred[0],pred[1]],[ra,rb]=[result[0],result[1]];
  const sgn=x=>x===0?0:x>0?1:-1;
  return (sgn(pa-pb)===sgn(ra-rb)?5:0) + (pa===ra&&pb===rb?3:pa===ra||pb===rb?1:0);
}

function calcTotals(preds, results, live, winnerPick, tournamentWinner) {
  // Both FINAL and LIVE results count toward total/ranking. The Live/Final
  // flag is purely a UI signal — Live tells users which games are still
  // running, but the points are awarded the moment any score is entered.
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
    total+=pts;                    // ← live points count toward total
    scored++;                       // ← live matches count as "scored"
    if(p[0]===ld.score_a&&p[1]===ld.score_b) exact++;
    if(sgn(p[0]-p[1])===sgn(ld.score_a-ld.score_b)) correctDir++;
    livePoints+=pts; liveCount++;   // tracked separately for the LIVE badge
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
  // All known results — used to calibrate prediction quality
  const RESULTS={
    // Group Stage (all 72 matches)
    1:[2,1],2:[1,1],3:[2,0],4:[1,2],5:[0,3],6:[1,1],7:[3,1],8:[0,2],
    9:[1,2],10:[4,0],11:[2,1],12:[2,2],13:[1,0],14:[3,0],15:[0,1],16:[2,1],
    17:[2,0],18:[1,2],19:[3,1],20:[2,0],21:[1,0],22:[2,1],23:[3,1],24:[0,2],
    25:[1,0],26:[2,0],27:[2,1],28:[1,1],29:[4,0],30:[1,2],31:[2,0],32:[1,1],
    33:[3,1],34:[2,0],35:[2,1],36:[1,2],37:[3,0],38:[3,1],39:[2,0],40:[0,1],
    41:[1,1],42:[3,0],43:[2,0],44:[1,2],45:[2,0],46:[0,2],47:[3,0],48:[2,1],
    49:[0,2],50:[2,1],51:[1,2],52:[2,1],53:[2,0],54:[2,0],55:[0,2],56:[1,2],
    57:[2,1],58:[0,2],59:[0,2],60:[1,0],61:[0,2],62:[2,0],63:[1,1],64:[0,2],
    65:[1,2],66:[2,1],67:[0,2],68:[1,0],69:[1,2],70:[0,2],71:[1,2],72:[0,2],
    // Round of 32 partial (8 of 16 done)
    73:[2,1],74:[0,1],75:[3,0],76:[1,2],77:[2,0],78:[1,2],79:[2,1],80:[2,0],
  };
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
// Stage 1 (Group Stage, matches 1–72) COMPLETE
// Stage 2 (Round of 32, matches 73–88) IN PROGRESS — 4 results done, 2 live, 10 upcoming
// This gives a rich mixed view: finished rows, live rows, and date/time rows all visible.
const SEED_RESULTS = {
  // Group Stage — all 72 matches
  1:[2,1],2:[1,1],3:[2,0],4:[1,2],5:[0,3],6:[1,1],7:[3,1],8:[0,2],
  9:[1,2],10:[4,0],11:[2,1],12:[2,2],13:[1,0],14:[3,0],15:[0,1],16:[2,1],
  17:[2,0],18:[1,2],19:[3,1],20:[2,0],21:[1,0],22:[2,1],23:[3,1],24:[0,2],
  25:[1,0],26:[2,0],27:[2,1],28:[1,1],29:[4,0],30:[1,2],31:[2,0],32:[1,1],
  33:[3,1],34:[2,0],35:[2,1],36:[1,2],37:[3,0],38:[3,1],39:[2,0],40:[0,1],
  41:[1,1],42:[3,0],43:[2,0],44:[1,2],45:[2,0],46:[0,2],47:[3,0],48:[2,1],
  49:[0,2],50:[2,1],51:[1,2],52:[2,1],53:[2,0],54:[2,0],55:[0,2],56:[1,2],
  57:[2,1],58:[0,2],59:[0,2],60:[1,0],61:[0,2],62:[2,0],63:[1,1],64:[0,2],
  65:[1,2],66:[2,1],67:[0,2],68:[1,0],69:[1,2],70:[0,2],71:[1,2],72:[0,2],
  // Round of 32 — first 4 of 16 results entered; 77 & 78 are LIVE (see SEED_LIVE); 79–88 upcoming
  73:[2,1],74:[0,1],75:[3,0],76:[1,2],
};
// Two live R32 matches — shows the live badge + running score in the date/time slot
const SEED_LIVE = {
  77:{score_a:1,score_b:0,minute:67,is_live:true},
  78:{score_a:0,score_b:0,minute:34,is_live:true},
};

// Determine who advanced: penalties → extra time → 90-min score.
// Returns "a", "b", or null (tied / undecided). Mirrors crud.derive_winner.
function deriveWinner(sa, sb, etA, etB, penA, penB) {
  if (penA != null && penB != null && penA !== penB) return penA > penB ? "a" : "b";
  if (etA  != null && etB  != null && etA  !== etB ) return etA  > etB  ? "a" : "b";
  if (sa   != null && sb   != null && sa   !== sb  ) return sa   > sb   ? "a" : "b";
  return null;
}

// Resolve a bracket slot ("W M101" / "L M101") to the actual team, mirroring
// the backend resolver. Bottoms out at group-stage matches (real names).
const _MATCH_BY_N = {}; MATCHES.forEach(m => { _MATCH_BY_N[m.n] = m; });
const _SLOT_RE = /^([WL]) M(\d+)$/;
function resolveTeamName(name, results, depth = 0) {
  if (depth > 12 || typeof name !== "string") return name;
  const m = _SLOT_RE.exec(name);
  if (!m) return name;
  const typ = m[1], n = Number(m[2]);
  const src = _MATCH_BY_N[n], res = results[n];
  if (!src || !res) return name;
  const sa = res[0], sb = res[1], winner = res[2];
  const w = winner || (sa > sb ? "a" : sb > sa ? "b" : null);
  if (!w) return name;
  const side = typ === "W" ? w : (w === "a" ? "b" : "a");
  return resolveTeamName(side === "a" ? src.a : src.b, results, depth + 1);
}
// When the FINAL (g="FIN") is decided, auto-set the tournament winner. The +10
// bonus then follows from scoring. Mirrors crud._maybe_crown_champion.
function maybeCrownChampion(matchN) {
  const src = _MATCH_BY_N[Number(matchN)];
  if (!src || src.g !== "FIN") return;
  const res = S.results[Number(matchN)];
  if (!res || !res[2]) return;                 // res[2] = winner 'a'/'b'
  const champSlot = res[2] === "a" ? src.a : src.b;
  const champ = resolveTeamName(champSlot, S.results);
  if (!champ || _SLOT_RE.test(String(champ))) return;
  if (S.config.tournament_winner !== champ) S.config.tournament_winner = champ;
}

function buildInitialState() {
  return {
    config:{round_state:"closed",tournament_winner:null,data_source:"manual",current_stage:2},
    users:{
      1:{id:1,name:"Admin",  email:"admin",            password:"admin",   phone:"",              is_admin:true, has_paid:false,created_at:"2026-01-01T00:00:00Z",locked_winner:null},
      2:{id:2,name:"Alice",  email:"alice@demo.com",   password:"alice",   phone:"+1-555-0101",   is_admin:false,has_paid:true, created_at:"2026-01-02T00:00:00Z",locked_winner:"France"},
      3:{id:3,name:"Bob",    email:"bob@demo.com",     password:"bob",     phone:"+1-555-0102",   is_admin:false,has_paid:true, created_at:"2026-01-03T00:00:00Z",locked_winner:"Argentina"},
      4:{id:4,name:"Charlie",email:"charlie@demo.com", password:"charlie", phone:"+1-555-0103",   is_admin:false,has_paid:false,created_at:"2026-01-04T00:00:00Z",locked_winner:"Brazil"},
      5:{id:5,name:"Diana",  email:"diana@demo.com",   password:"diana",   phone:"+44-7700-0001", is_admin:false,has_paid:true, created_at:"2026-01-05T00:00:00Z",locked_winner:"France"},
      6:{id:6,name:"Eve",    email:"eve@demo.com",     password:"eve",     phone:"+44-7700-0002", is_admin:false,has_paid:true, created_at:"2026-01-06T00:00:00Z",locked_winner:"Germany"},
      7:{id:7,name:"Frank",  email:"frank@demo.com",   password:"frank",   phone:"+44-7700-0003", is_admin:false,has_paid:false,created_at:"2026-01-07T00:00:00Z",locked_winner:"Brazil"},
      8:{id:8,name:"Grace",  email:"grace@demo.com",   password:"grace",   phone:"+972-50-0001",  is_admin:false,has_paid:true, created_at:"2026-01-08T00:00:00Z",locked_winner:"Argentina"},
      9:{id:9,name:"Yaniv",  email:"yaniv@demo.com",   password:"yaniv",   phone:"+972-50-0002",  is_admin:false,has_paid:true, created_at:"2026-01-09T00:00:00Z",locked_winner:"France"},
    },
    entries:{
      // submitted_at = earliest stage submission (legacy fields kept for
      // back-compat). stages_submitted is the source of truth — a map of
      // stage_n -> iso date the user clicked Submit for THAT stage.
      "ea1":{id:"ea1",user_id:2,name:"Alice — main",     created_at:"2026-05-01T10:00:00Z",submitted_at:"2026-05-01T10:30:00Z",stages_submitted:{1:"2026-05-01T10:30:00Z"}},
      "ea2":{id:"ea2",user_id:2,name:"Alice — backup",   created_at:"2026-05-01T10:15:00Z",submitted_at:"2026-05-01T10:45:00Z",stages_submitted:{1:"2026-05-01T10:45:00Z"}},
      "eb1":{id:"eb1",user_id:3,name:"Bob — strategy A", created_at:"2026-05-01T11:00:00Z",submitted_at:"2026-05-01T11:30:00Z",stages_submitted:{1:"2026-05-01T11:30:00Z"}},
      "eb2":{id:"eb2",user_id:3,name:"Bob — strategy B", created_at:"2026-05-01T11:20:00Z",submitted_at:"2026-05-01T11:50:00Z",stages_submitted:{1:"2026-05-01T11:50:00Z"}},
      "ec1":{id:"ec1",user_id:4,name:"Charlie",          created_at:"2026-05-01T12:00:00Z",submitted_at:"2026-05-01T12:30:00Z",stages_submitted:{1:"2026-05-01T12:30:00Z"}},
      "ed1":{id:"ed1",user_id:5,name:"Diana",            created_at:"2026-05-01T13:00:00Z",submitted_at:"2026-05-01T13:30:00Z",stages_submitted:{1:"2026-05-01T13:30:00Z"}},
      "ee1":{id:"ee1",user_id:6,name:"Eve",              created_at:"2026-05-01T14:00:00Z",submitted_at:"2026-05-01T14:30:00Z",stages_submitted:{1:"2026-05-01T14:30:00Z"}},
      "ef1":{id:"ef1",user_id:7,name:"Frank",            created_at:"2026-05-01T15:00:00Z",submitted_at:"2026-05-01T15:30:00Z",stages_submitted:{1:"2026-05-01T15:30:00Z"}},
      "ef2":{id:"ef2",user_id:7,name:"Frank — copy",     created_at:"2026-05-01T16:00:00Z",submitted_at:"2026-05-01T16:30:00Z",stages_submitted:{1:"2026-05-01T16:30:00Z"}},
      "eg1":{id:"eg1",user_id:8,name:"Grace",            created_at:"2026-05-01T17:00:00Z",submitted_at:"2026-05-01T17:30:00Z",stages_submitted:{1:"2026-05-01T17:30:00Z"}},
      "ey1":{id:"ey1",user_id:9,name:"Yaniv — A",        created_at:"2026-05-01T18:00:00Z",submitted_at:"2026-05-01T18:30:00Z",stages_submitted:{1:"2026-05-01T18:30:00Z"}},
      "ey2":{id:"ey2",user_id:9,name:"Yaniv — B",        created_at:"2026-05-01T19:00:00Z",submitted_at:"2026-05-01T19:30:00Z",stages_submitted:{1:"2026-05-01T19:30:00Z"}},
    },
    predictions:{
      "ea1":genPreds(20001,1),
      "ea2":genPreds(20501,2),
      "eb1":genPreds(30001,2),
      "eb2":genPreds(30501,1),
      "ec1":genPreds(40001,3),
      "ed1":genPreds(50001,1),
      "ee1":genPreds(60001,2),
      "ef1":genPreds(70001,3),
      "ef2":genPreds(70501,2),
      "eg1":genPreds(80001,1),
      "ey1":genPreds(90001,1),
      "ey2":genPreds(90501,2),
    },
    winner_picks:{
      "ea1":"France","ea2":"Brazil",
      "eb1":"Argentina","eb2":"Spain",
      "ec1":"Brazil",
      "ed1":"France","ee1":"Germany",
      "ef1":"Brazil","ef2":"England",
      "eg1":"Argentina",
      "ey1":"France","ey2":"Argentina",
    },
    results:{...SEED_RESULTS},
    live:{...SEED_LIVE},
    next_user_id:10,
    next_entry_seq:20,
  };
}

// ── Fresh state (variant = "fresh") ──────────────────────────────────────────
// Pre-tournament: round is OPEN for group-stage predictions, no results, no
// submitted forms, no live matches. Same user roster — they just haven't bet
// yet, so the leaderboard is empty. Great for trying the full flow from the
// "first prediction" all the way to "admin enters results".
function buildFreshState() {
  const base = buildInitialState();
  return {
    ...base,
    config:{ round_state:"open", tournament_winner:null, data_source:"manual", current_stage:1 },
    // Same users + admin, but no entries yet
    users: base.users,
    entries: {},
    predictions: {},
    winner_picks: {},
    results: {},
    live: {},
    next_user_id: base.next_user_id,
    next_entry_seq: base.next_entry_seq,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────
// Two parallel demos: "current" (mid-tournament) and "fresh" (pre-tournament).
// Switch with window._switchDemo("fresh"|"current"). Each variant has its own
// localStorage slot, so flipping back and forth preserves whatever you did in
// each.
const VARIANT_KEY = "mb_demo_variant";
const STORAGE_KEYS = {
  current: "mb_demo_v8",
  fresh:   "mb_demo_v8_fresh",
};
function getVariant() {
  const v = localStorage.getItem(VARIANT_KEY);
  return (v === "fresh" || v === "current") ? v : "current";
}
function storageKeyForVariant(v) { return STORAGE_KEYS[v] || STORAGE_KEYS.current; }
function buildForVariant(v) { return v === "fresh" ? buildFreshState() : buildInitialState(); }

function loadState() {
  const v = getVariant();
  try { const s = localStorage.getItem(storageKeyForVariant(v)); if (s) return JSON.parse(s); } catch{}
  return buildForVariant(v);
}
function save(s) {
  try { localStorage.setItem(storageKeyForVariant(getVariant()), JSON.stringify(s)); } catch{}
}

// Row counts for a backup payload / state slice, keyed to match the production
// /api/admin/backup `counts` (so the admin UI preview reads the same in both
// modes). `src` may be a raw state ({users,preds,...}) or a backup's `.data`.
function countsOf(src) {
  const predictions = Object.values(src.predictions || {})
    .reduce((n, p) => n + Object.keys(p || {}).length, 0);
  return {
    users:        Object.keys(src.users        || {}).length,
    entries:      Object.keys(src.entries      || {}).length,
    predictions,
    winner_picks: Object.keys(src.winner_picks || {}).length,
    results:      Object.keys(src.results      || {}).length,
    live_matches: Object.keys(src.live         || {}).length,
    game_config:  1,
  };
}

let S = loadState();

// One-time backfill (mirrors app/main.py): forms cleanly submitted for the
// CURRENT stage get a submitted_snapshot from their current predictions+winner.
// Forms mid-edit (submitted then edited → stage flag cleared) are skipped, so
// their draft flow only starts at the next submit. Idempotent — only fills
// entries that have no snapshot yet.
function backfillSnapshots(state) {
  if (!state || !state.entries) return;
  const stage = String((state.config && state.config.current_stage) || 1);
  let changed = false;
  for (const e of Object.values(state.entries)) {
    if (e.submitted_snapshot) continue;
    if (!e.submitted_at) continue;
    if (!(e.stages_submitted && e.stages_submitted[stage])) continue; // skip drafts
    const preds = state.predictions[e.id] || {};
    e.submitted_snapshot = {
      at: e.submitted_at,
      winner: state.winner_picks[e.id] || null,
      preds: Object.fromEntries(
        Object.entries(preds)
          .filter(([,p]) => p[0] != null && p[1] != null)
          .map(([n,p]) => [String(n), [p[0], p[1]]])
      ),
    };
    changed = true;
  }
  if (changed) save(state);
}
backfillSnapshots(S);

window._resetDemo = () => {
  ["mb_demo_v1","mb_demo_v2","mb_demo_v3","mb_demo_v4","mb_demo_v5","mb_demo_v5_fresh","mb_demo_v6","mb_demo_v6_fresh","mb_demo_v7","mb_demo_v7_fresh","mb_demo_v8","mb_demo_v8_fresh","wc2026_token","mb_demo_variant"].forEach(k=>localStorage.removeItem(k));
  location.reload();
};
window._switchDemo = (variant) => {
  if (variant !== "fresh" && variant !== "current") {
    console.warn('Use _switchDemo("fresh") or _switchDemo("current")');
    return;
  }
  localStorage.setItem(VARIANT_KEY, variant);
  // Drop auth so the variant change is visible (different users may be
  // already logged in across variants).
  localStorage.removeItem("wc2026_token");
  location.reload();
};

console.log('%c🎮 MondoBet — Demo Mode (no server needed)', 'color:#a3e635;font-size:13px;font-weight:bold');
console.log('Active variant: ' + getVariant().toUpperCase() + ' · switch with window._switchDemo("fresh"|"current")');
console.log('Accounts: admin/admin · alice · bob · charlie · diana · eve · frank · grace · yaniv (password = name)');
if (getVariant() === "current") {
  console.log('Stage 1: Group Stage (72 matches) ✓ · Stage 2: Round of 32 in progress (8/16 results entered)');
} else {
  console.log('Fresh start: round OPEN, no results, no submitted forms. Stage 1 ready for predictions.');
}
console.log('Call window._resetDemo() to wipe all data and restart.');

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
  return {id:u.id,name:u.name,email:u.email,phone:u.phone||"",is_admin:u.is_admin,has_paid:u.has_paid,locked_winner:u.locked_winner||null,help_seen:u.help_seen||{}};
}
function entryOut(e) {
  return {id:e.id,name:e.name,created_at:e.created_at,submitted_at:e.submitted_at||null,stages_submitted:e.stages_submitted||{},submitted_snapshot_at:(e.submitted_snapshot||{}).at||null};
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
// `resultsOverride` (optional) merges with real results — used by simulate mode
// to treat the caller's predictions as ground truth for unplayed games.
// `tournamentWinnerOverride` lets simulate also assume a winner pick.
function computeLeaderboard(resultsOverride=null, tournamentWinnerOverride=null, simUserId=null) {
  const roundOpen = S.config.round_state === "open";
  const simResults = resultsOverride ? {...S.results, ...resultsOverride} : S.results;
  const simWinner  = tournamentWinnerOverride ?? S.config.tournament_winner;
  // Spotlight matches for the "Match picks" columns: in-play games while any are
  // live, otherwise the most-recently-finished game(s) (kept until the next
  // match starts). Mirrors crud.get_leaderboard. ISO kickoff strings sort
  // lexicographically.
  const liveNs = Object.keys(S.live).filter(n=>S.live[n]&&S.live[n].is_live).map(Number);
  let spotlightNs;
  if (liveNs.length) {
    spotlightNs = new Set(liveNs);
  } else {
    const ko = Object.fromEntries(MATCHES.map(m=>[m.n,m.t||""]));
    const finished = Object.keys(S.results).map(Number);
    if (finished.length) {
      const latest = finished.reduce((mx,n)=>{const t=ko[n]||"";return t>mx?t:mx;},"");
      spotlightNs = new Set(latest ? finished.filter(n=>(ko[n]||"")===latest) : []);
    } else spotlightNs = new Set();
  }
  const rows = [];
  for (const user of Object.values(S.users)) {
    if (user.is_admin) continue;
    // Privacy: while the round is open, only apply the simulated results to the
    // simulating user's own forms — others stay at their real visible totals so
    // simulating can't reveal rivals' standings on a still-open stage. Once the
    // round is closed, the sim applies to everyone.
    const applySim = !!resultsOverride && (!roundOpen || user.id === simUserId);
    const effectiveResults = applySim ? simResults : S.results;
    const effectiveWinner   = applySim ? simWinner  : S.config.tournament_winner;
    for (const entry of Object.values(S.entries).filter(e=>e.user_id===user.id&&e.submitted_at)) {
      const preds = S.predictions[entry.id]||{};
      const wp    = S.winner_picks[entry.id]||null;
      const t     = calcTotals(preds,effectiveResults,S.live,wp,effectiveWinner);
      const filled = Object.values(preds).filter(p=>p[0]!=null&&p[1]!=null).length;
      // This form's picks for the spotlight matches (opt-in "Match picks"
      // columns). Only fully-filled picks are included.
      const spotlightPreds = {};
      for (const n of spotlightNs) {
        const p = preds[n];
        if (p && p[0]!=null && p[1]!=null) spotlightPreds[n] = [p[0],p[1]];
      }
      rows.push({
        entry_id:entry.id, user_id:user.id, name:entry.name,
        total:t.total, exact:t.exact, correct_dir:t.correct_dir,
        scored_matches:t.scored_matches, winner_pick:wp, winner_bonus:t.winner_bonus,
        has_paid:user.has_paid, submitted_count:filled,
        live_points:t.live_points, live_matches_count:t.live_matches_count,
        spotlight_preds:spotlightPreds,
      });
    }
  }
  return rows.sort((a,b)=>b.total-a.total);
}

// ── Admin participants computation ───────────────────────────────────────────
function computeAdminParticipants() {
  const matchStageLookup = Object.fromEntries(MATCHES.map(m=>[m.n,m.s]));
  const stageTotals = {};
  for (const m of MATCHES) stageTotals[m.s] = (stageTotals[m.s]||0) + 1;
  return Object.values(S.users).filter(u=>!u.is_admin).map(user=>{
    const userEntries = Object.values(S.entries)
      .filter(e=>e.user_id===user.id)
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    const entriesData = userEntries.map(e=>{
      const preds = S.predictions[e.id]||{};
      const wp    = S.winner_picks[e.id]||null;
      const filled = Object.values(preds).filter(p=>p[0]!=null&&p[1]!=null).length;
      // Per-stage filled counts
      const stageFilled = Object.fromEntries(Object.keys(stageTotals).map(s=>[s,0]));
      for (const [n,p] of Object.entries(preds)) {
        if (p[0]==null||p[1]==null) continue;
        const s = matchStageLookup[Number(n)];
        if (s!=null) stageFilled[s] = (stageFilled[s]||0) + 1;
      }
      let points=null,livePoints=0;
      if (e.submitted_at) {
        const t=calcTotals(preds,S.results,S.live,wp,S.config.tournament_winner);
        points=t.total; livePoints=t.live_points;
      }
      return {id:e.id,name:e.name,submitted_at:e.submitted_at||null,stages_submitted:e.stages_submitted||{},stage_filled:stageFilled,stage_totals:stageTotals,filled,total_matches:MATCHES.length,winner_pick:wp,locked_winner:user.locked_winner||null,points,live_points:livePoints};
    });
    const submittedCount = userEntries.filter(e=>e.submitted_at).length;
    const draftCount = userEntries.length - submittedCount;
    const bestTotal = Math.max(0,...entriesData.filter(e=>e.points!=null).map(e=>e.points),0);
    return {id:user.id,name:user.name,email:user.email,phone:user.phone||"",has_paid:user.has_paid,locked_winner:user.locked_winner||null,entries:entriesData,submitted_count:submittedCount,draft_count:draftCount,best_total:bestTotal};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}

// ── API ───────────────────────────────────────────────────────────────────────
export const api = {
  // ── Auth
  signup: async (d) => {
    await delay();
    const email = d.email.trim().toLowerCase();
    if (Object.values(S.users).find(u=>u.email===email)) throw new Error("Email already registered.");
    if (!d.phone||d.phone.trim().length<7) throw new Error("Phone number is required.");
    const id = S.next_user_id++;
    const user = {id,name:d.name.trim(),email,phone:d.phone.trim(),password:d.password,is_admin:false,has_paid:false,created_at:new Date().toISOString(),locked_winner:null};
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
  getResults:     async () => { await delay(30); return Object.entries(S.results).map(([n,r])=>({match_n:Number(n),score_a:r[0],score_b:r[1],winner:r[2]??null,et_a:r[3]??null,et_b:r[4]??null,pen_a:r[5]??null,pen_b:r[6]??null})); },
  getLeaderboard: async () => { await delay(50); return computeLeaderboard(); },
  // resultsOverride: { [match_n]: [score_a, score_b] }
  // winnerOverride: team name (string) — assume tournament winner for sim
  getSimulatedLeaderboard: async (resultsOverride, winnerOverride=null) => {
    await delay(50);
    const u = getUser();
    return computeLeaderboard(resultsOverride||null, winnerOverride, u?.id ?? null);
  },

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
    let name = d?.name?.trim();
    if (name) {
      // Explicit name: reject if it collides with an existing form
      if (names.includes(name)) throw new Error(`You already have a form named '${name}'.`);
    } else {
      // Auto-name: start with the user's name, then user 2, user 3, ...
      name = user.name;
      let n = 2;
      while (names.includes(name)) name = `${user.name} ${n++}`;
    }
    const eid = `entry-u${user.id}-${++S.next_entry_seq}`;
    const entry = {id:eid,user_id:user.id,name,created_at:new Date().toISOString(),submitted_at:null};
    S.entries[eid] = entry;
    const srcId = d?.copy_from_entry_id;
    if (srcId && S.entries[srcId]?.user_id === user.id) {
      // Copying inherits the source's predictions and winner pick
      S.predictions[eid] = {...(S.predictions[srcId]||{})};
      if (S.winner_picks[srcId]) S.winner_picks[eid] = S.winner_picks[srcId];
    } else {
      // Brand-new empty form: blank predictions, NO winner pre-selected
      S.predictions[eid] = {};
    }
    save(S);
    return entryOut(entry);
  },

  renameEntry: async (id, d) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry||entry.user_id!==user.id) throw new Error("Entry not found");
    // Form name follows the winner-pick lock: editable only while stage 1 is
    // the open betting stage; frozen once round 1 has started.
    if (S.config.round_state !== "open") throw new Error("Round is not open");
    if ((S.config.current_stage || 1) > 1) throw new Error("Form name locked — stage 1 has closed");
    const newName = d.name.trim();
    if (!newName) throw new Error("Name required");
    // Reject if another form of this user already uses that name
    const taken = Object.values(S.entries)
      .some(e => e.user_id === user.id && e.id !== id && e.name === newName);
    if (taken) throw new Error(`You already have a form named '${newName}'.`);
    entry.name = newName;
    save(S);
    return entryOut(entry);
  },

  deleteEntry: async (id) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry || (entry.user_id !== user.id && !user.is_admin)) throw new Error("Entry not found");
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
    const stage = S.config.current_stage || 1;
    if (!entry.stages_submitted) entry.stages_submitted = {};
    // A form that missed the stage-1 submission deadline becomes inactive —
    // it cannot submit any subsequent stage.
    if (stage > 1 && !entry.stages_submitted["1"]) {
      throw new Error("This form didn't submit stage 1 before it closed — it's no longer active.");
    }
    // Re-submission is allowed — the timestamp simply updates. Users can
    // edit their predictions after Submit, which clears the stage flag in
    // setPrediction; then they click Submit again to re-confirm.
    // Verify all CURRENT-STAGE matches (without admin result/live) are filled
    const stageMatches = MATCHES.filter(m => m.s === stage && !S.results[m.n] && !S.live[m.n]);
    const preds = S.predictions[id]||{};
    const missing = stageMatches.filter(m => preds[m.n]?.[0] == null || preds[m.n]?.[1] == null);
    if (missing.length > 0) throw new Error(`Fill all ${stageMatches.length} stage ${stage} predictions first (${stageMatches.length-missing.length} done)`);
    if (stage === 1 && !S.winner_picks[id]) throw new Error("Set a tournament winner pick first");
    const now = new Date().toISOString();
    entry.stages_submitted[stage] = now;
    if (!entry.submitted_at) entry.submitted_at = now;
    // Snapshot the just-submitted state, for "Reset draft" (overwrites each submit).
    entry.submitted_snapshot = {
      at: now,
      winner: S.winner_picks[id] || null,
      preds: Object.fromEntries(
        Object.entries(preds)
          .filter(([,p]) => p[0] != null && p[1] != null)
          .map(([n,p]) => [String(n), [p[0], p[1]]])
      ),
    };
    save(S);
    return entryOut(entry);
  },

  resetDraft: async (id) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry || entry.user_id !== user.id) throw new Error("Entry not found");
    if (!entry.submitted_snapshot) throw new Error("Nothing to reset — no submission to restore.");
    if (S.config.round_state !== "open") throw new Error("Betting round is not open.");
    const snap = entry.submitted_snapshot;
    // Restore predictions to exactly the snapshot.
    const np = {};
    for (const [n,sc] of Object.entries(snap.preds || {})) {
      if (sc && sc[0] != null && sc[1] != null) np[Number(n)] = [sc[0], sc[1]];
    }
    S.predictions[id] = np;
    // Restore winner.
    if (snap.winner) S.winner_picks[id] = snap.winner; else delete S.winner_picks[id];
    // Back to submitted: re-mark the current stage with the snapshot's timestamp.
    const stage = S.config.current_stage || 1;
    entry.stages_submitted = entry.stages_submitted || {};
    entry.stages_submitted[stage] = snap.at || new Date().toISOString();
    save(S);
    return {
      entry: entryOut(entry),
      predictions: Object.entries(np).map(([n,p])=>({match_n:Number(n),score_a:p[0],score_b:p[1]})),
      winner: snap.winner || null,
    };
  },

  getEntryPreds: async (id) => {
    await delay();
    const user = requireUser();
    const entry = S.entries[id];
    if (!entry) throw new Error("Entry not found");
    const viewingOwn = entry.user_id === user.id;
    // Admin or own: see all. Others: see all if submitted.
    if (!user.is_admin && !viewingOwn && !entry.submitted_at) return [];
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
    const match = MATCHES.find(m => m.n === Number(matchN));
    if (!match) throw new Error("Unknown match");
    if (match.s !== S.config.current_stage) {
      throw new Error("This stage is closed for predictions");
    }
    if (S.results[matchN]) throw new Error("Match already has a result");
    if (S.live[matchN])    throw new Error("Match is live — cannot edit");
    const entryRef = S.entries[eid];
    if ((S.config.current_stage||1) > 1 && !(entryRef?.stages_submitted||{})["1"]) {
      throw new Error("This form didn't submit stage 1 before it closed — it's no longer active.");
    }
    if (!S.predictions[eid]) S.predictions[eid] = {};
    S.predictions[eid][matchN] = [d.score_a, d.score_b];
    // Editing invalidates THIS stage's submission on THIS form — the user
    // has to re-click Submit to confirm. Other stages are unaffected.
    const entry = S.entries[eid];
    if (entry && entry.stages_submitted) {
      delete entry.stages_submitted[match.s];
      delete entry.stages_submitted[String(match.s)];
    }
    save(S);
    return {match_n:matchN,score_a:d.score_a,score_b:d.score_b};
  },

  // Bulk set (CSV import / random fill) — mirrors the backend bulk endpoint.
  setPredictionsBulk: async (preds, entryId) => {
    await delay(40);
    const user = requireUser();
    if (S.config.round_state !== "open") throw new Error("Round is not open");
    const eid = resolveEntryId(user, entryId);
    if (!eid) throw new Error("No entry");
    const cur = S.config.current_stage || 1;
    const entryRef = S.entries[eid];
    if (cur > 1 && !(entryRef?.stages_submitted || {})["1"]) {
      throw new Error("This form didn't submit stage 1 before it closed — it's no longer active.");
    }
    if (!S.predictions[eid]) S.predictions[eid] = {};
    let written = 0; const affected = new Set();
    for (const p of (preds || [])) {
      const match = MATCHES.find(m => m.n === Number(p.match_n));
      if (!match || match.s !== cur) continue;
      if (S.results[p.match_n] || S.live[p.match_n]) continue;
      S.predictions[eid][p.match_n] = [p.score_a, p.score_b];
      affected.add(match.s);
      written++;
    }
    if (written && entryRef && entryRef.stages_submitted) {
      affected.forEach(st => { delete entryRef.stages_submitted[st]; delete entryRef.stages_submitted[String(st)]; });
    }
    save(S);
    return { written, skipped: (preds || []).length - written };
  },

  setWinnerPick: async (d, entryId) => {
    await delay(30);
    const user = requireUser();
    if (S.config.round_state !== "open") throw new Error("Round is not open");
    // Winner pick is editable while stage 1 is the current open stage.
    // Once admin advances past stage 1, the pick is implicitly locked.
    if ((S.config.current_stage || 1) > 1) throw new Error("Winner pick locked — stage 1 has closed");
    const eid = resolveEntryId(user,entryId);
    if (!eid) throw new Error("No entry");
    if (d.team) S.winner_picks[eid] = d.team;
    else delete S.winner_picks[eid];
    // Winner pick lives in stage 1 — changing it invalidates the stage 1
    // submission on this form, so the user must re-Submit (mirrors scores).
    const entry = S.entries[eid];
    if (entry && entry.stages_submitted) {
      delete entry.stages_submitted[1];
      delete entry.stages_submitted["1"];
    }
    save(S);
    return {entry_id:eid,team:d.team||null};
  },

  getUserPredictions: async (uid, entryId) => {
    await delay();
    const caller = getUser();
    if (!caller) throw new Error("Not authenticated");
    const eid = entryId || Object.values(S.entries)
      .filter(e=>e.user_id===Number(uid)&&e.submitted_at)
      .sort((a,b)=>new Date(a.submitted_at)-new Date(b.submitted_at))[0]?.id;
    if (!eid) return [];
    const entry = S.entries[eid];
    const allPreds = Object.entries(S.predictions[eid]||{}).map(([n,p])=>({match_n:Number(n),score_a:p[0],score_b:p[1]}));
    // Admin or own entry: all predictions always.
    // Other user: all predictions except the current open stage while round is open.
    const viewingOwn = Number(uid) === caller.id;
    if (!caller.is_admin && !viewingOwn && !entry?.submitted_at) return [];
    if (!caller.is_admin && !viewingOwn && S.config.round_state === "open") {
      const openStage = S.config.current_stage || 1;
      return allPreds.filter(p => {
        const m = MATCHES.find(x => x.n === p.match_n);
        return m && m.s !== openStage;
      });
    }
    return allPreds;
  },

  // Every submitted form's pick for one match — {entry_id: [a,b]} (privacy-gated)
  getMatchPredictions: async (n) => {
    await delay();
    const caller = getUser();
    if (!caller) throw new Error("Not authenticated");
    const mn = Number(n);
    if (!caller.is_admin && S.config.round_state === "open") {
      const m = MATCHES.find(x => x.n === mn);
      if (m && m.s === (S.config.current_stage || 1)) return {};
    }
    const out = {};
    for (const entry of Object.values(S.entries)) {
      if (!entry.submitted_at) continue;
      const p = (S.predictions[entry.id] || {})[mn];
      if (p && p[0] != null && p[1] != null) out[entry.id] = [p[0], p[1]];
    }
    return out;
  },

  // ── Admin
  updateConfig: async (d) => {
    await delay();
    requireAdmin();
    if (d.round_state !== undefined) S.config.round_state = d.round_state;
    if ("tournament_winner" in d) S.config.tournament_winner = d.tournament_winner||null;
    if (d.data_source !== undefined) S.config.data_source = d.data_source;
    if (d.current_stage !== undefined && d.current_stage !== null) {
      // Stage advanced — snapshot current standings (end of the finishing
      // stage) as the baseline for per-stage rank movement.
      if (d.current_stage > (S.config.current_stage || 1)) {
        const lb = computeLeaderboard();
        const ranks = {};
        lb.forEach((row, i) => { ranks[row.entry_id] = i + 1; });
        S.config.stage_baseline = { stage: d.current_stage, ranks };
      }
      S.config.current_stage = d.current_stage;
    }
    save(S);
    return S.config;
  },

  setResult: async (n, d) => {
    await delay();
    requireAdmin();
    if (d.score_a!=null&&d.score_b!=null) {
      const w = deriveWinner(d.score_a,d.score_b,d.et_a,d.et_b,d.pen_a,d.pen_b);
      S.results[n]=[d.score_a,d.score_b,w,d.et_a??null,d.et_b??null,d.pen_a??null,d.pen_b??null];
      delete S.live[n];
      maybeCrownChampion(n);
      save(S);
      return {match_n:n,...d,winner:w};
    }
    delete S.results[n];
    save(S);
    return {match_n:n,...d};
  },

  // Admin testing helper: wipe every final result and every live record.
  // Predictions / entries / users / winner picks / config are untouched.
  resetAllResults: async () => {
    await delay();
    requireAdmin();
    const r = Object.keys(S.results).length;
    const l = Object.keys(S.live).length;
    S.results = {};
    S.live = {};
    save(S);
    return {deleted:{results:r, live:l}};
  },

  // Wipe entries/predictions/winner-picks. Scope: entryId > userId > all.
  resetUserData: async ({ userId, entryId } = {}) => {
    await delay();
    requireAdmin();
    let entries_deleted = 0;
    if (entryId) {
      // Single entry
      if (S.entries[entryId]) { delete S.entries[entryId]; entries_deleted = 1; }
      delete S.preds[entryId];
      delete S.winners[entryId];
    } else if (userId) {
      // All entries for one user
      for (const [eid, e] of Object.entries(S.entries)) {
        if (String(e.user_id) === String(userId)) {
          delete S.entries[eid]; delete S.preds[eid]; delete S.winners[eid];
          entries_deleted++;
        }
      }
      if (S.users[userId]) S.users[userId].locked_winner = null;
    } else {
      // All non-admin users
      for (const [eid, e] of Object.entries(S.entries)) {
        if (!S.users[e.user_id]?.is_admin) {
          delete S.entries[eid]; delete S.preds[eid]; delete S.winners[eid];
          entries_deleted++;
        }
      }
      for (const uid of Object.keys(S.users)) {
        if (!S.users[uid].is_admin) S.users[uid].locked_winner = null;
      }
      S.config.round_state = "idle";
      S.config.current_stage = 1;
      S.config.tournament_winner = null;
    }
    save(S);
    return {entries_deleted};
  },

  // Delete user(s) + their data. Scope: userId > all.
  resetFullSystem: async ({ userId } = {}) => {
    await delay();
    requireAdmin();
    if (userId) {
      if (S.users[userId]?.is_admin) throw new Error("Cannot delete admin");
      // Remove entries/preds/winners for this user
      for (const [eid, e] of Object.entries(S.entries)) {
        if (String(e.user_id) === String(userId)) {
          delete S.entries[eid]; delete S.preds[eid]; delete S.winners[eid];
        }
      }
      delete S.users[userId];
      save(S);
      return {users_deleted: 1};
    }
    // Nuclear
    let users_deleted = 0;
    for (const uid of Object.keys(S.users)) {
      if (!S.users[uid].is_admin) { delete S.users[uid]; users_deleted++; }
    }
    const results_deleted = Object.keys(S.results).length;
    const live_deleted    = Object.keys(S.live).length;
    S.entries = {}; S.preds = {}; S.winners = {};
    S.results = {}; S.live = {};
    S.config.round_state = "idle";
    S.config.current_stage = 1;
    S.config.tournament_winner = null;
    save(S);
    return {users_deleted, results_deleted, live_deleted};
  },

  // ── Backup / restore (admin) ──────────────────────────────────────────────
  // Mirrors the production /api/admin endpoints. Returns the SAME envelope
  // shape ({version, created_at, counts, data}) so the admin UI behaves
  // identically; only the `data` internals differ (demo's in-memory keyed
  // objects vs. the backend's table arrays). `demo:true` lets the UI warn if
  // someone tries to cross-restore a demo file into production.
  adminBackup: async () => {
    await delay();
    requireAdmin();
    // Snapshot the WHOLE in-memory state (users, entries, predictions,
    // winner_picks, results, live, config, next_*_id counters) so a restore is
    // byte-for-byte faithful — don't cherry-pick keys.
    const data = JSON.parse(JSON.stringify(S));
    return {
      version: 1,
      created_at: new Date().toISOString(),
      counts: countsOf(data),
      data,
      demo: true,
    };
  },

  adminRestore: async (payload) => {
    await delay();
    requireAdmin();
    if (!payload || typeof payload !== "object") throw new Error("Invalid backup: not an object");
    if (payload.version !== 1) throw new Error("Unsupported backup version (expected 1)");
    const data = payload.data;
    if (!data || typeof data !== "object") throw new Error("Invalid backup: missing 'data'");
    if (!data.users || !data.config) {
      throw new Error("This file isn't a demo backup — restore demo backups in demo mode.");
    }
    S = JSON.parse(JSON.stringify(data));
    // Guarantee the demo admin can still log in after any restore.
    if (!S.users || !Object.values(S.users).some(u => u.is_admin)) {
      S.users = S.users || {};
      S.users[1] = {id:1,name:"Admin",email:"admin",password:"admin",phone:"",
                    is_admin:true,has_paid:false,created_at:new Date().toISOString(),locked_winner:null};
    }
    save(S);
    return {ok:true, restored: countsOf(S)};
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

  setHelpSeen: async (m) => {
    await delay(30);
    const user = requireUser();
    // Normalize: keep only truthy string keys.
    const cleaned = {};
    for (const [k, v] of Object.entries(m || {})) {
      if (v && typeof k === "string") cleaned[k] = true;
    }
    user.help_seen = cleaned;
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
// Two-bit state per match record in S.live[n]:
//   {score_a, score_b, minute, is_live}
// `is_live` distinguishes "scores saved, ranking updated" (false) from
// "shown to users as LIVE NOW" (true). Set defaults to false unless the
// caller explicitly passes is_live=true, or unless the record already had
// is_live=true (preserve admin's previous LIVE toggle).
export const liveApi = {
  getAll: async () => {
    await delay(30);
    return Object.entries(S.live).map(([n,ld])=>({match_n:Number(n),...ld}));
  },
  set: async (n, d) => {
    await delay();
    requireAdmin();
    const prev = S.live[Number(n)];
    const isLive = d.is_live !== undefined ? !!d.is_live : !!(prev && prev.is_live);
    // PATCH semantics: only override et/pen when explicitly provided
    const etA  = d.et_a  !== undefined ? d.et_a  : (prev?.et_a  ?? null);
    const etB  = d.et_b  !== undefined ? d.et_b  : (prev?.et_b  ?? null);
    const penA = d.pen_a !== undefined ? d.pen_a : (prev?.pen_a ?? null);
    const penB = d.pen_b !== undefined ? d.pen_b : (prev?.pen_b ?? null);
    const sa = d.score_a ?? prev?.score_a ?? 0;
    const sb = d.score_b ?? prev?.score_b ?? 0;
    S.live[Number(n)] = {
      score_a: sa, score_b: sb,
      minute: d.minute ?? (prev?.minute || 0),
      is_live: isLive,
      et_a: etA, et_b: etB, pen_a: penA, pen_b: penB,
      winner: deriveWinner(sa, sb, etA, etB, penA, penB),
    };
    save(S);
    return {match_n:Number(n),...S.live[Number(n)]};
  },
  markLive: async (n) => {
    await delay();
    requireAdmin();
    const prev = S.live[Number(n)] || {score_a:0,score_b:0,minute:0};
    S.live[Number(n)] = {...prev, is_live:true};
    save(S);
    return {match_n:Number(n),...S.live[Number(n)]};
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
    if (!ld) throw new Error("Match has no score yet");
    const w = deriveWinner(ld.score_a, ld.score_b, ld.et_a, ld.et_b, ld.pen_a, ld.pen_b);
    S.results[Number(n)] = [ld.score_a, ld.score_b, w, ld.et_a??null, ld.et_b??null, ld.pen_a??null, ld.pen_b??null];
    delete S.live[Number(n)];
    maybeCrownChampion(Number(n));
    save(S);
    return {match_n:Number(n),score_a:ld.score_a,score_b:ld.score_b,winner:w,et_a:ld.et_a??null,et_b:ld.et_b??null,pen_a:ld.pen_a??null,pen_b:ld.pen_b??null};
  },
};

// ── Init (bootstrap) ─────────────────────────────────────────────────────────
// Read-only helper for the UI: which demo variant is currently active.
export const demoVariantApi = {
  get: () => getVariant(),
  set: (v) => window._switchDemo(v),  // reloads
};

export const initApi = {
  load: async () => {
    await delay(80);
    const user = getUser();
    const leaderboard = computeLeaderboard();
    const resultsArr = Object.entries(S.results).map(([n,r])=>({match_n:Number(n),score_a:r[0],score_b:r[1],winner:r[2]??null,et_a:r[3]??null,et_b:r[4]??null,pen_a:r[5]??null,pen_b:r[6]??null}));
    const liveArr = Object.entries(S.live).map(([n,ld])=>({match_n:Number(n),...ld,winner:ld.winner??null}));

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
          stages_submitted: e.stages_submitted || {},
          submitted_snapshot_at:(e.submitted_snapshot||{}).at||null,
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

  getGroupStats: async (stage) => {
    await delay();
    if (!getUser()) throw new Error("Not authenticated");
    // Aggregate predictions across all submitted entries
    const freq = {};
    Object.values(S.entries).forEach(entry => {
      if (!entry.submitted_at) return;
      const preds = S.predictions[entry.id] || {};
      Object.values(preds).forEach(p => {
        if (p && p[0] != null && p[1] != null) {
          const [lo, hi] = [Math.min(p[0], p[1]), Math.max(p[0], p[1])];
          const k = `${lo}:${hi}`; freq[k] = (freq[k] || 0) + 1;
        }
      });
    });
    const top3 = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([score, count]) => ({ score, count }));
    return { top3_scores: top3 };
  },
};
