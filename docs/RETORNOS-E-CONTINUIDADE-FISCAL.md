# Devoluções e continuidade fiscal — AVL-396

Implementação iniciada a partir de `main` em `8c0f7db`. Não altera dados legados,
não executa migrações em produção e não transmite documentos fiscais reais.

## Cancelamento comercial e devoluções

| Operação | Endpoint |
| --- | --- |
| Cancelar integralmente venda concluída | `POST /api/v1/orders/{id}/cancel-completed` |
| Consultar cancelamentos | `GET /api/v1/orders/{id}/cancellations` |
| Estornar recebimento físico de compra | `POST /api/v1/purchase-receipts/{id}/reverse` |
| Consultar estornos | `GET /api/v1/purchase-receipts/{id}/reversals` |

As mutações exigem `If-Match`, `Idempotency-Key` e JSON com `reason` (15–200
caracteres) e `occurredOn` (`YYYY-MM-DD`). A revisão da devolução de compra é a
do pedido de compra, exposta como `orderRevision` no recebimento. Vendas exigem
gestão de pedidos, estoque e recebíveis; compras exigem gestão de compras,
estoque e contas a pagar. Permissões atuais são verificadas inclusive no replay.

O cancelamento grava compensações append-only, reverte recebimentos declarados
ainda ativos, cancela o título, recompõe estoque e muda o pedido para cancelado.
Todos esses efeitos, revisão, auditoria e outbox compartilham a transação. O
estorno de compra também recompõe as quantidades recebidas e o estado do pedido,
mas exige estoque disponível líquido de reservas. Recebimentos fracionários que
alterariam o arredondamento acumulado exigem estornar os posteriores primeiro.

As telas de pedido e recebimento oferecem motivo, data e histórico. Resultado
incerto conserva corpo, chave e revisão do comando. Títulos cancelados não
oferecem novas baixas. Compensar o livro financeiro não executa transferência
bancária nem comprova devolução física: são declarações registradas pelo operador.

Comissões agora possuem configuração explícita por pedido, apuração no
recebimento e livro append-only. Cancelar estorna exatamente as comissões dos
recebimentos revertidos, preserva pagamentos anteriores e deixa o débito aberto
na competência do estorno. Produção mantém ordens e consumos declarados: o
cancelamento fecha as ordens e compensa seus consumos ativos na mesma transação.
Sem vínculos, a reconciliação informa `not_required`. Ver contratos e limites em
[COMISSOES-PRODUCAO-E-FISCAL.md](COMISSOES-PRODUCAO-E-FISCAL.md).

O cancelamento anterior à expedição também reconcilia produção e solicita os
eventos fiscais necessários. Emissão em andamento ou incerta bloqueia o
cancelamento até a conferência. Contratos preservam arquivos e recebem pedido
de retirada na outbox; pedido cancelado não origina novo envio de contrato.

## Documentos de saída

| Operação | Endpoint |
| --- | --- |
| Iniciar/recuperar emissão de rascunho | `POST /api/v1/fiscal/nfe/{id}/issue` |
| Consultar estado persistente | `GET /api/v1/fiscal/nfe/{id}/emission` |
| Consultar SEFAZ e reconciliar | `POST /api/v1/fiscal/nfe/{id}/consult` |
| Consultar documentos de saída | `GET /api/v1/fiscal/issued-nfes` |
| Baixar XML | `GET /api/v1/fiscal/nfe/{id}/xml` |
| Cancelar / emitir CC-e | `POST /api/v1/fiscal/nfe/{id}/cancel` ou `/correction` |
| Consultar eventos | `GET /api/v1/fiscal/nfe/{id}/events` |
| Inutilizar faixa numérica | `POST /api/v1/fiscal/number-voids` |
| Processar solicitação comercial de cancelamento fiscal | `POST /api/v1/fiscal/order-cancellations/{id}/process` |

O identificador de emissão é o do rascunho; o último endpoint recebe o ID do
cancelamento comercial. Os eventos exigem `text`, revisão atual do documento
fiscal e chave idempotente. Cancelar uma venda solicita cancelamento da nota
autorizada vinculada, mas só a confirmação efetiva do autorizador muda o estado
fiscal. Venda sem nota autorizada não necessita cancelamento fiscal.

A numeração é reservada uma vez por documento/empresa/série/ambiente. XML
assinado é persistido antes da transmissão e torna o rascunho imutável. Uma
preparação bloqueada antes da assinatura pode ser corrigida mantendo o número.
Timeout ou duplicidade de autorização exigem reconciliação da mesma chave.
Protocolo autorizado deve corresponder à chave, ambiente e digest do XML salvo.
Troca posterior de A1 não impede consulta de documento assinado com o anterior.

O adaptador real usa os módulos de XML/assinatura/XSD/SOAP do legado. Ver
[configuração e recorte do motor](../apps/fiscal-engine/README.md). O rascunho
agora permite declarar `payments`, uma lista de `code`, `description` e `amount`
decimal com duas casas. Campos antigos continuam legíveis, mas emissão exige
pagamento explícito. `90` exige valor zero e não pode acompanhar outra forma.
Outras formas devem somar o total da operação. Esses dados não são inferidos do
livro financeiro nem disparam cobrança.

O recorte desta implementação é NF-e 55/SP em homologação: CRT 1 no subconjunto
anterior e CRT 3 interno com declaração tributária explícita, conforme o README
do motor. Rascunhos antigos permanecem legíveis. Não há inferência de alíquotas
nem cobertura de outras combinações. `NFE_PRODUCTION_ENABLED` permanece falso.
Inutilização com resultado incerto permanece reservada e exige conferência
operacional: não há consulta oficial integrada para afirmar sua homologação.

## Documentos recebidos

| Operação | Endpoint |
| --- | --- |
| Estado/cursor e consulta de lote | `GET /api/v1/fiscal/distribution/status`, `POST /api/v1/fiscal/distribution/query` |
| Documentos distribuídos | `GET /api/v1/fiscal/distribution/documents[/{nsu}]` |
| Manifestação e histórico | `POST` / `GET /api/v1/fiscal/manifestations` |
| Consultar solicitação e conferir recibo distribuído | `GET /api/v1/fiscal/manifestations/{id}`, `POST /api/v1/fiscal/manifestations/{id}/reconcile` |
| Prévia e criação de compra vinculada | `GET` / `POST /api/v1/fiscal/received-nfes/{id}/purchase` |

NSU e documentos são persistidos por empresa/ambiente. O cursor só avança com
todo o lote válido; o XML bruto e seu hash são conservados. Código 137/656 ou
cursor no último NSU adiam nova consulta em uma hora. Execuções concorrentes
usam revisão e lease. Manifestação grava solicitação antes da chamada externa;
resultado incerto não é tratado como registro nem reenviado às cegas.
O comando de conferência procura prova no `procEventoNFe` já recebido pela
distribuição, validando autor, chave, tipo, sequência, ambiente e protocolo.
Sem essa prova, conserva a situação incerta e respeita o intervalo de consulta.

A conversão exige fornecedor correspondente ao emitente e vínculo explícito de
cada item a um produto ativo com unidade compatível. Conserva componentes de
custos e cria compra em rascunho na mesma transação do vínculo da NF-e. Não lança
estoque nem contas a pagar: estes surgem no recebimento físico normal. Uma nota
não pode criar duas compras. Valores não representáveis exatamente são recusados
com indicação de revisão. Itens vinculados ao XML não podem ser alterados como
se fossem outra operação; o vencimento do rascunho pode ser ajustado.

Consulta automática é opcional. Configurar em conjunto
`ERP_FISCAL_AUTOMATION_TENANT_ID` e `ERP_FISCAL_AUTOMATION_SUBJECT`, com motor e
cofre A1 disponíveis. O processo consulta a cada 60 segundos se há trabalho
permitido, respeita o intervalo fiscal e revalida associação/permissões atuais
do responsável a cada ciclo. Não enumera empresas nem usa BYPASSRLS.

## Preparação de implantação

As migrations `202611010001`, `202611010002` e `202611010003` devem ser aplicadas
pela conta de migração. Para o runtime existente, o workflow de atualização de
schema executa `deploy/grant-retornos-fiscal.sql`; não concede acesso aos schemas
legados nem ao material do certificado fora da API.

O motor tem Dockerfile próprio e imagem por SHA produzida pelo workflow de
release, após seus testes. O overlay opcional `deploy/fiscal-compose.yaml` usa
loopback compartilhado com a API, token privado e nenhuma porta pública. Em
máquinas diferentes, configurar TLS. Provisionamento e homologação reais são
etapas distintas; esta implementação não iniciou o serviço no servidor.

## Verificação reproduzível

- Rust: `cargo test --workspace` com `DATABASE_URL` de PostgreSQL 18 isolado;
  os testes criam bancos próprios e exercitam runtime sem superusuário/BYPASSRLS.
- Motor: `npm ci && npm test` em `apps/fiscal-engine`, com certificados sintéticos,
  XSD versionado, verificador de assinatura independente e transporte de teste.
- Web: `pnpm --filter web lint`, `next typegen`, `tsc --noEmit` e build.
- Browser: configuração `playwright.danfe.config.ts`, suites `returns-ui.spec.ts`,
  `fiscal-operations-ui.spec.ts` e `fiscal-incoming-ui.spec.ts`. As fixtures de
  navegador são sintéticas; o teste BFF exercita proxy, sessão, origem e headers.

Os resultados da rodada estão em
[VERIFICACAO-RETORNOS-FISCAL-20261031.md](VERIFICACAO-RETORNOS-FISCAL-20261031.md).
A integração posterior com o monitor canônico de produção, incluindo compra
a partir dessas notas e renumeração de migrations não publicadas, está em
[VERIFICACAO-INTEGRACAO-20261101.md](VERIFICACAO-INTEGRACAO-20261101.md).
Nenhum teste com adaptador sintético comprova emissão, manifestação ou
homologação efetiva com a SEFAZ ou a disponibilidade de um certificado real.
