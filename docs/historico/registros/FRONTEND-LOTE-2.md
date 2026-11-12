# Navegação, preferências e controles

## Comportamento

Menus desktop, módulos compactos, atalhos e busca usam o mesmo catálogo de destinos. A busca inclui as operações dos menus e distingue o módulo Financeiro das configurações financeiras. Produtos abre diretamente o catálogo. Destinos repetidos são agrupados pela URL, preservando os nomes alternativos como termos de busca. As permissões continuam sob responsabilidade das rotas e APIs.

Preferências da empresa tem painel de categorias no mobile, fechamento por Escape com retorno de foco e pesquisa por título, grupo e descrição, ignorando acentos. A pesquisa oferece limpeza e estado vazio. Linhas disponíveis abrem a configuração correspondente; Marca informa indisponibilidade. A página não presume conclusão, contagens de usuários ou saúde de integrações. A consulta da empresa mantém seu carregamento e erro próprios.

Em 320 px, o acesso a empresas usa ícone com nome acessível e área de interação preservada. Os demais acessos do cabeçalho permanecem disponíveis.

Filtros de produtos e paginação ficam nos parâmetros de URL `q`, `status` e `offset`. Recarga, link copiado e histórico restauram a consulta. Alterar filtros reinicia a página. Valores inválidos são normalizados antes da chamada à API: busca com até 160 caracteres, situação reconhecida e offset entre 0 e 100000 em páginas de 25. O limite de offset impede avançar e orienta refinar a busca.

Os botões de download do histórico de exportação e da importação demonstrativa ficam desabilitados com explicação visível, pois essas telas não produzem arquivos. Isso não implementa exportação nem validação real de importação. A revisão dos demais estados demonstrativos pertence ao lote 3.

## Verificação

`apps/web/tests/frontend-controls-ui.spec.ts` cobre os seis achados deste lote com sessão e respostas sintéticas em ambiente isolado. A seleção integra o CI existente em `playwright.danfe.config.ts`.

Além das reproduções dos defeitos, os cenários verificam Escape/foco, vazio/limpeza, falha HTTP da empresa, destinos financeiros/fiscais, navegação mobile, download indisponível, recarga/histórico/nova aba, limites dos parâmetros e larguras de 320, 390, 768, 1280, 1599, 1600 e 1749 px.

Para executar no Edge:

```powershell
$env:ERP_BROWSER_DEV = '1'
$env:ERP_BROWSER_CHANNEL = 'msedge'
pnpm --filter web test:danfe frontend-controls-ui.spec.ts
```

O modo local usa Next dev. O CI compila e executa Next start. Capturas e relatórios ficam em `artifacts/danfe-browser`, fora do versionamento. WebKit emulado não equivale à validação em iPhone físico; teclado virtual, leitor de tela e safe area em dispositivo real continuam pendentes.
