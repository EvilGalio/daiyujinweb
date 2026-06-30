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
backend/requirements.txt
*.ps1 / *.bat operational scripts
```

## Local runtime data

These folders are required by the backend at runtime, but their contents should
not be committed:

```text
backend/data/
backend/uploads/
backend/static/thumbnails/
backend/static/stl/
backend/.env
```

`backend/data/daiyujin.db` is the active local SQLite database. Do not replace
it through Git updates.

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

## Daily workflow

Development PC:

```powershell
.\Publish-Framework-Update.ps1 -Message "Describe the update"
```

Company PC:

```powershell
.\Update-Company-PC.ps1
```

Archive generated local files:

```powershell
.\Archive-Runtime-Generated-Files.ps1
```
