const express = require("express");
const crypto = require("crypto");
const { getPool } = require("../db");
const { exigirLogin, usuarioTemAcessoAoProjeto } = require("../auth");

const router = express.Router();

async function registrarAuditoria(usuarioId, acao, projetoId, detalhes) {
  const pool = getPool();
  await pool.query(
    "INSERT INTO gestao.auditoria (usuario_id, acao, projeto_id, detalhes_json) VALUES ($1,$2,$3,$4)",
    [usuarioId, acao, projetoId || null, detalhes || null]
  );
}

// GET /api/projetos — lista os projetos que o usuário logado pode ver
router.get("/", exigirLogin(), async (req, res) => {
  const pool = getPool();
  let result;
  if (req.usuario.papel === "administrador") {
    result = await pool.query(
      'SELECT id, nome, complexo_id AS "complexoId", atualizado_em AS "atualizadoEm" FROM gestao.projetos ORDER BY nome'
    );
  } else {
    result = await pool.query(
      `SELECT p.id, p.nome, p.complexo_id AS "complexoId", p.atualizado_em AS "atualizadoEm"
       FROM gestao.projetos p
       INNER JOIN gestao.usuario_projeto up ON up.projeto_id = p.id
       WHERE up.usuario_id = $1
       ORDER BY p.nome`,
      [req.usuario.id]
    );
  }
  res.json({ projetos: result.rows, meuPapel: req.usuario.papel, meuEmail: req.usuario.email });
});

// GET /api/projetos/:id — dados completos de um projeto (checa escopo)
router.get("/:id", exigirLogin(), async (req, res) => {
  const { id } = req.params;
  if (!(await usuarioTemAcessoAoProjeto(req.usuario, id))) {
    return res.status(403).json({ erro: "Você não tem acesso a este projeto." });
  }
  const pool = getPool();
  const result = await pool.query(
    'SELECT id, nome, complexo_id AS "complexoId", dados_json AS dados, versao FROM gestao.projetos WHERE id = $1',
    [id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ erro: "Projeto não encontrado (pode ter sido movido para a lixeira)." });
  res.json({ id: row.id, nome: row.nome, complexoId: row.complexoId, dados: row.dados, versao: row.versao });
});

// POST /api/projetos — cria um novo projeto (Gerente ou Administrador)
router.post("/", exigirLogin("gerente"), async (req, res) => {
  const body = req.body;
  if (!body || !body.id || !body.nome || !body.dados) {
    return res.status(400).json({ erro: "Corpo inválido — esperado { id, nome, complexoId?, dados }." });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO gestao.projetos (id, nome, complexo_id, dados_json, atualizado_por) VALUES ($1,$2,$3,$4,$5)",
      [body.id, body.nome, body.complexoId || null, body.dados, req.usuario.id]
    );
    if (req.usuario.papel !== "administrador") {
      await client.query(
        "INSERT INTO gestao.usuario_projeto (usuario_id, projeto_id, concedido_por) VALUES ($1,$2,$3)",
        [req.usuario.id, body.id, req.usuario.id]
      );
    }
    await client.query(
      "INSERT INTO gestao.auditoria (usuario_id, acao, projeto_id, detalhes_json) VALUES ($1,'criar_projeto',$2,$3)",
      [req.usuario.id, body.id, { nome: body.nome }]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Erro ao criar projeto:", e);
    return res.status(500).json({ erro: "Falha ao criar projeto." });
  } finally {
    client.release();
  }
  res.status(201).json({ id: body.id });
});

// PUT /api/projetos/:id — atualiza um projeto, com checagem de conflito de
// edição concorrente via versao (contador inteiro).
router.put("/:id", exigirLogin("gerente"), async (req, res) => {
  const { id } = req.params;
  if (!(await usuarioTemAcessoAoProjeto(req.usuario, id))) {
    return res.status(403).json({ erro: "Você não tem acesso a este projeto." });
  }

  const body = req.body;
  if (!body || !body.dados) {
    return res.status(400).json({ erro: "Corpo inválido — esperado { dados, nome?, versaoEsperada? }." });
  }

  const pool = getPool();
  const params = [body.dados, body.nome || null, req.usuario.id, id];
  let query = `
    UPDATE gestao.projetos
    SET dados_json = $1,
        nome = COALESCE($2, nome),
        atualizado_em = now(),
        atualizado_por = $3,
        versao = versao + 1
    WHERE id = $4
  `;
  if (body.versaoEsperada) {
    params.push(body.versaoEsperada);
    query += ` AND versao = $${params.length}`;
  }
  query += " RETURNING versao";

  const result = await pool.query(query, params);

  if (result.rows.length === 0) {
    const atual = await pool.query(
      'SELECT dados_json AS dados, versao, atualizado_em AS "atualizadoEm" FROM gestao.projetos WHERE id = $1',
      [id]
    );
    if (!atual.rows[0]) return res.status(404).json({ erro: "Projeto não encontrado." });
    return res.status(409).json({
      erro: "Conflito: este projeto foi alterado por outra pessoa desde que você abriu. Recarregue antes de salvar de novo.",
      dadosAtuais: atual.rows[0].dados,
      versaoAtual: atual.rows[0].versao,
      atualizadoEm: atual.rows[0].atualizadoEm,
    });
  }

  await registrarAuditoria(req.usuario.id, "editar_projeto", id);
  res.json({ versao: result.rows[0].versao });
});

// POST /api/projetos/:id/lixeira — move o projeto pra lixeira (soft-delete)
router.post("/:id/lixeira", exigirLogin("gerente"), async (req, res) => {
  const { id } = req.params;
  if (!(await usuarioTemAcessoAoProjeto(req.usuario, id))) {
    return res.status(403).json({ erro: "Você não tem acesso a este projeto." });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proj = await client.query("SELECT id, nome, dados_json AS dados FROM gestao.projetos WHERE id = $1", [id]);
    if (!proj.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erro: "Projeto não encontrado." });
    }
    const p = proj.rows[0];

    await client.query(
      "INSERT INTO gestao.lixeira (id, projeto_id_original, nome, dados_json, excluido_por) VALUES ($1,$2,$3,$4,$5)",
      [crypto.randomUUID(), p.id, p.nome, p.dados, req.usuario.id]
    );
    await client.query("DELETE FROM gestao.projetos WHERE id = $1", [id]);
    await client.query(
      "INSERT INTO gestao.auditoria (usuario_id, acao, projeto_id, detalhes_json) VALUES ($1,'mover_lixeira',$2,$3)",
      [req.usuario.id, id, { nome: p.nome }]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Erro ao mover para lixeira:", e);
    return res.status(500).json({ erro: "Falha ao mover projeto para a lixeira." });
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

module.exports = { router, registrarAuditoria };
