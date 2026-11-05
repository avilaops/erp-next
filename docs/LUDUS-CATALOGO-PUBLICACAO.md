# Publicação revisada do catálogo Ludus

Os perfis públicos são separados dos dados comerciais internos. Preços e dados fiscais permanecem no ERP. Cada perfil pertence a uma empresa, mantém revisão com If-Match e referencia uma variante já registrada da imagem do mesmo produto.

A prévia retorna um hash dos dados. A publicação exige esse hash e uma chave de idempotência, persiste a versão antes do envio e repete exatamente essa versão em caso de falha. O Worker rejeita sequências antigas e mantém originais privados.

Configuração exclusiva do servidor: `CATALOG_MEDIA_ORIGIN=https://ludusequipamentos.com`, `CATALOG_MEDIA_TENANT` e `CATALOG_MEDIA_TOKEN`. O segredo também é configurado no Worker como `PUBLISH_TOKEN`; não pode aparecer no navegador, Git ou logs.

## Novas imagens

A galeria aceita JPEG, PNG e WebP de até 10 MB, valida formato e limites de pixels e preserva os bytes originais. O backend aplica orientação EXIF aos derivados, gera WebP principal e miniatura e registra versões no PostgreSQL. Chaves R2 incluem SHA-256, linha e SKU; arquivos imutáveis e originais privados. Salvar perfil não publica o catálogo.

O Worker valida MIME, hash, tamanho, SKU e variante. A publicação aceita apenas derivados registrados do mesmo produto. Tokens são secretos de servidor e precisam ser preservados nas atualizações do Worker.

## Cores aprovadas para Ludus

Somente Premium recebe opções. Estrutura: Piano Black, Graphite Black, Light Grey, Titanium Grey e Performance Red. Braços e anilheiro têm escolhas independentes entre Preto, Grafite, Cinza, Vermelho, Laranja, Amarelo e Azul. Estofado é padrão: `upholsteryConfigurable=false` no tenant Ludus; preservar configurações de outros tenants e escolhas históricas.

Propostas, pedidos e contratos transportam as escolhas. A preparação fiscal inclui os acabamentos em informações adicionais por item, com limite de tamanho e teste do XML. Isso não equivale a uma NF-e emitida; nenhuma emissão real foi autorizada para teste.

## Integração com avx-tools e site

O adaptador `from_publication.py` baixa o snapshot público e as imagens principais, preserva cores, valida dados e registra hashes/versão. A geração é manual, sem preços. Para impressão, o manifesto privado pode usar originais em alta resolução.

Em 05/11/2026, o Worker já entrega fotos e PDFs pelo domínio correto. Catálogos publicados: Core 66 equipamentos/79 páginas; Premium 91/107 páginas, fotos originais. Ambos têm versões compactas, logos transparentes, navegação e imagens com todos os equipamentos de cada grupo. Área com folga estimada de 600 mm por lado, duas casas decimais.

## Etapas operacionais restantes

- Implantar a versão final validada do ERP e aplicar seus grants de arquivos.
- Importar 157 perfis, referências v2 e paletas dos 94 Premium com backup e transação, preservando preços e dados fiscais.
- Só então limpar as fotos legadas dos 157 produtos migrados; preservar os três arquivados.
- Conferir publicação real ERP → site e galeria na sessão autenticada. A conexão do navegador ainda não estava disponível na última consulta.

As migrações de perfis e cores já existem no banco. Release, migração, implantação, carga comercial e validação autenticada devem ser registrados separadamente.
