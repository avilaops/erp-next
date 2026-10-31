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

`POST /v1/{prepare,authorize,consult,event,void,distribute,manifest}` exige
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

Emissão cobre NF-e 55/SP em homologação e o subconjunto explícito do rascunho:
CRT 1, CSOSN 102/103/300/400, PIS e COFINS sem alíquota (CST 04–09), classificação
uniforme por documento e destinatário não contribuinte/consumidor final. Casos
que exigem alíquotas ou dados ausentes são recusados; não há inferência tributária.
O rascunho deve declarar formas/valores de pagamento; não são inferidos dos
recebimentos. Ausência de pagamento exige `tPag=90`, único, com valor zero.
Registrar recebimentos no ERP não comprova pagamento bancário nem muda
automaticamente o documento fiscal.
Produção permanece bloqueada. Outras UFs/regimes exigem extensão explícita.

Referências técnicas consultadas:

- [Web Services NF-e da SEFAZ SP](https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/URL-WEBSERVICES.aspx/1000).
- [Orientação oficial DF-e/NSU](https://hom.nfe.fazenda.gov.br/PORTAL/exibirArquivo.aspx?conteudo=roKnnK+H7D0%3D).
