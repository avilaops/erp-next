# Cadeia de compra até pagamento

Contrato definido no Linear antes da migration: `9e356b9a-5662-41e5-90f7-c80d22d6b7b1`.
Tarefa: AVL-370. Entrega inicial exclusivamente backend, sem novas telas ou BFF.
A extensão posterior de [interface de compras e contas a pagar](COMPRAS-CONTAS-PAGAR-INTERFACE.md)
conecta esse contrato às telas do ERP sem alterar os efeitos transacionais.

Compra em rascunho pode ser editada e confirmada. A confirmação preserva os
snapshots do fornecedor/produtos, unidade e custo negociado. Recebimentos
parciais ou totais devem incrementar a quantidade recebida, registrar entrada
no estoque agregado existente e originar conta a pagar na mesma transação.
Cada recebimento tem referência única no pedido e origem rastreável no estoque
e no financeiro. Pagamento parcial/total e estorno usam livro append-only.

Quantidades têm seis casas e custos duas, com aritmética inteira. Cada parcela
recebida vale a diferença entre valores acumulados arredondados, evitando
deriva entre recebimentos parciais. Parcela com valor arredondado zero não gera
título de valor zero. O recebimento final concilia exatamente com o pedido.

Cancelar só é permitido antes de receber. Encerrar saldo restante de pedido
parcial conserva recebimentos, estoque e títulos existentes. Estorno financeiro
não desfaz recebimento físico e não executa operação bancária.

## Ações

- GET/POST `/api/v1/purchase-orders`: listar e criar rascunho.
- GET/PUT `/api/v1/purchase-orders/{id}`: consultar e editar rascunho.
- POST `/{id}/confirm`, `/{id}/cancel`, `/{id}/close`: transições explícitas.
- GET/POST `/api/v1/purchase-orders/{id}/receipts`: listar e receber.
- GET `/api/v1/purchase-receipts/{id}`: consultar origem e efeitos persistidos.
- GET `/api/v1/payables`, GET `/api/v1/payables/{id}`: consultar contas e livro.
- POST `/api/v1/payables/{id}/payments` e `/{id}/reverse-payment`: pagar/estornar.

Criar e executar comandos exige Idempotency-Key; alterar estado exige If-Match.
Identidade e empresa vêm da sessão. RLS forçada e lock/revalidação de direitos
mantêm isolamento, revisão, auditoria/outbox e efeitos na mesma transação.
Permissões de receber e originar título não concedem permissão de pagamento.

## Execução e aceite

1. Escrever teste HTTP/PostgreSQL da cadeia completa antes da implementação.
2. Implementar compra e recebimentos, com os proprietários de estoque e
   financeiro recebendo a transação autorizada.
3. Implementar livro de contas a pagar, pagamento e estorno.
4. Validar leitura, repetição/concorrência, revisões, limites, arredondamento,
   cancelamento/encerramento, autorização e rollback depois de gerar efeitos.
5. Atualizar OpenAPI/catálogo e executar CI em até 90 segundos; revisão e Linear.

Sem deploy, integração bancária, emissão/importação fiscal, devolução física
ou criação de depósitos. Esses contratos permanecem nos módulos respectivos.
