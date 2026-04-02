import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const COGNITO_DOMAIN = "https://us-east-1gcfsrjxou.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "1oeaodsmtgvqthl36301eh612a";
const REDIRECT_URI = "https://www.aramislabs.click/callback";

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

export default function App() {
  const [time, setTime] = useState(new Date());
  const [matricula, setMatricula] = useState("");
  const [msg, setMsg] = useState("");
  const [screen, setScreen] = useState("home");

  const [adminToken, setAdminToken] = useState(null);
  const [adminUser, setAdminUser] = useState(null);

  const [userToken, setUserToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);

  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeTimezone, setEmployeeTimezone] = useState("America/Sao_Paulo");
  const [adminMsg, setAdminMsg] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedAdminToken = localStorage.getItem("admin_id_token");
    const savedAdminUser = localStorage.getItem("admin_user");
    const savedUserToken = localStorage.getItem("user_id_token");
    const savedUserInfo = localStorage.getItem("user_info");

    if (savedAdminToken) setAdminToken(savedAdminToken);
    if (savedAdminUser) setAdminUser(JSON.parse(savedAdminUser));
    if (savedUserToken) setUserToken(savedUserToken);
    if (savedUserInfo) setUserInfo(JSON.parse(savedUserInfo));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");
    const loginType = localStorage.getItem("login_type");

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
        const payload = data.id_token ? decodeJwt(data.id_token) : null;

        if (loginType === "admin") {
          if (data.id_token) {
            localStorage.setItem("admin_id_token", data.id_token);
            setAdminToken(data.id_token);
          }

          if (payload) {
            localStorage.setItem("admin_user", JSON.stringify(payload));
            setAdminUser(payload);
          }

          if (data.access_token) {
            localStorage.setItem("admin_access_token", data.access_token);
          }

          if (data.refresh_token) {
            localStorage.setItem("admin_refresh_token", data.refresh_token);
          }

          setScreen("admin");
          setMsg("Login administrativo realizado com sucesso!");
        } else {
          if (data.id_token) {
            localStorage.setItem("user_id_token", data.id_token);
            setUserToken(data.id_token);
          }

          if (payload) {
            localStorage.setItem("user_info", JSON.stringify(payload));
            setUserInfo(payload);
          }

          if (data.access_token) {
            localStorage.setItem("user_access_token", data.access_token);
          }

          if (data.refresh_token) {
            localStorage.setItem("user_refresh_token", data.refresh_token);
          }

          setScreen("home");
          setMsg("Login realizado com sucesso! Agora clique em Registrar Ponto.");
        }

        localStorage.removeItem("login_type");
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        setMsg(err.message);
      }
    }

    exchangeCodeForToken();
  }, []);

  function loginAdmin() {
    localStorage.setItem("login_type", "admin");

    const loginUrl =
      `${COGNITO_DOMAIN}/oauth2/authorize` +
      `?client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent("openid email profile")}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

    window.location.href = loginUrl;
  }

  function loginClock() {
    localStorage.setItem("login_type", "clock");

    const url =
      `${COGNITO_DOMAIN}/oauth2/authorize` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(COGNITO_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent("openid email profile")}`;

    window.location.href = url;
  }

  function logoutAdmin() {
    localStorage.removeItem("admin_id_token");
    localStorage.removeItem("admin_access_token");
    localStorage.removeItem("admin_refresh_token");
    localStorage.removeItem("admin_user");

    setAdminToken(null);
    setAdminUser(null);
    setScreen("home");
    setMsg("Logout administrativo realizado com sucesso.");
  }

  function logoutUser() {
    localStorage.removeItem("user_id_token");
    localStorage.removeItem("user_access_token");
    localStorage.removeItem("user_refresh_token");
    localStorage.removeItem("user_info");

    setUserToken(null);
    setUserInfo(null);
    setMsg("Logout do usuário realizado com sucesso.");
  }

  async function registrarPonto() {
    try {
      setMsg("");

      const token = localStorage.getItem("user_id_token");

      if (!token) {
        throw new Error("Usuário não autenticado.");
      }

      const res = await fetch(`${API_BASE_URL}/clock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          employee_id: matricula || undefined,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Erro ao registrar ponto: ${errorText}`);
      }

      const data = await res.json();
      setMsg(data.message || "Ponto registrado com sucesso!");
      setMatricula("");
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function cadastrarFuncionario() {
    try {
      setAdminMsg("");

      const token = localStorage.getItem("admin_id_token");

      if (!token) {
        throw new Error("Usuário administrativo não autenticado.");
      }

      const res = await fetch(`${API_BASE_URL}/employees`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: employeeId,
          name: employeeName,
          email: employeeEmail,
          timezone: employeeTimezone,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Erro ao cadastrar funcionário: ${errorText}`);
      }

      setAdminMsg("Funcionário cadastrado com sucesso!");
      setEmployeeId("");
      setEmployeeName("");
      setEmployeeEmail("");
      setEmployeeTimezone("America/Sao_Paulo");
    } catch (err) {
      setAdminMsg(err.message);
    }
  }

  if (screen === "home") {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <div style={{ position: "absolute", top: "20px", left: "20px" }}>
          <button onClick={loginAdmin}>Acesso Administrativo</button>
        </div>

        <h1>Sistema de Ponto</h1>

        <h2>{time.toLocaleTimeString()}</h2>

        <div>
          <input
            placeholder="Matrícula (opcional)"
            value={matricula}
            onChange={(e) => setMatricula(e.target.value)}
          />

          <br />
          <br />

          {!userToken ? (
            <button onClick={loginClock}>Entrar para registrar ponto</button>
          ) : (
            <>
              <p>
                <strong>Usuário autenticado:</strong>{" "}
                {userInfo?.email || userInfo?.name || "Sem identificação"}
              </p>

              <button onClick={registrarPonto}>Registrar Ponto</button>

              <br />
              <br />

              <button onClick={logoutUser}>Logout</button>
            </>
          )}
        </div>

        <p>{msg}</p>
      </div>
    );
  }

  if (screen === "admin") {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <button onClick={() => setScreen("home")}>← Voltar</button>

        <h1>Área Administrativa</h1>

        {adminUser ? (
          <>
            <p>
              <strong>Usuário autenticado:</strong>{" "}
              {adminUser.email || adminUser.name || "Sem identificação"}
            </p>
            <p>
              <strong>Sub:</strong> {adminUser.sub}
            </p>
          </>
        ) : (
          <p>Usuário administrativo autenticado, mas sem dados para exibir.</p>
        )}

        <div
          style={{
            width: "400px",
            margin: "30px auto",
            padding: "20px",
            border: "1px solid #ccc",
            borderRadius: "8px",
            textAlign: "left",
          }}
        >
          <h2 style={{ textAlign: "center" }}>Cadastro de Funcionário</h2>

          <div style={{ marginBottom: "10px" }}>
            <label>ID</label>
            <input
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="Ex: 123"
            />
          </div>

          <div style={{ marginBottom: "10px" }}>
            <label>Nome</label>
            <input
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Ex: João Silva"
            />
          </div>

          <div style={{ marginBottom: "10px" }}>
            <label>E-mail</label>
            <input
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              value={employeeEmail}
              onChange={(e) => setEmployeeEmail(e.target.value)}
              placeholder="Ex: joao@email.com"
            />
          </div>

          <div style={{ marginBottom: "10px" }}>
            <label>Timezone</label>
            <input
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              value={employeeTimezone}
              onChange={(e) => setEmployeeTimezone(e.target.value)}
              placeholder="Ex: America/Sao_Paulo"
            />
          </div>

          <button
            onClick={cadastrarFuncionario}
            style={{
              width: "100%",
              padding: "10px",
              marginTop: "10px",
            }}
          >
            Cadastrar Funcionário
          </button>

          {adminMsg && (
            <p style={{ marginTop: "15px", textAlign: "center" }}>{adminMsg}</p>
          )}
        </div>

        <button onClick={logoutAdmin}>Logout</button>
      </div>
    );
  }

  return null;
}