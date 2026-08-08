const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../db");
const { emitirToken, definirCookieSessao, limparCookieSessao, exigirLogin } = require("../auth");

const router = express.Router();

// POST /api/login — { email, senha }
router.post("/login", async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: "Informe email e senha." });

  const pool = getPool();
  const result = await pool.query(
    "SELECT id, email, nome, papel, ativo, senha_hash FROM gestao.usuarios WHERE email = $1",
    [String(email).toLowerCase().trim()]
  );
  const row = result.rows[0];
  if (!row || !row.ativo || !row.senha_hash) {
    return res.status(401).json({ erro: "Email ou senha inválidos." });
  }

  const ok = await bcrypt.compare(senha, row.senha_hash);
  if (!ok) return res.status(401).json({ erro: "Email ou senha inválidos." });

  const token = emitirToken(row);
  definirCookieSessao(res, token);
  res.json({ ok: true, usuario: { email: row.email, nome: row.nome, papel: row.papel } });
});

// POST /api/logout
router.post("/logout", (req, res) => {
  limparCookieSessao(res);
  res.json({ ok: true });
});

// GET /api/eu — quem está logado agora (para a página recarregar sabendo o estado)
router.get("/eu", exigirLogin(), (req, res) => {
  res.json({ usuario: req.usuario });
});

// POST /api/trocar-senha — { senhaAtual?, novaSenha } — qualquer usuário logado troca a própria senha
router.post("/trocar-senha", exigirLogin(), async (req, res) => {
  const { senhaAtual, novaSenha } = req.body || {};
  if (!novaSenha || novaSenha.length < 8) {
    return res.status(400).json({ erro: "A nova senha precisa ter pelo menos 8 caracteres." });
  }

  const pool = getPool();
  const result = await pool.query("SELECT senha_hash FROM gestao.usuarios WHERE id = $1", [req.usuario.id]);
  const row = result.rows[0];

  if (row.senha_hash) {
    const ok = senhaAtual && (await bcrypt.compare(senhaAtual, row.senha_hash));
    if (!ok) return res.status(401).json({ erro: "Senha atual incorreta." });
  }

  const novoHash = await bcrypt.hash(novaSenha, 10);
  await pool.query("UPDATE gestao.usuarios SET senha_hash = $1, atualizado_em = now() WHERE id = $2", [
    novoHash,
    req.usuario.id,
  ]);
  res.json({ ok: true });
});

module.exports = router;
