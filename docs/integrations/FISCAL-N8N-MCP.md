# Integração fiscal HTTP, n8n e MCP — AVL-116

## Contrato e limites

A API Rust é a autoridade para permissões, empresa, revisão, idempotência,
certificado e estado fiscal. Use o `/openapi.json` da **API Rust**, ou
`artifacts/contracts/candidate.json` exportado pelo CI do mesmo commit.
O BFF `/api/erp` pertence à sessão do navegador; não é a entrada das automações.
Não conectar n8n ou MCP diretamente ao motor fiscal.

Esta entrega acompanha o recorte existente: NF-e modelo 55, SP, homologação,
tributação explicitamente configurada. Não ativa produção nem cria configuração
fiscal. `202` significa processamento pendente; somente o estado fiscal
`authorized`, com protocolo/XML conferidos pelo ERP, indica autorização.

| Operação | Método e caminho na API Rust | Permissões ERP |
| --- | --- | --- |
| Bloqueios/configuração | `GET /api/v1/fiscal/readiness` | `fiscal.nfe.read` |
| Rascunho e revisão | `GET /api/v1/fiscal/nfe/{id}` | `fiscal.nfe.read` |
| Criar rascunho | `POST /api/v1/fiscal/nfe` | `fiscal.nfe.read`, `fiscal.nfe.manage` |
| Emitir | `POST /api/v1/fiscal/nfe/{id}/issue` | `fiscal.nfe.read`, `fiscal.nfe.issue` |
| Estado persistido | `GET /api/v1/fiscal/nfe/{id}/emission` | `fiscal.nfe.read` |
| Reconciliar na SEFAZ | `POST /api/v1/fiscal/nfe/{id}/consult` | `fiscal.nfe.read`, `fiscal.nfe.issue` |
| XML preservado | `GET /api/v1/fiscal/nfe/{id}/xml` | `fiscal.nfe.read` |
| Gerar PDF/DANFE | `POST /api/v1/fiscal/danfe` com `{"xml":"…"}` | `fiscal.nfe.read` |

Todas essas operações usam `Authorization: Bearer …` e `X-Tenant-Id: UUID`.
O XML pode estar somente assinado, ainda sem autorização. O gerador de DANFE
exige `nfeProc` autorizado completo; poderá recusar um XML obtido antes disso.
Gerar PDF não consulta a situação atual na SEFAZ.

## Credencial com menor privilégio

Use uma identidade reconhecida pelo Auth Ávila, associada apenas à empresa
necessária. Para leitura, atribua apenas `fiscal.nfe.read`; acrescente
`fiscal.nfe.issue` somente ao executor autorizado a emitir/reconciliar.
Criar rascunho exige `fiscal.nfe.manage`. Não reutilize um administrador.

As chaves `erp_…` atuais usam outro middleware e atendem às rotas
`/api/v1/notas-recebidas` das Lojas. **Elas não autenticam os comandos fiscais
acima.** A ampliação de escopos de serviço pertence à AVL-81; não contornar
isso concedendo permissões amplas ou encaminhando cookies do navegador.

No n8n, selecione uma credencial OAuth2 existente do Auth com autorização para
esta identidade. Configure refresh conforme o cliente OAuth aprovado. O JSON
importável não contém tokens nem referências inventadas de credenciais.
No MCP/CLI, o operador injeta o access token pelo ambiente do processo.
Não coloque token, XML, certificado A1 ou senha em argumentos, commits ou logs.

### Conectar pelo OAuth do Auth Ávila

`OAuth2 API` é o tipo de credencial genérica do n8n; o provedor desta integração
é o Auth Ávila. A [descoberta OIDC](https://auth.avilaops.com/.well-known/openid-configuration)
anuncia Authorization Code, refresh token, PKCE e autenticação do cliente por
Basic no cabeçalho ou por corpo. Não é necessário copiar access tokens manualmente.

| Campo no n8n | Configuração |
| --- | --- |
| Nome sugerido | `ERP Next — Homologação` |
| Tipo | `OAuth2 API` |
| Grant Type | `Authorization Code` (PKCE também é suportado por ambos) |
| Authorization URL | `https://auth.avilaops.com/oauth/authorize` |
| Access Token URL | `https://auth.avilaops.com/oauth/token` |
| Authentication | `Header` (`client_secret_basic`) |
| Scope inicial | `openid profile email` |
| Client ID e Client Secret | Cliente dedicado cadastrado no Auth; segredo salvo somente na credencial n8n |

Em [Integrações do Auth](https://auth.avilaops.com/admin/integracoes), cadastre
um cliente dedicado vinculado à aplicação ERP. Registre exatamente a **OAuth
Redirect URL** exibida pela credencial n8n; não reutilize o callback do frontend
ERP e não use wildcard. O cliente da integração e a identidade que autoriza são
coisas diferentes: as permissões fiscais continuam nos papéis dessa identidade
no ERP. `fiscal.nfe.read` e `fiscal.nfe.issue` não são scopes OAuth anunciados
pelo Auth e não devem ser colocados no campo Scope do n8n.

Após salvar o cliente e a credencial, use **Connect my account** no n8n e faça
login no Auth com a identidade de homologação. Associe essa mesma credencial aos
nós `Issue` e `Status`. Não copiar cookies de sessão nem transformar a senha da
conta em token. O login administrativo para cadastrar o cliente e o login da
identidade fiscal são etapas distintas.

O Auth fornece refresh token no fluxo normal e revalida a conta ao renovar.
Na implementação do Auth, `offline_access` conserva essa autorização após sair
da sessão; adicione-o somente quando a operação exigir esse comportamento.
O fluxo inicial usa os mesmos scopes básicos do login atual do ERP. O provider
não anuncia o grant `client_credentials`; não selecioná-lo para essa conexão.

## Exemplos executáveis

Requer Node.js 24 e `corepack pnpm install --frozen-lockfile --ignore-scripts`.
Injete `ERP_FISCAL_API_URL` (origem HTTPS da API), `ERP_FISCAL_TENANT_ID` e
`ERP_FISCAL_TOKEN` pelo gerenciador de segredos. HTTP é aceito somente em
loopback para os testes locais. URLs com usuário/senha, query ou caminho são
recusadas. Nenhum redirect é seguido.

Os comandos abaixo pressupõem `NFE_ID`, `NFE_REVISION`, `CREATE_KEY`, `ISSUE_KEY`
e `CONSULT_KEY` já definidos pelo chamador. As chaves são UUIDs distintos por
operação lógica e devem ser persistidas junto à operação, antes da primeira
tentativa. Não gerar outra chave ao receber novamente o mesmo evento.

```bash
node scripts/fiscal/example.mjs --help
node scripts/fiscal/example.mjs readiness
node scripts/fiscal/example.mjs draft --id "$NFE_ID"
node scripts/fiscal/example.mjs status --id "$NFE_ID"
node scripts/fiscal/example.mjs wait --id "$NFE_ID"
node scripts/fiscal/example.mjs xml --id "$NFE_ID" --output nota.xml
node scripts/fiscal/example.mjs pdf --id "$NFE_ID" --output danfe.pdf
```

`wait` faz até seis GETs, separados por dez segundos, e retorna
`complete: false` se o estado continuar incerto. Não consulta a SEFAZ nem
retransmite. `rejected` e `cancelled` encerram o acompanhamento, sem indicar
sucesso de emissão. Saídas XML/PDF são criadas com modo `0600` e sem sobrescrever
arquivos existentes. PDF é retornado em base64 quando não há `--output`.

Para executar uma escrita autorizada, habilite explicitamente
`ERP_FISCAL_ALLOW_WRITES=true` no ambiente e passe `--confirm`:

```bash
node scripts/fiscal/example.mjs create --input rascunho-aprovado.json \
  --key "$CREATE_KEY" --confirm
node scripts/fiscal/example.mjs issue --id "$NFE_ID" \
  --revision "$NFE_REVISION" --key "$ISSUE_KEY" --confirm
node scripts/fiscal/example.mjs consult --id "$NFE_ID" \
  --revision "$NFE_REVISION" --key "$CONSULT_KEY" --confirm
```

`rascunho-aprovado.json` deve seguir o `DraftInput` do OpenAPI do mesmo commit.
O exemplo não inventa cliente, regime, série, numeração nem tributação. Obtenha a
revisão do rascunho para emitir; para reconciliar, obtenha a revisão atual do
snapshot de emissão. A API recebe `If-Match: "N"` e `Idempotency-Key: UUID`.

Em repetição do mesmo comando, preserve **documento, identidade, chave e
revisão originais**. A API pode responder com o resultado persistido. Se o
resultado da transmissão for incerto, consulte o estado e faça reconciliação
explícita. Alterar a revisão em uma repetição muda o comando e pode gerar 409.
O cliente não faz retry automático de POSTs nem de GETs com erro.

## Workflow n8n

Importe [n8n-fiscal-homologation.json](n8n-fiscal-homologation.json) como workflow
inativo. Ele é um subworkflow chamado por outro fluxo e processa um documento
por execução; não instala agendamento nem webhook público.

1. Configure variáveis n8n `ERP_FISCAL_API_URL`, `ERP_FISCAL_TENANT_ID` e
   `ERP_FISCAL_ALLOW_WRITES` (`true` somente após autorização operacional).
2. Selecione a credencial OAuth2 nos dois nós HTTP `Issue` e `Status`.
3. Envie `{id, revision, idempotencyKey, confirm: true}`. Persista esse comando
   no produtor; uma entrega duplicada deve fornecer exatamente os mesmos valores.
4. O POST emite uma vez, com revisão e idempotência. A sequência usa apenas GET
   para acompanhar estado, até seis tentativas com espera de dez segundos.
5. Leia `authorized`, `complete` e `needsAttention` na saída. Rejeição, erro HTTP
   e esgotamento de tentativas exigem tratamento pelo chamador. Falha de
   transporte interrompe o fluxo; não significa rejeição nem autoriza reemitir.

O host e o tenant vêm das variáveis do operador, nunca do evento recebido.
Os nós HTTP recusam redirects e não fazem retry automático. A execução não
salva payloads de sucesso, erro ou execuções manuais na configuração exportada.
O workflow contém apenas HTTP Request e nós nativos, sem node da NFE.io.
Os parâmetros seguem a [documentação oficial do HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/).

A definição executável está em `scripts/fiscal/n8n-workflow.mjs`; ela imprime
o JSON exportável. Os testes verificam que o artefato importável corresponde
à definição e executam a lógica dos nós Code e expressões HTTP. Validação de
schema pelo conector n8n não substitui executar o workflow com a credencial real.

`Config` lê somente as variáveis do operador e descarta campos do evento. O nó
`Validate` verifica esse contexto separado e o comando original. Nos ensaios,
apenas `Input`, `Config` e os dois nós HTTP recebem dados fixados; validação,
esperas, condições, classificação e limite de tentativas executam no runtime.

Para gerar o mesmo grafo no SDK e os dados sintéticos de teste:

```bash
node scripts/fiscal/n8n-sdk.mjs
node scripts/fiscal/n8n-fixtures.mjs pending_then_authorized
```

Os cenários disponíveis são `authorized`, `pending_then_authorized`, `rejected`,
`forbidden` e `exhausted`. Os fixtures não contêm credencial nem documento real.
O SDK e o JSON são derivados da mesma definição; não manter um segundo fluxo
manual divergente. O validador SDK verifica nós, expressões e conexões.
O gerador passa também `workflow.settings`, incluindo a política de retenção,
ao factory SDK. Essa importação foi conferida criando e relendo um rascunho
temporário sem executar comandos; o rascunho de verificação foi arquivado.

## Ferramentas MCP

Execute `node scripts/fiscal/mcp.mjs` no cliente que aceita transporte stdio.
O servidor usa o SDK MCP fixado no lockfile; stdout contém somente protocolo.
Não configura servidor remoto nem registra ferramentas no MCP central.

```json
{
  "mcpServers": {
    "erp-fiscal": {
      "command": "node",
      "args": ["/caminho/absoluto/erp-next/scripts/fiscal/mcp.mjs"]
    }
  }
}
```

As variáveis `ERP_FISCAL_*` devem chegar ao processo pelo mecanismo privado do
cliente. A configuração acima omite valores de segredos intencionalmente.

As ferramentas padrão são `fiscal_readiness`, `fiscal_nfe_draft`,
`fiscal_nfe_status`, `fiscal_nfe_xml` e `fiscal_nfe_pdf`. Com escrita habilitada,
aparecem `fiscal_nfe_issue` e `fiscal_nfe_consult_sefaz`. Ambas exigem
`{id, revision, idempotencyKey, confirm: true}`. O tenant e a credencial não são
argumentos de ferramenta. Schemas recusam campos extras e IDs inválidos.
Anotações distinguem leitura e escrita; a autorização continua na API Rust.
O padrão segue a [especificação de ferramentas MCP](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Erros e recuperação

| Resposta | Tratamento |
| --- | --- |
| 401 | Revalidar/renovar a credencial; não alterar comando fiscal |
| 403 | Conferir associação à empresa e permissão mínima |
| 404 | Conferir documento e tenant; não procurar em outras empresas |
| 409 | Conferir estado, lease ou reutilização incompatível de chave |
| 412 | Recarregar revisão; uma nova intenção exige decisão e comando próprios |
| 422 | Corrigir entrada conforme OpenAPI e validação fiscal |
| 428 | Fornecer revisão e/ou UUID de idempotência obrigatórios |
| 429 | Respeitar limitação; não criar outra chave para contorná-la |
| 502/503 | Conferir serviço, certificado e configuração; reconciliar resultado incerto |
| `transport_uncertain` / `request_timeout` | Consultar estado antes de qualquer retransmissão |

CLI/MCP expõem apenas código estável, status e `requestId` nos erros. O corpo
arbitrário do provedor não é repassado. Respostas têm limite de tamanho e tempo.
O workflow não copia corpos de erro para sua saída normalizada.

## Webhooks e duplicidade de eventos

**A base desta entrega não possui endpoint público para assinatura de webhooks
fiscais.** Há outbox transacional e um webhook de contratos comerciais, que não
deve ser reutilizado para fiscal. A AVL-85 define o catálogo, envelope, assinatura,
entrega e reprocessamento. A AVL-81 define a ampliação dos contratos de API.
Não documentar como disponível uma inscrição de webhook que ainda não existe.

Até essas dependências estarem integradas, use o acompanhamento GET acima.
Uma notificação repetida no produtor que chama o subworkflow deve manter o mesmo
UUID e revisão do comando: isso usa a deduplicação persistente da API, sem criar
uma memória local por execução no n8n.

Depois da AVL-85, o consumidor de webhook deverá verificar assinatura sobre os
bytes originais, ambiente e tenant antes de aceitar o evento. Persistir a chave
única `(tenant, ambiente, eventId)` e o efeito na mesma transação, ou usar uma
inbox/outbox durável. Confirmar recebimento somente após o commit. Duplicatas
devem retornar sucesso sem repetir efeitos; falhas precisam permitir nova
entrega. Não usar `staticData`, Set em memória ou cache com expiração como prova
de processamento. Esses são requisitos de integração pendentes, não um receptor
implementado por esta PR.

## Evidências e homologação pendente

```bash
corepack pnpm test:fiscal-integrations
node scripts/fiscal/check-contract.mjs artifacts/contracts/candidate.json
```

A suíte cobre cliente HTTP contra servidor local de contrato, idempotência do
pedido, revisão, redirects, limites, XML/PDF, MCP pelo SDK em memória e stdio,
schemas, comportamento dos nós n8n e falhas. Dados e respostas fiscais dos testes
são fixtures; não são documentos autorizados pela SEFAZ.

O verificador do contrato consome o OpenAPI exportado no mesmo CI. Confere oito
operações, Bearer obrigatório em todas as alternativas de segurança, idempotência,
revisão, respostas JSON de sucesso, os campos do snapshot na emissão, reconciliação
e GET de acompanhamento, e os tipos XML/PDF. Não prova execução nem corrige silenciosamente
metadados ausentes. Na base validada, `X-Tenant-Id` ainda não está declarado em
`consult`, `emission` e `xml`; o cliente continua enviando esse cabeçalho e a API
continua exigindo contexto de empresa. Essas três lacunas são reportadas para
reconciliação com a AVL-81, sem inventar uma garantia no OpenAPI.

Em 2026-11-03, foi criado o [rascunho n8n da AVL-116](https://n8n.avilaops.com/workflow/7ctDbZcILIz71b9v),
no projeto pessoal Nicolas Avila, na raiz, sem pasta. Ele permanece inativo e
sem credenciais. Cinco cenários foram executados e suas saídas verificadas no
runtime n8n com os transportes HTTP simulados:

| Cenário | Execução | Resultado observado |
| --- | --- | --- |
| Pendente e depois autorizado | `173821` | Uma consulta, autorizado |
| Autorizado imediatamente | `173823` | Nenhuma consulta adicional |
| HTTP 403 | `173824` | Sem autorização; requer intervenção |
| Rejeitado | `173825` | Terminal, sem autorização; requer intervenção |
| Pendente até o limite | `173830` | Seis consultas; incompleto; requer intervenção |

A retenção foi habilitada temporariamente apenas para conferir saídas sintéticas
e restaurada para não salvar execuções manuais ou payloads de sucesso/erro.
Os dados fixados substituíram configuração e HTTP; esses ensaios não testam
credencial, autorização da API Rust, assinatura de webhook ou SEFAZ.

Antes do aceite integral da AVL-116, registrar separadamente:

- Integração dos contratos finais AVL-81/AVL-85 e teste real de assinatura,
  duplicidade e indisponibilidade do consumidor de webhook.
- Execução do workflow com credencial real de menor privilégio: leitura
  permitida e emissão negada sem `fiscal.nfe.issue`; tenant diferente negado.
- Emissão autorizada em homologação com A1/configuração aprovados, repetição do
  mesmo comando sem duplicação, reconciliação e download de XML/DANFE reais.
- CI do commit, revisão/merge e publicação, quando autorizados. Nenhuma dessas
  etapas é comprovada apenas por testes locais.
