# Novo pedido mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Corrigir e publicar os P0/P1/P2 da auditoria mobile usando o contrato atual.
**Architecture:** Modelo de pendências compartilhado, cliente/checkout reportam progresso sem mutar; orquestração comercial agrega pendências e mantém os comandos existentes. Layout acrescenta atalhos, revisão e resumo fixo. Campos nativos e tokens existentes.
**Tech Stack:** Next16.4.3, React19.3, TypeScript, CSS, Playwright WebKit/Chromium.
**Spec:** docs/superpowers/specs/2026-11-12-new-order-mobile-audit.md

## Global Constraints

- Sem API/schema/dependências novas; sem mudar política/alçada/frete/calendário do motor.
- Nenhuma gravação real como teste. Preservar3002/8083/55441 e trabalho das outras sessões.
- Repetição incerta mantém chave/payload, respostas de outra empresa/antigas descartadas.
- Alteração de cliente é cadastro compartilhado e deve ser nomeada assim.

## Review Focus

- Pendências e validação final não podem divergir, nem disparar gravação enquanto faltam campos.
- Callback de progresso não pode gerar loop de render/consulta ou marcar draft inicial como editado.
- Voltar à edição/selecionar outro cliente ou mudar UF não pode aplicar resposta atrasada nem perder cadastro confirmado em retry.
- Total fixo não pode cobrir campo com teclado, safe-area ou zoom, nem mostrar valores de simulação stale.
- Texto de alçada deve distinguir referência da tabela e decisão efetiva de aprovação; frete não pode ser somado indevidamente ao total.

### Task1: Modelo de pendências e casca mobile (root)

Files: criar order-progress.ts e order-mobile-navigation.tsx; modificar commercial-order-layout.tsx/CSS e commercial-simulator.tsx; testes new-order-mobile-ui.spec.ts e order-progress-model.node.mjs.
Interfaces: `OrderStepId = equipment|customer|delivery|discount|payment|review`; `OrderIssue = {field:string;section:OrderStepId;message:string}`. Cliente reporta `{issues:OrderIssue[];addressState:string}` via `onProgressChange?`; checkout reporta `OrderIssue[]` via `onProgressChange?`; handles expõem `focus(field:string):void` além de read/save. Root agrega, renderiza links, chama focus e mantém bloqueios operacionais. IDs estáveis order-{step}.

- [x] RED modelo de seções/priorização e browser para revisão/total/ordem/data; reproduzir em WebKit baseline.
- [x] Implementar modelo, navegação, total fixo, teclado/safe-area, validação sem escrita e CTA contexto.
- [x] Melhorar equipamentos/tabela/desconto/alçada/frete/UF, cabeçalho e revisão, preservando motor.
- [x] Verificar modelo e browser focado, atualizar testes com labels/fluxo novos.

### Task2: Cliente compacto e pendências (agente)

Files exclusivos: order-customer-form.tsx, order-customer-model.ts, order-customer-model.node.mjs. Pode criar order-customer-mobile.css. Não editar root/CSS geral/tests browser compartilhados.
Interfaces: consumir OrderIssue de ./order-progress; prop `onProgressChange?: (value:{issues:OrderIssue[];addressState:string})=>void`; handle `focus(field:string):void` abre formulário e foca input. fields sem prefixo do modelo (taxId,etc). Sections customer para identificação/contato/endereço. Reusar validação, exportar `orderCustomerIssues(draft):OrderCustomerIssue[]` e validate retorna primeira. Root roteia pelo prefixo? `field` da issue é `customer.taxId`, handle recebe taxId.

- [x] RED modelos: todos erros/ordem, cadastro preservado, formatação normaliza sem perder dados, readonly existente.
- [x] UI Buscar/Cadastrar, resumo selecionado, Trocar/Editar cadastro, grupos, IE/isento, rótulo CNPJ consulta, mensagens inline.
- [x] Reportar pendências sem loops e expor focus; preservar consulta segura/command/ETag.
- [x] Modelos/scoped lint e revisão de tarefa.

### Task3: Pagamento/entrega mobile (agente)

Files exclusivos: commercial-checkout.tsx, novo order-date-field.tsx e order-payment-mobile.css. Testes próprios opcionais em commercial-payment-mobile-model.node.mjs. Não editar CSS geral/simulator/customer/testbrowser compartilhado.
Interfaces: prop `onProgressChange?: (issues:OrderIssue[])=>void`; handle focus(field) usa data-checkout-field. Issues checkout.{field}, sections payment/delivery. Prop `deliveryMethodNote?:string` entra no deliveryNotes junto prazo. Somente orderMode/renderOrder recebe novo layout/copy; preservar variante simulador normal.

- [x] Reproduzir data baseline em WebKit via root; testes focados requisitos pagamento se extrair modelo.
- [x] Corrigir date com calendário/estado Na confirmação, largura/border-box/padding e rótulo vencimento; entrada calculada legível e editável, saldo/base/intervalo/requisitos/somas.
- [x] Reportar todos erros com mesmo validador de read, exibir inline após tentativa/focus, preservar parcelas editadas/confirmação e idempotência do pai.
- [x] Dica fabricação junto campo, modalidade na entrega persistida, regressões de checkout verificadas com root.

### Task4: Verificação, revisão e publicação

- [x] Modelos/lint/types/build local, browser Chromium+WebKit com fixtures; revisar capturas/teclado/overflow/foco e estados de falha.
- [x] Revisão independente de spec/código e ramo inteiro, corrigir achados, design-qa.md atualizado com fonte e evidências.
- [ ] Commit/push/PR relacionada AVL432, gate obrigatório; integração exata, artefato local e deploy somente web com rollback/health/hash; manter Git limpo e local funcionando.

### Task5: Limpeza de deploys antigos após validar a publicação

Pedido adicional explícito do usuário: excluir deploys antigos para liberar espaço no servidor.

- [x] Inventariar espaço, diretórios de releases/source e imagens ERP, identificando referências dos serviços ativos e rollback imediato.
- [ ] Após publicar e validar, remover somente releases/fontes/imagens ERP obsoletos com caminhos canônicos validados. Preservar versão ativa, rollback imediato, artefatos e imagens usados por API/fiscal, bancos, volumes, configurações privadas, backups e recursos de outros projetos.
- [ ] Conferir espaço recuperado, health e quatro serviços saudáveis. Registrar lista/bytes e retenção em artefato local, sem expor configurações privadas.
