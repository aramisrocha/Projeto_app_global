// Each region has its own API and its own Cognito user pool (both federated with Okta).
// A token is only accepted by the API of the region whose pool issued it, so the app
// always talks to a single region: the one the user signed in to.

export const GLOBAL_API_URL = import.meta.env.VITE_API_GLOBAL_URL;
export const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;
export const LOGOUT_URI = import.meta.env.VITE_LOGOUT_URI;

// Skips the Cognito sign-in page and goes straight to the Okta login
export const IDENTITY_PROVIDER = "okta";

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

export const TIMEZONES = [
  "America/Sao_Paulo",
  "America/New_York",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/London",
  "UTC",
];
