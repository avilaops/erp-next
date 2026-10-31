# Esquemas oficiais da NF-e usados nos testes

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
