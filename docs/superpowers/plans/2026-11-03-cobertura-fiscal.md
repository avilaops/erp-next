# Cobertura fiscal — AVL-101, 104, 108, 110, 111 e 112

**Objetivo:** implementar as seis capacidades com os limites e evidências
exigidos nos respectivos tickets. Este plano não reduz a meta à entrega local.

**Arquitetura:** API Rust mantém autorização, tenant, fila, cursores e
persistência. O motor Node adapta os protocolos fiscais. Cada fonte mantém sua
identidade, ambiente, versão e cursor; nenhum coletor reutiliza o NSU de NF-e.

**Base inspecionada:** `396826c4196aa09dfecfa8e048636fb4dee08287`.
As alterações simultâneas de recebimento NF-e foram preservadas no checkout
original. O trabalho desta meta foi transferido para o clone isolado
`/home/avops/projetos/erp-cobertura-fiscal`, na branch
`codex/avl-101-104-108-110-111-112-cobertura-fiscal`.

## Requisitos e sequência

| Ticket | Entrega exigida | Dependência material |
| --- | --- | --- |
| AVL-101 | Matriz oficial e roteamento NF-e por UF do emitente, serviços e ambiente; preservar SP; homologar por autorizador | UFs/empresas reais e habilitação; não inferir pela UF do destinatário |
| AVL-104 | DPS assinada, envio, consulta, XML, eventos e PDF nacional com fila/idempotência | Município, elegibilidade do contribuinte, parâmetros e cadastro de serviço |
| AVL-108 | Adaptadores municipais com envio, consulta, cancelamento e arquivos | Municípios/provedores reais e documentação específica; não presumir ABRASF uniforme |
| AVL-110 | Modelo 65, QR Code, pagamentos, DANFE e recuperação de contingência | UF, credenciamento, CSC no cofre e homologação externa |
| AVL-111 | Captura CT-e incremental, XML/eventos, isolamento, vínculo de frete e homologação por papel | Cofre A1, central e processamento persistente; transporte oficial conferido |
| AVL-112 | Captura NFS-e por fonte, normalização, deduplicação, XML/eventos e importação manual | Fontes acessíveis e permissões reais; cobertura/custo apurados individualmente |

Foi solicitada ao usuário a seleção de UFs, municípios e empresas. A resposta
continua necessária para as escolhas dependentes; tempo decorrido não a substitui.
Não há contratação de fornecedor autorizada.

Restrição de execução confirmada pelo usuário nesta retomada: não compilar Rust
no servidor. Compilação, testes e lint Rust serão executados somente no GitHub
Actions. Os processos locais desta tarefa foram interrompidos; a validação Rust
desta etapa foi aprovada no CI remoto do commit `0b63acf` (execução
`41627372618`), incluindo os oito testes de integração CT-e.

## Primeira etapa: adaptador privado de distribuição CT-e

**Decisão:** implementar pedido, leitura de lote e transporte privado CT-e,
restrito à homologação, sem endpoint público, worker ou liberação operacional.
O adaptador pode ser testado sem selecionar municípios, acessar certificado
real ou consultar a SEFAZ.
É uma parte da AVL-111, não a conclusão dessa issue ou da meta.

Arquivos exclusivos:

- `apps/fiscal-engine/src/lib/fiscal/cte-distribution.ts`: pedido `distNSU`
  v1.00 e parser de retorno com ambiente/NSU correlacionados e limites de recursos.
- `apps/fiscal-engine/tests/cte-distribution.test.ts`: testes com lotes sintéticos,
  incluindo resposta incompatível, NSU repetido/regressivo e XML hostil.
- `apps/fiscal-engine/src/lib/fiscal/cte-distribution-layout.ts` e
  `schemas/cte-distribution/`: conferência offline com schemas oficiais e hashes.
- `apps/fiscal-engine/src/lib/fiscal/cte-distribution-client.ts`: transporte mTLS
  para endpoint fixo de homologação e indicação do intervalo mínimo.
- `apps/fiscal-engine/tests/cte-distribution-client.test.ts`: contrato interno,
  A1 fictício, bloqueio de produção e autenticação HTTP.
- `docs/CTE-DISTRIBUICAO-AVL-111.md`: contrato, fontes e evidências da etapa.

Mudanças nos arquivos existentes do motor: `engine.ts`, `server.ts` e `README.md`.

Checklist de execução:

- [x] Ler os seis tickets, dependências e comentários; conferir arquitetura atual.
- [x] Consultar catálogo oficial CT-e, NT 2015.002 v1.05 e pacote de distribuição.
- [x] Escrever testes de pedido, isolamento de protocolo e limites antes do código.
- [x] Implementar pedido e parser sem reaproveitar parser/NSU de NF-e.
- [x] Implementar transporte A1 privado em homologação e XSD offline.
- [x] Rodar teste específico e suíte completa do motor: 61 aprovados.
- [x] Revisar o diff; corrigir referências XML proibidas encontradas na revisão.
- [x] Registrar resultado e limitações na AVL-111, mantendo a issue em andamento.
- [x] Integrar na API Rust com armazenamento, cursor transacional e worker CT-e.
- [ ] Integrar central e vínculos de frete mediante conferência.
- [ ] Homologar por papel/empresa e registrar evidência externa antes de habilitar.
- [ ] Implementar e homologar as cinco demais capacidades conforme os tickets.

## Critérios de revisão

O parser precisa recusar namespace NF-e, retorno de outro ambiente, mais de um
retorno, XML malformado, DTD/entidades, compactação inválida, descompressão
excessiva, lotes acima de 50 documentos, NSU duplicado/fora do intervalo e avanço
indevido após rejeição. XML descompactado deve ser preservado integralmente.
Conteúdo de outro modelo/versão deve ser conservado e marcado como não
interpretado, sem ser convertido em NF-e ou descartado antes da persistência.

Não existe prova externa de CT-e no Next nesta etapa. O PDF DACTE citado no
comentário histórico da AVL-111 pertence a outro serviço e não comprova coleta.

## Segunda etapa: captura CT-e persistente em homologação

Manter tabelas e permissões CT-e separadas de NF-e, sem conversão automática em
compra, estoque ou financeiro. O cursor é vinculado ao tenant, CNPJ e ambiente;
troca de CNPJ exige tratamento explícito, sem reutilizar NSU de outra empresa.
Os documentos entram com conferência individual pendente.

- [x] Adicionar migração com estado, execuções e XML imutável, RLS forçada e
  permissões `fiscal.cte.read` / `fiscal.cte.query`, sem concessão automática.
- [x] Adicionar rotas de status, consulta explícita, documentos e execução,
  registradas no OpenAPI e protegidas por tenant/permissão.
- [x] Persistir intenção e lease antes do transporte; idempotência por usuário
  e chave. Guardar lote e cursor na mesma transação, sem avanço parcial.
- [x] Preservar cursor em rejeição/timeout; persistir intervalo de uma hora em
  137, 656, esgotamento ou resultado incerto. Lease perdido não pode confirmar.
- [x] Adicionar worker opcional, com tenant/usuário próprios e permissões
  recarregadas a cada ciclo; desabilitado sem configuração explícita.
- [x] Testar isolamento, concorrência/replay, falha de persistência, retomada,
  rejeições e revogação de permissão com PostgreSQL isolado no GitHub Actions.
- [x] Revisar, validar e registrar a etapa sem declarar homologação externa.

Arquivos: `migrations/202611030001_cte_distribution.sql`, domínio
`apps/api/src/domains/fiscal/cte_distribution.rs`, armazenamento/validação
em `cte_distribution_store.rs`, worker em `cte_distribution_worker.rs` e testes
HTTP em `apps/api/src/http/cte_distribution_tests.rs`. Integração mínima em
`fiscal/mod.rs`, cliente privado do motor, `http/mod.rs`, `http/openapi.rs` e
`main.rs`. Reutilizar cofre A1, autorização e auditoria atuais.

## Terceira etapa: central de leitura CT-e

**Objetivo:** consultar arquivos CT-e já armazenados em homologação, com empresa
visível, download do XML original e resultado da captura. Não habilitar comando
de captura na interface antes da homologação externa. Não inferir validade
individual nem criar vínculos de compra, venda ou frete nesta etapa.

**Arquitetura:** página `/fiscal/ctes` usa quatro leituras pelo BFF existente
`forwardFiscal`: status, lista de documentos, documento e execução. Cada chamada
CT-e fixa o tenant lido em `/me`; o BFF compara esse tenant com a sessão atual
antes de transportar credenciais. Download confere ID, NSU, schema, ambiente,
hash retornado e SHA-256 do XML contra a linha selecionada. XML não vira HTML.

**UX:** operador fiscal da empresa ativa consulta arquivos de teste. O cabeçalho
mostra empresa e ambiente; a lista mostra origem e conferência pendente. Ações
são atualizar, baixar XML e consultar captura. Resultado fica em aviso acessível.
Falha remove os dados anteriores e permite nova leitura. Paginação evita baixar
todos os XML. Próximo passo comercial permanece conferência individual, sem
oferecer comando inexistente. `docs/ux.md` citado no ticket não está neste
checkout; usar os padrões atuais da central fiscal e validar cinco tamanhos.

- [x] Escrever testes de BFF autenticado, download íntegro, troca de empresa,
  permissão, erro/vazio, paginação e leitura em cinco viewports.
- [x] Executar os testes antes da implementação e confirmar falha pela rota ausente.
- [x] Adicionar quatro handlers GET em `app/api/erp/fiscal/cte-distribution/`
  e allowlist com validação de UUID, filtros e tenant no proxy fiscal existente.
- [x] Criar `features/fiscal/cte-distribution-screen.tsx`, helpers de leitura em
  `cte-documents.ts` e `app/fiscal/ctes/page.tsx`; adicionar acesso na central fiscal.
- [x] Catalogar os quatro BFFs sem declarar a consulta externa mapeada.
- [ ] Executar testes de navegador, lint e catálogo; build/Rust apenas no CI.
- [x] Solicitar revisão independente, corrigir achados e registrar evidências.

A revisão encerrou dois achados por leitura: status 200 com códigos internos
de falha agora conserva a leitura dos documentos anteriores; qualquer falha de
leitura individual remove as linhas antigas e permite atualizar novamente.
Os testes acrescentam esses estados e a troca real de tenant na sessão.
Navegador e build desta terceira etapa continuam pendentes no novo CI.

## Fontes oficiais consultadas em 03/11/2026

- [Catálogo CT-e](https://www.cte.fazenda.gov.br/portal/webServices.aspx).
- [NT 2015.002 v1.05](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LLSQYxGtwv0%3D).
- [Schemas de distribuição PL_CTeDistDFe_100](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=l6I2ehbBicE%3D).
- [Documentação NFS-e atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual).

O catálogo CT-e publica distribuição 1.00 separadamente dos serviços de emissão
4.00. O pacote de distribuição baixado contém `distDFeInt_v1.00.xsd`,
`retDistDFeInt_v1.00.xsd`, `tiposDistDFe_v1.00.xsd` e XMLDSig.
O WSDL de homologação retornou HTTP 403 sem certificado; seu transporte ainda
não foi comprovado externamente. O endpoint foi conferido também no
[catálogo oficial de homologação](https://hom.cte.fazenda.gov.br/portal/webServices.aspx).
