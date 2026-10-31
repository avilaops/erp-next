# Entrada do ERP: plano de implementação

**Objetivo:** aplicar a direção visual aprovada na conversa: acesso imediato no
celular, mensagem curta, verde-petróleo e uma prévia verdadeira da interface.

**Arquitetura:** manter a página de entrada como Server Component e preservar
`safeReturnTo`, o formulário GET do login, o cadastro e o aviso de configuração.
Usar os tokens, a fonte Geist e os ícones Lucide já instalados. A prévia será uma
captura local da interface existente, com dados demonstrativos identificados.

**Escopo:** apresentação de `/entrar`; sem mudanças de autenticação ou dados.
O usuário aprovou a direção proposta e pediu a execução nesta conversa.

## Decisões visuais

- Cabeçalho compacto, com a marca existente e link para conhecer o produto.
- Título “Sua operação, sob controle.”, descrição curta e acesso em sequência.
- Botões de entrar e criar conta visíveis em viewport móvel de 390 × 680.
- Prévia abaixo do acesso no celular e ao lado no desktop, em painel petróleo.
- Benefícios em uma faixa compacta após o bloco principal.
- Foco visível, alvos de pelo menos 44 px e suporte ao tema existente.

## Verificações

- Manter destino interno e query string nos dois caminhos de autenticação.
- Sem configuração, mostrar o aviso existente e não oferecer acesso quebrado.
- Confirmar ausência de rolagem horizontal em 320, 390, 768 e 1440 px.
- Revisar layout e teclado no navegador; verificar contraste com axe.
- Executar lint, build e regressões de onboarding afetadas pelo novo título.
- Produção segue `deploy/README.md`: somente imagens construídas pelo CI.

## Tarefas

- [x] Capturar a interface existente com dados de demonstração seguros.
- [x] Reorganizar a página e compactar os benefícios.
- [x] Atualizar as expectativas de título nos testes de onboarding e fiscal.
- [x] Validar, revisar e registrar evidências no AVL-382.

## Evidências locais — 31/10/2026

- `next build`: compilação, TypeScript e geração das 255 páginas aprovados.
- `eslint`: aprovado para toda a aplicação web.
- `playwright test --config playwright.danfe.config.ts onboarding-ui.spec.ts`:
  11 testes aprovados usando Chrome, com adaptadores sintéticos de Auth/API.
- Navegador: sem overflow horizontal em 320, 390, 768 e 1440 px. Ambos os
  botões inteiramente na viewport de 320 × 568 e 390 × 680, sem rolagem.
- Axe WCAG A/AA e 2.1 AA em 390 e 1440 px, temas claro e escuro estabilizados:
  nenhuma violação ou resultado inconclusivo nas quatro combinações.
- Teclado: primeiro Tab revela o atalho de acesso; Enter foca `#acesso`.
- Sem cliente OIDC: aviso preservado, nenhum botão de acesso quebrado.
- Asset público acessível sem sessão; captura WebP de 116 KiB da tela real de
  produtos, com quatro registros exclusivamente sintéticos.
- Revisão independente: segunda expectativa do título identificada e corrigida;
  nenhuma pendência adicional após a revisão final.
- A suíte fiscal de integração depende do backend e não foi executada nesta
  alteração de apresentação; somente sua expectativa de título foi atualizada.
- Publicação em produção não executada nesta entrega.

## Refinamento solicitado após a primeira entrega

O usuário pediu para continuar melhorando a mesma entrada. Manter o acesso na
primeira tela e refinar a composição: reduzir a altura do painel no desktop,
ajustar tipografia em 320 px, explicitar os benefícios e oferecer ampliação da
captura usando o Dialog existente. A região da imagem ampliada deve permitir
rolagem em telas estreitas, preservar foco no modal e devolver o foco ao botão
quando fechado. Sem novas dependências, mudanças de autenticação ou publicação.

- [x] Refinar composição, tipografia e faixa de benefícios.
- [x] Ampliar a captura com o Dialog existente e fechamento em português.
- [x] Verificar foco, Escape, rolagem móvel, contraste, build e onboarding.
- [x] Revisar e atualizar a PR #30 e o AVL-382.

### Validação do refinamento

- Build, TypeScript e lint completos aprovados; 12 testes de onboarding
  aprovados no Chrome, incluindo ampliação/leitura/fechamento pelo teclado em
  320, 390 e 1440 px e preservação do destino de cadastro.
- Página inteira em 1440 × 900; acesso permanece na primeira tela móvel.
- Sem overflow horizontal em 320, 390, 768, 1024 e 1440 px.
- Axe sem violações nos dois temas, em 390 e 1440 px, com prévia aberta e
  fechada. A página fechada não apresentou resultados inconclusivos. No modal,
  a ferramenta pediu revisão manual do foco por causa dos focus guards e do
  fundo aria-hidden do BaseUI; o ciclo de oito Tabs ficou dentro do modal,
  Escape e botão de fechar devolveram o foco ao acionador. A detecção automática
  do fundo do título também foi inconclusiva no modal móvel claro. A leitura
  manual dos estilos confirmou título `#1c1917` e descrição `#57534e` sobre o
  fundo branco do diálogo, sem sobreposição visual. Essas verificações não são
  prova de conformidade integral de acessibilidade.
- Prévia ampliada usa o WebP original para preservar os detalhes e evitar uma
  segunda otimização da imagem ao abrir. O painel inicial mantém otimização.
- Revisão independente sem achados acionáveis. Console sem erros na versão
  de produção local. Produção pública permanece sem publicação desta PR.
