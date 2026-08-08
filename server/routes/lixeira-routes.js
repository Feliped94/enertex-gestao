const express = require("express");
const { getPool } = require("../db");
const { exigirLogin } = require("../auth");
const { registrarAuditoria } = require("./projetos-routes");

const router = express.Router();

// GET /api/lixeira — Administrador vê tudo. Gerente só vê o que ELE excluiu.
router.get("/", exigirLogin("gerente"), async (req, res) => {
  const pool = getPool();
  let result;
  if (req.usuario.papel === "administrador") {
    result = await pool.query(
      'SELECT id, nome, excluido_em AS "excluidoEm" FROM gestao.lixeira ORDER BY excluido_em DESC'
    );
  } else {
    result = await pool.query(
      'SELECT id, nome, excluido_em AS "excluidoEm" FROM gestao.lixeira WHERE excluido_por = $1 ORDER BY excluido_em DESC',
      [req.usuario.id]
    );
  }
  res.json({ itens: result.rows });
});

// POST /api/lixeira/esvaziar — (só Administrador). Rota literal, definida
// antes de "/:id/restaurar" por clareza (não colidem, mas evita confusão).
router.post("/esvaziar", exigirLogin(), async (req, res) => {
  if (req.usuario.papel !== "administrador") {
    return res.status(403).json({ erro: "Só o Administrador pode esvaziar a lixeira." });
  }
  const pool = getPool();
  await pool.query("DELETE FROM gestao.lixeira");
  await registrarAuditoria(req.usuario.id, "esvaziar_lixeira", null);
  res.json({ ok: true });
});

// POST /api/lixeira/:id/restaurar
router.post("/:id/restaurar", exigirLogin("gerente"), async (req, res) => {
  const { id } = req.params;
  const pool = getPool();

  const itemResult =
    req.usuario.papel === "administrador"
      ? await pool.query("SELECT * FROM gestao.lixeira WHERE id = $1", [id])
      : await pool.query("SELECT * FROM gestao.lixeira WHERE id = $1 AND excluido_por = $2", [id, req.usuario.id]);

  const item = itemResult.rows[0];
  if (!item) return res.status(404).json({ erro: "Item não encontrado na lixeira (ou você não pode restaurá-lo)." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO gestao.projetos (id, nome, dados_json, atualizado_por) VALUES ($1,$2,$3,$4)",
      [item.projeto_id_original, item.nome, item.dados_json, req.usuario.id]
    );
    if (req.usuario.papel !== "administrador") {
      await client.query(
        "INSERT INTO gestao.usuario_projeto (usuario_id, projeto_id, concedido_por) VALUES ($1,$2,$3)",
        [req.usuario.id, item.projeto_id_original, req.usuario.id]
      );
    }
    await client.query("DELETE FROM gestao.lixeira WHERE id = $1", [id]);
    await client.query(
      "INSERT INTO gestao.auditoria (usuario_id, acao, projeto_id, detalhes_json) VALUES ($1,'restaurar',$2,$3)",
      [req.usuario.id, item.projeto_id_original, { nome: item.nome }]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Erro ao restaurar:", e);
    return res.status(500).json({
      erro: "Falha ao restaurar projeto. Se o problema for 'já existe um projeto com esse id', avise o administrador.",
    });
  } finally {
    client.release();
  }
  res.json({ ok: true, projetoId: item.projeto_id_original });
});

// DELETE /api/lixeira/:id — exclusão definitiva (só Administrador)
router.delete("/:id", exigirLogin(), async (req, res) => {
  if (req.usuario.papel !== "administrador") {
    return res.status(403).json({ erro: "Só o Administrador pode excluir definitivamente." });
  }
  const { id } = req.params;
  const pool = getPool();
  const result = await pool.query("DELETE FROM gestao.lixeira WHERE id = $1", [id]);
  if (result.rowCount === 0) return res.status(404).json({ erro: "Item não encontrado." });
  await registrarAuditoria(req.usuario.id, "excluir_definitivo", id);
  res.json({ ok: true });
});

module.exports = router;
