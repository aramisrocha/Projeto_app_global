import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_REGION, GLOBAL_API_URL, REGIONS } from "./config.js";
import { clearSession, completeLogin, getSession, login, logout } from "./auth.js";
import { createApi, fetchHealth, SessionExpiredError } from "./api.js";
import { Footer, Header, LoginScreen, Notice } from "./components.jsx";
import { HistoryTab, PunchTab, TeamTab } from "./tabs.jsx";

const MODE_KEY = "ponto.regionMode";
const HEALTH_INTERVAL_MS = 30000;

const TABS = [
  ["punch", "Registrar ponto"],
  ["history", "Histórico"],
  ["team", "Equipe"],
];

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// Asks the latency-routed global name which region is closest and healthy
async function detectClosestRegion() {
  try {
    const health = await fetchHealth(GLOBAL_API_URL);
    return REGIONS[health.region] ? health.region : DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

export default function App() {
  const now = useNow();
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || "auto");
  const [session, setSession] = useState(() => getSession());
  const [region, setRegion] = useState(null);
  const [health, setHealth] = useState(null);
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
      .then(setSession)
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

  // Health of the region in use; in automatic mode, moves to the other region when it stops answering
  useEffect(() => {
    if (!region) return undefined;
    let cancelled = false;
    setHealth(null);

    async function check() {
      try {
        const data = await fetchHealth(REGIONS[region].apiUrl);
        if (!cancelled) setHealth({ ok: true, ...data });
      } catch (err) {
        if (cancelled) return;
        setHealth({ ok: false, error: err.message });
        if (mode !== "auto") return;

        const closest = await detectClosestRegion();
        if (cancelled || closest === region) return;
        const message = `${REGIONS[region].name} não respondeu. O sistema passou para ${REGIONS[closest].name}.`;
        if (session) endSession(`${message} Entre novamente para continuar.`);
        else setNotice({ kind: "warning", text: message });
        setRegion(closest);
      }
    }

    check();
    const timer = setInterval(check, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [region, mode, session, endSession]);

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
        now={now}
        onNotice={setNotice}
        onSessionExpired={onSessionExpired}
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

function Workspace({ session, now, onNotice, onSessionExpired }) {
  const api = useMemo(() => createApi(session.region, session.idToken), [session]);
  const [tab, setTab] = useState("punch");
  const [employees, setEmployees] = useState(null);

  const onError = useCallback(
    (err) => {
      if (err instanceof SessionExpiredError) onSessionExpired();
      else onNotice({ kind: "error", text: err.message });
    },
    [onNotice, onSessionExpired]
  );

  const loadEmployees = useCallback(() => {
    api
      .listEmployees()
      .then(setEmployees)
      .catch((err) => {
        setEmployees([]);
        onError(err);
      });
  }, [api, onError]);

  useEffect(loadEmployees, [loadEmployees]);

  const email = session.user.email?.toLowerCase();
  const me = employees?.find((e) => e.email && e.email.toLowerCase() === email);
  const shared = { api, now, onError, onNotice, onGoTeam: () => setTab("team") };

  return (
    <section className="workspace">
      <div className="workspace-head">
        <div>
          <p className="eyebrow">Olá, {me?.name ?? session.user.name}</p>
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

      {employees === null ? (
        <div className="card loading-card">Carregando…</div>
      ) : tab === "punch" ? (
        <PunchTab {...shared} employees={employees} me={me} userEmail={session.user.email} />
      ) : tab === "history" ? (
        <HistoryTab {...shared} employees={employees} me={me} />
      ) : (
        <TeamTab {...shared} employees={employees} userEmail={session.user.email} onReload={loadEmployees} />
      )}
    </section>
  );
}
