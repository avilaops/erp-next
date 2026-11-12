# Recuperação comercial e contexto — Implementation Plan

> For agentic workers: use superpowers:executing-plans; validate each behavior before implementation and perform one fresh review before integration.

**Goal:** Tornar a correção de erros e os atalhos do simulador previsíveis, preservando dados e o contexto do cálculo.

**Spec:** Linear [AVL-432](https://linear.app/avilaops/issue/AVL-432/erp-next-simulador-comercial-completo-antes-do-pedido-com-paridade-das) exige recuperação, resumo do destino, contexto da linha e navegação sem redigitação; [AVL-17](https://linear.app/avilaops/issue/AVL-17/erp-onda-2-validar-pilotos-de-pedido-cores-e-financeiro) exige teclado, cinco tamanhos, controles móveis e preservação. As referências antigas a cor de anilheiros são superadas pela instrução direta do usuário: não existe esse campo.

**Architecture:** Somente web; manter contrato financeiro e backend. Identificar o primeiro campo inválido no checkout, abrir seus grupos e focá-lo após a renderização, com mensagem associada. Mostrar o destino do snapshot usado na simulação. Preservar a linha no link de publicação. Nenhuma mudança de parâmetros ou operação real.

## Constraints

- Preservar centavos, parcelas, cliente, acabamentos, revisão e congelamento de comandos incertos.
- Testes sintéticos, sem criar pedidos reais, enviar mensagens ou transmitir NF-e.
- Não alterar status nem publicar comentários no Linear sem pedido explícito.
- SMTP permanece bloqueado pela credencial recusada; não repetir a autenticação.
- Compilar localmente/CI e publicar somente web após o gate. Sem compilação em produção.
- Verificar 320, 390, 430, 1366 e 1440 pixels; sem rolagem horizontal, navegação e remoção com alvos de 44px no celular.

## Review Focus

- O erro de uma parcela recolhida deve abri-la, focar o campo exato e manter todos os valores.
- Campos de entrada, fabricação e vencimento têm recuperação coerente; ausência de plano leva à ação correta.
- Erro de soma não esconde um erro específico de campo. Mensagens acessíveis não ficam sem associação ao input.
- Cancelar/substituir parcelas e congelar comandos incertos conservam o comportamento publicado.
- Destino mostrado vem da simulação calculada, nunca de um formulário alterado ou de suposição sobre o pedido.
- Atalho de publicação conserva Nacional/Importada e respeita a permissão fornecida pelo servidor.

### Task 1: Recuperação de campos

- [x] Reproduzir em navegador a parcela inválida recolhida que permanece escondida e sem foco ao tentar criar.
- [x] Associar erro ao controle, abrir os grupos e focar o primeiro campo inválido sem perder edições.
- [x] Cobrir forma da entrada, valor/data/forma da parcela, fabricação e soma; nenhuma criação em erro.

### Task 2: Contexto e navegação

- [x] Reproduzir ausência de UF/contribuinte no resumo da simulação e perda da linha no atalho de publicar.
- [x] Mostrar destino e condição do cálculo retornado; manter o pedido antigo usando seu snapshot.
- [x] Manter a linha no atalho autorizado e explicar próxima ação quando não há tabela.
- [x] Corrigir alvos móveis das etapas e de remover parcela; preservar compactação no desktop.

### Task 3: Revisão e publicação

- [x] Modelos, navegador na build de produção, lint, TypeScript, build e screenshots nos cinco tamanhos.
- [ ] Revisão independente, correções necessárias e gate CI aprovado.
- [ ] Publicação somente web, versão pública e quatro serviços saudáveis; registrar limitações autenticadas separadamente.
