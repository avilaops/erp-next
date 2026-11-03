# NFS-e nacional recebida — inspeção offline (AVL-112)

Parte da meta AVL-101/104/108/110/111/112. A inspeção é a primeira etapa da
importação manual exigida pela AVL-112; não encerra a captura de serviços.

## Contrato

Motor privado recebe XML UTF-8 nacional e CNPJ completo do tomador. Confere
schemas oficiais 1.00/1.01, selecionados exclusivamente pela versão declarada,
com arquivos locais e hashes. Recusa outro namespace, versão não suportada,
DTD/entidades, XML malformado e entrada acima de 1 MiB. Não abre A1 nem faz rede.

Retorna o XML original e seu SHA-256; chave nacional de 50 posições; ambiente
lido da DPS; número, datas e município; emitente, prestador e tomador distintos;
código/descrição de serviço e valores em centavos como strings exatas. CNPJ/CPF
nacionais precisam de dígitos verificadores válidos. Identificação estrangeira
do prestador conserva seu tipo. Tomador sem CNPJ identificável ou diferente da
empresa é recusado. A DPS deve declarar a mesma versão do documento.

Validar leiaute não comprova assinatura, credenciamento nem situação atual.
O retorno explicita `signature=not_verified` e `currentStatus=not_queried`.
Nenhum XML vira HTML ou lançamento comercial. Não reaproveitar chave, parser,
ambiente ou NSU de NF-e. Produção no XML é metadado de arquivo importado;
não habilita emissão ou captura em produção.

## Fonte conferida

[Pacote oficial NFSe-ESQUEMAS_XSD-v1.01-20260209](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip/@@download/file),
obtido em 03/11/2026, SHA-256
`e7935cbd9470527c6cc32984c1b2263e614183bf0139ce2733eaaed2de9a8072`.
O ZIP contém diretórios 1.00 e 1.01. Copiar apenas a dependência fechada de NFSe:
NFSe, tiposComplexos, tiposSimples e XMLDSig por versão. Normalizar LF/UTF-8 e
registrar hashes dos arquivos normalizados e do ZIP original.

## Perfil local explícito da versão 1.01

O pacote oficial 1.01 contém `TSSerieDPS` com pattern `^0{0,4}\d{1,5}$`.
O teste com o XSD original e série `1` reproduz rejeição no xmllint-wasm.
O [anexo I oficial](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx/@@download/file),
SHA-256 `de5bc492959eadc8bfa7540e16939995924f2188f743648eaf84d3b31e9eeb7c`,
define série numérica de 1 a 5 posições. A
[especificação W3C, apêndice F](https://www.w3.org/TR/xmlschema-2/#regexs),
define ancoragem implícita, sem usar os delimitadores externos de outras regexes.

Decisão técnica desta implementação: conservar os arquivos oficiais e seus
hashes, derivando somente em memória `nfse-1.01-dps-series-regex-v1`. Remove
somente `^` e `$` daquele pattern, com match único e hashes antes/depois.
Não corrige outros patterns nem outra versão. O parser também exige série
ASCII de 1 a 5 posições. O retorno distingue `official_schema_valid` (1.00)
de `local_profile_valid` (1.01), incluindo o identificador da correção.
Isso é um perfil local rastreável, não uma errata oficial nem homologação.

SHA-256 do XSD simples 1.01 normalizado original:
`0fd5c960367c459f7f0819000e0848175c82fd8b257d7f92d8385082faa2c52b`.
SHA-256 do perfil derivado:
`8f3bad64e97b490bebd9d4e094ff1eca24f30e6eea67caf3d1124288b2b5bec6`.

## Continuação obrigatória da AVL-112

- Importação manual com isolamento, deduplicação por fonte/ambiente/chave,
  XML imutável, auditoria e permissões explícitas na API Rust.
- Central para XML e eventos; conferência individual antes de vínculos.
- Captura incremental por fonte e identidade, com recuperação e limites.
- Homologação externa por fonte, acesso/permissões/custos e cobertura declarada.
  Município/provedor não elegível não recebe fallback silencioso.

Rust: compilar, testar e executar lint somente no GitHub Actions. Não há
autorização para consultas reais, contratação, merge ou implantação nesta etapa.
