#!/usr/bin/env node
/**
 * Importa os dados do sistema original (localStorage / arquivo exportado)
 * para o PostgreSQL novo. Rodar UMA VEZ, depois que o schema.sql já tiver
 * sido aplicado e o servidor já estiver no ar.
 *
 * Como gerar o arquivo de entrada:
 *   No sistema HTML original (o arquivo local, antes da migração), clique em
 *   "Exportar" no cabeçalho — isso baixa um .json com todo o conteúdo de
 *   DADOS (projetos, complexos, template, licoes, etc.).
 *
 * Uso:
 *   DATABASE_URL="postgres://..." node importar-dados.js caminho/para/export.json
 *
 * Este script conecta DIRETO no banco (não passa pela API/login) — é uma
 * operação administrativa única. Rode só uma vez; rodar de novo duplica
 * projetos (o script AVISA e pula projetos com id já existente, mas não
 * atualiza os que já existirem).
 */

const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");

async function main() {
  const caminhoArquivo = process.argv[2];
  if (!caminhoArquivo) {
    console.error("Uso: node importar-dados.js caminho/para/export.json");
    process.exit(1);
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Defina a variável de ambiente DATABASE_URL antes de rodar.");
    process.exit(1);
  }

  const bruto = fs.readFileSync(caminhoArquivo, "utf-8");
  const dados = JSON.parse(bruto);

  const pool = new Pool({ connectionString, ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false } });
  console.log("Conectado ao banco. Iniciando importação...");

  let projetosImportados = 0;
  let projetosPulados = 0;

  for (const [id, projeto] of Object.entries(dados.projects || {})) {
    const existe = await pool.query("SELECT 1 FROM gestao.projetos WHERE id = $1", [id]);
    if (existe.rows.length) {
      console.log(`- Projeto "${projeto.nome}" (${id}) já existe no banco — pulando.`);
      projetosPulados++;
      continue;
    }
    await pool.query(
      "INSERT INTO gestao.projetos (id, nome, complexo_id, dados_json) VALUES ($1,$2,$3,$4)",
      [id, projeto.nome || "(sem nome)", projeto.complexoId || null, projeto]
    );
    console.log(`+ Projeto "${projeto.nome}" importado.`);
    projetosImportados++;
  }

  // Configuração global compartilhada
  const configs = {
    template: dados.template || {},
    templateOrcamento: dados.templateOrcamento || [],
    licoes: dados.licoes || [],
    autorPadrao: dados.autorPadrao || "",
    complexos: dados.complexos || {},
  };
  for (const [chave, valor] of Object.entries(configs)) {
    await pool.query(
      `INSERT INTO gestao.config_global (chave, valor_json)
       VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor_json = $2, atualizado_em = now()`,
      [chave, valor]
    );
    console.log(`+ Configuração '${chave}' importada.`);
  }

  // Itens que já estavam na lixeira local (opcional — migra também, pra não perder histórico)
  const lixeiraAntiga = dados.lixeira || [];
  let lixeiraImportada = 0;
  for (const item of lixeiraAntiga) {
    await pool.query(
      "INSERT INTO gestao.lixeira (id, projeto_id_original, nome, dados_json) VALUES ($1,$2,$3,$4)",
      [
        item.id || crypto.randomUUID(),
        item.projeto ? item.projeto.id : "desconhecido",
        item.nome || "(sem nome)",
        item.projeto || {},
      ]
    );
    lixeiraImportada++;
  }

  console.log("\nResumo da importação:");
  console.log(`  Projetos importados: ${projetosImportados}`);
  console.log(`  Projetos pulados (já existiam): ${projetosPulados}`);
  console.log(`  Itens de lixeira migrados: ${lixeiraImportada}`);
  console.log("\nImportante: os projetos importados ainda não têm NINGUÉM com acesso liberado");
  console.log("(exceto o Administrador, que vê tudo). Vá em Administração no sistema e atribua");
  console.log("os projetos aos usuários certos (Gerente/Visualizador).");

  await pool.end();
}

main().catch((e) => {
  console.error("Erro na importação:", e);
  process.exit(1);
});
