#!/usr/bin/env node
/**
 * Cria (ou redefine a senha de) um usuário direto no banco — útil para o
 * bootstrap do primeiro Administrador, antes de existir qualquer usuário
 * que possa logar na tela de Administração do próprio sistema.
 *
 * Uso:
 *   DATABASE_URL="postgres://..." node scripts/criar-usuario.js \
 *     felipe@enertexenergia.com.br "Felipe" administrador "SenhaTemporaria123"
 *
 * Depois disso, faça login com esse email/senha e troque a senha pelo menu
 * do próprio sistema (ou cadastre os demais usuários pela tela de Administração).
 */
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

async function main() {
  const [email, nome, papel, senha] = process.argv.slice(2);
  if (!email || !papel || !senha) {
    console.error('Uso: node criar-usuario.js <email> <nome> <papel: visualizador|gerente|administrador> <senha>');
    process.exit(1);
  }
  if (!["visualizador", "gerente", "administrador"].includes(papel)) {
    console.error("Papel inválido. Use: visualizador, gerente ou administrador.");
    process.exit(1);
  }
  if (senha.length < 8) {
    console.error("A senha precisa ter pelo menos 8 caracteres.");
    process.exit(1);
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Defina a variável de ambiente DATABASE_URL antes de rodar.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false } });
  const senhaHash = await bcrypt.hash(senha, 10);

  await pool.query(
    `INSERT INTO gestao.usuarios (email, nome, papel, senha_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE
       SET nome = COALESCE($2, gestao.usuarios.nome), papel = $3, senha_hash = $4, ativo = true, atualizado_em = now()`,
    [email.toLowerCase().trim(), nome || null, papel, senhaHash]
  );

  console.log(`Usuário "${email}" criado/atualizado com papel "${papel}".`);
  await pool.end();
}

main().catch((e) => {
  console.error("Erro:", e);
  process.exit(1);
});
