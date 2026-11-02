import { REGIONS } from "./config.js";

export class SessionExpiredError extends Error {}

// The region did not answer (network failure or 5xx): a hint to check its health right away
export class RegionUnavailableError extends Error {}

const MESSAGES = {
  "Employee not found": "Matrícula não encontrada.",
  "Employee ID already exists": "Já existe um funcionário com essa matrícula.",
};

// Public endpoint: tells which region (and AZ) answered, and how long it took
export async function fetchHealth(baseUrl) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/health`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Health check falhou (${response.status})`);
  const data = await response.json();
  return { ...data, latencyMs: Math.round(performance.now() - started) };
}

export function createApi(regionCode, token) {
  const baseUrl = REGIONS[regionCode].apiUrl;

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      throw new RegionUnavailableError(`${REGIONS[regionCode].name} não respondeu.`);
    }

    if (response.status === 401) {
      throw new SessionExpiredError("Sua sessão expirou. Entre novamente.");
    }

    if (response.status >= 500) {
      throw new RegionUnavailableError(`${REGIONS[regionCode].name} respondeu com erro ${response.status}.`);
    }

    if (!response.ok) {
      let detail = null;
      try {
        detail = (await response.json()).detail;
      } catch {
        // Body is not JSON
      }
      throw new Error(MESSAGES[detail] || detail || `Erro ${response.status}`);
    }

    return response.json();
  }

  return {
    listEmployees: () => request("/employees"),
    createEmployee: (employee) =>
      request("/employees", { method: "POST", body: JSON.stringify(employee) }),
    listRecords: (employeeId) => request(`/clock/${encodeURIComponent(employeeId)}`),
    listRecentRecords: () => request("/clock"),
    registerClock: (employeeId, type) =>
      request("/clock", { method: "POST", body: JSON.stringify({ employeeId, type }) }),
  };
}
