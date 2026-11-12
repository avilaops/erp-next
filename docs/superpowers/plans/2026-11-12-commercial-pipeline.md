# Funil comercial compacto e navegável — Implementation Plan

> For agentic workers: use superpowers:executing-plans and one fresh whole-branch review before integration.

**Goal:** Corrigir a consulta do funil, preservar filtros no percurso lista → oportunidade → retorno e evitar perda silenciosa de edições.

**Spec:** [AVL-432](https://linear.app/avilaops/issue/AVL-432) requer busca, etapas Novo/Contato feito/Proposta enviada/Negociação/Ganho/Perdido, quantidade/valor em andamento e continuidade oportunidade → simulação → pedido. [AVL-17](https://linear.app/avilaops/issue/AVL-17) exige cinco tamanhos, teclado, carregamento/erro e preservação. É um incremento dessas frentes, sem atestar o aceite completo.

**Architecture:** Somente web. Reutilizar GET /opportunities, cujos totais são da empresa inteira e cuja lista é filtrada/paginada. Trocar colunas extensas por tabela compacta adaptada ao celular, com etapa explícita em cada registro. Usar URL como fonte dos filtros e o GuardedLink existente para retorno e confirmação. Sem alteração de API ou banco.

## Constraints and Review Focus

- “Todas as etapas” deve mostrar também Ganho/Perdido; não paginar todos os registros e esconder parte deles na interface.
- Nunca apresentar zero como resultado de carregamento ou falha. Distinguir resumo da empresa de contagem do filtro e da página.
- Valores em centavos devem permanecer inteiros seguros; resumo indisponível não vira valor inventado.
- Validar busca, etapa e offset de URLs; retorno restrito à listagem interna, sem redirecionamento externo.
- Preservar busca/etapa/página ao consultar, criar, salvar e voltar; Back/Forward seguem o filtro da URL.
- A navegação do editor passa pela confirmação existente; cancelar conserva dados e comandos incertos continuam congelados.
- Mostrar próxima ação para vazio/erro, com controles móveis de 44px e sem corte de nomes/valores em 320/390/430/1366/1440.
- Lista pode rolar verticalmente para até 25 registros; cabeçalho/filtros e resumo recolhido devem caber antes do primeiro registro. Sem quadro de 100 cartões nem múltiplas etapas vazias empilhadas.
- Testes sintéticos, sem criar oportunidade/pedido real, enviar e-mail, acionar SEFAZ ou alterar parâmetros.
- Não alterar status/comentários no Linear. Compilar localmente/CI; publicação somente web, sem compilação em produção.

### Task 1: Modelo e filtros

- [x] Testar leitura/escrita dos filtros, limites, caracteres inválidos e somas seguras do resumo.
- [x] Implementar modelo puro e estado de consulta na URL com paginação de 25 itens.
- [x] Garantir que todas as etapas incluam encerradas e que resumo/contagem usem seus escopos reais.

### Task 2: Lista, recuperação e continuidade

- [x] Reproduzir zero fictício, encerradas omitidas, perda de contexto e navegação sem confirmação.
- [x] Criar lista compacta, resumo expansível, filtros/limpeza, repetição de consulta e estados vazios úteis.
- [x] Integrar retorno do funil ao helper existente e preservar contexto após salvar uma nova oportunidade.
- [x] Validar teclado, tamanho de toque, largura, nomes longos e permissão de consulta nos cinco tamanhos.

### Task 3: Revisão e publicação

- [x] Executar modelos, navegador na build de produção, TypeScript, lint e build, com evidências visuais.
- [ ] Revisar independentemente, corrigir achados relevantes, integrar após CI aprovada.
- [ ] Publicar somente web e conferir revisão pública e quatro serviços, mantendo aceite autenticado separado.
