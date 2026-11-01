import { useCallback, useEffect, useState } from "react";
import { REGIONS, TIMEZONES } from "./config.js";
import { EmptyState, RegionTag } from "./components.jsx";
import {
  dayKey,
  formatDayLabel,
  formatDuration,
  formatLongDate,
  formatTime,
  groupByDay,
  workedMs,
} from "./time.js";

const TYPE_LABEL = { IN: "Entrada", OUT: "Saída" };

function EmployeeSelect({ employees, me, value, onChange }) {
  return (
    <label className="field">
      <span>Funcionário</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} · {e.id}
            {me?.id === e.id ? " (você)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

// Starts on the logged-in user's employee record, else on the first employee
function useSelectedEmployee(employees, me) {
  const [employeeId, setEmployeeId] = useState("");
  useEffect(() => {
    if (!employeeId && employees.length > 0) setEmployeeId((me || employees[0]).id);
  }, [employees, me, employeeId]);
  return [employeeId, setEmployeeId];
}

function useRecords(api, employeeId, onError) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!employeeId) return;
    setLoading(true);
    api
      .listRecords(employeeId)
      .then(setRecords)
      .catch(onError)
      .finally(() => setLoading(false));
  }, [api, employeeId, onError]);

  useEffect(load, [load]);
  return [records, loading, load];
}

function NoEmployees({ onGoTeam }) {
  return (
    <EmptyState title="Nenhum funcionário cadastrado">
      <p>Cadastre o primeiro funcionário para começar a registrar o ponto.</p>
      <button className="btn btn-primary" onClick={onGoTeam}>
        Ir para Equipe
      </button>
    </EmptyState>
  );
}

export function PunchTab({ api, employees, me, userEmail, now, onError, onNotice, onGoTeam }) {
  const [employeeId, setEmployeeId] = useSelectedEmployee(employees, me);
  const [records, loading, reload] = useRecords(api, employeeId, onError);
  const [saving, setSaving] = useState(false);

  if (employees.length === 0) return <NoEmployees onGoTeam={onGoTeam} />;

  const employee = employees.find((e) => e.id === employeeId);
  const tz = employee?.timezone;
  const last = records[0];
  const working = last?.type === "IN";
  const todayKey = dayKey(now, tz);
  const today = records.filter((r) => dayKey(r.timestampUtc, tz) === todayKey).reverse();

  async function punch() {
    setSaving(true);
    try {
      const record = await api.registerClock(employeeId, working ? "OUT" : "IN");
      const where = REGIONS[record.region]?.name;
      onNotice({
        kind: "success",
        text: `${TYPE_LABEL[record.type]} de ${employee?.name ?? employeeId} registrada às ${formatTime(
          record.timestampUtc,
          tz
        )}${where ? ` em ${where}` : ""}.`,
      });
      reload();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  let status = "Nenhum registro ainda";
  if (last && working) status = `Em expediente desde ${formatTime(last.timestampUtc, tz)}`;
  if (last && !working) status = `Fora do expediente · última saída às ${formatTime(last.timestampUtc, tz)}`;

  return (
    <div className="grid-2">
      <div className="card punch-card">
        <p className="eyebrow">{formatLongDate(now, tz)}</p>
        <div className="clock clock-lg">{formatTime(now, tz, true)}</div>
        {tz && <p className="muted small">Fuso de {employee?.name}: {tz}</p>}

        <EmployeeSelect employees={employees} me={me} value={employeeId} onChange={setEmployeeId} />

        <div className={`status-pill ${working ? "working" : "off"}`}>
          {loading ? "Carregando…" : status}
        </div>

        <button
          className={`btn btn-lg ${working ? "btn-out" : "btn-in"}`}
          disabled={!employeeId || saving || loading}
          onClick={punch}
        >
          {saving ? "Registrando…" : working ? "Registrar saída" : "Registrar entrada"}
        </button>

        {!me && (
          <p className="hint">
            Seu e-mail ({userEmail}) não está vinculado a um funcionário. Escolha acima quem está
            registrando, ou cadastre-se na aba Equipe usando esse e-mail.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Hoje</h2>
          <span className="stat">{formatDuration(workedMs(today, now))} trabalhadas</span>
        </div>
        {today.length === 0 ? (
          <p className="muted">Nenhum registro hoje.</p>
        ) : (
          <ul className="timeline">
            {today.map((r) => (
              <li key={r.timestampUtc}>
                <span className={`badge ${r.type}`}>{TYPE_LABEL[r.type]}</span>
                <strong>{formatTime(r.timestampUtc, tz)}</strong>
                <RegionTag code={r.region} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function HistoryTab({ api, employees, me, now, onError, onGoTeam }) {
  const [employeeId, setEmployeeId] = useSelectedEmployee(employees, me);
  const [records, loading] = useRecords(api, employeeId, onError);

  if (employees.length === 0) return <NoEmployees onGoTeam={onGoTeam} />;

  const tz = employees.find((e) => e.id === employeeId)?.timezone;
  const days = groupByDay(records, tz, now);
  const total = days.reduce((sum, d) => sum + d.workedMs, 0);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Histórico</h2>
        <span className="stat">
          {formatDuration(total)} em {days.length} {days.length === 1 ? "dia" : "dias"}
        </span>
      </div>

      <EmployeeSelect employees={employees} me={me} value={employeeId} onChange={setEmployeeId} />

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : days.length === 0 ? (
        <p className="muted">Nenhum registro para este funcionário.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Registros</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.key}>
                  <td className="nowrap">{day.label}</td>
                  <td>
                    <div className="chips">
                      {day.records.map((r) => (
                        <span key={r.timestampUtc} className={`chip ${r.type}`}>
                          {TYPE_LABEL[r.type]} {formatTime(r.timestampUtc, tz)}
                          {REGIONS[r.region] && <em> · {REGIONS[r.region].name}</em>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num">{formatDuration(day.workedMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const EMPTY_FORM = { id: "", name: "", email: "", timezone: "America/Sao_Paulo" };

export function TeamTab({ api, employees, userEmail, onReload, onError, onNotice }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState(null);
  const [recentError, setRecentError] = useState(false);

  useEffect(() => {
    api
      .listRecentRecords()
      .then(setRecent)
      .catch(() => setRecentError(true));
  }, [api, employees]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.id.trim() || !form.name.trim() || !form.email.trim()) {
      onNotice({ kind: "error", text: "Preencha matrícula, nome e e-mail." });
      return;
    }
    setSaving(true);
    try {
      await api.createEmployee({ ...form, id: form.id.trim(), name: form.name.trim(), email: form.email.trim() });
      onNotice({ kind: "success", text: `${form.name.trim()} cadastrado com sucesso.` });
      setForm(EMPTY_FORM);
      onReload();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="team">
      <div className="grid-2">
        <form className="card" onSubmit={submit}>
          <div className="card-head">
            <h2>Novo funcionário</h2>
          </div>
          <label className="field">
            <span>Matrícula</span>
            <input value={form.id} onChange={update("id")} placeholder="Ex: 1001" />
          </label>
          <label className="field">
            <span>Nome</span>
            <input value={form.name} onChange={update("name")} placeholder="Ex: Maria Souza" />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input type="email" value={form.email} onChange={update("email")} placeholder="Mesmo e-mail do Okta" />
          </label>
          {userEmail && !form.email && (
            <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, email: userEmail }))}>
              Usar meu e-mail ({userEmail})
            </button>
          )}
          <label className="field">
            <span>Fuso horário</span>
            <select value={form.timezone} onChange={update("timezone")}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Cadastrar funcionário"}
          </button>
        </form>

        <div className="card">
          <div className="card-head">
            <h2>Equipe</h2>
            <span className="stat">{employees.length} funcionários</span>
          </div>
          {employees.length === 0 ? (
            <p className="muted">Ninguém cadastrado ainda.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Matrícula</th>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Fuso</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{e.id}</td>
                      <td>{e.name}</td>
                      <td className="muted">{e.email}</td>
                      <td className="muted small">{e.timezone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Últimos registros da equipe</h2>
        </div>
        {recentError ? (
          <p className="muted">Não foi possível carregar os últimos registros.</p>
        ) : recent === null ? (
          <p className="muted">Carregando…</p>
        ) : recent.length === 0 ? (
          <p className="muted">Nenhum registro ainda.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Funcionário</th>
                  <th>Tipo</th>
                  <th>Registrado em</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={`${r.employeeId}-${r.timestampUtc}`}>
                    <td className="nowrap">
                      {formatDayLabel(r.timestampUtc)} · {formatTime(r.timestampUtc)}
                    </td>
                    <td>{r.employeeName ?? r.employeeId}</td>
                    <td>
                      <span className={`badge ${r.type}`}>{TYPE_LABEL[r.type]}</span>
                    </td>
                    <td>
                      <RegionTag code={r.region} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
