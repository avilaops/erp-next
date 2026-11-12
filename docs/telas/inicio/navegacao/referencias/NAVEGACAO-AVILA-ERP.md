# Navegação do Avila ERP

A estrutura compartilhada reserva 16 px nas laterais em telas menores e 32 px no desktop. Formulários de produto têm largura máxima de 1120 px; listagens aproveitam a largura disponível. O cabeçalho compartilhado aceita breadcrumb, retorno contextual e ações.

O menu mantém o módulo da rota atual expandido, identifica a página com `aria-current` e conserva o painel lateral ao interagir com o conteúdo. O modo recolhido usa tooltips e painel flutuante. O painel móvel mantém as regras de foco e fechamento do componente Sheet existente.

Links protegidos preservam a consulta de listagens de cadastros, propostas, pedidos, contas e ordens de serviço ao abrir registros e retornar. Essa preservação cobre filtros e paginação representados na URL; filtros mantidos apenas em estado local continuam dependendo do componente de origem. O destino de retorno precisa pertencer à mesma listagem.

O cadastro de produto mantém o cabeçalho durante o carregamento, mostra skeletons do formulário e distingue falha de consulta, falta de permissão e produto não encontrado. As proteções de rascunho e confirmação de saída permanecem no NavigationGuard.

## Verificação

- Conferência visual local no Brave com produto real carregado, menu ativo e temas do produto; capturas locais em `artifacts/navigation-refresh/`.
- O teste automatizado de navegação cobre menu móvel, foco, rota ativa, recolhimento e limites da janela. O teste de catálogo cobre retorno filtrado e registro ausente.
- A matriz manual completa de quatro larguras nos dois temas e nos dois níveis de zoom não foi concluída: a conexão de inspeção do Brave sofreu desconexões. Não interpretar capturas parciais como validação dessa matriz.
- Build e testes devem executar no GitHub. Publicação do código, resultado do CI e deploy são etapas distintas.
