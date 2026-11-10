# Revisão responsiva das telas — 09/11/2026

A revisão parte dos problemas de leitura e operação no celular apontados nas capturas: listas que exigem deslocamento lateral, títulos e ações inconsistentes, espaços vazios sem orientação e formulários muito altos.

## Inventário e alcance

Foram inventariados **228 arquivos `page.tsx`** em `apps/web/src/app`. Rotas dinâmicas e estados de permissão, carregamento, erro e edição multiplicam as telas possíveis; esse número não representa 228 telas visitadas manualmente.

| Grupo de rotas | Arquivos de página |
| --- | ---: |
| Cadastros | 52 |
| Preferências | 41 |
| Vendas | 29 |
| Estoque | 17 |
| Fiscal | 16 |
| Financeiro | 15 |
| Logística | 15 |
| Compras | 11 |
| Serviços | 10 |
| Relatórios | 7 |
| Demais entradas, acesso, ajuda, dashboards e avisos | 15 |
| **Total** | **228** |

A triagem estática considerou entradas de rota, componentes compartilhados, tabelas, larguras mínimas, grades, distribuição de ações e testes existentes nos módulos. Houve leitura aprofundada da estrutura de navegação, `PageHeader`, `PageTitle`, `DataTable`, `Pagination`, estilos globais do workspace, contas a receber/pagar e seletores de cadastros auxiliares. Os fluxos de pedidos, propostas, produtos, estoque e preços recebem alterações específicas na mesma revisão.

## Causas e correções

- Os cabeçalhos compartilhados precisam permitir que títulos e ações encolham e quebrem linha. `PageTitle` passa a quebrar também nomes longos sem espaços, enquanto `PageHeader` limita e permite quebra das ações.
- Contas a receber e pagar não tinham título principal durante a consulta autenticada. As listas passam a apresentar cabeçalho, atalho de consulta da origem e explicação do estado vazio.
- As listas financeiras passam a usar linhas compactas. No celular, identificação e saldo ficam visíveis lado a lado; vencimento, valor e situação acompanham a identificação. As colunas completas retornam a partir de 768 px. Valores monetários preservam as strings decimais e datas aparecem em dia/mês/ano.
- Listas financeiras vazias ou com uma única página dispensam os controles de paginação. Caso uma página posterior fique vazia, o retorno à página anterior continua disponível.
- O seletor de grupos de tags tinha dois botões longos em uma linha sem quebra dentro de um painel estreito. O grupo agora permite quebra de linha.

Não houve alteração de cálculo financeiro, payload, autorização, confirmação ou estorno nessas correções de apresentação.

## Verificação focada

`frontend-states-ui.spec.ts` recebeu casos para contas a receber e pagar nas larguras 320, 390, 768 e 1280 px: nome longo, saldo visível, metadados preservados, colunas de desktop e ausência de overflow na página e na lista. Há casos separados para estado vazio com atalho útil e sem paginação, além de cadastro de tags com seletor estreito e título sem espaços.

As execuções de navegador e os resultados finais são consolidados pela revisão conjunta. Este inventário não declara aprovação visual manual de todas as rotas. As fixtures de interface validam apresentação e navegação; não substituem testes de persistência e permissões reais.

Validação conjunta: build de produção local com 369 entradas geradas e TypeScript aprovado; 65 testes Node aprovados; lint global sem erros (8 avisos preexistentes). A rodada de navegador foi dividida entre pedidos/e-mail, catálogo, controles, estados, propostas e simulador, com repetição das falhas após corrigir a origem da fixture e os ajustes de apresentação. Uma rodada final usa o build de produção em 320, 390, 640, 768 e 1280 px. Foram exercitados filtros, paginação, recarga, recuperação de rascunho, permissões de consulta, comandos incertos, validação de campos recolhidos e preservação das colunas de impressão. A revisão independente dos diffs não identificou bloqueadores.

## Cobertura existente e pontos a conferir

- `navigation-ui.spec.ts` cobre menu, foco, contexto de rota, larguras de desktop/tablet/celular e exemplos de listas auxiliares.
- `company-account-ui.spec.ts`, `company-sections-ui.spec.ts` e `registration-settings-ui.spec.ts` cobrem várias seções de empresa, temas, auditoria e configurações em larguras móveis.
- `catalog-navigation-ui.spec.ts`, `orders-list-ui.spec.ts`, `proposals-ui.spec.ts`, `frontend-states-ui.spec.ts` e `frontend-controls-ui.spec.ts` são a cobertura mais próxima das telas apontadas nas capturas.
- Clientes/fornecedores, funcionários e cadastros auxiliares ainda usam tabelas com largura mínima e rolagem local. A página mantém sua largura, mas a leitura de todas as colunas pode exigir deslocamento. Avaliar cada fluxo antes de condensar seus dados.
- Tabelas fiscais extensas, editor de itens da NF-e e extrato da assinatura mantêm rolagem local por conterem muitas colunas. Conferir foco, campos editáveis e ações no navegador móvel, incluindo Safari/iOS.
- Compras, produção, comissões, ledger e funil têm cabeçalhos/estruturas próprias que merecem uma rodada visual adicional. A triagem do código não confirma legibilidade de todos os estados com nomes e valores de produção.
- Há rotas legadas marcadas como indisponíveis em `demonstration-routes.ts`. Elas montam o aviso compartilhado, sem montar os antigos componentes demonstrativos; revisar o aviso é diferente de validar uma operação inexistente.

Para uma rodada visual ampliada, priorizar 320/390 px, o início da navegação lateral em 900 px, nomes longos, listas vazias, erros de consulta e formulários com alterações pendentes. Evitar generalizar o sucesso de uma fixture para todos os perfis e dados reais.
