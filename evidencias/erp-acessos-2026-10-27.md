# Gestão de acessos no ERP Next

Verificação local em 27/10/2026 no checkout
`D:\Projetos\SaaS\erp-next`. Incremento sobre o fluxo de empresa registrado em
`erp-empresa-2026-10-27.md`; aquela evidência mantém seus resultados históricos.
Os dados, identidades e o provedor de autorização desta rodada são sintéticos.
Não houve implantação, commit ou publicação do ERP nesta rodada.

## Resultado

- Listagem real de usuários da empresa e edição da associação existente.
- Nome e e-mail da identidade são somente leitura; não há envio de convite.
- Criação, alteração e exclusão autorizadas de papéis e suas permissões.
- ETag/If-Match, revisão e preservação do rascunho em conflito.
- Criação de papel idempotente por empresa, operador e chave UUID.
- Recusa de delegação fora da autoridade do operador, referência a outra
  empresa, bloqueio próprio e remoção do último administrador local.
- Uma associação pendente não pode mudar de estado sem confirmação no Auth.
- Gravação, auditoria, outbox e registro de comando participam da mesma transação.
- Uma escrita de empresa que aguardava o bloqueio recarrega os direitos depois
  da liberação e respeita uma revogação já confirmada.

## Verificações observadas

| Verificação | Resultado |
| --- | --- |
| Rust com PostgreSQL de teste | 23 aprovados; zero falhas |
| `cargo fmt --all --check` | Aprovado |
| `cargo clippy --workspace --all-targets -- -D warnings` | Aprovado |
| Build web, incluindo TypeScript | Aprovado |
| ESLint | Aprovado |
| Playwright geral com um worker | 41 aprovados; zero falhas |
| `pnpm test:access` | 14 aprovados; zero falhas; 14,7 s no Playwright |
| Reinício da API | Empresa, papéis, associação e revisões preservados |
| Sintaxe do harness e `git diff --check` | Aprovadas |

Os 14 testes completos se dividem em sete de acessos, três de catálogo e quatro
de empresa. Usam PostgreSQL 18 com conta de aplicação sem superusuário nem
BYPASSRLS, binário Rust, Next.js de produção e Chromium. O harness remove a
base e a conta exclusivas que criou. O teste de perda de confirmação efetua a
gravação real, injeta HTTP 503 somente na resposta ao navegador e verifica que
o reenvio com a mesma chave mantém uma única criação.

Os 41 testes gerais também percorrem módulos demonstrativos. Eles não provam
transações comerciais reais. Tempos são observações desta execução, sem valor
de benchmark estatístico; quantidade de testes não é cobertura de código.

## Correções verificadas durante a rodada

O catálogo já presente neste checkout substituiu a demonstração de produtos.
As verificações gerais passaram a exercitar as ações demonstrativas nos
cadastros que ainda as possuem; três testes completos exercitam o catálogo
real, com preço decimal, revisão, conflito e consulta sem edição. O catálogo
não chama o BFF quando o acesso corporativo não está configurado.

As rotas dinâmicas de produtos usam Suspense para dados de execução, conforme
a documentação instalada do Next.js. Seletores do Playwright usam papéis
acessíveis para ignorar cópias ocultas preservadas durante a navegação.
A validação do código de papel foi corrigida para a compilação do atributo
`pattern` com a flag `v`, exigida pelo
[padrão HTML](https://html.spec.whatwg.org/multipage/input.html#the-pattern-attribute).
O cenário completo de papel também recusa erros de console e de página.
Uma nova edição limpa o aviso da gravação anterior, evitando apresentar um
rascunho ainda não enviado como salvo.

O lint ignorou corretamente os diretórios gerados `.next-*`, incluindo o
preview existente. Essas pastas foram preservadas. A margem inferior das
telas de acesso evita que a navegação móvel cubra os controles finais.

## Arquivos centrais deste incremento

- `migrations/202610270002_access_management.sql`.
- `apps/api/src/platform/access_management.rs` e testes `http/access_tests.rs`.
- `apps/api/src/platform/company.rs` e teste de revogação durante espera.
- Rotas HTTP e contrato gerado; ajuste de argumentos de auditoria dos domínios
  existentes para manter o Clippy sem supressões.
- `apps/web/src/features/access/` e rotas de preferências de usuários e papéis.
- `apps/web/src/lib/erp-proxy.ts` e rotas BFF de acessos.
- `apps/web/src/features/catalog/catalog-access.tsx` e páginas de produtos.
- `apps/web/tests/access-persistence.spec.ts`, `catalog-persistence.spec.ts`
  e adaptação das verificações gerais ao estado atual do checkout.
- `scripts/verify-company.mjs`, configurações Playwright e alias `test:access`.
- `docs/API-ACESSOS.md`, `docs/STATUS-ERP.md`, README e exclusões de build no lint.

Capturas sintéticas da verificação atual:
[desktop](screenshots/erp-access-desktop.png) e
[móvel](screenshots/erp-access-mobile.png).

## Reprodução

Use PostgreSQL local exclusivo para testes com autorização para criar bases e
papéis. O harness recusa endereço de banco fora do loopback. O comando de
build usa um diretório isolado para preservar outros binários em execução.

```powershell
$env:DATABASE_URL = 'postgres://erp_test@127.0.0.1:55439/postgres'
$env:COMPANY_TEST_DATABASE_URL = $env:DATABASE_URL
cargo test -p erp-next-api
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p erp-next-api --target-dir target/company-verification
pnpm --filter web lint
pnpm --filter web build
pnpm --filter web test:e2e --workers=1
pnpm test:access
```

No Windows, o harness usa PostgreSQL 18 em seu caminho padrão; `PG_BINDIR`
permite indicar outro diretório. `ERP_TEST_API_BINARY` permite indicar outro
binário. O harness reserva loopback 18081 para API, 18441 para Auth sintético
e 3202 para Next.js. Os segredos sintéticos são gerados por execução e não
devem ser copiados para configurações reais.

## Limites e continuação

O login de produção ainda exige cliente ERP registrado no Auth, callback exato,
credenciais e empresa/identidade/papel provisionados. Convites não estão
implementados. O ERP completo e sua implantação continuam pendentes.
O armazenamento de comandos de papel ainda não tem rotina de retenção.

Alterações anteriores do checkout, documentos em `docs/.old/`, laboratório
`experiments/` e artefatos publicados foram preservados. As capturas acima
representam a verificação local atual, sem dados de cliente.
