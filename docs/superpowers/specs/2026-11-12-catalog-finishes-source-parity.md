# Acabamentos iguais aos catálogos, sem alterar o histórico

## Pedido e resultado esperado
O usuário pediu as mesmas cores, nomes e amostras dos catálogos originais, em cadastro e fechamento de proposta/pedido/venda. Estrutura, braços e estofado são conjuntos distintos. Anilheiro possui somente a escolha de tipo: Standard, Olímpico ou Não se aplica conforme o produto; não existe cor de anilheiro válida na interface.

Os campos atuais misturam upholsteryColors com “Braços”. Corrigir a semântica mantendo upholsteryColors/upholsteryColor para estofado e criando swingArmColors/swingArmColor para braços. armColors/armColor são aliases legados de cor de anilheiro e não podem mudar de significado.

## Contrato e histórico
- Acrescentar swingArmColors opcional ao produto e swingArmColor opcional aos itens de simulação, proposta e pedido. Levar a seleção a leitura, gravação, conversões, snapshots e apresentação em documentos/contratos.
- Acrescentar finishingPalette opcional ao produto, com referências explícitas dhz-hammerforce-pro ou dhz-sforce. Sem referência é válido; string vazia remove a referência; omissão na edição preserva. Não identificar fabricante ou paleta apenas por cor genérica.
- Listas de cores seguem os limites existentes: até32 nomes únicos,1–60 caracteres, sem controle. Seleções devem pertencer às opções cadastradas para novos itens/escolhas.
- Omissão de campo novo por clientes antigos preserva os dados na edição. Campos legados de anilheiro continuam independentes. Não reinterpretar Amarelo como Apple Green nem Preto genericamente como uma textura específica.
- Escolhas históricas inalteradas continuam válidas ao editar quantidade/condições. Não recalcular ou reescrever snapshots antigos após atualizar o produto.
- A configuração “estofado não configurável” não deve esconder nem apagar a escolha independente dos braços.
- Manter autorização, isolamento de empresa, revisão, idempotência e preservação de fotos, preços, tributos, status e estoque.

## Fontes e apresentação
Usar bytes originais dos rasters dos PDFs, com provenance e SHA, sem geração por IA ou aproximação de cor. Componentes devem mostrar amostras compactas e nomes do fabricante, com seleção por teclado e toque, estados selecionado/desabilitado e rótulos separados para estrutura, braços e estofado. Padrões e especiais devem ser diferenciados quando o catálogo os separa.

HammerForce Pro: PDF local do checkout principal artifacts/catalog-drive-20261112/hammerforce-pro.pdf; imagem original já versionada em public/catalog/dhz-hammerforce-pro-original-colors.jpeg,1245×1759,SHA b352211bae13cfe9e0590f97d83918e8b7cb5bf21017f5b1bbd6ea06c647a7b7,página51/impresso101,xref805. Estrutura padrão: Piano Black,Matte Graphite Black,Light Grey,Performance Red. Braços padrão: os quatro anteriores,Hermès Orange,Apple Green. Estofado: Black,Saddle Brown,Reddish Brown,Mocha. Consultar o raster para opções especiais Titanium Grey/Ocean Blue.

Hammer S-FORCE: PDF local hammer-s-force.pdf,página29,xref546; imagem extraída e visualmente conferida em artifacts/dhz-s-force-original-colors.jpeg,1245×1759,SHA106032e206a9c0bdedb51a450ba665900419bdf80e5fed18b089ec11af9203e4. Estrutura: Piano Black,Graphite Black,Light Grey,Performance Red,Titanium Grey. Braços padrão: Piano Black,Graphite Black,Light Grey,Performance Red,Hermès Orange,Apple Green,Ocean Blue; assinatura também mostra Titanium Grey. Estofado: Black,Saddle Brown,Reddish Brown,Khaki,Mocha.

Cable Motion não declara uma paleta geral: não atribuir automaticamente a de outro catálogo. Cores desconhecidas mantêm nome textual, sem foto aproximada. Havendo mais de uma fonte para o modelo, registrar a referência escolhida e manter as demais fontes; não transformar paleta geral em afirmação não sustentada sobre cada acabamento de cada equipamento.

## Alinhamento de dados
Após o contrato ser publicado, alinhar somente os Premium que possuam referência suficiente. Preparar diff por ID/SKU, backup, revisão e validação dos campos protegidos; aplicar e ler de volta antes de declarar preenchido. Não repetir a carga das94 fichas técnicas ou dos42 anilheiros. A planilha permanece em uma única aba e deve ser relida antes de escrever somente células relacionadas, preservando edições nativas.

Continuam excluídos: preenchimento da linha nacional/Core e inserção dos dez modelos sem correspondente. O Excel nacional posteriormente conferido fornece custos de WH065/066, mas o pedido de conversão não revogou a suspensão de preenchimento.

## Migração antes de ativar uma versão
Defeito observado na publicação anterior: o deploy trocou as imagens antes de aplicar202611120002 e GETparties retornou500 até a migração explícita. O próximo pacote com mudança de schema deve corrigir essa ordem. Versionar um helper de migração usando a imagem aprovada do mesmo SHA, backup privado prévio e execução SQLx. Executar antes de ativar serviços; falha mantém a versão anterior. Reutilizar o ambiente da API sem expor segredos e conexão local PostgreSQL por peer/socket; não compilar no servidor. Conferir checksums/migração, saúde e uma leitura autenticada após publicação.

## Aceite
Produto → proposta/simulação → pedido → conversão/documento preserva os três componentes separados; histórico e clientes antigos continuam legíveis. Paletas e swatches correspondem às fontes, sem cor de anilheiro na UI. Testes cobrem omissão, históricos, permissões, empresa, revisão, repetição, desligamento de estofado e erros. Conferência real do layout em móvel/desktop e da versão publicada; sem envio de e-mail ou emissão fiscal como teste.
