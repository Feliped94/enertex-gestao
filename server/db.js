const { Pool } = require("pg");

/** @type {import('pg').Pool | null} */
let pool = null;

/**
 * Pool de conexão único, reaproveitado entre requisições.
 * DATABASE_URL vem do provedor de hospedagem (Render/Railway/Neon/etc. já
 * fornecem essa variável automaticamente quando o banco Postgres é criado
 * junto com o serviço web).
 */
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL não configurada. Defina essa variável de ambiente com a connection string do PostgreSQL."
      );
    }
    pool = new Pool({
      connectionString,
      // A maioria dos provedores gerenciados (Render, Railway, Neon, Supabase)
      // exige SSL mas usa certificado que o Node não reconhece por padrão.
      // Defina PGSSL=false só se estiver rodando contra um Postgres local sem SSL.
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
      // Sem isso, uma conexão que trava (ex.: rede instável, banco "acordando"
      // de um estado suspenso) deixa a requisição pendurada pra sempre em vez
      // de falhar com um erro claro que o app pode tratar.
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 5,
    });

    pool.on("error", (err) => {
      // Erros em conexões ociosas do pool não devem derrubar o processo.
      console.error("Erro inesperado no pool do Postgres:", err.message || err);
    });
  }
  return pool;
}

module.exports = { getPool };
