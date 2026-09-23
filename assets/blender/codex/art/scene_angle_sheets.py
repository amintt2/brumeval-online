"""Assemble the independent multi-angle scene review, without modifying renders."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent / 'previews' / 'angles'
GROUPS = {
    'house': ('Auberge — accès et contact au sol', ['entree', 'profil', 'sol']),
    'cliff': ('Falaise — huit points de vue', ['village', 'front-bas', 'gauche', 'droite', 'strates', 'remparts', 'silhouette', 'ensemble']),
    'cemetery': ('Cimetière — trois points de vue', ['frontal', 'tombes', 'chapelle']),
    'lair': ('Antre — trois points de vue', ['entree', 'gauche', 'colonnes']),
    'forest': ('Forêt — trois points de vue', ['sentier', 'racines', 'stele']),
    'cliff_back': ('Falaise — inspection arrière', ['arriere-gauche', 'arriere', 'arriere-droite']),
}

def font(size):
    return ImageFont.truetype('C:/Windows/Fonts/arial.ttf', size)

for group, (title, labels) in GROUPS.items():
    files = [HERE / f'{group}-{i:02d}-{name}.webp' for i, name in enumerate(labels, 9 if group == 'cliff_back' else 1)]
    if not all(path.exists() for path in files):
        continue
    rows = (len(files) + 1) // 2
    canvas = Image.new('RGB', (1440, 57 + rows * 495 + 9), '#101719')
    draw = ImageDraw.Draw(canvas)
    draw.text((24, 14), title, font=font(27), fill='#e1d7c5')
    for index, path in enumerate(files):
        image = Image.open(path).convert('RGB')
        image.thumbnail((700, 467), Image.Resampling.LANCZOS)
        x = 15 + (index % 2) * 720
        y = 57 + (index // 2) * 495
        canvas.paste(image, (x, y))
        draw.text((x + 8, y + 472), path.stem, font=font(18), fill='#d0c9bd')
    if len(files) % 2:
        note_y = 603 + max(0, rows - 2) * 495
        draw.text((744, note_y), 'Inspection des scènes à 960 × 640', font=font(24), fill='#e1d7c5')
        draw.text((744, note_y + 42), 'Cycles • 24 échantillons • débruitage', font=font(20), fill='#a6b0ad')
        draw.text((744, note_y + 80), 'Objectif : cohérence sous plusieurs angles,', font=font(20), fill='#a6b0ad')
        draw.text((744, note_y + 107), 'matières crédibles et profondeur dark fantasy.', font=font(20), fill='#a6b0ad')
    canvas.save(HERE / f'{group}-sheet.png')
