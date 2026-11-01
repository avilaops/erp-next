# Verificação de devoluções e continuidade fiscal — 2026-10-31

Ticket: AVL-396. Branch: `codex/erp-retornos-fiscal-20261031`.
Base: `8c0f7db7eb8c90806e5c16f1718ded329886f01a`.

## Ambiente e alcance

Validação local em PostgreSQL 18 UTF-8 isolado, sem banco de produção. Os testes
SQLx criam bancos próprios e exercitam papéis de aplicação sem superusuário e
sem BYPASSRLS. Certificados, documentos, transporte fiscal e sessões de navegador
usados nos testes são sintéticos. Nenhuma transmissão fiscal real foi realizada.

## Revisão

Revisão independente dos fluxos de backend concluída sem bloqueio remanescente
nos seis achados inspecionados. Regressões cobrem recuperação de eventos após
resposta perdida, normalização de espaços, manifestação incerta por prova
distribuída, duplicidade de autorização, vínculo do protocolo ao XML durável,
edição do vencimento de compra convertida e consulta após rotação do A1.

## Resultados

| Verificação | Resultado |
| --- | --- |
| `cargo test --workspace --locked -- --test-threads=2` | 161 passaram; zero falhas; um ignorado |
| Motor fiscal: `npm test` | 36 passaram; zero falhas |
| Playwright: três suites novas | Nove cenários aprovados |
| `pnpm --filter web build` | Aprovado, incluindo verificação TypeScript |
| `pnpm --filter web lint` | Aprovado |
| `cargo fmt --all --check` | Aprovado |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Aprovado |
| `git diff --check` | Aprovado |
| Inventário OpenAPI exportado | 101 rotas, 138 operações, nenhum `operationId` duplicado |

O teste ignorado exige modelo Ollama local provisionado, é anterior a esta
entrega e não participa dos fluxos comerciais/fiscais. A suíte Rust levou 91,03
segundos após a compilação. O motor valida XML/XSD/assinaturas e o despacho
HTTP/SOAP com transporte sintético; não utiliza certificado real.

No navegador, a primeira rodada aprovou oito cenários e encontrou um seletor
inadequado no teste de pagamento. Após trocar a busca pelo papel acessível
`combobox`, os dois cenários da suite fiscal passaram. A nova tentativa também
confirmou o bloqueio de edição durante uma operação fiscal incerta, a repetição
da mesma chave/revisão/corpo e o uso da revisão fiscal ao transmitir o evento.

O limite do build web na CI foi ajustado de 40 para 120 segundos: a compilação
local e a verificação TypeScript finais consumiram, juntas, 48,2 segundos antes
da geração de páginas. As verificações e o timeout total do job foram mantidos.

Os XSDs oficiais copiados preservam seus bytes, inclusive espaços da
documentação de origem. Atributos Git específicos desses arquivos evitam
normalização de finais de linha e alertas por espaços finais; o manifesto
SHA-256 e os testes de conformidade continuam verificando os schemas.

## Limites da entrega

- Emissão restrita a NF-e 55/SP, homologação e CRT 1 no recorte tributário
  explícito do motor. Produção permanece desabilitada.
- Não houve provisionamento do motor, aplicação de migrations ou publicação.
- Comissão e produção não têm domínios operacionais no ERP Next; o cancelamento
  registra a indisponibilidade e os pedidos de reconciliação na outbox.
- Inutilização incerta conserva a faixa reservada e exige conferência
  operacional. Não há consulta específica de inutilização integrada.
- Testes sintéticos não comprovam autorização ou manifestação perante a SEFAZ.

Contratos, rotas e preparação de implantação estão em
[RETORNOS-E-CONTINUIDADE-FISCAL.md](RETORNOS-E-CONTINUIDADE-FISCAL.md).
