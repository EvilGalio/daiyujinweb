/* Material weight calculator SVG diagrams.
   A consistent oblique projection gives depth without distorting the profiles. */

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
        <path class="shape-body shape-face-side" d="M76 60 L226 60 C254 60 254 160 226 160 L76 160 C46 160 46 60 76 60 Z"/>
        <ellipse class="shape-body shape-face-front" cx="76" cy="110" rx="30" ry="50"/>

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
        ${rectPrism(60, 82, 58, 58, 142, -22)}

        ${ext(60, 144, 60, 178)}
        ${ext(260, 122, 260, 178)}
        ${dim(60, 172, 260, 172, "square-bar", la)}
        ${labelBox(135, 158, 50, 18)}
        <text class="shape-label" x="160" y="172" text-anchor="middle">Length</text>

        ${ext(48, 82, 48, 140)}
        ${ext(48, 140, 48, 160)}
        ${dim(54, 82, 54, 140, "square-bar", sa)}
        ${labelBox(14, 102, 40, 18)}
        <text class="shape-label" x="34" y="116" text-anchor="middle">Side</text>
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
        ${rectPrism(58, 94, 74, 38, 138, -22)}

        ${ext(58, 136, 58, 164)}
        ${ext(270, 114, 270, 164)}
        ${dim(58, 158, 270, 158, "rect-bar", la)}
        ${labelBox(139, 144, 50, 18)}
        <text class="shape-label" x="164" y="158" text-anchor="middle">Length</text>

        ${ext(46, 94, 46, 132)}
        ${ext(46, 132, 46, 148)}
        ${dim(52, 94, 52, 132, "rect-bar", ta)}
        ${labelBox(10, 102, 76, 18)}
        <text class="shape-label" x="48" y="116" text-anchor="middle">Thickness</text>

        ${ext(58, 88, 58, 34)}
        ${ext(132, 88, 132, 34)}
        ${dim(60, 34, 130, 34, "rect-bar", wa)}
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
        <polygon class="shape-body shape-face-top" points="68,118 248,118 274,82 94,82"/>
        <polygon class="shape-body shape-face-front" points="68,118 248,118 248,132 68,132"/>
        <polygon class="shape-body shape-face-side" points="248,118 274,82 274,96 248,132"/>
        <line class="shape-edge" x1="94" y1="82" x2="274" y2="82"/>

        ${ext(68, 136, 68, 170)}
        ${ext(248, 136, 248, 170)}
        ${dim(68, 164, 248, 164, "sheet", la)}
        ${labelBox(133, 150, 50, 18)}
        <text class="shape-label" x="158" y="164" text-anchor="middle">Length</text>

        ${ext(68, 118, 42, 112)}
        ${ext(94, 82, 68, 76)}
        ${dim(46, 112, 72, 76, "sheet", wa)}
        ${labelBox(74, 88, 44, 18)}
        <text class="shape-label" x="96" y="102" text-anchor="middle">Width</text>

        ${ext(258, 118, 294, 118)}
        ${ext(258, 132, 294, 132)}
        ${dim(288, 118, 288, 132, "sheet", ta)}
        ${labelBox(226, 138, 76, 18)}
        <text class="shape-label" x="264" y="152" text-anchor="middle">Thickness</text>
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
        <path class="shape-body shape-face-side" d="M78 60 L226 60 C254 60 254 160 226 160 L78 160 C46 160 46 60 78 60 Z"/>
        <ellipse class="shape-body shape-face-front" cx="78" cy="110" rx="32" ry="50"/>
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
        ${rectPrism(60, 82, 64, 64, 138, -22)}
        <rect class="shape-cut" x="80" y="102" width="26" height="26" rx="1"/>

        ${ext(60, 150, 60, 180)}
        ${ext(262, 128, 262, 180)}
        ${dim(60, 174, 262, 174, "square-tube", la)}
        ${labelBox(136, 160, 50, 18)}
        <text class="shape-label" x="161" y="174" text-anchor="middle">Length</text>

        ${ext(48, 82, 48, 146)}
        ${ext(48, 146, 48, 164)}
        ${dim(54, 82, 54, 146, "square-tube", oa)}
        ${labelBox(10, 104, 78, 18)}
        <text class="shape-label" x="49" y="118" text-anchor="middle">Outer Side</text>

        ${ext(106, 82, 152, 82)}
        ${ext(106, 102, 152, 102)}
        ${dim(152, 82, 152, 102, "square-tube", wa)}
        ${labelBox(164, 83, 104, 18)}
        <text class="shape-label" x="216" y="97" text-anchor="middle">Wall Thickness</text>
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
        ${rectPrism(56, 92, 82, 52, 134, -22)}
        <rect class="shape-cut" x="78" y="108" width="36" height="20" rx="1"/>

        ${ext(56, 148, 56, 176)}
        ${ext(272, 126, 272, 176)}
        ${dim(56, 170, 272, 170, "rect-tube", la)}
        ${labelBox(139, 156, 50, 18)}
        <text class="shape-label" x="164" y="170" text-anchor="middle">Length</text>

        ${ext(44, 92, 44, 144)}
        ${ext(44, 144, 44, 162)}
        ${dim(50, 92, 50, 144, "rect-tube", oha)}
        ${labelBox(8, 110, 96, 18)}
        <text class="shape-label" x="56" y="124" text-anchor="middle">Outer Height</text>

        ${ext(56, 86, 56, 34)}
        ${ext(138, 86, 138, 34)}
        ${dim(58, 34, 136, 34, "rect-tube", owa)}
        ${labelBox(62, 20, 88, 18)}
        <text class="shape-label" x="106" y="34" text-anchor="middle">Outer Width</text>

        ${ext(114, 92, 160, 92)}
        ${ext(114, 108, 160, 108)}
        ${dim(160, 92, 160, 108, "rect-tube", wa)}
        ${labelBox(172, 91, 104, 18)}
        <text class="shape-label" x="224" y="105" text-anchor="middle">Wall Thickness</text>
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
      const front = [
        [78, 114], [104, 76], [154, 76], [180, 114], [154, 152], [104, 152],
      ];
      return svg("hex-bar", "Hex bar with Across Flats and Length", `
        ${hexPrism(front, 86, -20)}

        ${ext(78, 156, 78, 188)}
        ${ext(266, 132, 266, 188)}
        ${dim(78, 182, 266, 182, "hex-bar", la)}
        ${labelBox(148, 168, 50, 18)}
        <text class="shape-label" x="173" y="182" text-anchor="middle">Length</text>

        ${ext(104, 76, 62, 76)}
        ${ext(104, 152, 62, 152)}
        ${dim(66, 76, 66, 152, "hex-bar", aa)}
        ${labelBox(16, 52, 98, 18)}
        <text class="shape-label" x="65" y="66" text-anchor="middle">Across Flats</text>
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
        <path class="shape-body shape-face-side" d="M82 94 C82 76 218 76 218 94 L218 136 C218 154 82 154 82 136 Z"/>
        <ellipse class="shape-body shape-face-top" cx="150" cy="94" rx="68" ry="28"/>
        <ellipse class="shape-cut" cx="150" cy="94" rx="28" ry="12"/>
        <path class="shape-edge" d="M82 136 C82 154 218 154 218 136"/>

        ${ext(82, 148, 82, 180)}
        ${ext(218, 148, 218, 180)}
        ${dim(82, 174, 218, 174, "ring", oa)}
        ${labelBox(92, 184, 116, 18)}
        <text class="shape-label" x="150" y="198" text-anchor="middle">Outer Diameter</text>

        ${dim(122, 94, 178, 94, "ring", ia)}
        ${labelBox(96, 108, 108, 18)}
        <text class="shape-label" x="150" y="122" text-anchor="middle">Inner Diameter</text>

        ${ext(226, 94, 252, 94)}
        ${ext(226, 136, 252, 136)}
        ${dim(246, 94, 246, 136, "ring", ta)}
        ${labelBox(252, 106, 68, 18)}
        <text class="shape-label" x="286" y="120" text-anchor="middle">Thickness</text>
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
        <path class="shape-body shape-face-side" d="M88 94 C88 78 232 78 232 94 L232 144 C232 160 88 160 88 144 Z"/>
        <ellipse class="shape-body shape-face-top" cx="160" cy="94" rx="72" ry="28"/>
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

function rectPrism(x, y, w, h, dx, dy) {
  const bx = x + dx;
  const by = y + dy;
  return `
    <rect class="shape-body shape-face-back" x="${bx}" y="${by}" width="${w}" height="${h}" rx="2"/>
    <polygon class="shape-body shape-face-top" points="${x},${y} ${x + w},${y} ${bx + w},${by} ${bx},${by}"/>
    <polygon class="shape-body shape-face-side" points="${x + w},${y} ${bx + w},${by} ${bx + w},${by + h} ${x + w},${y + h}"/>
    <polygon class="shape-body shape-face-bottom" points="${x},${y + h} ${x + w},${y + h} ${bx + w},${by + h} ${bx},${by + h}"/>
    <rect class="shape-body shape-face-front" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>
  `;
}

function hexPrism(front, dx, dy) {
  const back = front.map(([x, y]) => [x + dx, y + dy]);
  const poly = (points) => points.map(([x, y]) => `${x},${y}`).join(" ");
  return `
    <polygon class="shape-body shape-face-back" points="${poly(back)}"/>
    <polygon class="shape-body shape-face-top" points="${poly([front[1], front[2], back[2], back[1]])}"/>
    <polygon class="shape-body shape-face-side" points="${poly([front[2], front[3], back[3], back[2]])}"/>
    <polygon class="shape-body shape-face-side" points="${poly([front[3], front[4], back[4], back[3]])}"/>
    <polygon class="shape-body shape-face-bottom" points="${poly([front[4], front[5], back[5], back[4]])}"/>
    <polygon class="shape-body shape-face-front" points="${poly(front)}"/>
  `;
}

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
