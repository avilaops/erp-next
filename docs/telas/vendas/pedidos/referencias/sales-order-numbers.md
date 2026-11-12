# Numeração comercial dos pedidos

Pedidos exibem `PV-000001`, com sequência própria por empresa. A coluna `number`
é persistida; o UUID continua identificando rotas, relações e comandos internos.
Não existe reinício anual nem reaproveitamento de números de pedidos cancelados.

A migração `202611040001_sales_order_numbers.sql` numera os pedidos existentes
por data de criação e UUID como desempate, preservando estados, valores e revisões.
A atribuição de novos números usa contador transacional por empresa, protegido
por RLS, unicidade e gatilho de imutabilidade. Criação direta, conversão de proposta
e importação seguem a mesma atribuição. Uma transação revertida não consome número.

A pesquisa aceita o código completo (`PV-000001`, sem distinção de maiúsculas)
ou o número, além dos filtros anteriores por cliente, documento e UUID.
Os contratos expõem `number` como string para preservar precisão.

Valores monetários são exibidos no padrão brasileiro: `R$ 10.000,00`.
Quantidades preservam as casas significativas: `1.000000` vira `1` e `2.500000`
vira `2,5`. A formatação não altera os valores enviados à API nem os cálculos.

Publicação exige a migração pelo workflow de produção antes de ativar a nova API.
O grant de `sales_order_counters` mantém a versão anterior apta a criar pedidos
enquanto os novos artefatos são ativados. Contas a receber, estoque e situação
comercial não são alterados pela numeração.

## Formulários e pesquisas

O preço unitário das propostas usa a apresentação brasileira também no campo
editável. A conversão de entrada valida agrupamento e centavos sem usar ponto
flutuante, preservando a representação decimal exigida pela API.

Seletores de acabamento vazios oferecem acesso ao cadastro do produto em nova
aba, na seção de cores. A atualização é explícita e consulta apenas as opções
da empresa atual; preço, quantidade e demais campos da proposta são preservados.

As pesquisas remotas usam `SearchInput`, com espera de 300 ms após a digitação,
tratamento de composição de texto, cancelamento ao sair e callbacks somente de
leitura. O componente nunca submete o formulário comercial que o contém.
Resultados anteriores são descartados pelos controladores de consulta existentes.
As buscas locais que já filtravam durante a digitação continuam imediatas.
