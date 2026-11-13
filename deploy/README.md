# ERP Next em produção

## CI e publicação

O workflow `CI` valida PRs pelo escopo alterado: lint e testes de modelo da web,
formatação e testes Rust com PostgreSQL para API/migrations e testes npm do motor
fiscal. O check obrigatório continua sendo `gate`; skips só são aceitos quando o
planejador exclui explicitamente o componente, e o artefato registra esse escopo.
Mudanças em infraestrutura desconhecida executam os três componentes. Não há
segunda execução de CI no push para `main`.

`CI full regression` conserva arquitetura, contratos, baseline, builds e browsers
para execução manual ou semanal (segunda-feira, 04:23 UTC). O auto merge verifica
a evidência do PR e não inicia publicação. Deploy e migrations seguem o procedimento
direto no servidor; `Production release` permanece disponível apenas manualmente.

## Publicação direta

O fluxo operacional é compilar na máquina de desenvolvimento, testar o trecho
alterado e enviar o pacote pronto por SSH. O servidor aplica a versão e as
migrações pendentes diretamente, sem aguardar o workflow completo. Não compilar
no servidor de aplicações: ele compartilha memória com outros serviços.

No Windows, a API Linux pode ser gerada localmente com `cargo-zigbuild` e Zig:
`cargo zigbuild --target x86_64-unknown-linux-gnu.2.36 --locked -p erp-next-api`.
Reutilize o cache de `target`; limite `CARGO_BUILD_JOBS=1` em máquinas com pouca
memória. Para a web, use `ERP_BUILD_CPUS=2` e `pnpm --filter web build`. A variável
limita os workers do build sem mudar o layout ou a configuração da aplicação.

Identifique o commit e os hashes dos pacotes. Preserve as dependências Linux das
imagens de runtime e substitua somente o executável da API ou o build da web
quando as dependências não mudarem. Uma mudança de dependências exige imagem
compatível reconstruída e validada. Registre quais componentes foram atualizados.

Antes das migrações, preserve um backup do schema e confira os arquivos/checksums
contra `_sqlx_migrations`. Execute somente `erp-next-api migrate`, usando as
migrações da mesma revisão da API. O SQLx aplica apenas as pendentes. Bootstrap e
importação do legado são operações de provisionamento e não fazem parte de uma
publicação normal. Não os repita.

O dispatcher versionado em `deploy/production-deploy.sh` recebe também
`migrate-release.py` no pacote da mesma revisão. Após validar o Compose, ele
executa o helper antes de instalar o rollback de ativação ou iniciar serviços.
O helper guarda schema, ledger SQLx e diagnóstico em
`private/migration-<sha>/`, com diretório privado e arquivos de acesso restrito.
Confere o banco local esperado e aplica o comando `migrate` da imagem candidata
por socket PostgreSQL, com a identidade local do postgres. Nenhuma senha é
incluída na linha de comando. Não compila código no servidor.

Falha de backup, checksum ou migração impede ativar os novos serviços. O helper
não restaura dados nem inicia containers da aplicação; os serviços anteriores
continuam ativos. Se a tentativa falhar, inspecione o diagnóstico privado e as
migrações já aplicadas antes de tentar novamente. Backups existentes não são
sobrescritos. As migrações devem conservar compatibilidade com a aplicação
anterior; o rollback da ativação troca imagens, sem desfazer DDL automaticamente.

Antes da primeira publicação com esse protocolo, instale o dispatcher revisado
em `/usr/local/sbin/erp-next-deploy`, preservando uma cópia do anterior e esperando
terminar qualquer publicação em andamento. O helper é enviado pelo workflow;
não se instala uma cópia de revisão diferente fora do pacote. Validação local:
`python -B -m unittest discover -s scripts/deploy -p 'test_*.py'`.

Crie um diretório de release separado, copie a configuração privada da versão
ativa e altere somente as imagens dos componentes atualizados e a revisão.
Valide o Compose antes de iniciar. Preserve a versão anterior para rollback.
Após a troca, confira a API, o domínio público, a revisão publicada e os serviços
fiscais. Se a API for recriada, recrie os quatro serviços juntos, como descrito
abaixo, porque compartilham seu namespace de rede.

O workflow manual `production-release.yml` continua disponível como alternativa
para empacotamento completo no runner. Ele não é disparado por push nem por auto
merge. O antigo fluxo `production-migrate.yml` permanece apenas para as operações
manuais de provisionamento já existentes; não é necessário para publicar.

O bootstrap cria uma empresa com cadastro fiscal pendente e associa a identidade
real confirmada de `nicolas@avilaops.com` ao papel de administrador. O banco é
independente do legado e recebe a cópia e projeção dos dados após o bootstrap.
A conexão de runtime usa papel sem superusuário,
sem BYPASSRLS e sem propriedade das tabelas.

O diretório de release recebe somente `compose.yaml`, imagens prontas e arquivos
privados `api.env`, `web.env` e `.env`. `api.env` contém `DATABASE_URL`,
`AUTH_ISSUER=https://auth.avilaops.com`, `NFE_PRODUCTION_ENABLED=false` e
`NFE_PRODUCTION_TENANT_ID` vazio. Se a emissão de produção for liberada para
uma única empresa, as duas variáveis devem ser ativadas juntas e o UUID do
tenant autorizado deve ser informado; não existe liberação global segura.
Nos releases `compose.json` que usam `network_mode: service:api`, uma recriação
da API exige recriar também `web`, `fiscal-engine` e `fiscal-mcp`, para que todos
usem a rede da nova API. Recrie os quatro serviços juntos. Depois confira o
`/api/health` público, a prontidão da API e a resposta do `/mcp`; o estado
`healthy` de um container antigo não confirma o acesso pela rede atual.
O SMTP é administrado em **Preferências → Sistema → E-mail (SMTP)** por
administradores da plataforma e compartilhado pelos pedidos, propostas e pacotes
de documentos. A senha fica cifrada no banco pelo cofre de segredos do servidor,
nunca é retornada na leitura e não deve ser colocada no `web.env` ou versionada.
A configuração salva entra em vigor nos próximos envios sem reiniciar a API.
Desativar essa configuração não reativa um SMTP antigo do ambiente.
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD` e
`SMTP_FROM` permanecem como compatibilidade enquanto não houver configuração
salva. Na primeira gravação pela plataforma, informe a senha novamente.
STARTTLS usa normalmente a porta587; TLS usa normalmente a porta465.
O workflow de migração também aplica `deploy/grant-commercial-contracts.sql`,
concedendo ao papel runtime somente `SELECT`, `INSERT` e `UPDATE` na tabela de
estado do pacote; a API não recebe permissão de exclusão desses registros.
`web.env` contém `ERP_AUTH_CLIENT_ID`, `ERP_AUTH_CLIENT_SECRET`,
`ERP_SESSION_SECRET` e `ERP_DEFAULT_TENANT_ID`. `.env` fixa `ERP_API_IMAGE` e
`ERP_WEB_IMAGE` e `ERP_RELEASE_SHA`. Não versionar esses arquivos preenchidos.

Web e API compartilham o namespace de rede do serviço API; o BFF usa
`http://127.0.0.1:8080`. Isso mantém a exigência existente de HTTPS ou loopback,
sem liberar HTTP para hosts arbitrários. As duas portas são publicadas pelo
serviço API, somente no loopback do servidor.

O cliente OIDC dedicado `erp-next` pertence ao app Auth `erp` e aceita somente
`https://erp.avilaops.com/api/auth/callback` como redirect de login e
`https://erp.avilaops.com/api/auth/logout/central/callback` como post-logout
redirect. Não alterar o segredo do cliente
legado `erp`. O BFF mantém tokens em cookie HttpOnly cifrado e a API consulta
userinfo e valida a associação da empresa. O usuário conclui o login no Auth;
nenhuma senha pessoal é necessária ao deploy.

A saída começa com POST de mesma origem, apaga os cookies locais e cria um
marcador cifrado HttpOnly com validade de dois minutos. A navegação seguinte
consulta o `end_session_endpoint` do discovery do issuer configurado e usa
somente o cliente e o retorno definidos pelo servidor. Os GETs de continuação
e callback exigem a fase correspondente desse marcador; o callback não apaga
uma sessão criada depois da saída. Falha no Auth não comprova logout global.
Os controles de saída usam fetch com redirecionamento manual antes de navegar,
preservando a verificação de origem sob a política `no-referrer`.

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
