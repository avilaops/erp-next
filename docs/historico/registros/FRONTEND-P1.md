# Catálogo: navegação compacta e edição pendente

## Comportamento

O shell reserva o espaço ocupado pela navegação compacta, incluindo a área segura inferior. A reserva deixa de existir quando o menu desktop aparece a partir de 1600 px. O espaço de rolagem também considera a barra ao posicionar elementos focados.

O editor de produtos registra alterações pendentes no contexto de navegação. Links do shell, módulos, retorno ao catálogo e busca pedem confirmação antes de sair. Recarga e fechamento usam o aviso nativo do navegador. Histórico não depende de interceptação de `popstate`: o rascunho permite recuperar a edição ao retornar ou reabrir.

Rascunhos ficam no `sessionStorage` da aba e são separados por sessão, empresa e produto. O servidor fornece um escopo HMAC; tokens de autenticação não são enviados como identificadores nem guardados no rascunho. Fechar a aba encerra esse armazenamento. A recuperação consulta antes a permissão e a revisão atuais do produto; não restaura campos para quem tem apenas consulta.

Uma revisão diferente bloqueia sobrescrita e oferece recarregamento explícito. Uma criação sem confirmação conserva a mesma chave de idempotência e o mesmo corpo da requisição, inclusive se a aba recarregar durante o envio. Enquanto estiver incerta, a criação não pode ser descartada pelo botão de rascunho. O usuário confere a gravação antes de iniciar outro comando. Edição interrompida exige conferir o estado do servidor.

Rascunho inválido gera aviso e bloqueia salvar até o descarte explícito. Se o navegador não permitir armazenar o comando pendente, a aplicação informa o erro antes de despachar a gravação. Confirmação de gravação ou descarte remove o rascunho.

## Verificação

`apps/web/tests/catalog-navigation-ui.spec.ts` utiliza sessão e respostas HTTP sintéticas, sem acesso à produção. A suíte faz parte de `playwright.danfe.config.ts`, executada pelo CI existente.

Para desenvolver no Windows com Edge, usar variáveis de processo e o servidor de desenvolvimento isolado:

```powershell
$env:ERP_BROWSER_DEV = '1'
$env:ERP_BROWSER_CHANNEL = 'msedge'
pnpm --filter web test:danfe catalog-navigation-ui.spec.ts navigation-ui.spec.ts
```

O modo de desenvolvimento desativa apenas o indicador visual do Next para que ele não cubra os controles testados. Erros de compilação e runtime continuam visíveis. Sem `ERP_BROWSER_DEV`, a configuração usa `next start` e o build produzido pelo GitHub CI.

Para verificar WebKit emulado, definir `ERP_BROWSER_ENGINE=webkit`; o canal Edge é ignorado nesse motor. Sem essa variável, o motor continua Chromium e respeita `ERP_BROWSER_CHANNEL`.

Os testes incluem posições reais dos controles e cliques, cancelamento, menus, histórico, recarga, recuperação/descarte, revisão concorrente, empresa/sessão distintas, consulta, armazenamento indisponível/inválido e repetição da mesma criação após falha/interrupção. Estes testes provam comportamento de interface; não substituem os testes de persistência da API nem validação em aparelho físico.
