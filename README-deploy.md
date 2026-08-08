# Enertex — Sistema de Gestão de Projetos na Nuvem — Guia de Implantação (v2)

**Esta é a versão 2 do plano.** A v1 usava login via Microsoft Entra ID (SSO
com a conta @enertexenergia.com.br) e hospedagem 100% Azure. Isso travou
porque a conta do Felipe não tem nenhum papel de administrador no tenant
Microsoft 365 da Enertex, e não havia outro administrador disponível para
liberar isso — um bloqueio de permissão fora do nosso controle, não um
problema técnico do sistema em si.

**Mudança:** login por email + senha, gerenciado pelo próprio sistema (sem
depender de nenhuma conta Microsoft/corporativa) e hospedagem num provedor
onde quem cria a conta já é o dono/administrador dela — sem "tenant", sem
aprovação de terceiros. O sistema em si (papéis Visualizador/Gerente/
Administrador, escopo por projeto, Lixeira, olhinho de visibilidade de aba)
é exatamente o mesmo — só a camada de login e o lugar onde ele mora mudaram.

Testado de ponta a ponta localmente antes deste guia: login, logout, troca
de senha, criação/edição de projeto com detecção de conflito de edição
simultânea, mover/restaurar da lixeira, e as permissões de cada papel.

## Provedor recomendado: 100% gratuito (Render + Neon)

Combinação testada, sem custo nenhum, sem cartão de crédito e sem prazo de
expiração (não é um "trial" de 30 dias — o plano gratuito continua
funcionando indefinidamente):

- **Render** (render.com) — hospeda o servidor Node (`server/`). Plano
  gratuito: fica "dormindo" depois de 15 minutos sem acesso, e demora
  cerca de 1 minuto para "acordar" no primeiro acesso seguinte (normal
  para uso interno de uma equipe — o segundo acesso já é rápido).
- **Neon** (neon.tech) — hospeda o banco PostgreSQL de verdade, sem prazo
  de expiração (diferente do Postgres gratuito do próprio Render, que
  expira em 30 dias). Também "dorme" depois de 5 minutos sem uso, mas
  acorda automaticamente e sozinho na próxima consulta (sem precisar
  clicar em nada) — bem mais rápido que o do Render, quase imperceptível.

Se no futuro o uso crescer (muitas pessoas, uso o dia inteiro) e o "acordar"
começar a incomodar, dá pra migrar para um plano pago (Render Starter,
~US$ 7/mês, elimina o soneca) sem precisar mudar nada no código.

(Alternativa que também funciona, mas é paga desde o início — cerca de
US$ 5/mês —, com tudo num painel só e sem soneca: Railway, railway.com.)

## Passo 1 — Criar as duas contas (só você pode fazer isso)

1. Acesse https://neon.tech e crie uma conta gratuita (email ou GitHub —
   não pede cartão de crédito).
2. Acesse https://render.com e crie uma conta gratuita (idem, sem cartão).

## Passo 2 — Criar o banco no Neon e aplicar o schema

1. No painel do Neon, crie um novo projeto (ex: "enertex-gestao").
2. Copie a "Connection string" (algo como `postgres://usuario:senha@ep-xxx.neon.tech/neondb?sslmode=require`).
3. Aplique o schema (dá pra rodar do seu computador, ou me passar essa
   connection string com segurança para eu rodar por você):

```bash
psql "<CONNECTION_STRING_DO_NEON>" -f sql/schema.sql
```

## Passo 3 — Criar o serviço web no Render

1. No painel do Render, "New +" → "Web Service".
2. Se o código estiver num repositório Git (GitHub), conecte o repositório
   e aponte "Root Directory" para `server/`. Se preferir não usar Git,
   também dá pra publicar direto por upload/CLI do Render.
3. Build Command: `npm install`. Start Command: `npm start`.
4. Plano: **Free**.

## Passo 4 — Configurar as variáveis de ambiente do serviço web

Na aba "Environment" do serviço, no painel do Render:

```
DATABASE_URL = <a connection string do Neon, do Passo 2>
JWT_SECRET   = (qualquer texto longo e aleatório — ex: gerado com openssl rand -hex 32)
NODE_ENV     = production
```

## Passo 5 — Publicar

O Render publica automaticamente após salvar as configurações (ou a cada
push no repositório, se conectado via Git). Ele expõe uma URL pública tipo
`https://enertex-gestao.onrender.com` — visível na página do serviço.

## Passo 6 — Criar o primeiro Administrador (bootstrap)

Antes de existir qualquer usuário, ninguém consegue abrir a tela de
Administração de dentro do sistema. Por isso, o primeiro Administrador é
criado direto por um script (uma única vez):

```bash
cd server
DATABASE_URL="<CONNECTION_STRING_DO_NEON>" node scripts/criar-usuario.js \
  felipe@enertexenergia.com.br "Felipe" administrador "EscolhaUmaSenhaForte123"
```

Guarde essa senha — é a que você vai usar para entrar pela primeira vez.
Depois de logar, troque-a pelo menu "Trocar senha" no cabeçalho do sistema.

## Passo 7 — Testar

1. Acesse a URL pública do serviço.
2. Entre com `felipe@enertexenergia.com.br` e a senha do passo 6.
3. Confirme que a tela carrega (sem projetos ainda — normal).
4. Troque sua senha (menu "Trocar senha").
5. Vá em **⚙️ Administração** e cadastre os outros usuários, com uma senha
   inicial para cada um (combine essa senha com a pessoa por fora do
   sistema — WhatsApp, presencialmente etc.). Ela pode trocá-la depois de
   logar pela primeira vez.
6. Atribua os projetos certos a cada Gerente/Visualizador (Administrador já
   vê tudo, não precisa atribuir).

## Passo 8 — Migrar os dados atuais

Ver `migracao/importar-dados.js` neste mesmo pacote:

```bash
cd migracao
DATABASE_URL="<CONNECTION_STRING_DO_NEON>" node importar-dados.js caminho/para/export.json
```

(O `export.json` é gerado clicando em "Exportar" no cabeçalho do sistema
HTML original, antes da migração.)

## Custo aproximado

Zero, usando Render (Free) + Neon (Free) — sem cartão de crédito, sem prazo
de expiração. A única concessão é o "acordar" de ~1 minuto no serviço web
depois de 15 minutos sem uso, e um instante no banco depois de 5 minutos —
tranquilo para uso interno de uma equipe. Se um dia isso incomodar, dá pra
passar para o plano pago do Render (~US$ 7/mês) sem mudar nada no código.
Bem mais barato e simples do que a rota Azure original, que exigiria
Static Web App Standard (~US$ 9/mês fixo) só para viabilizar login
customizado, mais o custo do Azure SQL.

## Limitações conhecidas desta versão (documentadas de propósito)

- Conflito de edição concorrente é tratado só no nível do projeto inteiro
  (não campo a campo): se duas pessoas editarem o mesmo projeto ao mesmo
  tempo, quem salvar por último vê um aviso e a tela é atualizada com a
  versão mais recente — a edição perdida precisa ser refeita.
- `complexos`, modelo de checklist, modelo de orçamento e lições aprendidas
  são compartilhados como um JSON único cada (não por sub-item) — editados
  com pouca frequência, então o risco de dois usuários se sobrescreverem
  aqui é baixo, mas existe.
- Ao mover um projeto para a lixeira, quem tinha acesso a ele "esquece"
  esse acesso (é recriado para quem restaura). Por isso, na tela de
  Lixeira, Gerente só vê o que ele mesmo excluiu — o Administrador vê tudo.
- Os botões "Importar" e "Exportar tudo (.html)" do sistema original foram
  ocultados para todos (exceto Administrador implicitamente, via a régua de
  papel) — eram ferramentas do modelo antigo de um usuário só.
- Não existe "esqueci minha senha" automático (por email) nesta primeira
  versão — se alguém esquecer a senha, o Administrador redefine uma nova
  para essa pessoa pela tela de Administração (`PUT /api/admin/usuarios/:id/senha`,
  ainda sem botão dedicado na tela — dá pra adicionar rapidamente se for
  incômodo na prática).

## O que ficou arquivado (não usar)

As pastas `api-azure-deprecated/` e o arquivo `sql/schema-azuresql-deprecated.sql`
são da tentativa v1 (Azure + Entra ID) — ficaram só de referência histórica,
não fazem parte do sistema atual.
