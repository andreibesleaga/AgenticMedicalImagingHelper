#!/usr/bin/env python3
"""Build the SIME-FULL inputs from the ORIGINAL NIH ChestX-ray14 images.

Usage: python3 prepare-nih-full.py <archives-dir> <out-dir> [E4 E4L20 E2 ...]

<archives-dir> holds the NIH Box archives images_001.tar.gz ... images_012.tar.gz
(https://nihcc.app.box.com/v/ChestXray-NIHCC). Only the archives that are present
are read; a cohort is written only if every one of its images was found.

Same patients and images as the SIME 2026 pack (../sime2026/nih-selection.json,
../sime2026/E4L20-patients.json). For every selected image two versions are
written from the SAME original file, so resolution is the only difference:

  <out>/r1024/<cohort>/...   the original 1024 x 1024 PNG, byte-for-byte
  <out>/r224/<cohort>/...    a 224 x 224 PNG made here with Pillow's LANCZOS filter

(The paper used a third-party 224-px copy whose resampling is undocumented; the
r224 tree replaces it with a documented one.)

A SHA-256 of every original is written to selection-hashes.json next to this
script, so anyone can check they hold the same files. Dataset: Wang et al., CVPR
2017 (ChestX-ray8/14), NIH Clinical Center. No restrictions on use; cite the
paper and acknowledge the NIH Clinical Center.
"""
import hashlib, io, json, os, sys, tarfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SEL = json.load(open(os.path.join(HERE, '..', 'sime2026', 'nih-selection.json')))
L20 = set(json.load(open(os.path.join(HERE, '..', 'sime2026', 'E4L20-patients.json'))))

src, out = sys.argv[1], sys.argv[2]
wanted_cohorts = sys.argv[3:] or ['E4', 'E4L20', 'E2']

def cohorts():
    c = {}
    c['E4'] = {p: [x for x in v] for p, v in SEL['E4'].items()}
    c['E4L20'] = {p: v['studies'] for p, v in SEL['E4L'].items() if p in L20}
    c['E2'] = [x['image'] for x in SEL['E2']]
    return c

C = cohorts()
need = set()
for k in wanted_cohorts:
    if k == 'E2': need.update(C['E2'])
    else: need.update(x['image'] for v in C[k].values() for x in v)

# Pull the needed originals out of whatever archives are present.
found = {}
for name in sorted(os.listdir(src)):
    if not (name.startswith('images_') and name.endswith('.tar.gz')): continue
    try:
        with tarfile.open(os.path.join(src, name), 'r|gz') as t:
            for m in t:
                base = os.path.basename(m.name)
                if base in need and base not in found:
                    found[base] = t.extractfile(m).read()
    except (tarfile.ReadError, EOFError, OSError) as e:
        print(f'warning: {name} unreadable or incomplete ({e}); using what was read', file=sys.stderr)
print(f'found {len(found)} of {len(need)} needed originals', file=sys.stderr)

def write(res, rel, data):
    dst = os.path.join(out, f'r{res}', rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if res == 1024:
        open(dst, 'wb').write(data)
    else:
        im = Image.open(io.BytesIO(data))
        im.resize((224, 224), Image.LANCZOS).save(dst, format='PNG')

def context(res, age, sex):
    size = '1024x1024 pixels (original NIH resolution)' if res == 1024 else \
           '224x224 pixels (downsampled from the NIH originals with a Lanczos filter)'
    return (f"Public, de-identified frontal chest radiographs (PA view) from the NIH ChestX-ray14 dataset, {size}. "
            f"Patient age at first study: {age} years; sex: {sex}. Each series folder is one imaging session, "
            f"in chronological order (series_1 earliest). No clinical history is available. Research use only.\n")

hashes, written = {}, []
for k in wanted_cohorts:
    if k == 'E2':
        if not all(n in found for n in C['E2']):
            print('skip E2: not all 80 originals present', file=sys.stderr); continue
        pool = C['E2']
        for res in (1024, 224):
            for s, n in [(1, 1), (2, 5), (3, 10), (4, 20)]:
                kk = 0
                for i in range(1, s + 1):
                    for j in range(n):
                        img = pool[kk % len(pool)]; kk += 1
                        write(res, f'E2/S{s}x{n}/series_{i}/img_{j+1:02d}_{img}', found[img])
                open(os.path.join(out, f'r{res}', f'E2/S{s}x{n}/patient_context.txt'), 'w').write(
                    f"Operational stress test: public de-identified NIH ChestX-ray14 PA chest radiographs "
                    f"({'1024x1024 originals' if res == 1024 else '224x224, Lanczos-downsampled from the originals'}). "
                    "Images are from different patients and carry no longitudinal relation. Research use only.\n")
        for n in pool: hashes[n] = hashlib.sha256(found[n]).hexdigest()
        written.append(k); continue
    group = C[k]
    if not all(x['image'] in found for v in group.values() for x in v):
        print(f'skip {k}: not all originals present', file=sys.stderr); continue
    for p, studies in group.items():
        age = studies[0]['age'].lstrip('0').rstrip('Y'); sex = {'M': 'male', 'F': 'female'}[studies[0]['sex']]
        for res in (1024, 224):
            for i, x in enumerate(studies, 1):
                write(res, f'{k}/{p}/series_{i}/{x["image"]}', found[x['image']])
            open(os.path.join(out, f'r{res}', k, p, 'patient_context.txt'), 'w').write(context(res, age, sex))
        for x in studies: hashes[x['image']] = hashlib.sha256(found[x['image']]).hexdigest()
    written.append(k)

# Hashes of the r224 files this script wrote (Pillow's PNG encoder is deterministic
# for a given Pillow version; the version is recorded so a mismatch can be explained).
import PIL
h224 = {}
for root, _, files in os.walk(os.path.join(out, 'r224')):
    for fn in files:
        if fn.endswith('.png'):
            h224[fn.split('_', 2)[-1] if fn.startswith('img_') else fn] = hashlib.sha256(open(os.path.join(root, fn), 'rb').read()).hexdigest()
hp224 = os.path.join(HERE, 'selection-hashes-r224.json')
old224 = json.load(open(hp224)) if os.path.exists(hp224) else {}
old224.update(h224)
old224['_pillow_version'] = PIL.__version__
json.dump(dict(sorted(old224.items())), open(hp224, 'w'), indent=1)

hp = os.path.join(HERE, 'selection-hashes.json')
old = json.load(open(hp)) if os.path.exists(hp) else {}
old.update(hashes)
json.dump(dict(sorted(old.items())), open(hp, 'w'), indent=1)
print('prepared cohorts:', ', '.join(written) or 'none', '->', out)
