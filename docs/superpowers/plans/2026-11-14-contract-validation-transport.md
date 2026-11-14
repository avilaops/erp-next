# Contratos • Plano do transporte autenticado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular chamadas e respostas do validador ao contexto autorizado sem expor o parser ou reduzir a política ICP.

**Architecture:** Modelos/framing e HMAC puros no pacote existente; configuração e observação UTC do serviço são parâmetros confiáveis. Nenhum HTTP listener ou acesso à rede é acrescentado.

**Tech Stack:** Python 3.13, biblioteca padrão e núcleo criptográfico já fixado.

**Spec:** `docs/superpowers/specs/2026-11-14-contract-validation-transport-design.md`.

## Global Constraints

- Preflight: base até 20 MiB; increment: base 20 MiB, pai/candidato 32 MiB cada.
- Até dez participantes; política e bundle sempre conferidos contra configuração.
- Cabeçalho JSON até 32 KiB; sem campos extras, duplicados, coerções ou cauda.
- HMAC-SHA256, chaves dedicadas 32 a 64 bytes, até duas; idade 60 s, futuro 5 s.
- Textos usam •; CPF, PDFs e chaves não aparecem em repr ou mensagens de erro.
- Serviço HTTP, isolamento, revogação online e workflow completo continuam necessários.
- Trabalhar no checkout indicado pelo usuário, em branch própria, sem outro worktree.

## Review Focus

- Uma credencial válida não autoriza outro documento, tenant ou perfil de confiança.
- Comprimentos falsos e JSON patológico não podem ultrapassar limites antes do parser.
- Duplicatas e representações alternativas não podem criar duas interpretações do frame.
- Respostas trocadas ou MACs de request reutilizados como resposta devem ser recusados.
- Fixtures sintéticas, erros e objetos de diagnóstico não podem vazar CPF/chaves ou afirmar ICP.

### Task 1: Relatório completo de preflight

**Files:**
- Modify: `apps/contract-signature-validator/src/contract_signature_validator/model.py`
- Modify: `apps/contract-signature-validator/src/contract_signature_validator/validation.py`
- Modify: `apps/contract-signature-validator/src/contract_signature_validator/report.py`
- Test: `apps/contract-signature-validator/tests/test_report.py`

**Interfaces:** `PreflightReport(binding, checks, trust_profile, baseline=None)` e
`canonical_preflight_bytes(report: PreflightReport) -> bytes`.

- [x] Acrescentar testes de perfil explícito em sucesso/falha, checks ausentes e inventário sem identificadores privados.
- [x] Executar `uv run --frozen --project apps/contract-signature-validator python -m unittest discover -s apps/contract-signature-validator/tests -p test_report.py`; confirmar RED.
- [x] Implementar validação do modelo e serialização determinística, atualizar retornos reais do preflight.
- [x] Executar corpus completo; confirmar GREEN e registrar evidência.
- [x] Commit `fix(contracts): bind preflight reports to explicit trust profile`.

### Task 2: Framing e autenticação interna

**Files:**
- Create: `apps/contract-signature-validator/src/contract_signature_validator/transport.py`
- Create: `apps/contract-signature-validator/src/contract_signature_validator/transport_auth.py`
- Test: `apps/contract-signature-validator/tests/test_transport.py`
- Test: `apps/contract-signature-validator/tests/test_transport_auth.py`

**Interfaces:** `ValidationRequest` imutável com operação, UUIDs, hashes, PDFs,
titular e anteriores; `encode_request(request) -> bytes`;
`decode_request(frame, *, operation, request_id, policy_sha256, trust_bundle_sha256) -> ValidationRequest`.
`TransportAuthenticator(keys)` produz/verifica cabeçalhos e corpo antes de
chamar decode. Retorna `AuthenticatedRequest(request, observed_at, key_id)`.

- [x] Testar frame das duas operações, bytes exatos, limites, propriedades extras/duplicadas, JSON malformado e troca de IDs/hashes/operação.
- [x] Confirmar RED pelo comando do corpus; implementar framing tipado e limites, sem interpretar PDFs.
- [x] Testar autenticação/rotação, adulteração, headers duplicados, idade e futuro, targets/query e ausência de vazamento; confirmar RED.
- [x] Implementar autenticação com comparação constante e erros estáveis; conferir hash antes do decode.
- [x] Executar corpus completo; confirmar GREEN.
- [x] Commit `feat(contracts): authenticate bounded internal validation frames`.

### Task 3: Resposta correlacionada e distribuição

**Files:**
- Create: `apps/contract-signature-validator/src/contract_signature_validator/transport_response.py`
- Test: `apps/contract-signature-validator/tests/test_transport_response.py`
- Modify: `apps/contract-signature-validator/README.md`
- Modify: `apps/contract-signature-validator/pyproject.toml`
- Modify: `apps/contract-signature-validator/uv.lock`

**Interfaces:** `encode_response(authenticated, report, *, trust_profile) -> bytes`;
`seal_response(body, authenticated, authenticator, *, trust_profile) -> dict[str, str]`;
`verify_response(body, headers, authenticated, authenticator, *, trust_profile, now) -> dict`.
Reutilizar bytes canônicos do núcleo; conferir os bindings completos.

- [x] Testar correlação, assinatura com domínio separado, trust profile, checks/veredito/hashes e timestamp de observação; confirmar RED.
- [x] Implementar resposta limitada e autenticação; não converter erros ou checks ausentes em sucesso.
- [x] Executar corpus completo, construir wheel/sdist em pasta temporária nova e verificar wheel offline pelo script existente.
- [x] Atualizar versão para 0.2.0 pela mudança da assinatura de PreflightReport; atualizar lock sem novas dependências e documentar uso/limites e pendências.
- [x] Commit `feat(contracts): correlate authenticated validator responses`.
- [x] Uma revisão independente da branch e correção importante com RED/GREEN; evidências locais no registro de entrega por tela.
- CI e integração conforme as políticas: acompanhar a [PR 213](https://github.com/avilaops/erp-next/pull/213); o registro remoto é a evidência final desses gates.
