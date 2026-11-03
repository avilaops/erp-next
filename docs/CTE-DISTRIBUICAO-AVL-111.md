# Distribuição CT-e — AVL-111

## Estado desta entrega

Adaptador privado implementado no motor Node, em checkout isolado
`/home/avops/projetos/erp-cobertura-fiscal`, branch
`codex/avl-101-104-108-110-111-112-cobertura-fiscal`.
Base: `396826c4196aa09dfecfa8e048636fb4dee08287`.

Esta entrega cobre protocolo, transporte interno e conferência local da
distribuição CT-e. A retomada acrescenta integração Rust, cursor persistente e
worker opcional; a validação dessa etapa está pendente no GitHub Actions.
Central visual, normalização individual, vínculos comerciais e homologação
externa continuam pendentes. Não conclui
AVL-111 nem a meta das seis issues. Nenhum certificado real foi aberto, nenhuma
consulta fiscal externa foi executada e nenhuma capacidade de produção foi
habilitada nesta rodada.

O endpoint do motor é interno e exige seu Bearer. A API Rust acrescenta rotas
autenticadas próprias e permissões CT-e específicas; a interface de navegador
ainda não foi integrada. O cliente Rust admite `distribute-cte`, preservando
os limites existentes das demais operações.

## Integração Rust em validação

As rotas `/api/v1/fiscal/cte-distribution/status`, `/query`, `/documents`,
`/documents/{id}` e `/runs/{id}` exigem tenant e permissões específicas.
Consulta explícita usa `If-Match` e `Idempotency-Key`. As tabelas de estado,
execuções e documentos têm RLS forçada; documentos são imutáveis. O CNPJ
congelado no cursor não pode ser substituído silenciosamente pelo cadastro atual.

A intenção, concessão de execução e pausa conservadora são gravadas antes do
transporte. O retorno confirma documentos e cursor na mesma transação; erro no
segundo documento desfaz o lote. Rejeição, XML inválido, timeout, permissão
revogada ou concessão perdida não autorizam avançar o cursor. Respostas incertas
mantêm pausa de uma hora; as rejeições também usam essa pausa conservadora na API.
Credenciais e corpo arbitrário do provedor não são guardados nos registros.

O worker fica desabilitado sem `ERP_CTE_AUTOMATION_TENANT_ID` e
`ERP_CTE_AUTOMATION_SUBJECT`. Ele recarrega permissões atuais e usa apenas o
cursor CT-e. Os códigos `fiscal.cte.read` e `fiscal.cte.query` não entram nas
concessões automáticas do bootstrap ou cadastro de empresa; sua atribuição é
explícita pelo gerenciamento de acessos. Nenhum ambiente foi configurado nesta
rodada para executar o worker.

Os testes novos cobrem concorrência/replay, atomicidade, RLS, XML de outra
empresa, revogação durante transporte, troca de CNPJ, retomada, pausas e grants.
Compilação e execução Rust desta retomada serão validadas somente no GitHub
Actions, conforme instrução do usuário; não são resultados aprovados ainda.

## Contrato interno

`POST /v1/distribute-cte` recebe:

- `environment: "homologation"`; produção é recusada antes do transporte.
- `issuerTaxId`: CNPJ numérico válido da empresa, incluindo dígitos verificadores.
- `authorState`: UF da empresa interessada; não é a UF de emissão de uma NF-e.
- `lastNsu`: último NSU CT-e, de 1 a 15 dígitos, convertido a 15 posições.
- `certificate`: material A1 aberto somente no servidor, conforme contrato do
  motor (`pkcs12Base64` e `password`). Não registrar corpo da chamada.

O adaptador aceita somente endpoint fixo de homologação e usa o canal mTLS já
existente, sem URL configurável no payload. Exige A1 válido e o CNPJ completo
da empresa, seguindo a política mais restrita do ERP. O serviço oficial aceita
CNPJ base comum; isso não permite ao adaptador atravessar tenants.

Resposta:

- `code`, `reason`, `lastNsu`, `maxNsu`: retorno correlacionado com o ambiente.
- `nextNsu`: candidato a cursor somente em lote coerente `137`/`138`; `null`
  em rejeição. Persistir junto com todos os documentos em uma transação.
- `documents`: NSU, schema declarado, classificação e XML original após gzip.
- `rawXml`: resposta do serviço; persistência deve permanecer isolada por empresa.
- `minimumWaitSeconds`: 3600 em ausência de documentos, fim do feed ou 656;
  60 para outras rejeições, zero enquanto há mais documentos disponíveis.

O mínimo de uma hora no fim do feed vem da NT 2015.002, seção 2.5. Para 656,
uma hora é política local conservadora, não promessa de desbloqueio automático.
O motor não persiste esse intervalo: nenhum worker deve ser ligado sem fazê-lo.
Falhas de transporte, XML ou schema lançam erro e não produzem cursor candidato.

## Conferências e limites

Pedido e retorno da distribuição usam schemas 1.00 oficiais, independentes dos
schemas de emissão CT-e 4.00. O manifesto próprio registra origem, versão,
data e SHA-256 do ZIP e dos quatro XSD locais. Os textos foram normalizados
para UTF-8 sem BOM e LF. A leitura verifica hashes e dependências locais antes
do `xmllint-wasm`, executado sem rede e com memória limitada.

O parser também confere namespace CT-e, versão, ambiente, campos únicos e
sequência crescente de NSUs dentro do intervalo pedido/retorno. Recusa mais de
um retorno SOAP, status sem documentos compatíveis, XML malformado, DTD,
entidades, controles ilegais, base64/gzip inválidos e UTF-8 inválido.

Limites locais explícitos:

- 10 KiB no XML de pedido, conforme o contrato oficial.
- 8 MiB na resposta XML; o canal de transporte aplica seu limite adicional.
- 50 documentos por lote, conforme o contrato oficial.
- 2 MiB por documento descompactado e 8 MiB acumulados por lote.

Schema desconhecido é preservado como `unrecognized`, sem transformação ou
descarte. Schema de `procCTe`/`procEventoCTe` exige a raiz/namespace correspondente.
O adaptador ainda não confere XSD individual, assinatura, protocolo nem o papel
da empresa em cada documento. `full` e `event` classificam o envelope recebido;
não são atestados de autorização, validade jurídica ou conciliação.
Não há emissão de CT-e nem manifestação automática.

## Evidências locais

Os testes usam certificados fictícios, respostas sintéticas e transporte
injetado. Exercitam pedido, SOAP, XSD offline, integridade dos schemas,
preservação do XML, limites de lote/descompressão, ambiente/NSU incompatíveis,
rejeições, A1 vencido/de outra empresa, recusa de produção e autenticação HTTP.

Verificação reproduzível, em `apps/fiscal-engine`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Suíte completa executada no checkout isolado: 61 testes aprovados, 19 deles
específicos de CT-e. Estes testes não comprovam consulta ao autorizador.

Revisão independente encontrou aceitação de referências XML a caracteres
proibidos pelo parser DOM. O caso foi reproduzido antes da correção. O scanner
agora confere caracteres literais e referências conforme XML 1.0, preserva
comentários/CDATA/PI e usa percurso linear. A revisão da correção encerrou o
achado sem identificar regressões concretas.

## Fontes consultadas em 03/11/2026

- [Catálogo CT-e de produção](https://www.cte.fazenda.gov.br/portal/webServices.aspx).
- [Catálogo CT-e de homologação](https://hom.cte.fazenda.gov.br/portal/webServices.aspx).
- [NT 2015.002 v1.05](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LLSQYxGtwv0%3D).
- [Pacote oficial de distribuição](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=l6I2ehbBicE%3D).
- [Implementação original NFePHP, `sefazDistDFe`](https://github.com/nfephp-org/sped-cte/blob/master/src/Tools.php):
  referência complementar para o wrapper SOAP; não comprova homologação do ERP.

O acesso público ao WSDL retornou HTTP 403 sem certificado. Os endereços foram
conferidos nos dois catálogos oficiais; o envelope foi cruzado com o método e
schemas oficiais e a implementação NFePHP. A chamada mTLS externa continua
sem evidência nesta entrega.
