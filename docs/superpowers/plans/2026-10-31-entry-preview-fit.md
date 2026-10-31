# Prévia do ERP: visão geral e leitura dos detalhes

**Objetivo:** permitir ver a captura inteira ao abrir a prévia no celular e
ampliar seus detalhes de forma explícita, preservando teclado e fechamento.

**Base operacional:** a preparação começou sobre a fonte publicada `2ffa122`.
Durante a validação, a produção avançou para `125e678`, incluindo preferências
pessoais. A branch foi reaplicada sobre essa versão publicada e saudável.
O diff de API, Cargo e migrations desta rodada é vazio. Não se executam migrações
nem downgrade de uma publicação concorrente.

**Implementação:** reutilizar Dialog e Button existentes, com estado local
somente para “Visão geral” e “Ver detalhes”. Ao abrir, ajustar a imagem inteira
à área disponível; em detalhes, manter tamanho legível e rolagem na região.
Exibir instrução correspondente. Usar layout flexível que mantenha cabeçalho,
controles e fechamento visíveis em telas baixas. Voltar à visão geral ao reabrir.
Sem dependências ou alterações em autenticação, API e dados.

## Tarefas

- [x] Atualizar a jornada existente de prévia e confirmar a falha inicial.
- [x] Implementar modos de leitura e ajuste do modal.
- [x] Verificar retrato, paisagem, teclado, contraste, build e onboarding.
- [ ] Revisar e integrar a alteração na main sem alterar preferências.
- [ ] Publicar somente uma fonte compatível com a produção verificada; rejeitar
  troca se outra release tiver sido aplicada durante esta preparação.

## Verificações

- Visão geral sem overflow da imagem em 320, 390, 568 e 1440 px.
- Detalhes com rolagem no celular e retorno ao início ao trocar o modo.
- Modal em 568 × 320 mantém os controles na viewport.
- Estados selecionados anunciados; imagem identificada; foco contido;
  Escape e fechamento devolvem o foco; reabrir restaura a visão geral.
- Os dois acessos e o destino original continuam preservados.
- Não executar migrations, build no servidor ou regressão de outra release.

## Evidência local

- O teste de paisagem falhou antes da implementação pela ausência de “Visão
  geral”; depois, os 13 testes de onboarding passaram usando Chrome.
- Build, TypeScript e lint completos aprovados. Revisão independente sem achados.
- Visão geral sem rolagem em 320 × 568, 390 × 680, 568 × 320, 844 × 390 e
  1440 × 900. Em detalhes, a imagem permanece legível e permite rolagem.
- Alternar para visão geral zera a rolagem. Reabrir restaura a visão geral.
  Seleção, Tab, Escape e retorno de foco cobertos na jornada de navegador.
- Axe sem violações nos 12 cenários: três viewports, dois temas e dois modos.
  Os avisos inconclusivos de foco e detecção de fundo do título no BaseUI
  permanecem sujeitos à conferência manual; não se declara conformidade integral.
- Console local sem erros. Entrada e autenticação não foram alteradas.
