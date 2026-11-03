# IBPT — tabelas versionadas por empresa

AVL-115 permanece incompleta até obter a fonte vigente autorizada, validar amostras
reais e integrar a exportação fiscal. Esta implementação adiciona o carregamento
verificado e uma API de estimativa; não habilita emissão, não altera impostos da
operação e não usa a CDN como fonte automática.

## Estado das fontes

Em 03/11/2026, a pesquisa oficial identificou o comunicado IBPT 26.2.C, vigente de
20/10/2026 a 30/11/2026. As 81 amostras de `nfe/ibpt` consultadas nesta sessão
declararam 26.2.B e não informaram fim de vigência. Não foram importadas como
tabela vigente nem tratadas como autorização de uso.

- [Pesquisa de 27 UFs](https://linear.app/avilaops/document/cep-cnpjie-e-ibpt-matriz-das-27-ufs-03112026-784051155cce).
- [81 exemplos e hashes](https://linear.app/avilaops/document/ibpt-auditoria-de-81-amostras-nas-27-ufs-03112026-c4d07fca4fd6).
- [IBPT oficial](https://deolhonoimposto.ibpt.org.br/Site/PassoPasso).

## Carregamento e integridade

Sem `ERP_IBPT_MANIFEST_FILE`, o catálogo nasce vazio e a API informa
`not_configured`, sem valores de imposto. O arquivo de manifesto é administrado
no servidor, ao lado dos arquivos normalizados e autorizados. Carregamento ocorre
na inicialização; atualização exige a troca explícita do manifesto e reinício do
serviço pelo procedimento de implantação existente.

Cada entrada do manifesto possui `tenantId`, `file` (somente nome local, sem
diretórios) e `sha256` hexadecimal dos bytes exatos do arquivo normalizado. Não
são aceitos symlinks para os arquivos de dados. Limites: manifesto de 64 KiB,
até 81 snapshots, arquivo de 10 MiB e catálogo de 100 MiB. Nenhuma rede é usada.

Cada arquivo normalizado exige:

| Campo | Contrato |
| --- | --- |
| `uf` | Uma das 27 UFs, em maiúsculas |
| `classification` | `ncm`, `nbs` ou `lc116` |
| `version` | Formato IBPT `26.2.C`, preservado da fonte |
| `source`, `key` | Identificação da fonte e chave da tabela |
| `validFrom`, `validTo` | Datas ISO completas; início não pode exceder o fim |
| `licenseReference` | Referência administrativa da autorização de uso; obrigatória |
| `rows` | De 1 a 20.000 linhas normalizadas |

Cada linha possui `code`, `ex`, `national`, `imported`, `state`, `municipal`.
Códigos preservam zeros iniciais: NCM oito, NBS nove e LC116 quatro dígitos.
EX é informado explicitamente, inclusive `0` quando essa for a chave da fonte.
Percentuais são strings com quatro casas decimais e ponto, de `0.0000` a
`100.0000`. Não são aceitos floats, vírgulas, negativos, duplicidade código/EX
ou mesma versão com conteúdo divergente para a mesma empresa/UF/classificação.

A presença de `licenseReference` documenta a declaração do administrador; o
código não decide validade jurídica da licença. É necessário confirmar os termos
e guardar a autorização aplicável. A conversão da tabela original para esse
contrato e a comparação com amostras oficiais ainda precisam ser verificadas com
o arquivo autorizado da empresa. Hash do arquivo normalizado não substitui a
conferência do original entregue pelo fornecedor.

## API informativa

POST `/api/v1/fiscal/ibpt/quote`; BFF `/api/erp/fiscal/ibpt/quote`.
Exige sessão e `fiscal.nfe.read` da empresa. O BFF verifica origem e empresa da
sessão, como as demais consultas POST do fiscal.

Entrada: `uf`, `classification`, `code`, `ex`, `origin` (`national` ou `imported`),
`amount` com duas casas decimais, `asOf` ISO e `version` opcional. Sem versão,
seleciona a mais recente cuja vigência cubra a data da operação, sem cruzar tenant,
UF ou classificação. A resposta conserva versão, origem, chave, vigência e hash
exatos para posterior associação ao documento fiscal.

Estados:

- `available`: parcelas federal, estadual, municipal e total aproximados.
- `not_configured`: nenhum snapshot aplicável à empresa/UF/classificação/versão.
- `outside_validity`: snapshots existentes não cobrem a data consultada.
- `code_not_found`: código/EX não consta no snapshot selecionado.

Os três estados de indisponibilidade não devolvem valores nem substituem o
resultado por zero. Origem da mercadoria e EX são escolhas explícitas, não
deduções do CST ou da descrição. A API não determina NCM, NBS ou LC116 a partir
de texto livre.

Valores e percentuais são convertidos para inteiros. Cada parcela é arredondada
uma vez para centavos, com meio centavo para cima, e o total soma essas parcelas.
Esse arredondamento está coberto por fixtures sintéticas, não por validação de
alíquotas reais. O limite da entrada impede overflow dos inteiros usados.

## Pendências para o aceite integral

1. Obter a tabela vigente autorizada da empresa e confirmar licença/condições.
2. Conferir conversão, integridade do original e percentuais com amostras oficiais.
3. Associar snapshot e estimativa aos itens/documento fiscal; integrar `vTotTrib`
   e indicação de fonte na exportação pertinente e testar o XML/DANFE produzido.
4. Validar o comportamento em ambiente publicado com acesso real autorizado.

Não foi importada tabela real, contratado acesso pago, alterado cálculo fiscal
ou emitida nota nesta entrega. Os testes de cálculo são explicitamente sintéticos.
