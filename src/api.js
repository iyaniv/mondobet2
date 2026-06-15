/**
 * API client for WC2026 Predictions.
 * Token is persisted in localStorage so the user stays logged in on refresh.
 */

const API = "";

let _token = localStorage.getItem("wc2026_token") || null;

export function setToken(t) {
  _token = t;
  if (t) localStorage.setItem("wc2026_token", t);
  else localStorage.removeItem("wc2026_token");
}

export function getToken() {
  return _token;
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const { body, ...rest } = options;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // Auth
  signup:        (d) => request("/api/auth/signup",         { method: "POST", body: d }),
  login:         (d) => request("/api/auth/login",          { method: "POST", body: d }),
  resetPassword: (d) => request("/api/auth/reset-password", { method: "POST", body: d }),
  me:            ()  => request("/api/auth/me"),

  // Game data (public-ish)
  getMatches:     () => request("/api/matches/"),
  getConfig:      () => request("/api/config/"),
  getResults:     () => request("/api/results/"),
  getLeaderboard: () => request("/api/leaderboard/"),
  // Simulated leaderboard: unplayed matches resolve to `resultsOverride`
  // ({matchN:[a,b]}) and, if no champion is set yet, `winnerOverride` is
  // assumed to win. Recomputes every user's score server-side.
  getSimulatedLeaderboard: (resultsOverride, winnerOverride = null) =>
    request("/api/leaderboard/simulate", {
      method: "POST",
      body: { results: resultsOverride || {}, winner: winnerOverride },
    }),

  // Entries (multi-form per user)
  getMyEntries:  ()         => request("/api/entries/me"),
  createEntry:   (d)        => request("/api/entries/",      { method: "POST",   body: d || {} }),
  renameEntry:   (id, d)    => request(`/api/entries/${id}`, { method: "PATCH",  body: d }),
  deleteEntry:   (id)       => request(`/api/entries/${id}`, { method: "DELETE" }),
  submitEntry:   (id)       => request(`/api/entries/${id}/submit`, { method: "POST" }),
  resetDraft:    (id)       => request(`/api/entries/${id}/reset-draft`, { method: "POST" }),
  getEntryPreds: (id)       => request(`/api/entries/${id}/predictions`),

  // Predictions — pass entryId to target a specific entry
  getMyPredictions: (entryId) =>
    request(`/api/predictions/me${entryId ? `?entry_id=${entryId}` : ""}`),
  setPrediction: (n, d, entryId) =>
    request(`/api/predictions/${n}${entryId ? `?entry_id=${entryId}` : ""}`, { method: "PUT", body: d }),
  // Bulk set (CSV import / random fill) — one request, one transaction.
  // preds: [{match_n, score_a, score_b}]
  setPredictionsBulk: (preds, entryId) =>
    request(`/api/predictions/me/bulk${entryId ? `?entry_id=${entryId}` : ""}`, { method: "PUT", body: { predictions: preds } }),
  setWinnerPick: (d, entryId) =>
    request(`/api/predictions/winner/me${entryId ? `?entry_id=${entryId}` : ""}`, { method: "PUT", body: d }),

  // Predictions by user (admin always, others when closed)
  getUserPredictions: (uid, entryId) =>
    request(`/api/predictions/user/${uid}${entryId ? `?entry_id=${entryId}` : ""}`),

  // Every form's pick for one match — {entry_id: [a,b]} (privacy-gated)
  getMatchPredictions: (n) => request(`/api/predictions/match/${n}`),

  // Group prediction stats (stage closed only)
  getGroupStats: (stage) =>
    request(`/api/stats/group${stage != null ? `?stage=${stage}` : ""}`),

  // Admin
  updateConfig:         (d)      => request("/api/config/",                  { method: "PATCH", body: d }),
  setResult:            (n, d)   => request(`/api/results/${n}`,             { method: "PUT",   body: d }),
  resetAllResults:      ()       => request("/api/results/reset",            { method: "POST" }),
  resetUserData: ({ userId, entryId } = {}) => {
    const p = new URLSearchParams();
    if (userId)  p.set("user_id",  userId);
    if (entryId) p.set("entry_id", entryId);
    const qs = p.toString() ? `?${p}` : "";
    return request(`/api/results/reset-user-data${qs}`, { method: "POST" });
  },
  resetFullSystem: ({ userId } = {}) => {
    const p = new URLSearchParams();
    if (userId) p.set("user_id", userId);
    const qs = p.toString() ? `?${p}` : "";
    return request(`/api/results/reset-full-system${qs}`, { method: "POST" });
  },
  // Backup / restore (admin) — adminBackup() returns the full snapshot object;
  // adminRestore(payload) destructively replaces all data from one.
  adminBackup:          ()       => request("/api/admin/backup"),
  adminRestore:         (data)   => request("/api/admin/restore", { method: "POST", body: data }),
  getUsers:             ()       => request("/api/users/"),
  patchUser:            (uid, d) => request(`/api/users/${uid}`,             { method: "PATCH", body: d }),
  updateMe:             (d)      => request("/api/users/me",                 { method: "PATCH", body: d }),
  setHelpSeen:          (m)      => request("/api/users/me/help-seen",       { method: "PUT",   body: { help_seen: m } }),
  getAdminParticipants: ()       => request("/api/users/admin/participants"),
};

export const liveApi = {
  getAll:   ()      => request("/api/live/"),
  set:      (n, d)  => request(`/api/live/${n}`,          { method: "PUT",    body: d }),
  // Mark an existing live record as visibly live (LIVE badge). Falls back to
  // the regular set endpoint with is_live:true for backends that don't have
  // a dedicated route.
  markLive: (n)     => request(`/api/live/${n}`,          { method: "PUT",    body: { is_live: true } }),
  remove:   (n)     => request(`/api/live/${n}`,          { method: "DELETE" }),
  finalize: (n)     => request(`/api/live/${n}/finalize`, { method: "POST" }),
};

// Demo-only helper (no-op in production, the demo build replaces this module)
export const demoVariantApi = { get: () => null, set: () => {} };

// Single bootstrap call — replaces 4+ parallel calls with one request
export const initApi = {
  load: () => request("/api/init/"),
};
