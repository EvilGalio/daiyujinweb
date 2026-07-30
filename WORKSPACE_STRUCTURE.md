# Workspace Structure

This repository is a public GitHub Pages project plus a local Flask backend.

The organizing rule is:

- Public framework files stay in Git.
- Runtime data stays local.
- Private planning/source data stays under `_private/` and is ignored by Git.

## Public, Git-tracked framework

These files are safe to synchronize through GitHub:

```text
index.html
quote.html
freight.html
tolerance.html
material-standards.html
material-weight.html
css/
js/
assets/
daiyujin-tools/
backend/app.py
backend/services/
backend/scripts/
backend/requirements.lock
backend/requirements.txt
*.ps1 / *.bat operational scripts
```

Production dependency installation consumes the exact versions in
`backend/requirements.lock`. `backend/requirements.txt` is the human-maintained
development input and must not be used by a production install entrypoint.

## Local runtime data

These folders are required by the backend at runtime, but their contents should
not be committed:

```text
backend/data/
backend/uploads/
backend/static/thumbnails/
backend/static/stl/
backend/.env (development only)
```

`backend/data/daiyujin.db` is the active local SQLite database. Do not replace
it through Git updates.

Production does not read `backend/.env`. Its only environment file is the
protected
`C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\production.env`.

## Private local workspace

Private source files and generated archives live here:

```text
_private/docs/
_private/source_data/
_private/artifacts/
_private/runtime_archive/
```

Examples:

- PRDs and implementation guides: `_private/docs/planning/`
- freight workbooks: `_private/source_data/freight/`
- WordPress plugin zip packages: `_private/artifacts/wordpress/`
- archived upload/preview/STL files: `_private/runtime_archive/`

## Fresh empty deployment versus legacy data

`Initialize-PrecisionToolsFreshPc.ps1` is only for a new, empty production
checkout. Its default invocation is plan-only; the exact
`INITIALIZE_PRECISION_TOOLS_EMPTY_DATA` confirmation is required to mutate
state. It refuses to continue when the database, production environment, or
other runtime data already exists, and it materializes the reviewed private
reference-data package rather than copying runtime data from an older machine.

An existing or migrated company PC must use the reviewed update, protected
backup/restore, or one-time legacy migration workflow instead. Do not run the
fresh initializer over copied or restored data. `Update-Company-PC.ps1` updates
an existing deployment; it does not initialize an empty database and does not
serve as a general-purpose file copier.

Production runtime locations are fixed:

- Backend Python: `C:\daiyujin\daiyujinweb\.venv\Scripts\python.exe`
- OCC Python: `C:\ProgramData\Daiyujin\Dependencies\occ\python.exe`
- Quote jobs database:
  `C:\daiyujin\daiyujinweb\backend\data\quote_jobs.db`
- Quote job storage:
  `C:\daiyujin\daiyujinweb\backend\uploads\quote-jobs`
- Protected backup runtime:
  `C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-runtime`
- Protected backup output:
  `C:\ProgramData\Daiyujin\Companies\daiyujin-public-pilot\precision-tools\backup-output\order_portal`

Historic Anaconda paths, including `D:\anaconda`, are development-only and are
not accepted by the production launch or deployment scripts.

## Daily workflow

Development PC:

```powershell
.\Publish-Framework-Update.ps1 -Message "Describe the update"
```

Company PC:

```powershell
.\Update-Company-PC.ps1
```

Before pulling, the updater invokes
`Invoke-PrecisionToolsProtectedBackup.ps1` from the installed, hash-verified
ProgramData runtime. It passes the interactive operator SID and writes the
unified backup only to the fixed protected ProgramData output. Repository-local
`local_backups` remains limited to temporary tracked-code update patches. It
must never contain quote databases, uploaded customer files, or job storage;
those are included only inside the encrypted protected backup.

Archive generated local files:

```powershell
.\Archive-Runtime-Generated-Files.ps1
```
