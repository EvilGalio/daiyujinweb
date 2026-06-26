/* Material weight calculator SVG diagrams.
   The drawings favor readable engineering-style cross sections over decorative 3D. */

const SHAPE_SPECS = {
  round_bar: {
    label: "Round Bar",
    dimensions: [
      { key: "diameter", label: "Diameter", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const da = activeDimensionKey === "diameter";
      const la = activeDimensionKey === "length";
      return svg("round-bar", "Round bar with Diameter and Length", `
        <path class="shape-body" d="M76 60 L226 60 C254 60 254 160 226 160 L76 160 C46 160 46 60 76 60 Z"/>
        <ellipse class="shape-body" cx="76" cy="110" rx="30" ry="50"/>

        ${ext(76, 164, 76, 196)}
        ${ext(226, 164, 226, 196)}
        ${dim(76, 190, 226, 190, "round-bar", la)}
        ${labelBox(127, 176, 50, 18)}
        <text class="shape-label" x="152" y="190" text-anchor="middle">Length</text>

        ${ext(42, 60, 64, 60)}
        ${ext(42, 160, 64, 160)}
        ${dim(48, 60, 48, 160, "round-bar", da)}
        ${labelBox(12, 101, 76, 18)}
        <text class="shape-label" x="50" y="115" text-anchor="middle">Diameter</text>
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
      const sa = activeDimensionKey === "side";
      const la = activeDimensionKey === "length";
      return svg("square-bar", "Square bar with Side and Length", `
        <polygon class="shape-body" points="124,56 240,72 240,136 124,120"/>
        <polygon class="shape-body" points="64,56 124,56 240,72 82,72"/>
        <polygon class="shape-body" points="64,120 124,120 240,136 82,136"/>
        <line class="shape-edge" x1="82" y1="72" x2="82" y2="136"/>
        <rect class="shape-body" x="64" y="56" width="60" height="64" rx="2"/>

        ${ext(64, 140, 64, 174)}
        ${ext(240, 140, 240, 174)}
        ${dim(64, 168, 240, 168, "square-bar", la)}
        ${labelBox(128, 154, 50, 18)}
        <text class="shape-label" x="153" y="168" text-anchor="middle">Length</text>

        ${ext(52, 56, 52, 120)}
        ${ext(52, 120, 52, 156)}
        ${dim(58, 56, 58, 120, "square-bar", sa)}
        ${labelBox(14, 78, 40, 18)}
        <text class="shape-label" x="34" y="92" text-anchor="middle">Side</text>
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
      const wa = activeDimensionKey === "width";
      const ta = activeDimensionKey === "thickness";
      const la = activeDimensionKey === "length";
      return svg("rect-bar", "Rectangular bar with Width, Thickness, and Length", `
        <polygon class="shape-body" points="130,72 240,86 240,122 130,108"/>
        <polygon class="shape-body" points="60,72 130,72 240,86 82,86"/>
        <polygon class="shape-body" points="60,108 130,108 240,122 82,122"/>
        <line class="shape-edge" x1="82" y1="86" x2="82" y2="122"/>
        <rect class="shape-body" x="60" y="72" width="70" height="36" rx="2"/>

        ${ext(60, 126, 60, 158)}
        ${ext(240, 126, 240, 158)}
        ${dim(60, 152, 240, 152, "rect-bar", la)}
        ${labelBox(126, 138, 50, 18)}
        <text class="shape-label" x="151" y="152" text-anchor="middle">Length</text>

        ${ext(48, 72, 48, 108)}
        ${ext(48, 108, 48, 136)}
        ${dim(54, 72, 54, 108, "rect-bar", ta)}
        ${labelBox(10, 79, 76, 18)}
        <text class="shape-label" x="48" y="93" text-anchor="middle">Thickness</text>

        ${ext(60, 66, 60, 34)}
        ${ext(130, 66, 130, 34)}
        ${dim(62, 34, 128, 34, "rect-bar", wa)}
        ${labelBox(74, 20, 44, 18)}
        <text class="shape-label" x="96" y="34" text-anchor="middle">Width</text>
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
      const la = activeDimensionKey === "length";
      const wa = activeDimensionKey === "width";
      const ta = activeDimensionKey === "thickness";
      return svg("sheet", "Sheet plate with Length, Width, and Thickness", `
        <polygon class="shape-body" points="62,120 252,120 276,82 86,82"/>
        <polygon class="shape-body" points="62,120 252,120 252,134 62,134"/>
        <polygon class="shape-body" points="252,120 276,82 276,96 252,134"/>
        <line class="shape-edge" x1="86" y1="82" x2="276" y2="82"/>

        ${ext(62, 138, 62, 170)}
        ${ext(252, 138, 252, 170)}
        ${dim(62, 164, 252, 164, "sheet", la)}
        ${labelBox(132, 150, 50, 18)}
        <text class="shape-label" x="157" y="164" text-anchor="middle">Length</text>

        ${ext(62, 120, 42, 112)}
        ${ext(86, 82, 66, 74)}
        ${dim(46, 112, 70, 74, "sheet", wa)}
        ${labelBox(70, 84, 44, 18)}
        <text class="shape-label" x="92" y="98" text-anchor="middle">Width</text>

        ${ext(46, 120, 60, 120)}
        ${ext(46, 134, 60, 134)}
        ${dim(52, 120, 52, 134, "sheet", ta)}
        ${labelBox(12, 140, 76, 18)}
        <text class="shape-label" x="50" y="154" text-anchor="middle">Thickness</text>
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
      const oa = activeDimensionKey === "outer_diameter";
      const wa = activeDimensionKey === "wall_thickness";
      const la = activeDimensionKey === "length";
      return svg("round-tube", "Round tube with Outer Diameter, Wall Thickness, and Length", `
        <path class="shape-body" d="M78 60 L226 60 C254 60 254 160 226 160 L78 160 C46 160 46 60 78 60 Z"/>
        <ellipse class="shape-body" cx="78" cy="110" rx="32" ry="50"/>
        <ellipse class="shape-cut" cx="78" cy="110" rx="16" ry="25"/>

        ${ext(78, 164, 78, 196)}
        ${ext(226, 164, 226, 196)}
        ${dim(78, 190, 226, 190, "round-tube", la)}
        ${labelBox(127, 176, 50, 18)}
        <text class="shape-label" x="152" y="190" text-anchor="middle">Length</text>

        ${ext(42, 60, 64, 60)}
        ${ext(42, 160, 64, 160)}
        ${dim(48, 60, 48, 160, "round-tube", oa)}
        ${labelBox(8, 101, 124, 18)}
        <text class="shape-label" x="70" y="115" text-anchor="middle">Outer Diameter</text>

        ${ext(78, 60, 116, 60)}
        ${ext(78, 85, 116, 85)}
        ${dim(116, 60, 116, 85, "round-tube", wa)}
        ${labelBox(128, 63, 102, 18)}
        <text class="shape-label" x="179" y="77" text-anchor="middle">Wall Thickness</text>
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
      const oa = activeDimensionKey === "outer_side";
      const wa = activeDimensionKey === "wall_thickness";
      const la = activeDimensionKey === "length";
      return svg("square-tube", "Square tube with Outer Side, Wall Thickness, and Length", `
        <polygon class="shape-body" points="126,56 238,72 238,140 126,124"/>
        <polygon class="shape-body" points="58,56 126,56 238,72 82,72"/>
        <polygon class="shape-body" points="58,124 126,124 238,140 82,140"/>
        <line class="shape-edge" x1="82" y1="72" x2="82" y2="140"/>
        <rect class="shape-body" x="58" y="56" width="68" height="68" rx="2"/>
        <rect class="shape-cut" x="78" y="76" width="28" height="28" rx="1"/>

        ${ext(58, 144, 58, 176)}
        ${ext(238, 144, 238, 176)}
        ${dim(58, 170, 238, 170, "square-tube", la)}
        ${labelBox(123, 156, 50, 18)}
        <text class="shape-label" x="148" y="170" text-anchor="middle">Length</text>

        ${ext(46, 56, 46, 124)}
        ${ext(46, 124, 46, 154)}
        ${dim(52, 56, 52, 124, "square-tube", oa)}
        ${labelBox(10, 82, 78, 18)}
        <text class="shape-label" x="49" y="96" text-anchor="middle">Outer Side</text>

        ${ext(106, 56, 146, 56)}
        ${ext(106, 76, 146, 76)}
        ${dim(146, 56, 146, 76, "square-tube", wa)}
        ${labelBox(158, 57, 104, 18)}
        <text class="shape-label" x="210" y="71" text-anchor="middle">Wall Thickness</text>
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
      const owa = activeDimensionKey === "outer_width";
      const oha = activeDimensionKey === "outer_height";
      const wa = activeDimensionKey === "wall_thickness";
      const la = activeDimensionKey === "length";
      return svg("rect-tube", "Rectangular tube with Outer Width, Outer Height, Wall Thickness, and Length", `
        <polygon class="shape-body" points="128,66 240,80 240,132 128,118"/>
        <polygon class="shape-body" points="54,66 128,66 240,80 78,80"/>
        <polygon class="shape-body" points="54,118 128,118 240,132 78,132"/>
        <line class="shape-edge" x1="78" y1="80" x2="78" y2="132"/>
        <rect class="shape-body" x="54" y="66" width="74" height="52" rx="2"/>
        <rect class="shape-cut" x="76" y="82" width="30" height="20" rx="1"/>

        ${ext(54, 136, 54, 168)}
        ${ext(240, 136, 240, 168)}
        ${dim(54, 162, 240, 162, "rect-tube", la)}
        ${labelBox(122, 148, 50, 18)}
        <text class="shape-label" x="147" y="162" text-anchor="middle">Length</text>

        ${ext(42, 66, 42, 118)}
        ${ext(42, 118, 42, 146)}
        ${dim(48, 66, 48, 118, "rect-tube", oha)}
        ${labelBox(8, 82, 96, 18)}
        <text class="shape-label" x="56" y="96" text-anchor="middle">Outer Height</text>

        ${ext(54, 60, 54, 32)}
        ${ext(128, 60, 128, 32)}
        ${dim(56, 32, 126, 32, "rect-tube", owa)}
        ${labelBox(60, 18, 88, 18)}
        <text class="shape-label" x="104" y="32" text-anchor="middle">Outer Width</text>

        ${ext(106, 66, 148, 66)}
        ${ext(106, 82, 148, 82)}
        ${dim(148, 66, 148, 82, "rect-tube", wa)}
        ${labelBox(160, 64, 104, 18)}
        <text class="shape-label" x="212" y="78" text-anchor="middle">Wall Thickness</text>
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
      const aa = activeDimensionKey === "across_flats";
      const la = activeDimensionKey === "length";
      return svg("hex-bar", "Hex bar with Across Flats and Length", `
        <polygon class="shape-body" points="126,110 151,72 201,72 226,110 201,148 151,148"/>
        <line class="shape-edge" x1="70" y1="110" x2="126" y2="110"/>
        <line class="shape-edge" x1="95" y1="72" x2="151" y2="72"/>
        <line class="shape-edge" x1="145" y1="72" x2="201" y2="72"/>
        <line class="shape-edge" x1="170" y1="110" x2="226" y2="110"/>
        <line class="shape-edge" x1="145" y1="148" x2="201" y2="148"/>
        <line class="shape-edge" x1="95" y1="148" x2="151" y2="148"/>
        <polygon class="shape-body" points="70,110 95,72 145,72 170,110 145,148 95,148"/>

        ${ext(70, 152, 70, 184)}
        ${ext(226, 152, 226, 184)}
        ${dim(70, 178, 226, 178, "hex-bar", la)}
        ${labelBox(124, 164, 50, 18)}
        <text class="shape-label" x="149" y="178" text-anchor="middle">Length</text>

        ${ext(95, 72, 54, 72)}
        ${ext(95, 148, 54, 148)}
        ${dim(58, 72, 58, 148, "hex-bar", aa)}
        ${labelBox(16, 48, 98, 18)}
        <text class="shape-label" x="65" y="62" text-anchor="middle">Across Flats</text>
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
      const oa = activeDimensionKey === "outer_diameter";
      const ia = activeDimensionKey === "inner_diameter";
      const ta = activeDimensionKey === "thickness";
      return svg("ring", "Ring with Outer Diameter, Inner Diameter, and Thickness", `
        <circle class="shape-body" cx="128" cy="106" r="54"/>
        <circle class="shape-cut" cx="128" cy="106" r="24"/>
        <rect class="shape-body" x="236" y="80" width="22" height="54" rx="2"/>
        <line class="shape-edge" x1="236" y1="80" x2="258" y2="80"/>
        <line class="shape-edge" x1="236" y1="134" x2="258" y2="134"/>

        ${ext(74, 160, 74, 184)}
        ${ext(182, 160, 182, 184)}
        ${dim(74, 178, 182, 178, "ring", oa)}
        ${labelBox(72, 186, 116, 18)}
        <text class="shape-label" x="130" y="200" text-anchor="middle">Outer Diameter</text>

        ${dim(104, 106, 152, 106, "ring", ia)}
        ${labelBox(74, 118, 108, 18)}
        <text class="shape-label" x="128" y="132" text-anchor="middle">Inner Diameter</text>

        ${ext(264, 80, 282, 80)}
        ${ext(264, 134, 282, 134)}
        ${dim(276, 80, 276, 134, "ring", ta)}
        ${labelBox(248, 142, 68, 18)}
        <text class="shape-label" x="282" y="156" text-anchor="middle">Thickness</text>
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
      const da = activeDimensionKey === "diameter";
      const ta = activeDimensionKey === "thickness";
      return svg("disc", "Disc with Diameter and Thickness", `
        <path class="shape-body" d="M88 94 C88 78 232 78 232 94 L232 144 C232 160 88 160 88 144 Z"/>
        <ellipse class="shape-edge" cx="160" cy="94" rx="72" ry="28"/>
        <path class="shape-edge" d="M88 144 C88 160 232 160 232 144"/>

        ${ext(88, 154, 88, 184)}
        ${ext(232, 154, 232, 184)}
        ${dim(88, 178, 232, 178, "disc", da)}
        ${labelBox(126, 186, 68, 18)}
        <text class="shape-label" x="160" y="200" text-anchor="middle">Diameter</text>

        ${ext(238, 94, 270, 94)}
        ${ext(238, 144, 270, 144)}
        ${dim(264, 94, 264, 144, "disc", ta)}
        ${labelBox(220, 116, 76, 18)}
        <text class="shape-label" x="258" y="130" text-anchor="middle">Thickness</text>
      `);
    },
  },
};

function dim(x1, y1, x2, y2, shapeId, active) {
  const activeClass = active ? " shape-dim-active" : "";
  const markerId = active ? `dimArrowActive-${shapeId}` : `dimArrow-${shapeId}`;
  return `<line class="shape-dim-line${activeClass}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#${markerId})" marker-end="url(#${markerId})"/>`;
}

function ext(x1, y1, x2, y2) {
  return `<line class="shape-extension-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
}

function labelBox(x, y, w, h) {
  return `<rect class="shape-label-bg" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>`;
}

function svg(shapeId, title, body) {
  return `<svg class="shape-svg" viewBox="0 0 320 220" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg">
    <title>${title}</title>
    <defs>
      <marker id="dimArrow-${shapeId}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0066cc"/>
      </marker>
      <marker id="dimArrowActive-${shapeId}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0d8c4a"/>
      </marker>
    </defs>
    ${body}
  </svg>`;
}

function renderShapeDiagram(shapeId, activeDimensionKey = "") {
  const spec = SHAPE_SPECS[shapeId] || SHAPE_SPECS.round_bar;
  return spec.renderSvg({ activeDimensionKey });
}
