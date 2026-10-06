import re, zlib, sys

for f in sys.argv[1:]:
    data = open(f, 'rb').read()
    print('=' * 20, f, '=' * 20)
    texts = []
    for m in re.finditer(rb'stream\r?\n(.*?)endstream', data, re.S):
        s = m.group(1)
        try:
            d = zlib.decompress(s)
        except Exception:
            d = s
        for t in re.findall(rb'\((.*?)(?<!\\)\)\s*Tj', d, re.S):
            texts.append(t)
        for arr in re.findall(rb'\[(.*?)\]\s*TJ', d, re.S):
            parts = re.findall(rb'\((.*?)(?<!\\)\)', arr, re.S)
            texts.append(b' '.join(parts))
    out = b'\n'.join(texts)
    out = out.replace(b'\\(', b'(').replace(b'\\)', b')')
    print(out.decode('latin-1', 'replace')[:12000])
