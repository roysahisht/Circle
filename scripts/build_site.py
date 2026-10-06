"""
Copies just the files the website needs into site/, and zips them into site.zip.
To update the live site by hand: run this, then in Netlify -> Deploys, drop site.zip in the
"Drag and drop" box. (Once connected to GitHub, Netlify runs this itself via netlify.toml.)

Run from the project folder:   python scripts/build_site.py
"""
import os
import shutil
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "site")
PUBLISH = ["index.html", "privacy.html", "terms.html", "legal.css", "css", "js", "data"]


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    for item in PUBLISH:
        src = os.path.join(ROOT, item)
        dst = os.path.join(OUT, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, files in os.walk(OUT) for f in files)
    print(f"site/ ready: {', '.join(PUBLISH)} ({total // 1024} KB)")

    # Forward-slash paths inside the zip: Windows' own zipper uses "\" which Netlify misreads.
    zip_path = os.path.join(ROOT, "site.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for d, _, files in os.walk(OUT):
            for f in files:
                full = os.path.join(d, f)
                z.write(full, os.path.relpath(full, OUT).replace(os.sep, "/"))
    print(f"site.zip ready to upload ({os.path.getsize(zip_path) // 1024} KB): {os.path.abspath(zip_path)}")


if __name__ == "__main__":
    main()
