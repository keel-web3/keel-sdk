"""Regenerate the original geometric TTF fixture; no third-party font input.
Requires fonttools==4.61.1. Normal JavaScript tests use the checked-in JSON.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder([".notdef", "A"])
glyphs = {}
for name in [".notdef", "A"]:
    pen = TTGlyphPen(None)
    if name == "A":
        pen.moveTo((100, 0))
        pen.lineTo((500, 0))
        pen.lineTo((500, 700))
        pen.lineTo((100, 700))
        pen.closePath()
    glyphs[name] = pen.glyph()
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (600, 0) for name in glyphs})
font.setupHorizontalHeader(ascent=800, descent=-200)
font.setupCharacterMap({65: "A"})
font.setupNameTable({"familyName": "KEEL Acceptance Fixture", "styleName": "Regular", "uniqueFontIdentifier": "KEEL-Acceptance-1", "fullName": "KEEL Acceptance Fixture", "psName": "KEELAcceptanceFixture"})
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupPost()
font.setupMaxp()
font.font["head"].created = 0
font.font["head"].modified = 0
font.font.recalcTimestamp = False
output = io.BytesIO()
font.save(output)
data = output.getvalue()
Path(__file__).with_name("font.json").write_text(json.dumps({"description": "Original geometric fixture with an empty .notdef and a rectangle A glyph; no third-party font input.", "generator": "create-font.py with fonttools 4.61.1", "mediaType": "font/ttf", "sha256": hashlib.sha256(data).hexdigest(), "bytesBase64": base64.b64encode(data).decode()}, indent=2) + "\n")
