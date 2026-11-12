# Ficha técnica dos equipamentos
Usuário autorizou criar campos na planilha e no ERP e preencher ambos, em 12/11/2026. O objetivo é relacionar os 104 modelos dos três PDFs aos 160 produtos Ludus e manter informações técnicas editáveis no cadastro, com navegação compacta. Foram confirmadas 94 correspondências: 91 por dimensões, peso e exercício nas fichas Ludus existentes; três por comparação visual do produto original. Dez modelos não têm cadastro; 66 Core não pertencem aos PDFs. Não criar produtos por suposição.

## Decisão técnica
Reutilizar product_catalog_profiles, que já contém dimensões, peso, bateria, grupo, categoria técnica e descrição. Hoje o perfil não pode existir sem uma mídia registrada; GET retorna404 e a seção some. Permitir main_media_id nulo, criar o perfil de um produto existente com revisão0 e preservar a foto legada. Nenhuma galeria ou publicação externa é necessária para editar informações técnicas.
Alternativas consideradas: importar perfis com imagens R2 exigiria configurar gateway e reiniciar serviços sem necessidade; uma nova tabela duplicaria o peso já consumido por pedidos. A extensão do perfil existente conserva uma fonte única de informações.

## Campos
Preservar os campos existentes e adicionar fabricante (80 caracteres), modelo do fabricante(80), nome original no catálogo(200), área de treino publicada(200), fontes do catálogo (até10 referências contendo título160, URL HTTPS2048 e páginas PDF/impressa opcionais1..10000). Campos novos são opcionais, vazios quando desconhecidos; omissão por clientes antigos preserva os dados. Dimensões continuam três inteiros positivos de1 a50000mm. Peso e bateria continuam em texto compatível com o sistema, com até80 caracteres. A unidade do peso é kg e a bateria mantém multiplicadores publicados.

## API e integridade
GET existente deve confirmar produto/empresa, retornar200 com data:null, revisão0, defaultCollection e mediaConfigured para produto sem perfil; produto alheio/inexistente continua404. PUT exige If-Match, bloqueia produto para concorrência, cria apenas com revisão0 e atualiza com revisão atual. Validar todos os dados e o proprietário de qualquer mídia selecionada. Auditar criação/edição e emitir outbox. Sem mídia principal, a foto legada continua sendo usada; nenhuma publicação é disparada.
Não modificar preço, NCM/CEST, situação, unidade, categoria, cores, fotos ou estoque. Dados técnicos dos66Core e outros tenants permanecem intactos. SQL da carga deve ter backup, pré-condições, ensaio em transação comROLLBACK, escrita limitada aos94IDs, auditoria/outbox e readback na API.
A disponibilidade de anilheiro reutiliza plateHolderTypes: os42 equipamentos confirmados recebem as opções Standard e Olímpico para escolha no fechamento; os52 demais Premium permanecem sem essas opções. Não há campo de cor do anilheiro. Essas são as opções comerciais solicitadas pelo usuário; os PDFs não informam o diâmetro de fábrica.

## Interface
Seção “Ficha técnica” no produto em consulta e edição. Resumo legível em duas/três colunas, ação “Editar ficha técnica” e formulário compacto; criação disponível quando não há perfil. Novos campos, descrição, dimensões e fontes são editáveis. Salvar ficha é ação distinta do produto. Impedir perda de edição, tratar conflitos e rede incerta sem repetir criação às cegas. Leitor só consulta. Não renderizar galeria se o gateway não estiver configurado; nenhuma imagem quebrada no perfil sem mídia. Validar320/390/768/1440px.

## Planilha
Manter uma única aba com os104 códigos de fabricante,94 vínculos Premium e10 modelos sem correspondência. Acrescentar SKU/ID/URLERP e status de relação, situação e preenchimento técnico noERP. Não criar uma relação de160 produtos nem marcar os66Core como ausentes dos PDFs. Preencher NCM, preço de tabela semIPI, IPI, custo/estoque apenas com registros explícitos doERP e cabeçalhos/notas que indiquem fonte e versão. Preço base é campo distinto do preço publicado semIPI. Campos não disponíveis permanecem vazios. A consolidação conserva as fichas/fontes e o modelo original em referências agrupadas na mesma aba, com backup nativo anterior; respeitar edições posteriores do usuário.

## Entrega
Implementação nativa em worktree isolada, testes antes da produção, revisão independente final, PR/merge/deploy já autorizados na conversa. Compilar localmente; servidor apenas aplica pacotes/migrações. Publicar API/web compatíveis antes da carga e verificar94 perfis, valores comerciais preservados, fotos acessíveis e a planilha por readback.
