# Motor fiscal interno do ERP Next

Adaptador de XML, assinatura A1, XSD e SOAP. A API Rust é dona dos documentos,
numeração, autorização por empresa e estados duráveis. Este serviço não possui
banco nem fila e não pode ser exposto ao navegador ou à internet.

Os módulos em `src/lib/fiscal`, `src/lib/pricing/money.ts`, os schemas e os testes
de conformidade foram portados do ERP Ávila Ops, commit
`08207ac14931a4efce3036088951828916720d48`. Os hashes dos schemas são verificados
antes da validação offline. Os testes usam certificados fictícios e transporte
sintético; não comprovam autorização real pela SEFAZ.

## Execução

```sh
npm ci
npm test
ERP_FISCAL_ENGINE_TOKEN='<segredo configurado no ambiente>' npm start
```

Node 24 ou superior. `ERP_FISCAL_ENGINE_TOKEN` deve ter ao menos 24 caracteres.
O serviço escuta `127.0.0.1:8091` por padrão. `FISCAL_ENGINE_BIND` e
`FISCAL_ENGINE_PORT` permitem rede interna de containers. Entre máquinas, usar
TLS no proxy e permitir acesso somente da API. Não registrar corpos das
requisições: contêm certificado e senha transitoriamente em memória.

Na API Rust, configurar `ERP_FISCAL_ENGINE_URL` com a origem do serviço e
`ERP_FISCAL_ENGINE_TOKEN` com o mesmo segredo. A chave A1 continua criptografada
no PostgreSQL; nunca é enviada em respostas públicas.

## Contrato

`POST /v1/{prepare,authorize,consult,event,void,distribute,distribute-cte,manifest}` exige
Bearer, JSON e `environment: "homologation"`. O campo `certificate` contém
`pkcs12Base64` e `password`, abertos exclusivamente no servidor.

- `prepare`: recebe o snapshot de emitente e rascunho da API, número, instante e
  código aleatório; retorna chave e XML assinado depois do XSD.
- `authorize` e `consult`: recebem chave/XML e retornam resultado, protocolo,
  documento processado quando disponível e resposta original da autoridade.
- `event`, `void` e `manifest`: montam e assinam o pedido, validam o XSD e
  retornam o resultado efetivamente recebido. Nenhum timeout confirma evento.
- `distribute`: consulta lote sequencial, limita descompressão e retorna NSUs e
  documentos. O cursor somente é confirmado pela transação da API Rust.
- `distribute-cte`: consulta o distribuidor nacional CT-e em homologação, com
  `issuerTaxId`, `authorState` e `lastNsu`. Valida pedido e retorno com o pacote
  oficial `PL_CTeDistDFe_100`, além de ambiente, ordem/intervalo dos NSUs e
  limites de XML/descompressão. `nextNsu: null` proíbe confirmar cursor em
  rejeições. `minimumWaitSeconds` é um mínimo a persistir pela API; o motor
  não agenda nem repete consultas. A integração Rust e seu worker opcional
  passaram no CI com a central de leitura no commit `a19dc38`; conferência
  individual, vínculos de frete e homologação externa continuam pendentes. Consulte
  [o contrato e as limitações CT-e](../../docs/CTE-DISTRIBUICAO-AVL-111.md).

`POST /v1/inspect-nfse` é uma inspeção privada de arquivo nacional recebido.
Exige o mesmo Bearer e somente `{ xml, recipientTaxId }`, sem certificado ou
ambiente de transporte. Não faz rede, abre A1 ou escreve documentos. Aceita
XML UTF-8 de até 1 MiB e versões 1.00/1.01 com tomador CNPJ da empresa.
Retorna original/hash, atores distintos, ambiente do arquivo, chave nacional
de 50 posições e valores em centavos como strings exatas. Assinatura e situação
atual permanecem não verificadas. A versão 1.01 declara perfil local de série,
com hashes e origem; não afirma aprovação pelo XSD original sem correção.
Consulte [o contrato do perfil e limites](../../docs/superpowers/specs/2026-11-03-nfse-recebida.md).
Esta etapa ainda não adiciona importação na API Rust, central ou captura ADN.

`POST /v1/inspect-cte` recebe `{ xml, companyTaxId, environment: "homologation" }`
com o mesmo Bearer interno. Confere offline o `cteProc` modelo 57/4.00 com
schemas fixados da NT 2026.004 e também o schema específico do modal; CT-e
complementar não possui esse bloco. Retorna XML/hash, transportadora,
participantes/tomador, papéis da empresa, valores exatos e referências do XML.
Confere consistência XMLDSig e correlação do protocolo/digest, sem estabelecer
confiança ICP-Brasil, autenticidade independente do protocolo ou situação atual.
Formato fora do perfil é informado separadamente de XML inválido. A operação
não recebe certificado, faz rede, altera cursor ou cria vínculos comerciais.
O XML aceita até 2 MiB; somente esta rota permite JSON de até 4.195.328 bytes
para acomodar escaping. Integração pública e persistência estão em andamento no
[plano da conferência CT-e](../../docs/superpowers/plans/2026-11-03-conferencia-cte.md).

Emissão cobre NF-e 55/SP em homologação e os seguintes recortes explícitos:

- CRT 1: CSOSN 102/103/300/400, PIS e COFINS sem alíquota (CST 04–09),
  destinatário não contribuinte/consumidor final, sem IPI ou IBS/CBS.
- CRT 3: operação interna SP, ICMS CST 00/40/41/50, PIS e COFINS CST 01/02 ou
  04–09, com `draft.taxDeclaration` preenchida. ICMS CST 50 exige contribuinte.
  Destinatário contribuinte, IE, consumidor final, composição das bases,
  alíquotas e IPI são declarados pelo responsável, conforme `taxRuleReference`.
  O recorte IBS/CBS é tributação integral CST 000 / classificação 000001,
  com todas as alíquotas declaradas, inclusive zero. Reduções, diferimentos,
  créditos, monofásicos, DIFAL e operações interestaduais CRT 3 não são aceitos.

Classificação e alíquotas são uniformes por documento. Casos que exigem dados
ausentes são recusados; não há inferência tributária por NCM ou regime.
As alíquotas são strings percentuais de quatro casas: `"18.0000"` significa
18%, `"0.0000"` é uma declaração explícita de zero. CST tributado exige a
alíquota; CST sem tributação aceita somente zero ou ausência. Para IPI,
declare CST/enquadramento e alíquota quando tributado. Não informar CST
significa nota sem grupo IPI; não permite uma alíquota positiva.

Exemplo de declaração CRT 3 para testes de homologação (valores fictícios;
nunca são preenchidos automaticamente):

```json
{
  "recipientTaxpayer": true,
  "recipientStateRegistration": "110042490114",
  "finalConsumer": false,
  "icmsRate": "18.0000",
  "pisRate": "1.6500",
  "cofinsRate": "7.6000",
  "ipiCst": "50",
  "ipiFrameCode": "999",
  "ipiRate": "10.0000",
  "ipiInIcmsBase": false,
  "icmsOutOfContributions": true,
  "ibsCbs": {
    "cst": "000",
    "classCode": "000001",
    "ibsStateRate": "0.1000",
    "ibsCityRate": "0.0000",
    "cbsRate": "0.9000"
  }
}
```

O motor compara os valores arredondados por item e os totais com aritmética
inteira e recusa valores que o construtor XML não consegue preservar. O total
da NF-e neste recorte é produtos mais IPI arredondado por item.
O rascunho deve declarar formas/valores de pagamento; não são inferidos dos
recebimentos. Ausência de pagamento exige `tPag=90`, único, com valor zero.
Registrar recebimentos no ERP não comprova pagamento bancário nem muda
automaticamente o documento fiscal.
Produção permanece bloqueada. Outros recortes exigem extensão explícita.
`GET /healthz` exige o mesmo Bearer e retorna apenas estado do processo e
ambiente de homologação; não acessa certificado nem SEFAZ.

Referências técnicas consultadas:

- [Web Services NF-e da SEFAZ SP](https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/URL-WEBSERVICES.aspx/1000).
- [Orientação oficial DF-e/NSU](https://hom.nfe.fazenda.gov.br/PORTAL/exibirArquivo.aspx?conteudo=roKnnK+H7D0%3D).
