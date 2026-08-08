#!/usr/bin/env node
/**
 * Aplica um arquivo .sql estatuto-por-estatuto usando o driver HTTP da Neon
 * (@neondatabase/serverless) — usado quando a rede de onde este script roda
 * não permite conexão TCP direta na porta 5432 (só HTTPS/443 sai), mas
 * consegue alcançar a API HTTP da Neon normalmente.
 *
 * Uso:
 *   DATABASE_URL="postgres://..." node scripts/aplicar-schema-http.js ../sql/schema.sql
 */
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error("Uso: node aplicar-schema-http.js caminho/para/arquivo.sql");
    process.exit(1);
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Defina DATABASE_URL antes de rodar.");
    process.exit(1);
  }

  const sql = neon(connectionString);
  const bruto = fs.readFileSync(path.resolve(arquivo), "utf-8");

  // Remove comentários (linha inteira ou "-- ..." no final da linha) e
  // divide em statements por ";". (Este schema não usa $$ ... $$ nem
  // strings com "--" ou ";" dentro, então a divisão simples é segura.)
  const semComentarios = bruto
    .split("\n")
    .map((linha) => {
      const idx = linha.indexOf("--");
      return idx === -1 ? linha : linha.slice(0, idx);
    })
    .join("\n");

  const statements = semComentarios
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`Aplicando ${statements.length} statements...`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await sql.query(stmt);
      console.log(`[${i + 1}/${statements.length}] OK`);
    } catch (e) {
      console.error(`[${i + 1}/${statements.length}] ERRO em: ${stmt.slice(0, 80)}...`);
      console.error(e.message || e);
      process.exit(1);
    }
  }
  console.log("Schema aplicado com sucesso.");
}

main().catch((e) => {
  console.error("Erro:", e);
  process.exit(1);
});
