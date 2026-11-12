# Novo pedido conforme referência — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Entregar o modelo completo das imagens na rota padrão de novo pedido com dados e regras reais.

**Architecture:** Acrescentar apresentação de pedido à orquestração comercial atual, reutilizando simulação/digest, checkout e comandos idempotentes. Extrair componentes focados para cadastro do cliente e composição visual. Preservar catálogo legado por query explícita.

**Tech Stack:** Next.js 16.4.3, React 19.3, TypeScript, tokens/componentes existentes, API Rust comercial existente e Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-new-order-reference-design.md`.

## Global Constraints

- Sem migrações, novas dependências ou alterações das políticas reais.
- Não gravar negócios, cadastro, pagamentos ou documentos fiscais reais em testes.
- Preservar sessão local 3002 e a entrega separada PR #186.
- Descartar respostas antigas/de outra empresa; retries incertos preservam o comando original.
- Unidade do prazo registrada explicitamente nas observações persistidas.

## Review Focus

- Cliente trocado durante consulta, mudança CNPJ/CEP e informação manual não podem ser sobrescritos por resposta antiga.
- Novo cadastro confirmado seguido de falha do pedido não pode gerar cliente duplicado.
- Alterar preço, frete, UF, contribuinte, entrada ou itens invalida o digest e os totais anteriores.
- Parcelas editadas e diferença de centavos exigem conferência explícita.
- Novo caminho padrão não pode remover a edição de rascunho nem a consulta por usuário sem gestão.

### Task 1: Cliente integrado ao pedido

**Files:** criar `apps/web/src/features/sales/order-customer-form.tsx` e `order-customer-model.ts`; testes de modelo e de navegador focados.

**Interfaces:** componente expõe ref `read()` para validar draft e `save()` para obter `{id,stateRegistration}`; usa os endpoints existentes de parties, RegistryLookup e município. Recebe tenant, permissão, disabled e callbacks de UF/contribuinte/dirty.

- [x] Cobrir payload, campos obrigatórios, preservação de campos adicionais e cliente existente sem mudanças com testes de modelo.
- [x] Reproduzir ausência do formulário de referência na rota atual.
- [x] Implementar campos, busca/seleção, consulta CNPJ/CEP e salvamento idempotente seguro, preservando cadastro selecionado e ETag.
- [x] Verificar tenant, respostas antigas, edição manual, falha de gravação e retry sem duplicação.

### Task 2: Apresentação completa de pedido

**Files:** modificar `commercial-simulator.tsx`, `commercial-checkout.tsx`, `orders-access.tsx`, `app/vendas/pedidos/novo/page.tsx`; criar `commercial-order-layout.tsx` e CSS focado.

**Interfaces:** apresentação reutiliza estados/ações comerciais e `CommercialCheckout` com variante de pedido; cliente é validado antes de salvar e cadastrado somente após conferir preço e condições.

- [x] Acrescentar teste de navegador RED para composição vazia, responsividade e fluxo completo com dados sintéticos.
- [x] Implementar equipamentos no topo e colunas cliente/pagamento versus desconto/totais/ação; atualizar resultados por simulação sem permitir respostas stale.
- [x] Acrescentar variante do checkout com entrada, parcelas, fabricação/unidade e observações nas seções correspondentes, mantendo o modo simulador.
- [x] Usar novo modo como padrão em `/novo`, preservando catálogo em `?modo=catalogo` e atualizando links/testes legados explicitamente.
- [x] Verificar controles completos, adição repetida, limites, alçadas, parcelas editadas e estados de erro/consulta.

### Task 3: Verificação, revisão e entrega

**Files:** testes comerciais/cadastro pertinentes, configuração Playwright existente, `design-qa.md` e evidências locais.

- [x] Executar modelos, lint, TypeScript e build de produção; corrigir somente falhas pertinentes.
- [x] Testar navegador com fixtures, capturar e comparar referência nos tamanhos solicitados e temas, sem escrita real.
- [x] Obter revisão independente, corrigir achados e repetir verificações afetadas.
- [ ] Commit/push, CI do candidato, integração e publicação autorizada com hashes/rollback/health, preservando escopo da PR #186 e registrando pendências herdadas de arquitetura/contexto.
