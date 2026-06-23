# Daiyujin Precision Tools Backend

Phase -1 starts with a small Flask API and two service probes:

- `GET /api/health` verifies the API process is alive.
- `services/freight_importer.py` converts the freight workbook into normalized records.
- `services/step_analyzer.py` extracts serializable STEP metadata from the existing ReadStep logic.

Recommended local interpreters on this machine:

- Flask/openpyxl: `D:\anaconda\python.exe`
- pythonocc-core: `D:\anaconda\envs\occ\python.exe`

The final deployment should use one Python environment containing both the web stack and `pythonocc-core`.
