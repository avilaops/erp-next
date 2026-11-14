# Contratos • Plano do serviço privado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar validação privada autenticada com rede restrita, parser isolado e evidências reproduzíveis.

**Architecture:** App Python separado reutiliza o núcleo 0.2.0. Gateway TLS/HMAC com coletor restrito; worker por Unix socket em container sem rede; resposta binária inclui relatório original e evidências.

**Tech Stack:** Python 3.13, aiohttp 3.14.5, pacote núcleo fixado por caminho local, Docker/Linux, unittest e workflows existentes.

**Spec:** `docs/superpowers/specs/2026-11-14-contract-validator-service-design.md`.

## Global Constraints

- Sem acesso a banco, vault fiscal, DocuSeal, chaves dos titulares ou socket Docker.
- 12 consultas/12 s, 3 s por consulta; evidências 32 MiB; certificado/OCSP 256 KiB, CRL 8 MiB.
- Bundle 40 MiB, JSON 32 KiB/profundidade 16, relatório 256 KiB, confiança pública 4 MiB.
- Upload 10 s; pedido após observação 40 s; uma execução ativa, sem fila ilimitada.
- PDF subprocesso CPU 10/12 s e AS 768 MiB; coletor CPU 5/6 s e AS 512 MiB.
- Launcher Linux fail-closed: sem rede no worker, rootfs read-only, usuário sem root, TLS obrigatório no gateway.
- Usar checkout indicado e branch própria; textos usam •; nenhuma ativação ou custo.

## Review Focus

- DNS misto/rebinding, IPv6 de transição e redirects não podem alcançar rede privada.
- Collector lento/DNS bloqueado ou subprocesso malicioso não pode sobreviver ao deadline/cancelamento.
- Bundle incompleto, confiança trocada ou evidência omitida não pode sustentar aceite nem reprodução falsa.
- Request sem autenticação ou concorrente não pode consumir parser/CPU/armazenamento ilimitados.
- Testes sintéticos, segredos ou permissões de teste não podem entrar no launcher/imagem produtivos.

### Task 1: Evidências de rede e bundle reproduzível

**Files:** Create `apps/contract-signature-service/pyproject.toml`, `README.md`, `uv.lock`,
`src/contract_signature_service/{__init__,bundle,egress}.py`,
`tests/{helpers,test_bundle,test_egress}.py`.

**Interfaces:** `FetchTarget(kind, url, body=b'')`, `NetworkPolicy(rules)`,
`fetch_one(target, policy, *, deadline) -> bytes`, chamado somente em processo supervisionado;
`encode_bundle(authenticated, report, evidence, trust, authenticator) -> (bytes, headers)`;
`decode_bundle(body, headers, authenticated, authenticator, *, trust_profile, now) -> BundleResult`.

- [x] Testar destinos proibidos, DNS misto/transição, pin/peer/SNI, redirect/compressão e tamanhos; confirmar RED antes do fetcher. Contagens/budget globais são da orquestração da tarefa 3.
- [x] Implementar rede direta sem proxy, erros estáveis e limites; obter regras de configuração sem confiar no PDF.
- [x] Testar bundle positivo com núcleo real, MACs, evidências ausentes/trocadas, snapshot estranho, cauda e limites; confirmar RED antes do codec.
- [x] Implementar codec e checks de reprodução, sem persistência; rodar corpus completo do serviço e núcleo.
- [x] Commit `feat(contracts): bound evidence retrieval and reproducible bundles`.

### Task 2: Worker e subprocessos isolados

**Files:** Create `src/contract_signature_service/{config,discovery,engine,ipc,sandbox,worker}.py`,
`tests/{test_discovery,test_engine,test_ipc,test_sandbox,test_worker}.py`.

**Interfaces:** `ServiceConfig` imutável com policy/trust/regras; discovery só retorna certificados/targets limitados;
`run_engine(stage, request, observed_at, evidence, config) -> result`;
`run_bounded(command, input, *, timeout, output_limit, profile) -> bytes`;
`WorkerClient.call(stage, frame, observed_at, evidence) -> result`.

- [ ] Testar discovery/OCSP em certificados sintéticos e preservação da identidade, limites e relatório offline; confirmar RED, implementar.
- [ ] Testar protocolo Unix e peer UID, entrada/saída/deadline, limitação Linux, kill de grupo/filhos e falhas; confirmar RED antes de cada fronteira.
- [ ] Implementar supervisor sem parser, subprocessos com env restrito, namespace/rootfs guards e códigos sem PII.
- [ ] Executar corpus completo, registrar skips de Windows e exigir Linux real na tarefa 4.
- [ ] Commit `feat(contracts): isolate private signature validation workers`.

### Task 3: Gateway TLS autenticado

**Files:** Create `src/contract_signature_service/{gateway,__main__}.py`,
`tests/{test_gateway,test_configuration}.py`.

**Interfaces:** `create_app(config, authenticator, worker, *, clock) -> aiohttp.web.Application`;
CLI `gateway` ou `worker`, configuração de arquivos locais somente.

- [ ] Testar TLS obrigatório, autenticação antes de body/parser, upload lento/excessivo, concorrência, targets fixos, falhas de worker/coletor e ausência de logs privados; confirmar RED.
- [ ] Implementar leitura limitada, observação UTC, duas rodadas no budget global e validação final offline, bundle de saída e cleanup de subprocessos.
- [ ] Testar pipeline completo com HTTP/TLS e fixtures, sem afirmar homologação real; rodar corpus.
- [ ] Commit `feat(contracts): serve authenticated private validation over TLS`.

### Task 4: Imagem, Linux CI e entrega

**Files:** Create `deploy/contracts-validator/{Dockerfile,compose.yml,evidence-origins.json,README.md}`,
`scripts/contracts/verify-signature-service.py`, fixtures de harness somente em tests;
modify `scripts/ci/{pr-gate.py,test_pr_gate.py,test_workflows.py}` e `.github/workflows/_validate-project.yml`.

**Interfaces:** Mesma imagem para gateway/worker, runtime privado por digest;
verificador CI constrói e testa containers restritos com fixtures montadas, nunca copiadas à imagem.

- [ ] Testar escopo/workflow e isolamento do container: sem rede/root/rootfs escrita/segredos/fixtures; confirmar RED antes dos arquivos de integração.
- [ ] Implementar Compose restrito sem portas públicas, allowlist com proveniência e CI condicional obrigatório, sem novos workflows pontuais.
- [ ] Rodar testes de CI, lock, build/distribuição, core offline e testes Docker Linux efetivos; corrigir falhas.
- [ ] Uma revisão independente final, correções importantes por RED/GREEN, CI e integração conforme políticas; documentar decisões, pendências e evidências.
- [ ] Commit final e limpeza segura somente dos artefatos próprios, preservando arquivos do usuário.
