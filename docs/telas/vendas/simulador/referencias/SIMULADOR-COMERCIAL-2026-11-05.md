# Simulador comercial por versão publicada

A página `/vendas/simulador` consulta as linhas Importada e Nacional e permite
selecionar qualquer versão publicada. Os preços, custos e parâmetros vêm da
mesma versão imutável. Alterações posteriores de cadastro não recalculam a venda.

## Condições e resultado

O usuário seleciona equipamento, quantidade inteira, UF e condição de
contribuinte. Pode informar desconto percentual, desconto em reais sobre o
valor sem IPI, ou total desejado com IPI, além do frete pago pela empresa.
A condição de contribuinte exige escolha explícita; nenhuma alíquota é inventada.

O servidor calcula preço por unidade, total sem IPI, IPI, total da venda,
entrada mínima da política e situação da margem. Quantidades vão de 1 a
1.000.000, com limites monetários explícitos e rejeição de valores inválidos.
O preço sem IPI é arredondado por unidade; o preço com IPI e o total mantêm
a igualdade entre quantidade, unitário e total. O unitário com IPI usa o mesmo
arredondamento para cima da publicação, preservando o preço sem desconto.
Um total desejado nunca é
ultrapassado pelo arredondamento e pode resultar em diferença de centavos.

A gestão recebe também composição de custos, resultado antes e depois do IR,
limites de desconto na meta e sem prejuízo, preço mínimo na meta e entrada
necessária. A fórmula do fornecedor é custo de compra/assessoria com segurança,
sem descontar crédito tributário. A entrada necessária cobre esse pagamento,
o lucro líquido desejado e a comissão sobre a entrada sem IPI.
A apresentação diferencia pagamento na China e fornecedor nacional.

Aritmética racional inteira preserva crédito, segurança e tributos até o
arredondamento. IRPJ/CSLL incide apenas sobre resultado positivo. A taxa fixa
é aplicada uma vez por pedido. O ajuste de arredondamento fica explícito na
composição. O cálculo é gerencial; não é apuração nem emissão fiscal.

## Acesso e pedidos

- `sales.orders.read`: consultar tabelas e simular.
- `sales.orders.manage`: criar rascunho com as condições conferidas.
- `platform.company.manage`: visualizar custos e aprovar exceções comerciais.

Custos e lucro são removidos no servidor para usuários sem gestão, tanto na
simulação quanto na consulta do pedido. O navegador não recebe esses campos.
O BFF conserva sessão, empresa, origem, revisão, chave idempotente e proíbe
recursos, métodos e filtros não previstos.

Criar pedido exige cliente, vencimento e acabamentos válidos. A API recalcula
a simulação dentro da transação e compara seu digest antes de gravar.
O pedido recebe preços unitários com IPI, coerentes com o total mostrado, e
um snapshot privado imutável associado à versão publicada. Nenhum produto,
tabela, proposta ou pedido anterior recebe atualização de preços.

Desconto acima do livre ou lucro abaixo da meta exige aprovação explícita da
gestão, com motivo. A aprovação usa revisão, auditoria e idempotência e altera
a revisão do pedido. Confirmar/reservar recusa qualquer exceção pendente,
independentemente dos controles da interface. Pedidos originados da simulação
não aceitam edição de itens: cancelar e refazer preserva a integridade do acordo.
O fluxo normal continua verificando estoque e regras de vendas.
A preparação fiscal usa os valores preservados sem IPI para evitar tributação
em duplicidade. As alíquotas gerenciais não preenchem a declaração fiscal.

## Entrega e validação

A migração `202611050901_order_pricing_snapshots.sql` cria armazenamento com RLS
por empresa e proteção de snapshots/aprovações concluídas. O fluxo existente
de migração aplica `deploy/grant-sales-simulator.sql` ao papel da aplicação.

Testes de domínio cobrem fórmulas, limites, frete, taxa fixa, prejuízo,
arredondamento e entradas inválidas. Teste HTTP com PostgreSQL real cobre
isolamento, proteção de custos, versão publicada, digest, repetição de criação,
aprovação, revisão e reserva. Testes de navegador cobrem telas pequenas,
resultado desatualizado, entrada de desconto e recuperação de comando incerto.
A validação em produção continua separada de código, CI e merge.
