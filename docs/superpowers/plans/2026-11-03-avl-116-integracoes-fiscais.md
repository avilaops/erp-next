# AVL-116 — Integrações fiscais executáveis

## Objetivo e decisões

Automatizar as rotas fiscais existentes da API Rust, preservando autorização,
tenant, revisão e idempotência. Node.js 24 fornece o cliente HTTP, exemplos CLI
e transporte MCP stdio pelo SDK já presente no lockfile. n8n usa HTTP Request;
regras fiscais e certificados continuam exclusivamente no ERP.

Uma API paralela ou node fiscal próprio duplicaria autorização e regras sem
necessidade. O cliente usa Bearer Auth Ávila e X-Tenant-Id; as chaves de serviço
atuais são restritas à leitura Lojas e não habilitam emissão. Escritas exigem
opt-in do operador, confirmação explícita e UUID de comando fornecido pelo
chamador. Repetir uma operação preserva chave, documento e revisão.

## Entregas e verificação

- [x] Cliente limitado em tempo/tamanho, erros sem segredos e redirects recusados;
  testar headers, revisão, duplicatas, 202, 403/412/429 e falha de transporte.
- [x] Ferramentas MCP com schemas estritos e escrita desativada por padrão;
  testar pelo SDK e validar o transporte stdio.
- [x] Workflow n8n inativo, credencial separada, comando idempotente e consultas
  GET limitadas; testar expressões e fluxos de autorizado/rejeitado/pendente.
- [x] Exemplos CLI de emissão, consulta, XML/PDF e guia OpenAPI/erros/webhooks;
  ligar os testes ao CI e preparar PR.

## Limites e aceite externo

AVL-81 e AVL-85 estão em andamento. Não inventar jobs ou endpoints de webhook
ausentes na base. Acompanhamento GET não consulta a SEFAZ; reconciliação POST é
operação explícita. Webhooks exigem contrato/assinatura e deduplicação persistida
da AVL-85 antes de ativação. Sem credencial fiscal/A1 aprovada, testes locais
com servidor de contrato não provam autorização real em homologação.

Não publicar workflow, executar emissão real, alterar produção nem contratar
serviços. Registrar código, testes, PR, CI e homologação separadamente.

## Evidência local

19 testes fiscais e 5 testes de arquitetura passaram. O verificador de arquitetura
retornou zero erros e os 9 nós foram aceitos pelo validador de parâmetros n8n.
A revisão independente identificou comparação de UUID maiúsculo com snapshots
canônicos; normalização e regressão foram adicionadas. Nenhum outro achado
material permaneceu na revisão. Execução no runtime n8n, autorização SEFAZ,
credencial real e webhooks continuam pendentes conforme os limites acima.

## Continuação — integração no runtime

- [x] Confirmar CI completo aprovado do commit `029c000` e reabrir a AVL-116.
- [x] Separar configuração do operador em nó n8n, sem herdar payload do comando.
- [x] Gerar SDK do mesmo grafo JSON e validar as dez configurações sem avisos.
- [x] Criar rascunho n8n inativo, sem credenciais e sem publicação.
- [x] Executar e verificar cinco cenários sintéticos no runtime, inclusive seis
  consultas sem resultado terminal; restaurar retenção de dados desabilitada.
- [x] Verificar oito operações no OpenAPI real do CI e ligar o verificador ao CI.
- [x] Revisar mudanças e preparar atualização da PR com a nova validação.

23 testes fiscais passaram. A revisão identificou e confirmou corrigidas duas
lacunas: ausência de verificação do snapshot GET no gate e perda dos settings
no SDK. Testes de regressão cobrem ambas. A importação SDK foi conferida em
rascunho temporário sem ajustes posteriores de settings, e esse rascunho foi
arquivado. O CI do novo commit ainda precisa ser observado separadamente.

As três declarações ausentes de `X-Tenant-Id` no OpenAPI são reportadas pelo
verificador para AVL-81. Não há contrato de webhook fiscal disponível na base.
Nenhuma credencial ERP foi encontrada no conector n8n; aguarda referência de
identidade/credencial de homologação para o próximo teste real.
