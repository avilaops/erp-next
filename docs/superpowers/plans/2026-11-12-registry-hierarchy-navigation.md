# Plano: hierarquia e navegação dos cadastros

Spec: docs/superpowers/specs/2026-11-12-registry-hierarchy-navigation.md
Base inicial: dff8f41ead9846e026951560166ddedb8534ba30. Integração final sobre main 4c865d0, preservando PR190, PR191 e PR192. Worktree isolada a9e9.

## Global constraints
Não preencher linha nacional/Core nem cadastrar os dez modelos excluídos. Não alterar preços, estoque, status ou atribuições comerciais em produção. Não perder WIP ou parar os serviços do usuário. Publicação já autorizada. Somente uma revisão independente deste pacote, sem agentes implementadores.

### Task 1: Modelos de consulta e hierarquia
Interfaces: parser de URL limitado a q/status/role/offset, papéis por tipo de lista; árvore validada por id/parentId com caminho, ordem e descendentes.
1. Escrever testes RED para query inválida, retorno, ciclos, órfãos, duplicados, profundidade e categorias arquivadas.
2. Implementar os modelos puros e executar Node. Expected: comportamento seguro e testes verdes.

### Task 2: Listas e seleção de categoria
Arquivos: ProductCategory, referências, pessoas, equipe, seletor de superior e list-navigation.
1. Escrever navegador RED para filtros/retorno e árvore responsiva.
2. Integrar modelos, preservando vínculos e recusando mistura de empresa. Reutilizar useResource e GuardedLink.
3. Compactar referências no móvel e proteger navegação de funcionário.
Expected: busca/volta/paginação preservadas, sem overflow em 360/393/1280, sem escritas automáticas.

### Task 3: Validação, revisão e publicação
1. Node, lint, tsc, build e navegador no runtime standalone correto.
2. Uma revisão final independente; corrigir achados importantes com RED→GREEN.
3. Rebase no main após PR190, publicar via PR/CI e confirmar versão pública.
Expected: funcionalidades publicadas e registros de produção preservados.

## Review focus
Busca repetida e Back/Forward, parâmetros inválidos, parentId descendente, troca de natureza financeira, carregamento parcial/troca de empresa, categorias arquivadas e falhas preservando vínculo, tabelas longas no móvel, permissões e nenhum dado pessoal persistido para funcionários.

## Evidência de implementação
143 testes de modelo passaram após incorporar a main. Build de produção passou nas 369 rotas; lint completo sem erros, com oito avisos preexistentes. A bateria de navegador cobriu 93 cenários distintos de catálogo, pessoas, equipe, referências, navegação e permissões. Cinco expectativas antigas de suprimentos foram atualizadas para os novos textos e a ausência de rolagem horizontal; os cinco cenários passaram novamente.

A revisão independente encontrou perda de returnTo após salvar referências e criar pessoas/equipe. Os três testes reproduziram a falha no build anterior e passaram após aplicar a função compartilhada aos redirecionamentos. A conferência visual de 320 px acrescentou uma asserção de contenção dos filtros e identificou um ajuste no grid; validação final dos quatro tamanhos é registrada no ledger e nos artefatos. Não há alterações de schema nem de dados comerciais neste pacote.
