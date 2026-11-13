# Identificação visual de bancos

Coleção de origem: [Bancos-em-SVG, de Thiago da Silveira Gentil](https://github.com/Tgentil/Bancos-em-SVG), fixada no commit [fe1d43f0cf379135bd01c987bc147a04fdf48c6d](https://github.com/Tgentil/Bancos-em-SVG/tree/fe1d43f0cf379135bd01c987bc147a04fdf48c6d).

O README de origem, na seção **Licença**, informa que os logos pertencem aos respectivos bancos, que a coleção não possui afiliação ou endosso e que o uso deve seguir as diretrizes de marca de cada banco e respeitar seus direitos. A origem não declara licença MIT. Os arquivos aqui identificam visualmente o banco informado pelo usuário; não representam parceria, conexão bancária, certificação nem cadastro oficial de instituições autorizadas.

`source-manifest.json` registra cada caminho original, URL fixada, SHA-256 de origem e do SVG servido. A importação elimina a declaração pública de DTD e metadados/atributos do editor; permite somente elementos SVG estáticos e referências locais a fragmentos. Scripts, eventos, conteúdo incorporado, imagens e referências externas são rejeitados. Banco BV e DuePay usam ícone genérico porque as variantes disponíveis continham elementos `image`; a alternativa segura do Mercantil foi preservada. Somente arquivos locais são usados em `img`; não há SVG injetado no HTML nem requisição remota durante o uso do seletor.

Para preservar a escala dos logos exibidos a 28×28, todo SVG servido possui `viewBox` com coordenadas finitas e dimensões positivas. Quando a origem não fornece `viewBox`, a importação deriva `0 0 largura altura` somente de dimensões intrínsecas numéricas, positivas, finitas e sem unidade; não infere dimensões de percentuais, unidades CSS ou valores inválidos. O `viewBox` já existente é preservado e validado. Essa normalização foi necessária nos logos do Pan, Bank of America, PagSeguro e Stone.

Reimporte a mesma versão, a partir da raiz do projeto:

```sh
python scripts/banks/import-bank-logos.py
```

O catálogo tem 86 nomes de bancos, cooperativas, instituições de pagamento e marcas presentes na coleção. É uma ajuda de identificação, sem garantia de cobertura, vigência de marca ou autorização regulatória. Valores manuais e anteriores continuam disponíveis. Algumas marcas de origem apresentam limitações de vetorização que o próprio README registra.

Os sete códigos pesquisáveis são um subconjunto conferido em documentação dos próprios bancos em 12/11/2026. O arquivo `bank-catalog.ts` registra a fonte de cada código: BB (001), Caixa (104), Itaú (341), Bradesco (237), Santander (033), Inter (077) e Nubank/Nu Pagamentos (260). Os códigos auxiliam a busca e a visualização; somente o nome escolhido é gravado na string `bank`. Não foram inferidos códigos para as demais marcas nem usado o repositório de logos como fonte de códigos bancários.
