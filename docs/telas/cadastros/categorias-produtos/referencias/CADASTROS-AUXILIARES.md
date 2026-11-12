# Cadastros auxiliares persistentes

Escopo do segundo lote: categorias de produtos, categorias financeiras, contas
financeiras e formas de pagamento da empresa ativa. As telas demonstrativas
dessas quatro áreas foram substituídas por consultas e gravações na API Rust.

## Recursos e permissões

Cada recurso oferece GET e POST na coleção, GET e PUT por UUID. Listas aceitam
`q`, `status`, `offset` e `limit` (1 a 100). A busca é literal por nome ou código,
com ordenação estável por nome e UUID. Categorias também guardam uma ordem de
exibição para os consumidores que vierem a usar essa hierarquia.

| Tela | Recurso `/api/v1/` | Permissões separadas de consulta e gestão |
| --- | --- | --- |
| `/cadastros/categorias-produtos` | `product-categories` | `catalog.categories.read`, `catalog.categories.manage` |
| `/cadastros/categorias-financeiras` | `financial-categories` | `finance.categories.read`, `finance.categories.manage` |
| `/cadastros/contas-financeiras` | `financial-accounts` | `finance.accounts.read`, `finance.accounts.manage` |
| `/cadastros/formas-pagamento` | `payment-methods` | `finance.payment_methods.read`, `finance.payment_methods.manage` |

Os contratos são gerados no OpenAPI. O módulo Rust `domains::reference_data`
reúne somente esses cadastros auxiliares em tabelas tipadas separadas. Ele não
escreve nos livros operacionais de vendas, estoque ou financeiro.

A migração `202610270008_reference_data.sql` cria tabelas, índices, RLS forçada
e o catálogo de permissões. Nenhuma permissão é atribuída automaticamente a
papéis existentes em produção. Gestão exige também consulta, conforme a regra
já existente para definição de papéis.

## Dados e invariantes

Todos os recursos têm código, nome, situação e observação opcional. O código é
normalizado para ASCII maiúsculo, tem até 40 caracteres e é único por empresa
e por recurso. O nome tem até 200 caracteres e a observação até 1000. Situações
são `active` e `archived`; não há exclusão física pela API.

Categorias possuem categoria superior opcional da mesma empresa. A API impede
ciclos, inclusive em reparentamentos concorrentes. Uma categoria ativa exige
superior ativa. Arquivar a superior exige antes arquivar ou mover suas filhas
ativas. Categorias financeiras usam `income` ou `expense`; pais e filhos devem
ter a mesma natureza, inclusive quando uma alteração tenta mudar o pai.

Contas financeiras usam os tipos `bank`, `cash` ou `internal`. Banco, agência e
número são informações declaradas opcionais, permitidas somente em contas
bancárias. Não há campo de saldo inicial ou saldo atual nesta entrega.

Formas de pagamento guardam modalidade e prazo de referência entre 0 e 365 dias.
As modalidades são Pix, dinheiro, transferência, cartão de crédito, cartão de
débito, boleto e outra. O prazo não agenda ou confirma liquidações.

## Escrita e recuperação

POST exige `Idempotency-Key`; PUT exige também `If-Match`. Respostas contêm ETag.
Uma revisão ultrapassada retorna 412. Repetir a mesma chave, dados normalizados
e revisão devolve o resultado original sem nova gravação. Reutilizar a chave
com outro contexto retorna 409. Toda tentativa verifica os direitos atuais.

O bloqueio transacional da empresa serializa as escritas e a verificação de
hierarquia. Cadastro, revisão, auditoria, outbox e comando idempotente são
gravados na mesma transação. Os metadados de auditoria/outbox não incluem
identificadores bancários nem observações livres. Os dados do cadastro e dos
comandos ficam protegidos pelo contexto de empresa no banco.

O BFF usa a empresa da sessão, verifica origem e encaminha revisão e chave.
As telas preservam os campos recusados por conflito e pedem confirmação para
descartá-los. Se a resposta de gravação se perde, os campos ficam congelados e
“Conferir gravação” repete o comando original. Esse estado de recuperação é
mantido em memória enquanto a tela permanece aberta.

## Limites

Não estão incluídos vínculos de produtos com categorias, classificação dos
títulos existentes, liquidações por conta cadastrada, importação/exportação,
listas de preços ou provisão de permissões em uma implantação real. O marco M1
completo continua pendente. Os próximos fluxos devem usar contratos explícitos
dos domínios proprietários ao passar a consumir esses cadastros.

Registrar uma conta não a conecta a um banco. Registrar uma modalidade não
processa pagamento. Os recebimentos existentes continuam usando o contrato já
implementado em `PEDIDOS-FINANCEIRO.md`.
