"""Builds the release files for Smart Rail Builder.

Usage: python3 tools/package.py   (run from the SmartRailBuilder/ folder)

Output, in releases/v<version>/ (version read from BP/manifest.json):
  SmartRailBuilder-v<X_Y_Z>-BehaviorPack.mcpack  - BP/ contents at the zip root
  SmartRailBuilder-v<X_Y_Z>-ResourcePack.mcpack  - RP/ contents at the zip root
  SmartRailBuilder-v<X_Y_Z>.mcaddon              - BP.mcpack + RP.mcpack (same layout as v1.0.0)

Only files a pack needs are included (manifest, icon, scripts, texts);
editor/OS junk is skipped. Entries are written in sorted order with a fixed
timestamp so rebuilding the same source gives byte-identical files.
"""
import io
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXED_TIME = (2026, 1, 1, 0, 0, 0)
SKIP = {".DS_Store", "Thumbs.db"}


def pack_bytes(folder):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        paths = []
        for dirpath, dirnames, filenames in os.walk(folder):
            dirnames.sort()
            for name in sorted(filenames):
                if name in SKIP or name.startswith("."):
                    continue
                full = os.path.join(dirpath, name)
                paths.append((os.path.relpath(full, folder).replace(os.sep, "/"), full))
        for arcname, full in sorted(paths):
            info = zipfile.ZipInfo(arcname, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(full, "rb") as f:
                z.writestr(info, f.read())
    return buf.getvalue()


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for arcname, data in entries:
            info = zipfile.ZipInfo(arcname, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)


def main():
    bp_dir, rp_dir = os.path.join(ROOT, "BP"), os.path.join(ROOT, "RP")
    version = json.load(open(os.path.join(bp_dir, "manifest.json")))["header"]["version"]
    tag = "_".join(map(str, version))
    out = os.path.join(ROOT, "releases", "v" + ".".join(map(str, version)))
    os.makedirs(out, exist_ok=True)

    bp, rp = pack_bytes(bp_dir), pack_bytes(rp_dir)
    files = {
        f"SmartRailBuilder-v{tag}-BehaviorPack.mcpack": bp,
        f"SmartRailBuilder-v{tag}-ResourcePack.mcpack": rp,
    }
    for name, data in files.items():
        with open(os.path.join(out, name), "wb") as f:
            f.write(data)
    addon = os.path.join(out, f"SmartRailBuilder-v{tag}.mcaddon")
    write_zip(addon, [("BP.mcpack", bp), ("RP.mcpack", rp)])
    for name in sorted(os.listdir(out)):
        print(os.path.join("releases", os.path.basename(out), name), os.path.getsize(os.path.join(out, name)), "bytes")


if __name__ == "__main__":
    main()
