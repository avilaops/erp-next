# Publicação da versão local do ERP

Solicitação: publicar a aplicação atualmente editada neste computador.

## Restrições

- Preservar a orientação do usuário de não usar Git durante a preparação.
- Usar o fluxo documentado em deploy/README.md: imagens validadas no GitHub CI, sem compilação no servidor.
- Preservar configurações privadas e os dados existentes; nenhuma emissão fiscal é parte do deploy.
- Não habilitar emissão em produção nem automações fiscais como efeito colateral.

## Etapas

1. Identificar destino, dependências e fluxo de release pelos arquivos locais.
2. Validar formatação Rust, frontend e testes fiscais; registrar resultados e corrigir falhas dentro do escopo.
3. Conferir compatibilidade das migrations e das dependências do MCP fiscal local com o ambiente de publicação.
4. Preparar inventário e manifesto da versão local, sem segredos ou arquivos de desenvolvimento.
5. Resolver a autorização para versionamento/publicação somente após apresentar a versão concreta e os resultados, pois a orientação anterior proíbe Git e o fluxo de release exige um commit remoto.
6. Com autorização compatível, executar CI e deploy, validar domínio, saúde e revisão; usar rollback do dispatcher se necessário.

## Evidências iniciais

- Destino documentado: https://erp.avilaops.com; dispatcher no host applications.
- Componentes: API Rust, frontend Next.js e motor fiscal Node.js.
- Dependência adicional das novas modalidades: MCP fiscal Python local com ferramentas e schemas ampliados; não presumir que o MCP remoto possui essas alterações.
- O banco já recebeu as migrations fiscais 202611060003, 202611060004, 202611060005 e 202611080003 nesta sessão.
- O fluxo exige fmt, clippy sem warnings, testes Rust, lint/build/UI web e testes do motor.

## Preparação local concluída

- Formatação Rust e clippy workspace/all-targets com `-D warnings`: aprovados.
- Interface: build de produção aprovado, 365 páginas; lint sem erros (8 avisos).
- Motor fiscal: 146 testes aprovados.
- MCP vendorizado com licença MIT, lockfile e dependências verificadas por hash: 60 testes aprovados.
- Wheel verificado com módulos e XSDs; smoke HTTP local confirmou 47 ferramentas, schema e PDF sintético.
- CI ampliado para construir/testar o quarto container, incluindo smoke sob restrições de runtime; essa verificação de container ainda será executada no runner.
- Dispatcher preparado para quatro imagens, configuração MCP/CA e rollback com remoção de órfãos.
- Rotas de aprovação/e-mail de propostas e módulo de testes agora registrados.
- Suíte browser de release inclui os novos cenários NF-e. Testes completos Rust/UI e imagens devem passar no CI antes de publicar.

## Pré-condições de publicação

1. Resolver com o usuário a autorização de Git, pois a orientação anterior o proíbe e o release exige commit remoto.
2. Conferir/aplicar somente migrations incrementais ausentes e grants mínimos: há fontes locais posteriores à versão de warranty 202611060106 (logística, ledger, inventário, listas e e-mail de propostas). Evitar o workflow antigo de importação completa do legado.
3. Instalar o dispatcher atualizado pelo acesso administrativo autorizado antes de disparar a execução que fará deploy automaticamente.
4. Versionar a versão local revisada, preservar segredos/ambientes privados e executar CI antes de troca de serviços.

Nenhum Git, push, publicação de imagens, atualização de dispatcher remoto ou troca de aplicação em produção foi executado nesta preparação.

## Publicação autorizada

O usuário autorizou explicitamente a publicação após a pergunta sobre commit e push. A restrição anterior de Git foi substituída para este deploy.

- Git remoto e base local conferidos: main bb51680, sem commits remotos novos; aplicação atual saudável nessa revisão.
- Banco: 11 migrations incrementais pendentes aplicadas atomicamente; 160 produtos preservados. Três checksums foram normalizados apenas de CRLF para LF com verificação do hash anterior; fontes SQL agora têm checkout LF explícito.
- Grants mínimos das tabelas novas aplicados; não houve reimportação do legado.
- Teste do dispatcher preserva segredos sintéticos e valida a quarta imagem, isolamento e rollback. Sintaxe Bash e YAML verificadas.
- Próximos passos: commit da versão local, backup/instalação do dispatcher revisado, push/CI completo e conferência da revisão publicada.
