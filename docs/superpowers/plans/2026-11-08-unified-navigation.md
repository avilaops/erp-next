# Navegação unificada

## Escopo aprovado na conversa

Unificar a navegação operacional e Preferências usando o padrão de categorias,
ícones, divisores e seleção da referência apresentada. Composição editorial em `content/preferences/overview.mdx`; pesquisa e estado em TypeScript.
Manter URLs, permissões e
estados de indisponibilidade. Trabalho local sobre a cópia solicitada; sem criar
branches remotas ou publicar alterações.

## Abordagem

Compartilhar o botão de categoria e o catálogo de configurações. Separar Compras,
Fiscal, Logística e Serviços em módulos próprios, preservando atalhos existentes.
Manter o menu expansível responsivo e as categorias de Preferências: substituí-los
por uma tela única aumentaria a mudança e retiraria contexto da operação.

## Plano de implementação

- [x] Cobrir a presença dos nove módulos, destinos ausentes, integridade das rotas
  e cobertura da busca para todas as configurações disponíveis.
- [x] Compartilhar catálogo de Preferências e botão visual; completar navegação.
- [x] Executar testes de catálogo, TypeScript, lint e arquitetura.
- [x] Exercitar desktop, celular, recolhimento, seleção e busca com fixtures
  isoladas, sem escritas na API de produção.

## Limites de revisão

Rotas de criação/edição e detalhes continuam acessíveis nos próprios fluxos.
Itens indisponíveis continuam identificados em Preferências e não entram na busca
como funcionalidades implementadas. Verificar foco, Escape, nomes acessíveis,
rolagem em telas estreitas e ausência de links duplicados por grupo.

## Evidências

- Catálogo: 4 testes passaram.
- Arquitetura: validação sem erros; 10 testes passaram.
- Navegador: 6 cenários principais e 1 cenário de categoria por URL passaram.
- Capturas desktop/celular e temas em artifacts/danfe-browser.
- Tipos gerados da API preparados localmente a partir da instalação anterior.
- Revisão: corrigida seleção da categoria por query string; sem publicação.
- TypeScript: sem erros. ESLint: sem erros, com aviso existente sobre a imagem da marca.

## Ajustes solicitados durante a implementação

- Barra lateral com 224px em desktop, 208px em telas menores e 64px recolhida;
  controles por ícone no topo e rodapé.
- Preferências usa somente a barra lateral/menu móvel para selecionar categorias;
  a composição MDX permanece e a pesquisa sincroniza a categoria na URL.
- Funcionários, pessoas, catálogo e cadastros auxiliares usam tabela também no
  celular; rolagem contida e nome do registro como link, sem prefixo Consultar.
- Vendedor é cargo no cadastro de Funcionários; rotas antigas redirecionam para
  o mesmo registro, incluindo edição/criação. Nenhuma migration ou escrita em
  produção. A flag comercial do contrato de API permanece interna; é ajustada
  ao cargo no salvamento explícito, preservando cargo legado inalterado.
- Verificados: 8 cenários iniciais de navegador e 2 retestes corretivos passaram;
  7 testes de catálogo/cargo passaram, assim como a validação de arquitetura.
