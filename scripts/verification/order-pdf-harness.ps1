param([string]$OutputDirectory = (Join-Path $env:TEMP 'erp-order-pdf-review'))
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$harness = Join-Path $env:TEMP 'erp-order-pdf-harness'
New-Item -ItemType Directory -Path $harness -Force | Out-Null
$renderer = (Join-Path $repository 'apps/api/src/domains/sales/order_document_pdf.rs').Replace('\','/')
@'
[package]
name = "order-pdf-harness"
version = "0.1.0"
edition = "2024"
[dependencies]
pdf-writer = "=0.15.0"
ttf-parser = { version = "=0.25.1", default-features = false, features = ["std"] }
flate2 = "1"
image = { version = "=0.25.10", default-features = false, features = ["png", "jpeg", "webp"] }
base64 = "=0.22.1"
[dev-dependencies]
lopdf = { version = "=0.38.0", default-features = false }
[lib]
path = "lib.rs"
'@ | Set-Content -LiteralPath (Join-Path $harness 'Cargo.toml')
"#[allow(dead_code)]`n#[path = `"$renderer`"]`nmod pdf;" | Set-Content -LiteralPath (Join-Path $harness 'lib.rs')
$priorOutput = $env:ERP_ORDER_PDF_SAMPLE_DIR
try {
    $env:ERP_ORDER_PDF_SAMPLE_DIR = [IO.Path]::GetFullPath($OutputDirectory)
    cargo test --manifest-path (Join-Path $harness 'Cargo.toml') -j 1 -- --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'PDF renderer tests failed' }
    Write-Output "Synthetic review PDFs: $env:ERP_ORDER_PDF_SAMPLE_DIR"
} finally { $env:ERP_ORDER_PDF_SAMPLE_DIR = $priorOutput }
