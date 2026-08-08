const jwt = require("jsonwebtoken");
const { getPool } = require("./db");

const HIERARQUIA = { visualizador: 1, gerente: 2, administrador: 3 };
const COOKIE_NOME = "enertex_sessao";
const SEGREDO = process.env.JWT_SECRET || "troque-isto-em-producao-defina-JWT_SECRET";

if (!process.env.JWT_SECRET) {
  console.warn(
    "AVISO: variável JWT_SECRET não definida — usando um valor padrão inseguro. Defina JWT_SECRET antes de ir para produção."
  );
}

function emitirToken(usuario) {
  return jwt.sign({ id: usuario.id, email: usuario.email }, SEGREDO, { expiresIn: "30d" });
}

function definirCookieSessao(res, token) {
  res.cookie(COOKIE_NOME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function limparCookieSessao(res) {
  res.clearCookie(COOKIE_NOME);
}

/** Resolve o usuário logado a partir do cookie de sessão (JWT). */
async function usuarioAtual(req) {
  const token = req.cookies && req.cookies[COOKIE_NOME];
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, SEGREDO);
  } catch (e) {
    return null;
  }

  const pool = getPool();
  const result = await pool.query(
    "SELECT id, email, nome, papel, ativo FROM gestao.usuarios WHERE id = $1",
    [payload.id]
  );
  const row = result.rows[0];
  if (!row || !row.ativo) return null;

  return { id: row.id, email: row.email, nome: row.nome, papel: row.papel };
}

function papelAtendeMinimo(papel, minimo) {
  return !!papel && HIERARQUIA[papel] >= HIERARQUIA[minimo];
}

function respostaSemAcesso(res, motivo, status = 403) {
  return res.status(status).json({ erro: motivo || "Acesso negado." });
}

async function usuarioTemAcessoAoProjeto(usuario, projetoId) {
  if (usuario.papel === "administrador") return true;
  const pool = getPool();
  const result = await pool.query(
    "SELECT 1 FROM gestao.usuario_projeto WHERE usuario_id = $1 AND projeto_id = $2",
    [usuario.id, projetoId]
  );
  return result.rows.length > 0;
}

/**
 * Middleware Express: exige login (e, opcionalmente, um papel mínimo).
 * Em caso de sucesso, anexa req.usuario.
 */
function exigirLogin(minimo) {
  return async (req, res, next) => {
    let usuario;
    try {
      usuario = await usuarioAtual(req);
    } catch (e) {
      console.error("Erro ao resolver usuário logado:", e);
      return res.status(500).json({ erro: "Falha ao verificar sua sessão." });
    }
    if (!usuario) return respostaSemAcesso(res, "Você precisa entrar no sistema.", 401);
    if (minimo && !papelAtendeMinimo(usuario.papel, minimo)) {
      return respostaSemAcesso(res, "Seu papel não tem permissão para esta ação.");
    }
    req.usuario = usuario;
    next();
  };
}

module.exports = {
  HIERARQUIA,
  COOKIE_NOME,
  emitirToken,
  definirCookieSessao,
  limparCookieSessao,
  usuarioAtual,
  papelAtendeMinimo,
  respostaSemAcesso,
  usuarioTemAcessoAoProjeto,
  exigirLogin,
};
