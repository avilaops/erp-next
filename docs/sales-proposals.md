# Propostas comerciais

## Objetivo e estado

Substituir integralmente a demonstração em `/vendas/propostas` por propostas
persistidas e isoladas por empresa. Implementação validada localmente; publicação
e validação autenticada em produção são etapas separadas.

## Contrato de entrega

- Listagem paginada, busca por cliente/número e filtro por situação.
- Central `/vendas` com contagens e registros recentes consultados das APIs reais
  de propostas e pedidos, atalhos de criação conforme permissão e estados de erro
  independentes. Indicadores e pedidos demonstrativos não são exibidos nessa rota.
- Criação e edição de rascunho com cliente e produtos reais, quantidade, cores,
  preço comercial, validade, condições de pagamento, entrega e observações.
- Valores calculados no servidor com inteiros de precisão fixa; nenhuma condição
  comercial, cliente, item ou validade preenchidos com dados de demonstração.
- Publicação interna da versão como enviada, sem enviar mensagens ao cliente.
- Aceite, rejeição e cancelamento registrados com autor, data e motivo quando
  aplicável. Aceite representa registro interno da decisão, não assinatura digital.
- Versões anteriores preservadas; revisar cria uma nova versão em rascunho.
- Expiração derivada da validade e verificada no servidor antes do aceite.
- Conversão explícita de proposta aceita em pedido em rascunho, preservando itens,
  preços e cores, uma única vez. Reserva, faturamento e cobrança seguem o fluxo
  existente de pedidos e não ocorrem ao aceitar a proposta.
- Visualização imprimível da versão comercial para salvar em PDF pelo navegador.
- Contratos OpenAPI, BFF e interface integrados, com estados de carregamento,
  vazio, erro, leitura sem permissão de gestão e conflito de edição.

## Invariantes

- Referências compostas por empresa e RLS obrigatórios em todas as tabelas.
- Permissões específicas de leitura, gestão e decisão de propostas; conversão
  também exige gestão de pedidos. Nenhuma concessão automática a papéis existentes.
- Escritas transacionais seguem `authorized`, `revision`, `command_key`, `replay`,
  `remember` e `record` do domínio existente.
- `If-Match` protege edições e decisões; `Idempotency-Key` protege criação,
  versionamento, transições e conversão de duplicações.
- Dados comerciais enviados são imutáveis. Alterações de catálogo não reescrevem
  documentos anteriores. Proposta não movimenta estoque nem contas a receber.
- Alterar o preço de catálogo ou um preço já acordado exige a permissão explícita
  `sales.proposals.negotiate`. A `main` inspecionada não possui um motor de limites
  de desconto no domínio de vendas; não são inventados percentuais comerciais.
  A integração de qualquer regra de vendedor que entre durante o desenvolvimento
  deve ser revista antes da entrega. O preço de catálogo original fica preservado
  separadamente do preço negociado.

## Sequência de implementação e evidências exigidas

1. Persistência, constraints e regras de domínio; testes de precisão, transições,
   validade e isolamento entre empresas.
2. API, autorização, auditoria, concorrência e repetição idempotente; testes HTTP
   com PostgreSQL real, incluindo acesso negado e conversão sem duplicação.
3. Contratos gerados, BFF e substituição das quatro rotas demonstrativas.
4. Testes de interface: criar, recarregar, editar, enviar, revisar, aceitar,
   rejeitar, cancelar, imprimir e converter; erros e modo somente leitura.
5. Checagens de arquitetura, tipos, testes e build; revisão do diff e validação
   em navegador. Publicação e validação autenticada são etapas separadas.

## Referências verificadas

- `apps/api/src/domains/sales.rs`: pedidos reais e snapshots de itens.
- `apps/api/src/domains/mod.rs`: autorização, concorrência, idempotência e auditoria.
- `apps/web/src/features/sales/orders.tsx`: consultas e comandos de pedidos.
- `apps/web/src/features/sales/sales-details.tsx`: demonstração a substituir.

## API implementada

| Operação | Endpoint | Permissão adicional à leitura |
| --- | --- | --- |
| Listar e filtrar | `GET /api/v1/proposals` | Nenhuma |
| Consultar versão atual ou histórica | `GET /api/v1/proposals/{id}?version=N` | Nenhuma |
| Criar rascunho | `POST /api/v1/proposals` | `sales.proposals.manage` |
| Editar rascunho | `PUT /api/v1/proposals/{id}` | `sales.proposals.manage` |
| Registrar envio realizado | `POST /api/v1/proposals/{id}/send` | `sales.proposals.manage` |
| Aceitar ou rejeitar | `POST /api/v1/proposals/{id}/{accept,reject}` | `sales.proposals.decide` |
| Cancelar | `POST /api/v1/proposals/{id}/cancel` | `sales.proposals.manage` |
| Criar nova versão | `POST /api/v1/proposals/{id}/revise` | `sales.proposals.manage` |
| Converter para pedido em rascunho | `POST /api/v1/proposals/{id}/convert` | Gestão de propostas e leitura/gestão de pedidos |

Rejeição e cancelamento exigem motivo. Conversão exige `dueDate` informado pelo
operador. A validade usa a data de negócio em `America/Sao_Paulo` e inclui o dia
informado. Expiração não invalida um aceite já registrado dentro da validade.
Uma proposta convertida não pode sofrer novas decisões ou revisões.

O BFF expõe os mesmos recursos sob `/api/erp/proposals`, conserva ETag e chave
idempotente e limita os filtros aos declarados. O token permanece no servidor.

A migração de produção aplica `deploy/grant-sales-proposals.sql` ao papel
restrito da API, inclusive em atualização somente de schema. Cabeçalhos e versões
não recebem permissão de exclusão; as linhas de rascunho permitem substituição,
e os gatilhos impedem alteração de conteúdo publicado. As permissões comerciais
continuam exigindo concessão explícita aos papéis da empresa.

## Validação durante o desenvolvimento

- Cluster PostgreSQL isolado e restrito a loopback, porta `55443`.
- Todas as migrações aplicadas em banco de teste; RLS confirmado nas três tabelas.
- Cinco testes unitários de regras e o teste HTTP com PostgreSQL passaram,
  incluindo negociação, versões, autorização e conversão idempotente.
- Os quatro testes de interface passaram; build de produção, tipos, ESLint,
  formatação Rust, Clippy e checagem de arquitetura passaram localmente.
- A regressão geral executou 297 testes: 295 passaram, um teste dependente de
  Ollama ficou ignorado e a contagem fixa de rotas OpenAPI exigiu atualização
  de 159 para 164. Após a correção, os seis testes do contrato passaram.
- Fluxo completo pelo BFF passou com PostgreSQL e usuário restrito: criação,
  preço negociado, recarga, envio, revisão, edição, histórico, aceite, pedido em
  rascunho, PDF, consulta sem gestão, cancelamento com motivo e filtro de situação.
- O harness reiniciou a API e confirmou a persistência dos registros e revisões.
- CI e publicação são etapas seguintes; resultados locais não comprovam produção.

## Reprodução

Gerar os tipos web a partir do OpenAPI da mesma revisão antes de compilar o
frontend, conforme `scripts/contracts/generate-web.mjs` e o pipeline de CI.

```powershell
cargo test -p erp-next-api --bin erp-next-api proposal -- --test-threads=1
pnpm --filter web build
pnpm --filter web exec playwright test --config playwright.proposals.config.ts
```

O teste HTTP exige `DATABASE_URL` apontando para PostgreSQL local descartável.
Para o fluxo real no navegador, compilar o binário da API e usar o harness:

```powershell
$env:COMPANY_TEST_DATABASE_URL = 'postgres://erp_test@127.0.0.1:55443/postgres'
$env:PG_BINDIR = 'C:/Users/nicol/AppData/Local/PostgreSQL/19/bin'
$env:ERP_TEST_API_BINARY = (Resolve-Path 'target/debug/erp-next-api.exe').Path
$env:ERP_TEST_BROWSER_CONFIG = 'playwright.proposals-persistence.config.ts'
node scripts/verify-company.mjs
```

O harness cria e remove apenas seu banco e papel temporários. O usuário da API
tem privilégios restritos e o provedor de identidade é uma fixture local.
O cenário também integra `playwright.company.config.ts`; os quatro testes de
interface têm uma etapa própria no CI.
