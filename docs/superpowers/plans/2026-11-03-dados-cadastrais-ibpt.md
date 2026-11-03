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
- [ ] IBPT: obter fonte vigente autorizada, validar amostras reais e integrar a
  estimativa e sua origem à exportação fiscal pertinente.
- [x] Rodar suíte pertinente, tipos, lint, contrato OpenAPI e arquitetura; revisar
  somente o diff desta frente. Registrar implementação, CI/publicação e exercício
  externo separadamente. Aceites pendentes continuam pendentes.

## Atenção na revisão

Resposta de outro documento/UF, edição enquanto a consulta aguarda, sessão trocada,
cadastro ausente tratado como inválido, tabela IBPT sem fim de vigência, e exposição
de QSA/CPF de sócios não são comportamentos aceitáveis.

## Pendências externas

Fonte IBPT vigente autorizada da empresa ainda não fornecida. CNPJ.ws restringe
comercialização dos dados; habilitação em ambiente multiempresa exige enquadramento
confirmado. Consulta SEFAZ direta depende dos controles da AVL-71 e de homologação.

## Verificação local em 03/11/2026

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
  144 operações; superfície web possui 332 rotas, verificada sem erros.
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
