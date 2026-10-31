# Retomada de acesso após falha de callback — AVL-384

Navegação HTML ao callback com fluxo inválido, expirado ou ausente agora termina
em `/entrar` com mensagem e uma ação explícita para começar de novo. O destino
interno vem apenas do fluxo selado e passa por `safeReturnTo`; parâmetros de
redirecionamento enviados ao callback não são usados.

Falha de permissão e indisponibilidade têm mensagens próprias. A URL de entrada
não transporta código, estado nem mensagem arbitrária do provedor. Respostas
incluem `Cache-Control: no-store` e `Referrer-Policy: no-referrer`.

Clientes que não pedem HTML mantêm os erros JSON e status HTTP existentes.
PKCE, conferência de estado, prazo, escolha de empresa e emissão da sessão não
foram relaxados. O cookie do fluxo é consumido; a sessão existente não é removida
por uma tentativa inválida.

## Verificação local em 31/10/2026

- TypeScript e lint dos arquivos alterados aprovados.
- Cinco testes de sessão/cookies aprovados em Edge headless, com servidor local.
- Mensagem, destino preservado, ausência de rolagem horizontal e foco na ação de
  entrada verificados em 320, 390 e 1440 px.
- Capturas geradas pelo teste em `apps/web/test-results/`.

O teste usa dados controlados e um host HTTPS sintético. Inspeciona a resposta
real do callback e renderiza a página de entrada pelo transporte local; não é
uma prova de login de produção. Publicação e validação autenticada permanecem
pendentes na AVL-384/AVL-397.
