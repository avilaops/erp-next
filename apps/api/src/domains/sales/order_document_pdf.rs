//! Vector PDF renderer. Its input deliberately contains customer-facing fields only.
use base64::Engine;
use pdf_writer::types::{CidFontType, FontFlags, SystemInfo};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
};
const REGULAR: &[u8] = include_bytes!("../../../assets/fonts/NotoSans-Regular.ttf");
const BOLD: &[u8] = include_bytes!("../../../assets/fonts/NotoSans-Bold.ttf");
const WIDTH: f32 = 595.2756;
const HEIGHT: f32 = 841.8898;
const LEFT: f32 = 42.0;
const RIGHT: f32 = WIDTH - LEFT;
const BOTTOM: f32 = 782.0;
const INK: [f32; 3] = [0.12, 0.17, 0.23];
const MUTED: [f32; 3] = [0.36, 0.41, 0.47];
const ACCENT: [f32; 3] = [0.03, 0.38, 0.43];
const PALE: [f32; 3] = [0.94, 0.96, 0.97];
pub(super) struct Item {
    pub description: Vec<String>,
    pub quantity: String,
    pub unit_price: String,
    pub amount: String,
}
pub(super) struct Document {
    pub issuer_name: String,
    pub issuer_lines: Vec<String>,
    pub logo_data_url: String,
    pub number: String,
    pub revision: i64,
    pub status: String,
    pub due: String,
    pub customer_lines: Vec<String>,
    pub items: Vec<Item>,
    pub total: String,
    pub weight: String,
    pub sections: Vec<(String, String)>,
}
struct Text {
    value: String,
    x: f32,
    y: f32,
    size: f32,
    bold: bool,
    color: [f32; 3],
}
struct Band {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    color: [f32; 3],
}
#[derive(Default)]
struct Page {
    texts: Vec<Text>,
    bands: Vec<Band>,
}
struct Layout<'a> {
    document: &'a Document,
    pages: Vec<Page>,
    y: f32,
    logo: bool,
}
fn face(bold: bool) -> ttf_parser::Face<'static> {
    ttf_parser::Face::parse(if bold { BOLD } else { REGULAR }, 0)
        .expect("bundled licensed Noto Sans")
}
fn measure(value: &str, size: f32, bold: bool) -> f32 {
    let font = face(bold);
    value
        .chars()
        .map(|c| {
            font.glyph_index(c)
                .and_then(|g| font.glyph_hor_advance(g))
                .unwrap_or(600) as f32
                * size
                / f32::from(font.units_per_em())
        })
        .sum()
}
fn clean(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect()
}
fn wrap(value: &str, width: f32, size: f32, bold: bool) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in clean(value).split('\n') {
        let mut line = String::new();
        for word in paragraph.split_whitespace() {
            let candidate = if line.is_empty() {
                word.to_owned()
            } else {
                format!("{line} {word}")
            };
            if measure(&candidate, size, bold) <= width {
                line = candidate;
                continue;
            }
            if !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
            // Split even an unbroken SKU/address using actual embedded-font widths.
            for c in word.chars() {
                let candidate = format!("{line}{c}");
                if !line.is_empty() && measure(&candidate, size, bold) > width {
                    lines.push(std::mem::take(&mut line));
                }
                line.push(c);
            }
        }
        lines.push(line);
    }
    lines
}
impl Layout<'_> {
    fn put(
        &mut self,
        value: impl Into<String>,
        x: f32,
        y: f32,
        size: f32,
        bold: bool,
        color: [f32; 3],
    ) {
        self.pages.last_mut().expect("page").texts.push(Text {
            value: value.into(),
            x,
            y,
            size,
            bold,
            color,
        });
    }
    fn band(&mut self, x: f32, y: f32, width: f32, height: f32, color: [f32; 3]) {
        self.pages.last_mut().expect("page").bands.push(Band {
            x,
            y,
            width,
            height,
            color,
        });
    }
    fn page(&mut self, table: bool) {
        let first = self.pages.is_empty();
        self.pages.push(Page::default());
        self.band(LEFT, 29.0, RIGHT - LEFT, 3.0, ACCENT);
        self.y = 51.0;
        let start = if self.logo { 118.0 } else { LEFT };
        for line in wrap(&self.document.issuer_name, RIGHT - start, 12.0, true) {
            self.put(line, start, self.y, 12.0, true, INK);
            self.y += 16.0;
        }
        for (index, line) in self.document.issuer_lines.iter().enumerate() {
            if !first && index > 0 {
                break;
            }
            for line in wrap(line, RIGHT - start, 8.0, false) {
                self.put(line, start, self.y, 8.0, false, MUTED);
                self.y += 11.0;
            }
        }
        self.y = self.y.max(if self.logo { 105.0 } else { 84.0 }) + 14.0;
        self.put("PEDIDO DE VENDA", LEFT, self.y, 8.0, true, ACCENT);
        self.y += 26.0;
        self.put(&self.document.number, LEFT, self.y, 22.0, true, INK);
        let status = format!(
            "{} · Revisão {}",
            self.document.status, self.document.revision
        );
        self.put(
            &status,
            RIGHT - measure(&status, 9.0, false),
            self.y - 4.0,
            9.0,
            false,
            MUTED,
        );
        self.y += 24.0;
        if table {
            self.table_header();
        }
    }
    fn ensure(&mut self, height: f32, table: bool) {
        if self.y + height > BOTTOM {
            self.page(table);
        }
    }
    fn heading(&mut self, title: &str) {
        self.ensure(36.0, false);
        self.y += 8.0;
        self.put(title, LEFT, self.y, 10.0, true, ACCENT);
        self.y += 18.0;
    }
    fn paragraph(&mut self, value: &str, bold: bool) {
        for line in wrap(value, RIGHT - LEFT, 9.0, bold) {
            self.ensure(14.0, false);
            self.put(line, LEFT, self.y, 9.0, bold, INK);
            self.y += 13.0;
        }
    }
    fn table_header(&mut self) {
        self.band(LEFT, self.y - 12.0, RIGHT - LEFT, 25.0, INK);
        for (label, x) in [
            ("ITEM / DESCRIÇÃO", LEFT + 8.0),
            ("QTD.", 322.0),
            ("UNITÁRIO", 388.0),
            ("SUBTOTAL", 476.0),
        ] {
            self.put(label, x, self.y + 3.0, 8.0, true, [1.0; 3]);
        }
        self.y += 26.0;
    }
    fn items(&mut self) {
        self.ensure(65.0, false);
        self.table_header();
        for (index, item) in self.document.items.iter().enumerate() {
            let mut description = Vec::new();
            for (part, value) in item.description.iter().enumerate() {
                let value = if part == 0 {
                    format!("{:02} · {value}", index + 1)
                } else {
                    value.clone()
                };
                description.extend(
                    wrap(&value, 258.0, 9.0, part == 0)
                        .into_iter()
                        .map(|v| (v, part == 0)),
                );
            }
            let quantity = wrap(&item.quantity, 54.0, 9.0, false);
            let unit = wrap(&item.unit_price, 78.0, 9.0, false);
            let amount = wrap(&item.amount, 84.0, 9.0, true);
            let count = description
                .len()
                .max(quantity.len())
                .max(unit.len())
                .max(amount.len());
            let height = count as f32 * 13.0 + 16.0;
            if height < 500.0 {
                self.ensure(height, true);
            }
            for line in 0..count {
                self.ensure(22.0, true);
                if line == 0 {
                    self.y += 9.0;
                }
                if let Some((value, bold)) = description.get(line) {
                    self.put(value, LEFT + 8.0, self.y, 9.0, *bold, INK);
                }
                for (values, right, bold) in [
                    (&quantity, 373.0, false),
                    (&unit, 459.0, false),
                    (&amount, RIGHT - 8.0, true),
                ] {
                    if let Some(value) = values.get(line) {
                        self.put(
                            value,
                            right - measure(value, 9.0, bold),
                            self.y,
                            9.0,
                            bold,
                            INK,
                        );
                    }
                }
                self.y += 13.0;
            }
            self.y += 7.0;
            self.band(LEFT, self.y - 3.0, RIGHT - LEFT, 0.5, [0.85, 0.88, 0.90]);
        }
    }
    fn finish(mut self) -> Vec<Page> {
        self.page(false);
        self.heading("CLIENTE");
        for (index, line) in self.document.customer_lines.iter().enumerate() {
            self.paragraph(line, index == 0);
        }
        self.y += 12.0;
        self.items();
        self.ensure(84.0, false);
        self.y += 15.0;
        self.band(LEFT, self.y - 12.0, RIGHT - LEFT, 39.0, PALE);
        self.put(
            "TOTAL DO PEDIDO",
            LEFT + 12.0,
            self.y + 10.0,
            10.0,
            true,
            INK,
        );
        self.put(
            &self.document.total,
            RIGHT - 12.0 - measure(&self.document.total, 17.0, true),
            self.y + 11.0,
            17.0,
            true,
            INK,
        );
        self.y += 49.0;
        self.paragraph(
            &format!("Peso bruto total: {}", self.document.weight),
            false,
        );
        self.paragraph(
            &format!("Data prevista do pedido: {}", self.document.due),
            false,
        );
        for (title, value) in &self.document.sections {
            self.heading(title);
            self.paragraph(value, false);
        }
        let count = self.pages.len();
        for (index, page) in self.pages.iter_mut().enumerate() {
            page.bands.push(Band {
                x: LEFT,
                y: 800.0,
                width: RIGHT - LEFT,
                height: 0.6,
                color: [0.85, 0.88, 0.90],
            });
            page.texts.push(Text {
                value: format!(
                    "{} · Revisão {} · Documento comercial",
                    self.document.number, self.document.revision
                ),
                x: LEFT,
                y: 815.0,
                size: 7.0,
                bold: false,
                color: MUTED,
            });
            let value = format!("Página {} de {count}", index + 1);
            page.texts.push(Text {
                x: RIGHT - measure(&value, 7.0, false),
                value,
                y: 815.0,
                size: 7.0,
                bold: false,
                color: MUTED,
            });
        }
        self.pages
    }
}
fn deflate(bytes: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes)?;
    encoder.finish()
}
fn unicode_map(map: &BTreeMap<char, u16>) -> Vec<u8> {
    // ISO 32000 ToUnicode CMap (type 2), with at most 100 mappings per block.
    // Keep the dictionary minimal for older readers and independent extractors.
    let mut cmap = String::from(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /NotoUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
    );
    let entries = map.iter().collect::<Vec<_>>();
    for chunk in entries.chunks(100) {
        cmap.push_str(&format!("{} beginbfchar\n", chunk.len()));
        for (c, cid) in chunk {
            let mut encoded = [0_u16; 2];
            let unicode = c
                .encode_utf16(&mut encoded)
                .iter()
                .map(|part| format!("{part:04X}"))
                .collect::<String>();
            cmap.push_str(&format!("<{cid:04X}> <{unicode}>\n"));
        }
        cmap.push_str("endbfchar\n");
    }
    cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    cmap.into_bytes()
}
fn font(
    pdf: &mut Pdf,
    id: i32,
    bold: bool,
    chars: &BTreeSet<char>,
) -> Result<BTreeMap<char, u16>, std::io::Error> {
    let font = face(bold);
    let name = Name(if bold {
        b"NotoSans-Bold"
    } else {
        b"NotoSans-Regular"
    });
    let info = SystemInfo {
        registry: Str(b"Adobe"),
        ordering: Str(b"Identity"),
        supplement: 0,
    };
    let scale = 1000.0 / f32::from(font.units_per_em());
    let map: BTreeMap<char, u16> = chars
        .iter()
        .enumerate()
        .map(|(i, c)| (*c, (i + 1) as u16))
        .collect();
    let mut glyphs = vec![0_u8; (chars.len() + 1) * 2];
    let mut widths = vec![0.0];
    for (c, cid) in &map {
        let glyph = font.glyph_index(*c).unwrap_or(ttf_parser::GlyphId(0));
        glyphs[*cid as usize * 2..*cid as usize * 2 + 2].copy_from_slice(&glyph.0.to_be_bytes());
        widths.push(f32::from(font.glyph_hor_advance(glyph).unwrap_or(600)) * scale);
    }
    pdf.type0_font(Ref::new(id))
        .base_font(name)
        .encoding_predefined(Name(b"Identity-H"))
        .descendant_font(Ref::new(id + 1))
        .to_unicode(Ref::new(id + 3));
    let mut cid = pdf.cid_font(Ref::new(id + 1));
    cid.subtype(CidFontType::Type2)
        .base_font(name)
        .system_info(info)
        .font_descriptor(Ref::new(id + 2))
        .cid_to_gid_map_stream(Ref::new(id + 5));
    cid.widths().consecutive(0, widths);
    cid.finish();
    let bbox = font.global_bounding_box();
    pdf.font_descriptor(Ref::new(id + 2))
        .name(name)
        .flags(FontFlags::NON_SYMBOLIC)
        .bbox(Rect::new(
            f32::from(bbox.x_min) * scale,
            f32::from(bbox.y_min) * scale,
            f32::from(bbox.x_max) * scale,
            f32::from(bbox.y_max) * scale,
        ))
        .italic_angle(0.0)
        .ascent(f32::from(font.ascender()) * scale)
        .descent(f32::from(font.descender()) * scale)
        .cap_height(f32::from(font.capital_height().unwrap_or(700)) * scale)
        .stem_v(if bold { 120.0 } else { 80.0 })
        .font_file2(Ref::new(id + 4));
    pdf.stream(Ref::new(id + 3), &unicode_map(&map));
    let bytes = if bold { BOLD } else { REGULAR };
    pdf.stream(Ref::new(id + 4), &deflate(bytes)?)
        .filter(Filter::FlateDecode)
        .pair(Name(b"Length1"), bytes.len() as i32);
    pdf.stream(Ref::new(id + 5), &glyphs);
    Ok(map)
}
fn logo(raw: &str) -> Option<image::RgbImage> {
    let (header, encoded) = raw.split_once(',')?;
    if !matches!(
        header,
        "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
    ) || encoded.len() > 350_000
    {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    if bytes.len() > 256 * 1024 {
        return None;
    }
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    reader.limits(limits);
    let image = reader.decode().ok()?.into_rgba8();
    Some(image::RgbImage::from_fn(
        image.width(),
        image.height(),
        |x, y| {
            let pixel = image.get_pixel(x, y);
            let alpha = u16::from(pixel[3]);
            image::Rgb(
                [0, 1, 2]
                    .map(|i| ((u16::from(pixel[i]) * alpha + 255 * (255 - alpha)) / 255) as u8),
            )
        },
    ))
}
pub(super) fn render(document: &Document) -> Result<Vec<u8>, std::io::Error> {
    let logo = logo(&document.logo_data_url);
    let pages = Layout {
        document,
        pages: Vec::new(),
        y: 0.0,
        logo: logo.is_some(),
    }
    .finish();
    let mut pdf = Pdf::new();
    pdf.catalog(Ref::new(1))
        .pages(Ref::new(2))
        .lang(TextStr("pt-BR"));
    pdf.document_info(Ref::new(3))
        .title(TextStr(&format!(
            "Pedido {} · Revisão {}",
            document.number, document.revision
        )))
        .author(TextStr(&document.issuer_name))
        .creator(TextStr("ERP · Documento comercial"));
    let mut charsets = [BTreeSet::new(), BTreeSet::new()];
    for page in &pages {
        for text in &page.texts {
            charsets[usize::from(text.bold)].extend(text.value.chars());
        }
    }
    let regular = font(&mut pdf, 10, false, &charsets[0])?;
    let bold = font(&mut pdf, 20, true, &charsets[1])?;
    if let Some(image) = &logo {
        let bytes = deflate(image.as_raw())?;
        let mut object = pdf.image_xobject(Ref::new(30), &bytes);
        object.filter(Filter::FlateDecode);
        object
            .width(image.width() as i32)
            .height(image.height() as i32)
            .bits_per_component(8);
        object.color_space().device_rgb();
    }
    let ids = (0..pages.len())
        .map(|i| Ref::new(100 + i as i32 * 2))
        .collect::<Vec<_>>();
    pdf.pages(Ref::new(2))
        .kids(ids.iter().copied())
        .count(pages.len() as i32);
    for (index, page) in pages.iter().enumerate() {
        let mut object = pdf.page(ids[index]);
        object
            .parent(Ref::new(2))
            .media_box(Rect::new(0.0, 0.0, WIDTH, HEIGHT))
            .contents(Ref::new(101 + index as i32 * 2));
        let mut resources = object.resources();
        resources
            .fonts()
            .pair(Name(b"R"), Ref::new(10))
            .pair(Name(b"B"), Ref::new(20));
        if logo.is_some() {
            resources.x_objects().pair(Name(b"Logo"), Ref::new(30));
        }
        resources.finish();
        object.finish();
        let mut content = Content::new();
        for band in &page.bands {
            content.set_fill_rgb(band.color[0], band.color[1], band.color[2]);
            content.rect(
                band.x,
                HEIGHT - band.y - band.height,
                band.width,
                band.height,
            );
            content.fill_nonzero();
        }
        if let Some(image) = &logo {
            let scale = (60.0 / image.width() as f32).min(58.0 / image.height() as f32);
            let width = image.width() as f32 * scale;
            let height = image.height() as f32 * scale;
            content
                .save_state()
                .transform([width, 0.0, 0.0, height, LEFT, HEIGHT - 43.0 - height])
                .x_object(Name(b"Logo"))
                .restore_state();
        }
        for text in &page.texts {
            let map = if text.bold { &bold } else { &regular };
            let encoded = text
                .value
                .chars()
                .flat_map(|c| map[&c].to_be_bytes())
                .collect::<Vec<_>>();
            content
                .set_fill_rgb(text.color[0], text.color[1], text.color[2])
                .begin_text()
                .set_font(if text.bold { Name(b"B") } else { Name(b"R") }, text.size)
                .next_line(text.x, HEIGHT - text.y)
                .show(Str(&encoded))
                .end_text();
        }
        pdf.stream(
            Ref::new(101 + index as i32 * 2),
            &deflate(&content.finish())?,
        )
        .filter(Filter::FlateDecode);
    }
    Ok(pdf.finish())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(count: usize) -> Document {
        Document{issuer_name:"Ávila Equipamentos Ltda.".into(),issuer_lines:vec!["CNPJ: 00.000.000/0001-00".into(),"Rua da Indústria, 100 · São Paulo / SP · 01000-000".into(),"contato@example.test · (11) 3333-0000".into()],logo_data_url:String::new(),number:"PV-000004".into(),revision:3,status:"Rascunho".into(),due:"20/12/2026".into(),customer_lines:vec!["Academia São José · Confirmação".into(),"CPF/CNPJ: 000.000.000-00".into(),"Av. dos Ipês, 240 · Centro · São Paulo / SP".into(),"E-mail: compras@example.test · Telefone: (11) 99999-0000".into()],items:(0..count).map(|i|Item{description:vec![format!("Equipamento {} · Estação de musculação com proteção e regulagem",i+1),format!("Código: EQ-{:04}",i+1),"Estrutura: Azul petróleo · Estofado: Café · Tipo de anilheiro: Redondo".into()],quantity:"2 UN".into(),unit_price:"R$ 1.234,56".into(),amount:"R$ 2.469,12".into()}).collect(),total:"R$ 14.814,72".into(),weight:"1.263,5 kg".into(),sections:vec![("Pagamento previsto".into(),"Entrada prevista: R$ 70,01 · Pix · Na confirmação do pedido\nParcela 1: R$ 15,00 · Boleto · 01/01/2027\nParcela 2: R$ 14,99 · Boleto · 01/02/2027\nCondições previstas; não comprovam recebimento.".into()),("Entrega".into(),"Prazo de fabricação: 45 dias após o recebimento da entrada. Entrega a combinar.".into()),("Observações".into(),"Conferir acesso e dimensões do local antes da entrega.".into())]}
    }
    #[test]
    fn creates_a_parseable_a4_pdf_with_embedded_unicode_text() {
        let bytes = render(&fixture(1)).unwrap();
        let pdf = lopdf::Document::load_mem(&bytes).expect("valid server-generated PDF");
        assert_eq!(pdf.get_pages().len(), 1);
        for page in pdf.get_pages().values() {
            let media = pdf
                .get_dictionary(*page)
                .unwrap()
                .get(b"MediaBox")
                .unwrap()
                .as_array()
                .unwrap();
            assert!((media[2].as_float().unwrap() - WIDTH).abs() < 0.01);
            assert!((media[3].as_float().unwrap() - HEIGHT).abs() < 0.01);
        }
        let text = pdf.extract_text(&[1]).unwrap();
        for expected in [
            "São José · Confirmação",
            "Ávila Equipamentos",
            "PV-000004",
            "Rascunho",
            "Revisão 3",
            "R$ 1.234,56",
            "R$ 2.469,12",
            "1.263,5 kg",
            "Parcela 2: R$ 14,99",
            "não comprovam recebimento",
        ] {
            assert!(text.contains(expected), "missing {expected}: {text}");
        }
        assert!(
            pdf.objects
                .values()
                .any(|object| object.as_dict().is_ok_and(|dict| dict.has(b"FontFile2")))
        );
        for forbidden in [
            "Custo",
            "Margem",
            "Comissão",
            "Alçada",
            "Reservado",
            "Quitado",
            "Entrada recebida",
        ] {
            assert!(!text.contains(forbidden), "leaked {forbidden}");
        }
    }
    #[test]
    fn multipage_repeats_identification_and_keeps_every_line_within_a4() {
        let mut document = fixture(36);
        document.items[3]
            .description
            .push("AÇÃOSUPERLONGASEMESPAÇOS".repeat(120));
        let pages = Layout {
            document: &document,
            pages: Vec::new(),
            y: 0.0,
            logo: false,
        }
        .finish();
        assert!(pages.len() > 3);
        for page in &pages {
            for text in &page.texts {
                assert!(text.x >= LEFT - 0.1, "left clipping: {}", text.value);
                assert!(
                    text.x + measure(&text.value, text.size, text.bold) <= RIGHT + 0.2,
                    "right clipping: {}",
                    text.value
                );
                assert!(
                    (40.0..=815.1).contains(&text.y),
                    "vertical clipping: {}",
                    text.value
                );
            }
        }
        let bytes = render(&document).unwrap();
        let parsed = lopdf::Document::load_mem(&bytes).unwrap();
        assert_eq!(parsed.get_pages().len(), pages.len());
        for number in parsed.get_pages().keys() {
            let text = parsed.extract_text(&[*number]).unwrap();
            for expected in ["Ávila", "PV-000004", "Página", "Revisão 3"] {
                assert!(text.contains(expected));
            }
        }
        let all = parsed
            .extract_text(&parsed.get_pages().keys().copied().collect::<Vec<_>>())
            .unwrap();
        assert!(all.contains("EQ-0036"));
        assert!(all.contains("Conferir acesso"));
    }
    #[test]
    fn item_separators_do_not_cross_following_row_first_line_ink() {
        let mut document = fixture(12);
        for item in &mut document.items {
            item.description[0] = "ÁÉÍÓÚ Çã · Equipamento com acabamento".into();
        }
        let pages = Layout {
            document: &document,
            pages: Vec::new(),
            y: 0.0,
            logo: true,
        }
        .finish();
        let mut checked = 0;
        for page in &pages {
            for text in page
                .texts
                .iter()
                .filter(|text| text.bold && text.value.contains(" · ÁÉÍÓÚ"))
            {
                let font = face(text.bold);
                let bounds = text
                    .value
                    .chars()
                    .filter_map(|character| {
                        font.glyph_index(character)
                            .and_then(|glyph| font.glyph_bounding_box(glyph))
                    })
                    .collect::<Vec<_>>();
                let scale = text.size / f32::from(font.units_per_em());
                let ink_top = text.y
                    - f32::from(bounds.iter().map(|bounds| bounds.y_max).max().unwrap()) * scale;
                let ink_bottom = text.y
                    - f32::from(bounds.iter().map(|bounds| bounds.y_min).min().unwrap()) * scale;
                for separator in page.bands.iter().filter(|band| band.height == 0.5) {
                    assert!(
                        separator.y + separator.height <= ink_top || separator.y >= ink_bottom,
                        "separator {}..{} intersects item ink {}..{}: {}",
                        separator.y,
                        separator.y + separator.height,
                        ink_top,
                        ink_bottom,
                        text.value
                    );
                }
                checked += 1;
            }
        }
        assert_eq!(checked, document.items.len());
    }
    #[test]
    fn embeds_only_bounded_registered_data_url_logos() {
        assert!(logo("https://example.test/logo.png").is_none());
        assert!(logo("file:///etc/passwd").is_none());
        assert!(logo("data:image/svg+xml;base64,PHN2Zz4=").is_none());
        let mut document = fixture(8);
        document.logo_data_url = fixture_logo();
        let bytes = render(&document).unwrap();
        let parsed = lopdf::Document::load_mem(&bytes).unwrap();
        let pages = parsed.get_pages();
        assert!(pages.len() > 1);
        assert_eq!(
            bytes
                .windows(b"/Resources".len())
                .filter(|part| *part == b"/Resources")
                .count(),
            pages.len(),
            "each page must have one resource dictionary"
        );
        for (number, page) in pages {
            let resources = parsed
                .get_dictionary(page)
                .unwrap()
                .get(b"Resources")
                .unwrap()
                .as_dict()
                .unwrap();
            let fonts = resources.get(b"Font").unwrap().as_dict().unwrap();
            for (name, expected) in [(b"R", 10), (b"B", 20)] {
                let font = fonts.get(name).unwrap().as_reference().unwrap();
                assert_eq!(font, (expected, 0));
                assert!(parsed.get_dictionary(font).unwrap().has(b"ToUnicode"));
            }
            let image = resources
                .get(b"XObject")
                .unwrap()
                .as_dict()
                .unwrap()
                .get(b"Logo")
                .unwrap()
                .as_reference()
                .unwrap();
            assert_eq!(image, (30, 0));
            assert_eq!(
                parsed
                    .get_object(image)
                    .unwrap()
                    .as_stream()
                    .unwrap()
                    .dict
                    .get(b"Subtype")
                    .unwrap()
                    .as_name()
                    .unwrap(),
                b"Image"
            );
            let text = parsed.extract_text(&[number]).unwrap();
            for expected in ["Ávila Equipamentos", "PV-000004", "Revisão 3", "Página"] {
                assert!(
                    text.contains(expected),
                    "missing {expected} on logo page {number}: {text}"
                );
            }
        }
        assert!(
            parsed
                .objects
                .values()
                .any(|object| object.as_stream().is_ok_and(|stream| stream
                    .dict
                    .get(b"Subtype")
                    .is_ok_and(|value| value.as_name().is_ok_and(|name| name == b"Image"))))
        );
    }
    fn fixture_logo() -> String {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            96,
            48,
            image::Rgb([8, 97, 110]),
        ))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes.get_ref())
        )
    }
    #[test]
    fn writes_synthetic_review_samples_when_requested() {
        let Ok(directory) = std::env::var("ERP_ORDER_PDF_SAMPLE_DIR") else {
            return;
        };
        std::fs::create_dir_all(&directory).unwrap();
        for (name, count) in [("pedido-PV-000004-r3.pdf", 6), ("pedido-longo.pdf", 36)] {
            std::fs::write(
                std::path::Path::new(&directory).join(name),
                render(&fixture(count)).unwrap(),
            )
            .unwrap();
        }
        let mut branded = fixture(8);
        branded.logo_data_url = fixture_logo();
        std::fs::write(
            std::path::Path::new(&directory).join("pedido-com-logo.pdf"),
            render(&branded).unwrap(),
        )
        .unwrap();
    }
}
