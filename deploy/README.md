# ERP Next em produção

Imagens são construídas somente pelo GitHub CI, pelo workflow
`production-release.yml`, com `source_ref` fixado no commit completo,
depois das verificações de cada componente. PRs não reempacotam imagens.
A implantação exige o resultado completo da execução aprovado.
Os artefatos `erp-api-<sha>` e `erp-web-<sha>` contêm imagens Docker por SHA.
O artefato `erp-fiscal-<sha>` contém o motor fiscal, após os testes próprios.

O workflow de release tem timeout de 20 minutos para API e 15 para web.
Falhas não autorizam build no servidor ou a retirada de testes.
Os navegadores usam Chrome do runner.

O workflow `production-migrate.yml`, com `release_run` apontando para uma
execução já aprovada, executa migrations/bootstrap e importação **no runner GitHub**,
conectado ao PostgreSQL por túnel SSH restrito a `172.17.0.1:5432`, sujeito a
autenticação SCRAM em vez das regras trust de loopback. A chave do
túnel não permite sessão ou execução de comandos. Os segredos são configurados
no GitHub: `ERP_MIGRATION_DATABASE_URL`, `ERP_DB_TUNNEL_KEY`,
`ERP_DB_KNOWN_HOSTS`, `ERP_DB_SSH_HOST`, `ERP_BOOTSTRAP_SUB` e
`ERP_BOOTSTRAP_TENANT` e `ERP_LEGACY_DATABASE_URL`. Nunca executar o comando
`migrate` no servidor. O importador recusa um destino que já contém os schemas
legados; não repetir o fluxo após a importação concluída.
Antes de usar a imagem, confere que a revisão de origem possui os mesmos fontes
Rust, lockfile e migrations da revisão que está fazendo o provisionamento.

O bootstrap cria uma empresa com cadastro fiscal pendente e associa a identidade
real confirmada de `nicolas@avilaops.com` ao papel de administrador. O banco é
independente do legado e recebe a cópia e projeção dos dados após o bootstrap.
A conexão de runtime usa papel sem superusuário,
sem BYPASSRLS e sem propriedade das tabelas.

O diretório de release recebe somente `compose.yaml`, imagens prontas e arquivos
privados `api.env`, `web.env` e `.env`. `api.env` contém `DATABASE_URL`,
`AUTH_ISSUER=https://auth.avilaops.com` e `NFE_PRODUCTION_ENABLED=false`.
`web.env` contém `ERP_AUTH_CLIENT_ID`, `ERP_AUTH_CLIENT_SECRET`,
`ERP_SESSION_SECRET` e `ERP_DEFAULT_TENANT_ID`. `.env` fixa `ERP_API_IMAGE` e
`ERP_WEB_IMAGE` e `ERP_RELEASE_SHA`. Não versionar esses arquivos preenchidos.

Web e API compartilham o namespace de rede do serviço API; o BFF usa
`http://127.0.0.1:8080`. Isso mantém a exigência existente de HTTPS ou loopback,
sem liberar HTTP para hosts arbitrários. As duas portas são publicadas pelo
serviço API, somente no loopback do servidor.

O cliente OIDC dedicado `erp-next` pertence ao app Auth `erp` e aceita somente
`https://erp.avilaops.com/api/auth/callback`. Não alterar o segredo do cliente
legado `erp`. O BFF mantém tokens em cookie HttpOnly cifrado e a API consulta
userinfo e valida a associação da empresa. O usuário conclui o login no Auth;
nenhuma senha pessoal é necessária ao deploy.

Carregar imagens com `docker load`; iniciar por `docker compose up -d --no-build
--wait`. O web escuta somente em `127.0.0.1:3140`, compatível com o proxy do
domínio; a API em `127.0.0.1:3141`. Conferir saúde da API, web e redirect OIDC.
O legado permanece parado e preservado em seu diretório. Rollback interrompe
somente o projeto Compose `erp-next`; nunca restaura dados por troca de imagem.

## Motor fiscal em homologação

O overlay opcional `fiscal-compose.yaml` adiciona a imagem fiscal validada pela
mesma execução de release. Carregar `fiscal-image.tar.gz` e configurar, no `.env`
privado do release, `ERP_FISCAL_ENGINE_IMAGE=erp-next-fiscal:sha-<sha-completo>` e
`ERP_FISCAL_ENGINE_TOKEN` com segredo aleatório de pelo menos 24 caracteres. Não
usar token de exemplo nem imprimir `docker compose config` sem ocultar segredos.

O motor compartilha o namespace da API e escuta somente `127.0.0.1:8091`, sem
publicação de porta. O overlay configura a mesma origem/token na API. O health
check autenticado confirma o processo e o ambiente de homologação; não consulta
a SEFAZ e não comprova certificado ou autorização de uma nota.

Após migrations e configuração autorizadas, usar os dois arquivos Compose com
`up -d --no-build --wait`. A imagem do motor roda sem root, com filesystem somente
leitura e diretório temporário limitado. A API conserva os certificados cifrados
e envia material em memória somente durante uma operação autenticada.

A habilitação de consulta automática DF-e requer também o tenant e responsável
explicitamente configurados no `api.env`. Não configurar automação como efeito
colateral do provisionamento do motor. Produção fiscal continua bloqueada.
