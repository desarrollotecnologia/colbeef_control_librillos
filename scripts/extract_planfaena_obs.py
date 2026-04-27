#!/usr/bin/env python3
import glob
import json
import re
import sys

import xlrd


def normalizar_fecha_iso_a_dmy(fecha_iso):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(fecha_iso or ""))
    if not m:
        return None
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"


def extraer_fecha_hoja(sh):
    for r in range(min(20, sh.nrows)):
        row = " ".join(
            str(sh.cell_value(r, c)).strip()
            for c in range(min(sh.ncols, 16))
            if str(sh.cell_value(r, c)).strip()
        )
        m = re.search(r"Fecha\s*:?\s*([0-3]?\d/[01]?\d/\d{2,4})", row, re.I)
        if m:
            return m.group(1)
    return None


def detectar_columnas(sh):
    id_col = None
    vis_col = None
    header_row = None
    for r in range(min(40, sh.nrows)):
        for c in range(sh.ncols):
            v = str(sh.cell_value(r, c)).strip().upper()
            if id_col is None and ("IDENTIFICACI" in v or "IDENTIFICACION" in v):
                id_col = c
            if vis_col is None and "VISCERAS" in v and "BLANC" in v:
                vis_col = c
        if id_col is not None and vis_col is not None:
            header_row = r
            break
    return id_col, vis_col, header_row


def main():
    fecha_iso = sys.argv[1] if len(sys.argv) > 1 else ""
    fecha_dmy = normalizar_fecha_iso_a_dmy(fecha_iso)
    if not fecha_dmy:
        print(json.dumps({"error": "fecha inválida", "items": {}}, ensure_ascii=False))
        return

    out = {}
    for f in sorted(glob.glob("data/PlanFaena*.xls")):
        try:
            wb = xlrd.open_workbook(f)
            sh = wb.sheet_by_index(0)
            fecha = extraer_fecha_hoja(sh)
            if fecha != fecha_dmy:
                continue
            id_col, vis_col, hr = detectar_columnas(sh)
            if hr is None:
                continue
            for r in range(hr + 1, sh.nrows):
                pid = str(sh.cell_value(r, id_col)).strip() if id_col is not None else ""
                vis = str(sh.cell_value(r, vis_col)).strip() if vis_col is not None else ""
                if pid.endswith(".0"):
                    pid = pid[:-2]
                if not pid or not vis:
                    continue
                out[pid] = vis
        except Exception:
            continue

    print(json.dumps({"fecha": fecha_iso, "items": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
