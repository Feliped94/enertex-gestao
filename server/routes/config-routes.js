const express = require("express");
const { getPool } = require("../db");
const { exigirLogin } = require("../auth");
const { registrarAuditoria } = require("./projetos-routes");

const CHAVES_VALIDAS = ["template", "templateOrcamento", "licoes", "autorPadrao", "complexos"];

const router = express.Router();

// GET /api/config — configuração global compartilhada + visibilidade de aba
// aplicável ao papel do usuário logado (o "olhinho" do Administrador).
router.get("/", exigirLogin(), async (req, res) => {
  const pool = getPool();
  const [configResult, visibilidadeResult] = await Promise.all([
    pool.query("SELECT chave, valor_json AS valor FROM gestao.config_global"),
    req.usuario.papel === "administrador"
      ? Promise.resolve({ rows: [] })
      : pool.query("SELECT aba, visivel FROM gestao.visibilidade_aba_papel WHERE papel = $1", [req.usuario.papel]),
  ]);

  const config = {};
  for (const row of configResult.rows) config[row.chave] = row.valor;

  const abasOcultas = visibilidadeResult.rows.filter((r) => !r.visivel).map((r) => r.aba);

  res.json({
    ...config,
    meuPapel: req.usuario.papel,
    meuEmail: req.usuario.email,
    abasOcultas: req.usuario.papel === "administrador" ? [] : abasOcultas,
  });
});

// PUT /api/config — edição da configuração global (Gerente ou Administrador)
router.put("/", exigirLogin("gerente"), async (req, res) => {
  const body = req.body;
  if (!body || !CHAVES_VALIDAS.includes(body.chave)) {
    return res.status(400).json({ erro: `Chave inválida. Use uma de: ${CHAVES_VALIDAS.join(", ")}.` });
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO gestao.config_global (chave, valor_json)
     VALUES ($1, $2)
     ON CONFLICT (chave) DO UPDATE SET valor_json = $2, atualizado_em = now()`,
    [body.chave, body.valor]
  );

  await registrarAuditoria(req.usuario.id, "editar_config", null, { chave: body.chave });
  res.json({ ok: true });
});

module.exports = router;
