# Recuperação da imagem da entrada

**Problema reproduzido:** bloquear a captura móvel na entrada pública deixa a janela quase vazia, com imagem quebrada/alt e sem recuperação.

**Solução:** manter layout e capturas aprovados, acrescentando carregamento e falha explícitos. Reutilizar um componente local para a miniatura e o diálogo. A miniatura permanece um único botão, sem controles aninhados. A imagem ampliada oferece Tentar novamente, com URL de nova tentativa para evitar reaproveitar uma resposta falha e foco transferido à área de leitura antes de remover o botão.

A tentativa é compartilhada entre miniatura e imagem ampliada: recuperar a imagem atualiza ambas, sem deixar uma mensagem de falha antiga na entrada.

Mudanças de fonte por orientação também recriam as capturas. Foi reproduzido no navegador que uma troca para uma fonte com falha, depois de uma imagem já pronta, pode não emitir o evento de erro esperado. A assinatura das duas media queries evita atualizações duplicadas e preserva o foco quando o conteúdo da região é substituído.

## Plano

- [x] Reproduzir falha de rede na captura pública e inspecionar a tela.
- [x] Implementar estados de carregamento, imagem pronta e erro nas duas apresentações.
- [x] Preservar proporção, fontes responsivas e rolagem aprovadas; respeitar redução de movimento.
- [x] Testar espera controlada, falha, tentativa e recuperação; fechar e acessar o ERP continuam disponíveis.
- [x] Executar lint/build/TypeScript e os 14 testes iniciais de onboarding sobre o build de produção (30s); revisão independente sem achados.
- [x] Validar a cobertura adicional de falha durante rotação e recuperação ao voltar, e a opacidade da captura pronta: lint/build/TypeScript e 15 testes de onboarding aprovados no build de produção (28,2s); nova revisão independente sem achados.
- [ ] Aprovar CI/release completos e validar a publicação pública na base então vigente.

## Limites

- Sem mudanças em autenticação, API, dados ou migrations.
- Mensagens em português; sem detalhes de infraestrutura na página.
- Sem botões aninhados na miniatura; fechar e Escape sempre disponíveis.
- Recuperação não depende de recarregar a página nem altera returnTo.
- Base inicial de produção: `019fe004f679792e5ee53ff8af423f35ded4b5f3`; revalidar antes da publicação devido a releases concorrentes.
