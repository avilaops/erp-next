# DANFE a partir de XML com protocolo

Escopo: geração do PDF de uma NF-e modelo 55 já representada por XML `nfeProc`
4.00 completo. A operação não cria NF-e, não reserva numeração e não transmite
para autorização. A emissão do ERP continua bloqueada pela implementação atual.

## Uso no ERP

Abra **Fiscal → Notas fiscais de saída → DANFE de XML autorizado**, ou
`/fiscal/danfe`. Entre com Ávila Ops, selecione um XML UTF-8 de até 900 KiB e
clique em **Gerar DANFE**. Após a validação, o link baixa o PDF e mostra os
SHA-256 do XML enviado e do PDF recebido. Trocar a empresa/tela cancela a
requisição no navegador; trocar o arquivo descarta o download anterior.

A listagem fiscal anterior continua demonstrativa. A tela de DANFE tem sua
própria sessão e chama a API real. Não usa os documentos simulados da listagem.

## Contrato

`POST /api/v1/fiscal/danfe`, JSON `{ "xml": "..." }`, exige Bearer e
`X-Tenant-Id`. A permissão é `fiscal.nfe.read`. A API confirma associação ativa,
permissão e documento do emitente/destinatário contra a empresa ativa antes de
encaminhar o conteúdo ao serviço fiscal. Após a geração, revalida o acesso e
o vínculo com o cadastro atual antes de devolver o documento.

O XML deve conter uma única NF-e, assinatura e protocolo, namespace oficial,
modelo 55, versão 4.00, chave de 44 dígitos com DV correto e emitente coerente
com a chave. O protocolo deve ter a mesma chave, ambiente e digest da assinatura,
número de 15 dígitos e status 100 ou 150. DTD, entidades externas, envelopes de
resumo/evento e elementos duplicados são recusados. A versão inicial aceita
CNPJ numérico; documentos com identificadores alfanuméricos exigem extensão
explícita desta validação.

Em seguida, o cliente MCP executa, em ordem:

1. `fiscal_validar_xml_fiscal`: XSD oficial e consistência da chave.
2. `fiscal_validar_assinatura_nfe`: integridade e assinatura XMLDSig.
3. `fiscal_gerar_danfe`: PDF somente após as duas validações aceitarem o XML.

O adaptador aceita resultados JSON, SSE e structuredContent, confere IDs das
respostas, mantém/encerra a sessão MCP e não segue redirecionamentos. Não repete
automaticamente uma chamada interrompida. O limite total é 50 segundos, mais
até dois segundos para encerramento da sessão. Cada chamada tem limite de
15 segundos. A resposta do serviço tem limite de 12 MiB; o PDF, de 8 MiB.

O resultado precisa identificar a mesma chave e modelo, conter base64 válido e
marcadores de PDF. A API devolve `application/pdf`, Content-Disposition seguro,
`Cache-Control: no-store`, `X-XML-SHA256`, `X-PDF-SHA256`,
`X-NFe-Environment` e `X-NFe-Authorization-Check: xml-protocol-only`.
O BFF preserva os bytes e os cabeçalhos permitidos. O navegador recalcula ambos
os hashes antes de disponibilizar o download.

| HTTP | Situação |
| --- | --- |
| 200 | PDF validado quanto ao transporte e à identidade declarada do documento |
| 401 | Identidade ausente ou recusada pelo Auth |
| 403 | Sem permissão, associação inativa ou XML de outra empresa |
| 409 no BFF | Empresa do formulário difere da sessão |
| 413 | Limite do corpo excedido |
| 422 | XML, protocolo, XSD ou assinatura recusados |
| 502 | Falha, formato inesperado ou PDF inválido do serviço fiscal |
| 503 | Serviço não configurado ou indisponível |

Erros não devolvem o XML, token, mensagem bruta do serviço ou dados do certificado.
Este endpoint avulso não grava XML/PDF no PostgreSQL ou R2, nem altera os
rascunhos. A rota separada de importação de notas recebidas preserva o XML
original em armazenamento append-only e permite gerar o DANFE desse documento;
ela continua sem persistir o PDF. Consulte
[INTEGRACAO-LOJAS-NOTAS-RECEBIDAS.md](INTEGRACAO-LOJAS-NOTAS-RECEBIDAS.md).

## Configuração no servidor da API

Variáveis somente no backend:

- `DANFE_MCP_URL`: endpoint Streamable HTTP do MCP Ávila Ops que expõe as três
  ferramentas. Exige HTTPS, ou HTTP com IP literal de loopback para testes.
- `DANFE_MCP_TOKEN`: Bearer provisionado para o serviço, injetado como segredo.
  Não colocar no frontend, Git, argumentos de linha de comando ou evidências.
- `DANFE_CA_BUNDLE_FILE`: arquivo PEM público opcional de confiança ICP-Brasil,
  encaminhado ao validador. Sem bundle, a geração não atesta cadeia ICP-Brasil.

Sem configuração, a API continua inicializando e a rota retorna 503 após os
controles de acesso/documento. Configuração parcial impede inicialização.
Credenciais e endpoint precisam ser provisionados e testados no ambiente alvo.
O token não é obtido das credenciais pessoais do aplicativo Codex.

XML de homologação mantém a indicação de ausência de valor fiscal no PDF.
XML de produção já autorizado pode ser apresentado para leitura, sem habilitar
transmissão de produção ou alterar `NFE_PRODUCTION_ENABLED=false`.

## Alcance da validação

Um protocolo contido no XML não é uma consulta online ao autorizador. A rotina
não confirma a situação atual na SEFAZ, cancelamento posterior, revogação do
certificado, enquadramento tributário ou regras de negócio da operação. A
validação de cadeia depende do bundle e do serviço fiscal configurados.
Essas verificações não podem ser inferidas de um PDF renderizado.

## Verificação

Os testes Rust de DANFE cobrem os envelopes, digest, DV, tamanho, XXE, ordem
das validações MCP, erros e isolamento real de permissões/empresa em PostgreSQL.
O Auth e o MCP dos testes HTTP são adaptadores de teste. As respostas positivas
de XSD/assinatura desses adaptadores não são atestados fiscais.

Após `pnpm --filter web build`, `pnpm --filter web test:danfe` executa a tela
e o BFF reais no Chromium usando o build atual,
com sessão sintética e uma API fiscal de teste em loopback. Confere recusa de
acesso/origem/empresa, bytes e hashes do download, preservação do arquivo após
erros e formulário móvel. Esse teste não encadeia a API Rust ao serviço MCP real.
O relatório `--suite danfe` mantém esse alcance separado dos seus 12 checks Rust.

`apps/api/tests/fixtures/nfe-protocol-synthetic.xml` tem assinatura/protocolo
simulados e é recusado pelo validador criptográfico real. O PDF base64 vizinho
foi gerado pela ferramenta fiscal real usando essa fixture, somente para testar
o transporte binário. Não é NF-e autorizada nem documento de cliente.

Referências oficiais:

- [Portal Nacional: validade da assinatura e autorização](https://www.nfe.fazenda.gov.br/portal/consulta.aspx/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=3Ow1nfTBzIo%3D).
- [MCP: transporte Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
