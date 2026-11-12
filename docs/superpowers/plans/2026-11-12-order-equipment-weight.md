# Peso total dos equipamentos no pedido — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans para executar as tarefas e registrar a validação.

**Goal:** Exibir o peso bruto total dos equipamentos na tela do pedido, na impressão/PDF e no documento anexado ao e-mail.

**Architecture:** Usar o campo existente `product_catalog_profiles.weight`, multiplicado pela quantidade de cada item. Acrescentar o peso cadastral à consulta dos itens do pedido e calcular com precisão decimal. Consultar o catálogo nas telas de montagem e como compatibilidade com APIs anteriores. Não criar ou alterar pesos no cadastro.

**Tech Stack:** Rust/Axum/SQLx, Next.js/React/TypeScript, Node test runner e Playwright.

**Spec:** Áudio fornecido pelo usuário em 12/11/2026 e escolha explícita “Tela, PDF e e-mail”. Usar o peso do equipamento; o cadastro atual não distingue embalagem. Peso ausente ou inválido deixa o total incompleto. Os pesos apresentados correspondem ao cadastro consultado, sem migração ou congelamento histórico novo.

## Global Constraints

- Preservar a correção já verificada que acrescenta uma unidade ao selecionar novamente o produto.
- Não criar pedidos ou enviar e-mails reais como verificação.
- Preservar isolamento por empresa e não transformar peso desconhecido em zero.
- Aceitar peso decimal em kg, com ponto ou vírgula, e sufixo `kg` opcional.
- Manter a interface local na porta 3002 disponível para revisão.

## Review Focus

- Multiplicar pela quantidade e conservar frações sem arredondamento intermediário.
- Não mostrar total parcial como completo quando faltar um peso.
- Descartar respostas de outra empresa e consultas antigas ao trocar itens.
- Atualizar total ao alterar, acrescentar ou remover itens.
- Incluir o mesmo cálculo na impressão e no documento de e-mail.

### Task 1: Peso na API e no documento de e-mail

**Files:** `apps/api/src/domains/sales.rs`, `apps/api/src/domains/sales/equipment_weight.rs`, `apps/api/src/domains/sales/order_email.rs`, tipos gerados da web.

- [x] Cobrir cálculo decimal, múltiplos itens e peso ausente com testes.
- [x] Expor `equipmentWeight` nos itens pela consulta do catálogo da mesma empresa.
- [x] Acrescentar peso total ou indicação de incompleto no anexo do pedido.
- [x] Validar testes de domínio, formatação e contrato gerado.

### Task 2: Peso nas telas e no PDF

**Files:** `apps/web/src/features/sales/order-weight-model.ts`, `order-weight-summary.tsx`, `orders.tsx`, `order-detail-commercial.tsx`, `commercial-simulator.tsx`; testes de modelo e `orders-list-ui.spec.ts`.

- [x] Reproduzir a ausência do resumo no navegador e verificar cálculo do modelo.
- [x] Mostrar resumo em kg na montagem, no simulador e no pedido salvo, também na impressão.
- [x] Conferir alteração de quantidade, remoção, peso ausente e resposta de outra empresa.
- [x] Executar modelos da web, testes de navegador pertinentes, lint e TypeScript.

## Progress

- Correção anterior: 13 testes de pedidos e 90 testes de modelo aprovados; lint e TypeScript aprovados.
- Desenvolvimento local: página e `/api/health` responderam 200 na porta 3002; API existente disponível pelo túnel 8083.
- Validação final: 26 testes de navegador na build de produção, 93 testes de modelo e 467 testes Rust aprovados (um teste existente ignorado). Build de 369 páginas, TypeScript, formatação Rust e lint aprovados; lint mantém oito avisos anteriores em arquivos não alterados.
- Revisão corrigiu e verificou quantidade `02` no simulador e incremento com 100 produtos distintos; sem achados restantes.
- Contrato OpenAPI exportado do executável atualizado e tipos gerados pelo gerador oficial, incluindo `equipmentWeight`.
- Interface local na porta 3002 conectada à API atualizada local na porta 8083, com banco acessado pelo túnel privado 55441; processos de segundo plano e emissão fiscal de produção desativados. Saúde, contrato e página responderam normalmente. SMTP local não configurado; não houve envio de e-mail real.
