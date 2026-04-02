import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Cognito
const COGNITO_DOMAIN = "https://us-east-1gcfsrjxou.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "1oeaodsmtgvqthl36301eh612a";
const REDIRECT_URI = "https://www.aramislabs.click/callback";

export default function App() {
  const [time, setTime] = useState(new Date());
  const [matricula, setMatricula] = useState("");
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState("");
  const [screen, setScreen] = useState("home");
  const [adminToken, setAdminToken] = useState(null);
  const [adminUser, setAdminUser] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Carrega token salvo, se existir
  useEffect(() => {
    const savedToken = localStorage.getItem("admin_id_token");
    const savedUser = localStorage.getItem("admin_user");

    if (savedToken) {
      setAdminToken(savedToken);
    }

    if (savedUser) {
      setAdminUser(JSON.parse(savedUser));
    }
  }, []);

  // Trata o retorno do Cognito com ?code=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      setMsg(`Erro no login: ${errorDescription || error}`);
      return;
    }

    if (!code) return;

    async function exchangeCodeForToken() {
      try {
        const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: COGNITO_CLIENT_ID,
            code,
            redirect_uri: REDIRECT_URI,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Falha ao obter token: ${errorText}`);
        }

        const data = await response.json();

        // Salva tokens
        if (data.id_token) {
          localStorage.setItem("admin_id_token", data.id_token);
          setAdminToken(data.id_token);

          // Decodifica payload do JWT só para mostrar dados básicos do usuário
          const payload = JSON.parse(atob(data.id_token.split(".")[1]));
          localStorage.setItem("admin_user", JSON.stringify(payload));
          setAdminUser(payload);
        }

        if (data.access_token) {
          localStorage.setItem("admin_access_token", data.access_token);
        }

        if (data.refresh_token) {
          localStorage.setItem("admin_refresh_token", data.refresh_token);
        }

        // Limpa query string da URL
        window.history.replaceState({}, document.title, window.location.pathname);

        setMsg("Login administrativo realizado com sucesso!");
        setScreen("admin");
      } catch (err) {
        setMsg(err.message);
      }
    }

    exchangeCodeForToken();
  }, []);

  async function registrarPonto() {
    try {
      const res = await fetch(`${API_BASE_URL}/clock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          employee_id: matricula,
          password: senha,
        }),
      });

      if (!res.ok) throw new Error("Erro ao registrar ponto");

      setMsg("Ponto registrado com sucesso!");
    } catch (err) {
      setMsg(err.message);
    }
  }

  function loginAdmin() {
    const loginUrl =
      `${COGNITO_DOMAIN}/oauth2/authorize` +
      `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent("openid email profile")}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

    window.location.href = loginUrl;
  }

  function logoutAdmin() {
    localStorage.removeItem("admin_id_token");
    localStorage.removeItem("admin_access_token");
    localStorage.removeItem("admin_refresh_token");
    localStorage.removeItem("admin_user");

    setAdminToken(null);
    setAdminUser(null);
    setScreen("home");
    setMsg("Logout realizado com sucesso.");
  }

  // Tela HOME
  if (screen === "home") {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <div style={{ position: "absolute", top: "20px", left: "20px" }}>
          <button onClick={loginAdmin}>
            Acesso Administrativo
          </button>
        </div>

        <h1>Sistema de Ponto</h1>

        <h2>{time.toLocaleTimeString()}</h2>

        <div>
          <input
            placeholder="Matrícula"
            value={matricula}
            onChange={(e) => setMatricula(e.target.value)}
          />
        </div>

        <div>
          <input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>

        <button onClick={registrarPonto}>
          Registrar Ponto
        </button>

        <p>{msg}</p>
      </div>
    );
  }

  // Tela ADMIN
  if (screen === "admin") {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <button onClick={() => setScreen("home")}>
          ← Voltar
        </button>

        <h1>Área Administrativa</h1>

        {adminUser ? (
          <>
            <p><strong>Usuário autenticado:</strong> {adminUser.email || adminUser.name || "Sem identificação"}</p>
            <p><strong>Sub:</strong> {adminUser.sub}</p>
            <button onClick={logoutAdmin}>Logout</button>
          </>
        ) : (
          <p>Usuário administrativo autenticado, mas sem dados para exibir.</p>
        )}
      </div>
    );
  }

  return null;
}