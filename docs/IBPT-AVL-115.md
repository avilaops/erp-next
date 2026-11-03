# IBPT — tabelas versionadas por empresa

AVL-115 permanece incompleta até obter a fonte vigente autorizada, validar amostras
reais e conferir o DANFE/uso publicado. A implementação inclui carregamento
verificado, API de estimativa, snapshot por revisão do rascunho e exportação dos
valores informativos no XML. A adesão é explícita; impostos e pagamentos da
operação continuam com suas regras existentes. Não há carga automática de CDN.

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
exatos. A consulta avulsa não grava nem emite documento fiscal.

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

## Associação ao rascunho e exportação XML

`DraftInput.ibpt` é opcional. Rascunhos manuais existentes continuam sem
estimativa. A adesão recebe `uf`, `asOf` (data ISO) e uma escolha por item:
`ex`, `origin` (`national` ou `imported`) e `version` opcional. A UF é escolhida
explicitamente; a origem IBPT não é inferida do CST ou da origem fiscal da
mercadoria. Versão omitida seleciona a mais recente válida para a data.

No recorte NF-e atual, o código é o NCM já declarado no item. NBS/LC116 continuam
na API avulsa; não foi implementada emissão de NFS-e. A base soma o total bruto
do item e seu IPI declarado, arredondado por item. Frete e descontos não fazem
parte do recorte atual da preparação.

O servidor resolve a tabela da empresa ao criar/atualizar o rascunho. A migração
`202611030001_ibpt_draft_snapshots.sql` adiciona JSONB separado e anulável para
`ibptSnapshot`: empresa, UF/data, vínculo de item/NCM/EX/origem/base, metadados
da fonte e parcelas exatas. O cliente recebe esse snapshot, mas não pode enviá-lo
ou fornecer valores calculados na requisição. A revisão e a auditoria existentes
continuam protegendo a gravação. Remoção explícita grava SQL `NULL`.

Tabela ausente/vencida, versão ou NCM/EX ausentes recusam a solicitação com 409 e
`code: ibpt_not_available`, sem gravar parte do rascunho, comando ou efeito fiscal.
A interface conserva os campos editáveis para corrigir/remover a solicitação.
Outros conflitos mantêm as regras de recuperação existentes. Replay de criação
devolve o resultado original antes de consultar a configuração/catálogo atual.

Antes de reservar numeração, a API confere o snapshot e a data de emissão em
`-03:00`. A data IBPT deve coincidir com a emissão e estar dentro da vigência.
O motor repete os vínculos e a aritmética dos valores recebidos. Alterar o catálogo
não recalcula silenciosamente a revisão salva; atualizar o rascunho produz uma
nova estimativa. Retry com XML já assinado reutiliza seus bytes originais.

A exportação inclui `det/imposto/vTotTrib`, `total/ICMSTot/vTotTrib` e a fonte,
versão, UF e chave em `infCpl`, junto das parcelas federal/estadual/municipal.
Valores permanecem strings exatas em centavos. Limites numéricos do XSD e de
5.000 caracteres de informações adicionais são verificados; proveniência não é
truncada. Sem adesão, os campos IBPT não são acrescentados ao XML.

A interface distingue a estimativa da revisão salva de alterações ainda não
gravadas e mostra base, parcelas, total, versão, vigência e hash. Os testes usam
dados sintéticos identificados como tais, incluindo XML assinado contra os XSD
versionados. Não comprovam percentuais reais nem autorização SEFAZ.

Os testes HTTP de emissão conferem que o snapshot da revisão salva chega à
preparação, o replay não repete a preparação e uma estimativa do dia anterior é
recusada antes de reservar numeração. Também cobrem a retomada de uma reserva
antiga com sua data original e a consulta do mesmo XML assinado quando o snapshot
persistido deixa de estar disponível. O motor usado nesse limite HTTP é um double
em loopback; não comprova geração de `vTotTrib`, validade XSD ou assinatura. Essas
verificações são executadas separadamente na suíte do motor real. O teste de
retomada não remove o catálogo em memória nem simula reinício da aplicação.

## Implantação e limite da conferência externa

A migração aditiva deve preceder a nova API. API/web precisam compreender os
novos campos antes de habilitar adesão; uma API antiga que rejeita campos
desconhecidos não é um rollback transparente após gravar rascunhos com `ibpt`.
Nenhuma migração ou implantação de produção foi executada nesta tarefa.

O teste de renderização de um XML sintético pelo MCP Ávila Ops retornou erro
interno. As ferramentas de análise e validação XML do mesmo conector também
retornaram erro interno. Portanto, o PDF/DANFE efetivamente renderizado permanece
sem comprovação, apesar dos testes locais do XML e do motor.

## Pendências para o aceite integral

1. Obter a tabela vigente autorizada da empresa e confirmar licença/condições.
2. Conferir conversão, integridade do original e percentuais com amostras oficiais.
3. Conferir o DANFE no renderizador operacional e os valores/fontes com dados
   autorizados; os testes locais de XML usam alíquotas sintéticas.
4. Validar o comportamento em ambiente publicado com acesso real autorizado.

Não foi importada tabela real, contratado acesso pago, alterado cálculo fiscal
ou emitida nota nesta entrega. Os testes de cálculo são explicitamente sintéticos.
