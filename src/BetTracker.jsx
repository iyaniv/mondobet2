import { useState, useEffect, useCallback } from "react";

// ── API helper ────────────────────────────────────────────────────────────────
// In dev, Vite proxies /api → http://localhost:8000
// On Vercel, /api routes go to the serverless function directly
const API = "";

async function apiFetch(path, options = {}) {
  const { body, ...rest } = options;
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...rest,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SPORTS = [
  "⚽ Football", "🏀 Basketball", "🎾 Tennis", "🏈 American Football",
  "⚾ Baseball", "🏒 Hockey", "🥊 Boxing / MMA", "🏇 Horse Racing", "🎱 Other",
];
const RESULTS = ["pending", "win", "loss", "void"];
const RESULT_STYLES = {
  pending: "bg-yellow-100 text-yellow-800",
  win: "bg-green-100 text-green-800",
  loss: "bg-red-100 text-red-800",
  void: "bg-gray-100 text-gray-600",
};
const RESULT_LABELS = {
  pending: "⏳ Pending",
  win: "✅ Win",
  loss: "❌ Loss",
  void: "↩️ Void",
};
const TABS = ["🏆", "📋", "➕", "👤"];
const TAB_LABELS = ["Leaderboard", "Bets", "Add Bet", "Players"];

const EMPTY_FORM = {
  player_id: "",
  description: "",
  sport: SPORTS[0],
  odds: "",
  stake: "",
  result: "pending",
  date: new Date().toISOString().slice(0, 10),
};

// ── Main component ────────────────────────────────────────────────────────────
export default function BetTracker() {
  const [tab, setTab] = useState(0);
  const [players, setPlayers] = useState([]);
  const [bets, setBets] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Players tab
  const [newPlayerName, setNewPlayerName] = useState("");
  const [playerError, setPlayerError] = useState("");

  // Bets tab filters
  const [filterPlayer, setFilterPlayer] = useState("");
  const [filterResult, setFilterResult] = useState("");

  // Add/edit form
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, b, lb] = await Promise.all([
        apiFetch("/api/players/"),
        apiFetch("/api/bets/"),
        apiFetch("/api/leaderboard/"),
      ]);
      setPlayers(p);
      setBets(b);
      setLeaderboard(lb);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Players ─────────────────────────────────────────────────────────────────
  async function addPlayer() {
    const name = newPlayerName.trim();
    if (!name) return;
    setPlayerError("");
    try {
      await apiFetch("/api/players/", { method: "POST", body: { name } });
      setNewPlayerName("");
      await loadAll();
    } catch (e) {
      setPlayerError(e.message);
    }
  }

  async function removePlayer(id) {
    try {
      await apiFetch(`/api/players/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  // ── Bets ────────────────────────────────────────────────────────────────────
  function startEdit(bet) {
    setForm({
      player_id: String(bet.player_id),
      description: bet.description,
      sport: bet.sport,
      odds: String(bet.odds),
      stake: String(bet.stake),
      result: bet.result,
      date: bet.date,
    });
    setEditingId(bet.id);
    setFormError("");
    setTab(2);
  }

  function cancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError("");
    setTab(1);
  }

  async function submitForm(e) {
    e.preventDefault();
    if (!form.player_id) return setFormError("Please select a player.");
    if (!form.description.trim()) return setFormError("Please enter a description.");
    if (!form.stake || Number(form.stake) <= 0) return setFormError("Please enter a valid stake.");
    if (!form.odds || Number(form.odds) < 1) return setFormError("Odds must be ≥ 1.");

    setSubmitting(true);
    setFormError("");
    try {
      const payload = {
        player_id: Number(form.player_id),
        description: form.description.trim(),
        sport: form.sport,
        odds: Number(form.odds),
        stake: Number(form.stake),
        result: form.result,
        date: form.date,
      };
      if (editingId) {
        await apiFetch(`/api/bets/${editingId}`, { method: "PATCH", body: payload });
        setEditingId(null);
      } else {
        await apiFetch("/api/bets/", { method: "POST", body: payload });
      }
      setForm({ ...EMPTY_FORM, player_id: form.player_id });
      await loadAll();
      setTab(1);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateResult(id, result) {
    try {
      await apiFetch(`/api/bets/${id}`, { method: "PATCH", body: { result } });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteBet(id) {
    try {
      await apiFetch(`/api/bets/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  // ── Filtered bets ───────────────────────────────────────────────────────────
  const filteredBets = bets
    .filter((b) => !filterPlayer || b.player_id === Number(filterPlayer))
    .filter((b) => !filterResult || b.result === filterResult);

  // ── Totals for header ───────────────────────────────────────────────────────
  const totalWins = bets.filter((b) => b.result === "win").length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">

      {/* ── Header ── */}
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-3 safe-top">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🎰 BetTracker</h1>
            <p className="text-slate-400 text-xs mt-0.5">
              {bets.length} bets · {totalWins} wins · {players.length} players
            </p>
          </div>
          <button
            onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setFormError(""); setTab(2); }}
            className="bg-emerald-600 active:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-xl"
          >
            + Add
          </button>
        </div>
      </div>

      {/* ── Global error banner ── */}
      {error && (
        <div className="bg-red-900 border-b border-red-700 px-4 py-2 text-sm text-red-200 flex justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="text-red-400 font-bold ml-2">✕</button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
          Loading…
        </div>
      )}

      {/* ── Main content ── */}
      {!loading && (
        <div className="max-w-2xl mx-auto px-4 py-5 pb-28">

          {/* ── LEADERBOARD ── */}
          {tab === 0 && (
            <div>
              <h2 className="text-base font-bold mb-3 text-slate-300">Overall Rankings</h2>
              {leaderboard.length === 0 && (
                <p className="text-slate-400 text-sm">No players yet. Add some in the Players tab.</p>
              )}
              <div className="space-y-3">
                {leaderboard.map((row, idx) => (
                  <div key={row.player_id} className="bg-slate-800 rounded-2xl p-4 border border-slate-700 flex items-center gap-3">
                    <div className="text-2xl w-9 text-center shrink-0">
                      {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : <span className="text-base text-slate-500 font-bold">#{idx + 1}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white truncate">{row.player_name}</div>
                      <div className="text-slate-400 text-xs mt-0.5">
                        {row.total_bets} bets · {row.win_rate}% win rate · {row.pending} pending
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-base font-bold ${row.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-400">{row.wins}W / {row.losses}L</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ALL BETS ── */}
          {tab === 1 && (
            <div>
              {/* Filters */}
              <div className="flex gap-2 mb-4 flex-wrap">
                <select
                  value={filterPlayer}
                  onChange={(e) => setFilterPlayer(e.target.value)}
                  className="bg-slate-700 border border-slate-600 text-white text-sm rounded-xl px-3 py-2 flex-1 min-w-0"
                >
                  <option value="">All Players</option>
                  {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select
                  value={filterResult}
                  onChange={(e) => setFilterResult(e.target.value)}
                  className="bg-slate-700 border border-slate-600 text-white text-sm rounded-xl px-3 py-2 flex-1 min-w-0"
                >
                  <option value="">All Results</option>
                  {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABELS[r]}</option>)}
                </select>
              </div>
              <p className="text-slate-500 text-xs mb-3">{filteredBets.length} bet{filteredBets.length !== 1 ? "s" : ""}</p>

              {filteredBets.length === 0 && (
                <p className="text-slate-400 text-sm">No bets match your filters.</p>
              )}

              <div className="space-y-3">
                {filteredBets.map((bet) => (
                  <div key={bet.id} className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
                    {/* Top row */}
                    <div className="flex items-start gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white text-sm leading-snug">{bet.description}</p>
                        <p className="text-slate-400 text-xs mt-1">{bet.sport} · {bet.player_name} · {bet.date}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap shrink-0 ${RESULT_STYLES[bet.result]}`}>
                        {RESULT_LABELS[bet.result]}
                      </span>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
                      <span>Stake <span className="text-white font-medium">{bet.stake}</span></span>
                      <span>·</span>
                      <span>Odds <span className="text-white font-medium">{bet.odds}</span></span>
                      <span>·</span>
                      <span>
                        {bet.result === "win" && <span className="text-emerald-400 font-medium">+{bet.net_return}</span>}
                        {bet.result === "loss" && <span className="text-red-400 font-medium">{bet.net_return}</span>}
                        {bet.result === "pending" && <span className="text-slate-300">→{bet.potential_return}</span>}
                        {bet.result === "void" && <span className="text-slate-400">Void</span>}
                      </span>
                    </div>

                    {/* Actions row */}
                    <div className="flex items-center gap-2">
                      <select
                        value={bet.result}
                        onChange={(e) => updateResult(bet.id, e.target.value)}
                        className="bg-slate-700 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 flex-1"
                      >
                        {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABELS[r]}</option>)}
                      </select>
                      <button
                        onClick={() => startEdit(bet)}
                        className="text-slate-400 active:text-white text-sm px-3 py-1.5 rounded-lg border border-slate-600 active:border-slate-400"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteBet(bet.id)}
                        className="text-slate-400 active:text-red-400 text-sm px-3 py-1.5 rounded-lg border border-slate-600 active:border-red-500"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ADD / EDIT BET ── */}
          {tab === 2 && (
            <div>
              <h2 className="text-base font-bold mb-4 text-slate-300">
                {editingId ? "✏️ Edit Bet" : "➕ Log a Bet"}
              </h2>
              <form onSubmit={submitForm} className="space-y-4">

                {/* Player */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Player *</label>
                  <select
                    value={form.player_id}
                    onChange={(e) => { setForm((f) => ({ ...f, player_id: e.target.value })); setFormError(""); }}
                    className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-3 text-sm"
                  >
                    <option value="">Select player…</option>
                    {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Bet Description *</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => { setForm((f) => ({ ...f, description: e.target.value })); setFormError(""); }}
                    placeholder="e.g. Arsenal to win vs Tottenham"
                    className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-3 text-sm placeholder-slate-500"
                  />
                </div>

                {/* Sport + Date */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Sport</label>
                    <select
                      value={form.sport}
                      onChange={(e) => setForm((f) => ({ ...f, sport: e.target.value }))}
                      className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-3 text-sm"
                    >
                      {SPORTS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Date</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-3 text-sm"
                    />
                  </div>
                </div>

                {/* Stake + Odds */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Stake *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={form.stake}
                      onChange={(e) => { setForm((f) => ({ ...f, stake: e.target.value })); setFormError(""); }}
                      placeholder="50"
                      min="0"
                      step="any"
                      className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-3 text-sm placeholder-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Odds *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={form.odds}
                      onChange={(e) => { setForm((f) => ({ ...f, odds: e.target.value })); setFormError(""); }}
                      placeholder="2.50"
                      min="1"
                      step="any"
                      className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-3 text-sm placeholder-slate-500"
                    />
                  </div>
                </div>

                {/* Result */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Result</label>
                  <div className="grid grid-cols-4 gap-2">
                    {RESULTS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, result: r }))}
                        className={`py-2 rounded-xl text-xs font-semibold border transition-colors ${
                          form.result === r
                            ? RESULT_STYLES[r] + " border-transparent"
                            : "border-slate-600 text-slate-400"
                        }`}
                      >
                        {RESULT_LABELS[r]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Potential return preview */}
                {form.stake && form.odds && Number(form.stake) > 0 && Number(form.odds) >= 1 && (
                  <div className="bg-slate-700 rounded-xl p-3 text-sm text-slate-300 flex justify-between">
                    <span>Potential return</span>
                    <span className="text-emerald-400 font-bold">
                      {(Number(form.stake) * Number(form.odds)).toFixed(2)}
                      <span className="text-slate-400 font-normal ml-1">
                        (+{(Number(form.stake) * Number(form.odds) - Number(form.stake)).toFixed(2)})
                      </span>
                    </span>
                  </div>
                )}

                {formError && <p className="text-red-400 text-sm">{formError}</p>}

                {/* Submit / Cancel */}
                <div className="flex gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 bg-emerald-600 active:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-sm"
                  >
                    {submitting ? "Saving…" : editingId ? "Save Changes" : "Log Bet"}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="px-4 py-3 border border-slate-600 text-slate-300 active:text-white rounded-xl text-sm"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* ── PLAYERS ── */}
          {tab === 3 && (
            <div>
              <h2 className="text-base font-bold mb-4 text-slate-300">👤 Players</h2>

              {/* Add player */}
              <div className="flex gap-2 mb-5">
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => { setNewPlayerName(e.target.value); setPlayerError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                  placeholder="Enter name…"
                  className="flex-1 bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-3 text-sm placeholder-slate-500"
                />
                <button
                  onClick={addPlayer}
                  className="bg-emerald-600 active:bg-emerald-700 text-white text-sm font-semibold px-5 py-3 rounded-xl"
                >
                  Add
                </button>
              </div>
              {playerError && <p className="text-red-400 text-sm mb-3">{playerError}</p>}

              <div className="space-y-2">
                {players.length === 0 && (
                  <p className="text-slate-400 text-sm">No players yet.</p>
                )}
                {players.map((p) => {
                  const stats = leaderboard.find((r) => r.player_id === p.id);
                  return (
                    <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-white text-sm truncate">{p.name}</p>
                        {stats && (
                          <p className="text-slate-400 text-xs mt-0.5">
                            {stats.total_bets} bets · {stats.wins}W / {stats.losses}L ·{" "}
                            <span className={stats.profit >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {stats.profit >= 0 ? "+" : ""}{stats.profit.toFixed(2)}
                            </span>
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => removePlayer(p.id)}
                        className="text-slate-500 active:text-red-400 text-sm shrink-0 px-2 py-1"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Bottom nav (mobile-first) ── */}
      <nav className="fixed bottom-0 inset-x-0 bg-slate-900 border-t border-slate-700 safe-bottom">
        <div className="max-w-2xl mx-auto grid grid-cols-4">
          {TABS.map((icon, i) => (
            <button
              key={i}
              onClick={() => { setTab(i); if (i !== 2) { setEditingId(null); setFormError(""); } }}
              className={`flex flex-col items-center justify-center py-3 gap-0.5 text-xs font-medium transition-colors ${
                tab === i ? "text-emerald-400" : "text-slate-500"
              }`}
            >
              <span className="text-xl leading-none">{icon}</span>
              <span>{TAB_LABELS[i]}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
