# Edição de rascunhos e orientação da ajuda

Entrega local de 27/10/2026 em `D:\Projetos\SaaS\erp-next`, branch `main`,
base `4eaff3a`. O checkout já continha alterações de outras entregas. Elas foram
preservadas. Este registro complementa a evidência anterior de operações.

## Resultado

| Verificação | Resultado desta entrega |
| --- | --- |
| `cargo test --workspace` | 47 aprovados, zero falhas ou ignorados |
| Harness de persistência com navegador | 29 aprovados |
| Reinício da API e comparação dos dados persistidos | Aprovado |
| Next.js build e TypeScript | Aprovados em `.next-order-drafts` |
| ESLint completo do aplicativo web | Aprovado |
| ESLint do teste de operações após ajuste do seletor | Aprovado |
| `cargo fmt --all -- --check` | Aprovado |
| `cargo clippy --workspace --all-targets -- -D warnings` | Aprovado |
| `node --check scripts/verify-company.mjs` | Aprovado |

O [log da execução final](erp-rascunhos-ajuda-browser-2026-10-27.log) registra
os 29 cenários e a comparação dos dados antes e depois do reinício da API.
Os 48 testes gerais citados na evidência anterior não foram repetidos neste lote.

## Comportamentos verificados

- `PUT /api/v1/orders/{id}` exige autorização atual, `If-Match` e chave de
  idempotência. Pedidos de outra empresa ficam invisíveis e não podem ser editados.
- Somente rascunhos podem ser alterados. Confirmados e cancelados são recusados.
- Itens mantidos preservam preço, SKU, nome e unidade registrados. Novos itens
  usam o catálogo. A alteração de cliente renova seus dados registrados; manter
  o cliente preserva os dados anteriores.
- A API recusa campos de preço enviados pelo cliente, itens duplicados,
  quantidades inválidas e produtos arquivados. Quantidades e valores usam
  aritmética inteira com arredondamento por linha.
- Edição concorrente e disputa entre edição e confirmação respeitam a revisão.
- A edição não cria recebível nem movimento de estoque. Falha deliberada na
  outbox desfaz cabeçalho, itens, auditoria e comando antes de permitir nova tentativa.
- Repetir um PUT cuja resposta foi perdida conserva método, corpo, revisão e
  chave. A gravação não se duplica. Revogar a permissão impede inclusive a repetição.
- O formulário preserva os dados recusados por conflito e exige confirmação
  antes de descartá-los. Operadores de consulta não recebem o formulário de edição.
- A ajuda abre orientações por teclado, filtra conteúdo e oferece links reais.
- O cenário móvel exercitou 320 px sem transbordamento horizontal. A
  [captura do pedido editado](screenshots/erp-pedido-editado-mobile.png)
  apresenta dados sintéticos de teste.

## Execução reproduzível

É necessária uma instância PostgreSQL local dedicada a testes. Nesta rodada,
PostgreSQL 18 foi executado em `127.0.0.1:57776`. A aplicação usou um papel sem
superusuário nem `BYPASSRLS`. O harness cria e remove somente sua própria base
e seu papel temporários.

```powershell
$env:DATABASE_URL = 'postgres://erp_delivery_test@127.0.0.1:57776/postgres'
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p erp-next-api --target-dir target/verification

$env:ERP_NEXT_DIST_DIR = '.next-order-drafts'
Push-Location apps/web
node node_modules/next/dist/bin/next build
node node_modules/eslint/bin/eslint.js .
Pop-Location

$env:COMPANY_TEST_DATABASE_URL = $env:DATABASE_URL
$env:ERP_TEST_WEB_ORIGIN = 'http://127.0.0.1:57777'
$env:ERP_TEST_API_ORIGIN = 'http://127.0.0.1:57778'
$env:ERP_TEST_AUTH_ORIGIN = 'http://127.0.0.1:57779'
$env:ERP_TEST_API_BINARY = (Resolve-Path 'target/verification/debug/erp-next-api.exe').Path
node scripts/verify-company.mjs
```

As portas são configuráveis para evitar disputa entre execuções. O provedor
Auth desta prova é sintético e local. Next.js rodou compilado no modo de produção;
isso não representa implantação do ERP nem validação do login real.

## Correções durante a validação

Na primeira rodada Rust, duas asserções novas acessavam uma lista onde o helper
já retornava o saldo individual. Foram corrigidas; os 47 testes passaram na
execução seguinte. Na primeira rodada do navegador, o seletor genérico de alerta
também encontrou o anunciador de navegação do Next.js. O seletor foi restringido
ao aviso de conflito, e os 29 cenários passaram na nova execução.

## Limites e continuação

O primeiro lote está concluído localmente. Não houve publicação, aplicação de
migrações em produção ou validação com identidade real. A nova migração apenas
atualiza a descrição de `sales.orders.manage`; não concede permissões adicionais.

A estrutura de ML, `verification/` e `experiments/` ficam com o outro agente.
O fiscal e os serviços externos não receberam implementação neste lote.
A [fila por dependência](../docs/EXECUCAO-RELATORIOS.md) mantém cadastros
auxiliares, compras, extensões de pessoas/estoque/financeiro e implantação pendentes.
