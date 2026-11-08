# Esquemas oficiais da NF-e usados nos testes

## Atualização local em 08/11/2026

Os cinco arquivos NF-e da raiz foram substituídos integralmente pelos arquivos de
`PL_010g_v1.03/NFe/` do ZIP fornecido pelo usuário em
`C:\Users\nicol\Downloads\PL_010g_v1.03.zip`.
SHA-256 do ZIP: `b329ecbe7e4c05a41bfbc1527f105defb7047328acfeada7c77e1666da485eaf`.
O manifest do motor registra os hashes individuais e a versão `PL_010g v1.03`.
Em 08/11/2026, o pacote também foi baixado diretamente do Portal Nacional da NF-e:
[PL_010g v1.03 oficial](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=EQhOQMgipXY%3D).
O SHA-256 do download oficial é idêntico ao ZIP fornecido pelo usuário, confirmando
a procedência e a igualdade byte a byte. O registro local do download, tamanho e
hash está em `artifacts/fiscal-reference-downloads/downloads.json` (entrada 01).
Os registros PL_010f abaixo descrevem a versão anterior, substituída nesta atualização.

Todos vêm do Portal Nacional da NF-e (`https://www.nfe.fazenda.gov.br/portal`, Documentos →
Esquemas XML). Não são editados: quando a SEFAZ publica pacote novo, troca-se o arquivo inteiro e
anota-se aqui. Conferência de 10/10/2026, por resumo SHA-256 contra os pacotes baixados no dia.

| Arquivos | Pacote | Publicado em | Conferência |
| --- | --- | --- | --- |
| `nfe_v4.00.xsd`, `leiauteNFe_v4.00.xsd`, `tiposBasico_v4.00.xsd`, `DFeTiposBasicos_v1.00.xsd`, `xmldsig-core-schema_v1.01.xsd` | PL_010f v1.04 (NT 2025.002 v1.50 e NT 2026.007 v1.00): o mais recente da NF-e 4.00 | 31/08/2026 | Idênticos ao pacote (SHA-256 do ZIP `b8589490…d4b95998`) |
| `PL_010d_v1.03/Evento/*`, `PL_010d_v1.03/NFe/*` | PL_010d v1.03, CNPJ alfanumérico (NT 2026.004 v1.01): evento genérico, consulta de situação e inutilização | 10/07/2026 | Copiados do pacote (SHA-256 do ZIP `45ceefe4…de081d9b`) |
| `envEventoCancNFe_v1.00.xsd`, `leiauteEventoCancNFe_v1.00.xsd` | Evento Cancelamento (Evento_Canc_PL_v1.01) | atualizado em 21/12/2018 | Idênticos ao pacote |
| `envCCe_v1.00.xsd` | Evento CCe v1.01 | 30/05/2014 | Idêntico ao pacote |
| `leiauteCCe_v1.00.xsd`, `tiposBasico_v1.03.xsd`, `consSitNFe_v4.00.xsd`, `leiauteConsSitNFe_v4.00.xsd`, `inutNFe_v4.00.xsd`, `leiauteInutNFe_v4.00.xsd`, `procNFe_v4.00.xsd` | Pacotes anteriores da NF-e 4.00 e da carta de correção, incluídos em 08/10/2026 | não conferido | Não batem byte a byte com os pacotes de 10/10/2026 (versões anteriores; só aceitam chave e CNPJ numéricos). Seguem em uso para o conteúdo próprio da carta de correção e do cancelamento; o CNPJ alfanumérico é validado pelos de `PL_010d_v1.03/` |

O pacote PL_010d v1.03 não traz `inutNFe_v4.00.xsd` (o arquivo do elemento raiz): o teste usa o
daqui com o `leiauteInutNFe_v4.00.xsd` do pacote.

O que cada teste valida está em `docs/fiscal-conformidade-nfe.md`.
