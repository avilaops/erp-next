# CEP, CNPJ/IE e IBPT — AVL-113, AVL-114, AVL-115

**Objetivo:** consultas cadastrais autenticadas no ERP atual e informação IBPT
versionada, preservando dados manuais e os aceites integrais dos três tickets.

**Arquitetura:** Rust autoriza por empresa, consulta fontes fixas, limita tráfego,
normaliza dados mínimos e guarda cache por tenant. O BFF conserva sessão/origem;
os formulários apresentam prévia e aplicam apenas campos vazios após confirmação.
IBPT precisa de arquivo vigente autorizado; a pesquisa não substitui esse acesso.

**Referências:** descrições atuais dos tickets no Linear, matriz de 27 UFs e
auditoria de 81 amostras IBPT publicadas nesta sessão. Base: 396826c.

## Decisões

- Reutilizar Rust/Axum/reqwest e Next.js/React existentes, sem nova dependência.
- POST `/api/v1/registry-lookups`: kind `cep`, `cnpj` ou `ie`, value e context
  `company` ou `party`. Consultar não grava cadastro nem decide regime/contribuinte.
- CEP: ViaCEP e fallback BrasilAPI; CNPJ: BrasilAPI e fallback CNPJ.ws numérico.
  IE: base CNPJ.ws, somente cobertura documentada e habilitação de uso explícita.
- Cache positivo em memória, limitado, por empresa: CEP 24h, CNPJ/IE 6h.
  Erros não entram no cache. Origem, consulta, expiração e data da fonte separados.
- Limites de tráfego por processo/provedor; CNPJ.ws no máximo 3/minuto.
  CNPJ.ws fica desabilitado por padrão até confirmar uso permitido para o ERP.
- Timeout por provedor, corpo limitado, sem redirects ou URLs fornecidas pelo
  usuário. Falha/ausência de cadastro não significa documento inválido.
- CNPJ alfanumérico preservado; CNPJ.ws não recebe letras sem suporte comprovado.
- IBPT: exigir UF/classificação/código/EX/origem/versão/fonte/vigência/hash e
  referência de autorização. Não habilitar dados de CDN sem validação.
- Reutilizar o checkout atual sem mudar a branch ou incluir alterações de outras
  frentes em commits. O gerenciador de worktree recusou o repositório porque o
  chat foi aberto em /home/avops. Alterações de CT-e/recebimento são alheias.

## Tarefas e evidências

- [x] Consultar tickets e fontes oficiais; pesquisar as 27 UFs; registrar no Linear.
- [x] API: testar a rota protegida. O middleware já negava chamadas anônimas à
  rota inexistente; esse teste não constitui evidência de um ciclo vermelho/verde.
- [x] API: implementar contratos, provedores, cache, limites e autorização; testar
  respostas malformadas, divergência de identidade, fallback, timeout, cache,
  isolamento, expiração, concorrência/limite, letras e dados mínimos.
- [x] UI/BFF: adicionar consulta e prévia com confirmação aos formulários de
  empresa, pessoa e endereços. Ignorar resposta após troca do documento/CEP,
  preservar edição durante a consulta e impedir aplicação com sessão divergente.
- [x] UI: testar estado manual, indisponibilidade, confirmação, dados editados,
  resposta atrasada, permissão de leitura e acessibilidade nos cinco tamanhos.
- [x] IBPT: implementar importação versionada e cálculo informativo com integridade,
  vigência/código/UF/EX explícitos. Testes com dados sintéticos.
- [x] IBPT: persistir snapshot por revisão, integrar seleção à interface e exportar
  estimativa/origem no XML sem alterar tributos da operação.
- [ ] IBPT: obter fonte vigente autorizada, validar amostras reais e conferir o
  DANFE no renderizador operacional e em ambiente publicado.
- [x] Rodar suíte pertinente, tipos, lint, contrato OpenAPI e arquitetura; revisar
  somente o diff desta frente. Registrar implementação, CI/publicação e exercício
  externo separadamente. Aceites pendentes continuam pendentes.

## Atenção na revisão

Resposta de outro documento/UF, edição enquanto a consulta aguarda, sessão trocada,
cadastro ausente tratado como inválido, tabela IBPT sem fim de vigência, e exposição
de QSA/CPF de sócios não são comportamentos aceitáveis.

## Continuação — associação e exportação IBPT

1. Corrigir a confirmação da consulta cadastral para `CurrentAccessResponse.tenant.id`.
   A fixture anterior usava `tenantId`, divergindo do contrato real. Registrar o
   teste vermelho e repetir a suíte com fixture tipada pelo OpenAPI gerado.
2. Adicionar seleção opcional `DraftInput.ibpt`: UF e data explícitas, com EX,
   origem nacional/importada e versão opcional por item. NF-e atual usa NCM; a
   API avulsa mantém NBS/LC116 sem inventar suporte a NFS-e.
3. Resolver a estimativa no servidor ao gravar a revisão. Guardar snapshot
   separado no rascunho, com empresa, NCM/EX, origem, base por item (produto +
   IPI declarado), fonte, versão, vigência, hash e parcelas exatas. Sem tabela
   disponível, recusar a solicitação explícita; ausência não equivale a zero.
4. Encaminhar o snapshot persistido ao motor. Antes de reservar numeração, conferir
   a data/validade. Retry de XML já assinado conserva seu documento original.
5. Motor valida correspondência entre seleção, itens, empresa, data e totais;
   exporta `det/imposto/vTotTrib`, `total/ICMSTot/vTotTrib` e fonte em `infCpl`
   conforme os XSD já versionados. Não alterar impostos/pagamentos da operação.
6. Interface permite adesão explícita, seleção por item e leitura do snapshot
   salvo; apresentar indisponibilidade sem preencher alíquotas presumidas.
7. Testar aritmética, isolamento, persistência/revisão e XML contra XSD; verificar
   DANFE sintético quando o renderizador estiver disponível. Arquivo real,
   licença, conversão original e amostras oficiais continuam necessários ao aceite.

## Pendências externas

Fonte IBPT vigente autorizada da empresa ainda não fornecida. CNPJ.ws restringe
comercialização dos dados; habilitação em ambiente multiempresa exige enquadramento
confirmado. Consulta SEFAZ direta depende dos controles da AVL-71 e de homologação.

## Verificação da etapa inicial em 03/11/2026

- PostgreSQL descartável: 233 testes da API e sete do utilitário A1 passaram;
  um teste ignorado e dois testes de alterações alheias foram excluídos após
  falharem na execução completa. Os testes excluídos são
  `existing_purchase_match_previews_differences_then_links_without_receiving`
  (esperava 200, recebeu 404) e
  `distributed_proof_reconciles_unknown_manifestation_and_cancellation_blocks_new_events`
  (esperava 202, recebeu 409). Esses arquivos não fazem parte desta entrega.
- Playwright: 17 testes passaram sobre o build de produção, com sessão/API
  sintéticas. Incluem origem,
  empresa da sessão, prévia e confirmação, preservação, respostas atrasadas,
  prévia vencida, somente leitura e axe nos cinco tamanhos. A troca real do cookie
  sintético da sessão testa a divergência de empresa no BFF. A confirmação de
  sessão atrasada testa nova edição e bloqueio de dispensa durante o preenchimento.
- Exportação OpenAPI e rustfmt dos arquivos alterados passaram. Contrato possui
  144 caminhos; superfície web possui 332 rotas, verificada sem erros.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`, tipos e lint
  dos arquivos web alterados passaram. Build Next.js de produção passou.
- Revisão independente encontrou troca de sessão e dispensa durante confirmação;
  ambas corrigidas e verificadas. Nenhum outro achado importante permaneceu.
- Depois da correção de estilo, 11 testes de consultas e três de IBPT passaram
  novamente. A pesquisa externa é documental; fixtures não validam alíquotas reais.
- A primeira CI detectou a ausência das duas novas fichas no catálogo de ações.
  Foram adicionados os contratos, responsáveis e dependências dos fluxos; os 40
  testes de verificação, geração de contexto e inventário estático passaram.
  O catálogo conserva 35 grupos pendentes e não afirma execução ou publicação.
- Publicação, acesso real às fontes e XML/DANFE com IBPT permanecem sem validação.

## Verificação da continuação

- A fixture de sessão foi corrigida para o contrato real `tenant.id`. O teste
  de preenchimento falhou com a fixture correta antes do ajuste de produção;
  os 17 testes cadastrais passaram após o ajuste.
- Seleção IBPT ausente no contrato de rascunho foi observada como falha antes
  da implementação. Oito testes de domínio e seis testes HTTP cobrem contrato,
  cálculo, snapshot, persistência/replay, revisão, remoção e isolamento.
- Motor fiscal: 53 testes passaram, incluindo 11 IBPT, XML assinado nos XSD
  versionados, limites exatos, soma e origem/UF explicitamente declaradas.
- Interface: 11 testes IBPT passaram, incluindo axe e ausência de overflow em
  320×568, 390×844, 768×1024, 1280×900 e 1920×1080. Tipos e lint passaram.
- Revisão independente não confirmou achados importantes. A primeira etapa
  cobria persistência, domínio e exportação separadamente; a ligação HTTP entre
  rascunho e preparação foi verificada na etapa abaixo.
- MCP retornou erro interno para geração DANFE, análise e validação XML do
  artefato sintético. Não há evidência de PDF renderizado nem de uso real.
- Rodada integrada local: 244 testes da API e sete do utilitário A1 passaram,
  com um ignorado e os mesmos dois testes alheios acima excluídos. A primeira
  tentativa esgotou o disco; após liberar caches desta tarefa, a repetição passou.
- Build de produção e 28 testes de navegador passaram juntos: 17 cadastrais e
  11 IBPT. Os 53 testes do motor passaram novamente. Lint web dos arquivos
  alterados e rustfmt dos arquivos Rust desta entrega passaram; a formatação
  global ainda encontra alterações alheias nos dois arquivos de testes acima.
- Os 40 testes de contratos/contexto passaram novamente; a geração conserva
  42 fluxos, 198 ações e 35 grupos pendentes. A superfície web conserva 332 rotas
  e o inventário não encontrou erros. A CI do novo commit ainda precisa ser
  conferida separadamente das evidências da etapa inicial.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` passou na
  rodada integrada, sem avisos.

## Ligação HTTP do snapshot à emissão

- Três testes novos percorrem o handler de emissão com PostgreSQL e motor double
  em loopback. Conferem seleção/snapshot exatos, valores esperados e fonte, replay
  sem novo preparo, data anterior recusada sem documento/sequência/comando ou
  auditoria de solicitação e retomada da data de uma reserva antiga.
- Depois da preparação e de um transporte incerto, a consulta conserva os bytes
  do XML assinado mesmo com o snapshot persistido definido como SQL `NULL`, sem
  nova preparação ou numeração. O catálogo em memória não é removido e não há
  reinício da aplicação nesse teste.
- Os três testes passaram localmente. A revisão independente não encontrou
  defeito relevante. O motor double não gera IBPT no XML: validade XSD,
  assinatura e exportação permanecem evidências da suíte real do motor.
- Prova de regressão: a retirada temporária da integração do handler fez os
  três testes falharem por snapshot ausente e aceitação indevida da data anterior.
  A implementação foi restaurada byte a byte ao commit `cb835dc`; os 13 testes
  de emissão passaram, incluindo os três novos. Não há mudança de produção
  nessa etapa.
- Clippy de todo o workspace com avisos como erros e rustfmt dos dois arquivos
  de testes alterados passaram após a restauração.

## Reconciliação com cadastros e perfis tributários

Durante a verificação de `6597529`, `main` avançou para `fe1e18e` (PR #71).
Os conflitos impediam a criação das execuções de CI do PR. A integração foi
resolvida em worktree isolado, preservando o checkout compartilhado e as duas
frentes: módulos/rotas/OpenAPI, seletor de perfis tributários, consultas de CEP,
seleção e snapshot IBPT, tipos de contato e contratos de ações.

A migração de cadastros de `main` usa `202611030001`; a migração IBPT ainda não
publicada foi renumerada para `202611030004_ibpt_draft_snapshots.sql`. A suíte
completa aplica ambas em PostgreSQL descartável: 250 testes da API e sete A1
passaram, sem filtros e com um ignorado. Clippy e rustfmt de todo o workspace
passaram. A revisão independente dos oito conflitos não encontrou defeito
relevante e confirmou a preservação semântica dos dois catálogos.

O inventário reconciliado tem 337 rotas web, 200 operações API, 176 BFF,
43 fluxos e 35 grupos pendentes. Esses totais substituem os da etapa anterior;
não comprovam publicação ou execução com dados reais.

O build de produção reconciliado e a checagem de tipos passaram. As regressões
de navegador passaram em duas rodadas: 28 testes cadastrais/IBPT e sete de
perfis tributários, complementos cadastrais e modelos. Os três testes Node do
modelo tributário e os 40 testes completos de contratos/contexto passaram.
O lint web completo terminou sem erros, com nove avisos em arquivos sem
alterações nesta integração. Não há aviso nos arquivos reconciliados.
