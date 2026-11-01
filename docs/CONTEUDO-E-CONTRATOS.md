# Conteúdo e contratos — AVL-402

## Responsabilidades

Rust mantém autorização, validação, transações, idempotência e auditoria. O contrato Utoipa descreve as operações implementadas. Os aliases da aplicação web importam os schemas gerados; tipos de formulário e estado local continuam próprios da interface quando representam edição.

## Gerar contratos

O exportador de testes existente gera artifacts/contracts/candidate.json na CI, sem iniciar o servidor de produção. O build web recebe o artefato do mesmo commit e executa scripts/contracts/generate-web.mjs. O gerador usa a versão de openapi-typescript fixada em scripts/contracts/consumer/package-lock.json, valida o documento e recusa referências externas.

Para desenvolvimento, instale as dependências do consumidor com npm ci em scripts/contracts/consumer e execute pnpm generate:api com o caminho de um contrato exportado. apps/web/src/lib/api/generated.d.ts é um artefato ignorado pelo Git e precisa ser regenerado quando o backend muda. Não manter uma cópia manual alternativa.

A compilação verifica os aliases dos consumidores. Essa verificação não substitui validação de entrada no servidor ou testes HTTP. O transporte compartilhado mantém cookies e BFF; comandos continuam conservando ETag e chave de idempotência conforme o fluxo existente.

## Ajuda

A ajuda usa imports estáticos dos arquivos apps/web/src/content/help/*.mdx. @next/mdx compila conteúdo confiável do repositório no build. Não há editor remoto, eval, carregamento arbitrário de módulos ou compilação de conteúdo enviado.

HelpAction oferece destinos conhecidos. HelpOrders incorpora o mesmo formulário operacional de vendas mediante ação explícita. Salvar nesse formulário cria um rascunho real, usando as mesmas verificações do módulo de vendas. A documentação não concede acesso.

## Layout pessoal

Preferências incluem favoritePaths, charts e period. São listas limitadas de opções conhecidas, sem scripts, consultas SQL ou URLs arbitrárias. A gravação é explícita, exige If-Match e mantém o isolamento existente por empresa e identidade.

Uma gravação de productPageSize que omite dashboardLayout preserva o layout. Uma revisão concorrente é recusada. A interface conserva a edição e exige releitura após erro ou resultado desconhecido.

A migration 202611010007_dashboard_preferences.sql precisa seguir o fluxo de migração do repositório antes de disponibilizar a nova API. Esta implementação não executa migrações de produção.

## Escopo restante

Aprovações departamentais configuráveis exigem definição de processos, critérios e tratamento de instâncias em andamento. Essa definição não foi inferida nesta entrega. Os indicadores da página inicial continuam exibindo sua indisponibilidade enquanto suas fontes não forem conectadas.

As gravações de layout incluem ownerKey, uma precondição opaca derivada da identidade/empresa autenticada. Ela evita aplicar uma edição de outra conta mesmo com a mesma revisão numérica. Perda de foco/visibilidade invalida requisições pendentes; a retomada confere a sessão e relê o snapshot antes de permitir edição.
