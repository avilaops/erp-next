# Contas a pagar e pagamentos de funcionários

[Todas as telas](../../../README.md) · [Financeiro](../README.md)

Acompanhar obrigações a pagar e a área de pagamentos da equipe.

**Onde acessar:** `/financeiro/contas-pagar`, `/cadastros/funcionarios/pagamentos`.

## O que aparece na tela

- Favorecido, referência e vencimento
- Valor e situação
- Pagamento e conta conforme o fluxo
- Aba de funcionários

## O que você pode fazer

- Pesquisar e abrir uma obrigação
- Registrar as ações financeiras autorizadas
- Acessar os pagamentos de funcionários

## Regras e limites

Registrar uma obrigação não executa transferência bancária. A área de funcionários não equivale a um cálculo completo de folha.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [FUNCIONARIOS-E-PAGAMENTOS](referencias/FUNCIONARIOS-E-PAGAMENTOS.md)
- [purchase-access](../../../../apps/web/src/features/purchasing/purchase-access.tsx)
- [payroll-workspace](../../../../apps/web/src/features/staff/payroll-workspace.tsx)
