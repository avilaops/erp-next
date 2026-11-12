# Plano: dados fiscais e rascunhos de pessoas

Spec: docs/superpowers/specs/2026-11-12-party-fiscal-drafts.md
Execução inline, worktree isolada, uma revisão final independente.

## Global constraints
Preservar WIP do checkout principal e processos nas portas 3001/3002. Não emitir notas, enviar e-mails ou criar operações financeiras reais. Não compilar no servidor de aplicações. Publicação já autorizada pelo usuário. Não inventar dados comerciais ou fiscais.

### Task 1: Contrato fiscal persistente
Arquivos: parties.rs, migração aditiva, testes HTTP de pessoas, model.rs, engine.ts, nfe.ts.
Interface: fiscal opcional/nulo com indicador 1/2/9 e IE; indicador fiscal explícito opcional na declaração da nota.
1. Escrever testes de persistência/omissão/limpeza, validação e XML com indicadores explícitos; executar e observar falha.
2. Implementar persistência compatível e validação consistente em API e motor.
3. Executar testes Rust focados e motor. Expected: novos casos e regressões verdes.

### Task 2: Editor seguro e reutilização fiscal
Arquivos: party-access, party-workspace, novo party-draft, nfe-recipient-picker e modelo/editor NF-e.
Interface: tipos gerados do contrato da Task 1; rascunho versionado com baseline, revisão, comando e proveniência.
1. Escrever e executar testes de modelo RED para recuperação, corrupção, quota e dados fiscais.
2. Implementar armazenamento por sessão/empresa, proteção de navegação e confirmação robusta, campos compactos e cópia para NF-e.
3. Executar Node, tsc, eslint e navegador responsivo. Expected: recuperação sem duplicação, tenant/revisão verificados, sem transbordamento.

### Task 3: Verificação e publicação
1. Gerar OpenAPI real e tipos, executar gate compatibilidade, fmt, clippy, testes API/web/motor e build Turbopack.
2. Uma revisão independente do diff completo; corrigir achados relevantes com testes.
3. Commit, PR, CI, merge e publicação de imagens preparadas localmente com backup e migração.
4. Conferir versão pública, API e cadastros. Preencher apenas IBGE comprovado e verificar leitura posterior.
Expected: código publicado e dados comprovados, evidências salvas.

## Review focus
Omissão versus null, mudanças de empresa, edição concorrente, gravação sem confirmação, recarga durante POST, quota/corrupção de armazenamento, dados pessoais entre sessões, indicador isento versus contribuinte, compatibilidade de notas históricas e recortes NFC-e/exterior.
