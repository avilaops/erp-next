# Catálogo de contratos por domínio

Este catálogo define a ordem e os limites dos futuros contratos. Os itens abaixo
são planejados e não representam endpoints disponíveis. Nomes finais de rotas,
schemas e comandos serão registrados no OpenAPI somente junto da implementação.

## Ordem de implementação

| Ordem | Domínio | Primeiro contrato vertical | Dependências |
| --- | --- | --- | --- |
| 1 | Plataforma | Empresa ativa, usuário atual e permissões | OIDC e fundação SQL |
| 2 | Preferências | Empresa, usuários, convites, papéis e permissões | Plataforma |
| 3 | Cadastros | Produtos, pessoas e tabelas auxiliares | Preferências |
| 4 | Estoque e Compras | Depósitos, movimentos, compras e recebimentos | Cadastros |
| 5 | Comercial | Propostas, pedidos, PDV e importação | Cadastros e Estoque |
| 6 | Financeiro | Contas, categorias, títulos, liquidações e conciliação | Cadastros e Comercial |
| 7 | Fiscal | NF-e, NFC-e, CT-e, NFS-e e eventos | Comercial e Financeiro |
| 8 | Logística | Expedição, etiquetas, postagem e reversa | Comercial e Fiscal |
| 9 | Serviços | Contratos, ordens, medições e cobranças | Cadastros e Financeiro |
| 10 | Relatórios | Consultas consolidadas por domínio | Domínios proprietários |

## Plataforma e Preferências

Recursos previstos:

- empresa atual e empresas acessíveis;
- identidade e associação do usuário atual;
- usuários por empresa nos estados ativo, bloqueado e convite pendente;
- convites com expiração, reenvio e cancelamento;
- papéis;
- permissões agrupadas por domínio e suas dependências;
- auditoria consultável por usuários autorizados;
- preferências da empresa, marca e configurações.

O primeiro contrato deverá cobrir a tela já existente de
`Preferências > Usuários e acessos`, preservando o comportamento simulado do
frontend até a API, autenticação e banco estarem integrados.

## Cadastros

Recursos previstos:

- produtos, variantes, GTIN, NCM, imagens e preços;
- clientes, fornecedores, vendedores e funcionários;
- categorias de produtos e listas de preços;
- contas e categorias financeiras;
- formas de pagamento e tabelas auxiliares.

Importações serão tratadas como trabalhos rastreáveis: envio, validação,
pré-visualização, confirmação e resultado. Um upload aceito não significa que os
registros foram aplicados.

## Estoque e Compras

Recursos previstos:

- depósitos e localizações;
- consulta de saldo e disponibilidade;
- livro de movimentos, transferências e ajustes;
- inventários e divergências;
- pedidos de compra, aprovações e recebimentos;
- check-in e notas fiscais de entrada;
- ordens de produção e consumo de insumos.

Movimentos são imutáveis. Correções geram movimentos compensatórios e mantêm a
rastreabilidade do documento de origem.

## Comercial

Recursos previstos:

- propostas e versões;
- pedidos de venda, itens, aprovação e cancelamento;
- reservas de estoque;
- PDV, pagamentos e fechamento;
- importação manual de pedidos;
- anúncios e integração com Ávila Lojas;
- faturamento agrupado como comando explícito e idempotente.

O primeiro fluxo operacional completo é pedido de venda com reserva de estoque.
O contrato deverá deixar explícita a transição de estado permitida em cada
comando, em vez de aceitar alterações arbitrárias de `status`.

## Financeiro

Recursos previstos:

- contas financeiras e caixas;
- categorias financeiras;
- contas a pagar e a receber;
- liquidações, estornos, juros, multas e descontos;
- conciliação bancária e Pix;
- fluxo de caixa, comissões e DRE gerencial;
- espaço do contador;
- adaptador para Conta Digital, condicionado à disponibilidade do provedor.

Obrigações e liquidações são entidades diferentes. Valores monetários devem usar
escala decimal definida pelo domínio, nunca ponto flutuante binário.

## Fiscal

Recursos previstos:

- NF-e, NFC-e, CT-e e NFS-e;
- notas fiscais de entrada e saída;
- emissão, cancelamento, correção e inutilização;
- distribuição de DF-e e manifestação;
- documentos XML e representações auxiliares;
- eventos fiscais e monitoramento.

O ERP é o estado canônico fiscal. Operações com provedores usam idempotência,
outbox e reconciliação. Certificados, XMLs e dados fiscais exigem autorização e
armazenamento específicos antes de qualquer contrato ser publicado.

## Logística

Recursos previstos:

- expedições e volumes;
- cotações e escolha de transportadora;
- etiquetas, postagem e rastreamento;
- logística reversa e autorizações de devolução;
- integrações por adaptadores de transportadora.

## Serviços

Recursos previstos:

- contratos e recorrência;
- ordens de serviço, agenda e técnicos;
- materiais, apontamentos, medições e aceite;
- cobranças e relatórios de produtividade;
- garantias e assistência técnica.

## Relatórios

Relatórios não escrevem em tabelas de outros domínios. Contratos previstos:

- consultas consolidadas com filtros documentados;
- exportações assíncronas, temporárias, auditadas e limitadas ao tenant;
- indicadores de vendas, estoque, compras, financeiro, fiscal, logística e
  serviços;
- visão executiva com definição formal de cada métrica.

Cada métrica deve declarar fonte, fórmula, período, timezone e regra de
arredondamento. Caso contrário, teremos dois números corretos e uma reunião
desnecessariamente longa.

## Critério para publicar um contrato

Um recurso sai de “planejado” quando possui, no mínimo:

- permissão e domínio proprietário definidos;
- schema de entrada e saída;
- estados e transições válidas;
- códigos de erro e exemplos;
- regras de tenant e auditoria;
- política de idempotência e concorrência quando aplicável;
- handler e testes automatizados;
- operação correspondente no OpenAPI.
