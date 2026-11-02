import { useCallback, useEffect, useState } from "react";
import {
  ACTION_LABELS,
  ACTIONS_BY_STATUS,
  CATEGORIES,
  EVENT_LABELS,
  SITES,
  STATUSES,
} from "./config.js";
import { EmptyState, RegionTag } from "./components.jsx";
import { formatDateTime, formatMoney, formatPercent } from "./time.js";

function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{STATUSES[status] ?? status}</span>;
}

function useLoader(load, onError, deps) {
  const [data, setData] = useState(null);
  const reload = useCallback(() => {
    load().then(setData).catch((err) => {
      setData((current) => current ?? []);
      onError(err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return [data, reload];
}

// ==== Painel ====

function Distribution({ title, entries, labels = {}, total }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      <ul className="bars">
        {entries.map(([key, count]) => (
          <li key={key}>
            <span className="bar-label">{labels[key] ?? key}</span>
            <span className="bar-track">
              <span className={`bar-fill status-${key}`} style={{ width: total ? `${(count / total) * 100}%` : 0 }} />
            </span>
            <strong className="bar-value">{count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardTab({ api, onError, onOpenAsset }) {
  const [data] = useLoader(() => api.dashboard(), onError, [api, onError]);

  if (!data) return <div className="card loading-card">Carregando…</div>;
  if (Array.isArray(data)) return <p className="muted">Não foi possível carregar o painel.</p>;

  const statusTotal = Object.values(data.byStatus).reduce((a, b) => a + b, 0);
  return (
    <div className="dashboard">
      <div className="kpis">
        <div className="kpi">
          <span>Ativos em operação</span>
          <strong>{data.total}</strong>
        </div>
        <div className="kpi">
          <span>Valor do inventário</span>
          <strong>{formatMoney(data.totalValueUsd)}</strong>
        </div>
        <div className="kpi">
          <span>Taxa de utilização</span>
          <strong>{formatPercent(data.utilizationRate)}</strong>
        </div>
        <div className="kpi warn">
          <span>Em manutenção</span>
          <strong>{data.byStatus.MAINTENANCE ?? 0}</strong>
        </div>
      </div>

      <div className="grid-3">
        <Distribution title="Por status" entries={Object.entries(data.byStatus)} labels={STATUSES} total={statusTotal} />
        <Distribution title="Por categoria" entries={Object.entries(data.byCategory)} labels={CATEGORIES} total={data.total} />
        <Distribution title="Por site" entries={Object.entries(data.bySite)} total={data.total} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Últimas movimentações</h2>
        </div>
        <EventTable events={data.recentEvents} onOpenAsset={onOpenAsset} compact />
      </div>
    </div>
  );
}

// ==== Ativos ====

const EMPTY_ASSET = { id: "", name: "", category: "NOTEBOOK", serialNumber: "", site: SITES[0], costUsd: "" };

function NewAssetForm({ api, onCreated, onCancel, onError }) {
  const [form, setForm] = useState(EMPTY_ASSET);
  const [saving, setSaving] = useState(false);
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const asset = await api.createAsset({ ...form, costUsd: Number(form.costUsd || 0) });
      setForm(EMPTY_ASSET);
      onCreated(asset);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head">
        <h2>Novo ativo</h2>
        <button type="button" className="link" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Tag patrimonial</span>
          <input value={form.id} onChange={update("id")} placeholder="Ex: NB-0042" required />
        </label>
        <label className="field">
          <span>Descrição</span>
          <input value={form.name} onChange={update("name")} placeholder="Ex: Dell Latitude 7440" required />
        </label>
        <label className="field">
          <span>Categoria</span>
          <select value={form.category} onChange={update("category")}>
            {Object.entries(CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Número de série</span>
          <input value={form.serialNumber} onChange={update("serialNumber")} required />
        </label>
        <label className="field">
          <span>Site</span>
          <select value={form.site} onChange={update("site")}>
            {SITES.map((site) => (
              <option key={site}>{site}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Custo (US$)</span>
          <input type="number" min="0" step="0.01" value={form.costUsd} onChange={update("costUsd")} required />
        </label>
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? "Salvando…" : "Cadastrar ativo"}
      </button>
    </form>
  );
}

function AssetDetail({ api, assetId, onChanged, onClose, onError, onNotice }) {
  const [detail, reload] = useLoader(() => api.getAsset(assetId), onError, [api, assetId, onError]);
  const [action, setAction] = useState(null);
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAction(null);
    setAssignee("");
    setNote("");
  }, [assetId]);

  if (!detail) return <div className="card loading-card">Carregando ativo…</div>;
  if (Array.isArray(detail)) return null;
  const { asset, history } = detail;

  async function confirm(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.changeAsset(asset.id, { action, assignee, note, expectedVersion: asset.version });
      onNotice({ kind: "success", text: `${ACTION_LABELS[action]}: ${asset.id} atualizado.` });
      setAction(null);
      setAssignee("");
      setNote("");
      reload();
      onChanged();
    } catch (err) {
      onError(err);
      reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card detail">
      <div className="card-head">
        <div>
          <p className="eyebrow mono">{asset.id}</p>
          <h2>{asset.name}</h2>
        </div>
        <button className="link" onClick={onClose}>
          Fechar
        </button>
      </div>

      <dl className="facts">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={asset.status} />
          </dd>
        </div>
        <div>
          <dt>Responsável</dt>
          <dd>{asset.assignee ?? "—"}</dd>
        </div>
        <div>
          <dt>Categoria</dt>
          <dd>{CATEGORIES[asset.category]}</dd>
        </div>
        <div>
          <dt>Site</dt>
          <dd>{asset.site}</dd>
        </div>
        <div>
          <dt>Número de série</dt>
          <dd className="mono">{asset.serialNumber}</dd>
        </div>
        <div>
          <dt>Custo</dt>
          <dd>{formatMoney(asset.costUsd)}</dd>
        </div>
        <div>
          <dt>Última alteração</dt>
          <dd>
            {formatDateTime(asset.updatedAt)} · <RegionTag code={asset.updatedRegion} />
          </dd>
        </div>
        <div>
          <dt>Versão</dt>
          <dd className="mono">v{asset.version}</dd>
        </div>
      </dl>

      {ACTIONS_BY_STATUS[asset.status].length > 0 && (
        <div className="actions">
          {ACTIONS_BY_STATUS[asset.status].map((a) => (
            <button
              key={a}
              className={`btn ${a === action ? "btn-primary" : "btn-soft"}`}
              onClick={() => setAction(a === action ? null : a)}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      )}

      {action && (
        <form className="action-form" onSubmit={confirm}>
          {action === "ASSIGN" && (
            <label className="field">
              <span>Atribuir para</span>
              <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Nome ou e-mail do colaborador" required />
            </label>
          )}
          <label className="field">
            <span>Observação</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
          </label>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Salvando…" : `Confirmar: ${ACTION_LABELS[action]}`}
          </button>
        </form>
      )}

      <div>
        <h3 className="section-title">Histórico</h3>
        <ul className="history">
          {history.map((event) => (
            <li key={event.timestampUtc}>
              <span className={`dot event-${event.type}`} />
              <div>
                <strong>{EVENT_LABELS[event.type]}</strong>
                {event.type === "ASSIGNED" && event.assignee && <> para {event.assignee}</>}
                {event.note && <span className="muted"> · {event.note}</span>}
                <div className="small muted">
                  {formatDateTime(event.timestampUtc)} · {event.actor ?? "sistema"} · <RegionTag code={event.region} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AssetsTab({ api, onError, onNotice, selectedId, onSelect }) {
  const [filters, setFilters] = useState({ q: "", status: "", category: "", site: "" });
  const [creating, setCreating] = useState(false);
  const [assets, reload] = useLoader(() => api.listAssets(filters), onError, [api, filters, onError]);
  const setFilter = (field) => (e) => setFilters((f) => ({ ...f, [field]: e.target.value }));

  function created(asset) {
    setCreating(false);
    onNotice({ kind: "success", text: `Ativo ${asset.id} cadastrado.` });
    reload();
    onSelect(asset.id);
  }

  return (
    <div className="assets">
      <div className="toolbar">
        <input className="search" value={filters.q} onChange={setFilter("q")} placeholder="Buscar por tag, descrição, série ou responsável" />
        <select value={filters.status} onChange={setFilter("status")}>
          <option value="">Todos os status</option>
          {Object.entries(STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={filters.category} onChange={setFilter("category")}>
          <option value="">Todas as categorias</option>
          {Object.entries(CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={filters.site} onChange={setFilter("site")}>
          <option value="">Todos os sites</option>
          {SITES.map((site) => (
            <option key={site}>{site}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          Novo ativo
        </button>
      </div>

      {creating && <NewAssetForm api={api} onCreated={created} onCancel={() => setCreating(false)} onError={onError} />}

      <div className={selectedId ? "split" : ""}>
        <div className="card">
          <div className="card-head">
            <h2>Inventário</h2>
            {assets && <span className="stat">{assets.length} ativos</span>}
          </div>
          {assets === null ? (
            <p className="muted">Carregando…</p>
          ) : assets.length === 0 ? (
            <EmptyState title="Nenhum ativo encontrado">
              <p>Cadastre um ativo ou ajuste os filtros.</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table clickable">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Descrição</th>
                    <th>Site</th>
                    <th>Status</th>
                    <th>Responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id} className={a.id === selectedId ? "selected" : ""} onClick={() => onSelect(a.id)}>
                      <td className="mono nowrap">{a.id}</td>
                      <td>
                        {a.name}
                        <div className="small muted">{CATEGORIES[a.category]}</div>
                      </td>
                      <td className="nowrap">{a.site}</td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="muted">{a.assignee ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedId && (
          <AssetDetail
            api={api}
            assetId={selectedId}
            onChanged={reload}
            onClose={() => onSelect(null)}
            onError={onError}
            onNotice={onNotice}
          />
        )}
      </div>
    </div>
  );
}

// ==== Movimentações ====

function EventTable({ events, onOpenAsset, compact = false }) {
  if (events.length === 0) return <p className="muted">Nenhuma movimentação ainda.</p>;
  return (
    <div className="table-wrap">
      <table className="table clickable">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Ativo</th>
            <th>Movimentação</th>
            {!compact && <th>Status</th>}
            <th>Por</th>
            <th>Região</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={`${e.timestampUtc}-${e.assetId}`} onClick={() => onOpenAsset(e.assetId)}>
              <td className="nowrap">{formatDateTime(e.timestampUtc)}</td>
              <td>
                <span className="mono">{e.assetId}</span>
                <div className="small muted">{e.assetName}</div>
              </td>
              <td>
                {EVENT_LABELS[e.type]}
                {e.type === "ASSIGNED" && e.assignee && <div className="small muted">para {e.assignee}</div>}
              </td>
              {!compact && (
                <td className="nowrap">
                  {e.fromStatus && (
                    <>
                      <StatusBadge status={e.fromStatus} /> →{" "}
                    </>
                  )}
                  <StatusBadge status={e.toStatus} />
                </td>
              )}
              <td className="muted small">{e.actor ?? "sistema"}</td>
              <td>
                <RegionTag code={e.region} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityTab({ api, onError, onOpenAsset }) {
  const [events] = useLoader(() => api.listEvents(50), onError, [api, onError]);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Movimentações recentes</h2>
        <span className="stat">registradas nas duas regiões</span>
      </div>
      {events === null ? <p className="muted">Carregando…</p> : <EventTable events={events} onOpenAsset={onOpenAsset} />}
    </div>
  );
}
