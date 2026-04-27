#!/usr/bin/env python3
import glob
import json
import re
import sys
from datetime import datetime, timedelta
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def iso_to_dmy(iso):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(iso or ""))
    if not m:
        return None
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"


def dmy_from_cell_str(v):
    s = str(v or "").strip()
    if re.fullmatch(r"\d+(\.\d+)?", s):
        try:
            serial = float(s)
            base = datetime(1899, 12, 30)
            dt = base + timedelta(days=serial)
            return dt.strftime("%d/%m/%Y")
        except Exception:
            pass
    m = re.search(r"([0-3]?\d/[01]?\d/\d{2,4})", s)
    if m:
        d, mm, y = m.group(1).split("/")
        if len(y) == 2:
            y = "20" + y
        return f"{int(d):02d}/{int(mm):02d}/{y}"
    return None


def cargar_shared_strings(zf):
    out = []
    if "xl/sharedStrings.xml" not in zf.namelist():
        return out
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    for si in root.findall(NS + "si"):
        out.append("".join((t.text or "") for t in si.iter(NS + "t")))
    return out


def resolver_ws_datos_path(zf):
    if "xl/workbook.xml" not in zf.namelist() or "xl/_rels/workbook.xml.rels" not in zf.namelist():
        return None
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
    for s in wb.find(NS + "sheets"):
        if s.attrib.get("name", "").upper() == "DATOS":
            rid = s.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            tgt = rel_map.get(rid, "")
            if not tgt:
                return None
            if not tgt.startswith("worksheets/"):
                tgt = "worksheets/" + tgt.split("/")[-1]
            return "xl/" + tgt
    return None


def cell_text(c, shared):
    t = c.attrib.get("t")
    v = c.find(NS + "v")
    if t == "s" and v is not None and v.text is not None:
        i = int(v.text)
        return shared[i] if 0 <= i < len(shared) else ""
    if t == "inlineStr":
        isel = c.find(NS + "is")
        return "".join((x.text or "") for x in isel.iter(NS + "t")) if isel is not None else ""
    return v.text if v is not None and v.text is not None else ""


def main():
    fecha_iso = sys.argv[1] if len(sys.argv) > 1 else ""
    target_dmy = iso_to_dmy(fecha_iso)
    if not target_dmy:
        print(json.dumps({"error": "fecha inválida", "items": {}}, ensure_ascii=False))
        return

    items = {}
    for f in sorted(glob.glob("data/RETIRO*.xlsm")):
        try:
            with zipfile.ZipFile(f) as zf:
                shared = cargar_shared_strings(zf)
                ws_path = resolver_ws_datos_path(zf)
                if not ws_path or ws_path not in zf.namelist():
                    continue
                ws = ET.fromstring(zf.read(ws_path))

                # D1 fecha en DATOS
                fecha_raw = None
                for row in ws.iter(NS + "row"):
                    if int(row.attrib.get("r", "0")) != 1:
                        continue
                    for c in row.findall(NS + "c"):
                        if c.attrib.get("r", "").startswith("D"):
                            fecha_raw = cell_text(c, shared)
                            break
                    break
                fecha = dmy_from_cell_str(fecha_raw)
                if fecha != target_dmy:
                    continue

                # B=Identificación, D=Visceras Blancas
                for row in ws.iter(NS + "row"):
                    rnum = int(row.attrib.get("r", "0"))
                    if rnum < 3:
                        continue
                    pid = ""
                    vis = ""
                    for c in row.findall(NS + "c"):
                        ref = c.attrib.get("r", "")
                        if ref.startswith("B"):
                            pid = str(cell_text(c, shared) or "").strip()
                        elif ref.startswith("D"):
                            vis = str(cell_text(c, shared) or "").strip()
                    if not pid or not vis:
                        continue
                    if pid.endswith(".0"):
                        pid = pid[:-2]
                    items[pid] = vis
        except Exception:
            continue

    print(json.dumps({"fecha": fecha_iso, "items": items}, ensure_ascii=False))


if __name__ == "__main__":
    main()
