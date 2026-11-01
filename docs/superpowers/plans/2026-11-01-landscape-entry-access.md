# Acesso imediato com o celular deitado

**Problema reproduzido:** em 568 × 320, Entrar começa em y=374 e Criar minha conta em y=438, ambos abaixo da primeira tela.

**Solução:** CSS da rota com seletores exclusivos `erp-entry-*`, restrito à mesma condição da captura em paisagem: orientação horizontal, altura até 500 px e largura até 959 px. Mensagem e acesso ocupam colunas lado a lado. Reduzir espaçamento vertical do cabeçalho e tamanho do título nesse contexto. Manter conteúdo, ordem do documento e tamanho dos controles.

O pipeline atual aplica `@tailwindcss/turbopack` a todos os arquivos CSS e não forneceu os nomes exportados pelo CSS Module na primeira validação. Usar CSS com prefixo exclusivo evita alterar a configuração compartilhada do compilador.

## Plano

- [x] Reproduzir a posição dos botões na entrada pública e ler o fluxo atual.
- [x] Implementar o layout horizontal, sem acrescentar JavaScript ou ocultar conteúdo.
- [x] Validar acesso visível em 480 × 320, 568 × 320, 844 × 390 e 959 × 500, rotação, teclado, retrato, desktop e aviso de erro. Texto ampliado em 50% permanece legível com rolagem e sem exceder a largura.
- [x] Executar lint/build e os 15 testes de onboarding (27,8 s); revisão independente do diff final sem achados.
- [ ] Aprovar CI e release completos e verificar a publicação pública.

## Limites

- Sem alterações de autenticação, API, dados ou migrations.
- Retorno solicitado e criação de conta mantêm os destinos existentes.
- Textos ampliados podem aumentar a altura; a página continua rolável.
