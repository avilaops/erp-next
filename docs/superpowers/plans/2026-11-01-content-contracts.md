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

- [x] 1. Registrar testes de layout e contrato; observar falha na CI antes da implementação.
- [x] 2. Implementar schemas explícitos, geração de tipos, aliases e migração dos consumidores; compilar e validar contratos.
- [x] 3. Extrair ajuda para MDX local com componentes existentes; testar pesquisa, orientações e acesso às operações.
- [x] 4. Persistir layout com RLS/revisão/auditoria e salvar explicitamente na interface; testar releitura, conflitos e isolamento.
- [ ] 5. Executar CI completa, revisar diff, corrigir achados e entregar PR com evidências.

## Ledger

Ruling: o inventário é uma previsão de impacto, não uma meta de quantidade. Alterar somente os arquivos necessários à solução verificada; registrar arquivos adicionais quando úteis à separação de responsabilidades.

Ruling: o recurso de contexto compartilhado Linear retornou Tool not found. Ticket AVL-402 permanece disponível; fontes atuais do GitHub são a referência.

RED: CI 41274802541 confirmou dashboard_layout_persists_without_legacy_writes_erasing_it com HTTP 422 versus 200 esperado; 154 testes passaram, um falhou e um foi ignorado. O lint também identificou formatação, corrigida com rustfmt antes do próximo commit.

Review fix: scope ownerKey verifica identidade além de empresa/revisão em gravações de layout; controles aguardam snapshot; links usam GuardedLink; qualquer gráfico removido pode ser readicionado. Testes cobrem revisões coincidentes de identidades distintas e leitura atrasada.

Ruling: schemas auxiliares em contracts/api.rs e contratos do monitor/assistente foram adicionados onde o inventário inicial ainda não representava respostas genéricas e streams. Os workflows assistant e production-release também precisam gerar tipos para manter todos os builds reproduzíveis. Nenhum workflow de publicação foi disparado.

Validação intermediária: 25d8b83 passou Rust/PostgreSQL, rustfmt/Clippy, regressões do gerador e lint web. A compilação apontou 13 incompatibilidades antes ocultas por tipos manuais (campos opcionais/nulos e kind do assistente); foram corrigidas por schemas precisos e tratamento explícito de ausência.

Validação 794248a: suíte Rust/PostgreSQL, Clippy, lint web e testes do gerador aprovados. A web identificou duas diferenças restantes de projeção: descrição ausente no resumo de papéis e uso de relação comercial sem necessidade de endereços. Os consumidores foram ajustados aos campos efetivamente usados. Navegador e gate final ainda dependem da próxima execução.

Ruling: o usuário autorizou explicitamente a exceção pontual dos 12 achados do PR #46 em 2026-11-01. A admissão exige hashes exatos da baseline e do candidato e achados completos iguais; não suprime regras nem reescreve compatible/eventBaseCompatibilityVerified/runtimeVerified. Custo da restrição adicional ao candidato: uma mudança posterior no contrato exige nova análise, mesmo que não adicione um achado incompatível.

RED da exceção: contra o gate original, o novo teste afirmou que o gate precisa avaliar a política e falhou porque evaluateCompatibilityPolicy não existia. GREEN local: 24 testes da exceção e 14 regressões do comparador aprovados. O CLI real foi executado sobre os contratos originais baixados do artefato 13071222948: exit 0, compatible false, 12 achados preservados e policyDecision reviewed_schema_correction. O CLI também rejeita a remoção de um endpoint em contratos não autorizados.

Revisão independente da exceção fe9a821: sem achados concretos; revisão estática, sem executar testes.

Ruling: main avançou para d9e82b3 com AVL-396, criando conflitos e impedindo a CI do PR. Sincronização preserva ambas implementações: autorização de contrato continua fixa, novos fluxos fiscais e testes permanecem, e a migration de layout muda para versão 202611010006 para não repetir a versão 202611010001 já usada por returns. Nenhuma autorização foi ampliada. A nova baseline tem hash e27dcd4a58ee5aeea7645f2513612f44b92d680775856d71bf837efa4fb28ec4 e não corresponde à exceção autorizada; o CI deverá produzir a nova comparação sem suprimi-la.
