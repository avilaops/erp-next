# Novo pedido — correções da auditoria mobile

Fonte: auditoria detalhada do usuário e sete JPEGs WhatsApp 12/11/2026 16:43, inspecionados em artifacts/new-order-mobile-audit/source-board-{0,3,6}.png. Cada captura738×1600 corresponde aproximadamente369px CSS a2x. Objetivo: vendedor consegue entender pendências, negociar com total visível, preencher e salvar em iPhone/Android sem perder trabalho.

## Fluxo e apresentação

Formulário contínuo com navegação Equipamentos → Cliente → Entrega → Desconto → Pagamento → Revisão. Seções têm IDs/títulos focáveis; atalhos e pendências abrem o campo correto sem descartar dados. Desktop mantém equipamentos largura total e lateral com negociação/revisão; mobile segue ordem do fluxo. Cabeçalho compacto com retorno Pedidos, título Novo pedido e status Em preenchimento · não salvo. Nome curto da empresa no cabeçalho; nome completo acessível no seletor existente.

Resumo compacto fixo mobile com Total do pedido, status de cálculo e botão Revisar pedido. Usa safe-area, reserva espaço no conteúdo e sai da frente quando teclado reduz viewport; não captura foco nem impede rolagem. Valores obsoletos nunca permanecem como válidos. Revisão com título, total/entrada/saldo destacados, detalhamento tabela/desconto/IPI/frete. Vazio: Adicione equipamentos para calcular.

Pendências por seção usam os mesmos validadores da gravação. Campos com erro mostram mensagem local e nome acessível; resumo tem links por campo. Salvar permanece acionável para validar quando edição é permitida; sem dados válidos não chama nenhuma mutação. Ao tentar salvar, mostrar pendências e focar primeiro campo. Motivo de bloqueios operacionais/permissões/consulta aparece junto da ação. Explicar salvar cria rascunho numerado; confirmar depois reserva estoque e gera títulos previstos, sem recebimento. Detalhe após sucesso mostra número e próxima ação.

Equipamentos: rótulo persistente Nome ou código; CTA Adicionar equipamento no vazio e no aviso de desconto, foco na busca; resultados com código/preço, loading/erro de tabela e nenhum resultado. Tabela de preços rotulada, versão em detalhes e quantidade separada. Troca de tabela pede confirmação se há edição. Itens continuam editáveis/removíveis com quantidades, preços, subtotal e acabamentos.

Cliente: Buscar cliente / Cadastrar cliente; cadastro selecionado resumido com Trocar e Editar cadastro. Alterações de cadastro são globais e só gravadas explicitamente ao salvar pedido; a API não suporta overrides cadastrais exclusivos do pedido, portanto não prometer essa semântica. Campos PJ/PF e identificação/contato/endereço agrupados; IE e ISENTO explícitos junto da identificação. Consulta CNPJ nomeada, consulta CEP preenche somente vazios, mantém IBGE e edição manual. Cidade/UF agrupadas quando couber. Endereço cadastral e destino da entrega diferenciados.

Entrega: origem da UF sempre explícita — UF do endereço, padrão da tabela enquanto endereço vazio ou escolha manual para outra UF. Retirada / Frete pago pelo cliente / Frete por nossa conta; valor só na última. Frete é custo da empresa para cálculo de margem, não soma ao total cobrado, conforme motor existente. Modalidade entra em observações da entrega já suportadas; não criar campos novos no contrato. Prazo e unidade com dica de marco inicial imediatamente junto.

Desconto: rótulo Desconto (%), valor negociado com IPI e sem acréscimo do custo de frete; sincronizar via simulação existente, mostrar efeito em reais. Barra representa desconto atual, não preenche inteira com teto de alçada. Mostrar perfil, limite de referência de tabela e status aplicável com instrução para aprovação. 99,99% pode ser retornado pela API conforme perfil/regras e busca limitada a9999bps; não alterar configuração nem tratar teto como autorização de confirmação. Resposta real da simulação e aprovação continuam autoridade.

Pagamento: entrada em R$/% editável quando possível, indicação do valor/percentual da política; vazio sem itens explica cálculo pendente. Forma/vencimento da entrada quando entrada>0; Vencimento da entrada com calendário e texto Na confirmação do pedido sem data. Controle nativo deve caber no Safari (box sizing/largura/padding do date). Saldo separado, base concreta do primeiro prazo exibida (data de entrada informada ou hoje na geração, já que API persiste vencimentos absolutos). Intervalo apenas com2+parcelas. Gerar/Adicionar explicam requisitos, parcelas mostram vencimento/valor/forma, soma e diferença para saldo. Edição exige confirmação antes de regenerar.

## Restrições e validação

- Sem alterações de API/schema/dependências/regras de negócio. Preservar idempotência, confirmação incerta, isolamento de tenant e limite de100itens.
- Preservar local3002/API8083/túnel55441; testes somente com fixtures isoladas, sem pedidos/clientes reais/e-mails/fiscal.
- Preservar guardas ao voltar/recarregar/trocar empresa; sem autosave de dados pessoais no browser. Rascunho é o pedido efetivamente salvo no servidor, identificado por número/status.
- Testar WebKit com perfil iPhone e Chromium com perfil Android, claro/escuro,369/390/640/desktop; cliente novo/existente, CPF/CNPJ, UF manual, entrada integral/parcelas, limites/aprovação, falha busca/save/retry. WebKit no Windows não equivale a teste em iPhone físico/VoiceOver; registrar essa limitação sem declarar validação física.
- Build local, modelos/lint/typecheck, browser e revisão independente; QA com capturas atuais; commit/push/CI/merge e web-only deploy usando revisão anterior conferida e hash, sem compilar em produção.
