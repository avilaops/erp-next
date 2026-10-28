# Contratos fiscais recebidos — AVL-360

Estado: desenho e plano aprovados em 28/10/2026. Este documento fecha o recorte
vertical; não declara endpoints implementados nem libera a P0.
Fonte normativa: [desenho](superpowers/specs/2026-10-28-fiscal-lojas-design.md).
Plano: [execução](superpowers/plans/2026-10-28-fiscal-lojas.md).

## Atores, precondições e recusas comuns

H: Bearer OIDC, X-Tenant-Id, associação ativa e permissão explícita.
S: Bearer opaco, tenant e CNPJ obtidos da credencial; validade/revogação/CNPJ
conferidos a cada requisição; escopo exigido por ação.
401 ausente/inválido/expirado/revogado/CNPJ da credencial alterado;
403 permissão/escopo insuficiente, tenant de header divergente ou documento de
destinatário errado; 404 registro ausente ou de outro tenant.
400 ID/header/query/corpo malformado; 413 tamanho; 422 conteúdo semântico;
428 precondição obrigatória ausente; 503 dependência indisponível.
Repetir apenas após corrigir entrada/acesso/configuração; não expor erro bruto.
Erros usam application/problem+json e no-store; nunca XML, token ou hash secreto.

## Fichas por ação

| Ação | Método/rota | Ator/permissão | Entrada e precondição | Transição e efeitos | Idempotência/revisão | Sucesso; erros e recuperação |
|---|---|---|---|---|---|---|
| C1 criar credencial | POST /api/v1/integrations/credentials | H integrations.credentials.manage | {name,expiresAt}; Idempotency-Key UUID; nome não vazio; expiração futura até90d | ausente→ativa, hash+metadados+auditoria; segredo mostrado uma vez | mesma chave/corpo409 secret_not_replayable com ID; corpo diferente409 idempotency_conflict; não guardar segredo no recibo | 201 {id,name,scopes,expiresAt,token}; 422 inválido; 428 sem chave; se resposta perdida revogar ID e criar substituta |
| C2 listar credenciais | GET /api/v1/integrations/credentials | H integrations.credentials.manage | sem corpo; tenant da sessão | sem mudança; somente metadados | não requer chave/revisão | 200; nunca token/hash; falha503, repetir após recuperação |
| C3 revogar credencial | DELETE /api/v1/integrations/credentials/{id} | H integrations.credentials.manage | UUID do registro | ativa→revogada e auditoria, sem excluir histórico | repetição204 no mesmo tenant | 204; 404 ausente/outro tenant; emitir substituta para recuperar acesso |
| I1 importar | POST /api/v1/fiscal/notas-recebidas/importacoes | H fiscal.nfe.import | {xml}; Idempotency-Key UUID; UTF-8≤900KiB/corpo≤1MiB; nfeProc4.00 modelo55; destinatário CNPJ atual | ausente→documento completo; validar XSD/assinatura e renderizar; commit XML original+PDF+metadados+auditoria+recibo, sem transação aberta no MCP | tenant+ambiente+chave único; mesmos bytes retornam mesmo ID; bytes diferentes409; nenhuma sobrescrita | 201 criado/200 replay; 422 XML inválido; 502 provedor;503 não configurado; retry após falha não cria duplicata, revalidar acesso no commit |
| S1 listar | GET /api/v1/notas-recebidas | S notas:read | tenant fixo; apenas tpAmb1 | sem mudança | ordenação por ID; limite1000+1 detecta excesso | 200 {notas,pendencias:[]};1001→409 pagination_required; adequar paginação do consumidor antes de habilitar empresa acima do limite |
| S2 XML | GET /api/v1/notas-recebidas/{id}/xml | S xml:read | inteiro positivo≤2^53−1; tpAmb1; CNPJ atual; hash íntegro | ler bytes originais sem MCP/efeitos de negócio | GET repetível | 200 application/xml;404 ausente/outro tenant/homologação;503 corrompido; restaurar por processo documental explícito, nunca regenerar XML |
| S3 DANFE | GET /api/v1/notas-recebidas/{id}/danfe | S danfe:read | mesmos controles S2; PDF persistido e íntegro | ler PDF sem renderização/consulta SEFAZ | GET repetível | 200 application/pdf;404 ausente/outro tenant/homologação;503 corrompido/ausente; corrigir armazenamento antes de retry |
| H1 listar recebidas | GET /api/v1/fiscal/notas-recebidas | H fiscal.nfe.read | environment=1 ou2 obrigatório e exclusivo | mesmo agregado/envelope, ambiente explícito | mesmas regras S1 | 200;400 parâmetro ausente/inválido;409 excesso, sem truncar |
| H2 XML humano | GET /api/v1/fiscal/notas-recebidas/{id}/xml | H fiscal.nfe.read | ID seguro; associação+CNPJ atual | mesmos bytes S2; permite homologação na seção explícita | GET repetível | 200;404/503 como S2, sem restrição tpAmb1 |
| H3 DANFE humano | GET /api/v1/fiscal/notas-recebidas/{id}/danfe | H fiscal.nfe.read | ID seguro; associação+CNPJ atual | mesmos bytes S3; ambiente indicado | GET repetível | 200;404/503 como S3, sem restrição tpAmb1 |
| R1 saúde | GET /api/health | público | SELECT1 no banco existente | sem escrita; alias de readiness | não aplicável | 200 {status:ready}/503 {status:unavailable}; não comprova serviço fiscal nem autenticação |

S1 Nota exige id numérico seguro, chave44, numero/serie inteiros, emitida_em
ISO8601 com offset, valor finito (projeção de decimal exato), itens inteiro,
fornecedor {documento,nome,vinculado:false,id:null}, compra_id:null.
pendencias vazio significa distribuição não implementada, não ausência de DFe.
Downloads preservam Content-Disposition seguro, no-store, nosniff, hashes,
ambiente e X-NFe-Authorization-Check:xml-protocol-only.
IDs de serviço não concedem acesso a handlers H. Token S não permite importação.

## Ligações de interface e BFF

Todos os caminhos abaixo são contratos previstos; sua existência não foi
inferida do documento. Conferir páginas existentes antes de alteração.
Sessão BFF fornece OIDC/tenant; não aceitar segredo S vindo do navegador.
Escritas requerem Origin igual à aplicação e tenant da sessão; divergência409.

| Página/controle | BFF | Ação Rust/domínio | Critério de interface |
|---|---|---|---|
| /parametros/integracoes — lista | GET /api/erp/integrations/credentials | C2 | loading/vazio/erro; só metadados |
| mesma — criar | POST mesmo caminho | C1 | mostrar segredo uma vez sem URL/localStorage; replay orienta revogar/reemitir |
| mesma — revogar | DELETE /api/erp/integrations/credentials/{id} | C3 | refletir resposta real; impedir ação sem permissão |
| /fiscal/recebidas — importar | POST /api/erp/fiscal/notas-recebidas/importacoes | I1 | deadline60s; retry conserva chave para mesmo arquivo; erro preserva entrada |
| mesma — selecionar ambiente/listar | GET /api/erp/fiscal/notas-recebidas?environment=1 ou2 | H1 | rótulo claro homologação/produção; não fabricar lista em falha |
| mesma — baixar XML | GET /api/erp/fiscal/notas-recebidas/{id}/xml | H2 | bytes/hashes; nenhum segredo S no cliente |
| mesma — baixar DANFE | GET /api/erp/fiscal/notas-recebidas/{id}/danfe | H3 | PDF persistido; ambiente visível |
| backend Lojas por CNPJ | sem BFF ERP | S1/S2/S3 | Bearer somente servidor, download15s, lista10s; sem truncamento |

Troca de tenant cancela chamadas e limpa artefatos/segredo. Guardar hash da
entrada, não XML, no recibo de comando. Nenhuma leitura gera compra, estoque,
custo, financeiro, manifestação ou cadastro de fornecedor.

## Matriz de aceite vs evidência

| Dimensão | Critério | Evidência necessária | Estado inicial |
|---|---|---|---|
| identidade | 401/403 corretos, sem fallback OIDC↔serviço | testes HTTP reais com doubles de identidade | não executado |
| tenant | outro tenant404, pool/RLS sem bypass | PostgreSQL efêmero CI com papel restrito | bloqueado P0 |
| empresa | destinatário exato e token recusado após mudança de CNPJ | modelo puro + integração concorrente | previsto |
| integridade | XML/PDF byte a byte, hashes, sem MCP no GET | testes de importação/download | bloqueado P0 |
| recuperação | retry pós-commit, conflito e concorrência | falhas injetadas e recibo único | bloqueado P0 |
| contrato consumidor | parser Lojas, IDs seguros,1001→409 | teste de contrato e CI/builds | não executado |
| interface | mobile,origem,permissão,troca de tenant | Playwright/prints sintéticos | bloqueado persistência |
| operação | endpoints públicos e tenant/chave corretos | smoke sanitizado após deploy autorizado | não autorizado |

PR #4 ainda não integrado: não copiar seu catálogo nem alterar p0Ready.
Após integração, incorporar estas fichas no formato do catálogo, mantendo
needs_definition das outras famílias. Health alias deve constar no catálogo
implementado quando seu código e CI estiverem aprovados.
