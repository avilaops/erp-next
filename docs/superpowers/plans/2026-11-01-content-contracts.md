# Conteúdo e contratos Implementation Plan

> **For agentic workers:** executar com superpowers:executing-plans. Revisão independente ao fim da branch.

**Goal:** conectar contratos tipados, ajuda MDX e layout persistente do ERP.
**Architecture:** monólito Rust/Utoipa existente, BFF Next.js existente, tipos gerados na CI e MDX local.
**Tech Stack:** Rust, SQLx/PostgreSQL, Utoipa, Next.js/React/TypeScript, MDX.
**Spec:** ../specs/2026-11-01-content-contracts-design.md

## Global Constraints

- Trabalhar pela branch remota e validar pelo GitHub Actions.
- Preservar sessão, isolamento, revisão, idempotência e efeitos existentes.
- Aprovações configuráveis dependem de regras de negócio e não integram esta execução.
- Não fazer merge ou deploy.

## Review Focus

- Mudança de empresa durante carregamento/gravação não pode exibir ou gravar dados de outra sessão.
- Uma gravação de preferências antiga deve preservar o layout.
- Respostas de resultado desconhecido não podem gerar repetição automática de comando.
- Conteúdo MDX não pode criar autorização nem declarar integrações inexistentes.
- Geração deve usar o contrato do mesmo commit e falhar sem ele.

## Tasks

- [ ] 1. Registrar testes de layout e contrato; observar falha na CI antes da implementação.
- [ ] 2. Implementar schemas explícitos, geração de tipos, aliases e migração dos consumidores; compilar e validar contratos.
- [ ] 3. Extrair ajuda para MDX local com componentes existentes; testar pesquisa, orientações e acesso às operações.
- [ ] 4. Persistir layout com RLS/revisão/auditoria e salvar explicitamente na interface; testar releitura, conflitos e isolamento.
- [ ] 5. Executar CI completa, revisar diff, corrigir achados e entregar PR com evidências.

## Ledger

Ruling: o inventário é uma previsão de impacto, não uma meta de quantidade. Alterar somente os arquivos necessários à solução verificada; registrar arquivos adicionais quando úteis à separação de responsabilidades.

Ruling: o recurso de contexto compartilhado Linear retornou Tool not found. Ticket AVL-402 permanece disponível; fontes atuais do GitHub são a referência.

RED: CI 41274802541 confirmou dashboard_layout_persists_without_legacy_writes_erasing_it com HTTP 422 versus 200 esperado; 154 testes passaram, um falhou e um foi ignorado. O lint também identificou formatação, corrigida com rustfmt antes do próximo commit.

Review fix: scope ownerKey verifica identidade além de empresa/revisão em gravações de layout; controles aguardam snapshot; links usam GuardedLink; qualquer gráfico removido pode ser readicionado. Testes cobrem revisões coincidentes de identidades distintas e leitura atrasada.

Ruling: schemas auxiliares em contracts/api.rs e contratos do monitor/assistente foram adicionados onde o inventário inicial ainda não representava respostas genéricas e streams. Os workflows assistant e production-release também precisam gerar tipos para manter todos os builds reproduzíveis. Nenhum workflow de publicação foi disparado.

Validação intermediária: 25d8b83 passou Rust/PostgreSQL, rustfmt/Clippy, regressões do gerador e lint web. A compilação apontou 13 incompatibilidades antes ocultas por tipos manuais (campos opcionais/nulos e kind do assistente); foram corrigidas por schemas precisos e tratamento explícito de ausência.
