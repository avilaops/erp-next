# Contract signature validator core

Em desenvolvimento. Núcleo isolado de validação, sem função de assinatura, rede, banco ou acesso ao portal. Não habilita o fluxo produtivo nem declara homologação ICP-Brasil individual.

Especificação: [assinatura individual](../../docs/telas/servicos/contratos/referencias/ASSINATURA-ICP-INDIVIDUAL.md). Fixtures criptográficas são sintéticas, explicitamente NÃO ICP, e permanecem fora dos pacotes de distribuição.

O núcleo já contém identidade estrutural, cadeia/revogação offline e verificação incremental do PDF. O perfil inicial admite somente um novo campo de assinatura invisível e mantém campos existentes, controles MDP e conteúdo. Timestamp presente fica `unsupported` até haver política e corpus próprios; ausência nunca é apresentada como tempo qualificado ou LTV. O certificado de conta do portal permanece técnico, inclusive quando contém CPF.

Serviço restrito, obtenção online de revogação, isolamento de execução, ERP/portal, pacote/release e homologação pessoal continuam pendentes. Não expor o núcleo diretamente a uploads antes desses gates.

Executar na raiz do repositório:

```powershell
uv run --frozen --project apps/contract-signature-validator python -m unittest discover -s apps/contract-signature-validator/tests -p 'test_*.py'
```

Para verificar a distribuição efetiva com a rede bloqueada, use uma pasta
temporária nova para cada compilação:

```powershell
uv lock --check --project apps/contract-signature-validator
$validatorDist = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
uv build --project apps/contract-signature-validator --out-dir $validatorDist
uv run --frozen --project apps/contract-signature-validator python scripts/contracts/verify-signature-validator.py --directory $validatorDist
```

O verificador importa o wheel compilado, confere a exclusão das fixtures e
executa o corpus sem DNS, datagramas ou conexões de rede. No Windows, permite
somente a conexão interna criada pela função `socket._fallback_socketpair`
da biblioteca padrão para iniciar o event loop; outras conexões a loopback
também são recusadas. Isso verifica os testes, sem substituir o isolamento
do futuro serviço.

O corpus inclui três titulares distintos em dois documentos, preservação de
todas as revisões, reprodução dos relatórios e rejeição de outro documento,
pai ou participante. Os perfis RSA-PSS SHA-256/384/512 e ECDSA P-256/384/521
são exercitados com CMS e cadeia sintéticos reais. O relatório inclui as
versões instaladas do núcleo, pyHanko e certvalidator.

A política verifica o hash efetivo de `signatureAlgorithm`, sua compatibilidade
com o digest CMS e o tipo de chave. O perfil RSA-PSS exige MGF1 com o mesmo
hash da assinatura; defaults SHA-1 não satisfazem a política. Restrições de seed
values suportadas são conferidas também no selo técnico. Restrições de
certificado que exigem caminho adicional, aparência obrigatória, atestação
legal e flags desconhecidas retornam `unsupported`.

Metadados XMP preservam todas as propriedades comerciais e os atributos
adicionais do stream. Somente `xmp:ModifyDate`, `pdf:Producer` e o identificador
da ferramenta XMP podem mudar; também é permitida a introdução de um pacote
XMP contendo apenas esses dados técnicos por um escritor PDF 2.0. XML fora do
perfil UTF-8 limitado, com entidades ou DTD, não é aceito neste perfil.

No CI, a tarefa reutilizável `_validate-project.yml` verifica este componente
quando seus arquivos mudam, na validação completa ou quando muda infraestrutura
compartilhada. Alterar somente este núcleo não exige reconstruir API, web e
motor fiscal. O contrato de release permanece o mesmo.

## Transporte interno • versão 0.2.0

O pacote também contém framing e autenticação puros para o futuro serviço
privado. Não há listener HTTP, obtenção de evidências nem isolamento Linux
neste incremento. O núcleo permanece sem rede. O protocolo não deve ser
exposto diretamente ao navegador ou a uploads públicos.

`transport.ValidationRequest` contém operação, IDs de request/tenant/envelope/
documento, hashes da configuração e PDFs exatos. Preflight recebe a base até
20 MiB; increment recebe base até 20 MiB e pai/candidato até 32 MiB cada, um
titular e até nove anteriores. O frame `AVILA-CV1\n` tem comprimento JSON uint32
big-endian, cabeçalho ASCII até 32 KiB e partes binárias ordenadas. Não aceita
URLs, caminhos, raízes, evidência, inventário ou horário autodeclarados.

`TransportAuthenticator` recebe uma ou duas chaves dedicadas de 32 a 64 bytes,
com IDs distintos. `headers_for` produz os cabeçalhos de uma chamada; o futuro
HTTP ingress deve chamar `authorize_headers` antes de ler o corpo, impor o
tamanho declarado e um prazo de leitura, e chamar `decode_request` depois de
receber os bytes. A segunda chamada confere novamente autenticação, tamanho e
digest antes de interpretar JSON. Não registrar corpos, cabeçalhos ou repr de
material de chaves. Usar TLS entre os serviços; HMAC não cifra CPF/PDF.

Targets fixos: POST `/internal/v1/preflight` e `/internal/v1/increment`.
Content-Type: `application/vnd.avila.contract-validation+octet-stream;version=1`.
Cabeçalhos obrigatórios: `authorization`, `content-length`, `content-type`,
`x-validation-time`, `x-validation-request-id`, `x-validation-content-sha256`.
O formato de autorização é `HMAC-SHA256 <key-id>:<hex-mac>`. A mensagem ASCII
do MAC concatena, com LF inclusive ao final: `AVILA-CV-AUTH/1`, `POST`, target,
key ID, horário Unix inteiro, request UUID, SHA-256 do frame e tamanho decimal.
Idade máxima de 60 s, tolerância futura de 5 s. Recusa duplicatas, compressão
e transfer-encoding. Retentar uma validação pura não avança estado; replay,
idempotência e CAS continuam responsabilidade do futuro workflow no ERP.

`transport_response.encode_response`, `seal_response` e `verify_response`
exigem explicitamente o perfil de confiança configurado. O resultado conserva
o relatório canônico e acrescenta correlação completa, hash do request e MAC
com domínio `AVILA-CV-RESPONSE/1`. `verify_response` recebe também `now` UTC do
cliente; confere a observação assinada em relação ao envio e ao recebimento,
sem presumir que os relógios têm exatamente o mesmo instante. Respostas
limitadas a 256 KiB; checks ausentes continuam `indeterminate`. Request e
resposta têm profundidade JSON máxima de 16, conferida antes da desserialização.

O preflight agora exige `trust_profile` em seu construtor e informa esse perfil
também nas falhas. `canonical_preflight_bytes` publica somente hashes do
inventário, sem nomes de campos. Essa mudança da interface motivou 0.2.0;
o schema existente `avila-contract-validation/1` permanece inalterado.

Plano e limites completos:
[transporte interno](../../docs/superpowers/specs/2026-11-14-contract-validation-transport-design.md).
