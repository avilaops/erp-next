import unittest
import json
import math
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import xml.etree.ElementTree as ET

spec = spec_from_file_location("bank_import", Path(__file__).with_name("import-bank-logos.py"))
bank_import = module_from_spec(spec)
spec.loader.exec_module(bank_import)


class StaticSvgTests(unittest.TestCase):
    def svg(self, content):
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">{content}</svg>'.encode()

    def test_derives_missing_viewbox_from_numeric_intrinsic_dimensions(self):
        for width, height in [("1500", "1500"), ("2500", "2500"), ("12.5", "2e2")]:
            with self.subTest(width=width, height=height):
                raw = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="10" height="10"/></svg>'.encode()
                root = ET.fromstring(bank_import.sanitize(raw))
                self.assertEqual(root.get("viewBox"), f"0 0 {width} {height}")

    def test_preserves_valid_existing_viewbox_without_using_root_dimensions(self):
        raw = b'<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" viewBox="-10.5, -20, 1500, 2500"/>'
        self.assertEqual(ET.fromstring(bank_import.sanitize(raw)).get("viewBox"), "-10.5, -20, 1500, 2500")

    def test_rejects_missing_viewbox_when_dimensions_are_not_positive_finite_numbers(self):
        for dimension in ["", "0", "-1", "NaN", "Infinity", "1e999", "100%", "28px", "12em", "auto", "1 2", "1,5"]:
            for attribute in ["width", "height"]:
                with self.subTest(dimension=dimension, attribute=attribute), self.assertRaises(ValueError):
                    dimensions = {"width": "2500", "height": "2500", attribute: dimension}
                    bank_import.sanitize(f'<svg xmlns="http://www.w3.org/2000/svg" width="{dimensions["width"]}" height="{dimensions["height"]}"/>'.encode())
        with self.assertRaises(ValueError):
            bank_import.sanitize(b'<svg xmlns="http://www.w3.org/2000/svg"/>')

    def test_rejects_invalid_existing_viewbox_instead_of_inventing_dimensions(self):
        for viewbox in ["", "0 0 0 10", "0 0 10 -1", "0 0 NaN 10", "0 0 1e999 10", "0 0 10px 10", "0 0 10", "0 0 10 10 20", "0,,0,10,10"]:
            with self.subTest(viewbox=viewbox), self.assertRaises(ValueError):
                bank_import.sanitize(f'<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="2500" viewBox="{viewbox}"/>'.encode())

    def test_all_served_assets_have_finite_viewbox_with_positive_bounds(self):
        root = bank_import.DEST
        manifest = json.loads((root / "source-manifest.json").read_text(encoding="utf-8"))
        for asset in manifest["assets"]:
            if not asset["file"]:
                continue
            with self.subTest(file=asset["file"]):
                svg = ET.fromstring((root / asset["file"]).read_bytes())
                self.assertIsNotNone(svg.get("viewBox"))
                bounds = [float(value) for value in svg.get("viewBox").replace(",", " ").split()]
                self.assertEqual(len(bounds), 4)
                self.assertTrue(all(math.isfinite(value) for value in bounds))
                self.assertGreater(bounds[2], 0)
                self.assertGreater(bounds[3], 0)

    def test_preserves_static_shapes_and_local_gradients(self):
        output = bank_import.sanitize(self.svg('<defs><linearGradient id="cor"><stop offset="0" /></linearGradient></defs><path fill="url(#cor)" d="M0 0h10v10z"/>'))
        self.assertIn(b'url(#cor)', output)
        self.assertIn(b'M0 0h10v10z', output)

    def test_rejects_active_elements_events_and_external_references(self):
        for content in ['<script>alert(1)</script>', '<rect onload="alert(1)"/>', '<foreignObject/>', '<image href="data:image/png;base64,abc"/>', '<use href="https://example.test/logo.svg#x"/>', '<path fill="url(https://example.test/a)"/>', '<style>@import "https://example.test/a";</style>', '<animate attributeName="href"/>']:
            with self.subTest(content=content), self.assertRaises(ValueError):
                bank_import.sanitize(self.svg(content))

    def test_rejects_entity_expansion_and_internal_doctype(self):
        with self.assertRaises(ValueError):
            bank_import.sanitize(b'<!DOCTYPE svg [<!ENTITY x "abc">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')

    def test_removes_editor_metadata_and_public_dtd(self):
        raw = b'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><metadata>Editor metadata</metadata><rect width="10" height="10"/></svg>'
        output = bank_import.sanitize(raw)
        self.assertNotIn(b'DOCTYPE', output)
        self.assertNotIn(b'metadata', output)
        self.assertIn(b'rect', output)


if __name__ == "__main__":
    unittest.main()
