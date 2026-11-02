import {
  DEFAULT_REGION,
  IDENTITY_PROVIDER,
  LOGOUT_URI,
  REDIRECT_URI,
  REGIONS,
} from "./config.js";

const SESSION_KEY = "ponto.session";
const PENDING_REGION_KEY = "ponto.pendingRegion";

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(payload)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!session || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// Sends the user to the Cognito pool of the chosen region, which forwards to Okta
// (or shows the Cognito sign-in page itself when the provider is LOCAL_PROVIDER)
export function login(regionCode, provider = IDENTITY_PROVIDER) {
  const region = REGIONS[regionCode];
  localStorage.setItem(PENDING_REGION_KEY, regionCode);

  const params = new URLSearchParams({
    client_id: region.cognitoClientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: REDIRECT_URI,
    identity_provider: provider,
  });

  window.location.href = `${region.cognitoDomain}/oauth2/authorize?${params}`;
}

// Exchanges the authorization code with the same pool that started the login
export async function completeLogin(code) {
  const regionCode = localStorage.getItem(PENDING_REGION_KEY) || DEFAULT_REGION;
  const region = REGIONS[regionCode];

  const response = await fetch(`${region.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: region.cognitoClientId,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    throw new Error("Não foi possível concluir o login. Tente novamente.");
  }

  const data = await response.json();
  const claims = decodeJwt(data.id_token) || {};

  const session = {
    region: regionCode,
    idToken: data.id_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    user: {
      email: claims.email,
      name: claims.name || claims.given_name || claims.email,
    },
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem(PENDING_REGION_KEY);
  return session;
}

// Ends the Cognito session too; the Okta session stays, so the next login is quick
export function logout(session) {
  clearSession();
  const region = REGIONS[session?.region];
  if (!region) return;

  const params = new URLSearchParams({
    client_id: region.cognitoClientId,
    logout_uri: LOGOUT_URI,
  });
  window.location.href = `${region.cognitoDomain}/logout?${params}`;
}
