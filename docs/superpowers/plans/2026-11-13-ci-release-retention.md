# CI, publicação e retenção de releases

> Execução autorizada: implementar localmente, testar, enviar ao GitHub, integrar conforme as proteções e publicar/validar no ERP em produção. O usuário autorizou expressamente o teste real.

**Objetivo:** separar validação de PR, promoção de versão e regressão completa; limitar o armazenamento de deploy no servidor.

**Arquitetura aprovada:** `ci.yml` valida os módulos alterados; `release.yml` publica apenas uma revisão promovida por tag ou acionamento manual; `regression.yml` executa a suíte completa semanalmente ou sob demanda. Workflows internos reutilizam as mesmas validações. As imagens são publicadas no GHCR e consumidas por digest. O servidor mantém a revisão ativa e a anterior; limpa temporários, releases e imagens antigas exclusivamente do ERP. Migrações precedem a ativação e seus snapshots técnicos seguem retenção limitada. Dados persistentes e backups externos não são removidos.

**Restrições:** não alterar código de negócio, segredos ou políticas de branch. Trabalhar exclusivamente em `C:/Users/nicol/source/erp-next-main`, conforme a preferência posterior do usuário. Assistant e a limpeza específica do PR 13 ficam fora da nova automação. Não usar prune global. Não publicar automaticamente ao fazer merge.

## Execução

- [ ] Escrever testes de manifesto, seleção de versão e retenção: caminhos externos/symlinks, revisão ativa e rollback, imagens em uso/compartilhadas, falhas parciais e snapshots técnicos.
- [ ] Implementar manifesto por digest e limpeza restrita a recursos do ERP; integrar ao dispatcher com verificação de saúde e rollback.
- [ ] Consolidar tarefas reutilizáveis de API, web, fiscal e verificações do projeto. Preservar testes existentes de contratos, banco, isolamento e navegador.
- [ ] Criar os três fluxos de entrada, promoção explícita, evidências com expiração e sincronização de contexto após deploy confirmado.
- [ ] Documentar preparação do GHCR e instalação deliberada do dispatcher, retenção, execução e recuperação.
- [ ] Executar testes de CI/deploy/fiscal, validar YAML, expressões Actions e sintaxe shell; revisar a branch.
- [ ] Commit, push e PR. Informar checks e pendências de ativação sem declarar publicação em produção.

## Decisões

- A publicação sempre resolve e verifica o SHA completo, ancestral da main. Um PR não recebe credenciais de produção nem publica imagens.
- A validação de PR continua leve por escopo; a promoção e a regressão executam as verificações completas. Alterações de infraestrutura selecionam todos os módulos.
- O portal de contratos conserva sua construção manual como tarefa específica de `regression.yml`. Importações históricas permanecem nos scripts de provisionamento, fora dos disparos normais.
- O checkout original tinha todos os 14 workflows excluídos ao iniciar esta implementação. A substituição será criada no worktree `3e66` e não restaurará esses arquivos no checkout original.
- Orientação posterior: os sete novos workflows e seus scripts foram transferidos para a pasta original; não continuar no worktree. Incluir duração real de cada script em resumo e artefatos de sete dias.
- Limpeza expressamente solicitada: removidos 26 releases sem referência de containers, 26 temporários e um arquivo obsoleto, sob lock e com saúde conferida. Liberados 8.955.133.952 bytes. A release ativa antiga permanece até a publicação validada da main.
