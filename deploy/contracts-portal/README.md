# Ávila Ops Contratos

Overlay de apresentação, publicação de modelos, cadastro público e MCP da instalação própria `contrato.avilaops.com`.
Base: DocuSeal 3.3.3, fonte `8f8f69f0bc6ac2e59746cd6efac54a852289bec3`.
O motor de assinatura, a autenticação, o e-mail e os dados continuam os da instalação.
Não altera os planos nem libera recursos Pro.

Os arquivos em `overlay` são modificações do software coberto por AGPL-3.0 e
pelos termos adicionais originais. O crédito DocuSeal permanece visível.
A imagem oferece o código-fonte correspondente em `/avila-source.tar.gz`,
incluindo os arquivos originais, as alterações e estas instruções de construção.

O workflow `contracts-portal-release.yml` constrói a imagem no GitHub e fornece
o artefato Docker. Nenhum build acontece nos servidores. O arquivo Compose
existente em `apps-noclient:/opt/contrato-avilaops-com/docuseal` precisa trocar
somente a imagem de `app`; volumes, banco, porta e segredos devem ser preservados.

Reprodução no CI: baixar o fonte no SHA acima, copiar `overlay/` sobre o fonte,
gerar `avila-source.tar.gz` e executar o Dockerfile deste diretório. O digest da
imagem base está fixado. A imagem resultante recebe o SHA da revisão Ávila Ops.

Licenças originais: `LICENSE` e `LICENSE_ADDITIONAL_TERMS` no pacote de fontes.
O restante do ERP não integra este pacote e não é copiado para o portal.

## API própria de publicação

`GET/POST /api/avila/templates/:id` usa a autenticação original `X-Auth-Token`
e a autorização de criação/leitura de modelos. O identificador UUID é criado
e persistido pelo ERP antes da rede. O POST recebe `definitionJson` (string JSON)
e `pdfBase64`; estes parâmetros são filtrados dos logs.

O portal valida formato, limites, participantes e todas as áreas; PDFium confere
o PDF e sua quantidade real de páginas. Cada participante deve possuir uma
assinatura obrigatória. A transação com trava da conta deduplica publicações.
Repetir identificador com conteúdo diferente retorna conflito. O GET retorna
somente a confirmação da conta autenticada; um identificador ausente retorna
`found: false`. A versão publicada não pode ter campos, nome, participantes ou
documentos substituídos pelas telas/APIs normais: edições geram outra versão.

O workflow executa `tests/publication.rb` na imagem construída, com banco
PostgreSQL descartável do GitHub. Nunca executar esse teste no servidor real.

## Cadastro público e MCP

`/sign_up` cria uma conta independente e seu primeiro usuário em uma transação.
O formulário inclui CSRF, confirmação de senha, mínimo de 12 caracteres e limites
de tentativas por IP e globais por processo. Não confirma o e-mail automaticamente.
Cada conta recebe seu certificado próprio e MCP habilitado; nenhum token é criado
sem a ação do usuário em `/settings/mcp`. O marcador interno `avila_public_account`
não pode ser alterado pelas APIs de configurações.

O MCP nativo em `/mcp` usa Streamable HTTP com token Bearer pessoal (SHA-256 no banco),
revogação imediata, checagem de conta/usuário ativos, Origin e limites de requisição.
Não implementa OAuth; clientes que exigem OAuth não são suportados nesta versão.
O guia público em `/integracoes/mcp` contém a configuração e as capacidades reais.

Contas públicas acessam somente seus modelos e contratos. Não administram o host,
armazenamento global, certificados, SMTP, webhooks, API keys ou usuários adicionais.
O upload de arquivos ocorre no editor; download de URLs via MCP não é permitido
para essas contas. O catálogo público inclui `search_templates`, `load_template`,
`create_template` e `search_documents`. `send_documents` não é anunciado nem executado
para contas públicas. Convites e cópias por e-mail permanecem bloqueados para elas;
os links de assinatura podem ser compartilhados pelo usuário. A configuração das
contas já existentes é preservada.

O CI executa `tests/public_access.rb` em PostgreSQL descartável: cadastro real via
HTTP, sessão, senha inválida, duplicidade, CSRF, token, protocolo, duas contas,
configurações globais, revogação e arquivamento. Não criar contas de teste nem
enviar contratos na produção para executar essa suíte.
