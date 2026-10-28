# Empresa com persistência no ERP Next

## Resultado verificado

O formulário em `/preferencias/empresa/dados` deixou de simular salvamento.
Ele usa o BFF do Next.js e a API Rust para consultar e atualizar a empresa da
sessão, com revisão, autorização e PostgreSQL. O resumo de empresa também
consulta os dados reais e não usa o percentual demonstrativo anterior.

O fluxo de autorização e o banco usados nesta evidência são isolados e
sintéticos. Não houve implantação em produção nem provisionamento de cliente
no Auth real. O checkout do Ávila Lojas não recebeu mudanças nesta retomada.

## Verificações finais

| Verificação | Resultado observado |
| --- | --- |
| `cargo test -p erp-next-api`, com PostgreSQL de teste | 13 aprovados, zero falhas |
| `cargo fmt --all --check` | Aprovado |
| `cargo clippy --workspace --all-targets -- -D warnings` | Aprovado |
| `pnpm --filter web lint` | Aprovado |
| `pnpm --filter web build` | Aprovado, incluindo TypeScript |
| `pnpm --filter web test:e2e` | 41 aprovados, zero falhas, 37,1 segundos |
| `node scripts/verify-company.mjs` | 4 aprovados, zero falhas, 6,1 segundos no Playwright |
| Reinício do processo da API no harness | Cadastro e revisão preservados |
| `node --check scripts/verify-company.mjs` | Aprovado |
| `git diff --check` | Aprovado |

Os 41 testes gerais exercitam também interfaces ainda demonstrativas e não
comprovam operações comerciais reais. Os quatro testes específicos de empresa
usam o binário Rust, PostgreSQL 18, o build de produção do Next.js e o navegador.
O provedor de autorização desses quatro testes é um servidor local de teste.
Os tempos acima são observações da execução, não benchmarks ou metas de CI.

## Cenários cobertos

- Conta ausente, associação de outra empresa e associação desabilitada.
- Consulta sem permissão de edição.
- ETag obrigatório, duas atualizações concorrentes e edição local preservada.
- Validação de campos, CPF/CNPJ e recusa de campos desconhecidos.
- RLS com papel `NOSUPERUSER NOBYPASSRLS`, inclusive sem contexto de empresa.
- Atualização de empresa, perfil, auditoria e outbox na mesma transação.
- Falha injetada na outbox desfazendo alterações e auditoria da tentativa.
- Recusa de atualização e exclusão da auditoria pelo trigger append-only.
- Login authorization code/PKCE S256 e state com cookie criptografado.
- BFF recusando origem externa, mudança da empresa da sessão, cookie adulterado
  e credencial expirada.
- Cookie HttpOnly e ausência do access token no HTML e em `document.cookie`.
- Formulário móvel de 375 pixels sem overflow e com acesso somente de consulta.
- Contrato OpenAPI gerado, cobrindo os recursos que existem no router.

## Reproduzir

Use um PostgreSQL local exclusivo para testes, com uma conta que possa criar
bancos e papéis. Os testes SQLx criam seus bancos; o harness cria uma base e um
papel exclusivos e os remove ao terminar. Não aponte para produção.

```powershell
$env:DATABASE_URL = 'postgres://erp_test@127.0.0.1:55439/postgres'
$env:COMPANY_TEST_DATABASE_URL = $env:DATABASE_URL
cargo test -p erp-next-api
cargo build -p erp-next-api --target-dir target/company-verification
pnpm --filter web build
pnpm --filter web test:e2e
pnpm test:company
```

O endereço acima foi o cluster temporário desta execução. Para outro ambiente,
configure seu endereço de teste; ele deve estar em loopback. O harness usa
`PG_BINDIR` quando informado, ou os executáveis PostgreSQL 18 do Windows e
`/usr/bin` no Linux. `ERP_TEST_API_BINARY` permite informar outro binário de teste.
Portas do harness: 18081, 18441 e 3202; nenhuma instância existente é reutilizada.

Capturas geradas:

- [Desktop](screenshots/erp-company-desktop.png).
- [Celular](screenshots/erp-company-mobile.png).

## Limites e continuação

As credenciais do cliente ERP no Auth e uma empresa com associação real não
estavam configuradas nos arquivos de ambiente deste checkout. Para fechar essa
validação externa, é necessário o callback registrado e o provisionamento
descrito em [STATUS-ERP.md](../docs/STATUS-ERP.md).

A migração foi adicionada ao código e aplicada apenas a bases de teste. O
workflow CI recebeu PostgreSQL para que os testes SQLx possam executar; nenhum
resultado do GitHub Actions foi presumido. Alterações preexistentes, documentos
em `.old/` e os artefatos de `experiments/` foram preservados.

Usuários, papéis e os domínios operacionais continuam na fila de implementação.
Esta entrega encerra o fluxo local de dados da empresa, não o ERP completo.
