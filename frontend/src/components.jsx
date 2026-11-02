import { useEffect } from "react";
import { LOCAL_PROVIDER, REGIONS } from "./config.js";
import { formatLongDate, formatTime } from "./time.js";

export function RegionBadge({ region, health, large = false }) {
  if (!region) {
    return (
      <div className={`region-badge checking ${large ? "large" : ""}`}>
        <span className="status-dot" />
        <div className="region-text">
          <span className="region-label">Sistema rodando em</span>
          <strong>Detectando região…</strong>
        </div>
      </div>
    );
  }

  const info = REGIONS[region];
  const status = !health ? "checking" : health.ok ? "online" : "offline";
  const meta = [
    info.code,
    health?.ok && health.availabilityZone,
    health?.ok && `${health.latencyMs} ms`,
    health && !health.ok && "sem resposta",
  ].filter(Boolean);

  return (
    <div className={`region-badge ${status} ${large ? "large" : ""}`}>
      <span className="status-dot" aria-hidden="true" />
      <div className="region-text">
        <span className="region-label">Sistema rodando em</span>
        <strong>
          {info.name} <span className="region-country">· {info.country}</span>
        </strong>
        <span className="region-meta">{meta.join(" · ")}</span>
      </div>
    </div>
  );
}

export function RegionTag({ code }) {
  const info = REGIONS[code];
  if (!info) return <span className="region-tag unknown">—</span>;
  return <span className={`region-tag ${code}`}>{info.name}</span>;
}

export function RegionSelector({ mode, onChange }) {
  return (
    <label className="region-selector">
      <span>Região</span>
      <select value={mode} onChange={(e) => onChange(e.target.value)}>
        <option value="auto">Automática (mais próxima)</option>
        {Object.values(REGIONS).map((r) => (
          <option key={r.code} value={r.code}>
            {r.name} ({r.code})
          </option>
        ))}
      </select>
    </label>
  );
}

function initials(name = "") {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function Header({ region, health, mode, onModeChange, session, onLogout }) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">A</span>
        <div>
          <strong>Ativos Global</strong>
          <span>Controle de ativos corporativos multi-região</span>
        </div>
      </div>

      <div className="header-right">
        <RegionBadge region={region} health={health} />
        <RegionSelector mode={mode} onChange={onModeChange} />
        {session && (
          <div className="user">
            <span className="avatar">{initials(session.user.name)}</span>
            <div className="user-text">
              <strong>{session.user.name}</strong>
              <span>{session.user.email}</span>
            </div>
            <button className="btn btn-ghost" onClick={onLogout}>
              Sair
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function Notice({ notice, onClose }) {
  useEffect(() => {
    if (notice?.kind !== "success") return undefined;
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [notice, onClose]);

  if (!notice) return null;
  return (
    <div className={`notice ${notice.kind}`} role="status">
      <span>{notice.text}</span>
      <button className="notice-close" onClick={onClose} aria-label="Fechar">
        ×
      </button>
    </div>
  );
}

export function LoginScreen({ now, region, health, onLogin }) {
  const info = region ? REGIONS[region] : null;

  return (
    <section className="login">
      <div className="login-card">
        <p className="eyebrow">Controle de ativos corporativos</p>
        <h1 className="login-title">Ativos Global</h1>
        <p className="date">
          Inventário, atribuições e histórico de notebooks, servidores e licenças das equipes das
          Américas e da Europa.
        </p>
        <p className="small muted">
          {formatLongDate(now)} · {formatTime(now)}
        </p>

        <RegionBadge region={region} health={health} large />

        <button
          className="btn btn-primary btn-lg"
          disabled={!region || (health && !health.ok)}
          onClick={() => onLogin(region)}
        >
          Entrar com Okta
        </button>
        <p className="hint">
          {info
            ? `O login passa pelo Okta e pelo Cognito da região ${info.name}.`
            : "Identificando a região mais próxima de você…"}
        </p>
        <button
          className="btn btn-link"
          disabled={!region || (health && !health.ok)}
          onClick={() => onLogin(region, LOCAL_PROVIDER)}
        >
          Okta indisponível? Entrar com usuário de contingência
        </button>
      </div>

      <ul className="highlights">
        <li>
          <strong>Ativo-ativo</strong>
          <span>N. Virginia e Irlanda atendem ao mesmo tempo</span>
        </li>
        <li>
          <strong>Login único</strong>
          <span>Okta federado a um Cognito em cada região</span>
        </li>
        <li>
          <strong>Dados globais</strong>
          <span>DynamoDB Global Tables replica cada movimentação</span>
        </li>
      </ul>
    </section>
  );
}

export function Footer({ region }) {
  return (
    <footer className="footer">
      <span>CloudFront · API Gateway · ECS Fargate · DynamoDB Global Tables</span>
      {region && <span>Respondendo de {REGIONS[region].name} ({region})</span>}
    </footer>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
