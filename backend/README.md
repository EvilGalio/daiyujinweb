# Daiyujin Precision Tools Backend

Phase -1 starts with a small Flask API and two service probes:

- `GET /api/health` verifies the API process is alive.
- `services/freight_importer.py` converts the freight workbook into normalized records.
- `services/step_analyzer.py` extracts serializable STEP metadata from the existing ReadStep logic.

Recommended explicit runtimes on this machine:

- `BACKEND_PYTHON`: Flask, SQLAlchemy, archive libraries, API, and worker coordinator.
- `OCC_PYTHON`: pythonocc-core CAD subprocesses only.

The two variables may point to the same environment, but the runtime roles must remain separate. Do not start Waitress with `OCC_PYTHON` unless it also intentionally serves as `BACKEND_PYTHON` and has the complete backend requirements installed.

For production, the paths are not selectable:

- `BACKEND_PYTHON` is
  `C:\daiyujin\daiyujinweb\.venv\Scripts\python.exe`.
- `OCC_PYTHON` is
  `C:\ProgramData\Daiyujin\Dependencies\occ\python.exe`.
- Quote jobs use `backend\data\quote_jobs.db` and
  `backend\uploads\quote-jobs`; production backup fails closed if either
  optional environment override points elsewhere.
- Backend packages are installed from exact `backend\requirements.lock`
  versions.

Historic Anaconda locations such as `D:\anaconda` are development-only. They
are not accepted by the production initializer, updater, archive setup, API,
or worker launchers.

## Daiyujin public-pilot bridge

The production Precision Tools API uses a loopback-only, server-to-server
handoff to the Daiyujin NextGen deployment:

```dotenv
NEXTGEN_API_BASE_URL=http://127.0.0.1:5400/api/v2
NEXTGEN_COMPANY_CODE=daiyujin
NEXTGEN_CUSTOMER_PORTAL_URL=https://portal.daiyujin.dpdns.org
NEXTGEN_LEGACY_HANDOFF_SECRET=
QUOTE_HANDOFF_SIGNING_SECRET=
ALLOWED_ORIGINS=https://mfg-solution.com,https://www.mfg-solution.com,https://gcnov.com,https://www.gcnov.com,https://gcindus.com,https://www.gcindus.com,https://daiyujin.dpdns.org
```

The bridge accepts only the reviewed `daiyujin` company, loopback API
endpoint, and `https://portal.daiyujin.dpdns.org` public Portal.
The company is bound by server-side deployment configuration and the bridge
credential; it is never derived from the WordPress `site` or theme and is not
sent as browser- or query-controlled metadata. The browser never receives the
legacy handoff secret, and its `site`, `return_url`, company, or file-reference
fields are not forwarded by the bridge. A CAD file reference is emitted only
when its UUID resolves to an actual server-created STEP/IGES object under an
approved upload root and the Quote carries the matching HMAC-signed upload receipt.
The receipt is a browser-visible capability, not the signing secret, and is
bound to one file UUID. `run-api.ps1` preserves an existing explicit
`ALLOWED_ORIGINS` list only when every entry is an exact HTTPS origin;
regex/wildcard, HTTP, localhost, credential-bearing, query, fragment, and path
origins fail closed.

## Phase 1A Quote Workflow

For a development checkout, run these from the project root with its virtual
environment:

```powershell
$backendPython = Join-Path $PWD ".venv\Scripts\python.exe"
& $backendPython backend\scripts\seed_data.py
& $backendPython backend\scripts\test_phase1a.py
& $backendPython backend\app.py
```

The quote calculator stores uploaded STEP files under `backend\uploads`, renders thumbnails under `backend\static\thumbnails`, and records estimate snapshots in `inquiries`.

Archive uploads support ZIP, 7Z, and RAR. The quote API scans every directory level in an archive for STEP and IGES files while ignoring nested archives. ZIP uses the Python standard library, 7Z uses `py7zr`, and compressed RAR extraction also requires `unrar`, `unar`, `7z`, or `bsdtar`. Put the extractor on the server `PATH` or set `RAR_EXTRACTION_TOOL` to its absolute path. Windows also checks the standard 7-Zip and WinRAR install paths.

## Asynchronous Archive Worker

Production uses only `C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env`. Run `backend\scripts\enable_archive_uploads.ps1` with `-Production -EnvironmentFile` to validate both Python runtimes and the RAR extractor, repair allowed extensions, and initialize `quote_jobs.db`; its updates preserve the protected ACL and atomically replace the external file. Repository-local `backend\.env` is available only through an explicit `-Development` launch.

`Initialize-PrecisionToolsFreshPc.ps1` is an empty-environment initializer, not
an upgrade or migration command. It is plan-only until the exact
`INITIALIZE_PRECISION_TOOLS_EMPTY_DATA` confirmation is supplied, and it
refuses an existing database, production environment file, or other runtime
data. Use it only with the reviewed private reference-data package on a new
deployment.

For an existing or legacy deployment, use the reviewed update,
protected-backup/restore, or one-time data migration workflow. Do not copy old
runtime data into a checkout and then run the fresh initializer.

Use these root launchers after setup:

- `run-api.ps1 -EnvironmentFile <fixed-production.env>` starts Waitress with `BACKEND_PYTHON`.
- `run-quote-worker.ps1 -EnvironmentFile <fixed-production.env>` supervises the worker coordinator and uses `OCC_PYTHON` only for killable CAD child processes.
- `Install-Quote-Worker-Task.ps1` first prints a plan. Re-run with
  `-RunAtStartupAsLocalService -Confirmation INSTALL_QUOTE_WORKER_TASK` from
  an elevated shell to register the production task. Removal has its own
  plan and exact `REMOVE_QUOTE_WORKER_TASK` confirmation.

Fresh-PC initialization leaves `QUOTE_ASYNC_ARCHIVES_ENABLED=0`. Enable it
only after the LocalService Quote Worker task and worker-health gate pass.

`Update-Company-PC.ps1` updates an existing company-PC deployment. Before its
pull, it invokes the installed
`C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-runtime\Invoke-PrecisionToolsProtectedBackup.ps1`,
passes the mandatory interactive operator SID, and writes the unified backup
only under the fixed protected ProgramData backup output. It never executes
the repository copy of `Backup-OrderPortal.ps1` directly. The updater also
pauses new asynchronous uploads and stops the API and worker before the
protected backup. The encrypted unified package includes `quote_jobs.db` plus
job storage; no plaintext quote database or customer upload is copied under
the public checkout. If a later pull changes the updater itself, the script
relaunches the pulled version automatically. It defaults
`QUOTE_ASYNC_ARCHIVES_ENABLED` to `0` when the setting is absent. Production
dependency installation consumes `backend\requirements.lock`.

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

For development, run these from the project root with the checkout virtual
environment:

```powershell
$backendPython = Join-Path $PWD ".venv\Scripts\python.exe"
& $backendPython backend\scripts\init_db.py
& $backendPython backend\scripts\seed_data.py
& $backendPython backend\scripts\import_freight_rates.py
& $backendPython backend\scripts\test_phase1b.py
& $backendPython backend\app.py
```

The freight calculator reads rates from SQLite at runtime. The Excel workbook is only used by the import script.

## Phase 1C Tolerance Workflow

Run the development tolerance smoke test from the project root with the
checkout virtual environment:

```powershell
$backendPython = Join-Path $PWD ".venv\Scripts\python.exe"
& $backendPython backend\scripts\test_phase1c.py
& $backendPython backend\app.py
```

The tolerance calculator is a public API service. It currently covers the MVP fit zones used by the site: `H`, `JS`, `f`, `g`, `h`, `k`, and `p`.
