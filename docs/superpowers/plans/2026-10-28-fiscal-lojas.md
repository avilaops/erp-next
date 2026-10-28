# Integração fiscal ERP-Next e Lojas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Método aprovado pelo usuário em 28/10/2026: execução direta nesta sessão.

**Goal:** Entregar importação explícita e leitura de NF-e recebida com XML e DANFE completos, tenant isolado e credencial de serviço.
**Architecture:** Manter OIDC para usuários e criar autenticação separada para Lojas. Validar e renderizar na importação; persistir atomicamente os bytes e servir downloads sem chamar MCP. Persistência só depois da liberação integral da P0.
**Tech Stack:** Rust/Axum, SQLx, PostgreSQL 18, Next.js/TypeScript; cliente fiscal MCP existente.
**Spec:** ../specs/2026-10-28-fiscal-lojas-design.md (aprovado em 28/10/2026).

## Global Constraints

- GitHub CI exclusivamente; teto vigente de 90 segundos, sem ampliar jobs/timeout.
- Nenhum teste, build ou banco executado localmente ou no servidor de produção.
- Modelo físico, migrations e concessões SQL só após P0 integralmente liberada.
- Nenhum merge, deploy, migration ou provisionamento em produção sem autorização operacional.
- NFE_PRODUCTION_ENABLED=false; nenhuma manifestação ou distribuição SEFAZ.
- XML UTF-8 até 900 KiB; corpo JSON até 1 MiB; preservar bytes.
- Token com 32 bytes aleatórios; somente hash SHA-256 persistido; expiração até 90 dias.
- Lojas: produção apenas, IDs inteiros seguros até 2^53−1, coleção até 1000 sem truncamento.
- Não reutilizar dados nem runtime do ERP legado.
- Arquivos abaixo são destinos planejados, não alegação de arquivos implementados.
- Main inspecionada: 1569e8f; PR #3 e PR #4 não são dependências implicitamente integradas.

## Review Focus

1. CNPJ alterado com token antigo: rejeitar 401 e impedir acesso à empresa nova (T3/T5).
2. Falha depois do commit e antes da resposta: retry retorna recibo sem duplicar documento (T4).
3. Metadata monetária e datas inválidas: rejeitar sem arredondamento ou normalização silenciosa (T2/T4).
4. PDF ausente/corrompido: 503 e nenhum fallback de geração durante GET (T5).
5. Tenant alterado enquanto importação está em andamento: descartar resposta na UI e revalidar no commit (T4/T6).

## Estado e dependências

- [x] Recorte vertical aprovado.
- [x] Desenho aprovado e revisão independente incorporada.
- [x] Inspecionados middleware OIDC, roteamento, DANFE/MCP, transações e comandos existentes.
- [x] Revisão do plano e execução direta aprovadas pelo usuário.
- [ ] T1: fichas complementares P0.
- [ ] T2: componentes puros e saúde, sem banco novo.
- [ ] Liberação integral da AVL-359: atualmente 28 famílias pendentes, p0Ready=false.
- [ ] T3–T7: persistência, integração e evidências, condicionadas aos portões abaixo.

Sem liberação P0, executar apenas T1 e T2 após revisão do plano. T2 não é integração funcional.
Não criar migrations, grants ou SQL de modelo físico para contornar o bloqueio.
Não tentar fechar as outras 28 famílias da AVL-359 dentro desta integração fiscal.

## T1 — Fechar fichas de ações e ligações UI/BFF/domínio

**Files:** criar `docs/CONTRATOS-FISCAL-RECEBIDAS.md`; após integração do PR #4, atualizar `verification/contracts.json` e `docs/CONTRATOS-ACOES-P0.md` no formato existente.
**Interfaces:** produz fichas com ator, permissão, entrada, precondição, transição, efeitos, idempotência, erro e recuperação. Não cria rotas de runtime.

- [ ] Registrar as oito operações do desenho: credenciais GET/POST/DELETE; importação POST; serviço GET lista/XML/DANFE; health GET.
- [ ] Fechar rotas humanas adicionais: GET `/api/v1/fiscal/notas-recebidas` (query `environment=1|2`, obrigatório), GET `/api/v1/fiscal/notas-recebidas/{id}/xml` e `/danfe`; OIDC + tenant + fiscal.nfe.read, sem aceitar token de serviço. Lista humana usa o mesmo envelope, ambiente explícito e limite de coleção.
- [ ] Registrar BFF em `/api/erp/integrations/credentials`, `/{id}`, `/api/erp/fiscal/notas-recebidas`, `/importacoes`, `/{id}/xml`, `/{id}/danfe`; sessão fornece tenant e token OIDC, escrita exige mesma origem.
- [ ] Fixar páginas `/parametros/integracoes` e `/fiscal/recebidas`; antes de editar, conferir se já existem e preservar conteúdo não fiscal. Mapear cada botão à ficha.
- [ ] Após integração do catálogo P0, executar na CI `pnpm test:verification` e `pnpm verify:erp -- --suite inventory`, conforme scripts vigentes. Exigir zero operações novas sem ficha e p0Ready ainda false enquanto houver outras famílias pendentes.
- [ ] Commit: `docs(fiscal): close received-note and service-credential action contracts`.

## T2 — Política documental pura e alias de saúde (sem nova persistência)

**Files:** criar `apps/api/src/domains/fiscal/received_model.rs`; modificar `apps/api/src/domains/fiscal/mod.rs`, `apps/api/src/http/health.rs`, `apps/api/src/http/mod.rs`, `apps/api/src/http/openapi.rs`.
**Interfaces:** `inspect_received(xml: &str, recipient_cnpj: &str) -> Result<ReceivedMetadata, &'static str>`; ReceivedMetadata contém chave, ambiente, emitente/nome, destinatário, número, série, data com offset, valor em centavos e contagem de itens. Reusar `danfe::inspect`; não reimplementar XMLDSig/XSD.

- [ ] Testar `received_requires_exact_recipient`: fixture aceita para CNPJ destinatário, recusada para emitente e terceiro; resNFe e CPF recusados.
- [ ] Testar `received_metadata_is_exact`: 0.01 → 1 centavo; datas sem offset, overflow, números de nota/série divergentes da chave, itens duplicados e monetários inválidos são recusados.
- [ ] Rodar testes novos na CI antes da implementação e registrar falha esperada; sem SQL, banco ou MCP real.
- [ ] Implementar inspeção limitada a 900 KiB, namespace oficial, metadados sem ambiguidades; erros nunca ecoam XML.
- [ ] Testar `health_alias_uses_readiness`: /api/health dá 503 com banco indisponível, /health/live continua 200; sucesso 200 de readiness será coberto no banco efêmero existente da CI.
- [ ] Registrar alias no router/OpenAPI e reusar handler de readiness, sem duplicar lógica.
- [ ] CI: `cargo test -p erp-next-api received_`, teste do alias, fmt/clippy e build existentes; nenhuma ampliação de pipeline. Testes que precisem de PostgreSQL usam apenas schema existente.
- [ ] Commit: `feat(fiscal): validate received-note metadata and expose readiness alias`.

## Portão de persistência — obrigatório antes de T3

- [ ] Conferir AVL-359 e catálogo versionado: liberação integral explícita, sem interpretar aprovação deste desenho como conclusão da P0.
- [ ] Só então derivar modelo físico e revisão SQL: agregado imutável tenant/ambiente/chave, artefatos e recibos atômicos; credenciais e resolução mínima sem bypass.
- [ ] Definir migration aditiva com numeração posterior à última existente no momento da execução; registrar caminho exato na atualização deste plano antes de criar arquivo.
- [ ] Preservar dados existentes e rotas OIDC. Não modificar hashes de migrations já aplicadas.
- [ ] Separar permissão de migração da conta NOSUPERUSER NOBYPASSRLS. Nenhum grant amplo para resolver tokens.
- [ ] Se portão não abrir, concluir apenas T1/T2 como entrega parcial e manter AVL-360 em andamento.

## T3 — Credenciais e autenticação de serviço

**Files:** criar `apps/api/src/platform/service_credentials.rs`, `apps/api/src/platform/service_auth.rs`, `apps/api/src/http/service_credentials_tests.rs`; modificar platform/mod.rs, platform/state.rs, http/mod.rs e http/openapi.rs. Migration apenas após o portão.
**Interfaces:** `ServiceIdentity { credential_id: Uuid, tenant_id: Uuid, company_tax_id: String, scopes: Vec<String> }`; `require_service_auth(State<AppState>, Request, Next) -> Response`; `authorize_service(state, headers, identity, scope) -> Result<Transaction<Postgres>, ServiceError>` com lifetime associado ao estado.
Handlers de gestão seguem assinaturas Axum existentes; nenhuma rota OIDC usa ServiceIdentity.

- [ ] Testar ausência/token malformado/expirado/revogado/CNPJ alterado → 401; banco indisponível → 503; scope/header tenant divergente → 403; comparação de hash e segredo não aparece em Debug/erros.
- [ ] Testar gestão OIDC com permissão nova; criação 201, hash somente, listagem sem segredo/hash, expiração >90 dias →422; replay →409 secret_not_replayable, corpo diferente →409; DELETE repetido →204, outro tenant →404.
- [ ] CI vermelha antes de implementar; implementar geração criptográfica de 32 bytes e comparação constante usando dependências específicas revisadas, fixadas no lockfile.
- [ ] Resolver identificador com superfície mínima revisada no SQL; validar segredo antes de iniciar consulta documental. Definir search_path seguro se houver função privilegiada; não confiar em tenant vindo do request.
- [ ] Gravar hash/metadados/auditoria/recibo sem token em transação. Não usar `remember` com resposta que contenha segredo.
- [ ] CI PostgreSQL efêmero: dois tenants com papel de aplicação sem superuser/bypass; provar isolamento sob pool reaproveitado e revogação concorrente.
- [ ] Commit: `feat(auth): add tenant-bound read-only service credentials`.

## T4 — Importação e persistência atômica

**Files:** criar `apps/api/src/domains/fiscal/received_import.rs`, `received_store.rs`, `apps/api/src/http/received_import_tests.rs`; modificar fiscal/mod.rs e http/openapi.rs.
**Interfaces:** `ImportInput { xml: String }`; `ImportReceipt { id: i64, xml_sha256: String, pdf_sha256: String, environment: String }`; handler `import_received(State<AppState>, Extension<AuthenticatedIdentity>, HeaderMap, Result<Json<ImportInput>, JsonRejection>) -> Result<Response, FiscalError>`.
Store recebe transação tenant já autorizada, ReceivedMetadata, bytes/hash e chave UUID; retorna recibo e indicador created/replayed. Nunca recebe token de serviço.

- [ ] Testar 428 sem chave, 413 limites, 403 destinatário incorreto, 422 estrutura/XSD/assinatura recusados, MCP sem configuração503/falha502, sem documento parcial.
- [ ] Testar importação201; retry200 mesmo ID; concorrência uma criação/auditoria; XML diferente mesma chave409; idempotência diferente com mesma chave409.
- [ ] Testar falhas antes/depois de commit e revalidação de permissão/CNPJ após MCP. Falso positivo do mock não será chamado validação fiscal real.
- [ ] Implementar autenticação/inspeção, encerrar transação, chamar cliente MCP existente, reabrir/revalidar e persistir XML+PDF+metadados+recibo+auditoria atomicamente.
- [ ] Guardar no comando apenas hash da entrada e recibo sanitizado; não copiar XML no catálogo de comandos. Usar serialização tenant/ordem de locks existente no commit para conflitos concorrentes.
- [ ] Identificador interno/auditoria devem preservar compatibilidade com helpers que hoje usam UUID; ID público numérico distinto não será convertido em UUID artificial.
- [ ] CI: testes novos, regressão de DANFE e build Rust; confirmar zero mudança em compras/estoque/financeiro.
- [ ] Commit: `feat(fiscal): persist imported received NF-e and pre-rendered DANFE`.

## T5 — Consulta e downloads de serviço/humanos

**Files:** criar `apps/api/src/domains/fiscal/received_read.rs`, `apps/api/src/http/received_read_tests.rs`; modificar fiscal/mod.rs, http/mod.rs e http/openapi.rs.
**Interfaces:** funções de store `list_received(tx, tenant, environment, limit_plus_one)` e `load_received_artifact(tx, tenant, id, environment, format)`; resultado tipado sem XML na lista; handlers humanos e serviço autorizam separadamente e compartilham store.

- [ ] Testar envelope real do Lojas: IDs seguros, campos obrigatórios, fornecedor sem vínculo fabricado, compra_id null, pendencias vazias sem alegação de distribuição.
- [ ] Testar vazio200, 1000 notas200, 1001→409 pagination_required; sem lista parcial. Serviço ignora qualquer tentativa de escolher ambiente e só retorna produção; download de homologação/outro tenant404.
- [ ] Testar bytes e hashes exatos, Content-Disposition seguro, XML/PDF MIME, no-store/nosniff/ambiente e xml-protocol-only; artefato corrompido503.
- [ ] Implementar consultas tenant+ambiente, verificar CNPJ atual e hash antes de servir; GET de download não chama MCP nem altera dados de negócio.
- [ ] CI: autenticadores sintéticos, banco efêmero e contador MCP que falha se download tentar geração.
- [ ] Commit: `feat(fiscal): expose tenant-isolated received-note queries and downloads`.

## T6 — BFF e interface humana

**Files:** criar `apps/web/src/lib/erp-received-proxy.ts`, `erp-integration-credentials-proxy.ts`; routes sob `apps/web/src/app/api/erp/` conforme T1; features `fiscal/received-notes.tsx` e `integrations/service-credentials.tsx`; páginas indicadas em T1 e testes `apps/web/tests/received-fiscal.spec.ts`.
**Interfaces:** exports forwardReceivedList/Import/Artifact e forwardCredentialList/Create/Revoke retornam Promise<Response>, sessão obtida no servidor; componentes recebem tenantId e permissões sem token.

- [ ] Testar sessão/origem/tenant, headers permitidos, integridade binária e erro sanitizado. Importação com deadline60s, cliente abortável; download sem aumentar15s do Lojas.
- [ ] Testar formulário perde foco/requisição ao trocar tenant, erro preserva XML, retry mantém chave enquanto corpo não muda; trocar arquivo gera chave nova.
- [ ] Testar segredo só na resposta de criação e memória da tela, sem localStorage/URL/log; replay informa revogar/reemitir.
- [ ] Implementar páginas sem placeholders de sucesso, separar claramente homologação/produção na UI humana. Desabilitar ação sem permissão/serviço configurado.
- [ ] CI: testes de BFF, build web e Playwright mobile/desktop em pipeline existente, dentro do teto; registrar prints sintéticos. Se não couber, bloquear validação sem ampliar limites.
- [ ] Commit: `feat(web): manage integration keys and import received fiscal documents`.

## T7 — Revisão de ramo, CI e evidências

**Files:** atualizar README.md, docs/STATUS-ERP.md, docs/CONTRATOS-FISCAL-RECEBIDAS.md e catálogo P0 conforme disponibilidade; criar `evidencias/avl-360-fiscal-vertical.md`.
**Interfaces:** entrega PR revisável com SHA e evidências; não entrega produção automaticamente.

- [ ] Executar checks existentes de Rust, web e verificador exclusivamente GitHub CI. Registrar duração e resultados por SHA; nenhum check cancelado/ausente será chamado aprovado.
- [ ] Revisar ramo completo para autenticação, isolamento, imutabilidade, recuperação de falhas e compatibilidade do consumidor; corrigir achados antes de marcar pronto.
- [ ] Se CI não couber no teto90s, registrar o bloqueio e solicitar decisão específica; não enfraquecer testes ou implantar.
- [ ] Atualizar Linear AVL-360 e AVL-254 separando contrato definido, componente testado, integração homologada e runtime público.
- [ ] Homologação MCP real e smoke público só após autorização operacional. Credenciais/variáveis Lojas não são criadas por esta aprovação.
- [ ] Não marcar AVL-360 concluída antes dos endpoints públicos, consulta/download reais e evidência tenant isolado.
