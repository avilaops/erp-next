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
