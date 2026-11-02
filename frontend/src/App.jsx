import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_REGION, GLOBAL_API_URL, REGIONS } from "./config.js";
import { clearSession, completeLogin, getSession, login, logout } from "./auth.js";
import { createApi, fetchHealth, RegionUnavailableError, SessionExpiredError } from "./api.js";
import { Footer, Header, LoginScreen, Notice } from "./components.jsx";
import { ActivityTab, AssetsTab, DashboardTab } from "./tabs.jsx";

const MODE_KEY = "ponto.regionMode";
const FAILOVER_KEY = "ponto.failover";
const HEALTH_INTERVAL_MS = 30000;
// While the region is failing, check again sooner; switch only after consecutive failures
const HEALTH_RETRY_MS = 10000;
const FAILURES_BEFORE_SWITCH = 2;
const FAILOVER_REDIRECT_MS = 2500;

const TABS = [
  ["dashboard", "Painel"],
  ["assets", "Ativos"],
  ["activity", "Movimentações"],
];

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// Asks the latency-routed global name which region is closest and healthy. When avoiding a
// failed region, the DNS may still point to it for a few minutes, so the other regions are
// also asked directly.
async function detectClosestRegion(avoid) {
  try {
    const health = await fetchHealth(GLOBAL_API_URL);
    if (REGIONS[health.region] && health.region !== avoid) return health.region;
  } catch {
    // Global name unavailable: fall through to the regional endpoints
  }

  for (const code of Object.keys(REGIONS)) {
    if (code === avoid) continue;
    try {
      await fetchHealth(REGIONS[code].apiUrl);
      return code;
    } catch {
      // Try the next region
    }
  }
  return avoid ?? DEFAULT_REGION;
}

export default function App() {
  const now = useNow();
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || "auto");
  const [session, setSession] = useState(() => getSession());
  const [region, setRegion] = useState(null);
  const [health, setHealth] = useState(null);
  // Bumped when an API call fails, so the health loop checks the region right away
  const [healthNudge, setHealthNudge] = useState(0);
  const [notice, setNotice] = useState(null);
  const [completingLogin, setCompletingLogin] = useState(() =>
    new URLSearchParams(window.location.search).has("code")
  );

  const closeNotice = useCallback(() => setNotice(null), []);

  const endSession = useCallback((text) => {
    clearSession();
    setSession(null);
    if (text) setNotice({ kind: "warning", text });
  }, []);

  // Stable identity: the clock re-renders every second and must not trigger data reloads
  const onSessionExpired = useCallback(
    () => endSession("Sua sessão expirou. Entre novamente."),
    [endSession]
  );

  const onRegionTrouble = useCallback(() => setHealthNudge((n) => n + 1), []);

  // Finishes the OAuth redirect coming back from Cognito/Okta
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error_description") || params.get("error");
    if (!code && !error) return;

    window.history.replaceState({}, document.title, "/");
    if (error) {
      setNotice({ kind: "error", text: `Erro no login: ${error}` });
      setCompletingLogin(false);
      return;
    }

    completeLogin(code)
      .then((newSession) => {
        setSession(newSession);
        const failover = JSON.parse(localStorage.getItem(FAILOVER_KEY) || "null");
        localStorage.removeItem(FAILOVER_KEY);
        if (failover) {
          setNotice({
            kind: "warning",
            text: `${REGIONS[failover.from].name} ficou indisponível. Você agora está em ${REGIONS[newSession.region].name}, com os mesmos dados.`,
          });
        }
      })
      .catch((err) => setNotice({ kind: "error", text: err.message }))
      .finally(() => setCompletingLogin(false));
  }, []);

  // A signed-in user stays on the region that issued the token; otherwise the
  // selected region, or the closest one in automatic mode
  useEffect(() => {
    if (completingLogin) return undefined;
    let cancelled = false;

    async function resolve() {
      if (session) return session.region;
      if (mode !== "auto") return mode;
      return detectClosestRegion();
    }

    resolve().then((resolved) => {
      if (!cancelled) setRegion(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [session, mode, completingLogin]);

  // Health of the region in use. In automatic mode, after consecutive failures it moves to the
  // other region; a signed-in user is sent to sign in there, which is quick because the Okta
  // session is still active.
  useEffect(() => {
    if (!region) return undefined;
    let cancelled = false;
    let timer;
    let failures = 0;

    function schedule(ms) {
      timer = setTimeout(check, ms);
    }

    async function failOver() {
      const target = await detectClosestRegion(region);
      if (cancelled || target === region) return false;

      const from = REGIONS[region].name;
      const to = REGIONS[target].name;
      if (session) {
        localStorage.setItem(FAILOVER_KEY, JSON.stringify({ from: region, to: target }));
        clearSession();
        setNotice({ kind: "warning", text: `${from} não respondeu. Transferindo sua sessão para ${to}…` });
        setTimeout(() => login(target, session.provider), FAILOVER_REDIRECT_MS);
      } else {
        setNotice({ kind: "warning", text: `${from} não respondeu. O sistema passou para ${to}.` });
        setRegion(target);
      }
      return true;
    }

    async function check() {
      try {
        const data = await fetchHealth(REGIONS[region].apiUrl);
        if (cancelled) return;
        failures = 0;
        setHealth({ ok: true, ...data });
        schedule(HEALTH_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        setHealth({ ok: false, error: err.message });
        if (mode === "auto" && failures >= FAILURES_BEFORE_SWITCH && (await failOver())) return;
        if (!cancelled) schedule(HEALTH_RETRY_MS);
      }
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [region, mode, session, healthNudge]);

  function changeMode(newMode) {
    localStorage.setItem(MODE_KEY, newMode);
    setMode(newMode);
    if (session && newMode !== "auto" && newMode !== session.region) {
      endSession(`Região alterada para ${REGIONS[newMode].name}. Entre novamente para continuar.`);
    }
  }

  let content;
  if (completingLogin) {
    content = <div className="card loading-card">Concluindo login…</div>;
  } else if (session) {
    content = (
      <Workspace
        key={session.idToken}
        session={session}
        onNotice={setNotice}
        onSessionExpired={onSessionExpired}
        onRegionTrouble={onRegionTrouble}
      />
    );
  } else {
    content = <LoginScreen now={now} region={region} health={health} onLogin={login} />;
  }

  return (
    <div className="app">
      <Header
        region={region}
        health={health}
        mode={mode}
        onModeChange={changeMode}
        session={session}
        onLogout={() => logout(session)}
      />
      <main className="main">
        <Notice notice={notice} onClose={closeNotice} />
        {content}
      </main>
      <Footer region={region} />
    </div>
  );
}

function Workspace({ session, onNotice, onSessionExpired, onRegionTrouble }) {
  const api = useMemo(() => createApi(session.region, session.idToken), [session]);
  const [tab, setTab] = useState("dashboard");
  const [selectedAsset, setSelectedAsset] = useState(null);

  const onError = useCallback(
    (err) => {
      if (err instanceof SessionExpiredError) return onSessionExpired();
      if (err instanceof RegionUnavailableError) onRegionTrouble();
      onNotice({ kind: "error", text: err.message });
    },
    [onNotice, onSessionExpired, onRegionTrouble]
  );

  const openAsset = useCallback((id) => {
    setSelectedAsset(id);
    setTab("assets");
  }, []);

  const shared = { api, onError, onNotice, onOpenAsset: openAsset };

  return (
    <section className="workspace">
      <div className="workspace-head">
        <div>
          <p className="eyebrow">Olá, {session.user.name}</p>
          <h1>{TABS.find(([id]) => id === tab)[1]}</h1>
        </div>
        <nav className="tabs" aria-label="Seções">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "dashboard" ? (
        <DashboardTab {...shared} />
      ) : tab === "assets" ? (
        <AssetsTab {...shared} selectedId={selectedAsset} onSelect={setSelectedAsset} />
      ) : (
        <ActivityTab {...shared} />
      )}
    </section>
  );
}
