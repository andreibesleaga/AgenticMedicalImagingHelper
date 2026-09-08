#!/usr/bin/env python3
"""Rebuild the SIME 2026 experiment inputs from the public NIH ChestX-ray14 archive.

Usage: python3 prepare-nih.py <path-to-NIH-archive.zip-or-extracted-dir> <out-dir>

The archive is the Kaggle/NIH "images-224" distribution (Data_Entry_2017.csv +
images-224/images-224/*.png). Patient/image selection is fixed in
nih-selection.json (E4 longitudinal cohort, E4L stratified longitudinal cohort,
E2 scalability pool) so runs are reproducible. Dataset: Wang et al., CVPR 2017
(ChestX-ray8/14), NIH Clinical Center.
"""
import json, os, shutil, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
sel = json.load(open(os.path.join(os.path.dirname(__file__), 'nih-selection.json')))
def get(name, dst):
    if zipfile.is_zipfile(src):
        with zipfile.ZipFile(src) as z, z.open('images-224/images-224/' + name) as f, open(dst, 'wb') as o:
            shutil.copyfileobj(f, o)
    else:
        shutil.copy(os.path.join(src, 'images-224', 'images-224', name), dst)
for p, v in sel['E4'].items():
    root = f'{out}/E4/{p}'
    for i, x in enumerate(v, 1):
        d = f'{root}/series_{i}'; os.makedirs(d, exist_ok=True); get(x['image'], f'{d}/{x["image"]}')
    age = v[0]['age'].lstrip('0').rstrip('Y'); sex = {'M': 'male', 'F': 'female'}[v[0]['sex']]
    open(f'{root}/patient_context.txt', 'w').write(
        f"Public, de-identified frontal chest radiographs (PA view) from the NIH ChestX-ray14 dataset, downsampled to 224x224 pixels. "
        f"Patient age at first study: {age} years; sex: {sex}. Each series folder is one imaging session, in chronological order (series_1 earliest). "
        f"No clinical history is available. Research use only.\n")
for p, v in sel['E4L'].items():
    root = f'{out}/E4L/{p}'; studies = v['studies']
    for i, x in enumerate(studies, 1):
        d = f'{root}/series_{i}'; os.makedirs(d, exist_ok=True); get(x['image'], f'{d}/{x["image"]}')
    age = studies[0]['age'].lstrip('0').rstrip('Y'); sex = {'M': 'male', 'F': 'female'}[studies[0]['sex']]
    open(f'{root}/patient_context.txt', 'w').write(
        f"Public, de-identified frontal chest radiographs (PA view) from the NIH ChestX-ray14 dataset, downsampled to 224x224 pixels. "
        f"Patient age at first study: {age} years; sex: {sex}. Each series folder is one imaging session, in chronological order (series_1 earliest). "
        f"No clinical history is available. Research use only.\n")
pool = [x['image'] for x in sel['E2']]
for s, n in [(1, 1), (2, 5), (3, 10), (4, 20)]:
    root = f'{out}/E2/S{s}x{n}'; k = 0
    for i in range(1, s + 1):
        d = f'{root}/series_{i}'; os.makedirs(d, exist_ok=True)
        for j in range(n):
            get(pool[k % len(pool)], f'{d}/img_{j+1:02d}_{pool[k % len(pool)]}'); k += 1
    open(f'{root}/patient_context.txt', 'w').write(
        "Operational stress test: public de-identified NIH ChestX-ray14 PA chest radiographs (224x224). Images are from different patients and carry no longitudinal relation. Research use only.\n")
print('prepared', out)
