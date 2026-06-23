# Daiyujin Precision Tools Backend

Phase -1 starts with a small Flask API and two service probes:

- `GET /api/health` verifies the API process is alive.
- `services/freight_importer.py` converts the freight workbook into normalized records.
- `services/step_analyzer.py` extracts serializable STEP metadata from the existing ReadStep logic.

Recommended local interpreters on this machine:

- Flask/openpyxl: `D:\anaconda\python.exe`
- pythonocc-core: `D:\anaconda\envs\occ\python.exe`

The final deployment should use one Python environment containing both the web stack and `pythonocc-core`.

## Phase 1A Quote Workflow

Run these from the project root with `D:\anaconda\python.exe`:

```powershell
& 'D:\anaconda\python.exe' backend\scripts\seed_data.py
& 'D:\anaconda\python.exe' backend\scripts\test_phase1a.py
& 'D:\anaconda\python.exe' backend\app.py
```

The quote calculator stores uploaded STEP files under `backend\uploads`, renders thumbnails under `backend\static\thumbnails`, and records estimate snapshots in `inquiries`.

## Phase 1B Freight Workflow

Run these from the project root with `D:\anaconda\python.exe`:

```powershell
& 'D:\anaconda\python.exe' backend\scripts\init_db.py
& 'D:\anaconda\python.exe' backend\scripts\seed_data.py
& 'D:\anaconda\python.exe' backend\scripts\import_freight_rates.py
& 'D:\anaconda\python.exe' backend\scripts\test_phase1b.py
& 'D:\anaconda\python.exe' backend\app.py
```

The freight calculator reads rates from SQLite at runtime. The Excel workbook is only used by the import script.

## Phase 1C Tolerance Workflow

Run the tolerance smoke test from the project root with `D:\anaconda\python.exe`:

```powershell
& 'D:\anaconda\python.exe' backend\scripts\test_phase1c.py
& 'D:\anaconda\python.exe' backend\app.py
```

The tolerance calculator is a public API service. It currently covers the MVP fit zones used by the site: `H`, `JS`, `f`, `g`, `h`, `k`, and `p`.
