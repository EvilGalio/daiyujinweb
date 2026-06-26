/* Material weight calculator — SVG shape diagrams (v2).
   Every shape: front cross-section + extrusion depth + anchored dimension lines + labels in viewBox. */

const SHAPE_SPECS = {

  /* ── round_bar ────────────────────────────── */
  round_bar: {
    label: "Round Bar",
    dimensions: [
      { key: "diameter", label: "Diameter", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const da = activeDimensionKey === "diameter";
      const la = activeDimensionKey === "length";
      return svg("round-bar", "Round bar: circular cross-section with Diameter and Length", `
        <!-- body: cylinder side + front face -->
        <path class="shape-body" d="M 72 60 L 220 60 C 248 60 248 160 220 160 L 72 160 C 45 160 45 60 72 60 Z"/>
        <ellipse class="shape-body" cx="72" cy="110" rx="28" ry="50"/>

        <!-- Length dim -->
        ${ext(72, 163, 72, 198)}
        ${ext(220, 163, 220, 198)}
        ${dim(72, 192, 220, 192, "round-bar", la)}
        ${labelBox(123, 178, 48, 18)}
        <text class="shape-label" x="147" y="192" text-anchor="middle">Length</text>

        <!-- Diameter dim -->
        ${ext(38, 60, 60, 60)}
        ${ext(38, 160, 60, 160)}
        ${dim(44, 60, 44, 160, "round-bar", da)}
        ${labelBox(8, 101, 74, 18)}
        <text class="shape-label" x="45" y="115" text-anchor="middle">Diameter</text>
      `);
    },
  },

  /* ── square_bar ────────────────────────────── */
  square_bar: {
    label: "Square Bar",
    dimensions: [
      { key: "side", label: "Side", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const sa = activeDimensionKey === "side";
      const la = activeDimensionKey === "length";
      return svg("square-bar", "Square bar: square front face with Side and Length", `
        <!-- body: front face + top face + connector edges -->
        <rect class="shape-body" x="62" y="56" width="60" height="60" rx="2"/>
        <rect class="shape-body" x="80" y="72" width="155" height="60" rx="2"/>
        <line class="shape-edge" x1="62" y1="56" x2="80" y2="72"/>
        <line class="shape-edge" x1="62" y1="116" x2="80" y2="132"/>
        <line class="shape-edge" x1="122" y1="56" x2="140" y2="72"/>
        <line class="shape-edge" x1="122" y1="116" x2="140" y2="132"/>

        <!-- Length dim -->
        ${ext(62, 135, 62, 170)}
        ${ext(235, 135, 235, 170)}
        ${dim(62, 164, 235, 164, "square-bar", la)}
        ${labelBox(125, 150, 48, 18)}
        <text class="shape-label" x="149" y="164" text-anchor="middle">Length</text>

        <!-- Side dim (full front face height) -->
        ${ext(50, 56, 50, 24)}
        ${ext(50, 116, 50, 24)}
        ${dim(56, 56, 56, 116, "square-bar", sa)}
        ${labelBox(10, 78, 40, 18)}
        <text class="shape-label" x="30" y="92" text-anchor="middle">Side</text>
      `);
    },
  },

  /* ── rectangular_bar ───────────────────────── */
  rectangular_bar: {
    label: "Rectangular Bar / Plate",
    dimensions: [
      { key: "width", label: "Width", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const wa = activeDimensionKey === "width";
      const ta = activeDimensionKey === "thickness";
      const la = activeDimensionKey === "length";
      return svg("rect-bar", "Rectangular bar: Width across front, Thickness vertical, Length extrusion", `
        <!-- body -->
        <rect class="shape-body" x="58" y="68" width="56" height="36" rx="2"/>
        <rect class="shape-body" x="76" y="82" width="155" height="36" rx="2"/>
        <line class="shape-edge" x1="58" y1="68" x2="76" y2="82"/>
        <line class="shape-edge" x1="58" y1="104" x2="76" y2="118"/>
        <line class="shape-edge" x1="114" y1="68" x2="132" y2="82"/>
        <line class="shape-edge" x1="114" y1="104" x2="132" y2="118"/>

        <!-- Length dim -->
        ${ext(58, 121, 58, 156)}
        ${ext(231, 121, 231, 156)}
        ${dim(58, 150, 231, 150, "rect-bar", la)}
        ${labelBox(121, 136, 48, 18)}
        <text class="shape-label" x="145" y="150" text-anchor="middle">Length</text>

        <!-- Thickness dim (front face vertical) -->
        ${ext(46, 68, 46, 30)}
        ${ext(46, 104, 46, 30)}
        ${dim(52, 68, 52, 104, "rect-bar", ta)}
        ${labelBox(10, 76, 72, 18)}
        <text class="shape-label" x="46" y="90" text-anchor="middle">Thickness</text>

        <!-- Width dim (front face horizontal, above) -->
        ${ext(58, 62, 58, 30)}
        ${ext(114, 62, 114, 30)}
        ${dim(60, 30, 112, 30, "rect-bar", wa)}
        ${labelBox(66, 16, 44, 18)}
        <text class="shape-label" x="88" y="30" text-anchor="middle">Width</text>
      `);
    },
  },

  /* ── sheet ─────────────────────────────────── */
  sheet: {
    label: "Sheet / Plate",
    dimensions: [
      { key: "length", label: "Length", unit: true },
      { key: "width", label: "Width", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const wa = activeDimensionKey === "width";
      const ta = activeDimensionKey === "thickness";
      const la = activeDimensionKey === "length";
      return svg("sheet", "Sheet: flat plate with Length, Width, and edge Thickness", `
        <!-- body: flat top face + side edge -->
        <rect class="shape-body" x="60" y="72" width="200" height="76" rx="2"/>
        <rect class="shape-body" x="72" y="64" width="200" height="8" rx="1"/>
        <line class="shape-edge" x1="60" y1="72" x2="72" y2="64"/>
        <line class="shape-edge" x1="260" y1="72" x2="272" y2="64"/>
        <line class="shape-edge" x1="60" y1="148" x2="72" y2="140"/>
        <line class="shape-edge" x1="260" y1="148" x2="272" y2="140"/>

        <!-- Length dim (horizontal, below) -->
        ${ext(60, 152, 60, 182)}
        ${ext(260, 152, 260, 182)}
        ${dim(60, 176, 260, 176, "sheet", la)}
        ${labelBox(136, 162, 48, 18)}
        <text class="shape-label" x="160" y="176" text-anchor="middle">Length</text>

        <!-- Width dim (horizontal, above top face) -->
        ${ext(72, 58, 72, 28)}
        ${ext(273, 58, 273, 28)}
        ${dim(74, 28, 271, 28, "sheet", wa)}
        ${labelBox(150, 14, 44, 18)}
        <text class="shape-label" x="172" y="28" text-anchor="middle">Width</text>

        <!-- Thickness dim (edge, vertical short) -->
        ${ext(40, 64, 56, 64)}
        ${ext(40, 72, 56, 72)}
        ${dim(50, 64, 50, 72, "sheet", ta)}
        ${labelBox(12, 54, 72, 18)}
        <text class="shape-label" x="48" y="68" text-anchor="middle">Thickness</text>
      `);
    },
  },

  /* ── round_tube ────────────────────────────── */
  round_tube: {
    label: "Round Tube / Pipe",
    dimensions: [
      { key: "outer_diameter", label: "Outer Diameter", unit: true },
      { key: "wall_thickness", label: "Wall Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const oa = activeDimensionKey === "outer_diameter";
      const wa = activeDimensionKey === "wall_thickness";
      const la = activeDimensionKey === "length";
      return svg("round-tube", "Round tube: hollow cylinder, Outer Diameter, Wall Thickness, Length", `
        <!-- body: side wall + front outer ellipse -->
        <path class="shape-body" d="M 72 60 L 220 60 C 248 60 248 160 220 160 L 72 160 C 45 160 45 60 72 60 Z"/>
        <ellipse class="shape-body" cx="72" cy="110" rx="28" ry="50"/>
        <!-- hollow inner ellipse -->
        <ellipse class="shape-cut" cx="72" cy="110" rx="14" ry="25"/>

        <!-- Length dim -->
        ${ext(72, 163, 72, 198)}
        ${ext(220, 163, 220, 198)}
        ${dim(72, 192, 220, 192, "round-tube", la)}
        ${labelBox(123, 178, 48, 18)}
        <text class="shape-label" x="147" y="192" text-anchor="middle">Length</text>

        <!-- Outer Diameter dim (left of front face) -->
        ${ext(38, 60, 60, 60)}
        ${ext(38, 160, 60, 160)}
        ${dim(44, 60, 44, 160, "round-tube", oa)}
        ${labelBox(8, 101, 122, 18)}
        <text class="shape-label" x="69" y="115" text-anchor="middle">Outer Diameter</text>

        <!-- Wall Thickness dim (short radial, front face) -->
        ${ext(86, 84, 96, 56)}
        ${ext(100, 81, 96, 56)}
        ${dim(95, 56, 108, 56, "round-tube", wa)}
        ${labelBox(118, 46, 98, 18)}
        <text class="shape-label" x="167" y="60" text-anchor="start">Wall Thickness</text>
      `);
    },
  },

  /* ── square_tube ───────────────────────────── */
  square_tube: {
    label: "Square Tube",
    dimensions: [
      { key: "outer_side", label: "Outer Side", unit: true },
      { key: "wall_thickness", label: "Wall Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const oa = activeDimensionKey === "outer_side";
      const wa = activeDimensionKey === "wall_thickness";
      const la = activeDimensionKey === "length";
      return svg("square-tube", "Square tube: hollow square profile, Outer Side, Wall Thickness, Length", `
        <!-- body: front outer + rear outer + connector edges -->
        <rect class="shape-body" x="58" y="52" width="64" height="64" rx="2"/>
        <rect class="shape-body" x="78" y="68" width="155" height="64" rx="2"/>
        <line class="shape-edge" x1="58" y1="52" x2="78" y2="68"/>
        <line class="shape-edge" x1="58" y1="116" x2="78" y2="132"/>
        <line class="shape-edge" x1="122" y1="52" x2="142" y2="68"/>
        <line class="shape-edge" x1="122" y1="116" x2="142" y2="132"/>
        <!-- hollow inner square on front face -->
        <rect class="shape-cut" x="76" y="70" width="28" height="28" rx="1"/>

        <!-- Length dim -->
        ${ext(58, 135, 58, 170)}
        ${ext(233, 135, 233, 170)}
        ${dim(58, 164, 233, 164, "square-tube", la)}
        ${labelBox(122, 150, 48, 18)}
        <text class="shape-label" x="146" y="164" text-anchor="middle">Length</text>

        <!-- Outer Side dim (full front face) -->
        ${ext(46, 52, 46, 24)}
        ${ext(46, 116, 46, 24)}
        ${dim(52, 52, 52, 116, "square-tube", oa)}
        ${labelBox(10, 76, 76, 18)}
        <text class="shape-label" x="48" y="90" text-anchor="middle">Outer Side</text>

        <!-- Wall Thickness dim (short, outer to inner) -->
        ${ext(76, 86, 108, 40)}
        ${ext(104, 84, 108, 40)}
        ${dim(107, 40, 119, 40, "square-tube", wa)}
        ${labelBox(128, 30, 98, 18)}
        <text class="shape-label" x="177" y="44" text-anchor="start">Wall Thickness</text>
      `);
    },
  },

  /* ── rectangular_tube ──────────────────────── */
  rectangular_tube: {
    label: "Rectangular Tube",
    dimensions: [
      { key: "outer_width", label: "Outer Width", unit: true },
      { key: "outer_height", label: "Outer Height", unit: true },
      { key: "wall_thickness", label: "Wall Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const owa = activeDimensionKey === "outer_width";
      const oha = activeDimensionKey === "outer_height";
      const wa = activeDimensionKey === "wall_thickness";
      const la = activeDimensionKey === "length";
      return svg("rect-tube", "Rectangular tube: hollow rectangular profile", `
        <!-- body: front outer + rear outer + connector edges -->
        <rect class="shape-body" x="54" y="60" width="54" height="44" rx="2"/>
        <rect class="shape-body" x="72" y="74" width="155" height="44" rx="2"/>
        <line class="shape-edge" x1="54" y1="60" x2="72" y2="74"/>
        <line class="shape-edge" x1="54" y1="104" x2="72" y2="118"/>
        <line class="shape-edge" x1="108" y1="60" x2="126" y2="74"/>
        <line class="shape-edge" x1="108" y1="104" x2="126" y2="118"/>
        <!-- hollow inner rectangle -->
        <rect class="shape-cut" x="70" y="76" width="18" height="14" rx="1"/>

        <!-- Length dim -->
        ${ext(54, 121, 54, 156)}
        ${ext(227, 121, 227, 156)}
        ${dim(54, 150, 227, 150, "rect-tube", la)}
        ${labelBox(117, 136, 48, 18)}
        <text class="shape-label" x="141" y="150" text-anchor="middle">Length</text>

        <!-- Outer Height dim (front face vertical) -->
        ${ext(42, 60, 42, 24)}
        ${ext(42, 104, 42, 24)}
        ${dim(48, 60, 48, 104, "rect-tube", oha)}
        ${labelBox(8, 72, 98, 18)}
        <text class="shape-label" x="57" y="86" text-anchor="middle">Outer Height</text>

        <!-- Outer Width dim (front face horizontal, above) -->
        ${ext(54, 54, 54, 24)}
        ${ext(108, 54, 108, 24)}
        ${dim(56, 24, 106, 24, "rect-tube", owa)}
        ${labelBox(60, 12, 84, 18)}
        <text class="shape-label" x="102" y="26" text-anchor="middle">Outer Width</text>

        <!-- Wall Thickness dim (short, outer to inner on front) -->
        ${ext(88, 80, 120, 54)}
        ${ext(88, 90, 120, 72)}
        ${dim(119, 56, 132, 70, "rect-tube", wa)}
        ${labelBox(140, 55, 98, 18)}
        <text class="shape-label" x="189" y="69" text-anchor="start">Wall Thickness</text>
      `);
    },
  },

  /* ── hex_bar ───────────────────────────────── */
  hex_bar: {
    label: "Hex Bar",
    dimensions: [
      { key: "across_flats", label: "Across Flats", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const aa = activeDimensionKey === "across_flats";
      const la = activeDimensionKey === "length";
      return svg("hex-bar", "Hex bar: hexagonal cross-section with Across Flats and Length", `
        <!-- body: front hex + rear hex + connector lines -->
        <polygon class="shape-body" points="70,110 86,86 112,78 136,86 150,110 136,134 112,142 86,134"/>
        <polygon class="shape-body" points="114,110 130,86 156,78 180,86 194,110 180,134 156,142 130,134"/>
        <line class="shape-edge" x1="70" y1="110" x2="114" y2="110"/>
        <line class="shape-edge" x1="86" y1="86" x2="130" y2="86"/>
        <line class="shape-edge" x1="150" y1="110" x2="194" y2="110"/>
        <line class="shape-edge" x1="136" y1="134" x2="180" y2="134"/>

        <!-- Length dim -->
        ${ext(70, 144, 70, 178)}
        ${ext(194, 144, 194, 178)}
        ${dim(70, 172, 194, 172, "hex-bar", la)}
        ${labelBox(110, 158, 48, 18)}
        <text class="shape-label" x="134" y="172" text-anchor="middle">Length</text>

        <!-- Across Flats dim (front hex top-to-bottom) -->
        ${ext(86, 82, 86, 44)}
        ${ext(136, 82, 136, 44)}
        ${dim(86, 44, 136, 44, "hex-bar", aa)}
        ${labelBox(68, 32, 92, 18)}
        <text class="shape-label" x="114" y="46" text-anchor="middle">Across Flats</text>
      `);
    },
  },

  /* ── ring ──────────────────────────────────── */
  ring: {
    label: "Ring",
    dimensions: [
      { key: "outer_diameter", label: "Outer Diameter", unit: true },
      { key: "inner_diameter", label: "Inner Diameter", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const oa = activeDimensionKey === "outer_diameter";
      const ia = activeDimensionKey === "inner_diameter";
      const ta = activeDimensionKey === "thickness";
      return svg("ring", "Ring: washer with Outer Diameter, Inner Diameter, and edge Thickness", `
        <!-- body: front view washer -->
        <ellipse class="shape-body" cx="140" cy="110" rx="58" ry="38"/>
        <ellipse class="shape-cut" cx="140" cy="110" rx="24" ry="16"/>
        <!-- side view thickness -->
        <rect class="shape-body" x="244" y="84" width="12" height="52" rx="1"/>

        <!-- Outer Diameter (horizontal across front) -->
        ${ext(82, 110, 82, 112)}
        ${ext(198, 110, 198, 112)}
        ${dim(82, 114, 198, 114, "ring", oa)}
        ${labelBox(112, 118, 116, 18)}
        <text class="shape-label" x="170" y="132" text-anchor="middle">Outer Diameter</text>

        <!-- Inner Diameter (horizontal across inner hole) -->
        ${ext(116, 106, 116, 142)}
        ${ext(164, 106, 164, 142)}
        ${dim(116, 144, 164, 144, "ring", ia)}
        ${labelBox(112, 148, 108, 18)}
        <text class="shape-label" x="166" y="162" text-anchor="middle">Inner Diameter</text>

        <!-- Thickness (vertical on side view) -->
        ${ext(260, 84, 260, 58)}
        ${ext(260, 136, 260, 58)}
        ${dim(260, 84, 260, 136, "ring", ta)}
        ${labelBox(258, 102, 50, 18)}
        <text class="shape-label" x="283" y="116" text-anchor="middle">Thickness</text>
      `);
    },
  },

  /* ── disc ──────────────────────────────────── */
  disc: {
    label: "Disc / Circle",
    dimensions: [
      { key: "diameter", label: "Diameter", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const da = activeDimensionKey === "diameter";
      const ta = activeDimensionKey === "thickness";
      return svg("disc", "Disc: short cylinder with Diameter and Thickness", `
        <!-- body: top ellipse + side wall + bottom arc -->
        <ellipse class="shape-body" cx="160" cy="104" rx="72" ry="30"/>
        <rect class="shape-body" x="88" y="104" width="144" height="42" rx="1"/>
        <path class="shape-body" d="M 88 104 C 88 134 88 158 160 158 C 232 158 232 134 232 104"/>

        <!-- Diameter dim (below) -->
        ${ext(88, 150, 88, 180)}
        ${ext(232, 150, 232, 180)}
        ${dim(88, 174, 232, 174, "disc", da)}
        ${labelBox(136, 160, 66, 18)}
        <text class="shape-label" x="169" y="174" text-anchor="middle">Diameter</text>

        <!-- Thickness dim (left side, short vertical) -->
        ${ext(82, 104, 74, 78)}
        ${ext(82, 146, 74, 78)}
        ${dim(74, 104, 74, 146, "disc", ta)}
        ${labelBox(30, 116, 68, 18)}
        <text class="shape-label" x="64" y="130" text-anchor="middle">Thickness</text>
      `);
    },
  },

};


/* ── shared SVG helpers ──────────────────────── */

function dim(x1, y1, x2, y2, shapeId, active) {
  const a = active ? " shape-dim-active" : "";
  const arrow = active
    ? `marker-start="url(#dimArrowActive-${shapeId})" marker-end="url(#dimArrowActive-${shapeId})"`
    : `marker-start="url(#dimArrow-${shapeId})" marker-end="url(#dimArrow-${shapeId})"`;
  return `<line class="shape-dim-line${a}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${arrow}/>`;
}

function ext(x1, y1, x2, y2) {
  return `<line class="shape-extension-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
}

function labelBox(x, y, w, h) {
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
      <marker id="dimArrowActive-${shapeId}" viewBox="0 0 10 10" refX="5" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0d8c4a"/>
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
