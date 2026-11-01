# Devoluções e continuidade fiscal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** implementar reversões comerciais e fluxos fiscais persistentes no ERP Next.

**Architecture:** domínios Rust mantêm transações e isolamento; serviço interno
Node reaproveita XML/XSD/assinatura/SOAP do legado. O banco preserva solicitações,
documentos e compensações; chamadas externas nunca implicam sucesso presumido.

**Tech Stack:** Rust, Axum, SQLx, PostgreSQL 18, Node 24, TypeScript, Next.js.

**Spec:** `docs/superpowers/specs/2026-10-31-retornos-fiscal-design.md`.

## Global Constraints

- Isolamento por tenant, autorização atual, If-Match e Idempotency-Key nas mutações.
- Nenhum efeito fiscal real ou alteração de produção nesta sessão.
- Preservar valores em centavos e quantidades inteiras em micros na API Rust.
- Não inventar comissão/produção ausentes nem considerar timeout como rejeição.
- Agentes trabalham em áreas distintas; integração de registros compartilhados
  pertence ao controlador. Executar verificações em série.

## Review Focus

- Repetição/concorrência: uma compensação ou documento por comando de negócio.
- Falha intermediária: nenhum estoque ou título parcialmente reconciliado.
- Isolamento: IDs de outra empresa não revelam documentos ou certificados.
- Resposta incerta: conservar XML/chave/número e consultar antes de reenviar.
- XML e custos: rejeitar incompatibilidade de emitente/destinatário e mapeamento.

### Task 1: Reversões comerciais

**Files:** `domains/returns.rs`, migration `202611010001_returns.sql`, testes HTTP próprios.

**Interfaces:** `returns::routes() -> Router<AppState>`; ações de cancelamento de
venda concluída e reversão de recebimento de compra. Evento de cancelamento
consumível pelo fiscal, sem chamadas externas na transação.

- [x] Escrever teste de cadeia venda/compra, compensação, replay e rollback.
- [x] Implementar estados cancelados, movimentos inversos e títulos reconciliados.
- [x] Verificar permissões, concorrência, saldo/reserva e bloqueio de nova baixa.

### Task 2: Emissão e eventos

**Files:** `fiscal/emission*.rs`, migration `202611010002_fiscal_operations.sql`, testes HTTP próprios.

**Interfaces:** cliente interno `FiscalEngine::call(operation, payload)`; rotas
de emissão, consulta, cancelamento, CC-e e inutilização com documentos duráveis.
Cliente em `state.fiscal_engine`; campos de certificado nunca entram em logs.

- [x] Escrever testes de emissão, rejeição, timeout/reconciliação e duplicação.
- [x] Implementar numeração, preparação, persistência de XML e estados fiscais.
- [x] Integrar cliente do motor, eventos e solicitações oriundas de cancelamento.
- [x] Verificar com adaptador de teste e PostgreSQL.

### Task 3: Distribuição e aproveitamento de recebidas

**Files:** `fiscal/incoming.rs`, migration `202611010003_fiscal_incoming.sql`, testes HTTP próprios.

**Interfaces:** `incoming::routes() -> Router<AppState>`; mesmo cliente fiscal
interno da Task 2 para `distribute` e `manifest`. Conversão usa domínio de compras.

- [x] Escrever testes de NSU/repetição, manifestação, mapeamento e conversão.
- [x] Persistir cursor/lotes/documentos e resultados de manifestação.
- [x] Converter XML em compra rascunho/custos sem lançar estoque ou financeiro.
- [x] Verificar erros por item, tenant, permissões e atomicidade.

### Task 4: Motor fiscal e integração

**Files:** `apps/fiscal-engine/`, registros de rotas/OpenAPI/BFF, documentação.

- [x] Portar módulos fiscais puros e schemas fixados do legado com atribuição.
- [x] Implementar serviço interno autenticado e transporte SOAP com A1.
- [x] Testar XML/XSD/assinatura, despacho e respostas com transporte sintético.
- [x] Integrar rotas e contratos, executar testes Rust/web e revisar o diff.
- [x] Registrar resultados e limitações reais na documentação e no ticket.

## Resultado

Primeira entrega pronta para revisão no recorte documentado, sem publicação.
AVL-396 em `In Review`. Resultados reproduzíveis e pendências operacionais em
`docs/VERIFICACAO-RETORNOS-FISCAL-20261031.md`. Paridade integral de produção,
comissões e cobertura tributária não é declarada por esta entrega.
