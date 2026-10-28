# Contrato OpenAPI na CI

O job Rust do workflow existente exporta o contrato real de `ApiDoc::openapi()`.
Um job dependente compara com a revisão-base explícita do pull request. Em push para main, a
base é o commit anterior do evento. Base inválida, fontes locais modificadas,
documento inválido e erro de comparação interrompem a validação.

## Captura e baseline

`scripts/contracts/capture.py` usa um job exclusivo da CI para conferir o SHA-base.
Esse job troca temporariamente sua própria revisão e restaura o candidato ao
terminar, preservando o caminho da compilação no cache. Não executa em checkouts
de desenvolvimento nem usa snapshot editável como baseline. Para commits anteriores à
existência do exportador, acrescenta somente o helper `openapi_export.rs` e um
include protegido por `cfg(test)`. O helper chama o mesmo `ApiDoc::openapi()`;
não modifica handlers, tipos, anotações Utoipa, dependências ou segurança da base.
Essa instrumentação aparece em `baselineInstrumented`, junto ao hash do helper.

A primeira main, `1569e8f`, já continha IDs de operação duplicados e filtros
query declarados como path, impedindo gerar um consumidor completo. A revisão
fixada em `scripts/contracts/initial-baseline.json` corrige essas declarações e
as descrições obrigatórias de resposta, sem alterar os handlers. Essa baseline é aceita somente
para aquele SHA-base anterior ao gate e quando for ancestral do candidato.
O relatório identifica `comparisonScope: initial_contract` e
`eventBaseCompatibilityVerified: false`: não afirma compatibilidade histórica
com a declaração defeituosa. Depois que a base contém o gate, compara diretamente
com o SHA-base do evento e ignora esse bootstrap. Uma base antiga diferente exige
revisão, em vez de cair silenciosamente no contrato inicial.

A exportação executa somente o teste `export_openapi_contract_artifact`. Não
inicia a aplicação, não lê configuração de produção e não conecta ao banco para
descobrir o contrato. As fontes das duas revisões, os contratos e a duração de
captura recebem hashes e ficam no artefato `erp-openapi-<sha>-<attempt>`.

`cargo test --workspace --locked --no-run` compila a suíte completa. O job seguinte
confere SHA de revisão e hashes dos executáveis, e roda todos os testes com
PostgreSQL isolado. Este workspace tem somente um alvo binário; a embalagem
recusa novos tipos de alvo até revisar testes e doctests, em vez de omiti-los.
O teste de company preserva, opcionalmente, exemplos sintéticos reais
da requisição, resposta após gravação e releitura por usuário sem edição. O Auth
desse teste é um servidor sintético e não autenticação de produção.

## Compatibilidade e consumidor

O comparador é o [oasdiff 1.34.1](https://github.com/oasdiff/oasdiff/releases/tag/v1.34.1),
com SHA-256 do arquivo Linux fixado no instalador. O comando
`breaking --fail-on WARN --format json` rejeita incompatibilidades e avisos.
Não há upload para o serviço de revisão do fornecedor, exclusões de regras ou
aceitação automática por aumento de versão. Referências externas são recusadas.
O [contrato de comparação](https://github.com/oasdiff/oasdiff/blob/v1.34.1/docs/BREAKING-CHANGES.md)
descreve as garantias e limites do comparador.

O consumidor em `scripts/contracts/consumer` usa dependências e lockfile próprios:
gera tipos TypeScript do OpenAPI candidato, compila um consumidor de GET/PUT
`/api/v1/company` e valida os três exemplos do teste real com JSON Schema 2020.
Mutações que removem revisão ou trocam tipos de entrada/saída precisam falhar.
Isso não é um novo cliente publicado nem substitui o frontend do ERP.

Fontes e regras afetadas por mudanças nessa operação:

- `apps/api/src/platform/company.rs`: tipos de resposta, revisão, permissões,
  autorização por empresa e anotações de erro.
- `apps/api/src/platform/company_data.rs`: entrada e validação do cadastro.
- `apps/api/src/http/company_tests.rs`: persistência, isolamento, revisão,
  auditoria e outbox em PostgreSQL.
- `apps/web/src`: consumidores existentes precisam ser revisados quando houver
  mudança de contrato; a compilação do painel permanece no workflow.

## Limites

O relatório `comparison.json` declara `runtimeVerified: false`. Compatibilidade
OpenAPI não prova cobertura de todas as rotas, autorização, semântica de negócio,
completude de erros ou comportamento em produção. Respostas que têm somente
descrição no OpenAPI continuam sem schema de corpo; não são promovidas a schemas
validados pelo consumidor. Exemplos do banco de testes são sintéticos por origem,
não dados reais anonimizados.

Cada job tem `timeout-minutes: 1`, abaixo do teto solicitado de 90 segundos.
Exceder o tempo reprova a CI. O agente acompanha por consultas pontuais, sem
`gh run watch`. A política não autoriza remover testes ou mover builds para os
servidores. A revisão final precisa distinguir timeout de falha funcional.

Compilação Rust, lint Rust, execução Rust, captura de baseline, regressões de
contrato, comparação/consumidor, build web, lint web e navegador são jobs separados.
O gate final exige sucesso de todos, inclusive dependências; jobs pulados ou
cancelados não são promovidos a aprovação. O navegador usa o build do
mesmo SHA e o Chrome instalado no runner; não reconstrói a aplicação. O cache
Rust existente da main foi identificado pela API e usa o mesmo compilador 1.99.1.
Seu hash antigo também contava um toolchain 1.99.0 instalado, portanto a primeira
restauração é explícita; Cargo continua validando as dependências antes de usar
os artefatos. Cache ausente não transforma um timeout em sucesso.
