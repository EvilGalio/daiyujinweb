"""Quick smoke test for quote v2.2 changes."""
import json, urllib.request

BASE = "http://127.0.0.1:5000"

def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.loads(r.read())

def post(path, data):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def assert_ok(name, cond, detail=""):
    if cond:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}  {detail}")

print("1. Options")
opts = get("/api/public/quote/options")
grades = [g["grade"] for g in opts["tolerance_grades"]]
assert_ok("tolerance grades C/M/F", set(grades) == {"ISO2768-C", "ISO2768-M", "ISO2768-F"}, grades)

pp_ids = [p["id"] for p in opts["postprocess_groups"]]
assert_ok("Bead Blasting separate", "bead_blasting" in pp_ids)
assert_ok("Polishing separate", "polishing" in pp_ids)
assert_ok("No combined BB/Polishing", "Bead Blasting / Polishing" not in str(opts))

print("\n2. Point estimate")
payload = {
    "obb_dimensions_mm": "50x30x10",
    "material_category": "aluminum_alloy",
    "process": "CNC",
    "postprocess_group": "bead_blasting",
    "tolerance_grade": "ISO2768-M",
    "quantity": 10,
    "currency": "USD",
    "customer_email": "test@example.com",
}
r = post("/api/public/quote/calculate", payload)
assert_ok("has unit_estimate", "unit_estimate" in r, list(r.keys())[:8])
assert_ok("has total_estimate", "total_estimate" in r)
assert_ok("no unit_range in public", "unit_range" not in r)
assert_ok("no total_range in public", "total_range" not in r)
assert_ok("no formula in public", "formula" not in r)
assert_ok("no model_version in public", "pricing_model_version" not in json.dumps(r))

ue = r.get("unit_estimate", {})
assert_ok("unit_estimate is positive", ue.get("amount", 0) > 0, str(ue))
te = r.get("total_estimate", {})
assert_ok("total ~= unit * qty", abs(te.get("amount", 0) - ue.get("amount", 0) * 10) < 2, f"total={te.get('amount')}, unit*10={ue.get('amount',0)*10}")

# Test determinism
r2 = post("/api/public/quote/calculate", payload)
assert_ok("deterministic same day", r["unit_estimate"]["amount"] == r2["unit_estimate"]["amount"],
    f"{r['unit_estimate']['amount']} vs {r2['unit_estimate']['amount']}")

print("\n3. Tolerance effect")
for grade in ["ISO2768-C", "ISO2768-M", "ISO2768-F"]:
    payload["tolerance_grade"] = grade
    r = post("/api/public/quote/calculate", payload)
    print(f"  {grade}: unit = {r['unit_estimate']['display']}")

# Verify F > M >= C
payload["tolerance_grade"] = "ISO2768-C"; rc = post("/api/public/quote/calculate", payload)
payload["tolerance_grade"] = "ISO2768-M"; rm = post("/api/public/quote/calculate", payload)
payload["tolerance_grade"] = "ISO2768-F"; rf = post("/api/public/quote/calculate", payload)
assert_ok("ISO2768-F > ISO2768-M", rf["unit_estimate"]["amount"] >= rm["unit_estimate"]["amount"])
assert_ok("ISO2768-M >= ISO2768-C", rm["unit_estimate"]["amount"] >= rc["unit_estimate"]["amount"])

print("\n4. Backward compatibility")
payload["tolerance_grade"] = "GENERAL"
r = post("/api/public/quote/calculate", payload)
assert_ok("GENERAL maps to ISO2768-M", "ISO 2768-m" in json.dumps(r.get("selections", {})), str(r.get("selections", {})))

print("\n5. Split postprocess")
payload["tolerance_grade"] = "ISO2768-M"
payload["postprocess_group"] = "polishing"
rp = post("/api/public/quote/calculate", payload)
assert_ok("polishing works", rp["unit_estimate"]["amount"] > 0)
assert_ok("polishing shows correct label", "Polishing" in json.dumps(rp.get("selections", {})))

print("\nDone.")
