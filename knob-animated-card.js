/* Knob 2 — fully animated dial card.
 * Custom Lovelace card (NOT markdown, so no sanitizer limits apply):
 * shadow DOM + SVG + CSS keyframes all run natively.
 * Config: { type: 'custom:knob-animated-card',
 *   angle_entity, gesture_entity, action_entity, name? }
 */
class KnobAnimatedCard extends HTMLElement {
  constructor() {
    super();
    this._shown = null;      // unwound continuous angle (deg), survives wrap
    this._lastGesture = null;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .wrap { padding: 10px 12px 12px; text-align: center; }
        svg { width: 190px; height: 190px; display: block; margin: 0 auto; }
        .ticks line { stroke: #555; stroke-width: 2; }
        .ticks line.major { stroke: #999; stroke-width: 3; }
        .track { fill: none; stroke: #2c2c2c; stroke-width: 12; }
        .prog { fill: none; stroke-width: 12; stroke-linecap: round;
          transition: stroke-dashoffset 0.35s cubic-bezier(.3,1.4,.5,1), stroke 0.3s; }
        .ring { fill: none; stroke-width: 3; transition: stroke 0.3s; }
        .holding .ring { animation: holdpulse 1s ease-in-out infinite; }
        @keyframes holdpulse {
          0%,100% { stroke-width: 3; opacity: 1; }
          50% { stroke-width: 7; opacity: 0.55; }
        }
        #pointer { transition: transform 0.35s cubic-bezier(.3,1.5,.5,1); }
        .flashable { opacity: 0; }
        .flashable.flash { animation: kflash 0.6s ease-out; }
        @keyframes kflash {
          0% { opacity: 0.85; } 100% { opacity: 0; }
        }
        .moving .spin { animation: kspin 1.1s linear infinite; transform-origin: 100px 100px; }
        @keyframes kspin { to { transform: rotate(360deg); } }
        .glyph { font-size: 34px; fill: #fff; text-anchor: middle; }
        .pct { font-size: 13px; fill: #aaa; text-anchor: middle; }
        .gesture { font-size: 24px; font-weight: bold; margin-top: 2px; transition: color 0.3s; }
        .sub { font-size: 13px; color: var(--secondary-text-color, #888); }
        .status { font-size: 15px; font-weight: bold; margin-top: 2px; }
      </style>
      <ha-card>
        <div class="wrap" id="wrap">
          <svg viewBox="0 0 200 200">
            <g class="ticks" id="ticks"></g>
            <circle class="track" cx="100" cy="100" r="78"/>
            <circle class="prog" id="prog" cx="100" cy="100" r="78"
              transform="rotate(-90 100 100)"/>
            <circle class="ring" id="ring" cx="100" cy="100" r="90"/>
            <circle class="spin" id="spin" cx="100" cy="100" r="64"
              fill="none" stroke="#ff9800" stroke-width="3"
              stroke-dasharray="10 490" stroke-linecap="round" opacity="0"/>
            <circle class="flashable" id="flash" cx="100" cy="100" r="90"
              fill="none" stroke="#fff" stroke-width="6"/>
            <g id="pointer">
              <line x1="100" y1="100" x2="100" y2="34"
                stroke="#ff9800" stroke-width="5" stroke-linecap="round"/>
              <circle cx="100" cy="30" r="8" fill="#ff9800"/>
            </g>
            <circle cx="100" cy="100" r="14" fill="#1c1c1c"/>
            <text class="glyph" id="glyph" x="100" y="112">&#9679;</text>
            <text class="pct" id="pct" x="100" y="150"></text>
          </svg>
          <div class="gesture" id="gesture">?</div>
          <div class="sub" id="action"></div>
          <div class="sub" id="angle"></div>
          <div class="sub" id="stamp"></div>
          <div class="status" id="status"></div>
        </div>
      </ha-card>`;
    // tick ring: 24 ticks, major every 6
    const ticks = this.shadowRoot.getElementById("ticks");
    const NS = "http://www.w3.org/2000/svg";
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * Math.PI - Math.PI / 2;
      const maj = i % 6 === 0;
      const r1 = maj ? 60 : 64, r2 = 70;
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", 100 + r1 * Math.cos(a));
      l.setAttribute("y1", 100 + r1 * Math.sin(a));
      l.setAttribute("x2", 100 + r2 * Math.cos(a));
      l.setAttribute("y2", 100 + r2 * Math.sin(a));
      if (maj) l.setAttribute("class", "major");
      ticks.appendChild(l);
    }
  }

  setConfig(config) {
    if (!config.angle_entity || !config.gesture_entity) {
      throw new Error("knob-animated-card: angle_entity + gesture_entity required");
    }
    this._config = Object.assign(
      { action_entity: null, name: "Knob 2 — live dial" }, config);
  }

  getCardSize() { return 5; }

  set hass(hass) {
    const c = this._config;
    if (!c) return;
    const $ = (id) => this.shadowRoot.getElementById(id);
    const aSt = hass.states[c.angle_entity];
    const gSt = hass.states[c.gesture_entity];
    const actSt = c.action_entity ? hass.states[c.action_entity] : null;
    if (!aSt || !gSt) return;

    const deg = parseFloat(aSt.state) || 0;
    const gesture = gSt.state || "?";
    const action = actSt ? actSt.state : "";

    // unwind 0-359 sawtooth into continuous rotation (smooth across wrap).
    // The template sensor accumulates % 360, so the wrap modulus is 360.
    if (this._shown === null) this._shown = deg;
    const d = (((deg - this._shown) % 360 + 540) % 360) - 180;
    this._shown += d;

    const frac = (((deg % 360) + 360) % 360) / 360;
    const C = 2 * Math.PI * 78;
    const gcol = {
      "turn right": "#4caf50", "turn left": "#66bbff",
      "press": "#ff9800", "double press": "#f06292",
      "hold": "#ef5350",
      "hold + turn right": "#8bc34a", "hold + turn left": "#29b6f6",
    }[gesture] || "#9e9e9e";
    const moving = /move|step/i.test(action || "");
    const holding = gesture === "hold";

    $("prog").style.strokeDasharray = C.toFixed(1);
    $("prog").style.strokeDashoffset = (C * (1 - frac)).toFixed(1);
    $("prog").style.stroke = gcol;
    $("ring").style.stroke = holding ? "#ef5350" : (moving ? "#ff9800" : "#555");
    const ptr = $("pointer");
    ptr.style.transformOrigin = "100px 100px";
    ptr.style.transform = "rotate(" + this._shown.toFixed(1) + "deg)";

    const wrap = $("wrap");
    wrap.classList.toggle("moving", moving);
    wrap.classList.toggle("holding", holding);
    $("spin").setAttribute("opacity", moving ? "0.9" : "0");

    const glyphs = { "turn right": "↻", "turn left": "↺",
      "press": "●", "double press": "◉", "hold": "⬤",
      "hold + turn right": "↻", "hold + turn left": "↺" };
    $("glyph").textContent = glyphs[gesture] || "○";
    $("pct").textContent = (frac * 100).toFixed(0) + "%";

    const gEl = $("gesture");
    gEl.textContent = gesture;
    gEl.style.color = gcol;
    $("action").textContent = "action: " + (action || "—");
    $("angle").textContent = "dial: " + aSt.state + "°";
    try {
      $("stamp").textContent = "last event: " +
        new Date(actSt ? actSt.last_updated : gSt.last_updated).toLocaleTimeString();
    } catch (e) { $("stamp").textContent = ""; }
    const stEl = $("status");
    stEl.textContent = holding ? "HOLDING" : (moving ? "TURNING" : "idle");
    stEl.style.color = holding ? "#ef5350" : (moving ? "#ff9800" : "#888");

    // flash on every new gesture
    if (gesture !== this._lastGesture) {
      this._lastGesture = gesture;
      const f = $("flash");
      f.classList.remove("flash");
      void f.getBoundingClientRect();
      f.classList.add("flash");
    }
  }
}
customElements.define("knob-animated-card", KnobAnimatedCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "knob-animated-card",
  name: "Knob Animated Dial",
  description: "Fully animated SVG dial for the Hue Tap dial / knob.",
});
