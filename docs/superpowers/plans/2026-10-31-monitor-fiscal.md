# Monitor fiscal canônico — AVL-320

**Objetivo:** receber NF-e destinadas ao CNPJ usando um único cursor persistente
por empresa, mantendo documentos e proveniência no ERP.

**Base:** origin/main fdeb165. A descrição da issue termina em `## F`; o contrato
local exige distribuição, cursor, documentos com hashes e manifestação explícita.

## Decisões

- Reutilizar o cofre A1 validado, a tabela de NF-e recebidas e os downloads atuais.
- Consumir distribuição diretamente por mTLS. Não enviar certificado ou senha
  ao MCP nem transferir a propriedade do cursor ao painel Monitor de Notas.
- Coleta manual de um lote por solicitação, desativada por padrão por variável
  de ambiente. O monitor consulta produção; emissão continua bloqueada.
- Reservar consulta em transação antes da rede, com pausa conservadora de uma
  hora em erro/timeout/crash, cStat 137/656 e fim da distribuição. Persistir lote
  inteiro e avanço do cursor atomicamente. Não aceitar cursor vindo do cliente.
- Preservar XML original, schema, NSU e SHA-256. NF-e completa entra na tabela
  canônica existente; resumos e eventos ficam separados, sem efeitos de compra,
  estoque ou financeiro. Nunca manifestar automaticamente.
- Manifestação usa comando explícito, identidade A1 da empresa e registro
  persistente antes da rede. Resultado desconhecido permanece visível e não é
  reenviado automaticamente.

## Tarefas

- [x] 1. Testes e parser limitado de distribuição: namespaces, gzip/base64,
  cursor monotônico, limites, resumo, NF-e completa, eventos e falhas.
- [x] 2. Persistência/RLS, reserva transacional, cliente mTLS e endpoints de
  status/coleta/documentos. Provar concorrência, isolamento, recuperação e
  deduplicação com PostgreSQL local e servidor sintético.
- [x] 3. Manifestação explícita assinada e auditada, sem reenvio de resultado
  desconhecido; testes de correlação e validação.
- [x] 4. Interface do monitor, BFF e pendências da integração Lojas; validar
  desktop/mobile, erros, permissões e troca de empresa.
- [x] 5. OpenAPI/documentação, suíte Rust, lint/typecheck/build e testes de
  navegador pertinentes. Revisar diff e registrar evidências na AVL-320.

## Verificação e limites

Fixtures exclusivamente sintéticas. Nenhuma chamada real à SEFAZ, alteração de
credencial real, merge ou deploy faz parte da execução. O aceite externo exige
certificado autorizado, configuração do ambiente e verificação posterior.

Fonte do intervalo de consulta: [Portal NF-e, regras de uso indevido](https://www.nfe.fazenda.gov.br/portal/informe.aspx?AspxAutoDetectCookieSupport=1&Informe=0cu%2FyBLKrCs%3D&ehCTG=false).
