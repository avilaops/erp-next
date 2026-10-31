"""Promote preserved Ludus photos to the current catalogue. Dry-run by default.

DATABASE_URL and ERP_BOOTSTRAP_TENANT are environment-only. No images, customer
data or database errors are printed. Originals remain immutable in legacy_files.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import subprocess
import uuid
import warnings
from urllib.parse import unquote, urlsplit

from PIL import Image, ImageOps


def query(sql):
    database = urlsplit(os.environ["DATABASE_URL"])
    if database.scheme not in ("postgres", "postgresql") or not database.hostname or not database.username:
        raise ValueError("Invalid database connection")
    environment = dict(os.environ, PGHOST=database.hostname, PGPORT=str(database.port or 5432),
                       PGUSER=unquote(database.username), PGPASSWORD=unquote(database.password or ""),
                       PGDATABASE=unquote(database.path.lstrip("/")), PGCLIENTENCODING="UTF8")
    # Preserve libpq options such as sslmode from the approved connection URL.
    from urllib.parse import parse_qsl
    for key, value in parse_qsl(database.query):
        if key not in {"sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout"}:
            raise ValueError("Unsupported database connection option")
        environment["PG" + key.upper()] = value
    result = subprocess.run(
        ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, encoding="utf-8", capture_output=True,
        env=environment, timeout=180,
    )
    if result.returncode:
        raise RuntimeError("Database operation failed; transaction not confirmed")
    return result.stdout.strip()


def convert_photo(raw, expected_hash):
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("Original photo hash mismatch")
    if not raw or len(raw) > 10 * 1024 * 1024:
        raise ValueError("Original photo exceeds upload limit")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP"]) as source:
            if source.width * source.height > 40_000_000:
                raise ValueError("Original photo exceeds pixel limit")
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGBA")
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    background = Image.new("RGB", image.size, "white")
    background.paste(image, mask=image.getchannel("A"))
    for quality in (85, 65, 45, 30):
        output = io.BytesIO()
        background.save(output, format="JPEG", quality=quality, optimize=True)
        photo = "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
        if len(photo) <= 349000 and len(output.getvalue()) <= 256 * 1024:
            return photo
    raise ValueError("Converted photo exceeds catalogue limit")


def capture(tenant):
    # The exact ID conversion is the one in deploy/import-legacy.sql. SKU/name
    # similarity is deliberately never used as an alternative association.
    sql = f"""
    BEGIN READ ONLY;
    SET LOCAL app.tenant_id = '{tenant}';
    SELECT coalesce(json_agg(row_to_json(candidate) ORDER BY candidate.file_id),'[]')
    FROM (
      SELECT f.id AS file_id, f.sha256, replace(encode(f.content,'base64'), E'\\n','') AS content,
             md5('ludus:products:' || (h.details->>'product_id'))::uuid AS product_id,
             p.revision, coalesce(p.photo_data_url,'') <> '' AS has_photo
      FROM legacy_files f JOIN legacy_history h
        ON h.tenant_id=f.tenant_id AND h.id=f.history_id
      LEFT JOIN products p ON p.tenant_id=f.tenant_id
        AND p.id=md5('ludus:products:' || (h.details->>'product_id'))::uuid
      WHERE f.tenant_id='{tenant}' AND h.collection='product_photos'
    ) candidate;
    COMMIT;
    """
    return json.loads(query(sql))


def prepare(rows):
    prepared = []
    seen = set()
    report = {"sourcePhotos": len(rows), "alreadyHavePhoto": 0, "missingProduct": 0}
    for row in rows:
        product = str(uuid.UUID(row["product_id"]))
        if product in seen:
            raise ValueError("Ambiguous photo association")
        seen.add(product)
        if row["revision"] is None:
            report["missingProduct"] += 1
            continue
        if row["has_photo"]:
            report["alreadyHavePhoto"] += 1
            continue
        photo = convert_photo(base64.b64decode(row["content"], validate=True), row["sha256"])
        prepared.append({"product_id": product, "file_id": str(uuid.UUID(row["file_id"])),
                         "source_sha256": row["sha256"], "revision": row["revision"],
                         "photo": photo})
    report["ready"] = len(prepared)
    return prepared, report


def apply(tenant, rows):
    if not rows:
        return 0
    encoded = base64.b64encode(json.dumps(rows).encode()).decode("ascii")
    # Lock the same tenant row as the Rust write handlers. Revision + empty-photo
    # guards reject edits made after capture. Every image and audit row commits
    # together; any conflict aborts the complete batch.
    sql = f"""
    BEGIN;
    SET LOCAL lock_timeout='15s';
    SET LOCAL statement_timeout='120s';
    SET LOCAL app.tenant_id='{tenant}';
    SELECT id FROM tenants WHERE id='{tenant}' FOR UPDATE;
    DO $import$
    DECLARE item jsonb; affected integer;
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM tenants WHERE id='{tenant}') THEN
        RAISE EXCEPTION 'Tenant not found';
      END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(
        convert_from(decode('{encoded}','base64'),'UTF8')::jsonb)
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM legacy_files f JOIN legacy_history h
            ON h.tenant_id=f.tenant_id AND h.id=f.history_id
          WHERE f.tenant_id='{tenant}' AND f.id=(item->>'file_id')::uuid
            AND h.collection='product_photos'
            AND md5('ludus:products:' || (h.details->>'product_id'))::uuid=(item->>'product_id')::uuid
            AND f.sha256=item->>'source_sha256'
            AND encode(sha256(f.content),'hex')=f.sha256
        ) THEN RAISE EXCEPTION 'Source changed'; END IF;
        UPDATE products SET photo_data_url=item->>'photo', revision=revision+1, updated_at=now()
        WHERE tenant_id='{tenant}' AND id=(item->>'product_id')::uuid
          AND revision=(item->>'revision')::bigint AND coalesce(photo_data_url,'')='';
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Product changed'; END IF;
        INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details)
        VALUES ('{tenant}','product.photo.imported','product',item->>'product_id',
          jsonb_build_object('source','legacy_files','fileId',item->>'file_id',
            'sourceSha256',item->>'source_sha256','previousRevision',item->'revision',
            'photoSha256',encode(sha256(convert_to(item->>'photo','UTF8')),'hex')));
      END LOOP;
    END $import$;
    COMMIT;
    """
    query(sql)
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    tenant = str(uuid.UUID(os.environ["ERP_BOOTSTRAP_TENANT"]))
    prepared, report = prepare(capture(tenant))
    report["mode"] = "apply" if arguments.apply else "preview"
    report["imported"] = apply(tenant, prepared) if arguments.apply else 0
    if arguments.apply:
        remaining, after = prepare(capture(tenant))
        if remaining:
            raise RuntimeError("Import committed but post-import verification found pending photos")
        report["after"] = after
    print(json.dumps(report))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never expose SQL, database credentials, customer fields or image bytes.
        print(json.dumps({"failed": True, "errorType": type(error).__name__}))
        raise SystemExit(1)
