-- ============================================================================
-- Enertex — Sistema de Gestão de Projetos — Schema PostgreSQL
-- ============================================================================
-- Versão 2: substitui o login Microsoft Entra ID (que travou por falta de
-- acesso de administrador no tenant da Enertex) por login simples de
-- email + senha, gerenciado pelo próprio sistema. Hospedagem também deixou
-- de ser Azure (Static Web Apps/Functions/SQL) e passou a ser um serviço
-- Node.js comum + PostgreSQL — qualquer provedor (Render, Railway, Fly.io
-- etc.), sem depender de nenhuma conta/administração corporativa.
--
-- Estratégia de dados (mantida da v1): cada PROJETO continua guardado como
-- um JSON (coluna dados_json, agora JSONB nativo do Postgres) — um projeto
-- por linha. Isso é o que permite dois usuários editarem projetos DIFERENTES
-- ao mesmo tempo sem um sobrescrever o outro, sem precisar normalizar as
-- ~6.870 linhas de lógica existente do app original.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- para gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS gestao;

-- ----------------------------------------------------------------------------
-- Usuários e papéis. senha_hash fica NULL até alguém (o Administrador) definir
-- uma senha para a pessoa — sem senha definida, o login falha (por design).
-- ----------------------------------------------------------------------------
CREATE TABLE gestao.usuarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    nome            TEXT,
    papel           TEXT NOT NULL CHECK (papel IN ('visualizador', 'gerente', 'administrador')),
    senha_hash      TEXT,                                  -- bcrypt; NULL = ainda não pode logar
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Projetos — cada linha é um projeto inteiro (equivalente a DADOS.projects[id]
-- de hoje), guardado como JSONB. nome fica também como coluna "de fora" só
-- pra permitir listar/ordenar sem precisar abrir o JSON inteiro.
--
-- versao é um contador inteiro simples (em vez do ROWVERSION binário do SQL
-- Server) usado para concorrência otimista: quem salva manda a versão que
-- tinha em mãos; se não bater com a atual, é porque alguém salvou por cima
-- nesse meio tempo.
-- ----------------------------------------------------------------------------
CREATE TABLE gestao.projetos (
    id              TEXT PRIMARY KEY,          -- mesmo id (uid()) gerado hoje no frontend
    nome            TEXT NOT NULL,
    complexo_id     TEXT,
    dados_json      JSONB NOT NULL,
    versao          INTEGER NOT NULL DEFAULT 1,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por  UUID REFERENCES gestao.usuarios(id)
);
CREATE INDEX ix_projetos_complexo ON gestao.projetos(complexo_id);

-- ----------------------------------------------------------------------------
-- Escopo: quais projetos cada usuário pode acessar.
-- Administrador NÃO precisa de linhas aqui — ele enxerga tudo por definição
-- (ver regra na API). Gerente e Visualizador só veem o que estiver aqui.
-- ----------------------------------------------------------------------------
CREATE TABLE gestao.usuario_projeto (
    usuario_id      UUID NOT NULL REFERENCES gestao.usuarios(id) ON DELETE CASCADE,
    projeto_id      TEXT NOT NULL REFERENCES gestao.projetos(id) ON DELETE CASCADE,
    concedido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    concedido_por   UUID REFERENCES gestao.usuarios(id),
    PRIMARY KEY (usuario_id, projeto_id)
);

-- ----------------------------------------------------------------------------
-- Visibilidade de aba por papel (o "olhinho" que o Administrador controla).
-- Configuração é GERAL (vale para todos os projetos). Administrador sempre
-- vê tudo (não precisa de linha aqui, ver regra na API).
-- ----------------------------------------------------------------------------
CREATE TABLE gestao.visibilidade_aba_papel (
    papel           TEXT NOT NULL CHECK (papel IN ('visualizador', 'gerente')),
    aba             TEXT NOT NULL,
    visivel         BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (papel, aba)
);

INSERT INTO gestao.visibilidade_aba_papel (papel, aba, visivel) VALUES
('visualizador', 'projeto',      TRUE),
('visualizador', 'ficha',        TRUE),
('visualizador', 'societario',   FALSE),
('visualizador', 'custos',       FALSE),
('visualizador', 'planoAcao',    TRUE),
('visualizador', 'atas',         TRUE),
('visualizador', 'alertas',      TRUE),
('visualizador', 'dashboard',    TRUE),
('visualizador', 'riscos',       TRUE),
('visualizador', 'statusReport', TRUE),
('visualizador', 'encerramento', TRUE),
('visualizador', 'licoes',       TRUE),
('gerente',      'projeto',      TRUE),
('gerente',      'ficha',        TRUE),
('gerente',      'societario',   TRUE),
('gerente',      'custos',       TRUE),
('gerente',      'planoAcao',    TRUE),
('gerente',      'atas',         TRUE),
('gerente',      'alertas',      TRUE),
('gerente',      'dashboard',    TRUE),
('gerente',      'riscos',       TRUE),
('gerente',      'statusReport', TRUE),
('gerente',      'encerramento', TRUE),
('gerente',      'licoes',       TRUE);

-- ----------------------------------------------------------------------------
-- Lixeira — projetos excluídos (soft-delete).
-- ----------------------------------------------------------------------------
CREATE TABLE gestao.lixeira (
    id                   TEXT PRIMARY KEY,
    projeto_id_original  TEXT NOT NULL,
    nome                 TEXT NOT NULL,
    dados_json           JSONB NOT NULL,
    excluido_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    excluido_por         UUID REFERENCES gestao.usuarios(id)
);

-- ----------------------------------------------------------------------------
-- Configuração global compartilhada (chave/valor JSON) — equivalente a
-- DADOS.template, DADOS.templateOrcamento, DADOS.licoes, DADOS.autorPadrao,
-- DADOS.complexos.
-- ----------------------------------------------------------------------------
CREATE TABLE gestao.config_global (
    chave           TEXT PRIMARY KEY,
    valor_json      JSONB NOT NULL,
    versao          INTEGER NOT NULL DEFAULT 1,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO gestao.config_global (chave, valor_json) VALUES ('complexos', '{}'::jsonb);

-- ----------------------------------------------------------------------------
-- Auditoria simples.
-- ----------------------------------------------------------------------------
CREATE TABLE gestao.auditoria (
    id              BIGSERIAL PRIMARY KEY,
    usuario_id      UUID REFERENCES gestao.usuarios(id),
    acao            TEXT NOT NULL,
    projeto_id      TEXT,
    detalhes_json   JSONB,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Bootstrap do primeiro Administrador — troque a senha abaixo antes de rodar
-- (ou, melhor, rode este INSERT manualmente com a senha já em hash bcrypt
-- gerada pelo script server/scripts/criar-usuario.js). Deixado como comentário
-- de propósito para não cadastrar uma senha real direto no schema.
-- ----------------------------------------------------------------------------
-- INSERT INTO gestao.usuarios (email, nome, papel, senha_hash)
-- VALUES ('felipe@enertexenergia.com.br', 'Felipe', 'administrador', '<hash-bcrypt-aqui>');
