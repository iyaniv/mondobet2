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
  signup:   (d) => request("/api/auth/signup", { method: "POST", body: d }),
  login:    (d) => request("/api/auth/login",  { method: "POST", body: d }),
  me:       ()  => request("/api/auth/me"),

  // Game data (public-ish)
  getMatches:     () => request("/api/matches/"),
  getConfig:      () => request("/api/config/"),
  getResults:     () => request("/api/results/"),
  getLeaderboard: () => request("/api/leaderboard/"),
  // Sim leaderboard isn't implemented on the real backend yet — fall back to actual
  getSimulatedLeaderboard: () => request("/api/leaderboard/"),

  // Entries (multi-form per user)
  getMyEntries:  ()         => request("/api/entries/me"),
  createEntry:   (d)        => request("/api/entries/",      { method: "POST",   body: d || {} }),
  renameEntry:   (id, d)    => request(`/api/entries/${id}`, { method: "PATCH",  body: d }),
  deleteEntry:   (id)       => request(`/api/entries/${id}`, { method: "DELETE" }),
  submitEntry:   (id)       => request(`/api/entries/${id}/submit`, { method: "POST" }),
  getEntryPreds: (id)       => request(`/api/entries/${id}/predictions`),

  // Predictions — pass entryId to target a specific entry
  getMyPredictions: (entryId) =>
    request(`/api/predictions/me${entryId ? `?entry_id=${entryId}` : ""}`),
  setPrediction: (n, d, entryId) =>
    request(`/api/predictions/${n}${entryId ? `?entry_id=${entryId}` : ""}`, { method: "PUT", body: d }),
  setWinnerPick: (d, entryId) =>
    request(`/api/predictions/winner/me${entryId ? `?entry_id=${entryId}` : ""}`, { method: "PUT", body: d }),

  // Predictions by user (admin always, others when closed)
  getUserPredictions: (uid, entryId) =>
    request(`/api/predictions/user/${uid}${entryId ? `?entry_id=${entryId}` : ""}`),

  // Admin
  updateConfig:         (d)      => request("/api/config/",                  { method: "PATCH", body: d }),
  setResult:            (n, d)   => request(`/api/results/${n}`,             { method: "PUT",   body: d }),
  getUsers:             ()       => request("/api/users/"),
  patchUser:            (uid, d) => request(`/api/users/${uid}`,             { method: "PATCH", body: d }),
  updateMe:             (d)      => request("/api/users/me",                 { method: "PATCH", body: d }),
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
