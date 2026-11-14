# Listagens compartilhadas e ordenação por cabeçalho

Implementa os dois pedidos de 12/11: ordenação das tabelas como no Explorer e padronização estrutural das listagens. A implementação e publicação já foram solicitadas explicitamente. O objetivo geral antigo permanece pausado; custos nacionais, importações e outros dados não fazem parte deste trabalho.

## Inventário antes da refatoração

O repositório usa React/Next 16.4.3, componentes próprios e PostgreSQL 18. Não usa TanStack Table. `DataTable` apenas preserva a tabela nativa; existem `PageHeader`, `Pagination`, `Button`, `SearchInput` e `RequestError`. Os demais padrões de listagem se repetem em cada feature. `workspace-ui.css` já contém tokens de espaçamento, controles e `.workspace-list-scroll`.

| Família / arquivo em features | Consulta e paginação | Migração |
| --- | --- | --- |
| catalog/catalog-workspace | products, servidor, 10/25/50/100 | Cabeçalho, busca, filtros, vazio, tabela e ordenação global |
| parties/party-workspace; staff/staff-workspace | parties/staff, servidor25 | Mesmo padrão, mantendo formulários e permissões |
| records/reference/reference-workspace | 8 cadastros, servidor25 | Uma migração cobre depósitos, categorias, contas, formas de pagamento, grupos e tags |
| price-lists/price-lists-workspace | price-lists, servidor25; detalhe completo | Título ausente, criar no cabeçalho; ordenação global da lista e local no detalhe somente de leitura |
| sales/proposals; sales/orders | proposals/orders, servidor25 | Cabeçalho, card, limpar, status, dinheiro e ordenação global |
| sales/sales-pipeline | opportunities, servidor25 | Preservar resumo e etapas; integrar lista e ações |
| sales/sales-workspace | proposals/orders limit5 | Preservar painel; subseções com tabelas resumidas e ações |
| sales/commercial-table | commercial/tables, array completo, recorte14 local | P0: ordenar todo o resultado filtrado antes do recorte; dinheiro sem quebra e rolagem contida |
| commercial-settings/price-tables | tabelas publicada/prévia completas | P0: mesma geometria e valores sem quebra; ordenar localmente |
| finance/receivables; purchasing/payables; purchasing/purchase-list | servidor25 | Busca, status, vazio, paginação e valores tipados |
| inventory/stock-workspace | stock, servidor25 | Produto, saldo, reservado e disponível ordenados globalmente |
| fiscal/outgoing-xml-imports | outgoing-imports, servidor25 | Ordenação antes da paginação |
| fiscal/outgoing-nfes | carrega todas as páginas cursor e combina localmente | Ordenar a coleção completa, sem modificar a semântica dos cursores da API |
| pos/point-of-sale; pos/cash-history | products15; sessions/sales20, servidor | Ordenação global nas tabelas paginadas |
| pos/cash-closing | movimentos completos no detalhe | Ordenação local dos movimentos, valores e datas tipados |
| company/account/account-panels | provedor externo, páginas10 | Auditar e padronizar apresentação; sem cabeçalho ordenável enquanto o provedor não oferecer ordenação global |

Não são listagens de registros reordenáveis: documentos para impressão, linhas de proposta/pedido/NF-e com sequência comercial, recibo, prévia de importação CSV, itens selecionados do simulador, editor indexado de itens de lista de preços e matriz de parâmetros por UF. Não mudar a sequência desses dados. Produção, logística, comissões, folha, auditoria e várias telas administrativas usam cartões ou histórico sem cabeçalhos de tabela; registrar essa forma no inventário, reutilizar componentes adequados sem convertê-las artificialmente em tabelas.

Nenhuma tela prioritária de cadastro tem um PageHeader externo autenticado. Seus títulos h2 estão nos componentes. Propostas e listas de preços não têm título visível. Substituir esses blocos pelo cabeçalho compartilhado; não duplicar títulos. Estados de acesso negado ficam nos componentes de acesso.

## Decisões

- Reutilizar os componentes próprios. Uma biblioteca adicional não resolve o contrato de paginação e duplicaria a estrutura existente.
- `EntityListPage` reúne cabeçalho/ação, card, toolbar, resumo, tabela e paginação por slots; o domínio continua responsável por dados, permissões e regras. `SearchToolbar`, `FilterField`, `StatusBadge`, `EmptyState`, `ResponsiveTable`, `CurrencyCell` e `SortableTableHeader` concentram os padrões ausentes. Reutilizar Button e PageHeader.
- Cabeçalhos nativos th/button, aria-sort, ↑/↓ em espaço reservado, foco e teclado nativos. Primeira seleção explícita é asc; segunda é desc. Manter a ordenação inicial de cada tela.
- Estado na URL `sortBy`/`sortOrder`; preservar parâmetros não relacionados, filtros, offset, limite, destino e seleção de equipamentos. Navegação sem recarga completa. Busca/filtro mantém o comportamento atual de voltar à primeira página, preservando a ordenação.
- Ordenação do servidor usa expressões estáticas por endpoint, nunca nomes recebidos na SQL. Texto usa collation ICU pt-BR, sem diferenças de caixa/acentos e com números naturais. Valores monetários, números e datas usam tipos do banco. Nulos no fim em ambas as direções e desempate por chave única.
- Listas completas usam comparador tipado compartilhado com Intl.Collator pt-BR e useMemo, antes de qualquer slice. Nenhuma ordenação local de uma página parcial.
- Ordenar situação pelo texto apresentado ao usuário, não pela grafia interna do enum. Preservar os filtros e o isolamento por empresa.
- Tabela de preços: largura mínima legível, nomes/SKU em hierarquia própria, valores alinhados à direita e indivisíveis; rolagem somente em ResponsiveTable. Ações e avisos secundários não comprimem preços.
- O vazio mantém o cabeçalho e a geometria da lista. Distinguir ausência de cadastro, filtros sem resultado e erro. Criação contextual depende da permissão existente.

## Verificação

375/768/1024/1440px, teclado, setas/aria-sort, ausência de overflow na página, dinheiro sem quebra, pesquisa/filtros/offset/limite e Voltar/Avançar/reload. Integração PostgreSQL com mais de uma página, 160 produtos, acentos, nulos, empate, datas e valores 2/10/100; campo/direção inválidos e tentativas de injeção recusados. Os testes existentes de layout que contradizem o pedido novo devem ser atualizados preservando as verificações de negócio.

Fonte técnica para collation: https://www.postgresql.org/docs/18/collation.html. Confirmar ICU no banco de testes e de produção antes da migração. A publicação deve executar migrações antes da ativação e manter as verificações existentes.
