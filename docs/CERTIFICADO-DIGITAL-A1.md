# Certificado digital A1

## Uso na interface

Abra **Preferências → Empresa → Certificado digital**
(`/preferencias/certificado-digital`). Selecione o arquivo `.pfx` ou `.p12`,
de até 64 KiB, informe a senha de exportação e clique em **Conectar certificado**.
Não é necessário instalar o arquivo no Windows. Arquivos exportados sem senha
podem ser enviados com o campo vazio.

O ERP confere o conteúdo PKCS#12, a presença de uma única chave privada, a
correspondência da chave com o certificado, o CNPJ ICP-Brasil da empresa ativa,
a política A1, a permissão de assinatura digital, a validade e a cadeia de
confiança. O formato fiscal suportado usa chave RSA de 2048 a 8192 bits.
O PFX deve incluir os certificados intermediários da cadeia.

Após conectar, a tela mostra titular, autoridade certificadora, validade,
número de série, SHA-256 e data da verificação. Há aviso quando faltam até
30 dias para o vencimento. Um certificado vencido, ainda não vigente,
incompatível com o CNPJ atual ou cuja credencial não possa ser aberta não é
marcado como disponível.

**Substituir** valida o novo arquivo antes de gravar. Falhas preservam o
certificado anterior. **Remover** apaga a credencial da empresa após confirmação
na interface; não revoga o certificado na autoridade certificadora. A senha
digitada é limpa ao terminar uma tentativa. Arquivo, senha e chave privada
não são devolvidos ao navegador nem oferecidos para download.

A consulta de revogação não é executada por este módulo e aparece como
`revocationChecked: false`. Conectar o certificado não habilita transmissão de
NF-e. A importação de XML e a geração de DANFE de XML já autorizado dispensam
esse upload.

## API e permissões

| Método | Rota | Comportamento |
| --- | --- | --- |
| GET | `/api/v1/fiscal/certificate` | Metadados, situação, disponibilidade de upload e ETag |
| PUT | `/api/v1/fiscal/certificate` | Valida e conecta ou substitui a credencial |
| DELETE | `/api/v1/fiscal/certificate` | Remove o conteúdo cifrado e incrementa a revisão |

A consulta exige `fiscal.config.read`; alterações também exigem
`fiscal.config.manage`. Todas as operações verificam identidade e associação
ativa à empresa. A tabela tem RLS obrigatório. O BFF usa a sessão selada,
confere a origem das alterações e recusa troca de empresa entre tela e sessão.

O PUT recebe JSON com `pkcs12Base64` e `password`, sem outros campos.
PUT e DELETE exigem `If-Match`: `"0"` para a primeira conexão e o ETag
retornado pela última consulta para as seguintes. A remoção conserva uma
revisão sem credencial, impedindo que uma requisição antiga recrie o arquivo.
Uma alteração concorrente retorna 412. Não há reenvio automático de segredos.

As verificações PKCS#12 acontecem fora da transação de escrita. Antes de
persistir, a API confere novamente permissões, CNPJ e revisão. Duas validações
podem ocupar os trabalhadores ao mesmo tempo; o cliente recebe erro se eles
estiverem ocupados ou se a verificação exceder 20 segundos. Uma validação que
terminar depois desse prazo não grava a credencial.

## Proteção e configuração

O PFX original e sua senha são cifrados juntos com AES-256-GCM e nonce aleatório
de 12 bytes. A autenticação do envelope inclui empresa, revisão e hash dos
metadados, impedindo reutilização entre empresas ou alteração silenciosa da
validade. Auditoria e outbox recebem revisão, fingerprint e validade, sem
credenciais. A tabela não guarda senha nem chave privada em texto aberto.

Configure `FISCAL_A1_KEYRING` apenas no ambiente privado da API:

```json
{
  "active": "v1",
  "keys": {
    "v1": "<base64 de uma chave aleatoria de 32 bytes>"
  }
}
```

O provisionamento deve gerar a chave com um gerador criptográfico e preservá-la
fora do banco e do repositório. Não use a senha do A1, o segredo de sessão ou
um valor de exemplo como chave. A API aceita até dez identificadores para
permitir leitura de credenciais protegidas com chaves anteriores. Novas
conexões e substituições usam a chave ativa. Não remova uma chave antiga
enquanto registros ou backups que precisem ser recuperados dependerem dela.

Sem keyring, a API mantém a consulta disponível e informa que o armazenamento
seguro ainda não está configurado; o upload fica desabilitado. Um keyring
malformado impede a inicialização, sem registrar seu conteúdo.

As raízes públicas compiladas vêm do
[repositório oficial do ITI](https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz).
O arquivo `deploy/fiscal/icp-brasil-roots.json` registra URLs, hashes SHA-256 e
validade das raízes obtidas por HTTPS. Não há download de URLs fornecidas pelo
usuário durante a validação. `FISCAL_A1_CA_BUNDLE_FILE` pode indicar um arquivo
PEM de raízes aprovado pelo operador; é usado nos testes para uma CA isolada,
que nunca deve ser instalada na produção.

A migração `202610290002_fiscal_a1_certificates.sql` cria a tabela cifrada.
Publique as imagens aprovadas e aplique a migração pelo workflow de produção
com `schema_only=true`, que também concede SELECT, INSERT e UPDATE ao runtime.
Backups do banco continuam sujeitos à retenção: remover a credencial corrente
não apaga cópias históricas dos backups.

## Verificação

As fixtures de `a1-synthetic.json` são credenciais geradas para testes isolados,
com uma CA explicitamente identificada como **não ICP-Brasil** e senha pública
de teste. Os testes criptográficos verificam PFX moderno e legado, senha,
CNPJ, validade, cadeia e autenticação dos envelopes por empresa e revisão.
Os testes HTTP exercitam Rust e PostgreSQL com usuário sem bypass de RLS.

Após compilar a API e o Next.js, o harness `scripts/verify-company.mjs` pode
executar `certificate-persistence.spec.ts`: upload, recarga, substituição,
conflito, remoção, permissões, layout mobile e preservação da credencial após
reiniciar o processo da API. A CA de teste e a chave temporária são exclusivas
do banco isolado criado pelo harness. Esses testes não usam um certificado
de cliente nem atestam autorização para emitir NF-e.
