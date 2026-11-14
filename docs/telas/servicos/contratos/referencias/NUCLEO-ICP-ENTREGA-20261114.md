# Núcleo de validação ICP — entrega de 14/11/2026

A [PR #210](https://github.com/avilaops/erp-next/pull/210) foi integrada na main
em `fd5b81284897b641acb1b30ad35e18f51e7a29fa`. A árvore integrada é idêntica ao
candidato verificado `96cee6c59586b0d4205c3fc93d1ba09614f48ebc`.

Este documento registra o componente criptográfico. O fluxo ICP completo
continua pendente; nenhum convite, contrato real, chave pessoal, migração,
servidor ou deploy produtivo foi acionado por esta entrega.

## O que foi implementado

- Identidade e-CPF por ASN.1, separada de e-CNPJ e selo técnico.
- Confiança pública fixada por fingerprints; intermediárias não viram raízes.
- Verificação CMS, algoritmos/parâmetros, cadeia e revogação offline estrita.
- Preservação incremental de assinaturas, campos, restrições e dados comerciais.
- Relatórios canônicos vinculados a documento, participante, pai e evidências.
- Verificação do pacote compilado sem rede no CI compartilhado existente.

## Evidência verificada

[CI 43562895307](https://github.com/avilaops/erp-next/actions/runs/43562895307)
concluído com sucesso antes do merge.

| Verificação | Resultado |
| --- | --- |
| Corpus do núcleo, incluindo wheel real com rede negada | 54 testes aprovados em Windows e Linux |
| Políticas e escopo do CI | 35 testes aprovados |
| API Rust | 531 aprovados, zero falhas, um ignorado preexistente |
| Testes adicionais do workspace Rust | 7 aprovados |
| Web, motor fiscal, fiscal MCP, schema e gate | Aprovados |
| Arquitetura | Zero erros |
| Lock e distribuições sdist/wheel | Aprovados; fixtures/chaves sintéticas excluídas |

Navegador, publicação de imagens e verificações completas exclusivas de release
não foram executados por este CI de PR. Nenhum arquivo de interface do ERP
foi alterado por este componente.

## Revisão independente e correções

Um revisor com contexto novo revisou a branch inteira e executou o corpus.
Não identificou achado crítico; os três achados importantes tiveram
reprodução funcional antes da correção:

1. Hash efetivo, RSA-PSS/MGF/defaults e família de chave podiam escapar da
   política. Os casos SHA-1 e a combinação de chave incompatível agora são recusados.
2. Seed values obrigatórios eram ignorados. Restrições suportadas são verificadas
   em assinaturas pessoais e técnicas; restrições não demonstradas são unsupported.
3. Metadados XMP e atributos do stream podiam mudar dados comerciais.
   Esses dados são congelados, preservando somente o bookkeeping técnico permitido.

As regressões falharam antes das correções e a suíte completa voltou a passar.
Não houve segunda rodada de revisão nem correção de itens menores fora do escopo.

## Próximas entregas obrigatórias

Serviço privado autenticado, obtenção restrita de revogação, isolamento real do
parser, política/identidades congeladas no ERP, fila/CAS/leases, sessões e telas
do participante, ponte DocuSeal, pacote final de todos os PDFs e provas,
retenção/restore e integração do runtime. A homologação com certificados
pessoais reais e a versão instalada do DocuSeal continua separada e bloqueia
links produtivos.

## Deferred minors

- Final: minor (deferred): PreflightReport lacks an explicit trust-profile label; ValidationReport already identifies synthetic_not_icp versus icp_brasil. Surface explicitly before exposing service/UI reports.

## Rulings I made

Registro histórico completo das decisões do executor, na ordem registrada.
Cada linha conserva a justificativa e o custo se a decisão estiver errada.
Gates que constam como futuros continuam requisitos da implementação completa;
o CI e a integração deste componente foram comprovados acima.

- Ruling: start independent validator code in branch feat/contract-icp-validator-core-20261113 based on frozen acceptance candidate d30203c while its CI43507182982 runs — user wants sustained source progress, files are disjoint and no reviewer remains active — cost if parent requires more fixes: update/rebase this branch after PR207 integration and rerun affected checks; no push/PR/merge of this component before that gate.
- Ruling: implement offline validator core before public service/ERP integration — approved design requires proving PDF/PKI policy before invitations; missing revocation stays indeterminate — cost if wrong: this component alone does not enable the full required ICP workflow, which remains explicitly pending subsequent increments.
- Ruling: TrustBundle is defined in trust.py with its pinned-registry invariant rather than model.py — keeps trust parsing/anchor enforcement together and avoids circular imports; consumers use trust.TrustBundle — cost if wrong: later consumers need the documented import path, without changing the agreed fields or behavior.
- Ruling: isolate the Windows loopback self-pipe bootstrap from the offline validation guard — block DNS/create_connection throughout and all connect calls during real PKIX coroutine, assert none occurred — cost if wrong: bootstrap-only socket behavior is outside the validation assertion; real runner and cryptographic engine remain exercised.
- Ruling: classify only negative CRL/OCSP signature outcomes using two pinned certvalidator0.33 failure-message markers — its API flattens typed causes into InsufficientRevinfoError, so unrecognized causes remain indeterminate and no acceptance depends on wording — cost if wrong: invalid versus indeterminate may require reclassification after dependency change; locked negative corpus fails that regression.
- Ruling: first supported personal PDF profile is an invisible new signature field; a visible appearance is unsupported — prevents covering frozen contract text without inventing trusted placement slots — cost if wrong: some local signing configurations will require demonstrated additional support before real homologation; no productive link is enabled here.
- Ruling: timestamp presence is explicitly unsupported until separate TSA policy/corpus exists, and report says unsupported rather than absent — do not ignore stronger evidence while claiming acceptance — cost if wrong: legitimate timestamped files remain unavailable in this initial profile; full required implementation must retain this outstanding support/homologation gap.
- Ruling: baseline signatures are technical only; verify their CMS/MDP integrity and retain exact snapshot hashes, while personal trust/CPF checks apply to new/previous participant signatures — actual DocuSeal provenance must be authenticated by the later ERP start workflow — cost if caller omits that integration gate: a self-attested base is not proof of provider identity; do not expose this core directly.
- Ruling: honor existing baseline MDP history with the library policy, then enforce signatures-only changes from the frozen parent revision, plus exact existing-field/permission/metadata fingerprints — legitimate pre-freeze DocuSeal form filling must not become a false future mutation — cost if wrong: legitimate writer bookkeeping beyond ModDate/Producer may be conservatively rejected and must be covered before homologation.
- Ruling: suppress private third-party logger namespaces in the isolated validator core and return stable reason codes — library errors can contain certificate subject/field data — cost if wrong: raw library diagnostics are unavailable; versioned checks/corpus remain available without exposing CPF.
- Ruling: native CI domains/attestation stay unchanged; Python core runs conditionally in mandatory project policy — core-only changes avoid unrelated native builds, full/unknown shared infrastructure validates core — cost if wrong: project policy must remain required; tests pin scope/workflow wiring.
- Ruling: XMP is compared by namespace-aware property structure and frozen stream headers, allowing only xmp:ModifyDate/pdf:Producer/toolkit and formatting; empty technical-only XMP is equivalent to no XMP — PDF2.0 writers introduce technical metadata for valid supported signatures, observed regression under byte freezing — cost if wrong: writers using other bookkeeping properties are conservatively refused until a demonstrated profile is added; actual signed prefix/CMS stays mandatory.
- Ruling: validate supported seed constraints using the pinned library plus explicit flag/filter checks; certificate-path-dependent constraints, mandatory appearance/attestations or unknown flags stay unsupported — no silent ignore of a mandatory constraint — cost if wrong: some valid external signing profiles require additional demonstrated support before real homologation.
- Ruling: initial PSS profile uses the same allowed SHA2 hash for CMS, signature and MGF1, checks key family and encoded restrictions — prevents weaker defaults or independent SHA1 inside signatureAlgorithm — cost if wrong: mixed-hash PSS writers outside this profile are refused and need an explicit policy/corpus extension.
- Final: Ruling: baseline provenance from actual DocuSeal account — remains an authenticated later ERP start-workflow gate, not claimed by byte validation — cost if wrong: a trusted caller could select an unauthenticated base; no public entry point may be enabled without that gate.
- Final: Ruling: baseline technical PKIX/identity/revocation — integrity-only inventory remains distinct from personal acceptance — cost if wrong: consumers mistaking technical inventory for personal trust would misstate assurance; later DTOs/UI must retain the distinction.
- Final: Ruling: caller-supplied document IDs, sequence, inventory and observation time — trusted integration boundary must bind these from server state — cost if wrong: accepting client assertions could misattribute a mathematically valid result.
- Final: Ruling: transactional advancement, leases, replay races and stale workers — remain required in the later stateful ERP workflow — cost if wrong: duplicate or stale results could advance the wrong head without CAS/leases.
- Final: Ruling: tenant/RLS/grants/sessions/delegation/2FA — remain required before public ERP/portal use, no such resources changed here — cost if wrong: a standalone mathematical verdict would not protect access or tenant isolation.
- Final: Ruling: online AIA/CRL/OCSP and SSRF — no network in this component; bounded reviewed adapter remains a separate required gate — cost if wrong: missing live evidence remains indeterminate, not a valid personal flow.
- Final: Ruling: process/time/memory/decompression/public-upload isolation — byte/complexity/XML bounds are additional protection only; actual isolation remains required in the next service — cost if wrong: directly exposing the parser could permit denial of service.
- Final: Ruling: envelope quotas — later workflow must enforce all document/participant/upload/storage limits; per-PDF checks do not substitute — cost if wrong: unbounded aggregate resource use despite bounded individual inputs.
- Final: Ruling: visible signature support — unsupported initial profile stays as approved — cost if wrong: legitimate visible-signing applications need a proven appearance profile before use.
- Final: Ruling: TSA/timestamp/qualified-time/LTV — unsupported or not_established stays explicit — cost if wrong: no claim of qualified time, long-term or future validity is available from this core.
- Final: Ruling: real ICP, installed DocuSeal output and personal signing compatibility — still mandatory real homologation with each holder; synthetic evidence cannot substitute — cost if wrong: passing synthetic tests would not establish that real signing applications preserve the accepted document profile.
- Final: Ruling: final packaging/retention/restore/release image — required later increments remain in full objective — cost if wrong: core acceptance alone would not yield a complete recoverable commercial contract package.
- Final: Ruling: production activation/infrastructure/billing — no activation from this component; source merge is authorized independently — cost if wrong: an incomplete integration could be exposed prematurely.
- Final: Ruling: remote CI and main integration — remain blocking delivery gates; local GREEN is insufficient — cost if wrong: Linux CI or actual integrated source could differ from tested Windows source.
- Final: Ruling: existing ERP routes/DTOs/contracts/fiscal trust/Nicolas document — untouched and outside this isolated change — cost if wrong: accidental changes would need separate regression/recovery; explicit diff scope is checked.
- Final: Ruling: malicious in-process Python/dataclass forgery — caller must not deserialize user claims as trusted reports; arbitrary code inside this trusted process is not a library input boundary — cost if wrong: process compromise bypasses mathematical/policy controls and must be prevented by the later service isolation.
