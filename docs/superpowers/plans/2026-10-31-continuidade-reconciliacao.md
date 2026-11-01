# Reconciliação comercial e continuidade fiscal — etapa 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** substituir a indisponibilidade de produção/comissões no cancelamento
por efeitos transacionais reais e ampliar a declaração tributária da emissão.

**Architecture:** preservar Rust/Axum/SQLx e o livro append-only. Os novos domínios
expõem hooks chamados na mesma transação dos recebimentos, estornos e
cancelamentos; o motor fiscal recebe dados explícitos do rascunho. Banco legado
permanece somente como referência de regras. Base atualizada: `f52b502`; primeira
entrega reaplicada em `6ef6571` após resolver audit/retornos no router e proxy.

**Tech Stack:** Rust, PostgreSQL 18, Next.js 16, Node 24, XML/XSD versionados.

**Spec:** contratos do legado em `src/lib/db/commissions.ts`,
`src/lib/pricing/commission.ts`, `src/lib/db/production.ts`; decisões abaixo.

## Decisões e restrições

- Comissão depende de vendedor e percentuais explicitamente declarados no
  pedido. Seu recebimento exclui IPI da base; reversão compensa exatamente o
  lançamento original. Pagamento anterior permanece registrado e o débito é
  abatido no próximo saldo. Não inventar tabela de preços ou taxa padrão.
- Produção mantém ordens/etapas por pedido e consumo de componentes declarado
  pelo operador. Cancelamento fecha ordens e compensa consumos ativos uma vez.
  Marcar pronta não cria estoque de produto acabado automaticamente.
- Permissões atuais são exigidas antes de replay, com isolamento RLS e
  revisão/idempotência. Nenhum efeito parcial se auditoria/outbox falhar.
- Cobertura fiscal só cresce para classificações e taxas explícitas compatíveis
  com o XML suportado. Valores exatos, pagamentos coerentes com o total da nota,
  sem inferir alíquotas pela descrição/NCM. Homologação permanece obrigatória.
- Preparar provisionamento privado do motor e verificar configuração de forma
  somente leitura. Não alterar produção nem transmitir documento real.

## Tarefas

- [x] Comissão: configuração, livro, pagamentos/ajustes e hooks; testes de
  recebimento parcial, estorno após pagamento e autorização/replay/rollback.
- [x] Produção: ordens, etapas, consumo/compensação e hooks; testes de reserva,
  cancelamento, repetição, isolamento e atomicidade.
- [x] Fiscal: declaração explícita para regime normal, XML/XSD assinado e testes
  de valores, classificação, campos ausentes e pagamentos.
- [x] Integrar hooks aos recebimentos e cancelamentos, registros API/OpenAPI,
  proxy e páginas reais; testar a cadeia inteira e as telas.
- [x] Preparar configuração de implantação privada e conferir disponibilidade
  atual sem expor credenciais.
- [x] Revisar regressões, executar verificações em série, documentar resultados,
  registrar commit e atualizar AVL-396 para revisão.

## Resultado

Implementação desta etapa pronta para revisão. Rust: 180 testes aprovados e um
ignorado; motor: 42; modelo web: dois; navegador: 19 cenários únicos aprovados.
Build, lint, rustfmt e Clippy aprovados. Registro detalhado em
`docs/VERIFICACAO-CONTINUIDADE-20261031.md`. A empresa padrão não possui perfil
fiscal/A1 cadastrados; publicação e homologação reais continuam pendentes.
