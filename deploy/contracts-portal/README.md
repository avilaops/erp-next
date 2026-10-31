# Ávila Ops Contratos

Overlay de apresentação e publicação de modelos da instalação própria `contrato.avilaops.com`.
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
