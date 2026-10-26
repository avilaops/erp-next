# Confronto do repositório com a arquitetura

Data da inspeção: 2026-10-26.

## Contexto e método

A referência normativa é [architecture.md](./architecture.md), complementada
pelas [convenções HTTP](./api/conventions.md), pelo
[catálogo de domínios](./api/domains.md) e pela
[trilha de Preferências](./frontend-preferences-roadmap.md).

Esta análise confronta arquivos locais, manifests, imports, router e migration.
Ela não comprova implantação, integração OIDC, execução de políticas no banco ou
tempos de CI. Resultados antigos de build, Playwright e Lighthouse nos roadmaps
continuam sendo evidências históricas.

## Inventário observado

- Monorepo JavaScript com pnpm 11.11.0 e workspace Rust com `apps/api`.
- Frontend em `apps/web`, com Next.js 16.4.3, React 19.3.0 e TypeScript 5.9.3
  resolvidos na instalação local.
- 164 arquivos `page.tsx` e 245 arquivos TypeScript, TSX e CSS em `apps/web/src`.
- API com seis arquivos Rust, um pool SQLx e dois endpoints de saúde.
- Uma migration de fundação, aplicada no início do processo da API.
- OpenAPI 3.0.3 com `/health/live` e `/health/ready`, conforme o router.
- Logs, artefatos, dados locais e dependências já cobertos pelo `.gitignore`.
- Alterações locais extensas anteriores a esta organização, preservadas.

## Matriz de conformidade

| Regra arquitetural | Evidência no repositório | Avaliação |
| --- | --- | --- |
| Monólito modular | `Cargo.toml`, `apps/api/Cargo.toml` e `apps/web` | Estrutura compatível; domínios operacionais da API ainda não implementados |
| Primeiro fluxo em Preferências | Rotas de empresa, usuários e papéis e componentes em `src/features` | Interface demonstrativa; fluxo vertical com persistência ainda pendente |
| Toda operação com empresa validada | `AppState` contém apenas `PgPool`; router contém somente saúde | Contexto empresarial ainda não implementado na API |
| Auth externo e permissões no ERP | Migration contém identidades, associações, papéis e permissões | Schema inicial; autenticação e autorização HTTP ainda pendentes |
| Isolamento reforçado pelo banco | Quatro tabelas com RLS em `202610240001_foundation.sql` | Parcial; contexto transacional, papel de execução e relações precisam de testes |
| Auditoria append-only | Tabela `audit_log` e índice por empresa e data | Estrutura existe; imutabilidade ainda não garantida pela migration |
| Outbox na transação do domínio | Tabela `outbox_events` | Fundação de armazenamento; escrita transacional e processamento ainda pendentes |
| Idempotência e reconciliação | Regras registradas em `api/conventions.md` | Planejadas; sem handlers empresariais implementados |
| Interface e tokens compartilhados | `app/layout.tsx`, `components/app-shell.tsx`, `components/ui`, `globals.css` e `components.json` | Estrutura alinhada; esta inspeção não substitui auditoria visual |
| Contrato HTTP corresponde ao código | `api/openapi.json` e `apps/api/src/http/mod.rs` | Alinhados quanto às duas rotas disponíveis |
| Features conforme o roadmap | Roadmap indica `features/users`; código estava em `features/usuarios` | Corrigido nesta organização com atualização dos imports |
| CI simples e com orçamento explícito | `.github/workflows/ci.yml`, jobs Rust e web | Estrutura simples; orçamento de um minuto exige medição com cache aquecido |

## Lacunas antes do primeiro fluxo operacional

### P0: empresa, autenticação e relações entre papéis

Evidências:

- `apps/api/src/http/mod.rs` não registra handlers empresariais ou middleware OIDC.
- `apps/api/src/platform/state.rs` não contém contexto de identidade ou empresa.
- A migration consulta `app.tenant_id` nas políticas, mas a API ainda não estabelece
  esse valor em uma transação empresarial.
- `membership_roles` relaciona associação e papel por UUIDs independentes. Não há
  restrição que exija que ambos pertençam à mesma empresa, nem RLS nessa tabela.
- `role_permissions` também não possui política própria de isolamento.

Antes de expor comandos empresariais, separar a identidade usada para migrations
do papel usado pela aplicação, definir o acesso às tabelas globais e associativas,
garantir coerência de empresa nos vínculos e testar acesso cruzado entre empresas.

`ENABLE ROW LEVEL SECURITY` não demonstra isolamento para o proprietário da
tabela. Proprietários normalmente ignoram RLS; superusuários e papéis com
`BYPASSRLS` também ignoram as políticas. Essa semântica é descrita na
[documentação do PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
O papel real e seus privilégios não foram consultados nesta inspeção.

### P0: garantia de auditoria append-only

A migration cria `audit_log`, mas não define proteção específica contra
`UPDATE`, `DELETE` ou `TRUNCATE`. Sua política RLS se aplica a todos os comandos
permitidos pelo papel do banco. É necessário definir privilégios e proteção de
imutabilidade e provar o comportamento com testes do papel da aplicação.

### P1: persistência, eventos e efeitos externos

- `CompanyDataForm.save` atualiza estado React e não persiste os campos pela API.
- Usuários e papéis são demonstrativos; seus estados de acesso não são autorização
  efetiva do backend.
- Não foram encontradas chamadas `fetch`, uso de axios ou consumo de
  `NEXT_PUBLIC_API_URL` nos arquivos TypeScript das features.
- A API não implementa gravação de eventos em conjunto com comandos de domínio,
  consumidor da outbox, idempotência ou reconciliação.

Essas lacunas pertencem à implementação do produto. Mover arquivos ou criar
diretórios vazios não as resolve.

### P2: documentação e manutenção do frontend

- O README principal usava npm apesar do workspace e do CI já adotarem pnpm.
- O README web ainda era o template do `create-next-app`.
- A tabela de Preferências chamava o shell demonstrativo de autenticado.
- A pasta `features/users` estava vazia e o código correspondente estava em
  `features/usuarios`, divergindo da área proprietária registrada no roadmap.
- Há arquivos extensos, como `sales-pages.tsx` e `finance-pages.tsx`. O tamanho
  orienta uma revisão futura por responsabilidade, sem justificar divisão
  automática ou mudança de comportamento neste lote.

Os quatro primeiros pontos são corrigidos nesta organização. O inventário visual
em `architecture.md` e as evidências históricas dos roadmaps são preservados.

## Decisão de organização

Manter `apps/web`, `apps/api`, `migrations` e `docs` como diretórios principais.
As rotas permanecem em português e as features seguem os nomes técnicos já
adotados no roadmap. Consolidar usuários em `features/users`.

| Opção | Benefício | Custo e consequência |
| --- | --- | --- |
| Manter a estrutura e corrigir divergências verificadas | Alinha código, documentação e ferramentas com baixo impacto | Domínios operacionais continuam sendo trabalho de implementação |
| Criar agora pacotes e diretórios para todos os domínios planejados | Expõe uma árvore semelhante ao desenho futuro | Introduz estrutura sem comportamento e exige contratos ainda ausentes |

A primeira opção foi aplicada. Não há motivo observado para converter o projeto
em microserviços ou acrescentar pacotes de domínio vazios.

## Limites de dependência

- `src/app`: roteamento e composição das telas.
- `src/features`: comportamento da interface por capacidade.
- `src/components`: shell e componentes compartilhados.
- `src/components/ui`: primitivas da base visual existente.
- `src/hooks` e `src/lib`: utilitários sem regras empresariais centrais.
- `apps/api/src/http`: entrada HTTP e composição do router.
- `apps/api/src/platform`: fundação compartilhada da API.
- `migrations`: evolução versionada do schema.

O import de `roles` para a matriz de permissões em `users` permanece explícito.
É reutilização de interface dentro da área de acessos; não constitui comunicação
entre domínios operacionais nem autorização de backend.

## Ações deste lote e critérios de verificação

1. Registrar este confronto antes da movimentação do código.
2. Mover os três componentes de usuários para a pasta prevista no roadmap.
3. Atualizar os cinco imports afetados, preservando as URLs existentes.
4. Atualizar os READMEs e criar o índice de documentação.
5. Corrigir a descrição do shell e ligar a arquitetura ao confronto.
6. Conferir referências, executar lint, build e a regressão Playwright existente.

As lacunas P0 e P1 permanecem registradas para a implementação do primeiro fluxo
vertical, sem alterar migrations já existentes como parte de uma organização de
arquivos.
