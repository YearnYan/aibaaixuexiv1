import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


source = Path(sys.argv[1])
output = Path(sys.argv[2])
files = sorted(source.glob("*.png"))
if not files:
    raise SystemExit("没有找到 PNG 页面")

columns = 4
thumb_width = 300
thumb_height = 424
label_height = 28
gap = 16
rows = math.ceil(len(files) / columns)
sheet = Image.new(
    "RGB",
    (
        columns * thumb_width + (columns + 1) * gap,
        rows * (thumb_height + label_height) + (rows + 1) * gap,
    ),
    "#dfe4de",
)
draw = ImageDraw.Draw(sheet)

for index, file in enumerate(files):
    image = Image.open(file).convert("RGB")
    thumbnail = ImageOps.contain(image, (thumb_width, thumb_height))
    column = index % columns
    row = index // columns
    x = gap + column * (thumb_width + gap)
    y = gap + row * (thumb_height + label_height + gap)
    canvas = Image.new("RGB", (thumb_width, thumb_height), "white")
    canvas.paste(
        thumbnail,
        ((thumb_width - thumbnail.width) // 2, (thumb_height - thumbnail.height) // 2),
    )
    sheet.paste(canvas, (x, y + label_height))
    draw.text((x + 4, y + 5), file.stem, fill="#18302b")

output.parent.mkdir(parents=True, exist_ok=True)
sheet.save(output, quality=92)
