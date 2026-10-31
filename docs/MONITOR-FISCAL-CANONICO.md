# Monitor fiscal canônico — AVL-320

O ERP é o consumidor da distribuição de NF-e para a empresa. O painel
`/fiscal/monitor` consulta o estado persistido e solicita no máximo um lote por
ação. A importação manual e a coleta reutilizam `fiscal_received_nfes`; o painel
Lojas e o Monitor de Notas continuam consumindo a API do ERP.

## Configuração

1. Aplicar as migrations pelo processo de implantação do ERP.
2. Configurar o cofre A1 existente e cadastrar certificado vigente da empresa.
3. Conferir CNPJ e UF no cadastro da empresa.
4. Atribuir as permissões `fiscal.monitor.read`, `fiscal.monitor.manage` e,
   separadamente, `fiscal.monitor.manifest` aos papéis autorizados. A migration
   não concede novas permissões de transmissão a papéis existentes.
5. Habilitar `SEFAZ_MONITOR_ENABLED=true` na API somente no ambiente autorizado.

A variável é `false` por padrão. O serviço usa os endpoints oficiais de produção
do Ambiente Nacional, sem URLs configuráveis pelo navegador. O certificado e
a chave privada permanecem no processo da API; a identidade mTLS contém a folha
e as intermediárias do caminho validado pelo cofre, sem a raiz. A configuração
`NFE_PRODUCTION_ENABLED=false` continua bloqueando emissão de NF-e.

Nenhum certificado real ou chamada real à SEFAZ foi utilizado na implementação.
A ativação exige confirmar que nenhum outro sistema está avançando o mesmo
cursor para o CNPJ. O bloqueio local do ERP não controla coletores externos.

## Contratos

| Operação | Permissão adicional à leitura | Comportamento |
| --- | --- | --- |
| `GET /api/v1/fiscal/monitor` | Nenhuma | Estado, disponibilidade A1, último resultado e documentos; `offset` e `limit` de 1 a 100 |
| `POST /api/v1/fiscal/monitor/sync` | `fiscal.monitor.manage` | Exige `Idempotency-Key` UUID; recebe o cursor exclusivamente do banco; retorna 202 com `pending`, `applied` ou `failed` |
| `GET /api/v1/fiscal/monitor/documents/{id}/xml` | Nenhuma | XML original da distribuição, inclusive resumo/evento; `X-XML-SHA256`, `no-store` e `nosniff` |
| `POST /api/v1/fiscal/monitor/documents/{id}/manifest` | `fiscal.monitor.manifest` | Exige chave UUID e `eventType`; justificativa somente para operação não realizada |

Todas as rotas exigem identidade Auth, `X-Tenant-Id`, associação ativa e RLS.
O BFF obtém o token e a empresa da sessão, valida origem nas escritas e recusa
downloads/escritas se a empresa exibida diferir da sessão atual.

## Cursor e documentos

- `fiscal_monitor_state` possui uma linha por empresa e conserva o CNPJ de origem.
  Mudança de CNPJ não reinicia o cursor silenciosamente.
- A reserva de uma hora e a intenção auditada são gravadas antes da rede, sob
  bloqueio da empresa. Uma segunda requisição recebe 429. Repetição da mesma
  chave lê o resultado registrado e não consulta novamente.
- Em sucesso, documentos, NF-e canônicas, eventos de auditoria/outbox e avanço
  do cursor pertencem à mesma transação. Falha de persistência desfaz o lote,
  mantendo a reserva anterior à chamada.
- `137`, `656`, fim da distribuição e falhas conservam intervalo de uma hora.
  Se ainda houver documentos após `138`, a próxima consulta é liberada após
  dois segundos. Não existe repetição ou coleta agendada automática.
- Timeout, resposta inválida, queda do processo e perda de autorização não
  reiniciam nem avançam o cursor. A reserva permite recuperação conservadora.
- São preservados NSU, schema, XML UTF-8 original, SHA-256 e lote de origem.
  Base64/gzip, quantidade, tamanho descompactado e coerência dos NSUs têm limites.
- Resumos e eventos ficam separados da tabela canônica de recebidas. NF-e
  completas destinadas à empresa entram nessa tabela, sem duplicar chave ou
  substituir XML existente. Um conteúdo diferente para a mesma chave interrompe
  o lote para conferência, preservando ambos os registros anteriores.
- NF-e completas distribuídas por vínculo de transportador/autXML são conservadas
  como `other`, sem importação como recebida, manifestação ou bloqueio do cursor.
  Emitentes CNPJ e CPF são aceitos; CPF usa preenchimento à esquerda na chave.
- `/api/v1/notas-recebidas` mantém o contrato de integração existente e agora
  retorna em `pendencias` os resumos sem NF-e completa canônica correspondente.

Importação e coleta não lançam compra, recebimento, estoque ou título financeiro.
O XML mantém a evidência do protocolo; a coleta não substitui a validação XSD,
a verificação de assinatura ou a consulta de situação atual da nota. O download
de DANFE usa o gerador e as verificações já existentes.

## Manifestação

| Código | Evento |
| --- | --- |
| `210200` | Confirmação da operação |
| `210210` | Ciência da operação |
| `210220` | Desconhecimento da operação |
| `210240` | Operação não realizada; justificativa de 15 a 255 caracteres |

A interface exige selecionar o evento e confirmar o envio. A API permite somente
resumo autorizado recebido pela empresa, registra o XML assinado antes da rede
e revalida a autorização após a resposta. Não envia ciência automaticamente.
O horário assinado contém segundos inteiros e offset `-03:00`.

`135` com chave, tipo, sequência, ambiente e protocolo coerentes é aceito.
Timeout, resposta ambígua, `136` e duplicidade `573` permanecem `unknown`, sem
afirmar confirmação e sem reenvio automático. Esta versão reserva sequência 1
por chave e tipo. Uma solicitação anterior impede outra do mesmo tipo, inclusive
após recusa: correção/reconciliação exige análise operacional, sem apagar o
histórico nem criar reenvio por troca de chave de idempotência.

## Verificação e aceite externo

Testes usam PostgreSQL isolado, cofre/certificados sintéticos, servidor fiscal
local e navegador Chromium. Cobrem concorrência, replay, rollback, revogação de
permissão durante a rede, pausa, manifestação desconhecida e isolamento RLS.

O aceite externo exige primeiro lote e evento autorizados, conferência do XML,
hashes e protocolo, além da confirmação de consumidor único entre aplicações.
Esta entrega não executa merge, implantação ou alteração de configuração real.

Referências: [regras de consumo indevido do Portal NF-e](https://www.nfe.fazenda.gov.br/portal/informe.aspx?AspxAutoDetectCookieSupport=1&Informe=0cu%2FyBLKrCs%3D&ehCTG=false),
[MOC 7 — distribuição e eventos](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-visao-geral.pdf),
[serviços oficiais do Ambiente Nacional](https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/URL-WEBSERVICES.aspx/itemFilho.Link.Url).
