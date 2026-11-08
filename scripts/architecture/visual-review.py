"""Build local review sheets from unmodified browser screenshots."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

directory = Path(__file__).resolve().parents[2] / "artifacts" / "ui-audit"
results = json.loads((directory / "captures.json").read_text(encoding="utf-8"))
prefix = "review"
if "--recent" in sys.argv:
    selected = json.loads((directory / "review-routes.json").read_text(encoding="utf-8"))
    results = [result for result in results if result["route"] in selected]
    prefix = "recent"
tiles = []
for result in results:
    for capture in result["captures"]:
        source = Image.open(directory / capture["file"]).convert("RGB")
        # Each vertical segment remains readable; no lower content is discarded.
        segment_height = round(source.width * 0.85) if capture["viewport"] == "desktop" else 1100
        for top in range(0, source.height, segment_height):
            segment = source.crop((0, top, source.width, min(source.height, top + segment_height)))
            segment.thumbnail((560, 710))
            tile = Image.new("RGB", (580, 760), "#e4e7ec")
            tile.paste(segment, (10, 45))
            draw = ImageDraw.Draw(tile)
            label = f'{result["route"]}\n{capture["viewport"]} | y={top}'
            draw.text((10, 6), label, fill="#172033")
            tiles.append(tile)

for index in range(0, len(tiles), 6):
    sheet = Image.new("RGB", (1740, 1520), "white")
    for offset, tile in enumerate(tiles[index:index + 6]):
        sheet.paste(tile, ((offset % 3) * 580, (offset // 3) * 760))
    sheet.save(directory / f"{prefix}-{index // 6 + 1:03}.jpg", quality=90)
print(json.dumps({"routes": len(results), "segments": len(tiles), "sheets": (len(tiles) + 5) // 6}))
