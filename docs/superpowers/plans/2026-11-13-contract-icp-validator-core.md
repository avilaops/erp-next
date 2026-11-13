# Contract ICP validator core implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans task by task. Implement natively in the existing checkout; one fresh whole-branch review at the end. Steps use checkbox syntax.

**Goal:** Implementar o núcleo criptográfico isolado que aceita ou recusa uma assinatura pessoal incremental sobre documentos congelados, com evidências reproduzíveis e sem rede/chaves pessoais.

**Architecture:** Biblioteca Python pequena, entradas tipadas, confiança explícita e relatórios por hash. Usar pyHanko para CMS/PDF/cadeia e acrescentar a política restrita de identidade e alterações. Este é o primeiro componente do fluxo completo: serviço interno/revogação online, ERP, portal, pacote e release continuam em incrementos subsequentes; nenhum fluxo produtivo fica habilitado por esta biblioteca.

**Tech Stack:** Python >=3.13, pyHanko 0.38.1 e pyhanko-certvalidator 0.33.0 verificados no índice/ambiente real; uv lock com hashes; unittest e fixtures criptográficas sintéticas. Sem serviço pago, banco ou chamadas externas nos testes.

**Spec:** `docs/telas/servicos/contratos/referencias/ASSINATURA-ICP-INDIVIDUAL.md`, derivada do desenho/checklist de 13/11/2026 em `artifacts/contract-ludus-20261113/`. Requisito do usuário: e-CPF individual de cada participante, preservar contratos antigos.

## Global constraints

- Somente `C:/Users/nicol/source/erp-next-main`; sem outro checkout/worktree. Preservar os quatro caminhos não rastreados de outras atividades. Branch própria inicialmente baseada no candidato congelado `d30203c` de encomendas; antes de abrir/integrar esta entrega, aguardar PR207 e atualizar a base pela main integrada.
- Nenhum certificado pessoal real, chave/PFX/PIN, assinatura comercial, convite, servidor, recurso pago ou publicação. Chaves sintéticas existem somente nas fixtures de testes e são marcadas NÃO ICP.
- O núcleo não tem função de assinar nem busca de rede. Evidências explícitas insuficientes mantêm `indeterminate`; não trocar a falta do adapter online por soft-fail.
- Não alterar contratos, arquivos DocuSeal, trust fiscal, migrações, DTOs ERP ou o contrato técnico Nicolas neste componente. Raízes públicas podem ser auditadas como referência, sem copiar chaves nem aceitar confiança recebida no PDF.
- Vereditos `accepted`, `invalid`, `indeterminate`, `unsupported`; não usar exceção/falta de prova como sucesso. Relatório não declara ITI, timestamp qualificado, LTV nem validade futura.
- Não expor esta biblioteca diretamente a uploads até o serviço posterior implementar isolamento de execução, memória/tempo/egress e o restante dos gates. Limites de bytes e complexidade aqui são defesa adicional, não substituem isolamento.
- Entrada por campos tipados, não URLs/paths arbitrários. CPF interno com repr oculto; saída só identidade mascarada, sem PDF, chave ou CPF completo. Hashes SHA-256 hex minúsculo, UUIDs tipados e horário UTC com timezone.

## Review focus

1. Mesmo número de assinaturas com certificado/CPF ou campo trocado: conteúdo e identidade anteriores precisam permanecer vinculados, não apenas a contagem.
2. Prefixo intacto com append que muda preço, página, appearance ou campo comercial: integridade CMS isolada não permite aceitar a alteração.
3. CRL/OCSP disponível porém velha, não assinada, emitida por outro responder ou sem cobertura do instante observado: não transformar presença de bytes em prova de revogação.
4. Selo técnico ou certificado e-CNPJ com CPF do responsável igual ao esperado: nunca contar como a assinatura pessoal exigida.
5. Relatório reproduzido com política, bundle, documento ou pai diferentes: rejeitar o vínculo antes de parser/avanço e preservar a distinção entre prova histórica e atualidade.

## Files and shared interfaces

Criar `apps/contract-signature-validator/pyproject.toml`, `uv.lock`, `README.md`, `src/contract_signature_validator/{__init__,model,identity,trust,evidence,pdf_policy,validation,report}.py`, `src/contract_signature_validator/trust_registry.json` e `tests/{fixtures,test_identity,test_trust,test_evidence,test_pdf_policy,test_validation,test_report}.py`. Cada módulo tem uma responsabilidade; assinatura de fixtures vive apenas em `tests/fixtures.py`.

Interfaces públicas definidas em `model.py`:

- `Verdict(str, Enum)`: os quatro resultados acima. `CheckResult(name: str, verdict: Verdict, reason: str, evidence_hashes: tuple[str, ...])`.
- `ValidationBinding(document_id: UUID, participant_id: UUID, parent_sha256: str, candidate_sha256: str, policy_sha256: str, trust_bundle_sha256: str, checked_at: datetime)` congelado e validado. `PreflightBinding(document_id: UUID, base_sha256: str, policy_sha256: str, trust_bundle_sha256: str, checked_at: datetime)` vincula a abertura aos mesmos hashes/configuração.
- `ExpectedSigner(participant_id: UUID, expected_cpf: str)` congelado, CPF com `repr=False`; nome/e-mail não participam da igualdade criptográfica.
- `ValidationPolicy`: limites base20MiB/candidato32MiB; hashes SHA-256/384/512, RSA PKCS#1/PSS >=2048 bits e ECDSA P-256/P-384/P-521 como conjunto inicial suportado; modalidade pessoal obrigatória e versão serializável canônica. Outros algoritmos são unsupported. `sha256` é derivado dos campos, nunca aceito de um booleano do cliente.
- `TrustBundle`: raízes, intermediárias, proveniência e hash dos bytes/manifesto; perfil de teste explícito permitido somente pela chamada de teste. `EvidenceSet`: DERs de certificados, CRLs e OCSPs com hashes e instante observado, sem rede.
- `BaselineInventory`: assinaturas técnicas previamente congeladas e identificadas por campo/hash de CMS/certificado; participantes anteriores permanecem separados como `tuple[ExpectedSigner, ...]`.
- `CertificateIdentity`: modalidade `e_cpf`/`e_cnpj`/`technical`/`unknown`, CPF interno oculto no repr e identidade mascarada para relatório; classificação malformada/ambígua gera reason de recusa. `PreflightReport`: binding, veredito/checks e baseline inventariado; inventário só fica utilizável após todos os checks obrigatórios. O relatório sempre identifica o perfil de confiança (`icp_brasil` ou `synthetic_not_icp`), sem promover um teste a homologação.
- `ValidationReport`: binding, veredito, checks, versões reais do engine, hashes das evidências, `timestamp_status` e `long_term_validation`. Não incluir CPF completo nem bytes privados. Serialização JSON canônica retorna bytes e SHA-256 reproduzíveis.

Funções de consumo: `preflight(base: bytes, binding: PreflightBinding, policy: ValidationPolicy, trust: TrustBundle, evidence: EvidenceSet) -> PreflightReport`; `validate_increment(parent: bytes, candidate: bytes, binding: ValidationBinding, signer: ExpectedSigner, previous_signers: tuple[ExpectedSigner, ...], baseline: BaselineInventory, policy: ValidationPolicy, trust: TrustBundle, evidence: EvidenceSet) -> ValidationReport`. Preflight inventaria e verifica o selo técnico, não o promove a e-CPF nem permite que certificado pessoal desconhecido vire âncora.

## Task 1 — Contratos tipados, identidade e confiança explícita

**Files:** package/lock, `model.py`, `identity.py`, `trust.py`, `report.py`, testes correspondentes e fixtures mínimas.

- [x] Escrever testes para binding UTC/hash/UUID inválidos, relatório sem CPF completo, hash canônico estável e troca de política/bundle. Expected RED: import/contratos ausentes; não instalar stub que retorne sucesso.
- [x] Executar `uv run --project apps/contract-signature-validator python -m unittest discover -s apps/contract-signature-validator/tests -p 'test_*.py'`; observar RED funcional e guardar saída.
- [x] Implementar tipos congelados, serialização canônica e `extract_personal_identity(cert_der: bytes) -> CertificateIdentity`: SAN ASN.1 do titular, CPF válido de onze dígitos e política de assinatura pessoal compatível. Exigir política ICP do arco A1/A2/A3/A4 (`2.16.76.1.2.{1,2,3,4}.n`), recusar arcos de selo/aplicação/carimbo e certificado e-CNPJ mesmo com CPF coincidente. Recusar ambiguidade/malformação; nome/email não alteram a decisão. Testar CPF com zero inicial, CPF do responsável PJ igual ao esperado e SAN com aparência PF em certificado de selo/aplicação. Arco desconhecido é unsupported; não deduzir modalidade apenas de um número presente no certificado.
- [x] Implementar leitura de bundle público revisado por hash/proveniência, mantendo raízes e intermediárias separadas. Ancorar o perfil produtivo em registro de fingerprints DER versionado no pacote, auditado a partir dos arquivos públicos `deploy/fiscal/icp-brasil-roots.{json,pem}` e suas fontes ITI; não confiar apenas no campo purpose de um manifesto fornecido pelo chamador. Âncora desconhecida ou test-only no perfil de produção deve falhar; teste explícito sempre produz perfil synthetic_not_icp. Nenhum download ou trust do sistema; não editar o bundle fiscal existente.
- [x] Executar a seleção completa, esperar GREEN e registrar comandos/versões. Commit explícito dos arquivos deste componente.

## Task 2 — Evidências de cadeia e revogação offline

**Files:** `evidence.py`, integração em `trust.py`, testes PKI sintéticos. Consome tipos/hash da Task1; produz contexto estrito e checks com DERs vinculados.

- [ ] Escrever testes com raiz/intermediária/leaf de teste e CRL/OCSP assinados: cadeia correta, raiz estranha, intermediária ausente, vencido/futuro, revogado, resposta assinada por outro emissor, unknown, evidência velha/ausente e instante sem timezone. Observar RED antes da lógica.
- [ ] Implementar `validation_context(trust, evidence, checked_at)` e `verify_certificate(cert_der: bytes, trust: TrustBundle, evidence: EvidenceSet, checked_at: datetime) -> tuple[CheckResult, ...]`: `allow_fetching=False`; `CertRevTrustPolicy(RevocationCheckingPolicy(CRL_OR_OCSP_REQUIRED, CRL_OR_OCSP_REQUIRED))` real da versão fixada. Exercitar a validação real da cadeia/uso, não só a construção do contexto. Verificar freshness/assinaturas/cobertura; ausência de dado necessário é indeterminate, revogação/assinatura inválida é invalid. Não considerar raiz enviada no PDF como confiável.
- [ ] Guardar evidência aceita por hash e tipos; reexecutar offline no mesmo instante e obter mesmo significado. Outro instante/política não herda validade antiga. Ausência de timestamp mantém `long_term_validation=not_established`.
- [ ] Executar suíte completa, esperar GREEN sem requisições DNS/HTTP, commit.

## Task 3 — PDF incremental e política restrita

**Files:** `pdf_policy.py`, `validation.py`, testes/corpus gerados em `tests/fixtures.py`. Consome Tasks1–2; produz `preflight` e `validate_increment` públicos.

- [ ] Gerar PDF sintético com conteúdo/preço fixos e selo técnico de teste; acrescentar assinaturas pessoais por fixture local. Escrever testes: pai hash errado, prefixo alterado, nenhuma/duas assinaturas novas, CPF errado, e-CNPJ/selo, CMS/certificado anterior trocado, ByteRange/cauda inválidos, criptografia e restrições DocMDP/FieldMDP. Observar RED.
- [ ] Acrescentar corpus em que o prefixo permanece mas append altera preço/campo comercial/page tree/content/resources/aparência, ou elimina uma assinatura anterior. Não limitar testes à comparação de bytes/prefixo.
- [ ] Implementar preflight estrito e análise de revisões com pyHanko, nunca skip_diff. Usar somente regras de alteração de assinatura, sem GenericFieldModificationRule; não ignorar objetos órfãos/liberados. Honrar Lock/SV/MDP. Comparar todos os campos comerciais e inventário anteriores, além de verificar todos os CMS. Formato não comprovadamente suportado resulta em unsupported, sem reparo/flatten.
- [ ] A nova assinatura deve cobrir o candidato completo e corresponder ao participante esperado. Verificar assinaturas pessoais anteriores com sua confiança/identidade e distinguir o selo técnico preservado. Nenhum certificado técnico vira âncora pessoal por conveniência. Timestamp presente exige sua própria política/cadeia/prova; sem suporte comprovado, retornar unsupported, sem ignorar a evidência e declarar sucesso.
- [ ] Executar positivos e negativos completos. Esperar somente alterações de assinatura autorizadas GREEN; rejeições conservadoras têm reason estável. Medir limites base/candidato e complexidade; isolamento de parser permanece gate obrigatório do serviço posterior. Commit.

## Task 4 — Jornada de corpus, reprodutibilidade e entrega do componente

**Files:** testes integrados, README e integração mínima de verificação Python no workflow reutilizável apropriado, somente após inspecionar escopo atual.

- [ ] Escrever jornada de três pessoas sintéticas/dois PDFs; cada etapa conserva assinaturas anteriores e todos os documentos, relatório por hash e mesma evidência offline. Candidato de documento/pai/participante diferente é recusado antes de aceitação. Observar falha antes de qualquer composição faltante.
- [ ] Executar a suíte completa com rede bloqueada; `uv lock --check` e execução com `--frozen`. Confirmar fixture/test trust fora do pacote produtivo; nenhum segredo ou chave real no Git.
- [ ] Integrar verificação ao CI reutilizável sem criar workflow pontual por execução ou rodar tarefas desnecessárias em todo push. Não alterar protocolo de release/infra neste componente nem publicar imagem/serviço inutilizado; serviço e quinto digest pertencem ao incremento seguinte.
- [ ] Atualizar guia por tela com distinção núcleo implementado / fluxo ainda pendente, source-only e homologação real. Revisar branch com reviewer fresco, corrigir Critical/Important por uma rodada TDD, exigir CI, integrar conforme autorização vigente. Não declarar a exigência ICP inteira concluída.

## Self-review and execution

Este plano cobre somente o primeiro componente da especificação completa. Não omite silenciosamente o restante: serviço/egress/isolamento, política e congelamento no ERP, workflow/fila, ponte do portal, BFF/telas, pacote/release e homologação pessoal continuam necessários. Não habilitar novas emissões ICP por ter este núcleo.

Os cinco Review Focus têm casos nas Tasks1–4. Modelo/report são definidos antes dos consumidores; nenhuma função de assinatura existe fora das fixtures. Dependências foram verificadas em ambiente isolado de pesquisa, mas a prova funcional e o lock definitivo pertencem à execução.

A autorização continuada do usuário é concluir a implementação nativamente e integrar código com checks, sem aguardar servidores. Para aproveitar o CI remoto da PR207, a implementação independente do núcleo começa em branch própria sobre seu candidato congelado. Não publicar nem integrar esta branch antes do aceite do pai e atualização da base; o ledger registra essa decisão e seu custo de eventual rebase.
