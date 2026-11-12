# Plataforma: inventario e primeira migracao

## Evidencias verificadas

Em 2026-11-04, consulta somente leitura pelo Remote Desktop Commander:

- Servidor: ubuntu-4gb-nbg1-1.
- Aplicacao: erp-next-api-1, banco erp_next, papel erp_next_app.
- PostgreSQL: 18.6.
- Extensoes instaladas: vector 0.8.1, pgcrypto 1.4 e plpgsql 1.0.
- 215 tabelas de usuario distribuidas entre public, erp_control e tenant_ludus.
- O papel de runtime nao pode ler public._sqlx_migrations.
- Nenhuma alteracao no banco de producao foi executada durante o inventario.

O codigo atual usa SQLx, identificadores UUID, valores monetarios em centavos,
quantidades em micros, app.tenant_id transacional e RLS forcada. Produtos,
clientes e pedidos possuem chaves compostas UNIQUE (tenant_id, id).
O legado tenant_ludus nao deve virar uma segunda fonte de verdade para novos
modulos. Existencia de tabela nao comprova funcionamento da funcionalidade.

## Entrega preparada

A migracao 202611040002_system_configuration.sql cria somente o schema
system_config e nove tabelas:

| Tabela | Finalidade |
| --- | --- |
| files | Metadados de objetos privados, hash e situacao de disponibilidade |
| file_versions | Referencias entre um arquivo e seus conteudos versionados |
| custom_fields | Definicoes tipadas para produto, cliente/fornecedor e pedido |
| custom_field_values | Valores com referencias reais, tipos e isolamento |
| report_definitions | Definicoes declarativas, sem executar SQL recebido |
| label_templates | Dimensoes e layout de etiquetas |
| workflow_definitions | Identidade, versao e publicacao de fluxos |
| workflow_states | Estados inicial e terminal |
| workflow_transitions | Arestas e permissao exigida por transicao |

As nove tabelas possuem ENABLE e FORCE ROW LEVEL SECURITY. Chaves estrangeiras
incluem a empresa. Nenhuma permissao e concedida automaticamente aos perfis
existentes ou ao papel de runtime. Nenhum arquivo fisico e copiado e nenhum
fluxo comercial, fiscal ou financeiro e ativado por essa migracao.

As consultas preparadas estao em queries/system-configuration.sql. A API deve
obter a empresa e a identidade da sessao autenticada, autorizar a operacao,
abrir uma transacao e configurar app.tenant_id com escopo local. Parametros
de empresa ou proprietario nao podem ser aceitos sem validar a sessao.

## Limites da primeira etapa

Este schema nao implementa os 19 modulos do inventario funcional.
Nao existem ainda endpoints, telas, upload, antivirus, renderizador de
etiquetas, executor de relatorios, motor de fluxo ou concessoes de acesso
para estas novas tabelas.

Campos required sao metadados. A API deve validar a presenca dos campos ao
criar ou alterar a entidade. A migracao valida o tipo dos valores gravados,
mas nao exige retroativamente preenchimento dos registros ja existentes.
O conjunto de opcoes e o tipo de um campo sao imutaveis nesta primeira versao.
Relatorios privados dependem tambem da autorizacao por proprietario na API;
RLS protege a empresa, nao substitui autorizacao por funcionalidade.

Os fluxos sao configuracoes versionadas. A publicacao exige estado inicial,
estado terminal e ausencia de saidas do estado terminal. A validacao de
alcancabilidade, regras de aprovacao e execucao de efeitos permanece parte
do futuro motor de fluxos. Fluxos publicados nao podem ter estados ou
transicoes modificados nem retornar para rascunho.

## Mapa dos dominios restantes

| Dominio | Base existente verificada por nomes de tabelas | Modelagem adicional a definir e implementar |
| --- | --- | --- |
| Administracao | tenants, identities, memberships, roles, permissions, audit_log, personal_preferences | Unidades, calendarios, retencao, notificacoes, importacoes, auditoria das novas configuracoes |
| Catalogo | products, product_categories, product_groups, tags | Familias, variantes, atributos, midias, publicacao por canal |
| Precos | products.price_cents, sales_settings | Tabelas versionadas, moedas, vigencias, faixas e contratos B2B |
| Promocoes | Nenhuma base nova confirmada | Regras, cupons, resgates, concorrencia e limites |
| Loja e busca | Nenhuma base nova confirmada | Canais, conteudo, publicacoes, indices e documentos de busca |
| Carrinho | sales_orders nao e carrinho | Carrinhos, itens, sessoes, snapshots e conversao idempotente |
| Pagamentos | receivables, receivable_payments | Provedores, tentativas, eventos, conciliacao, estornos e disputas |
| Pedidos | sales_orders, sales_order_lines, cancellations, proposals | Orquestracao, entregas parciais, reservas e devolucoes |
| Estoque | stock_balances, stock_movements, warehouses | Saldos por deposito, reservas, lotes e series sem duplicar saldo contabil |
| Logistica | Estruturas legadas de carriers | Transportadoras novas, cotacoes, remessas, volumes e rastreamento |
| Marketplace | Nenhuma base nova confirmada | Propriedade do vendedor, ofertas, comissoes, split e repasses |
| B2B | parties, commercial_contracts, sales_proposals | Organizacoes compradoras, compradores, limites, catalogos e alcadas |
| CRM e atendimento | parties; tabelas legadas de oportunidades | Funil novo, atividades, tickets, SLAs e vinculos a pedidos |
| Compras | purchase_orders, lines, receipts, reversals, payables | Cotacoes, qualificacao de fornecedor e contratos |
| Financeiro | payables, receivables, financial_accounts, commissions | Extratos, conciliacao bancaria, centros de custo e fechamento |
| Fiscal | fiscal_profiles, nfe, cte, nfse, certificates | Evolucao pelas regras fiscais existentes e integracoes homologadas |
| Producao | production_orders, stages, consumptions, history | Estruturas de materiais, capacidade, perdas e custos |
| Indicadores | Dados transacionais existentes | Definicoes de metricas e consultas autorizadas, sem copiar fatos |
| Integracoes | outbox_events, domain_commands, service_api_keys | Conectores, referencias seguras a credenciais, entregas e reprocessamento |

### Decisao solicitada ao usuario

Definir se vendedores do marketplace sao empresas independentes com acesso
proprio ou fornecedores da empresa operadora. Isso determina propriedade,
chaves estrangeiras, compartilhamento de ofertas, visibilidade de pedidos e
politicas de isolamento. Nao criar uma politica entre empresas antes dessa
definicao.

## Extensoes

vector ja esta instalado. Nenhuma nova extensao e necessaria para as nove
tabelas desta etapa. pg_trgm, unaccent e btree_gist estao disponiveis no
servidor, mas nao foram ativadas sem consumidor. pg_stat_statements exige
avaliar a configuracao operacional antes de prometer coleta de estatisticas.
Modelo, dimensao, distancia, retencao e permissoes dos embeddings precisam
ser definidos antes de criar novos indices vetoriais.

Referencias:

- [RLS do PostgreSQL](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
- [pgvector](https://github.com/pgvector/pgvector)

## Validacao e aplicacao

O workflow system-schema.yml aplica a cadeia completa de migrations em
PostgreSQL 18 isolado, executa testes de isolamento e integridade e compila
as consultas parametrizadas. Os dados e o papel usados pelos testes ficam
dentro de uma transacao revertida no final.

A aplicacao em producao deve seguir deploy/README.md e
production-migrate.yml com uma release validada. A primeira etapa nao concede
acesso a erp_next_app: os grants minimos devem acompanhar os endpoints e suas
verificacoes de permissao. Nao habilitar itens da interface apenas porque as
tabelas existem.
