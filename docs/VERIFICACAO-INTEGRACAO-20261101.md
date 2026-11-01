# Verificação da integração fiscal — AVL-396

Base integrada: `origin/main` em `413399e`, após as entregas locais `6ef6571`
e `8c86a07`. A branch continua `codex/erp-retornos-fiscal-20261031`.

## Correções da integração

- Preservados monitor canônico de produção, adoção auditada de A1 legado,
  configurações financeiras, contratos e melhorias de acesso da main.
- Cinco migrations desta branch, ainda não publicadas, renumeradas para
  `202611010001` a `202611010005`. As 29 migrations da main permanecem idênticas
  byte a byte. Total: 34 versões únicas, em ordem de dependência.
- Mantidos os clientes e estados separados: monitor de produção manual e motor
  de homologação, com automação apenas mediante configuração explícita.
- Compra em rascunho agora aceita XML autorizado nos ambientes 1 e 2. O teste
  reproduziu resposta 409 para produção antes da correção e passou depois dela.
  Repetir o comando conserva a compra; conversão não cria movimento de estoque,
  conta a pagar ou manifestação.
- A interface distingue os ambientes. Manifestação de produção usa o monitor;
  as ações e provas de reconciliação de homologação continuam no ambiente 2.
- Coleta de produção aplicada atualiza a lista canônica de notas armazenadas.
- O workflow de release executa também os testes de navegador do monitor.

## Evidência local

| Verificação | Resultado |
| --- | --- |
| `cargo test --workspace --locked -- --test-threads=2` | 210 aprovados, 0 falhas, 1 ignorado opcional |
| `cargo fmt --all --check` | Aprovado |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Aprovado |
| Testes do motor fiscal | 42 aprovados |
| Modelos fiscais da interface | 2 aprovados |
| Testes do gate/consumidor de contratos | 16 aprovados |
| Validação do documento OpenAPI integrado | 125 rotas, 167 operações, sem operationId duplicado |
| `pnpm --filter web lint` | Aprovado |
| `pnpm --filter web build` | Aprovado, incluindo TypeScript |
| Navegador, suíte geral/DANFE | 106 aprovados em 2,9 minutos |
| Navegador, monitor de produção | 3 aprovados, incluindo atualização da lista após coleta |
| Testes do inventário de verificação | 39 aprovados; 3 testes Python de análise aprovados |
| `pnpm verify:erp` | 168 operações API, 144 métodos BFF; 0 erros/avisos, 5 informações |

PostgreSQL 18 isolado, com RLS e papel de runtime restrito nos testes. O cluster
local foi encerrado após a suíte Rust. Certificados, documentos e serviços
externos de teste são sintéticos. Dependências do consumidor de contratos e
comparador oasdiff foram instalados pelo mesmo procedimento do CI, incluindo
conferência do hash fixado do comparador.

O primeiro candidato passou no CI principal, incluindo comparação OpenAPI e
consumidor, mas o workflow separado de inventário recusou as novas operações
ainda sem ficha. O catálogo foi ampliado sem dispensas de cobertura; a emissão
agora é descrita como implementada em homologação, com exclusão de produção.
A análise de `[...resource]` passou a usar destinos explícitos, recusando alvo
ausente, método incompatível ou sem ficha. O inventário inclui também
`GET /openapi.json`, por isso contabiliza uma operação a mais que o OpenAPI.
Catálogo continua sem declarar execução/publicação observada ou P0 concluído.

## Revisão

Uma revisão independente somente leitura apontou a recusa de conversão de
produção e a lista desatualizada após coleta. Ambas foram corrigidas e a revisão
final aprovou a integração sem bloqueios adicionais. Testes e revisão não
comprovam autorização real na SEFAZ ou prontidão fiscal da empresa publicada.

## Limites operacionais

Uma nova inspeção em Applications, por SSH e consulta com papel de runtime,
transação somente leitura e RLS da empresa padrão, confirmou: certificado A1
armazenado, keyring configurado, perfil fiscal ausente e motor de emissão sem
URL/token configurados. O estado difere da inspeção anterior, quando ainda não
havia A1 armazenado. Nenhum material cifrado, chave privada, senha ou dado de
identificação da empresa foi extraído. Armazenamento não comprova validade,
cadeia ou prontidão operacional do certificado.

Nenhuma migration, configuração, emissão, manifestação ou implantação de
produção foi executada nesta verificação. A emissão continua em homologação,
no recorte tributário documentado. O CI de PR valida o candidato; imagens e
migrations de uma implantação posterior devem ser produzidas/executadas pelos
workflows de release e migração do GitHub.
