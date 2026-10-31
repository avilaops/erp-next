import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
import uuid

from PIL import Image

spec = importlib.util.spec_from_file_location("photos", Path(__file__).with_name("import-legacy-photos.py"))
photos = importlib.util.module_from_spec(spec)
spec.loader.exec_module(photos)


def fixture():
    output = io.BytesIO()
    Image.new("RGBA", (1600, 800), (255, 0, 0, 128)).save(output, format="PNG")
    return output.getvalue()


class PhotoConversion(unittest.TestCase):
    def test_converts_alpha_to_jpeg_with_size_limit(self):
        raw = fixture()
        photo = photos.convert_photo(raw, hashlib.sha256(raw).hexdigest())
        image = Image.open(io.BytesIO(base64.b64decode(photo.split(",", 1)[1])))
        self.assertEqual(image.format, "JPEG")
        self.assertEqual(image.size, (1024, 512))
        self.assertLess(len(photo), 349000)

    def test_rejects_corrupt_hash_and_non_image(self):
        with self.assertRaises(ValueError):
            photos.convert_photo(fixture(), "0" * 64)
        raw = b"<svg/>"
        with self.assertRaises(Exception):
            photos.convert_photo(raw, hashlib.sha256(raw).hexdigest())


@unittest.skipUnless(os.environ.get("PHOTO_IMPORT_TEST_DATABASE_URL"), "Isolated database not configured")
class DatabaseImport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DATABASE_URL"] = os.environ["PHOTO_IMPORT_TEST_DATABASE_URL"]
        # A dedicated throwaway database is mandatory; never clear real tables.
        if photos.query("SELECT current_database();") != "photo_import_test":
            raise RuntimeError("Use the dedicated photo_import_test database")
        photos.query("""
        CREATE TABLE tenants(id uuid PRIMARY KEY);
        CREATE TABLE products(tenant_id uuid, id uuid, revision bigint DEFAULT 1,
          photo_data_url text, updated_at timestamptz DEFAULT now(), PRIMARY KEY(tenant_id,id));
        CREATE TABLE legacy_history(tenant_id uuid,id uuid,collection text,details jsonb);
        CREATE TABLE legacy_files(tenant_id uuid,id uuid,history_id uuid,content bytea,sha256 text);
        CREATE TABLE audit_log(tenant_id uuid,action text,entity_type text,entity_id text,details jsonb);
        """)

    def setUp(self):
        photos.query("TRUNCATE tenants,products,legacy_history,legacy_files,audit_log;")
        self.tenant = str(uuid.uuid4())
        self.other = str(uuid.uuid4())
        raw = fixture()
        encoded = base64.b64encode(raw).decode()
        digest = hashlib.sha256(raw).hexdigest()
        for tenant in (self.tenant, self.other):
            photos.query(f"""
            INSERT INTO tenants VALUES('{tenant}');
            INSERT INTO products(tenant_id,id) VALUES('{tenant}',md5('ludus:products:7')::uuid);
            INSERT INTO legacy_history VALUES('{tenant}','00000000-0000-0000-0000-000000000001',
              'product_photos','{{"product_id":7}}');
            INSERT INTO legacy_files VALUES('{tenant}','00000000-0000-0000-0000-000000000002',
              '00000000-0000-0000-0000-000000000001',decode('{encoded}','base64'),'{digest}');
            """)

    def test_import_is_idempotent_tenant_scoped_and_audited(self):
        rows, report = photos.prepare(photos.capture(self.tenant))
        self.assertEqual(report["ready"], 1)
        self.assertEqual(photos.apply(self.tenant, rows), 1)
        again, report = photos.prepare(photos.capture(self.tenant))
        self.assertEqual(again, [])
        self.assertEqual(report["alreadyHavePhoto"], 1)
        self.assertEqual(photos.query(f"SELECT count(*) FROM products WHERE tenant_id='{self.other}' AND photo_data_url IS NOT NULL;"), "0")
        self.assertEqual(photos.query("SELECT count(*) FROM audit_log;"), "1")
        self.assertEqual(photos.query(f"SELECT revision FROM products WHERE tenant_id='{self.tenant}';"), "2")

    def test_concurrent_photo_is_not_overwritten(self):
        rows, _ = photos.prepare(photos.capture(self.tenant))
        photos.query(f"UPDATE products SET photo_data_url='current-photo' WHERE tenant_id='{self.tenant}';")
        with self.assertRaises(RuntimeError):
            photos.apply(self.tenant, rows)
        self.assertEqual(photos.query(f"SELECT photo_data_url FROM products WHERE tenant_id='{self.tenant}';"), "current-photo")
        self.assertEqual(photos.query("SELECT count(*) FROM audit_log;"), "0")

    def test_conflict_rolls_back_preceding_update(self):
        rows, _ = photos.prepare(photos.capture(self.tenant))
        rows.append(dict(rows[0], product_id=str(uuid.uuid4())))
        with self.assertRaises(RuntimeError):
            photos.apply(self.tenant, rows)
        self.assertEqual(photos.query("SELECT count(*) FROM products WHERE photo_data_url IS NOT NULL;"), "0")
        self.assertEqual(photos.query("SELECT count(*) FROM audit_log;"), "0")


if __name__ == "__main__":
    unittest.main()
