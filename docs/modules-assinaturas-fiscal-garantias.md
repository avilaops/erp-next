# Assinaturas, monitor fiscal e garantias

Este documento define os limites iniciais dos três recursos adicionados ao
escopo do ERP-Next. Ele complementa o roadmap e não autoriza copiar regras,
schema ou integrações do ERP legado sem revisão de domínio e testes.

## Decisões comuns

- O ERP-Next mantém o estado canônico de cada processo e aplica as regras de
  negócio dentro do monólito modular.
- Integrações externas usam adaptadores, outbox, consumidores idempotentes,
  retentativas limitadas, fila de falhas e reconciliação.
- O n8n orquestra notificações e integrações assíncronas. Ele não substitui a
  API, o banco de dados nem as transações do ERP.
- Toda operação exige `tenant_id`, autorização, trilha de auditoria e chave de
  idempotência quando puder ser repetida.
- Segredos ficam em cofre de credenciais. Tokens e certificados não podem ser
  enviados ao navegador, persistidos em logs ou versionados.

## Documentos e assinaturas

Issue de referência: `AVL-318`.

### Modelo de domínio

- `DocumentTemplate`: modelo, versão, campos e finalidade.
- `Envelope`: agrupador de documentos, participantes e regras de execução.
- `Document`: arquivo, hash, versão, origem e vínculo com entidades do ERP.
- `Participant`: pessoa, papel, qualificação, ordem e canal de contato.
- `SignatureRequirement`: tipo de assinatura, autenticação e posições.
- `ProviderOperation`: comando, idempotência, tentativa e resposta sanitizada.
- `ProviderEvent`: webhook bruto protegido, assinatura validada e processamento.
- `EvidenceBundle`: documentos finais, hashes, eventos e trilha de auditoria.

O contrato interno não deve expor identificadores ou estados específicos da
Clicksign. O primeiro adaptador será Clicksign API v3, com ambientes separados
de sandbox e produção.

### Capacidades previstas

- Envelopes com um ou mais documentos e signatários.
- Papéis, qualificações, observadores e ordem de assinatura.
- Assinaturas simples, avançadas e qualificadas, conforme disponibilidade do
  plano e adequação jurídica do processo.
- Token por e-mail, SMS ou WhatsApp; assinatura e aceite via WhatsApp.
- Assinatura manuscrita, rubrica, PIX, certificado ICP-Brasil, documento
  oficial, documentoscopia, selfie, prova de vida e biometria.
- Provedores de biometria, SERPRO, bases ampliadas, Registro Civil e carimbo do
  tempo devem ser capacidades configuráveis, nunca premissas obrigatórias.
- Notificações, lembretes, assinatura presencial, área do signatário, widget
  incorporado e identidade visual.
- Painel, relatórios, auditoria, SSO, restrição por IP e tempo de sessão quando
  contratados no provedor.
- Modelos via API, ClickFlow, ClickForm, módulos de aceite e notificação e
  Click Intelligence como integrações opcionais separadas.
- Integrações nativas, Zapier e MCP são canais auxiliares; não substituem o
  adaptador transacional do ERP.

Cada capacidade deve ser descoberta ou configurada por tenant. A interface não
pode prometer um método ausente no plano da conta.

### Fluxo e resiliência

1. O domínio cria o envelope local e grava o comando na outbox.
2. O worker cria o envelope remoto com chave idempotente.
3. O ERP associa documentos, participantes e requisitos.
4. O envio para assinatura só ocorre após validação completa do rascunho.
5. Webhooks têm HMAC validado antes de qualquer alteração de estado.
6. Eventos repetidos ou fora de ordem são aceitos sem duplicar efeitos.
7. Uma reconciliação periódica compara estados local e remoto.
8. Arquivos finais e evidências são armazenados com hash e retenção definida.

Sandbox e produção usam credenciais, hosts e dados distintos. Um documento de
sandbox não pode ser apresentado como juridicamente válido.

### Critérios de aceite iniciais

- Criar, consultar, cancelar e reconciliar envelopes pelo adaptador.
- Configurar participantes, ordem, papéis e requisitos suportados.
- Validar HMAC e idempotência com webhooks repetidos e fora de ordem.
- Relacionar o documento a contrato, proposta, pedido, garantia ou serviço.
- Baixar documento final e evidências sem expor credenciais.
- Auditar autor, transições, falhas, retentativas e ação manual.

## Monitor de Notas

Issue de referência: `AVL-320`.

### Limite canônico

O domínio Fiscal do ERP-Next é o único responsável pela distribuição de DF-e.
O Lojas consome a API fiscal do ERP; o n8n não mantém um segundo coletor nem um
cursor fiscal paralelo.

### Modelo e fluxo

- Configuração por tenant, estabelecimento e CNPJ, com certificado A1 e
  ambiente fiscal segregados.
- Cursor `ultNSU` persistido por CNPJ e ambiente, com bloqueio contra coleta
  concorrente.
- Armazenamento imutável do conteúdo recebido e dos metadados de origem.
- Tratamento explícito de `resNFe`, `procNFe`, `resEvento` e `procEventoNFe`.
- Normalização de emitente, destinatário, chave, datas, valores, situação e
  eventos sem perder o XML original.
- Manifestação do destinatário somente por comando explícito, com autorização,
  motivo, idempotência e auditoria.
- XML completo e DANFE apenas quando existir documento completo e autorizado.
  Resumo de NF-e não deve ser apresentado como XML completo.
- Reconciliação opcional com fornecedor, produtos, pedido de compra,
  recebimento, custos e movimentos de estoque.
- API paginada para o ERP Web e para o Lojas, respeitando tenant e permissões.

### Critérios de aceite iniciais

- Reiniciar a coleta sem pular nem duplicar NSU.
- Processar lotes repetidos, eventos fora de ordem e indisponibilidade da SEFAZ.
- Diferenciar resumo, documento completo, cancelamento e carta de correção.
- Registrar quem manifestou, o evento enviado e a resposta oficial.
- Disponibilizar estados de sincronização, erro, credencial vencida e sem
  permissão, com ação operacional clara.

## Garantias e assistência técnica

Issue de referência: `AVL-319`.

### Modelo de domínio

- `WarrantyPolicy`: garantia legal, contratual ou estendida, vigência e regras.
- `WarrantyCoverage`: produto, variante, componente, serviço e exclusões.
- `WarrantyClaim`: protocolo, origem, consumidor, item e estado do atendimento.
- `WarrantyItem`: pedido, nota, item, número de série ou lote e quantidade.
- `Triage`: sintomas, diagnóstico, evidências, decisão e responsável.
- `ServiceOrder`: serviço, peças, mão de obra, prazos e conclusão.
- `RmaAuthorization`: envio, recebimento, logística reversa e rastreio.
- `WarrantyResolution`: reparo, troca, crédito, devolução ou recusa motivada.

### Fluxo operacional

1. Validar elegibilidade por venda, documento fiscal, item, série ou lote.
2. Gerar protocolo e prazo de SLA conforme política aplicável.
3. Coletar descrição, fotos, vídeos, documentos e aceite de termos.
4. Executar triagem e registrar decisões com motivo e responsável.
5. Quando necessário, abrir logística reversa, recebimento e quarentena.
6. Executar ordem de serviço, consumo de peças e laudo técnico.
7. Concluir com reparo, descarte, troca, devolução ou crédito.
8. Produzir os efeitos transacionais de estoque, financeiro e fiscal.

Clicksign poderá assinar termos, laudos e comprovantes, mas não controla o
estado da garantia. Notificações e integrações de transporte podem ser
orquestradas pelo n8n após eventos canônicos do ERP.

### Critérios de aceite iniciais

- Impedir garantia sem vínculo ou autorização excepcional auditada.
- Preservar série, lote, item e documento fiscal em todas as transições.
- Controlar SLA, responsáveis, fila, pendências e comunicação com o cliente.
- Registrar estoque em quarentena e impedir disponibilidade indevida.
- Aplicar troca, crédito ou devolução uma única vez, mesmo após retentativa.
- Gerar histórico e evidências completos para atendimento e auditoria.

## Eventos iniciais

- `document.envelope.requested`, `document.envelope.sent`,
  `document.envelope.completed`, `document.envelope.failed`.
- `fiscal.distribution.received`, `fiscal.document.authorized`,
  `fiscal.recipient_event.registered`, `fiscal.sync.failed`.
- `warranty.claim.opened`, `warranty.triage.completed`,
  `warranty.return.authorized`, `warranty.claim.resolved`.

Os nomes são contratos iniciais. Payload, versão, dados pessoais permitidos e
política de retenção precisam ser definidos antes de publicar consumidores.

## Referências externas verificadas

Consultadas em 24/10/2026:

- [Recursos de assinatura e administração da Clicksign](https://www.clicksign.com/assinatura)
- [Introdução à API v3, ClickFlow e módulos](https://developers.clicksign.com/reference/comece-agora)
- [Ambientes, autenticação e formato](https://developers.clicksign.com/docs/ambientes-autenticacao-e-formato)
- [Webhooks, HMAC e práticas de integração](https://developers.clicksign.com/)
- [Requisitos, autenticações e limites da API](https://developers.clicksign.com/docs/faq-duvidas-e-problemas-comuns)
