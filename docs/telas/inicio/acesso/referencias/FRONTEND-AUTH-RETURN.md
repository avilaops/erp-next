# Retorno ao trabalho após autenticação

O proxy preserva caminho e consulta internos em `returnTo`. A página de entrada encaminha esse destino ao login e ao cadastro. O início do OIDC valida o destino e o inclui no cookie autenticado do fluxo; o callback usa somente esse valor, nunca um destino recebido diretamente na URL de callback.

URLs externas, caminhos de API, autenticação, caracteres de controle, barras invertidas, codificações inválidas e destinos que reiniciariam o seletor/cadastro são rejeitados. Destinos inválidos usam Dados da empresa como retorno. O limite também é aplicado depois da normalização da URL para manter o cookie de fluxo dentro do tamanho suportado.

Com várias empresas, o destino acompanha o seletor. A seleção continua exigindo confirmação de acesso pela API e não amplia a validade da sessão. Com nenhuma empresa, o destino acompanha o cadastro. Os links de recuperação preservam a rota e respeitam o bloqueio de edição pendente.

Se a sessão expirar durante o seletor ou cadastro, a recuperação reaproveita o destino original validado, sem voltar ao próprio fluxo de acesso nem descartar os filtros solicitados.

As consultas e os comandos compartilhados conservam o status HTTP. Seus erros 401 oferecem entrada contextual; erros de indisponibilidade mantêm as ações de tentativa existentes. O resumo da empresa oferece seleção de empresa quando carregado, login em 401 e nova tentativa em falha de consulta.

A suíte `onboarding-ui.spec.ts` testa o fluxo com provedores locais sintéticos, incluindo destino autenticado, rejeição de redirecionamento externo, sessão expirada, seleção de empresa e recuperação 401/503. Nenhum teste depende da sessão real do usuário.
