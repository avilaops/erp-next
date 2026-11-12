# Plano: hierarquia e navegação dos cadastros

Spec: docs/superpowers/specs/2026-11-12-registry-hierarchy-navigation.md
Base: dff8f41ead9846e026951560166ddedb8534ba30; PR190 ainda em CI. Worktree isolada a9e9.

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
