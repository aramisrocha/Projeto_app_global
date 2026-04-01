import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function App() {
  const [time, setTime] = useState(new Date());
  const [matricula, setMatricula] = useState("");
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState("");
  const [screen, setScreen] = useState("home");

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
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

  // Tela HOME
  if (screen === "home") {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        
        {/* BOTÃO ADMIN */}
        <div style={{ position: "absolute", top: "20px", left: "20px" }}>
          <button onClick={() => setScreen("admin")}>
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

  // Tela ADMIN (simples por enquanto)
  if (screen === "admin") {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <button onClick={() => setScreen("home")}>
          ← Voltar
        </button>

        <h1>Área Administrativa</h1>
        <p>Login administrativo virá aqui (Cognito depois)</p>
      </div>
    );
  }
}