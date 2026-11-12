# Formulário comercial compacto e recuperação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduzir a rolagem do fechamento comercial, preservar edições de parcelas e recuperar acabamentos sem reiniciar a negociação.

**Architecture:** Manter o simulador, o contrato de checkout e os cálculos do servidor. Ajustar somente a apresentação e o estado do formulário React; usar o calendário inteiro já existente para o próximo vencimento. A API e o banco continuam na revisão publicada.

**Tech Stack:** Next.js 16, React 19, TypeScript, componentes Dialog existentes, Playwright e testes de modelos Node.

**Spec:** Continuação dos requisitos de compactação, navegação e preservação registrados em `docs/superpowers/plans/2026-11-11-commercial-navigation.md` e nas imagens aprovadas pelo usuário.

## Global Constraints

- Preservar condições financeiras, centavos, permissões, revisão e idempotência existentes.
- Não realizar pedidos, pagamentos, e-mails ou transmissões fiscais reais como teste.
- Manter todos os campos acessíveis por teclado em 320, 390, 430, 1366 e 1440 pixels.
- Não repetir autenticação SMTP com a credencial recusada; essa pendência exige a credencial atual.
- Compilar localmente ou em CI, sem compilação no servidor de produção.

## Review Focus

- Adicionar parcela deve usar o intervalo escolhido e atravessar meses corretamente, incluindo intervalo zero explícito.
- Cancelar a substituição de um plano editado deve manter valores, datas, métodos e primeiro vencimento.
- A substituição deve usar as condições atuais após a confirmação; comandos incertos continuam congelados.
- Recolher campos opcionais e parcelas não pode omitir dados na criação, nem esconder a indicação de preenchimento.
- Falha e repetição do carregamento dos acabamentos não podem perder cliente, quantidade ou seleções existentes.

### Task 1: Vencimentos e proteção da edição

**Files:** `apps/web/src/features/sales/commercial-payment-model.ts`, `commercial-checkout.tsx`; testes de modelo e `apps/web/tests/commercial-checkout-ui.spec.ts`.

- [x] Reproduzir a repetição indevida do último vencimento ao adicionar uma parcela.
- [x] Testar próximo vencimento em 28/02/2027 + 30 dias = 30/03/2027, intervalo zero e rejeição de datas/intervalos inválidos.
- [x] Usar a data da última parcela e o intervalo; quando não houver parcelas, usar o primeiro vencimento definido ou o prazo inicial.
- [x] Detectar plano alterado em relação ao último plano gerado. Pedir confirmação em Dialog antes de substituir edições, conservando o plano ao cancelar.
- [x] Validar correção de somas, datas editadas e envio do mesmo checkout pelo percurso existente.

### Task 2: Compactação com dados preservados

**Files:** `commercial-checkout.tsx`, `commercial-simulator.tsx`, testes de navegador comerciais.

- [x] Manter somente o campo de entrada do pagamento no fluxo com checkout; conservar a entrada anterior no fluxo legado sem métodos de pagamento no contrato.
- [x] Recolher entrega/observações opcionais, indicando os campos preenchidos no resumo; manter a primeira parcela aberta e as demais em resumos editáveis com data, valor e método.
- [x] Garantir que abrir/recolher os grupos conserve valores e que os dados opcionais cheguem ao pedido.
- [x] Explicar corretamente o prazo quando não há entrada negociada.
- [x] Verificar largura, teclado e redução do espaço com os grupos recolhidos.

### Task 3: Recuperação e publicação

**Files:** `commercial-simulator.tsx`, testes comerciais, configuração Playwright existente.

- [x] Reproduzir erro 503 na consulta de acabamentos e oferecer repetição no próprio equipamento, preservando a negociação.
- [x] Executar testes relevantes, lint, TypeScript, build e navegação na build de produção; registrar evidências e revisar o diff.
- [ ] Integrar com CI aprovada e publicar somente web, preservando a API e as configurações.
- [ ] Conferir versão pública e saúde dos quatro serviços. Registrar a pendência de SMTP separadamente.
