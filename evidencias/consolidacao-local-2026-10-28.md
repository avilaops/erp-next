# Consolidação local do ERP — 28/10/2026

O usuário autorizou continuar o desenvolvimento local, executar builds/testes e
reunir todas as branches na `main`. Checkout: `C:\Users\Administrator\erp-next`.
Base remota inicial: `29395aacb276688b2c4a432983c893e22f8d340f`.

Foram integradas a branch de consolidação e a política fiscal complementar,
preservando o histórico de todas as branches remotas. As correções de integração
resolveram conflitos de módulos e recursos OpenAPI, colisão de versão da
migration fiscal, IDs OpenAPI duplicados e filtros de funcionários declarados
como parâmetros de caminho. O catálogo recebeu as operações incorporadas.

Os três testes de regressão fiscais presentes na branch reproduziram falhas de
conteúdo escalar dividido, destinatário CPF com 14 dígitos e separador de data
inválido. A política pura passou a recusar esses casos. A tela de chaves do
Lojas, prevista no desenho e nos testes da branch, foi implementada com BFF,
segredo apenas em memória, exibição única, cópia, descarte e revogação.
O lockfile do laboratório foi sincronizado com as dependências incorporadas.

## Verificação executada localmente

| Comando | Resultado |
| --- | --- |
| `cargo test --workspace --locked -- --test-threads=2` | 113 aprovados, zero falhas ou ignorados; PostgreSQL 18 isolado |
| `cargo fmt --all --check` | Aprovado |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Aprovado |
| `pnpm --filter web build` | Aprovado, com TypeScript e 238 páginas geradas |
| `pnpm --filter web lint` | Aprovado |
| `pnpm --filter web test:danfe` | 8 testes Chromium aprovados, DANFE e chaves de serviço |
| `node --test verification/test/*.test.mjs` | 21 aprovados |
| `node verification/run.mjs` | 90 operações API, 61 BFF, 170 páginas; catálogo válido, 25 famílias pendentes |
| `npm test` em `experiments` | Build e 202 testes aprovados |
| `node --test scripts/contracts/test/consumer.test.mjs` | 2 testes aprovados |
| `npm run generate`, `npm run check`, `npm test` em `scripts/contracts/consumer` | Tipos gerados, compilação e exemplos sintéticos aprovados |

O contrato candidato foi exportado pelo teste Rust real. O teste de empresa foi
executado novamente para exportar exemplos de entrada, gravação e releitura
usados pelo consumidor. Não foi executado o comparador histórico oasdiff nesta
rodada local; os gates da CI continuam necessários.

Artefatos locais ignorados pelo Git: `artifacts/contracts/`,
`artifacts/verification/2026-10-28T09-00-04-799Z-2bc14463-f6b9-4ad1-bb17-9136798f64ca/`
e `artifacts/danfe-browser/2026-10-28T09-05-00-358Z-a10f03fc-c057-4c3d-8ab1-6b2bff9ce1dc/`.
Revisão independente somente leitura sem problemas importantes nas correções.

## Limites

O banco de testes usou apenas loopback em `127.0.0.1:55479`, com bases sintéticas
e papel de aplicação sem superusuário/BYPASSRLS nos testes HTTP. Auth, MCP e API
dos testes de navegador são adaptadores sintéticos. Não atestam autenticação
ou validade fiscal em produção.

A migration fiscal `202610280005_received_nfe_integrations.sql` aplica em banco
novo após as migrations incorporadas. Bancos que aplicaram a versão antiga
de branch exigem reconciliação explícita do histórico; esta entrega não faz
esse procedimento. Nenhum banco externo foi migrado.

O desenho fiscal completo ainda excede os handlers herdados: o DANFE do serviço
chama MCP no GET, a coleção não aplica limite/ambiente e o ciclo de vida das
credenciais não implementa expiração nem vínculo ao CNPJ atual. A política pura
de recebidas não substitui automaticamente o importador existente.
`p0Ready=false`. Nenhuma implantação ou emissão fiscal foi executada.

A configura??o de navegador preserva as cinco su?tes incorporadas, para n?o
perder a cobertura de onboarding, pessoas e equipe ao acrescentar chaves.
A atualiza??o fiscal remota 19d8010 foi incorporada e a su?te Rust completa
repetida: 113 aprovados, zero falhas.
