// Each region has its own API and its own Cognito user pool (both federated with Okta).
// A token is only accepted by the API of the region whose pool issued it, so the app
// always talks to a single region: the one the user signed in to.

export const GLOBAL_API_URL = import.meta.env.VITE_API_GLOBAL_URL;
export const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;
export const LOGOUT_URI = import.meta.env.VITE_LOGOUT_URI;

// Skips the Cognito sign-in page and goes straight to the Okta login
export const IDENTITY_PROVIDER = "okta";

// Plan B: users created directly in the Cognito pool, used when Okta is unavailable
export const LOCAL_PROVIDER = "COGNITO";

export const DEFAULT_REGION = "us-east-1";

export const REGIONS = {
  "us-east-1": {
    code: "us-east-1",
    name: "N. Virginia",
    country: "Estados Unidos",
    apiUrl: import.meta.env.VITE_API_US_URL,
    cognitoDomain: import.meta.env.VITE_COGNITO_US_DOMAIN,
    cognitoClientId: import.meta.env.VITE_COGNITO_US_CLIENT_ID,
  },
  "eu-west-1": {
    code: "eu-west-1",
    name: "Irlanda",
    country: "Europa",
    apiUrl: import.meta.env.VITE_API_EU_URL,
    cognitoDomain: import.meta.env.VITE_COGNITO_EU_DOMAIN,
    cognitoClientId: import.meta.env.VITE_COGNITO_EU_CLIENT_ID,
  },
};

// Domain values; the backend validates the same lists
export const CATEGORIES = {
  NOTEBOOK: "Notebook",
  MONITOR: "Monitor",
  SERVER: "Servidor",
  PHONE: "Celular",
  NETWORK: "Rede",
  LICENSE: "Licença de software",
};

export const SITES = ["São Paulo", "Nova York", "Dublin", "Lisboa", "Londres"];

export const STATUSES = {
  AVAILABLE: "Disponível",
  IN_USE: "Em uso",
  MAINTENANCE: "Em manutenção",
  RETIRED: "Baixado",
};

export const EVENT_LABELS = {
  CREATED: "Cadastro",
  ASSIGNED: "Atribuição",
  RETURNED: "Devolução",
  MAINTENANCE: "Manutenção",
  RETIRED: "Baixa",
};

// Actions shown for each status, in the order of the buttons
export const ACTIONS_BY_STATUS = {
  AVAILABLE: ["ASSIGN", "MAINTENANCE", "RETIRE"],
  IN_USE: ["RETURN", "MAINTENANCE"],
  MAINTENANCE: ["RETURN", "RETIRE"],
  RETIRED: [],
};

export const ACTION_LABELS = {
  ASSIGN: "Atribuir",
  RETURN: "Devolver ao estoque",
  MAINTENANCE: "Enviar para manutenção",
  RETIRE: "Dar baixa",
};
