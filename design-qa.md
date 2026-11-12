# QA visual — auditoria mobile do novo pedido

final result: passed

## Fontes e comparação

Auditoria P0/P1/P2 fornecida pelo usuário e sete capturas em `C:/Users/nicol/Downloads/`: `WhatsApp Image 2026-11-12 at 4.43.42 PM.jpeg`, `4.43.42 PM (1).jpeg`, `4.43.43 PM.jpeg` e `4.43.43 PM (1–4).jpeg`, todos com o mesmo prefixo. Cada imagem mede 738×1600 pixels; o conteúdo equivale a aproximadamente 369 CSS px com densidade 2. As capturas são parciais, com posições diferentes de rolagem e interface nativa do iPhone.

Implementação em `/vendas/pedidos/novo`, build de produção local, fixtures sintéticas. Chromium com perfil Pixel 7 e WebKit com perfil iPhone 13, viewport 369×800 CSS px, escala 1; estado inicial também em 369×653, temas claro e escuro. Não houve gravação de cliente, pedido ou título real, envio de e-mail ou transmissão fiscal.

Evidências locais em `artifacts/new-order-mobile-{chromium,webkit}/test-results/` e relatórios JSON nas mesmas pastas. Comparações conjuntas inspecionadas em `artifacts/new-order-mobile-audit/comparison-initial-webkit.png` e `comparison-final-date.png`. A inicial recorta a interface externa do iPhone e normaliza a fonte para 369px; a data compara apenas a região correspondente, com o campo vazio nos dois lados. O contexto financeiro difere porque a implementação contém um equipamento sintético. Não se afirma equivalência de posições de rolagem ou renderização pixel a pixel.

## Resultado por superfície

- **Layout e hierarquia:** cabeçalho compacto com retorno para Pedidos; atalhos em uma linha rolável, na ordem Equipamentos → Cliente → Entrega → Desconto → Pagamento → Revisão. Rótulo da tabela separado da quantidade e versão nos detalhes. Busca com rótulo persistente, dica curta e ação Adicionar equipamento. Cliente existente tem resumo e ações explícitas; cadastro aparece quando solicitado. A ação de editar informa que altera o cadastro compartilhado.
- **Negociação e revisão:** desconto precede pagamento, com percentual, efeito em reais, valor negociado com IPI e status efetivo de aprovação. Referência de alçada do perfil fica nos detalhes. Frete por conta da empresa é identificado como custo, sem somar ao total cobrado. UF explicita origem no endereço, padrão da tabela ou alteração manual. Resumo fixo mostra total e acesso à revisão; estado vazio pede equipamentos em vez de listar valores fictícios.
- **Validação e ação:** pendências por seção levam ao campo correspondente, com mensagem e associação acessível local. Salvar valida e explica o bloqueio. O texto diferencia criação numerada e confirmação posterior, que reserva estoque e gera recebimentos previstos. Envio duplicado, repetição incerta, troca de empresa e navegação preservam os comandos e proteções existentes. Nenhum rascunho com dados pessoais foi acrescentado ao armazenamento local.
- **Pagamento e datas:** entrada calculada fica legível e pode ser alterada. Forma e vencimento aparecem quando há entrada; campo vazio indica Na confirmação do pedido e calendário. Entrada e saldo têm contexto próprio. A geração explica a data-base, mostra intervalo apenas para múltiplas parcelas, preserva a confirmação ao substituir parcelas editadas e confere a soma em centavos. Datas da entrada e das parcelas usam o mesmo controle nativo com padding zero; borda e espaçamento pertencem ao contêiner.
- **Tipografia, cores e ícones:** família e escala 18/14/12 do ERP preservadas, campos mobile com 16px, controles e alvos principais com pelo menos 44px. Temas existentes, foco visível e mensagens textuais de erro/aprovação; cor não é o único sinal. Ícones vêm da biblioteca instalada. Não foram criadas imagens, marcas ou dependências.
- **Teclado e largura:** resumo fixo respeita safe-area, sai da área visível quando VisualViewport indica teclado e os campos têm margem de rolagem. Documento permanece dentro da viewport; tabela de equipamentos mantém rolagem interna. Cidade e UF ficam agrupadas quando a largura permite.

## Ajustes encontrados durante QA

1. **Cabeçalho e navegação altos:** a primeira comparação escondia a busca no estado inicial. Reduzidas margens e descrição redundante no celular; atalhos passaram de duas linhas para uma. Comparação final mostra busca, ação de adicionar e total rápido em 369×653.
2. **Data nativa do iPhone:** a fonte mostrava campo vazio ultrapassando a borda. O padding do próprio input foi removido e transferido ao contêiner. O [bug WebKit 301648](https://bugs.webkit.org/show_bug.cgi?id=301648) documenta esse problema no iOS, sem reproduzi-lo no desktop. Testes conferem padding zero, limites do cartão e edição tanto da entrada quanto das parcelas; a imagem final mostra indicação e calendário dentro do cartão.
3. **Revisão de código:** três problemas materiais corrigidos: entrada inválida não pode desaparecer da lista quando a simulação perde o resultado; usuário sem gestão cadastral precisa ser levado à busca; desconto, valor negociado e frete precisam apontar ao próprio campo e erro. Revisão independente confirmou os três e não encontrou regressão material residual.
4. **Contrato dos testes:** atualizadas as expectativas para a mensagem precisa de entrada entre 0% e 100% e para a renumeração acessível das parcelas após remoção. Sem enfraquecer validação de soma, escrita, foco ou payload.

## Verificação

- Build de produção com TypeScript e 369 páginas concluída; lint completo sem erros, com oito avisos preexistentes. Após integrar main e preservar a atualização cadastral/fiscal do PR190, nova build aprovada e modelos 138/138.
- Chromium mobile: 16/16. WebKit mobile: 16/16, ambos repetidos e aprovados na build integrada com main. Cenários incluem CPF/CNPJ novos, outra UF, pagamento integral e parcelado, datas, limites, falha de cálculo, acesso restrito, preservação do preenchimento e próximos passos após salvar com número.
- Regressão comercial: 90/90 aprovados em uma execução completa na build integrada. Inclui cliente existente/novo, autorização, consulta e falha, repetição incerta, troca de empresa, parcelas editadas, valores em centavos e payload, além das larguras de 320px até desktop.
- Revisões independentes de cliente, checkout, ramo completo e última alteração visual concluídas. Sem achados P0/P1/P2 residuais conhecidos dentro do escopo implementado.

## Limites

WebKit automatizado no Windows não equivale a Safari em iPhone físico. Não foram executados VoiceOver nem teclado físico do aparelho: o teste de teclado simula redução de VisualViewport. A combinação real de safe-area, teclado e zoom precisa de conferência no dispositivo. Ver [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) e [env/safe-area](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env).

Erros HTTP 503/405 esperados nas fixtures de falha e nas rotas auxiliares não representam erro de produção. Nenhuma exceção JavaScript não tratada foi observada nas rodadas finais. Nenhuma consulta ou gravação de negócio foi feita em produção como teste. O épico AVL-432 permanece mais amplo que esta entrega.
