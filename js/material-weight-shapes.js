/* Material weight calculator SVG diagrams.
   Orthographic extrusion keeps the shapes regular and easy to verify. */

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
        <rect class="shape-body" x="120" y="64" width="122" height="64" rx="2"/>
        <line class="shape-edge" x1="242" y1="64" x2="242" y2="128"/>
        <rect class="shape-body" x="60" y="64" width="64" height="64" rx="2"/>

        ${ext(60, 132, 60, 174)}
        ${ext(242, 132, 242, 174)}
        ${dim(60, 168, 242, 168, "square-bar", la)}
        ${labelBox(126, 154, 50, 18)}
        <text class="shape-label" x="151" y="168" text-anchor="middle">Length</text>

        ${ext(48, 64, 48, 128)}
        ${ext(48, 128, 48, 154)}
        ${dim(54, 64, 54, 128, "square-bar", sa)}
        ${labelBox(14, 84, 40, 18)}
        <text class="shape-label" x="34" y="98" text-anchor="middle">Side</text>
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
        <rect class="shape-body" x="130" y="78" width="116" height="40" rx="2"/>
        <line class="shape-edge" x1="246" y1="78" x2="246" y2="118"/>
        <rect class="shape-body" x="58" y="78" width="72" height="40" rx="2"/>

        ${ext(58, 122, 58, 158)}
        ${ext(246, 122, 246, 158)}
        ${dim(58, 152, 246, 152, "rect-bar", la)}
        ${labelBox(127, 138, 50, 18)}
        <text class="shape-label" x="152" y="152" text-anchor="middle">Length</text>

        ${ext(46, 78, 46, 118)}
        ${ext(46, 118, 46, 140)}
        ${dim(52, 78, 52, 118, "rect-bar", ta)}
        ${labelBox(10, 85, 76, 18)}
        <text class="shape-label" x="48" y="99" text-anchor="middle">Thickness</text>

        ${ext(58, 72, 58, 34)}
        ${ext(130, 72, 130, 34)}
        ${dim(60, 34, 128, 34, "rect-bar", wa)}
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
        <rect class="shape-body" x="72" y="62" width="190" height="84" rx="2"/>
        <rect class="shape-body" x="72" y="146" width="190" height="12" rx="1"/>
        <line class="shape-edge" x1="72" y1="146" x2="262" y2="146"/>

        ${ext(72, 162, 72, 190)}
        ${ext(262, 162, 262, 190)}
        ${dim(72, 184, 262, 184, "sheet", la)}
        ${labelBox(142, 170, 50, 18)}
        <text class="shape-label" x="167" y="184" text-anchor="middle">Length</text>

        ${ext(66, 62, 42, 62)}
        ${ext(66, 146, 42, 146)}
        ${dim(48, 62, 48, 146, "sheet", wa)}
        ${labelBox(56, 95, 44, 18)}
        <text class="shape-label" x="78" y="109" text-anchor="middle">Width</text>

        ${ext(270, 146, 292, 146)}
        ${ext(270, 158, 292, 158)}
        ${dim(286, 146, 286, 158, "sheet", ta)}
        ${labelBox(226, 160, 76, 18)}
        <text class="shape-label" x="264" y="174" text-anchor="middle">Thickness</text>
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

        ${ext(78, 60, 118, 60)}
        ${ext(78, 85, 118, 85)}
        ${dim(118, 60, 118, 85, "round-tube", wa)}
        ${labelBox(130, 63, 102, 18)}
        <text class="shape-label" x="181" y="77" text-anchor="middle">Wall Thickness</text>
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
        <rect class="shape-body" x="132" y="58" width="112" height="72" rx="2"/>
        <line class="shape-edge" x1="244" y1="58" x2="244" y2="130"/>
        <rect class="shape-body" x="60" y="58" width="72" height="72" rx="2"/>
        <rect class="shape-cut" x="80" y="78" width="32" height="32" rx="1"/>

        ${ext(60, 134, 60, 176)}
        ${ext(244, 134, 244, 176)}
        ${dim(60, 170, 244, 170, "square-tube", la)}
        ${labelBox(127, 156, 50, 18)}
        <text class="shape-label" x="152" y="170" text-anchor="middle">Length</text>

        ${ext(48, 58, 48, 130)}
        ${ext(48, 130, 48, 156)}
        ${dim(54, 58, 54, 130, "square-tube", oa)}
        ${labelBox(10, 86, 78, 18)}
        <text class="shape-label" x="49" y="100" text-anchor="middle">Outer Side</text>

        ${ext(112, 58, 152, 58)}
        ${ext(112, 78, 152, 78)}
        ${dim(152, 58, 152, 78, "square-tube", wa)}
        ${labelBox(164, 59, 104, 18)}
        <text class="shape-label" x="216" y="73" text-anchor="middle">Wall Thickness</text>
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
        <rect class="shape-body" x="140" y="70" width="108" height="54" rx="2"/>
        <line class="shape-edge" x1="248" y1="70" x2="248" y2="124"/>
        <rect class="shape-body" x="56" y="70" width="84" height="54" rx="2"/>
        <rect class="shape-cut" x="78" y="86" width="40" height="22" rx="1"/>

        ${ext(56, 128, 56, 168)}
        ${ext(248, 128, 248, 168)}
        ${dim(56, 162, 248, 162, "rect-tube", la)}
        ${labelBox(127, 148, 50, 18)}
        <text class="shape-label" x="152" y="162" text-anchor="middle">Length</text>

        ${ext(44, 70, 44, 124)}
        ${ext(44, 124, 44, 150)}
        ${dim(50, 70, 50, 124, "rect-tube", oha)}
        ${labelBox(8, 88, 96, 18)}
        <text class="shape-label" x="56" y="102" text-anchor="middle">Outer Height</text>

        ${ext(56, 64, 56, 32)}
        ${ext(140, 64, 140, 32)}
        ${dim(58, 32, 138, 32, "rect-tube", owa)}
        ${labelBox(62, 18, 88, 18)}
        <text class="shape-label" x="106" y="32" text-anchor="middle">Outer Width</text>

        ${ext(118, 70, 158, 70)}
        ${ext(118, 86, 158, 86)}
        ${dim(158, 70, 158, 86, "rect-tube", wa)}
        ${labelBox(170, 68, 104, 18)}
        <text class="shape-label" x="222" y="82" text-anchor="middle">Wall Thickness</text>
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
        <rect class="shape-body" x="154" y="74" width="108" height="72" rx="1"/>
        <line class="shape-edge" x1="262" y1="74" x2="262" y2="146"/>
        <polygon class="shape-body" points="80,110 104,74 154,74 178,110 154,146 104,146"/>

        ${ext(80, 150, 80, 184)}
        ${ext(262, 150, 262, 184)}
        ${dim(80, 178, 262, 178, "hex-bar", la)}
        ${labelBox(146, 164, 50, 18)}
        <text class="shape-label" x="171" y="178" text-anchor="middle">Length</text>

        ${ext(104, 74, 62, 74)}
        ${ext(104, 146, 62, 146)}
        ${dim(66, 74, 66, 146, "hex-bar", aa)}
        ${labelBox(16, 50, 98, 18)}
        <text class="shape-label" x="65" y="64" text-anchor="middle">Across Flats</text>
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
