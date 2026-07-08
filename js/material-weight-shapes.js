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

        ${ext(118, 144, 118, 178)}
        ${ext(260, 122, 260, 178)}
        ${dim(118, 172, 260, 172, "square-bar", la)}
        ${labelBox(164, 158, 50, 18)}
        <text class="shape-label" x="189" y="172" text-anchor="middle">Length</text>

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

        ${ext(132, 136, 132, 164)}
        ${ext(270, 114, 270, 164)}
        ${dim(132, 158, 270, 158, "rect-bar", la)}
        ${labelBox(176, 144, 50, 18)}
        <text class="shape-label" x="201" y="158" text-anchor="middle">Length</text>

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

        ${ext(124, 150, 124, 180)}
        ${ext(262, 128, 262, 180)}
        ${dim(124, 174, 262, 174, "square-tube", la)}
        ${labelBox(168, 160, 50, 18)}
        <text class="shape-label" x="193" y="174" text-anchor="middle">Length</text>

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

        ${ext(138, 148, 138, 176)}
        ${ext(272, 126, 272, 176)}
        ${dim(138, 170, 272, 170, "rect-tube", la)}
        ${labelBox(180, 156, 50, 18)}
        <text class="shape-label" x="205" y="170" text-anchor="middle">Length</text>

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

        ${ext(154, 156, 154, 188)}
        ${ext(240, 136, 240, 188)}
        ${dim(154, 182, 240, 182, "hex-bar", la)}
        ${labelBox(172, 168, 50, 18)}
        <text class="shape-label" x="197" y="182" text-anchor="middle">Length</text>

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
        <path class="shape-body shape-face-side" d="M112 58 L194 58 C218 58 218 162 194 162 L112 162 C78 162 78 58 112 58 Z"/>
        <ellipse class="shape-body shape-face-front" cx="112" cy="110" rx="34" ry="52"/>
        <ellipse class="shape-cut" cx="112" cy="110" rx="16" ry="25"/>

        ${ext(68, 58, 94, 58)}
        ${ext(68, 162, 94, 162)}
        ${dim(74, 58, 74, 162, "ring", oa)}
        ${labelBox(8, 101, 124, 18)}
        <text class="shape-label" x="70" y="115" text-anchor="middle">Outer Diameter</text>

        ${dim(112, 85, 112, 135, "ring", ia)}
        ${labelBox(128, 101, 112, 18)}
        <text class="shape-label" x="184" y="115" text-anchor="middle">Inner Diameter</text>

        ${ext(112, 166, 112, 196)}
        ${ext(194, 166, 194, 196)}
        ${dim(112, 190, 194, 190, "ring", ta)}
        ${labelBox(120, 176, 68, 18)}
        <text class="shape-label" x="154" y="190" text-anchor="middle">Thickness</text>
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
        <path class="shape-body shape-face-side" d="M116 58 L202 58 C226 58 226 162 202 162 L116 162 C82 162 82 58 116 58 Z"/>
        <ellipse class="shape-body shape-face-front" cx="116" cy="110" rx="34" ry="52"/>

        ${ext(72, 58, 98, 58)}
        ${ext(72, 162, 98, 162)}
        ${dim(78, 58, 78, 162, "disc", da)}
        ${labelBox(34, 101, 68, 18)}
        <text class="shape-label" x="68" y="115" text-anchor="middle">Diameter</text>

        ${ext(116, 166, 116, 196)}
        ${ext(202, 166, 202, 196)}
        ${dim(116, 190, 202, 190, "disc", ta)}
        ${labelBox(124, 176, 76, 18)}
        <text class="shape-label" x="162" y="190" text-anchor="middle">Thickness</text>
      `);
    },
  },

  angle_bar: {
    label: "Angle Bar",
    dimensions: [
      { key: "leg_a", label: "Leg A", unit: true },
      { key: "leg_b", label: "Leg B", unit: true },
      { key: "thickness", label: "Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const la = activeDimensionKey === "leg_a";
      const lb = activeDimensionKey === "leg_b";
      const tt = activeDimensionKey === "thickness";
      const le = activeDimensionKey === "length";
      return svg("angle-bar", "Angle bar with two legs and thickness", `
        <path class="shape-body shape-face-front" d="M84 58 L84 164 L172 164 L172 128 L128 128 L128 58 Z"/>
        <path class="shape-body shape-face-top" d="M84 58 L128 32 L216 32 L216 58 Z"/>
        <path class="shape-body shape-face-side" d="M216 58 L216 154 L172 128 L172 58 Z"/>

        ${ext(84, 170, 84, 194)}
        ${ext(172, 170, 172, 194)}
        ${dim(84, 188, 172, 188, "angle-bar", la)}
        ${labelBox(98, 178, 64, 18)}
        <text class="shape-label" x="128" y="192" text-anchor="middle">Leg A</text>

        ${ext(176, 128, 212, 128)}
        ${ext(176, 164, 212, 164)}
        ${dim(194, 128, 194, 164, "angle-bar", lb)}
        ${labelBox(214, 142, 80, 18)}
        <text class="shape-label" x="254" y="156" text-anchor="middle">Leg B</text>

        ${ext(176, 164, 176, 188)}
        ${ext(216, 164, 216, 188)}
        ${dim(176, 188, 216, 188, "angle-bar", tt)}
        ${labelBox(180, 176, 92, 18)}
        <text class="shape-label" x="222" y="190" text-anchor="middle">Thickness</text>

        ${ext(84, 194, 216, 194)}
        ${ext(216, 188, 216, 194)}
        ${dim(84, 206, 216, 206, "angle-bar", le)}
        ${labelBox(136, 196, 60, 18)}
        <text class="shape-label" x="160" y="210" text-anchor="middle">Length</text>
      `);
    },
  },

  channel: {
    label: "Channel",
    dimensions: [
      { key: "height", label: "Height", unit: true },
      { key: "flange_width", label: "Flange Width", unit: true },
      { key: "web_thickness", label: "Web Thickness", unit: true },
      { key: "flange_thickness", label: "Flange Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const ho = activeDimensionKey === "height";
      const fw = activeDimensionKey === "flange_width";
      const wt = activeDimensionKey === "web_thickness";
      const ft = activeDimensionKey === "flange_thickness";
      const le = activeDimensionKey === "length";
      return svg("channel", "Channel with Height, Flange Width, Web Thickness and Flange Thickness", `
        <rect class="shape-body shape-face-front" x="76" y="54" width="172" height="112" rx="2"/>
        <rect class="shape-cut" x="126" y="88" width="72" height="44"/>

        ${ext(76, 174, 76, 204)}
        ${ext(248, 174, 248, 204)}
        ${dim(76, 198, 248, 198, "channel", le)}
        ${labelBox(152, 188, 56, 18)}
        <text class="shape-label" x="174" y="202" text-anchor="middle">Length</text>

        ${ext(76, 54, 76, 166)}
        ${ext(76, 166, 76, 186)}
        ${dim(76, 70, 76, 166, "channel", ho)}
        ${labelBox(8, 102, 62, 18)}
        <text class="shape-label" x="39" y="120" text-anchor="middle">Height</text>

        ${ext(248, 54, 284, 54)}
        ${ext(248, 166, 284, 166)}
        ${dim(248, 54, 248, 166, "channel", fw)}
        ${labelBox(234, 106, 50, 18)}
        <text class="shape-label" x="259" y="112" text-anchor="middle">Flange Width</text>

        ${ext(126, 96, 126, 142)}
        ${ext(198, 96, 198, 142)}
        ${dim(126, 119, 198, 119, "channel", wt)}
        ${labelBox(206, 112, 84, 18)}
        <text class="shape-label" x="248" y="126" text-anchor="middle">Web Thickness</text>

        ${ext(126, 54, 126, 94)}
        ${ext(126, 54, 162, 54)}
        ${dim(126, 54, 162, 54, "channel", ft)}
        ${labelBox(165, 38, 94, 18)}
        <text class="shape-label" x="217" y="52" text-anchor="middle">Flange Thickness</text>
      `);
    },
  },

  i_beam: {
    label: "I Beam",
    dimensions: [
      { key: "height", label: "Height", unit: true },
      { key: "flange_width", label: "Flange Width", unit: true },
      { key: "web_thickness", label: "Web Thickness", unit: true },
      { key: "flange_thickness", label: "Flange Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const ho = activeDimensionKey === "height";
      const fw = activeDimensionKey === "flange_width";
      const wt = activeDimensionKey === "web_thickness";
      const ft = activeDimensionKey === "flange_thickness";
      const le = activeDimensionKey === "length";
      return svg("i-beam", "I beam with Height, Flange Width, Web Thickness and Flange Thickness", `
        <rect class="shape-body shape-face-front" x="76" y="52" width="72" height="114" rx="2"/>
        <rect class="shape-body shape-face-front" x="156" y="88" width="88" height="42" rx="2"/>
        <rect class="shape-body shape-face-front" x="184" y="52" width="72" height="114" rx="2"/>

        ${ext(70, 166, 70, 196)}
        ${ext(262, 166, 262, 196)}
        ${dim(70, 190, 262, 190, "i-beam", le)}
        ${labelBox(156, 178, 50, 18)}
        <text class="shape-label" x="166" y="192" text-anchor="middle">Length</text>

        ${ext(76, 52, 262, 52)}
        ${ext(76, 166, 262, 166)}
        ${dim(76, 52, 262, 52, "i-beam", fw)}
        ${labelBox(154, 36, 76, 18)}
        <text class="shape-label" x="177" y="48" text-anchor="middle">Flange Width</text>

        ${ext(158, 88, 158, 130)}
        ${ext(244, 88, 244, 130)}
        ${dim(158, 88, 244, 88, "i-beam", wt)}
        ${labelBox(244, 100, 76, 18)}
        <text class="shape-label" x="286" y="104" text-anchor="middle">Web Thickness</text>

        ${ext(76, 52, 76, 88)}
        ${ext(148, 52, 148, 88)}
        ${dim(76, 70, 148, 70, "i-beam", ft)}
        ${labelBox(128, 56, 54, 18)}
        <text class="shape-label" x="120" y="80" text-anchor="middle" transform="rotate(-90 120 80)">Flange Thickness</text>

        ${ext(76, 166, 76, 130)}
        ${ext(148, 166, 148, 130)}
        ${dim(76, 148, 148, 148, "i-beam", ho)}
        ${labelBox(8, 120, 58, 18)}
        <text class="shape-label" x="47" y="144" text-anchor="middle">Height</text>
      `);
    },
  },

  t_bar: {
    label: "T Bar",
    dimensions: [
      { key: "flange_width", label: "Flange Width", unit: true },
      { key: "flange_thickness", label: "Flange Thickness", unit: true },
      { key: "web_height", label: "Web Height", unit: true },
      { key: "web_thickness", label: "Web Thickness", unit: true },
      { key: "length", label: "Length", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const fw = activeDimensionKey === "flange_width";
      const ft = activeDimensionKey === "flange_thickness";
      const wh = activeDimensionKey === "web_height";
      const wt = activeDimensionKey === "web_thickness";
      const le = activeDimensionKey === "length";
      return svg("t-bar", "T bar with Flange Width, Flange Thickness, Web Height, and Web Thickness", `
        <polygon class="shape-body shape-face-front" points="82,52 238,52 238,88 182,88 182,166 138,166 138,88 82,88"/>
        <rect class="shape-body shape-face-top" x="138" y="88" width="44" height="78" rx="2"/>

        ${ext(82, 178, 82, 204)}
        ${ext(238, 178, 238, 204)}
        ${dim(82, 198, 238, 198, "t-bar", le)}
        ${labelBox(154, 188, 50, 18)}
        <text class="shape-label" x="160" y="202" text-anchor="middle">Length</text>

        ${ext(138, 52, 238, 52)}
        ${ext(138, 88, 238, 88)}
        ${dim(138, 70, 238, 70, "t-bar", fw)}
        ${labelBox(178, 36, 80, 18)}
        <text class="shape-label" x="198" y="48" text-anchor="middle">Flange Width</text>

        ${ext(138, 88, 138, 128)}
        ${ext(182, 88, 182, 128)}
        ${dim(138, 108, 182, 108, "t-bar", ft)}
        ${labelBox(186, 94, 102, 18)}
        <text class="shape-label" x="236" y="112" text-anchor="middle">Flange Thickness</text>

        ${ext(170, 128, 182, 128)}
        ${ext(170, 166, 182, 166)}
        ${dim(176, 166, 176, 128, "t-bar", wh)}
        ${labelBox(188, 142, 78, 18)}
        <text class="shape-label" x="236" y="144" text-anchor="middle">Web Height</text>

        ${ext(182, 128, 182, 166)}
        ${ext(238, 128, 238, 166)}
        ${dim(210, 128, 210, 166, "t-bar", wt)}
        ${labelBox(244, 140, 74, 18)}
        <text class="shape-label" x="281" y="152" text-anchor="middle">Web Thickness</text>
      `);
    },
  },

  sphere: {
    label: "Sphere",
    dimensions: [
      { key: "diameter", label: "Diameter", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const da = activeDimensionKey === "diameter";
      return svg("sphere", "Sphere with Diameter", `
        <ellipse class="shape-body shape-face-front" cx="160" cy="110" rx="66" ry="44"/>
        <ellipse class="shape-face-top" cx="160" cy="110" rx="66" ry="18"/>
        <line class="shape-face-side" x1="94" y1="110" x2="226" y2="110" />

        ${ext(94, 162, 226, 162)}
        ${ext(94, 162, 94, 190)}
        ${ext(226, 162, 226, 190)}
        ${dim(94, 182, 226, 182, "sphere", da)}
        ${labelBox(142, 170, 66, 18)}
        <text class="shape-label" x="160" y="183" text-anchor="middle">Diameter</text>
      `);
    },
  },

  frustum: {
    label: "Frustum / Cone",
    dimensions: [
      { key: "top_diameter", label: "Top Diameter", unit: true },
      { key: "bottom_diameter", label: "Bottom Diameter", unit: true },
      { key: "height", label: "Height", unit: true },
    ],
    renderSvg({ activeDimensionKey = "" } = {}) {
      const td = activeDimensionKey === "top_diameter";
      const bd = activeDimensionKey === "bottom_diameter";
      const he = activeDimensionKey === "height";
      return svg("frustum", "Frustum with top and bottom diameters and height", `
        <polygon class="shape-body shape-face-front" points="90 58 230 58 266 168 54 168"/>
        <polygon class="shape-body shape-face-top" points="90 58 230 58 230 74 90 74"/>
        <polygon class="shape-body shape-face-side" points="230 58 266 168 266 182 230 74"/>

        ${ext(90, 64, 230, 64)}
        ${ext(90, 58, 90, 32)}
        ${ext(230, 58, 230, 32)}
        ${dim(90, 46, 230, 46, "frustum", td)}
        ${labelBox(142, 24, 76, 18)}
        <text class="shape-label" x="160" y="38" text-anchor="middle">Top Diameter</text>

        ${ext(54, 168, 266, 168)}
        ${ext(54, 182, 54, 214)}
        ${ext(266, 182, 266, 214)}
        ${dim(54, 198, 266, 198, "frustum", bd)}
        ${labelBox(156, 208, 90, 18)}
        <text class="shape-label" x="156" y="204" text-anchor="middle" transform="rotate(0 156 204)">Bottom Diameter</text>

        ${ext(54, 168, 266, 168)}
        ${ext(54, 168, 54, 58)}
        ${dim(30, 58, 30, 168, "frustum", he)}
        ${labelBox(8, 96, 40, 54)}
        <text class="shape-label" x="29" y="116" text-anchor="middle" transform="rotate(-90 29 116)">Height</text>
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
