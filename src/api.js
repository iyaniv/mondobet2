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
  getMatches:  () => request("/api/matches/"),
  getConfig:   () => request("/api/config/"),
  getResults:  () => request("/api/results/"),
  getLeaderboard: () => request("/api/leaderboard/"),

  // Predictions (current user)
  getMyPredictions: ()           => request("/api/predictions/me"),
  setPrediction:    (n, d)       => request(`/api/predictions/${n}`, { method: "PUT", body: d }),
  setWinnerPick:    (d)          => request("/api/predictions/winner/me", { method: "PUT", body: d }),

  // Predictions (by user — admin always, others when closed)
  getUserPredictions: (uid)      => request(`/api/predictions/user/${uid}`),

  // Admin
  updateConfig:  (d)             => request("/api/config/",          { method: "PATCH", body: d }),
  setResult:     (n, d)          => request(`/api/results/${n}`,     { method: "PUT",   body: d }),
  getUsers:      ()              => request("/api/users/"),
  patchUser:     (uid, d)        => request(`/api/users/${uid}`,     { method: "PATCH", body: d }),
};
