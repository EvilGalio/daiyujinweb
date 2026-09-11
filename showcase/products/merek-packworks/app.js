document.documentElement.classList.add("js");
const menu = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#navigation");
menu?.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  navigation.classList.toggle("open", open);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu?.getAttribute("aria-expanded") === "true") {
    menu.setAttribute("aria-expanded", "false"); navigation.classList.remove("open"); menu.focus();
  }
});
const form = document.querySelector("#line-form");
if (form) {
  const operation = form.elements.namedItem("operation");
  const selected = new URLSearchParams(location.search).get("machine");
  if (["e200", "s40", "link"].includes(selected)) operation.value = { e200: "form", s40: "seal", link: "transfer" }[selected];
  const result = document.querySelector("#line-result");
  let downloadText = "";
  form.addEventListener("input", () => { result.hidden = true; downloadText = ""; });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const [length, width, height, weight, rate] = ["length", "width", "height", "weight", "rate"].map((key) => Number(data[key]));
    const candidates = data.operation === "line" ? ["E200", "S40", "Link"] : [{form:"E200",seal:"S40",transfer:"Link"}[data.operation]];
    const findings = candidates.map((model) => {
      const limits = [];
      if (model === "E200") {
        if (length < 200 || length > 500 || width < 150 || width > 400 || height < 120 || height > 400) limits.push("Carton dimensions fall outside the E200 standard envelope.");
        if (data.style !== "regular") limits.push("The E200 offer is for dry regular-slotted cartons; this construction needs a separate solution.");
        if (rate > 12) limits.push("The target exceeds the E200 planning ceiling of 12 cases/min.");
      }
      if (model === "S40") {
        if (length < 200 || length > 600 || width < 150 || width > 500 || height < 120 || height > 500) limits.push("Carton dimensions fall outside the S40 standard envelope.");
        if (weight > 20) limits.push("Packed weight exceeds the S40 illustrative 20 kg limit.");
        if (rate > 20) limits.push("The target exceeds the S40 planning ceiling of 20 cases/min.");
        if (data.style === "soft") limits.push("A soft or uneven base needs a handling assessment before selecting S40.");
      }
      if (model === "Link") {
        if (width > 500) limits.push("The carton is wider than the Link 500 mm roller bed.");
        if (weight > 20) limits.push("Packed weight exceeds the Link illustrative 20 kg limit.");
        if (data.style === "soft") limits.push("Link requires a flat, dry carton base.");
      } else if (data.formats === "random") limits.push("Random mixed sizes do not suit this preset batch machine.");
      return { model, limits, text: limits.length ? "Needs a different scope" : "Candidate for a sample and layout review" };
    });
    const checks = ["Bring the smallest and largest carton samples, tape details and all format dimensions.", "Mark operator positions, blank storage and maintenance access on a floor sketch."];
    if (candidates.includes("S40")) checks.push("Observe the manual packing and feeding step; the operator influences the achievable rate.");
    if (candidates.includes("Link")) checks.push("Review transfer height, slope, end stops and case stability. Link has no powered accumulation or rated throughput.");
    if (data.formats === "frequent") checks.push("Include a timed changeover in the sample trial and prepare a format-setting record for each batch.");
    if (data.country === "Italy") checks.push("Installation coordination: discuss the Italian site directly with the Bologna team.");
    else if (data.country === "Other") checks.push("This country is outside the stated service area. Confirm project coverage before pursuing a machine quotation.");
    else checks.push("Installation coordination: confirm the integration partner, documentation language and site responsibilities in " + data.country + ".");
    const inputSummary = length + " × " + width + " × " + height + " mm; " + weight + " kg; target " + rate + " cases/min; site: " + data.country + ".";
    document.querySelector("#result-title").textContent = findings.some((item) => item.limits.length) ? "Review the limits first." : "A useful starting point.";
    document.querySelector("#result-inputs").textContent = inputSummary;
    const container = document.querySelector("#machine-results"); container.replaceChildren();
    for (const finding of findings) {
      const article = document.createElement("article"), title = document.createElement("h3"), p = document.createElement("p");
      title.textContent = finding.model + " — " + finding.text;
      p.textContent = finding.limits.length ? finding.limits.join(" ") : "The entered values are within this concept range. Carton behaviour, actual rate and site fit still require a trial and review.";
      article.append(title, p); container.append(article);
    }
    const list = document.querySelector("#checklist"); list.replaceChildren();
    for (const check of checks) { const li = document.createElement("li"); li.textContent = check; list.append(li); }
    downloadText = "MEREK PACKWORKS — LOCAL LINE ASSESSMENT\nFictional company / concept website. Nothing has been sent.\n\n" + inputSummary + "\nConstruction: " + data.style + "; formats: " + data.formats + "\n\n" + findings.map((f) => f.model + ": " + f.text + "\n" + (f.limits.join(" ") || "Within illustrative range; sample trial required.")).join("\n\n") + "\n\nPrepare:\n- " + checks.join("\n- ") + "\n\nNo quotation, certified performance or engineering approval. Data is held in this page only. This downloaded copy stays on your device.\n";
    result.hidden = false; result.focus();
  });
  document.querySelector("#edit").addEventListener("click", () => { result.hidden = true; operation.focus(); });
  document.querySelector("#clear").addEventListener("click", () => { form.reset(); operation.value = "line"; result.hidden = true; downloadText = ""; operation.focus(); });
  document.querySelector("#download").addEventListener("click", () => {
    if (!downloadText) return;
    const url = URL.createObjectURL(new Blob([downloadText], {type:"text/plain;charset=utf-8"}));
    const a = document.createElement("a"); a.href = url; a.download = "merek-line-assessment.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
