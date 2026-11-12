# Compras e contas a pagar na interface

As telas usam a cadeia transacional existente, documentada em
[compra até pagamento](CADEIA-COMPRA-PAGAMENTO.md). Esta extensão não altera
migrations ou regras do backend e não reprocessa os documentos do legado.

## Fluxo

1. Em `/compras/pedidos`, crie um rascunho selecionando fornecedor ativo,
   produtos ativos, quantidades, custos negociados e vencimento. O custo não
   é preenchido com o preço de venda. A prévia usa inteiros de ponto fixo;
   o total confirmado é o retornado pela API.
2. Edite enquanto o pedido estiver em rascunho. A revisão protege a gravação.
   Confirme o pedido antes de receber os produtos; confirmar não envia
   comunicação ao fornecedor e não movimenta estoque.
3. No detalhe da compra, registre uma remessa com referência, data e
   quantidades entregues. Produtos não entregues ficam em branco. O recebimento
   cria a entrada no estoque e a conta a pagar correspondente na mesma
   transação do backend. Parcelas de valor arredondado zero não criam título.
4. Consulte o recibo em `/compras/recebimentos/{id}` e a obrigação em
   `/financeiro/contas-pagar/{id}`. O índice de recebimentos permite escolher
   uma compra; o histórico paginado fica dentro dela, conforme o contrato
   existente, sem inventar uma listagem global de recebimentos.
5. Registre pagamentos manuais parciais ou integrais. Cada pagamento pode ser
   estornado individualmente com data e motivo, preservando o livro original.
   Isso não transfere dinheiro nem comprova liquidação bancária.
6. Cancele somente compras sem recebimento, ou encerre o saldo de compras
   parcialmente recebidas. O encerramento conserva entradas e obrigações.

## Segurança e recuperação

O BFF mantém identidade e empresa da sessão, exige origem e empresa coerentes
nas gravações, limita o corpo e permite somente recursos e filtros previstos.
Propaga revisão, chave de idempotência e identificador da requisição. Nenhum
token é fornecido aos componentes do navegador.

Editar pedidos, receber e pagar são permissões independentes. Para oferecer
recebimento, a interface consulta as permissões de recebimento, estoque e
originação de contas; a API revalida essas permissões na transação. Poder
editar uma compra não concede permissão para recebê-la ou pagá-la.

Confirmações ambíguas congelam os dados e repetem a mesma requisição/chave.
Conflitos de revisão preservam a edição até o operador aceitar recarregar.
Edições de rascunho usam If-Match; após uma resposta perdida, uma repetição
pode receber conflito e exigir conferência do estado atual, sem sobrescrita.

## Limites

Notas de entrada, sugestões de reposição, depósitos, produção, integração
bancária e emissão fiscal permanecem fora desta entrega. As compras antigas
continuam no histórico importado, somente leitura. Os testes de navegador com
respostas controladas validam a interface e o BFF; os testes Rust/PostgreSQL
existentes validam os efeitos transacionais da cadeia.
