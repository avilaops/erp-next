# Continuação: recebimentos parciais

Rodada interrompida em 27/10/2026 a pedido do usuário, para que a outra execução
continue responsável pelo mesmo checkout. As alterações foram preservadas.

## Alterações desta rodada

- `apps/api/src/domains/finance.rs`: recebido líquido e saldo restante derivados
  do histórico; recebimentos positivos até o saldo; estorno de um recebimento
  específico não estornado. Detalhe e histórico são consultados no mesmo statement.
- `migrations/202610270009_receivable_payment_lookup.sql`: índice por empresa e
  conta. Foi renumerada de 008 para 009 porque a outra execução criou a migração
  008 de cadastros auxiliares. Nenhuma migração antiga foi reescrita.
- `apps/web/src/features/operations/receivables.tsx`: saldo, recebido parcial,
  escolha de recebimento para estorno e histórico preservado.
- `apps/web/src/features/workspace/workspace-pages.tsx`: orientação financeira
  atualizada, preservando a estrutura de ajuda da outra execução.
- `apps/api/src/http/operations_tests.rs`: três novos testes de recebimento
  parcial, concorrência, estorno e rollback. O caso antigo de excesso foi
  atualizado de 0,98 para 1,00 sobre um título de 0,99.
- `apps/web/tests/operations-persistence.spec.ts`: novo cenário móvel com resposta
  perdida, recebimentos de 0,33 e 0,66 e estorno específico; rótulos atualizados.
- `docs/PEDIDOS-FINANCEIRO.md`: novo contrato e limites dos recebimentos.

## Estado da verificação

ESLint completo terminou com código 0. Rustfmt foi executado nos dois arquivos
Rust alterados. Não há resultado aprovado de testes ou compilação desta extensão.

A tentativa de testes Rust falhou porque a execução concorrente havia declarado
`reference_tests` antes de criar o arquivo. O arquivo apareceu depois; a suíte
não foi repetida nesta rodada. A compilação normal da API foi interrompida ao
encerrar a execução, conforme orientação do usuário.

Os resultados anteriores de 47 testes Rust e 29 testes de navegador pertencem à
entrega de rascunhos e ajuda. Não validam estes recebimentos parciais.

## Próxima verificação

1. Conferir o estado consolidado do checkout e as migrações 008 e 009.
2. Executar os testes Rust em série em PostgreSQL local isolado, Rustfmt e Clippy.
3. Compilar novamente o binário da API e o frontend em diretório de build próprio.
4. Executar o harness completo, incluindo o novo cenário de recebimentos parciais
   e a comparação de persistência após reinício da API.
5. Inspecionar a captura móvel e atualizar o status somente após os resultados.

O PostgreSQL local anteriormente usado por esta execução está em 127.0.0.1:55441,
com papel de teste `erp_modules`. O harness também aceita origens e binário
configuráveis, conforme `scripts/verify-company.mjs`. Serviços de outras execuções
não foram interrompidos. Não houve implantação ou alteração de produção.
