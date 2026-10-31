# Comissões, produção e ampliação fiscal — AVL-396

Continuação da primeira entrega, reaplicada sobre `main` em `f52b502`. Não há
projeção automática de registros antigos nem alteração de produção nesta etapa.

## Comissões

`GET`/`PUT /api/v1/orders/{id}/commission` consulta/configura vendedor ativo,
`commissionRate`, `ipiRate` e `paymentDay`. Percentuais são strings com quatro
casas: `5.0000` representa 5%. O dia vai de 1 a 28. A configuração exige revisão
do pedido e fica imutável após sua confirmação ou qualquer recebimento.

Sem configuração, recebimentos não geram comissão. Quando configurado, a base
é o valor recebido sem IPI, e a comissão é calculada com inteiros e arredondada
em centavos. O lançamento conserva vendedor, nome e taxas originais. O estorno
copia exatamente a base e a comissão negativas do original, inclusive depois de
pago. Seu lançamento fica na competência da data do estorno; o pagamento antigo
e suas alocações permanecem preservados.

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/api/v1/commissions` | Saldos por vendedor e totais |
| GET | `/api/v1/commissions/{sellerStaffId}` | Livro, revisão e pagamentos |
| POST | `/api/v1/commissions/{sellerStaffId}/adjustments` | Novo crédito/débito com motivo |
| POST | `/api/v1/commissions/{sellerStaffId}/payments` | Declarar pagamento líquido positivo |

Um pagamento reúne lançamentos abertos até a competência escolhida, incluindo
os débitos dentro desse corte. Débitos de competência posterior permanecem para
um corte posterior, seguindo a regra do legado. A data do pagamento não pode
anteceder a data de nenhum recebimento/estorno alocado. Antecipação após a origem
e antes do vencimento é permitida. Não há transferência bancária integrada.

Permissões: `finance.commissions.read/manage`; configurar condições também exige
`sales.orders.manage`. Cancelamento integral revalida direitos de comissão antes
do replay quando houver configuração ou lançamentos vinculados. As telas estão
em `/financeiro/comissoes` e no detalhe do pedido.

## Produção e componentes

`GET`/`POST /api/v1/production/orders` lista/cria ordens a partir de venda
confirmada ou concluída. A criação exige a revisão da venda, copia seus itens e
impede duplicação por produto. Etapas iniciais: A produzir, Corte, Solda,
Pintura, Montagem e Pronto. Elas só são inicializadas durante uma escrita.

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/api/v1/production/orders/{id}` | Ordem, consumos e histórico consistentes |
| POST | `/api/v1/production/orders/{id}/stage` | Mover etapa |
| POST | `/api/v1/production/orders/{id}/consumptions` | Declarar componente, quantidade, custo e motivo |
| POST | `/api/v1/production/orders/{id}/consumptions/{movement}/reverse` | Compensar consumo específico |
| GET / POST | `/api/v1/production/stages` | Consultar/criar etapas |
| PUT | `/api/v1/production/stages/{id}` | Renomear/reordenar etapa preservando sua classificação |

O consumo usa produtos do estoque existente, respeita reservas e rejeita o
próprio produto fabricado como componente. Quantidade usa seis casas e custo
unitário duas. Movimento, custo declarado, revisão, histórico e outbox são
atômicos. O estoque manual não pode estornar movimentos vinculados à produção.

Marcar pronta registra conclusão, sem criar automaticamente estoque acabado,
conta a pagar, BOM, horas de máquina ou rateio industrial. Reabrir uma ordem
pronta devolve os consumos ativos, mantendo o histórico. Cancelar a venda fecha
suas ordens e devolve cada consumo ativo uma vez; a reversão do estoque acabado
continua no domínio comercial. Isso vale também antes da expedição.

Permissões: `production.read/manage` e, para efeitos no estoque,
`inventory.stock.read/manage`. Direitos atuais são conferidos antes de replay.
As telas reais usam `/estoque/ordens-producao` e seus detalhes existentes.

## Fiscal e implantação

A declaração opcional `draft.taxDeclaration` amplia a emissão CRT 3 somente para
operações internas SP: ICMS 00/40/41/50, PIS/COFINS 01/02/04–09, IPI explícito e
IBS/CBS integral 000/000001. Decisões de contribuinte, consumidor final, bases e
alíquotas começam vazias na interface. Sem declaração, um rascunho CRT 3 antigo
continua legível, mas não pode ser emitido. Tributos seguem uniformes por nota.
Pagamentos declarados devem somar produtos e IPI arredondado por item, exceto a
forma única sem pagamento `90` com valor zero.

As migrations `202610310005` e `202610310006` acrescentam os novos domínios com
RLS forçada e livros append-only. O grant do runtime foi ampliado e os papéis de
administrador existentes recebem as novas permissões. Nenhuma migration foi
executada no banco de produção nesta etapa.

O workflow de release agora gera também `erp-fiscal-<sha>`. O overlay fiscal
opcional roda a imagem sem root, somente leitura e sem porta pública, no loopback
da API. `GET /healthz` exige o token e confirma apenas processo/homologação.
Configuração detalhada em [deploy/README.md](../deploy/README.md).

Na inspeção somente leitura por SSH, a API publicada estava saudável e sem URL/
token do motor fiscal. O keyring A1 estava configurado. A consulta com o papel de
runtime, transação somente leitura e RLS da empresa padrão confirmou ausência de
perfil fiscal e certificado A1 armazenado nessa empresa. Esses cadastros e a
prontidão devem ser conferidos pela API autenticada antes de qualquer homologação
real. Não houve transmissão SEFAZ nem alteração desses dados.

Resultados desta etapa em
[VERIFICACAO-CONTINUIDADE-20261031.md](VERIFICACAO-CONTINUIDADE-20261031.md).
