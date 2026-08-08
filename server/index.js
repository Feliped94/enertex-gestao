require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const authRoutes = require("./routes/auth-routes");
const { router: projetosRoutes } = require("./routes/projetos-routes");
const lixeiraRoutes = require("./routes/lixeira-routes");
const configRoutes = require("./routes/config-routes");
const adminRoutes = require("./routes/admin-routes");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Só é preciso configurar CORS_ORIGIN se o frontend for servido separado da
// API (domínios diferentes). Como este servidor serve os dois juntos (ver
// abaixo), isso normalmente não é necessário.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
}

app.use("/api", authRoutes);
app.use("/api/projetos", projetosRoutes);
app.use("/api/lixeira", lixeiraRoutes);
app.use("/api/config", configRoutes);
app.use("/api/admin", adminRoutes);

// Serve o frontend (arquivo único) e qualquer estático junto dele.
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ erro: "Rota não encontrada." });
  res.sendFile(path.join(FRONTEND_DIR, "gestao-projeto-enertex.html"));
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`Servidor rodando na porta ${PORTA}`));
