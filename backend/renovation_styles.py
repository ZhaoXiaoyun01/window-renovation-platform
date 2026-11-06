"""Content identity for reusable material styles; display names are aliases."""
import hashlib
import json

PRESET_PRICES = {'ivory': 120, 'basalt': 180, 'concrete': 80, 'sand': 100, 'paint': 35}


def style_fingerprint(material, finish):
    kind = material.get('kind') or 'tile'
    values = [kind, material['color'].lower(), material['texture'], material.get('image') or '',
              float(material.get('pricePerM2') if material.get('pricePerM2') is not None else PRESET_PRICES.get(material['id'], 0))]
    if kind != 'paint':
        values.extend([float(finish['widthMm']), float(finish['heightMm']), finish['direction'], float(finish['groutMm']), finish['groutColor'].lower(), finish['alignment']])
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
