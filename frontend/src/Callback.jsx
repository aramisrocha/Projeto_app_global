import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;

export default function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (!code) {
        console.error("Code não encontrado");
        return;
      }

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: COGNITO_CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
      });

      const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const data = await res.json();

      localStorage.setItem("id_token", data.id_token);
      localStorage.setItem("access_token", data.access_token);

      navigate("/");
    }

    handleCallback();
  }, [navigate]);

  return <p>Autenticando...</p>;
}