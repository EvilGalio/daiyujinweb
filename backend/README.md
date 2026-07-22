# Daiyujin Precision Tools Backend

Phase -1 starts with a small Flask API and two service probes:

- `GET /api/health` verifies the API process is alive.
- `services/freight_importer.py` converts the freight workbook into normalized records.
- `services/step_analyzer.py` extracts serializable STEP metadata from the existing ReadStep logic.

Recommended explicit runtimes on this machine:

- `BACKEND_PYTHON`: Flask, SQLAlchemy, archive libraries, API, and worker coordinator.
- `OCC_PYTHON`: pythonocc-core CAD subprocesses only.

The two variables may point to the same environment, but the runtime roles must remain separate. Do not start Waitress with `OCC_PYTHON` unless it also intentionally serves as `BACKEND_PYTHON` and has the complete backend requirements installed.

## Phase 1A Quote Workflow

Run these from the project root with `D:\anaconda\python.exe`:

```powershell
& 'D:\anaconda\python.exe' backend\scripts\seed_data.py
& 'D:\anaconda\python.exe' backend\scripts\test_phase1a.py
& 'D:\anaconda\python.exe' backend\app.py
```

The quote calculator stores uploaded STEP files under `backend\uploads`, renders thumbnails under `backend\static\thumbnails`, and records estimate snapshots in `inquiries`.

Archive uploads support ZIP, 7Z, and RAR. The quote API scans every directory level in an archive for STEP and IGES files while ignoring nested archives. ZIP uses the Python standard library, 7Z uses `py7zr`, and compressed RAR extraction also requires `unrar`, `unar`, `7z`, or `bsdtar`. Put the extractor on the server `PATH` or set `RAR_EXTRACTION_TOOL` to its absolute path. Windows also checks the standard 7-Zip and WinRAR install paths.

## Asynchronous Archive Worker

Run `backend\scripts\enable_archive_uploads.ps1` once to install the complete backend requirements, validate both Python runtimes and the RAR extractor, repair allowed extensions, and initialize `quote_jobs.db`. The script writes explicit runtime paths and safe defaults to `backend\.env`.

Use these root launchers after setup:

- `run-api.ps1` starts Waitress with `BACKEND_PYTHON`.
- `run-quote-worker.ps1` supervises the worker coordinator and uses `OCC_PYTHON` only for killable CAD child processes.
- `Install-Quote-Worker-Task.ps1` registers a hidden current-user logon task with bounded restart settings. Use `-RunAtStartupAsLocalService` from an elevated shell when the worker must start before user logon.

`Update-Company-PC.ps1` performs these steps idempotently, pauses new asynchronous uploads, stops the API and worker for a consistent quote-job database plus storage snapshot, and keeps the latest seven backup packages by default. If a later pull changes the updater itself, the script relaunches the pulled version automatically. It defaults `QUOTE_ASYNC_ARCHIVES_ENABLED` to `0` when the setting is absent.

For the first migration from an older updater, pull once before using the new flag because the already-running PowerShell process cannot acquire parameters that did not exist when it started:

```powershell
git pull --ff-only
.\Update-Company-PC.ps1 -EnableAsyncArchives
```

After that first migration, run the updater directly; its pull-and-relaunch handoff applies future updater changes in the same operation. Enable the new route after the company-PC canary succeeds:

```powershell
.\Update-Company-PC.ps1 -EnableAsyncArchives
```

Route new archives back to the legacy upload behavior without deleting active jobs. Existing job status, cancel, and retry endpoints remain available while the worker drains accepted work:

```powershell
.\Update-Company-PC.ps1 -DisableAsyncArchives
```

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
