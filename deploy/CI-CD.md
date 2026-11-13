# Validação e publicação do ERP

## Fluxos

| Arquivo | Disparo | Resultado |
| --- | --- | --- |
| `ci.yml` | PR ou manual | Lint, testes e banco por escopo; sem publicação |
| `release.yml` | Tag `v*` ou manual na main com SHA completo | Validação completa, imagens GHCR, migração, deploy e conferência pública |
| `regression.yml` | Segunda-feira 04:23 UTC ou manual | Regressão completa; sem publicação do ERP |

Os quatro arquivos `_validate-*.yml` são tarefas reutilizáveis. Não possuem
disparos próprios. Infraestrutura desconhecida seleciona todos os módulos no PR.
Os testes de contratos, arquitetura, inventário e banco foram incorporados às
tarefas compartilhadas; o Assistant inativo não tem workflow dedicado.

O portal de contratos conserva a construção manual: selecionar a tarefa
`contracts-portal` em `regression.yml`. A imagem validada fica em
`ghcr.io/avilaops/contracts-portal:sha-<commit>`. Esse fluxo não troca o portal
nem o ERP em produção. Scripts de importação histórica continuam versionados;
bootstrap e reimportação não integram uma publicação normal.

## Preparação inicial

Esta mudança não exige trocar os segredos existentes `ERP_DEPLOY_*`. O token
do GitHub Actions precisa poder publicar packages; o Docker do servidor precisa
ter acesso de leitura aos quatro pacotes privados `ghcr.io/avilaops/erp-next-*`.
Não copiar o token de escrita do CI para o servidor nem gravá-lo em arquivos do
repositório. Validar o acesso com a primeira imagem candidata, antes da ativação.

Antes do primeiro deploy deste protocolo, instalar a versão revisada de
`deploy/production-deploy.sh` em `/usr/local/sbin/erp-next-deploy`, conservando
uma cópia privada do dispatcher anterior. Fazer isso sob o lock
`/mnt/HC_Volume_106542212/erp-next/.deploy.lock`, sem release em andamento,
conferindo o SHA-256 dos bytes LF aprovados. A conta SSH continua limitada ao
comando `deploy erp-next <sha>`.

O novo pacote contém somente manifesto, Compose e dois helpers Python. Ele
inclui também os dois scripts revisados de permissões fiscais restritas, aplicados
após as migrações e antes de ativar os serviços. Ele
não é compatível com o dispatcher antigo: este recusará o pacote antes de
alterar os serviços. O código não instala ferramentas nem compila no servidor.

## Publicar

1. Integrar o PR após os checks exigidos pela política do repositório.
2. Selecionar **Release / Run workflow**, branch `main`, e informar o SHA completo
   integrado; alternativamente, criar uma tag de versão `v1.2.3` nesse commit.
3. A seleção confirma que a revisão pertence à main. As imagens são construídas
   e testadas no GitHub e o manifesto aceita apenas os quatro digests do ERP.
4. O ambiente `production` conserva suas proteções. Uma única release executa
   por vez. O servidor baixa os digests usando sua credencial de leitura.
5. O helper aplica somente migrações pendentes da imagem candidata antes de
   ativar os serviços. Preserva o cadastro, os segredos e os volumes existentes.
6. A conferência verifica API, web, página de entrada, mídia e SHA. Falha na
   ativação tenta restaurar o conjunto anterior. Rollback de imagens não desfaz
   automaticamente as migrações do banco.

Pushes e merges comuns na main não disparam publicação. Agrupar alterações
aprovadas em uma versão permite reduzir builds completos.

## Retenção no servidor

- Manter a release ativa e a anterior, identificadas em `deployment-state.json`.
- Remover somente diretórios SHA reconhecidos, imagens com referências exclusivas
  do ERP e temporários `.incoming.*` reconhecidos e abandonados há mais de 24h.
- Proteger todas as imagens referenciadas por containers, inclusive parados e de
  outros projetos, além dos digests necessários para rollback.
- Preservar diretórios desconhecidos, symlinks, volumes e imagens compartilhadas.
- Remover snapshots técnicos antigos de schema/ledger e conservar os das duas
  releases e o diagnóstico da tentativa malsucedida mais recente. Esses snapshots
  não substituem o backup externo dos dados. Outros backups privados não são alvo.
- Limitar logs Docker a três arquivos de 10 MB por serviço.
- Remover o temporário da tentativa atual também em falhas. Uma falha da limpeza
  gera aviso; não restaura uma aplicação saudável por causa de limpeza de disco.

Arquivos de teste expiram em sete dias; manifestos, em 14; evidências técnicas,
em 30. Imagens ficam no GHCR. O servidor não armazena arquivos de imagem `.tar.gz`.

## Tempo de execução

Cada etapa de script executa pelo medidor `scripts/ci/timed.py`, que preserva
o código de saída e registra duração real em segundos, início, job e tentativa.
Os resultados aparecem no resumo do GitHub e nos artefatos `timing-*`, em JSONL,
com expiração de sete dias. Argumentos de comandos, ambiente e segredos não são
gravados no relatório. As Actions de checkout, cache e build mantêm também as
medições nativas do GitHub.

Para simular a limpeza, usar o helper da release aprovada **sem `--apply`**,
informando os SHAs ativo e anterior. Uma execução manual com `--apply` deve
adquirir o mesmo lock de deploy. Não usar limpeza global do Docker.

## Falhas e recuperação

Falhas de pull, manifesto ou migração impedem a troca. Snapshots e diagnósticos
continuam privados. Se o mesmo SHA já tiver uma tentativa de migração, inspecionar
o snapshot existente antes de deliberadamente liberar uma repetição; o helper
nunca sobrescreve esse diagnóstico. Se o rollback falhar, os diretórios e imagens
referenciados pelos containers continuam protegidos e exigem recuperação assistida.

## Validação da mudança

Executar `python -B -m unittest discover -s scripts/ci -p 'test_*.py'`, com
PyYAML 6.0.3 instalado; `python -B -m unittest discover -s scripts/deploy -p
'test_*.py'`; `node --test scripts/mlops/release-gate.test.mjs`; actionlint;
`bash -n deploy/production-deploy.sh`; e os testes fiscais existentes.
