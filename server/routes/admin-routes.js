const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../db");
const { exigirLogin } = require("../auth");
const { registrarAuditoria } = require("./projetos-routes");

const PAPEIS_VALIDOS = ["visualizador", "gerente", "administrador"];

const router = express.Router();
router.use(exigirLogin("administrador"));

// GET /api/admin/usuarios — lista usuários + projetos atribuídos a cada um
router.get("/usuarios", async (req, res) => {
  const pool = getPool();
  const [usuarios, escopos] = await Promise.all([
    pool.query("SELECT id, email, nome, papel, ativo FROM gestao.usuarios ORDER BY email"),
    pool.query('SELECT usuario_id AS "usuarioId", projeto_id AS "projetoId" FROM gestao.usuario_projeto'),
  ]);
  const projetosPorUsuario = {};
  for (const row of escopos.rows) (projetosPorUsuario[row.usuarioId] ||= []).push(row.projetoId);
  const lista = usuarios.rows.map((u) => ({ ...u, projetos: projetosPorUsuario[u.id] || [] }));
  res.json({ usuarios: lista });
});

// POST /api/admin/usuarios — cria ou atualiza um usuário (email, nome, papel).
// Se vier `senha`, define/redefine a senha de acesso dessa pessoa — combine
// essa senha inicial com ela por fora do sistema (WhatsApp, presencialmente
// etc.); ela pode trocá-la depois de logar (menu do usuário > Trocar senha).
router.post("/usuarios", async (req, res) => {
  const body = req.body;
  if (!body || !body.email || !PAPEIS_VALIDOS.includes(body.papel)) {
    return res.status(400).json({
      erro: `Corpo inválido — esperado { email, nome?, papel, senha? } com papel em ${PAPEIS_VALIDOS.join("/")}.`,
    });
  }
  const email = body.email.toLowerCase().trim();
  const senhaHash = body.senha ? await bcrypt.hash(body.senha, 10) : null;

  const pool = getPool();
  if (senhaHash) {
    await pool.query(
      `INSERT INTO gestao.usuarios (email, nome, papel, senha_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE
         SET nome = COALESCE($2, gestao.usuarios.nome), papel = $3, senha_hash = $4, ativo = true, atualizado_em = now()`,
      [email, body.nome || null, body.papel, senhaHash]
    );
  } else {
    await pool.query(
      `INSERT INTO gestao.usuarios (email, nome, papel)
       VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE
         SET nome = COALESCE($2, gestao.usuarios.nome), papel = $3, ativo = true, atualizado_em = now()`,
      [email, body.nome || null, body.papel]
    );
  }

  await registrarAuditoria(req.usuario.id, "cadastrar_usuario", null, { email, papel: body.papel });
  res.json({ ok: true });
});

// PUT /api/admin/usuarios/:id/senha — redefine só a senha (ex: pessoa esqueceu)
router.put("/usuarios/:id/senha", async (req, res) => {
  const { senha } = req.body || {};
  if (!senha || senha.length < 8) return res.status(400).json({ erro: "Senha precisa ter pelo menos 8 caracteres." });
  const hash = await bcrypt.hash(senha, 10);
  const pool = getPool();
  await pool.query("UPDATE gestao.usuarios SET senha_hash = $1, atualizado_em = now() WHERE id = $2", [
    hash,
    req.params.id,
  ]);
  await registrarAuditoria(req.usuario.id, "redefinir_senha", null, { usuarioId: req.params.id });
  res.json({ ok: true });
});

// PUT /api/admin/usuarios/:id/ativo — ativa/desativa um usuário (bloqueia login sem excluir o cadastro)
router.put("/usuarios/:id/ativo", async (req, res) => {
  const { ativo } = req.body || {};
  const pool = getPool();
  await pool.query("UPDATE gestao.usuarios SET ativo = $1, atualizado_em = now() WHERE id = $2", [
    !!ativo,
    req.params.id,
  ]);
  res.json({ ok: true });
});

// PUT /api/admin/usuarios/:id/projetos — define (substitui) o escopo de projetos de um usuário
router.put("/usuarios/:id/projetos", async (req, res) => {
  const usuarioId = req.params.id;
  const body = req.body;
  if (!body || !Array.isArray(body.projetoIds)) {
    return res.status(400).json({ erro: "Corpo inválido — esperado { projetoIds: [...] }." });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM gestao.usuario_projeto WHERE usuario_id = $1", [usuarioId]);
    for (const projetoId of body.projetoIds) {
      await client.query(
        "INSERT INTO gestao.usuario_projeto (usuario_id, projeto_id, concedido_por) VALUES ($1,$2,$3)",
        [usuarioId, projetoId, req.usuario.id]
      );
    }
    await client.query(
      "INSERT INTO gestao.auditoria (usuario_id, acao, projeto_id, detalhes_json) VALUES ($1,'atribuir_acesso',NULL,$2)",
      [req.usuario.id, { usuarioId, projetoIds: body.projetoIds }]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Erro ao definir escopo:", e);
    return res.status(500).json({ erro: "Falha ao salvar os projetos atribuídos." });
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// PUT /api/admin/visibilidade-aba — o "olhinho": liga/desliga uma aba para um papel
router.put("/visibilidade-aba", async (req, res) => {
  const body = req.body;
  if (!body || !["visualizador", "gerente"].includes(body.papel) || !body.aba || typeof body.visivel !== "boolean") {
    return res
      .status(400)
      .json({ erro: "Corpo inválido — esperado { papel: 'visualizador'|'gerente', aba, visivel: true|false }." });
  }
  const pool = getPool();
  await pool.query(
    `INSERT INTO gestao.visibilidade_aba_papel (papel, aba, visivel)
     VALUES ($1,$2,$3)
     ON CONFLICT (papel, aba) DO UPDATE SET visivel = $3`,
    [body.papel, body.aba, body.visivel]
  );
  await registrarAuditoria(req.usuario.id, "alterar_visibilidade", null, body);
  res.json({ ok: true });
});

// GET /api/admin/visibilidade-aba — lista o estado atual de todas as abas x papéis
router.get("/visibilidade-aba", async (req, res) => {
  const pool = getPool();
  const result = await pool.query("SELECT papel, aba, visivel FROM gestao.visibilidade_aba_papel ORDER BY papel, aba");
  res.json({ itens: result.rows });
});

module.exports = router;
