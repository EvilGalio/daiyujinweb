/* Material weight calculator — SVG shape diagrams.
   One unified SHAPE_SPECS drives both input fields and SVG labels. */

const SHAPE_SPECS = {

  round_bar: {
    label: "Round Bar",
    dimensions: [
      { key: "diameter", label: "Diameter", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const da = activeDimensionKey === "diameter" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("round-bar", "Round bar: circle front face with Diameter and Length", `
        <path class="shape-body" d="M 85 62 L 230 62 C 258 62 258 158 230 158 L 85 158 C 58 158 58 62 85 62 Z"/>
        <ellipse class="shape-body" cx="85" cy="110" rx="28" ry="48"/>
        <ellipse class="shape-cut" cx="85" cy="110" rx="14" ry="24" opacity="0.18"/>

        <line class="shape-extension-line" x1="85" y1="160" x2="85" y2="190"/>
        <line class="shape-extension-line" x1="230" y1="160" x2="230" y2="190"/>
        ${dimLine(85, 184, 230, 184, "round-bar", la)}
        ${labelBg(134, 170, 48, 18)}<text class="shape-label" x="158" y="184" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="48" y1="62" x2="72" y2="62"/>
        <line class="shape-extension-line" x1="48" y1="158" x2="72" y2="158"/>
        ${dimLine(54, 62, 54, 158, "round-bar", da)}
        ${labelBg(14, 101, 70, 18)}<text class="shape-label" x="49" y="115" text-anchor="middle">Diameter</text>
      `);
    },
  },

  square_bar: {
    label: "Square Bar",
    dimensions: [
      { key: "side", label: "Side", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const sa = activeDimensionKey === "side" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("square-bar", "Square bar: square cross-section with Side and Length", `
        <rect class="shape-body" x="75" y="55" width="155" height="55" rx="2"/>
        <rect class="shape-body" x="90" y="70" width="155" height="55" rx="2"/>
        <line class="shape-body" x1="75" y1="55" x2="90" y2="70"/>
        <line class="shape-body" x1="75" y1="110" x2="90" y2="125"/>
        <line class="shape-body" x1="230" y1="55" x2="245" y2="70"/>
        <line class="shape-body" x1="230" y1="110" x2="245" y2="125"/>

        <line class="shape-extension-line" x1="75" y1="128" x2="75" y2="155"/>
        <line class="shape-extension-line" x1="230" y1="128" x2="230" y2="155"/>
        ${dimLine(75, 149, 230, 149, "square-bar", la)}
        ${labelBg(130, 135, 48, 18)}<text class="shape-label" x="154" y="149" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="68" y1="55" x2="68" y2="18"/>
        <line class="shape-extension-line" x1="75" y1="42" x2="76" y2="55"/>
        ${dimLine(68, 18, 68, 55, "square-bar", sa)}
        ${labelBg(20, 28, 40, 18)}<text class="shape-label" x="40" y="42" text-anchor="middle">Side</text>
      `);
    },
  },

  rectangular_bar: {
    label: "Rectangular Bar / Plate",
    dimensions: [
      { key: "width", label: "Width", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const wa = activeDimensionKey === "width" ? " shape-dim-active" : "";
      const ta = activeDimensionKey === "thickness" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("rect-bar", "Rectangular bar: Width across, Thickness vertical, Length horizontal", `
        <rect class="shape-body" x="65" y="48" width="165" height="42" rx="2"/>
        <rect class="shape-body" x="80" y="60" width="165" height="42" rx="2"/>
        <line class="shape-body" x1="65" y1="48" x2="80" y2="60"/>
        <line class="shape-body" x1="65" y1="90" x2="80" y2="102"/>
        <line class="shape-body" x1="230" y1="48" x2="245" y2="60"/>
        <line class="shape-body" x1="230" y1="90" x2="245" y2="102"/>

        <line class="shape-extension-line" x1="65" y1="105" x2="65" y2="132"/>
        <line class="shape-extension-line" x1="230" y1="105" x2="230" y2="132"/>
        ${dimLine(65, 126, 230, 126, "rect-bar", la)}
        ${labelBg(130, 112, 48, 18)}<text class="shape-label" x="154" y="126" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="58" y1="48" x2="58" y2="14"/>
        <line class="shape-extension-line" x1="65" y1="35" x2="65" y2="48"/>
        ${dimLine(57, 14, 57, 48, "rect-bar", ta)}
        ${labelBg(8, 24, 68, 18)}<text class="shape-label" x="42" y="38" text-anchor="middle">Thickness</text>

        <line class="shape-extension-line" x1="73" y1="42" x2="73" y2="5"/>
        <line class="shape-extension-line" x1="246" y1="42" x2="246" y2="5"/>
        ${dimLine(74, 5, 245, 5, "rect-bar", wa)}
        ${labelBg(140, -4, 44, 18)}<text class="shape-label" x="162" y="11" text-anchor="middle">Width</text>
      `);
    },
  },

  sheet: {
    label: "Sheet / Plate",
    dimensions: [
      { key: "length", label: "Length", unit: true },
      { key: "width", label: "Width", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const wa = activeDimensionKey === "width" ? " shape-dim-active" : "";
      const ta = activeDimensionKey === "thickness" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("sheet", "Sheet: flat slab with Length, Width, Thickness", `
        <rect class="shape-body" x="60" y="70" width="200" height="80" rx="2"/>
        <rect class="shape-body" x="72" y="62" width="200" height="80" rx="2"/>
        <line class="shape-body" x1="60" y1="70" x2="72" y2="62"/>
        <line class="shape-body" x1="260" y1="70" x2="272" y2="62"/>
        <line class="shape-body" x1="60" y1="150" x2="72" y2="142"/>
        <line class="shape-body" x1="260" y1="150" x2="272" y2="142"/>

        <line class="shape-extension-line" x1="60" y1="155" x2="60" y2="180"/>
        <line class="shape-extension-line" x1="260" y1="155" x2="260" y2="180"/>
        ${dimLine(60, 174, 260, 174, "sheet", la)}
        ${labelBg(140, 160, 48, 18)}<text class="shape-label" x="164" y="174" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="50" y1="70" x2="50" y2="12"/>
        <line class="shape-extension-line" x1="60" y1="58" x2="60" y2="70"/>
        ${dimLine(49, 12, 49, 70, "sheet", ta)}
        ${labelBg(0, 34, 68, 18)}<text class="shape-label" x="34" y="48" text-anchor="middle">Thickness</text>

        <line class="shape-extension-line" x1="72" y1="56" x2="72" y2="5"/>
        <line class="shape-extension-line" x1="273" y1="56" x2="273" y2="5"/>
        ${dimLine(73, 5, 272, 5, "sheet", wa)}
        ${labelBg(153, -4, 44, 18)}<text class="shape-label" x="175" y="11" text-anchor="middle">Width</text>
      `);
    },
  },

  round_tube: {
    label: "Round Tube / Pipe",
    dimensions: [
      { key: "outer_diameter", label: "Outer Diameter", unit: true },
      { key: "wall_thickness", label: "Wall Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const oa = activeDimensionKey === "outer_diameter" ? " shape-dim-active" : "";
      const wa = activeDimensionKey === "wall_thickness" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("round-tube", "Round tube: hollow cylinder, Outer Diameter, Wall Thickness, Length", `
        <path class="shape-body" d="M 85 62 L 230 62 C 258 62 258 158 230 158 L 85 158 C 58 158 58 62 85 62 Z"/>
        <ellipse class="shape-body" cx="85" cy="110" rx="28" ry="48"/>
        <ellipse class="shape-cut" cx="85" cy="110" rx="14" ry="24"/>

        <line class="shape-extension-line" x1="85" y1="160" x2="85" y2="190"/>
        <line class="shape-extension-line" x1="230" y1="160" x2="230" y2="190"/>
        ${dimLine(85, 184, 230, 184, "round-tube", la)}
        ${labelBg(134, 170, 48, 18)}<text class="shape-label" x="158" y="184" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="48" y1="62" x2="72" y2="62"/>
        <line class="shape-extension-line" x1="48" y1="158" x2="72" y2="158"/>
        ${dimLine(54, 62, 54, 158, "round-tube", oa)}
        ${labelBg(6, 101, 124, 18)}<text class="shape-label" x="68" y="115" text-anchor="middle">Outer Diameter</text>

        <line class="shape-extension-line" x1="96" y1="82" x2="96" y2="20"/>
        <line class="shape-extension-line" x1="110" y1="67" x2="110" y2="20"/>
        ${dimLine(96, 20, 110, 20, "round-tube", wa)}
        ${labelBg(118, 10, 100, 18)}<text class="shape-label" x="168" y="24" text-anchor="start">Wall Thickness</text>
      `);
    },
  },

  square_tube: {
    label: "Square Tube",
    dimensions: [
      { key: "outer_side", label: "Outer Side", unit: true },
      { key: "wall_thickness", label: "Wall Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const oa = activeDimensionKey === "outer_side" ? " shape-dim-active" : "";
      const wa = activeDimensionKey === "wall_thickness" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("square-tube", "Square tube: hollow square profile, Outer Side, Wall Thickness, Length", `
        <rect class="shape-body" x="75" y="50" width="155" height="55" rx="2"/>
        <rect class="shape-body" x="90" y="65" width="155" height="55" rx="2"/>
        <line class="shape-body" x1="75" y1="50" x2="90" y2="65"/>
        <line class="shape-body" x1="75" y1="105" x2="90" y2="120"/>
        <line class="shape-body" x1="230" y1="50" x2="245" y2="65"/>
        <line class="shape-body" x1="230" y1="105" x2="245" y2="120"/>
        <rect class="shape-cut" x="108" y="74" width="85" height="18" rx="1"/>

        <line class="shape-extension-line" x1="75" y1="123" x2="75" y2="152"/>
        <line class="shape-extension-line" x1="230" y1="123" x2="230" y2="152"/>
        ${dimLine(75, 146, 230, 146, "square-tube", la)}
        ${labelBg(130, 132, 48, 18)}<text class="shape-label" x="154" y="146" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="68" y1="50" x2="68" y2="15"/>
        <line class="shape-extension-line" x1="75" y1="37" x2="76" y2="50"/>
        ${dimLine(68, 15, 68, 50, "square-tube", oa)}
        ${labelBg(10, 25, 78, 18)}<text class="shape-label" x="49" y="39" text-anchor="middle">Outer Side</text>

        <line class="shape-extension-line" x1="108" y1="80" x2="140" y2="80"/>
        <line class="shape-extension-line" x1="108" y1="94" x2="140" y2="94"/>
        ${dimLine(135, 80, 135, 93, "square-tube", wa)}
        ${labelBg(145, 78, 100, 18)}<text class="shape-label" x="195" y="92" text-anchor="start">Wall Thickness</text>
      `);
    },
  },

  rectangular_tube: {
    label: "Rectangular Tube",
    dimensions: [
      { key: "outer_width", label: "Outer Width", unit: true },
      { key: "outer_height", label: "Outer Height", unit: true },
      { key: "wall_thickness", label: "Wall Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const owa = activeDimensionKey === "outer_width" ? " shape-dim-active" : "";
      const oha = activeDimensionKey === "outer_height" ? " shape-dim-active" : "";
      const wa = activeDimensionKey === "wall_thickness" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("rect-tube", "Rectangular tube: hollow rectangular profile", `
        <rect class="shape-body" x="65" y="40" width="170" height="45" rx="2"/>
        <rect class="shape-body" x="80" y="52" width="170" height="45" rx="2"/>
        <line class="shape-body" x1="65" y1="40" x2="80" y2="52"/>
        <line class="shape-body" x1="65" y1="85" x2="80" y2="97"/>
        <line class="shape-body" x1="235" y1="40" x2="250" y2="52"/>
        <line class="shape-body" x1="235" y1="85" x2="250" y2="97"/>
        <rect class="shape-cut" x="100" y="62" width="80" height="12" rx="1"/>

        <line class="shape-extension-line" x1="65" y1="100" x2="65" y2="128"/>
        <line class="shape-extension-line" x1="235" y1="100" x2="235" y2="128"/>
        ${dimLine(65, 122, 235, 122, "rect-tube", la)}
        ${labelBg(128, 108, 48, 18)}<text class="shape-label" x="152" y="122" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="55" y1="40" x2="55" y2="10"/>
        <line class="shape-extension-line" x1="65" y1="30" x2="65" y2="40"/>
        ${dimLine(54, 10, 54, 40, "rect-tube", oha)}
        ${labelBg(6, 18, 100, 18)}<text class="shape-label" x="56" y="32" text-anchor="middle">Outer Height</text>

        <line class="shape-extension-line" x1="80" y1="46" x2="80" y2="-4"/>
        <line class="shape-extension-line" x1="250" y1="46" x2="250" y2="-4"/>
        ${dimLine(81, -4, 249, -4, "rect-tube", owa)}
        ${labelBg(145, -14, 80, 18)}<text class="shape-label" x="185" y="0" text-anchor="middle">Outer Width</text>

        <line class="shape-extension-line" x1="100" y1="68" x2="130" y2="83"/>
        <line class="shape-extension-line" x1="100" y1="76" x2="142" y2="98"/>
        ${dimLine(132, 84, 143, 98, "rect-tube", wa)}
        ${labelBg(155, 88, 100, 18)}<text class="shape-label" x="205" y="102" text-anchor="start">Wall Thickness</text>
      `);
    },
  },

  hex_bar: {
    label: "Hex Bar",
    dimensions: [
      { key: "across_flats", label: "Across Flats", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const aa = activeDimensionKey === "across_flats" ? " shape-dim-active" : "";
      const la = activeDimensionKey === "length" ? " shape-dim-active" : "";
      return svg("hex-bar", "Hex bar: hexagonal cross-section, Across Flats and Length", `
        <polygon class="shape-body" points="55,110 75,82 108,68 142,82 158,110 142,138 108,152 75,138"/>
        <polygon class="shape-body" points="55,110 75,82 108,68 142,82 142,110 108,125 75,138 55,110" opacity="0.8"/>

        <line class="shape-extension-line" x1="55" y1="140" x2="55" y2="170"/>
        <line class="shape-extension-line" x1="142" y1="140" x2="142" y2="170"/>
        ${dimLine(55, 164, 142, 164, "hex-bar", la)}
        ${labelBg(76, 150, 48, 18)}<text class="shape-label" x="100" y="164" text-anchor="middle">Length</text>

        <line class="shape-extension-line" x1="75" y1="78" x2="75" y2="42"/>
        <line class="shape-extension-line" x1="142" y1="78" x2="142" y2="42"/>
        ${dimLine(75, 42, 142, 42, "hex-bar", aa)}
        ${labelBg(88, 30, 76, 18)}<text class="shape-label" x="126" y="44" text-anchor="middle">Across Flats</text>
      `);
    },
  },

  ring: {
    label: "Ring",
    dimensions: [
      { key: "outer_diameter", label: "Outer Diameter", unit: true },
      { key: "inner_diameter", label: "Inner Diameter", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const oa = activeDimensionKey === "outer_diameter" ? " shape-dim-active" : "";
      const ia = activeDimensionKey === "inner_diameter" ? " shape-dim-active" : "";
      const ta = activeDimensionKey === "thickness" ? " shape-dim-active" : "";
      return svg("ring", "Ring: washer-like shape, Outer Diameter, Inner Diameter, Thickness", `
        <ellipse class="shape-body" cx="160" cy="100" rx="55" ry="70"/>
        <ellipse class="shape-cut" cx="160" cy="100" rx="25" ry="32"/>

        <line class="shape-extension-line" x1="160" y1="30" x2="160" y2="12"/>
        <line class="shape-extension-line" x1="250" y1="80" x2="250" y2="12"/>
        ${dimLine(160, 12, 250, 12, "ring", ta)}
        ${labelBg(190, 2, 62, 18)}<text class="shape-label" x="221" y="16" text-anchor="middle">Thickness</text>

        <line class="shape-extension-line" x1="270" y1="50" x2="270" y2="70"/>
        <line class="shape-extension-line" x1="270" y1="130" x2="270" y2="150"/>
        ${dimLine(274, 70, 274, 130, "ring", oa)}
        ${labelBg(280, 94, 124, 18)}<text class="shape-label" x="342" y="108" text-anchor="start">Outer Diameter</text>

        <line class="shape-extension-line" x1="180" y1="65" x2="180" y2="158"/>
        <line class="shape-extension-line" x1="185" y1="67" x2="185" y2="158"/>
        ${dimLine(180, 164, 198, 164, "ring", ia)}
        ${labelBg(188, 175, 108, 18)}<text class="shape-label" x="242" y="189" text-anchor="start">Inner Diameter</text>
      `);
    },
  },

  disc: {
    label: "Disc / Circle",
    dimensions: [
      { key: "diameter", label: "Diameter", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const da = activeDimensionKey === "diameter" ? " shape-dim-active" : "";
      const ta = activeDimensionKey === "thickness" ? " shape-dim-active" : "";
      return svg("disc", "Disc: short cylinder, Diameter and Thickness", `
        <ellipse class="shape-body" cx="160" cy="105" rx="70" ry="30"/>
        <rect class="shape-body" x="90" y="105" width="140" height="40" rx="1"/>
        <ellipse class="shape-body" cx="160" cy="145" rx="70" ry="30"/>
        <ellipse class="shape-cut" cx="160" cy="104" rx="70" ry="30" opacity="0.25"/>

        <line class="shape-extension-line" x1="90" y1="155" x2="90" y2="180"/>
        <line class="shape-extension-line" x1="230" y1="155" x2="230" y2="180"/>
        ${dimLine(90, 174, 230, 174, "disc", da)}
        ${labelBg(138, 160, 62, 18)}<text class="shape-label" x="169" y="174" text-anchor="middle">Diameter</text>

        <line class="shape-extension-line" x1="30" y1="80" x2="30" y2="14"/>
        <line class="shape-extension-line" x1="30" y1="148" x2="30" y2="14"/>
        ${dimLine(34, 86, 34, 145, "disc", ta)}
        ${labelBg(0, 108, 68, 18)}<text class="shape-label" x="34" y="122" text-anchor="middle">Thickness</text>
      `);
    },
  },

};

/* ── shared SVG helpers ──────────────────────── */

function dimLine(x1, y1, x2, y2, shapeId, extraClass) {
  const mid = `url(#dimArrow-${shapeId})`;
  return `<line class="shape-dim-line${extraClass}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
    marker-start="${mid}" marker-end="${mid}"/>`;
}

function labelBg(x, y, w, h) {
  return `<rect class="shape-label-bg" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>`;
}

function svg(shapeId, title, body) {
  return `<svg class="shape-svg" viewBox="0 0 320 220" role="img"
    aria-label="${title}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="dimArrow-${shapeId}" viewBox="0 0 10 10" refX="5" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0066cc"/>
      </marker>
    </defs>
    ${body}
    <title>${title}</title>
  </svg>`;
}

/* ── public API ──────────────────────────────── */

function renderShapeDiagram(shapeId, activeDimensionKey = "") {
  const spec = SHAPE_SPECS[shapeId] || SHAPE_SPECS.round_bar;
  return spec.renderSvg({ activeDimensionKey });
}
