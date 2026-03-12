import { useState, useRef, useCallback, useEffect, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════════════════
   IEMCAD v3.0 ULTIMATE — Circuit Design, Simulation & Diagnostics Platform
   IEM Salt Lake, Kolkata — Institute of Engineering & Management
   
   ARCHITECTURE: Plugin-ready, extensible, update-friendly
   ═══════════════════════════════════════════════════════════════════════════════ */

// ═══ PLUGIN REGISTRY — Add new features without touching core code ═══════════
const PluginRegistry = { components: {}, analyzers: [], exporters: [], version: "3.0.0" };
const registerPlugin = (type, plugin) => {
  if (type === "component") PluginRegistry.components[plugin.type] = plugin;
  if (type === "analyzer") PluginRegistry.analyzers.push(plugin);
  if (type === "exporter") PluginRegistry.exporters.push(plugin);
};

// ═══ SOUND ENGINE ════════════════════════════════════════════════════════════
const Snd = (() => {
  let c = null;
  const g = () => { if (!c) c = new (window.AudioContext || window.webkitAudioContext)(); return c; };
  const p = (f, d = 0.08, t = "sine", v = 0.1) => {
    try {
      const x = g(), o = x.createOscillator(), gn = x.createGain();
      o.type = t; o.frequency.value = f;
      gn.gain.setValueAtTime(v, x.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.001, x.currentTime + d);
      o.connect(gn); gn.connect(x.destination);
      o.start(x.currentTime); o.stop(x.currentTime + d);
    } catch (e) { }
  };
  return {
    click: () => p(800, .04, "sine", .06), place: () => p(520, .1, "triangle", .08),
    wire: () => p(1200, .06, "sine", .05), connect: () => { p(880, .08, "sine", .08); setTimeout(() => p(1100, .1, "sine", .06), 50); },
    del: () => { p(300, .1, "sawtooth", .06); setTimeout(() => p(200, .15, "sawtooth", .05), 50); },
    simOn: () => { [523, 659, 784].forEach((f, i) => setTimeout(() => p(f, .12, "triangle", .08), i * 70)); },
    simOff: () => { [784, 659, 523].forEach((f, i) => setTimeout(() => p(f, .1, "triangle", .06), i * 70)); },
    undo: () => p(400, .06), redo: () => p(600, .06), rot: () => p(900, .05, "triangle", .05),
    err: () => { p(200, .15, "square", .08); setTimeout(() => p(150, .2, "square", .06), 100); },
    ok: () => { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => p(f, .1, "sine", .08), i * 50)); },
    egg: () => { [262, 294, 330, 349, 392, 440, 494, 523].forEach((f, i) => setTimeout(() => p(f, .12, "triangle", .1), i * 80)); },
    snap: () => p(2000, .02, "sine", .04), sw: () => p(1000, .03, "square", .08),
    warn: () => { p(440, .1, "square", .06); setTimeout(() => p(440, .15, "square", .04), 120); },
    diag: () => { p(660, .08, "triangle", .06); setTimeout(() => p(880, .1, "triangle", .08), 80); },
  };
})();

// ═══ CONSTANTS ═══════════════════════════════════════════════════════════════
const G = 20, SNAP = v => Math.round(v / G) * G, PIN_SNAP = 20;

// ═══ PIN POSITION (FIXED — Y-axis bug eliminated) ═══════════════════════════
const pinPos = (comp) => {
  const { x, y, rotation: rot = 0, type, pins: n = 2 } = comp;
  const rad = rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const R = (dx, dy) => ({ x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos });

  const vertSrc = ["vdc", "vac", "idc", "iac", "battery_9v", "battery_aa", "battery_12v", "solar_cell"];
  if (vertSrc.includes(type)) return [R(0, -38), R(0, 38)];
  if (["gnd", "vcc", "vdd", "antenna", "test_point", "logic_probe"].includes(type)) return [R(0, -22)];
  const tri3 = ["npn", "pnp", "nmos", "pmos", "jfet_n", "jfet_p", "scr", "triac", "igbt", "opamp", "comparator",
    "ic_7805", "ic_7812", "ic_lm317", "temp_sensor", "humidity_sensor", "pir_sensor", "ir_sensor",
    "hall_sensor", "pressure_sensor", "motor_servo", "encoder", "switch_spdt"];
  if (tri3.includes(type)) return [R(-42, 0), R(32, -24), R(32, 24)];
  const gates = ["and_gate", "or_gate", "nand_gate", "nor_gate", "xor_gate", "xnor_gate"];
  if (gates.includes(type)) return [R(-40, -12), R(-40, 12), R(40, 0)];
  if (["not_gate", "buffer"].includes(type)) return [R(-40, 0), R(40, 0)];
  const p4 = ["dff", "sr_latch", "relay", "ultrasonic", "transformer", "motor_stepper", "led_rgb", "usb_conn"];
  if (p4.includes(type)) return [R(-42, -16), R(-42, 16), R(42, -16), R(42, 16)];
  if (["jkff", "gas_sensor"].includes(type)) return [R(-42, -18), R(-42, 0), R(-42, 18), R(42, -10), R(42, 10)];
  const p6 = ["mux", "decoder", "counter_4bit", "accelerometer"];
  if (p6.includes(type)) return [R(-42, -18), R(-42, 0), R(-42, 18), R(42, -18), R(42, 0), R(42, 18)];
  if (n >= 8) {
    const half = Math.ceil(n / 2), h = Math.max(32, half * 13);
    return Array.from({ length: n }, (_, i) => {
      const side = i < half ? -1 : 1, idx = i < half ? i : i - half, tot = i < half ? half : n - half;
      const sp = (h * 2) / Math.max(tot - 1, 1), yy = tot === 1 ? 0 : -h + idx * sp;
      return R(side * 48, yy);
    });
  }
  return [R(-42, 0), R(42, 0)];
};

const findPin = (px, py, comps) => {
  let best = null, bd = PIN_SNAP;
  for (const c of comps) for (const pin of pinPos(c)) {
    const d = Math.hypot(px - pin.x, py - pin.y);
    if (d < bd) { bd = d; best = { ...pin, compId: c.id }; }
  }
  return best;
};
const snapPt = (px, py, comps) => {
  const pin = findPin(px, py, comps);
  return pin ? { x: pin.x, y: pin.y, snapped: true, compId: pin.compId } : { x: SNAP(px), y: SNAP(py), snapped: false };
};

// ═══ FORMAT ══════════════════════════════════════════════════════════════════
const fmt = (v, u) => {
  if (!u) return ""; const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}G${u}`; if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M${u}`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k${u}`; if (a >= 1) return `${Number(v.toFixed(2))}${u}`;
  if (a >= 1e-3) return `${(v * 1e3).toFixed(1)}m${u}`; if (a >= 1e-6) return `${(v * 1e6).toFixed(1)}µ${u}`;
  if (a >= 1e-9) return `${(v * 1e9).toFixed(1)}n${u}`; return `${(v * 1e12).toFixed(1)}p${u}`;
};

// ═══ COMPONENT LIBRARY ══════════════════════════════════════════════════════
const LIB = {
  "⚡ Passive": [
    { type: "resistor", label: "Resistor", sym: "R", unit: "Ω", def: 1000, color: "#F59E0B", pins: 2, desc: "Limits current", meterConfig: { min: 0, max: 10e6, step: 1 } },
    { type: "capacitor", label: "Capacitor", sym: "C", unit: "F", def: 1e-6, color: "#3B82F6", pins: 2, desc: "Stores charge", meterConfig: { min: 1e-12, max: 1, step: 1e-12 } },
    { type: "inductor", label: "Inductor", sym: "L", unit: "H", def: 1e-3, color: "#A855F7", pins: 2, desc: "Stores magnetic energy", meterConfig: { min: 1e-9, max: 100, step: 1e-6 } },
    { type: "potentiometer", label: "Potentiometer", sym: "POT", unit: "Ω", def: 10000, color: "#F59E0B", pins: 3, desc: "Variable resistor" },
    { type: "rheostat", label: "Rheostat", sym: "RH", unit: "Ω", def: 5000, color: "#D97706", pins: 2 },
    { type: "thermistor", label: "Thermistor", sym: "TH", unit: "Ω", def: 10000, color: "#EF4444", pins: 2, desc: "Temp-sensitive" },
    { type: "ldr", label: "LDR", sym: "LDR", unit: "Ω", def: 50000, color: "#84CC16", pins: 2, desc: "Light dependent" },
    { type: "fuse", label: "Fuse", sym: "F", unit: "A", def: 1, color: "#EF4444", pins: 2, desc: "Overcurrent protection" },
    { type: "crystal", label: "Crystal Osc", sym: "Y", unit: "Hz", def: 16e6, color: "#06B6D4", pins: 2 },
  ],
  "🔌 Active": [
    { type: "npn", label: "NPN BJT", sym: "Q", unit: "", def: 0, color: "#EC4899", pins: 3, desc: "NPN transistor" },
    { type: "pnp", label: "PNP BJT", sym: "Q", unit: "", def: 0, color: "#EC4899", pins: 3, desc: "PNP transistor" },
    { type: "nmos", label: "N-MOSFET", sym: "M", unit: "", def: 0, color: "#14B8A6", pins: 3 },
    { type: "pmos", label: "P-MOSFET", sym: "M", unit: "", def: 0, color: "#14B8A6", pins: 3 },
    { type: "opamp", label: "Op-Amp", sym: "U", unit: "", def: 0, color: "#6366F1", pins: 3, desc: "Operational amplifier" },
    { type: "comparator", label: "Comparator", sym: "CMP", unit: "", def: 0, color: "#8B5CF6", pins: 3 },
    { type: "scr", label: "SCR", sym: "SCR", unit: "", def: 0, color: "#DC2626", pins: 3 },
    { type: "triac", label: "TRIAC", sym: "TR", unit: "", def: 0, color: "#DC2626", pins: 3 },
    { type: "igbt", label: "IGBT", sym: "IG", unit: "", def: 0, color: "#059669", pins: 3 },
  ],
  "💡 Diodes/LEDs": [
    { type: "diode", label: "Diode", sym: "D", unit: "V", def: 0.7, color: "#EF4444", pins: 2 },
    { type: "led_green", label: "Green LED", sym: "LED", unit: "V", def: 2.2, color: "#22C55E", pins: 2, ledColor: "#22C55E" },
    { type: "led_red", label: "Red LED", sym: "LED", unit: "V", def: 1.8, color: "#EF4444", pins: 2, ledColor: "#EF4444" },
    { type: "led_blue", label: "Blue LED", sym: "LED", unit: "V", def: 3.2, color: "#3B82F6", pins: 2, ledColor: "#3B82F6" },
    { type: "led_yellow", label: "Yellow LED", sym: "LED", unit: "V", def: 2.0, color: "#EAB308", pins: 2, ledColor: "#EAB308" },
    { type: "led_white", label: "White LED", sym: "LED", unit: "V", def: 3.4, color: "#E2E8F0", pins: 2, ledColor: "#E2E8F0" },
    { type: "zener", label: "Zener", sym: "DZ", unit: "V", def: 5.1, color: "#F97316", pins: 2 },
    { type: "schottky", label: "Schottky", sym: "DS", unit: "V", def: 0.3, color: "#A855F7", pins: 2 },
    { type: "photodiode", label: "Photodiode", sym: "PD", unit: "", def: 0, color: "#06B6D4", pins: 2 },
  ],
  "🔋 Power": [
    { type: "vdc", label: "DC Voltage", sym: "V", unit: "V", def: 5, color: "#10B981", pins: 2, desc: "DC source", meterConfig: { min: 0, max: 1000, step: 0.1 } },
    { type: "vac", label: "AC Voltage", sym: "V~", unit: "V", def: 220, color: "#06B6D4", pins: 2, desc: "AC source" },
    { type: "idc", label: "DC Current", sym: "I", unit: "A", def: 0.01, color: "#F472B6", pins: 2 },
    { type: "battery_9v", label: "9V Battery", sym: "BAT", unit: "V", def: 9, color: "#10B981", pins: 2 },
    { type: "battery_aa", label: "1.5V Cell", sym: "BAT", unit: "V", def: 1.5, color: "#22C55E", pins: 2 },
    { type: "battery_12v", label: "12V Battery", sym: "BAT", unit: "V", def: 12, color: "#059669", pins: 2 },
    { type: "solar_cell", label: "Solar Cell", sym: "SC", unit: "V", def: 0.6, color: "#EAB308", pins: 2 },
    { type: "gnd", label: "Ground", sym: "GND", unit: "", def: 0, color: "#6B7280", pins: 1 },
    { type: "vcc", label: "VCC +5V", sym: "VCC", unit: "V", def: 5, color: "#EF4444", pins: 1 },
    { type: "transformer", label: "Transformer", sym: "T", unit: "", def: 1, color: "#8B5CF6", pins: 4 },
  ],
  "📊 Meters": [
    { type: "voltmeter", label: "Voltmeter", sym: "VM", unit: "V", def: 0, color: "#FBBF24", pins: 2, desc: "Voltage measurement", meterConfig: { min: -1000, max: 1000, step: 0.01, range: "auto", displayUnit: "V" } },
    { type: "ammeter", label: "Ammeter", sym: "AM", unit: "A", def: 0, color: "#FB923C", pins: 2, desc: "Current measurement", meterConfig: { min: -10, max: 10, step: 0.001, range: "auto", displayUnit: "A" } },
    { type: "ohmmeter", label: "Ohmmeter", sym: "ΩM", unit: "Ω", def: 0, color: "#34D399", pins: 2, desc: "Resistance measurement", meterConfig: { min: 0, max: 10e6, step: 0.1, range: "auto", displayUnit: "Ω" } },
    { type: "wattmeter", label: "Wattmeter", sym: "WM", unit: "W", def: 0, color: "#F472B6", pins: 2, desc: "Power measurement", meterConfig: { min: 0, max: 10000, step: 0.001, range: "auto", displayUnit: "W" } },
    { type: "multimeter", label: "Multimeter", sym: "DMM", unit: "V", def: 0, color: "#FCD34D", pins: 2, desc: "V/A/Ω multi-mode", meterConfig: { mode: "V", modes: ["V", "A", "Ω", "Hz"], range: "auto" } },
    { type: "oscilloscope", label: "Oscilloscope", sym: "OSC", unit: "V", def: 0, color: "#22D3EE", pins: 2, desc: "Waveform viewer", meterConfig: { timeDiv: 0.001, voltDiv: 1, trigger: "auto" } },
    { type: "freq_counter", label: "Freq Counter", sym: "FC", unit: "Hz", def: 0, color: "#2DD4BF", pins: 2, desc: "Frequency measurement", meterConfig: { range: "auto", gate: 1 } },
    { type: "capacitance_meter", label: "Cap Meter", sym: "CM", unit: "F", def: 0, color: "#818CF8", pins: 2, desc: "Capacitance", meterConfig: { range: "auto" } },
    { type: "inductance_meter", label: "Ind Meter", sym: "LM", unit: "H", def: 0, color: "#C084FC", pins: 2, desc: "Inductance" },
    { type: "power_factor_meter", label: "PF Meter", sym: "PF", unit: "", def: 0, color: "#F9A8D4", pins: 2, desc: "cos φ" },
    { type: "energy_meter", label: "Energy Meter", sym: "EM", unit: "kWh", def: 0, color: "#86EFAC", pins: 2, desc: "Cumulative energy" },
    { type: "lux_meter", label: "Lux Meter", sym: "LX", unit: "lx", def: 0, color: "#FDE68A", pins: 2, desc: "Light intensity" },
    { type: "temp_meter", label: "Temp Meter", sym: "TM", unit: "°C", def: 0, color: "#FCA5A5", pins: 2 },
    { type: "db_meter", label: "dB Meter", sym: "dB", unit: "dB", def: 0, color: "#D8B4FE", pins: 2 },
    { type: "logic_probe", label: "Logic Probe", sym: "LP", unit: "", def: 0, color: "#A78BFA", pins: 1, desc: "H/L indicator" },
  ],
  "🖥 Digital": [
    { type: "and_gate", label: "AND", sym: "AND", unit: "", def: 0, color: "#8B5CF6", pins: 3 },
    { type: "or_gate", label: "OR", sym: "OR", unit: "", def: 0, color: "#7C3AED", pins: 3 },
    { type: "not_gate", label: "NOT", sym: "NOT", unit: "", def: 0, color: "#6D28D9", pins: 2 },
    { type: "nand_gate", label: "NAND", sym: "NAND", unit: "", def: 0, color: "#A855F7", pins: 3 },
    { type: "nor_gate", label: "NOR", sym: "NOR", unit: "", def: 0, color: "#9333EA", pins: 3 },
    { type: "xor_gate", label: "XOR", sym: "XOR", unit: "", def: 0, color: "#C084FC", pins: 3 },
    { type: "buffer", label: "Buffer", sym: "BUF", unit: "", def: 0, color: "#818CF8", pins: 2 },
    { type: "dff", label: "D Flip-Flop", sym: "DFF", unit: "", def: 0, color: "#A855F7", pins: 4 },
    { type: "sr_latch", label: "SR Latch", sym: "SR", unit: "", def: 0, color: "#6366F1", pins: 4 },
  ],
  "🔧 Electromech": [
    { type: "switch_spst", label: "Switch SPST", sym: "SW", unit: "", def: 0, color: "#A3A3A3", pins: 2, desc: "Toggle switch" },
    { type: "push_btn", label: "Push Button", sym: "PB", unit: "", def: 0, color: "#60A5FA", pins: 2 },
    { type: "relay", label: "Relay", sym: "RL", unit: "V", def: 5, color: "#F97316", pins: 4 },
    { type: "motor_dc", label: "DC Motor", sym: "M", unit: "V", def: 12, color: "#10B981", pins: 2 },
    { type: "buzzer", label: "Buzzer", sym: "BZ", unit: "Hz", def: 2000, color: "#D946EF", pins: 2 },
    { type: "speaker", label: "Speaker", sym: "SP", unit: "Ω", def: 8, color: "#F472B6", pins: 2 },
  ],
  "📡 Sensors": [
    { type: "temp_sensor", label: "Temp Sensor", sym: "TMP", unit: "°C", def: 25, color: "#EF4444", pins: 3, meterConfig: { min: -40, max: 125 } },
    { type: "humidity_sensor", label: "Humidity", sym: "HUM", unit: "%", def: 50, color: "#3B82F6", pins: 3 },
    { type: "pir_sensor", label: "PIR", sym: "PIR", unit: "", def: 0, color: "#22C55E", pins: 3 },
    { type: "ultrasonic", label: "Ultrasonic", sym: "US", unit: "cm", def: 100, color: "#06B6D4", pins: 4 },
    { type: "ir_sensor", label: "IR Sensor", sym: "IR", unit: "", def: 0, color: "#DC2626", pins: 3 },
    { type: "hall_sensor", label: "Hall Effect", sym: "HALL", unit: "", def: 0, color: "#7C3AED", pins: 3 },
  ],
  "🔲 ICs": [
    { type: "ic_555", label: "555 Timer", sym: "555", unit: "", def: 0, color: "#0EA5E9", pins: 8 },
    { type: "ic_7805", label: "7805 Reg", sym: "7805", unit: "V", def: 5, color: "#059669", pins: 3 },
    { type: "ic_7segment", label: "7-Segment", sym: "7SEG", unit: "", def: 0, color: "#EF4444", pins: 10 },
    { type: "arduino_uno", label: "Arduino UNO", sym: "ARD", unit: "", def: 0, color: "#0EA5E9", pins: 20 },
    { type: "esp32", label: "ESP32", sym: "ESP", unit: "", def: 0, color: "#E11D48", pins: 30 },
  ],
};

// ═══ CIRCUIT DIAGNOSTICS ENGINE ══════════════════════════════════════════════
const diagnoseCircuit = (comps, wires) => {
  const issues = [];
  const hasSrc = comps.some(c => ["vdc", "vac", "idc", "iac", "solar_cell"].includes(c.type) || c.type.startsWith("battery"));
  const hasGnd = comps.some(c => c.type === "gnd");
  const hasLoad = comps.some(c => ["resistor", "rheostat", "thermistor", "ldr", "potentiometer", "fuse",
    "led_green", "led_red", "led_blue", "led_yellow", "led_white", "motor_dc", "buzzer", "speaker"].includes(c.type));

  if (comps.length === 0) return [{ type: "info", msg: "Canvas is empty. Add components to start building.", icon: "📋" }];
  if (!hasSrc) issues.push({ type: "error", msg: "No power source found. Add a battery, DC/AC voltage source, or solar cell.", icon: "🔋", fix: "Add a DC Voltage source or Battery from the Power category." });
  if (!hasGnd && hasSrc) issues.push({ type: "warn", msg: "No ground reference. Add GND for proper simulation.", icon: "⏚", fix: "Add Ground from Power category and wire it to the negative terminal." });
  if (hasSrc && !hasLoad) issues.push({ type: "warn", msg: "No load component. Add a resistor, LED, or motor.", icon: "💡", fix: "Add a Resistor or LED to create a current path." });

  // Check for unconnected components
  comps.forEach(c => {
    const pins = pinPos(c);
    const connectedPins = pins.filter(pin =>
      wires.some(w => Math.hypot(w.x1 - pin.x, w.y1 - pin.y) < 18 || Math.hypot(w.x2 - pin.x, w.y2 - pin.y) < 18)
    );
    if (connectedPins.length === 0 && c.type !== "gnd" && c.type !== "vcc" && c.type !== "vdd") {
      issues.push({ type: "warn", msg: `${c.label} (${c.type.replace(/_/g, " ")}) has no wires connected.`, icon: "🔌", fix: `Use Wire tool (W) to connect ${c.label} to other components.` });
    } else if (connectedPins.length < 2 && pins.length >= 2) {
      issues.push({ type: "warn", msg: `${c.label} only has ${connectedPins.length}/${pins.length} pins connected.`, icon: "⚠️", fix: `Connect remaining pins of ${c.label} to complete the circuit.` });
    }
  });

  // Check for open/closed switches
  comps.forEach(c => {
    if (["switch_spst", "switch_spdt", "push_btn"].includes(c.type) && !c.switchState) {
      issues.push({ type: "info", msg: `${c.label} is OPEN — no current flows through it.`, icon: "🔓", fix: "Click the switch or toggle it in Properties to close it." });
    }
  });

  // Fuse check
  comps.forEach(c => {
    if (c.type === "fuse") {
      const totalV = comps.reduce((s, cc) => s + (["vdc", "vac"].includes(cc.type) || cc.type.startsWith("battery") ? cc.value : 0), 0);
      const totalR = comps.reduce((s, cc) => s + (cc.type === "resistor" ? cc.value : 0), 0) || 1000;
      if (totalV / totalR > c.value) {
        issues.push({ type: "error", msg: `${c.label} BLOWN! Circuit current ${(totalV / totalR).toFixed(3)}A exceeds ${c.value}A rating.`, icon: "💥", fix: `Increase fuse rating or add more resistance.` });
      }
    }
  });

  // Check path continuity
  if (hasSrc && hasLoad && wires.length > 0) {
    const srcComp = comps.find(c => ["vdc", "vac", "idc"].includes(c.type) || c.type.startsWith("battery"));
    if (srcComp) {
      const srcPins = pinPos(srcComp);
      const connected = new Set();
      const visit = (px, py) => {
        const key = `${Math.round(px)},${Math.round(py)}`;
        if (connected.has(key)) return;
        connected.add(key);
        wires.forEach(w => {
          if (Math.hypot(w.x1 - px, w.y1 - py) < 18) visit(w.x2, w.y2);
          if (Math.hypot(w.x2 - px, w.y2 - py) < 18) visit(w.x1, w.y1);
        });
      };
      if (srcPins[0]) visit(srcPins[0].x, srcPins[0].y);
      const srcPin2Connected = srcPins[1] && connected.has(`${Math.round(srcPins[1].x)},${Math.round(srcPins[1].y)}`);
      if (!srcPin2Connected && srcPins.length >= 2) {
        issues.push({ type: "error", msg: "Circuit is OPEN — no complete loop back to the source.", icon: "🔄", fix: "Ensure wires form a complete loop from + terminal through components back to − terminal." });
      }
    }
  }

  if (issues.length === 0 && comps.length > 0) {
    if (hasSrc && hasLoad && wires.length > 0) issues.push({ type: "ok", msg: "Circuit looks good! Hit RUN to simulate.", icon: "✅" });
    else issues.push({ type: "info", msg: "Keep building — add more components and wires.", icon: "🔨" });
  }
  return issues;
};

// ═══ SIMULATION ENGINE ══════════════════════════════════════════════════════
const simulate = (comps, wires) => {
  const R = {};
  let V = 0, Rtot = 0, Ctot = 0, Ltot = 0, hasSrc = false, hasAC = false;

  comps.forEach(c => {
    if (["vdc", "vac", "idc", "iac", "solar_cell"].includes(c.type) || c.type.startsWith("battery")) { V += c.value; hasSrc = true; }
    if (c.type === "vac" || c.type === "iac") hasAC = true;
    if (["resistor", "rheostat", "thermistor", "ldr", "potentiometer", "fuse"].includes(c.type)) Rtot += c.value;
    if (c.type === "capacitor") Ctot += c.value;
    if (c.type === "inductor") Ltot += c.value;
  });
  if (!hasSrc) V = 0; if (Rtot === 0) Rtot = 1000;
  const I = hasSrc ? V / Rtot : 0;
  const P = V * I;
  const t = Date.now() / 1000;

  // Check for open switches breaking the circuit
  const hasOpenSwitch = comps.some(c => ["switch_spst", "switch_spdt", "push_btn"].includes(c.type) && !c.switchState &&
    wires.some(w => { const ps = pinPos(c); return ps.some(p => Math.hypot(w.x1 - p.x, w.y1 - p.y) < 18 || Math.hypot(w.x2 - p.x, w.y2 - p.y) < 18); }));
  const effectiveI = hasOpenSwitch ? 0 : I;
  const effectiveV = hasOpenSwitch ? 0 : V;

  comps.forEach(c => {
    const s = { voltage: 0, current: 0, power: 0, active: false, brightness: 0, reading: null, flowing: false, whyNotFlowing: null };
    const pins = pinPos(c);
    const connPins = pins.filter(pin => wires.some(w => Math.hypot(w.x1 - pin.x, w.y1 - pin.y) < 18 || Math.hypot(w.x2 - pin.x, w.y2 - pin.y) < 18));
    const conn = connPins.length > 0;
    const fullyConn = connPins.length >= Math.min(2, pins.length);
    const isConn = conn && hasSrc && fullyConn;

    // Determine why not flowing
    if (!hasSrc) s.whyNotFlowing = "No power source in circuit";
    else if (!conn) s.whyNotFlowing = "Component not wired to circuit";
    else if (!fullyConn) s.whyNotFlowing = `Only ${connPins.length}/${pins.length} pins connected`;
    else if (hasOpenSwitch) s.whyNotFlowing = "Open switch breaking circuit path";
    else if (V === 0) s.whyNotFlowing = "Source voltage is 0V";

    s.flowing = isConn && effectiveI > 0 && !hasOpenSwitch;

    // Passive
    if (["resistor", "rheostat", "thermistor", "ldr", "potentiometer", "fuse"].includes(c.type)) {
      s.voltage = effectiveI * c.value; s.current = effectiveI; s.power = effectiveI * effectiveI * c.value; s.active = s.flowing;
    } else if (c.type === "capacitor") {
      s.voltage = effectiveV * (1 - Math.exp(-(t % 5))); s.current = effectiveI * Math.exp(-(t % 5)); s.active = s.flowing;
    } else if (c.type === "inductor") {
      s.voltage = effectiveV * Math.exp(-(t % 5)); s.current = effectiveI * (1 - Math.exp(-(t % 5))); s.active = s.flowing;
    } else if (c.type.startsWith("led_")) {
      s.voltage = c.value || 2; s.current = effectiveI; s.brightness = Math.min(1, effectiveI * 80); s.active = s.flowing && effectiveI > .001;
    } else if (["diode", "zener", "schottky", "photodiode"].includes(c.type)) {
      s.voltage = c.value || .7; s.current = effectiveI; s.active = s.flowing;
    } else if (["vdc", "vac", "idc", "iac", "solar_cell"].includes(c.type) || c.type.startsWith("battery")) {
      s.voltage = c.type === "vac" ? c.value * Math.sin(2 * Math.PI * 50 * t) : c.value; s.current = effectiveI; s.active = true; s.flowing = true;
    } else if (["gnd", "vcc", "vdd"].includes(c.type)) {
      s.voltage = c.value; s.active = true; s.flowing = true;
    }
    // ─── METERS (all editable, all show readings always) ───
    else if (c.type === "voltmeter") {
      s.voltage = s.flowing ? effectiveV : 0; s.active = conn;
      s.reading = s.flowing ? `${effectiveV.toFixed(2)} V` : "0.00 V";
      s.meterValue = s.flowing ? effectiveV : 0; s.meterMax = c.value || 300; s.meterUnit = "V";
    } else if (c.type === "ammeter") {
      const mA = s.flowing ? effectiveI * 1000 : 0; s.current = mA / 1000; s.active = conn;
      s.reading = `${mA.toFixed(2)} mA`; s.meterValue = mA; s.meterMax = (c.value || 1) * 1000; s.meterUnit = "mA";
    } else if (c.type === "ohmmeter") {
      s.active = conn; s.reading = `${fmt(Rtot, "Ω")}`; s.meterValue = Rtot; s.meterUnit = "Ω";
    } else if (c.type === "wattmeter") {
      const mW = s.flowing ? P * 1000 : 0; s.power = P; s.active = conn;
      s.reading = `${mW.toFixed(2)} mW`; s.meterValue = mW; s.meterUnit = "mW";
    } else if (c.type === "multimeter") {
      s.active = conn;
      const mode = c.meterMode || "V";
      if (mode === "V") s.reading = `${(s.flowing ? effectiveV : 0).toFixed(2)} V`;
      else if (mode === "A") s.reading = `${(s.flowing ? effectiveI * 1000 : 0).toFixed(2)} mA`;
      else if (mode === "Ω") s.reading = `${fmt(Rtot, "Ω")}`;
      else if (mode === "Hz") s.reading = hasAC ? "50.00 Hz" : "0.00 Hz";
      s.meterMode = mode;
    } else if (c.type === "freq_counter") {
      s.active = conn; s.reading = hasAC && s.flowing ? "50.00 Hz" : "0.00 Hz";
    } else if (c.type === "capacitance_meter") {
      s.active = conn; s.reading = Ctot > 0 ? fmt(Ctot, "F") : "0 F";
    } else if (c.type === "inductance_meter") {
      s.active = conn; s.reading = Ltot > 0 ? fmt(Ltot, "H") : "0 H";
    } else if (c.type === "power_factor_meter") {
      s.active = conn; s.reading = hasAC && s.flowing ? `cosφ=${(0.85 + Math.sin(t) * .1).toFixed(2)}` : "cosφ=1.00";
    } else if (c.type === "energy_meter") {
      s.active = conn; s.reading = s.flowing ? `${(P * t / 3.6e6).toFixed(4)} kWh` : "0.0000 kWh";
    } else if (c.type === "lux_meter") {
      const hasLed = comps.some(cc => cc.type.startsWith("led_"));
      s.active = conn; s.reading = hasLed && s.flowing ? `${Math.round(200 + Math.sin(t) * 50)} lx` : "0 lx";
    } else if (c.type === "temp_meter") {
      const ts = comps.find(cc => cc.type === "temp_sensor"); s.active = conn;
      s.reading = ts ? `${ts.value.toFixed(1)} °C` : "25.0 °C";
    } else if (c.type === "db_meter") {
      const hasBz = comps.some(cc => ["buzzer", "speaker"].includes(cc.type));
      s.active = conn; s.reading = hasBz && s.flowing ? `${(60 + Math.sin(t * 3) * 10).toFixed(1)} dB` : "0.0 dB";
    } else if (c.type === "logic_probe") {
      s.active = conn; s.high = s.flowing && effectiveV > 2.5;
    } else if (c.type === "oscilloscope") {
      s.active = s.flowing;
      s.waveform = Array.from({ length: 120 }, (_, i) => {
        const tt = i / 120;
        return hasAC && s.flowing ? effectiveV * Math.sin(2 * Math.PI * 3 * tt + t * 5) : (s.flowing ? effectiveV * .9 : 0);
      });
    } else if (["switch_spst", "switch_spdt", "push_btn"].includes(c.type)) {
      s.closed = c.switchState || false; s.active = conn; s.flowing = s.closed && conn;
      if (!s.closed) s.whyNotFlowing = "Switch is OPEN";
    } else if (["buzzer", "speaker"].includes(c.type)) {
      s.active = s.flowing && effectiveI > .001;
    } else if (c.type === "motor_dc") {
      s.voltage = s.flowing ? effectiveV : 0; s.current = s.flowing ? effectiveI : 0; s.active = s.flowing;
      s.reading = s.flowing ? `${Math.round(effectiveV * 120)} RPM` : "0 RPM";
    } else {
      s.active = s.flowing; s.voltage = s.flowing ? effectiveV * .5 : 0; s.current = s.flowing ? effectiveI : 0;
    }
    s.power = s.power || Math.abs(s.voltage * s.current);
    R[c.id] = s;
  });
  return R;
};

// ═══ COMPONENT SVG ══════════════════════════════════════════════════════════
const CompSVG = ({ type, color, ledColor, sim, sd }) => {
  const glow = sim && sd?.active, lc = ledColor || color, br = sd?.brightness || 0;

  if (["resistor", "rheostat", "thermistor", "potentiometer", "ldr", "fuse"].includes(type)) {
    if (type === "fuse") return <g><line x1="-42" y1="0" x2="-15" y2="0" stroke={color} strokeWidth="2.5" /><line x1="15" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" /><rect x="-15" y="-8" width="30" height="16" rx="3" fill="none" stroke={color} strokeWidth="2" /><path d="M-8,0 Q0,-6 8,0" fill="none" stroke={color} strokeWidth="1.5" /></g>;
    return <g><path d="M-42,0 L-26,0 L-22,-9 L-12,9 L-2,-9 L8,9 L18,-9 L22,0 L42,0" fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />{type === "potentiometer" && <><line x1="0" y1="-24" x2="0" y2="-8" stroke={color} strokeWidth="2" /><polygon points="-4,-8 4,-8 0,-3" fill={color} /></>}{type === "thermistor" && <text x="0" y="-14" textAnchor="middle" fill={color} fontSize="9" fontWeight="700">T°</text>}{type === "ldr" && <><line x1="-14" y1="-18" x2="-8" y2="-12" stroke={color} strokeWidth="1.5" /><line x1="-8" y1="-18" x2="-2" y2="-12" stroke={color} strokeWidth="1.5" /></>}</g>;
  }
  if (type === "capacitor") return <g><line x1="-42" y1="0" x2="-5" y2="0" stroke={color} strokeWidth="2.5" /><line x1="42" y1="0" x2="5" y2="0" stroke={color} strokeWidth="2.5" /><line x1="-5" y1="-15" x2="-5" y2="15" stroke={color} strokeWidth="3" /><path d="M5,-15 Q9,0 5,15" fill="none" stroke={color} strokeWidth="3" /></g>;
  if (type === "inductor") return <g><line x1="-42" y1="0" x2="-26" y2="0" stroke={color} strokeWidth="2.5" /><line x1="26" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" />{[0, 1, 2, 3].map(i => <path key={i} d={`M${-26 + i * 13},0 Q${-19.5 + i * 13},-14 ${-13 + i * 13},0`} fill="none" stroke={color} strokeWidth="2.5" />)}</g>;
  if (type === "crystal") return <g><line x1="-42" y1="0" x2="-12" y2="0" stroke={color} strokeWidth="2.5" /><line x1="12" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" /><rect x="-8" y="-10" width="16" height="20" rx="2" fill="none" stroke={color} strokeWidth="2" /><line x1="-12" y1="-14" x2="-12" y2="14" stroke={color} strokeWidth="2" /><line x1="12" y1="-14" x2="12" y2="14" stroke={color} strokeWidth="2" /></g>;

  if (type.startsWith("led_")) return <g><line x1="-42" y1="0" x2="-10" y2="0" stroke={lc} strokeWidth="2.5" /><line x1="10" y1="0" x2="42" y2="0" stroke={lc} strokeWidth="2.5" /><polygon points="-10,-12 10,0 -10,12" fill={glow ? lc : "none"} opacity={glow ? .5 + br * .4 : .15} stroke={lc} strokeWidth="2" /><line x1="10" y1="-12" x2="10" y2="12" stroke={lc} strokeWidth="2.5" />{glow && <circle cx="0" cy="0" r="24" fill={lc} opacity={.1 + br * .2} />}<line x1="15" y1="-16" x2="22" y2="-23" stroke={lc} strokeWidth="1.5" /><line x1="20" y1="-12" x2="27" y2="-19" stroke={lc} strokeWidth="1.5" /></g>;
  if (["diode", "schottky", "photodiode"].includes(type)) return <g><line x1="-42" y1="0" x2="-10" y2="0" stroke={color} strokeWidth="2.5" /><line x1="10" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" /><polygon points="-10,-11 10,0 -10,11" fill={color} opacity=".2" stroke={color} strokeWidth="2" /><line x1="10" y1="-11" x2="10" y2="11" stroke={color} strokeWidth="2.5" /></g>;
  if (type === "zener") return <g><line x1="-42" y1="0" x2="-10" y2="0" stroke={color} strokeWidth="2.5" /><line x1="10" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" /><polygon points="-10,-11 10,0 -10,11" fill={color} opacity=".2" stroke={color} strokeWidth="2" /><polyline points="7,-13 10,-11 10,11 13,13" fill="none" stroke={color} strokeWidth="2.5" /></g>;

  const srcV = ["vdc", "battery_9v", "battery_aa", "battery_12v", "solar_cell"];
  if (srcV.includes(type)) return <g><circle cx="0" cy="0" r="22" fill="none" stroke={color} strokeWidth="2.5" /><line x1="0" y1="-38" x2="0" y2="-22" stroke={color} strokeWidth="2.5" /><line x1="0" y1="22" x2="0" y2="38" stroke={color} strokeWidth="2.5" /><text x="-5" y="-4" fill={color} fontSize="12" fontWeight="700">+</text><text x="-3" y="14" fill={color} fontSize="12" fontWeight="700">−</text></g>;
  if (type === "vac" || type === "iac") return <g><circle cx="0" cy="0" r="22" fill="none" stroke={color} strokeWidth="2.5" /><line x1="0" y1="-38" x2="0" y2="-22" stroke={color} strokeWidth="2.5" /><line x1="0" y1="22" x2="0" y2="38" stroke={color} strokeWidth="2.5" /><path d="M-9,0 Q-4.5,-11 0,0 Q4.5,11 9,0" fill="none" stroke={color} strokeWidth="2" /></g>;
  if (type === "idc") return <g><circle cx="0" cy="0" r="22" fill="none" stroke={color} strokeWidth="2.5" /><line x1="0" y1="-38" x2="0" y2="-22" stroke={color} strokeWidth="2.5" /><line x1="0" y1="22" x2="0" y2="38" stroke={color} strokeWidth="2.5" /><line x1="0" y1="8" x2="0" y2="-8" stroke={color} strokeWidth="2.5" /><polygon points="-3,-6 3,-6 0,-10" fill={color} /></g>;
  if (type === "gnd") return <g><line x1="0" y1="-22" x2="0" y2="0" stroke={color} strokeWidth="2.5" /><line x1="-16" y1="0" x2="16" y2="0" stroke={color} strokeWidth="2.5" /><line x1="-10" y1="6" x2="10" y2="6" stroke={color} strokeWidth="2" /><line x1="-5" y1="12" x2="5" y2="12" stroke={color} strokeWidth="1.5" /></g>;
  if (type === "vcc" || type === "vdd") return <g><line x1="0" y1="22" x2="0" y2="2" stroke={color} strokeWidth="2.5" /><polygon points="-10,2 10,2 0,-10" fill="none" stroke={color} strokeWidth="2.5" /></g>;

  if (["npn", "pnp"].includes(type)) return <g><line x1="-42" y1="0" x2="-10" y2="0" stroke={color} strokeWidth="2.5" /><line x1="-10" y1="-18" x2="-10" y2="18" stroke={color} strokeWidth="3" /><line x1="-10" y1="-8" x2="28" y2="-24" stroke={color} strokeWidth="2.5" /><line x1="-10" y1="8" x2="28" y2="24" stroke={color} strokeWidth="2.5" />{type === "npn" ? <polygon points="20,20 28,24 22,15" fill={color} /> : <polygon points="-4,3 -10,8 -2,12" fill={color} />}</g>;
  if (["nmos", "pmos"].includes(type)) return <g><line x1="-42" y1="0" x2="-12" y2="0" stroke={color} strokeWidth="2.5" /><line x1="-12" y1="-16" x2="-12" y2="16" stroke={color} strokeWidth="3" /><line x1="-8" y1="-14" x2="-8" y2="-6" stroke={color} strokeWidth="2" /><line x1="-8" y1="-2" x2="-8" y2="6" stroke={color} strokeWidth="2" /><line x1="-8" y1="10" x2="-8" y2="18" stroke={color} strokeWidth="2" /><line x1="-8" y1="-10" x2="28" y2="-24" stroke={color} strokeWidth="2.5" /><line x1="-8" y1="14" x2="28" y2="24" stroke={color} strokeWidth="2.5" /></g>;
  if (["opamp", "comparator"].includes(type)) return <g><polygon points="-28,-28 -28,28 32,0" fill="none" stroke={color} strokeWidth="2.5" /><line x1="-42" y1="0" x2="-28" y2="0" stroke={color} strokeWidth="2" /><text x="-22" y="-10" fill={color} fontSize="12" fontWeight="700">−</text><text x="-22" y="16" fill={color} fontSize="12" fontWeight="700">+</text></g>;

  if (["and_gate", "nand_gate"].includes(type)) return <g><path d="M-22,-20 L-22,20 L0,20 Q26,20 26,0 Q26,-20 0,-20 Z" fill="none" stroke={color} strokeWidth="2.5" />{type === "nand_gate" && <circle cx="30" cy="0" r="4" fill="none" stroke={color} strokeWidth="2" />}<line x1="-40" y1="-12" x2="-22" y2="-12" stroke={color} strokeWidth="2" /><line x1="-40" y1="12" x2="-22" y2="12" stroke={color} strokeWidth="2" /><line x1={type === "nand_gate" ? "34" : "26"} y1="0" x2="40" y2="0" stroke={color} strokeWidth="2" /></g>;
  if (["or_gate", "xor_gate", "nor_gate"].includes(type)) return <g>{type === "xor_gate" && <path d="M-27,-20 Q-17,0 -27,20" fill="none" stroke={color} strokeWidth="2" />}<path d="M-22,-20 Q-12,0 -22,20 Q4,20 26,0 Q4,-20 -22,-20 Z" fill="none" stroke={color} strokeWidth="2.5" />{type === "nor_gate" && <circle cx="30" cy="0" r="4" fill="none" stroke={color} strokeWidth="2" />}<line x1="-40" y1="-12" x2="-17" y2="-12" stroke={color} strokeWidth="2" /><line x1="-40" y1="12" x2="-17" y2="12" stroke={color} strokeWidth="2" /><line x1={type === "nor_gate" ? "34" : "26"} y1="0" x2="40" y2="0" stroke={color} strokeWidth="2" /></g>;
  if (["not_gate", "buffer"].includes(type)) return <g><polygon points="-22,-18 -22,18 22,0" fill="none" stroke={color} strokeWidth="2.5" />{type === "not_gate" && <circle cx="26" cy="0" r="4" fill="none" stroke={color} strokeWidth="2" />}<line x1="-40" y1="0" x2="-22" y2="0" stroke={color} strokeWidth="2" /><line x1={type === "not_gate" ? "30" : "22"} y1="0" x2="40" y2="0" stroke={color} strokeWidth="2" /></g>;

  // ─── METERS WITH ANALOG GAUGE NEEDLE ───
  const meterMap = { voltmeter: "V", ammeter: "A", ohmmeter: "Ω", wattmeter: "W", multimeter: "M", freq_counter: "Hz", capacitance_meter: "C", inductance_meter: "L", power_factor_meter: "PF", energy_meter: "E", lux_meter: "lx", temp_meter: "T°", db_meter: "dB" };
  if (meterMap[type]) {
    const lt = meterMap[type], rd = sd?.reading;
    const needleAngle = sd?.meterValue ? Math.min(Math.max(-60, (sd.meterValue / (sd.meterMax || 100)) * 120 - 60), 60) : -60;
    return <g>
      <circle cx="0" cy="0" r="24" fill={glow ? `${color}0C` : "#0B0E14"} stroke={color} strokeWidth="2.5" />
      {glow && <circle cx="0" cy="0" r="24" fill="none" stroke={color} strokeWidth="1.5" opacity=".3"><animate attributeName="r" values="24;30;24" dur="2s" repeatCount="indefinite" /><animate attributeName="opacity" values=".3;0;.3" dur="2s" repeatCount="indefinite" /></circle>}
      {/* Gauge arc */}
      <path d="M-18,10 A 20 20 0 0 1 18,10" fill="none" stroke={`${color}30`} strokeWidth="2" strokeLinecap="round" />
      {/* Needle */}
      {sim && <line x1="0" y1="10" x2={Math.sin(needleAngle * Math.PI / 180) * 16} y2={10 - Math.cos(needleAngle * Math.PI / 180) * 16} stroke={sd?.flowing ? "#22C55E" : "#EF4444"} strokeWidth="1.5" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 0 10" to="0 0 10" dur="0.5s" /></line>}
      <circle cx="0" cy="10" r="2" fill={color} />
      <text x="0" y={sim && rd ? "-5" : "3"} textAnchor="middle" fill={color} fontSize={lt.length > 2 ? "8" : "12"} fontWeight="800" fontFamily="monospace">{lt}</text>
      {sim && rd && <text x="0" y="7" textAnchor="middle" fill="#E2E8F0" fontSize="6.5" fontWeight="700" fontFamily="monospace">{rd}</text>}
      {/* Flow indicator */}
      {sim && <circle cx="18" cy="-18" r="3.5" fill={sd?.flowing ? "#22C55E" : "#EF4444"} opacity=".9"><animate attributeName="opacity" values=".9;.4;.9" dur="1s" repeatCount="indefinite" /></circle>}
      <line x1="-42" y1="0" x2="-24" y2="0" stroke={color} strokeWidth="2.5" /><line x1="24" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" />
    </g>;
  }
  if (type === "oscilloscope") return <g><rect x="-28" y="-22" width="56" height="44" rx="6" fill={glow ? "#0a1018" : "#0B0E14"} stroke={color} strokeWidth="2.5" /><path d={`M-20,0 L-10,-14 L0,14 L10,-14 L20,0`} fill="none" stroke={glow ? color : "#334155"} strokeWidth="2" /><line x1="-42" y1="0" x2="-28" y2="0" stroke={color} strokeWidth="2.5" /><line x1="28" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" /></g>;
  if (type === "logic_probe") return <g><rect x="-10" y="-18" width="20" height="36" rx="4" fill="none" stroke={color} strokeWidth="2.5" /><circle cx="0" cy="-6" r="5" fill={glow ? (sd?.high ? "#22C55E" : "#EF4444") : "#334155"} /><line x1="0" y1="-22" x2="0" y2="-18" stroke={color} strokeWidth="2.5" /><text x="0" y="12" textAnchor="middle" fill={color} fontSize="7" fontWeight="700">{glow ? (sd?.high ? "H" : "L") : "?"}</text></g>;

  if (["switch_spst", "push_btn"].includes(type)) return <g><line x1="-42" y1="0" x2="-12" y2="0" stroke={color} strokeWidth="2.5" /><line x1="12" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" /><circle cx="-12" cy="0" r="3.5" fill={color} /><circle cx="12" cy="0" r="3.5" fill={color} />{sd?.closed ? <line x1="-12" y1="0" x2="12" y2="0" stroke="#22C55E" strokeWidth="3" /> : <line x1="-12" y1="0" x2="10" y2="-14" stroke={color} strokeWidth="2.5" />}</g>;
  if (type === "motor_dc") return <g><circle cx="0" cy="0" r="20" fill="none" stroke={color} strokeWidth="2.5" /><text x="0" y="6" textAnchor="middle" fill={color} fontSize="16" fontWeight="800">M</text><line x1="-42" y1="0" x2="-20" y2="0" stroke={color} strokeWidth="2.5" /><line x1="20" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" /></g>;
  if (["buzzer", "speaker"].includes(type)) return <g><path d="M-12,-16 L-12,16 Q12,16 12,0 Q12,-16 -12,-16 Z" fill="none" stroke={color} strokeWidth="2.5" /><line x1="-42" y1="0" x2="-12" y2="0" stroke={color} strokeWidth="2.5" /><line x1="12" y1="0" x2="42" y2="0" stroke={color} strokeWidth="2.5" />{glow && <><path d="M18,-8 Q24,-8 24,0 Q24,8 18,8" fill="none" stroke={color} strokeWidth="1.5" opacity=".5" /><path d="M22,-14 Q30,-14 30,0 Q30,14 22,14" fill="none" stroke={color} strokeWidth="1.5" opacity=".3" /></>}</g>;

  // Generic IC
  const lb = type.replace("ic_", "").replace("arduino_", "ARD").replace("esp", "ESP").toUpperCase().slice(0, 4);
  const h = type.startsWith("ic_") || type.startsWith("arduino") || type.startsWith("esp") ? 38 : 22;
  return <g><rect x="-40" y={-h} width="80" height={h * 2} rx="5" fill="none" stroke={color} strokeWidth="2.5" /><text x="0" y="5" textAnchor="middle" fill={color} fontSize="10" fontWeight="800" fontFamily="monospace">{lb}</text></g>;
};

// ═══ OSCILLOSCOPE PANEL ═════════════════════════════════════════════════════
const OscPanel = ({ data }) => { if (!data?.waveform) return null; const W = 300, H = 130, pd = 12, mx = Math.max(...data.waveform.map(Math.abs), 1), pts = data.waveform.map((v, i) => `${pd + (i / (data.waveform.length - 1)) * (W - 2 * pd)},${H / 2 - (v / mx) * (H / 2 - pd)}`).join(" "); return <div style={{ background: "#080C12", border: "1px solid #22D3EE40", borderRadius: 10, padding: 10, width: W + 20 }}><div style={{ color: "#22D3EE", fontSize: 10, fontFamily: "monospace", marginBottom: 4, display: "flex", justifyContent: "space-between" }}><span>OSCILLOSCOPE</span><span style={{ color: "#10B981" }}>● LIVE</span></div><svg width={W} height={H}><rect width={W} height={H} fill="#0a0f18" rx="6" />{Array.from({ length: 7 }, (_, i) => <line key={i} x1={pd} y1={pd + i * (H - 2 * pd) / 6} x2={W - pd} y2={pd + i * (H - 2 * pd) / 6} stroke="#1a2a3a" strokeWidth=".5" />)}<line x1={pd} y1={H / 2} x2={W - pd} y2={H / 2} stroke="#2a3a4a" strokeWidth="1" /><polyline points={pts} fill="none" stroke="#22D3EE" strokeWidth="2" /><polyline points={pts} fill="none" stroke="#22D3EE" strokeWidth="6" opacity=".15" /></svg></div>; };

// ═══ DIAGNOSTICS PANEL ══════════════════════════════════════════════════════
const DiagPanel = ({ issues, onClose }) => <div style={{ position: "absolute", bottom: 50, left: "50%", transform: "translateX(-50%)", zIndex: 10, background: "#111720", border: "1px solid #1E293B", borderRadius: 12, padding: 16, maxWidth: 520, width: "90%", boxShadow: "0 10px 40px rgba(0,0,0,.6)", maxHeight: 300, overflow: "auto" }}>
  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 800, color: "#0EA5E9", letterSpacing: 1.5 }}>🔍 CIRCUIT DIAGNOSTICS</span><button onClick={onClose} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 14 }}>✕</button></div>
  {issues.map((iss, i) => <div key={i} style={{ padding: "8px 10px", marginBottom: 4, borderRadius: 8, background: iss.type === "error" ? "#EF444410" : iss.type === "warn" ? "#F59E0B10" : iss.type === "ok" ? "#10B98110" : "#0EA5E910", borderLeft: `3px solid ${iss.type === "error" ? "#EF4444" : iss.type === "warn" ? "#F59E0B" : iss.type === "ok" ? "#10B981" : "#0EA5E9"}`, fontSize: 11 }}>
    <div style={{ color: "#E2E8F0", fontWeight: 600 }}>{iss.icon} {iss.msg}</div>
    {iss.fix && <div style={{ color: "#64748B", fontSize: 10, marginTop: 3 }}>💡 Fix: {iss.fix}</div>}
  </div>)}
</div>;

// ═══ PARTICLES ══════════════════════════════════════════════════════════════
const Particles = ({ active }) => { const [ps, sP] = useState([]); useEffect(() => { if (!active) { sP([]); return; } const iv = setInterval(() => { sP(pr => { const nx = pr.filter(p => p.l > 0).map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, l: p.l - 1, vy: p.vy + .02 })); if (Math.random() > .7) { const cls = ["#0EA5E9", "#A855F7", "#22C55E", "#F59E0B", "#EC4899"]; nx.push({ x: Math.random() * 100, y: 100, vx: (Math.random() - .5), vy: -Math.random() * 2 - 1, l: 45, c: cls[~~(Math.random() * cls.length)], s: Math.random() * 3 + 1 }); } return nx; }); }, 33); return () => clearInterval(iv); }, [active]); if (!ps.length) return null; return <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}>{ps.map((p, i) => <circle key={i} cx={`${p.x}%`} cy={`${p.y}%`} r={p.s} fill={p.c} opacity={p.l / 45} />)}</svg>; };

// ═══ EASTER EGGS ════════════════════════════════════════════════════════════
const EGGS = [{ c: "iem", m: "🎓 IEM Salt Lake — Excellence in Engineering!", cl: "#0EA5E9" }, { c: "kolkata", m: "🌆 City of Joy — Kolkata!", cl: "#F59E0B" }, { c: "ohm", m: "🔬 V=IR — Ohm's Law!", cl: "#A855F7" }, { c: "tesla", m: "⚡ Future is mine! — Tesla", cl: "#3B82F6" }, { c: "kirchhoff", m: "⚡ ΣI=0 — Kirchhoff!", cl: "#10B981" }, { c: "faraday", m: "🧲 EMF=-dΦ/dt", cl: "#F59E0B" }, { c: "42", m: "🌌 Answer to Everything!", cl: "#8B5CF6" }, { c: "debug", m: "🐛 It's a feature!", cl: "#EF4444" }, { c: "coffee", m: "☕ Engineers run on coffee!", cl: "#D97706" }, { c: "pi", m: "🥧 π=3.14159...", cl: "#06B6D4" }];

// ═══ MINI GAMES ═════════════════════════════════════════════════════════════
const MiniGame = ({ game, onClose, onScore }) => {
  const [st, sS] = useState({ score: 0, q: null, ans: "", fb: "", rnd: 0, tl: 30 });
  const gen = useCallback(g => {
    if (g === "resistor_color") { const c = ["Black", "Brown", "Red", "Orange", "Yellow", "Green", "Blue", "Violet", "Grey", "White"], b1 = ~~(Math.random() * 10), b2 = ~~(Math.random() * 10), m = ~~(Math.random() * 6); return { q: `Bands: ${c[b1]}, ${c[b2]}, ${c[m]}. R=?`, a: ((b1 * 10 + b2) * Math.pow(10, m)) + "", hint: `${b1}${b2}×10^${m}` }; }
    if (g === "ohms_law") { const v = ~~(Math.random() * 24) + 1, r = ~~(Math.random() * 900) + 100; return { q: `V=${v}V, R=${r}Ω → I(mA)?`, a: Math.round(v / r * 1000) + "", hint: "I=V/R" }; }
    const qs = [{ q: "LED stands for?", a: "light emitting diode" }, { q: "Unit of resistance?", a: "ohm" }, { q: "Stores charge?", a: "capacitor" }, { q: "Unit of power?", a: "watt" }];
    return qs[~~(Math.random() * qs.length)];
  }, []);
  useEffect(() => { sS(s => ({ ...s, q: gen(game), rnd: 1, score: 0, tl: 30 })); const t = setInterval(() => sS(s => s.tl <= 1 ? { ...s, tl: 0 } : { ...s, tl: s.tl - 1 }), 1000); return () => clearInterval(t); }, [game, gen]);
  const chk = () => { if (!st.q) return; const ok = st.ans.toLowerCase().trim() === st.q.a.toLowerCase().trim() || (!isNaN(st.q.a) && Math.abs(parseFloat(st.ans) - parseFloat(st.q.a)) < parseFloat(st.q.a) * .15); if (ok) { Snd.ok(); sS(s => ({ ...s, score: s.score + 10, fb: "✅ +10!", ans: "", q: gen(game), rnd: s.rnd + 1 })); } else { Snd.err(); sS(s => ({ ...s, fb: `❌ ${s.q.a}`, ans: "", q: gen(game), rnd: s.rnd + 1 })); } };
  if (st.tl <= 0) return <div style={mO}><div style={mB}><div style={{ fontSize: 24, fontWeight: 800, background: "linear-gradient(135deg,#0EA5E9,#A855F7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>⏰ Time's Up!</div><div style={{ fontSize: 48, fontWeight: 900, color: "#F59E0B", margin: "16px 0" }}>{st.score}</div><button onClick={() => { onScore(st.score); onClose(); }} style={pB}>Close</button></div></div>;
  return <div style={mO}><div style={mB}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><span style={{ fontSize: 12, color: "#0EA5E9", fontWeight: 700 }}>Score: {st.score}</span><span style={{ fontSize: 12, color: st.tl < 10 ? "#EF4444" : "#F59E0B", fontWeight: 700 }}>⏱ {st.tl}s</span></div><div style={{ fontSize: 15, fontWeight: 700, color: "#E2E8F0", marginBottom: 12 }}>{st.q?.q}</div>{st.q?.hint && <div style={{ fontSize: 10, color: "#64748B", marginBottom: 8 }}>💡 {st.q.hint}</div>}{st.fb && <div style={{ fontSize: 12, marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: st.fb.startsWith("✅") ? "#10B98120" : "#EF444420", color: st.fb.startsWith("✅") ? "#10B981" : "#EF4444" }}>{st.fb}</div>}<div style={{ display: "flex", gap: 8 }}><input value={st.ans} onChange={e => sS(s => ({ ...s, ans: e.target.value }))} onKeyDown={e => e.key === "Enter" && chk()} placeholder="Answer..." autoFocus style={{ flex: 1, padding: "8px 12px", background: "#0B0E14", border: "1px solid #1E293B", borderRadius: 6, color: "#E2E8F0", fontSize: 13, fontFamily: "inherit", outline: "none" }} /><button onClick={chk} style={pB}>Go</button></div><button onClick={onClose} style={{ ...sB, marginTop: 10, width: "100%" }}>Exit</button></div></div>;
};
const mO = { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 };
const mB = { background: "#111720", border: "1px solid #1E293B", borderRadius: 16, padding: 24, maxWidth: 420, width: "90%", boxShadow: "0 20px 50px rgba(0,0,0,.5)" };
const pB = { padding: "8px 20px", background: "linear-gradient(135deg,#0EA5E9,#0284C7)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const sB = { padding: "8px 20px", background: "#1E293B", border: "1px solid #334155", borderRadius: 8, color: "#94A3B8", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };

// ═══ PRESETS ════════════════════════════════════════════════════════════════
const presets = u => {
  if (u === "Ω") return [{ v: 100, l: "100Ω" }, { v: 220, l: "220Ω" }, { v: 470, l: "470Ω" }, { v: 1e3, l: "1k" }, { v: 4.7e3, l: "4.7k" }, { v: 10e3, l: "10k" }, { v: 100e3, l: "100k" }, { v: 1e6, l: "1M" }];
  if (u === "F") return [{ v: 1e-12, l: "1pF" }, { v: 100e-12, l: "100pF" }, { v: 1e-9, l: "1nF" }, { v: 100e-9, l: "100nF" }, { v: 1e-6, l: "1µF" }, { v: 100e-6, l: "100µF" }];
  if (u === "H") return [{ v: 1e-6, l: "1µH" }, { v: 100e-6, l: "100µH" }, { v: 1e-3, l: "1mH" }, { v: 1, l: "1H" }];
  if (u === "V") return [{ v: 1.5, l: "1.5V" }, { v: 3.3, l: "3.3V" }, { v: 5, l: "5V" }, { v: 9, l: "9V" }, { v: 12, l: "12V" }, { v: 24, l: "24V" }, { v: 220, l: "220V" }];
  if (u === "A") return [{ v: .001, l: "1mA" }, { v: .01, l: "10mA" }, { v: .1, l: "100mA" }, { v: 1, l: "1A" }, { v: 5, l: "5A" }];
  if (u === "Hz") return [{ v: 50, l: "50Hz" }, { v: 440, l: "440Hz" }, { v: 1e3, l: "1kHz" }, { v: 16e6, l: "16MHz" }];
  if (u === "°C") return [{ v: -20, l: "-20°" }, { v: 0, l: "0°" }, { v: 25, l: "25°" }, { v: 100, l: "100°" }];
  return [{ v: 0, l: "0" }, { v: 1, l: "1" }, { v: 10, l: "10" }, { v: 100, l: "100" }];
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function IEMCAD() {
  const [comps, setC] = useState([]);
  const [wires, setW] = useState([]);
  const [sel, setSel] = useState(null);
  const [selW, setSelW] = useState(null);
  const [drag, setDrag] = useState(null);
  const [wSt, setWSt] = useState(null);
  const [wPv, setWPv] = useState(null);
  const [snapVis, setSnapVis] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState("select");
  const [sim, setSim] = useState(false);
  const [simR, setSimR] = useState({});
  const [tick, setTick] = useState(0);
  const [cat, setCat] = useState("⚡ Passive");
  const [showP, setShowP] = useState(true);
  const [showC, setShowC] = useState(false);
  const [cLog, setCLog] = useState([]);
  const [us, setUs] = useState([]);
  const [rs, setRs] = useState([]);
  const [pName, setPName] = useState("Untitled Project");
  const [editN, setEditN] = useState(false);
  const [isPn, setIsPn] = useState(false);
  const [pnSt, setPnSt] = useState(null);
  const [eBuf, setEBuf] = useState("");
  const [eMsg, setEMsg] = useState(null);
  const [miniG, setMiniG] = useState(null);
  const [score, setScore] = useState(0);
  const [ntf, setNtf] = useState([]);
  const [sq, setSq] = useState("");
  const [splash, setSplash] = useState(true);
  const [showDiag, setShowDiag] = useState(false);
  const svgRef = useRef(null);
  const idR = useRef(1);
  const simIv = useRef(null);

  useEffect(() => { setTimeout(() => setSplash(false), 2200); }, []);
  const log = useCallback((m, t = "info") => setCLog(p => [...p.slice(-200), { m, t, time: new Date().toLocaleTimeString() }]), []);
  const ntfy = useCallback((msg, cl = "#0EA5E9") => { const id = Date.now(); setNtf(p => [...p, { id, msg, cl }]); setTimeout(() => setNtf(p => p.filter(n => n.id !== id)), 3000); }, []);
  const save = useCallback(() => { setUs(p => [...p.slice(-60), { c: JSON.parse(JSON.stringify(comps)), w: JSON.parse(JSON.stringify(wires)) }]); setRs([]); }, [comps, wires]);
  const doUndo = useCallback(() => { if (!us.length) return; Snd.undo(); setRs(r => [...r, { c: JSON.parse(JSON.stringify(comps)), w: JSON.parse(JSON.stringify(wires)) }]); const s = us[us.length - 1]; setC(s.c); setW(s.w); setUs(u => u.slice(0, -1)); }, [us, comps, wires]);
  const doRedo = useCallback(() => { if (!rs.length) return; Snd.redo(); setUs(u => [...u, { c: JSON.parse(JSON.stringify(comps)), w: JSON.parse(JSON.stringify(wires)) }]); const s = rs[rs.length - 1]; setC(s.c); setW(s.w); setRs(r => r.slice(0, -1)); }, [rs, comps, wires]);

  useEffect(() => { if (sim) { simIv.current = setInterval(() => setTick(t => t + 1), 50); Snd.simOn(); log("Simulation ON", "ok"); } else { clearInterval(simIv.current); setSimR({}); } return () => clearInterval(simIv.current); }, [sim, log]);
  useEffect(() => { if (sim) setSimR(simulate(comps, wires)); }, [tick, sim, comps, wires]);

  // Easter eggs
  useEffect(() => { const h = e => { if (e.target.tagName === "INPUT") return; const buf = (eBuf + e.key.toLowerCase()).slice(-20); setEBuf(buf); for (const egg of EGGS) if (buf.endsWith(egg.c)) { Snd.egg(); setEMsg(egg); ntfy(egg.m, egg.cl); setScore(s => s + 50); setTimeout(() => setEMsg(null), 3500); break; } }; window.addEventListener("keypress", h); return () => window.removeEventListener("keypress", h); }, [eBuf, ntfy]);

  // Keyboard
  useEffect(() => { const h = e => { if (e.target.tagName === "INPUT") return; if (e.key === "Delete" || e.key === "Backspace") { if (sel !== null) { save(); Snd.del(); setC(p => p.filter(c => c.id !== sel)); setSel(null); } if (selW !== null) { save(); Snd.del(); setW(p => p.filter((_, i) => i !== selW)); setSelW(null); } } if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); doUndo(); } if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); doRedo(); } if (e.key === "w" && !e.ctrlKey) setTool("wire"); if (e.key === "v" || e.key === "Escape") { setTool("select"); setWSt(null); setWPv(null); setSnapVis(null); } if (e.key === "r" && sel !== null) { save(); Snd.rot(); setC(p => p.map(c => c.id === sel ? { ...c, rotation: ((c.rotation || 0) + 90) % 360 } : c)); } if (e.key === "d" && !e.ctrlKey) setTool("delete"); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [sel, selW, doUndo, doRedo, save]);

  const svgPt = useCallback(e => { const r = svgRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom }; }, [pan, zoom]);
  const addComp = useCallback(lib => { save(); Snd.place(); const id = idR.current++; setC(p => [...p, { id, type: lib.type, label: `${lib.sym}${id}`, x: SNAP(350 + Math.random() * 200), y: SNAP(250 + Math.random() * 150), value: lib.def, unit: lib.unit, color: lib.color, ledColor: lib.ledColor, rotation: 0, sym: lib.sym, pins: lib.pins, desc: lib.desc, meterMode: lib.meterConfig?.modes?.[0] }]); setSel(id); log(`+ ${lib.label}`, "info"); ntfy(`+ ${lib.label}`, lib.color); }, [save, log, ntfy]);

  const onCanvasDown = useCallback(e => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { setIsPn(true); setPnSt({ x: e.clientX - pan.x, y: e.clientY - pan.y }); return; }
    const pt = svgPt(e);
    if (tool === "wire") {
      const sp = snapPt(pt.x, pt.y, comps);
      if (!wSt) { setWSt(sp); if (sp.snapped) { Snd.connect(); ntfy("🔗 Pin snapped", "#22C55E"); } else Snd.snap(); }
      else { save(); const ep = snapPt(pt.x, pt.y, comps); setW(p => [...p, { x1: wSt.x, y1: wSt.y, x2: ep.x, y2: ep.y }]); if (ep.snapped) { Snd.connect(); ntfy("🔗 Connected!", "#22C55E"); } else Snd.wire(); setWSt(ep); log("Wire placed", "info"); }
    } else if (tool === "select") { setSel(null); setSelW(null); }
  }, [tool, wSt, pan, svgPt, save, log, ntfy, comps]);

  const onCanvasMove = useCallback(e => {
    if (isPn && pnSt) { setPan({ x: e.clientX - pnSt.x, y: e.clientY - pnSt.y }); return; }
    const pt = svgPt(e);
    if (wSt) { const sp = snapPt(pt.x, pt.y, comps); setWPv(sp); setSnapVis(sp.snapped ? sp : null); }
    if (drag) setC(p => p.map(c => c.id === drag ? { ...c, x: SNAP(pt.x), y: SNAP(pt.y) } : c));
  }, [isPn, pnSt, wSt, drag, svgPt, comps]);

  const onCanvasUp = useCallback(() => { setIsPn(false); setPnSt(null); if (drag) setDrag(null); }, [drag]);
  const onWheel = useCallback(e => { e.preventDefault(); setZoom(z => Math.min(4, Math.max(.15, z * (e.deltaY > 0 ? .92 : 1.08)))); }, []);

  const onCompDown = useCallback((e, c) => {
    e.stopPropagation();
    if (tool === "wire") {
      const pt = svgPt(e), pins = pinPos(c);
      let nearest = pins[0], nd = Infinity;
      pins.forEach(p => { const d = Math.hypot(pt.x - p.x, pt.y - p.y); if (d < nd) { nd = d; nearest = p; } });
      if (!wSt) { setWSt({ x: nearest.x, y: nearest.y, snapped: true }); Snd.connect(); ntfy("🔗 From pin", "#22C55E"); }
      else { save(); setW(p => [...p, { x1: wSt.x, y1: wSt.y, x2: nearest.x, y2: nearest.y }]); Snd.connect(); ntfy("🔗 Connected!", "#22C55E"); setWSt({ x: nearest.x, y: nearest.y, snapped: true }); log("Wire connected", "info"); }
      return;
    }
    if (tool === "delete") { save(); Snd.del(); setC(p => p.filter(x => x.id !== c.id)); return; }
    if (tool === "select") { Snd.click(); setSel(c.id); setSelW(null); setDrag(c.id); save(); }
    if (["switch_spst", "switch_spdt", "push_btn"].includes(c.type) && sim) { Snd.sw(); setC(p => p.map(x => x.id === c.id ? { ...x, switchState: !x.switchState } : x)); }
  }, [tool, sim, save, wSt, svgPt, log, ntfy]);

  const selD = useMemo(() => comps.find(c => c.id === sel), [comps, sel]);
  const oscD = useMemo(() => { const o = comps.find(c => c.type === "oscilloscope"); return o && simR[o.id]; }, [comps, simR]);
  const diags = useMemo(() => diagnoseCircuit(comps, wires), [comps, wires]);
  const filtered = useMemo(() => { if (!sq) return LIB[cat] || []; const q = sq.toLowerCase(), all = []; Object.values(LIB).forEach(arr => arr.forEach(c => { if (c.label.toLowerCase().includes(q) || c.type.includes(q) || (c.desc || "").toLowerCase().includes(q)) all.push(c); })); return all; }, [cat, sq]);

  const toggleSim = () => { if (!sim && comps.length === 0) { Snd.err(); ntfy("Add components first!", "#EF4444"); return; } if (sim) Snd.simOff(); setSim(!sim); };
  const clearAll = () => { save(); setC([]); setW([]); setSel(null); setSelW(null); setSim(false); setSimR({}); Snd.del(); log("Cleared", "sys"); };

  if (splash) return <div style={{ width: "100vw", height: "100vh", background: "#0B0E14", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}><style>{`@keyframes li{from{transform:scale(.3) rotate(-180deg);opacity:0}to{transform:scale(1);opacity:1}}@keyframes ti{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes bg{from{width:0}to{width:100%}}`}</style><div style={{ animation: "li .8s ease-out" }}><svg width="80" height="80" viewBox="0 0 28 28"><defs><linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#0EA5E9" /><stop offset="50%" stopColor="#A855F7" /><stop offset="100%" stopColor="#EC4899" /></linearGradient></defs><rect x="1" y="1" width="26" height="26" rx="7" fill="none" stroke="url(#sg)" strokeWidth="2.5" /><path d="M7,10 L12,10 L12,7 L17,13 L12,19 L12,16 L7,16 Z" fill="#0EA5E9" /><circle cx="20" cy="9" r="2.5" fill="#A855F7" /><circle cx="20" cy="19" r="2.5" fill="#EC4899" /></svg></div><div style={{ animation: "ti .6s ease-out .4s both", fontSize: 36, fontWeight: 900, letterSpacing: 6, marginTop: 20, background: "linear-gradient(135deg,#0EA5E9,#A855F7,#EC4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontFamily: "monospace" }}>IEMCAD</div><div style={{ animation: "ti .6s ease-out .7s both", color: "#475569", fontSize: 11, marginTop: 6, letterSpacing: 3 }}>v3.0 — CIRCUIT DESIGN & SIMULATION</div><div style={{ animation: "ti .6s ease-out 1s both", color: "#0EA5E9", fontSize: 10, marginTop: 14, letterSpacing: 2 }}>IEM SALT LAKE, KOLKATA</div><div style={{ width: 200, height: 3, background: "#1E293B", borderRadius: 3, marginTop: 20, overflow: "hidden" }}><div style={{ height: "100%", background: "linear-gradient(90deg,#0EA5E9,#A855F7,#EC4899)", borderRadius: 3, animation: "bg 1.8s ease-out forwards" }} /></div></div>;

  return <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "#0B0E14", color: "#E2E8F0", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", fontSize: 13, userSelect: "none" }}>
    <style>{`@keyframes fu{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes pl{0%,100%{opacity:.6}50%{opacity:1}}.ci:hover{border-color:var(--hc)!important;background:#1A2232!important;transform:translateX(3px)}input:focus{border-color:#0EA5E9!important;box-shadow:0 0 0 2px #0EA5E920}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#1E293B;border-radius:4px}`}</style>

    {/* Notifications */}
    <div style={{ position: "fixed", top: 60, right: 16, zIndex: 10000, display: "flex", flexDirection: "column", gap: 6 }}>{ntf.map(n => <div key={n.id} style={{ padding: "8px 16px", background: "#111720", border: `1px solid ${n.cl}40`, borderLeft: `3px solid ${n.cl}`, borderRadius: 8, fontSize: 11, color: n.cl, fontWeight: 600, maxWidth: 300, animation: "fu .3s ease-out" }}>{n.msg}</div>)}</div>
    {eMsg && <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 10001, padding: "20px 40px", background: "#111720", border: `2px solid ${eMsg.cl}`, borderRadius: 16, fontSize: 18, fontWeight: 800, color: eMsg.cl, boxShadow: `0 0 60px ${eMsg.cl}30`, animation: "fu .4s ease-out", textAlign: "center" }}>{eMsg.m}<div style={{ fontSize: 10, color: "#64748B", marginTop: 6 }}>+50 pts!</div></div>}
    {miniG && <MiniGame game={miniG} onClose={() => setMiniG(null)} onScore={s => { setScore(ts => ts + s); ntfy(`🎮 +${s} pts`, "#F59E0B"); }} />}

    {/* TOP BAR */}
    <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "1px solid #1E293B", background: "linear-gradient(180deg,#111720,#0F1520)", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => ntfy("🎓 IEMCAD v3.0 for IEM Salt Lake", "#0EA5E9")}><svg width="26" height="26" viewBox="0 0 28 28"><defs><linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#0EA5E9" /><stop offset="50%" stopColor="#A855F7" /><stop offset="100%" stopColor="#EC4899" /></linearGradient></defs><rect x="1" y="1" width="26" height="26" rx="7" fill="none" stroke="url(#lg)" strokeWidth="2.5" /><path d="M7,10 L12,10 L12,7 L17,13 L12,19 L12,16 L7,16 Z" fill="#0EA5E9" /><circle cx="20" cy="9" r="2.5" fill="#A855F7" /><circle cx="20" cy="19" r="2.5" fill="#EC4899" /></svg><span style={{ fontSize: 16, fontWeight: 900, letterSpacing: 3, background: "linear-gradient(135deg,#0EA5E9,#A855F7,#EC4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>IEMCAD</span><span style={{ fontSize: 9, color: "#334155" }}>v3</span></div>
        <div style={{ width: 1, height: 24, background: "#1E293B" }} />
        {editN ? <input value={pName} onChange={e => setPName(e.target.value)} onBlur={() => setEditN(false)} onKeyDown={e => e.key === "Enter" && setEditN(false)} autoFocus style={{ background: "transparent", border: "1px solid #0EA5E9", color: "#E2E8F0", padding: "3px 10px", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none", width: 200 }} /> : <span onClick={() => setEditN(true)} style={{ cursor: "pointer", color: "#64748B", fontSize: 12 }}>{pName} ✏️</span>}
      </div>
      <div style={{ display: "flex", gap: 3, background: "#080B10", borderRadius: 10, padding: 3, border: "1px solid #1E293B" }}>
        {[{ id: "select", i: "↖", l: "Select" }, { id: "wire", i: "⟋", l: "Wire" }, { id: "delete", i: "✕", l: "Delete" }].map(t => <button key={t.id} onClick={() => { Snd.click(); setTool(t.id); setWSt(null); setWPv(null); setSnapVis(null); }} style={{ padding: "7px 16px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700, transition: "all .2s", background: tool === t.id ? "linear-gradient(135deg,#0EA5E9,#0284C7)" : "transparent", color: tool === t.id ? "#fff" : "#64748B" }}>{t.i} {t.l}</button>)}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700 }}>🏆 {score}</span>
        <button onClick={doUndo} style={tB} title="Undo">↩</button><button onClick={doRedo} style={tB}>↪</button>
        <div style={{ width: 1, height: 24, background: "#1E293B" }} />
        {/* Diagnostics */}
        <button onClick={() => { Snd.diag(); setShowDiag(!showDiag); }} style={{ ...tB, color: diags.some(d => d.type === "error") ? "#EF4444" : diags.some(d => d.type === "warn") ? "#F59E0B" : "#10B981", position: "relative" }} title="Circuit Diagnostics">
          🔍{diags.filter(d => d.type === "error" || d.type === "warn").length > 0 && <span style={{ position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: diags.some(d => d.type === "error") ? "#EF4444" : "#F59E0B", fontSize: 8, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{diags.filter(d => d.type === "error" || d.type === "warn").length}</span>}
        </button>
        {/* Games */}
        <div style={{ position: "relative" }} onMouseEnter={e => e.currentTarget.lastChild.style.display = "block"} onMouseLeave={e => e.currentTarget.lastChild.style.display = "none"}><button style={{ ...tB, color: "#EC4899" }}>🎮</button><div style={{ display: "none", position: "absolute", top: "100%", right: 0, marginTop: 8, background: "#111720", border: "1px solid #1E293B", borderRadius: 10, padding: 8, zIndex: 100, minWidth: 170, boxShadow: "0 10px 40px rgba(0,0,0,.5)" }}>{[{ id: "resistor_color", l: "🎨 Resistor Colors" }, { id: "ohms_law", l: "⚡ Ohm's Law" }, { id: "circuit_quiz", l: "🧠 Trivia" }].map(g => <div key={g.id} onClick={() => { Snd.ok(); setMiniG(g.id); }} style={{ padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, color: "#E2E8F0", fontWeight: 600 }} onMouseEnter={e => e.currentTarget.style.background = "#1A2232"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{g.l}</div>)}</div></div>
        <div style={{ width: 1, height: 24, background: "#1E293B" }} />
        <button onClick={toggleSim} style={{ padding: "7px 22px", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: 12, letterSpacing: 1.5, background: sim ? "linear-gradient(135deg,#EF4444,#DC2626)" : "linear-gradient(135deg,#10B981,#059669)", color: "#fff", boxShadow: sim ? "0 0 24px #EF444440" : "0 0 24px #10B98140", animation: sim ? "pl 1.5s infinite" : "none" }}>{sim ? "■ STOP" : "▶ RUN"}</button>
        <button onClick={clearAll} style={tB}>🗑</button><button onClick={() => setShowC(!showC)} style={{ ...tB, color: showC ? "#0EA5E9" : "#64748B" }}>⌨</button>
      </div>
    </div>

    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* LEFT SIDEBAR */}
      <div style={{ width: 236, borderRight: "1px solid #1E293B", background: "#0F1520", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "10px 10px 6px" }}><input value={sq} onChange={e => setSq(e.target.value)} placeholder="🔍 Search..." style={{ width: "100%", padding: "7px 12px", background: "#0B0E14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} /></div>
        {!sq && <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "0 8px 6px" }}>{Object.keys(LIB).map(c => <button key={c} onClick={() => { setCat(c); Snd.click(); }} style={{ padding: "3px 6px", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 9, fontFamily: "inherit", fontWeight: 700, background: cat === c ? "linear-gradient(135deg,#0EA5E9,#0284C7)" : "#0B0E14", color: cat === c ? "#fff" : "#64748B" }}>{c}</button>)}</div>}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>{filtered.map((item, i) => <div key={`${item.type}-${i}`} className="ci" onClick={() => addComp(item)} style={{ "--hc": item.color, display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", marginBottom: 2, borderRadius: 8, cursor: "pointer", background: "#0B0E14", border: "1px solid #1E293B", transition: "all .2s" }}><div style={{ width: 30, height: 30, borderRadius: 6, background: `${item.color}10`, border: `1px solid ${item.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="24" height="24" viewBox="-48 -26 96 52"><CompSVG type={item.type} color={item.color} ledColor={item.ledColor} /></svg></div><div style={{ minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</div>{item.unit && <div style={{ fontSize: 9, color: item.color, fontWeight: 600 }}>{fmt(item.def, item.unit)}</div>}</div></div>)}</div>
        <div style={{ padding: 8, borderTop: "1px solid #1E293B", fontSize: 8, color: "#475569", lineHeight: 1.6 }}>V=Select W=Wire D=Delete R=Rotate Del=Remove<br />🥚 Type "iem","ohm","tesla" for eggs!</div>
      </div>

      {/* CANVAS */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <Particles active={sim} />
        {showDiag && <DiagPanel issues={diags} onClose={() => setShowDiag(false)} />}
        <svg ref={svgRef} width="100%" height="100%" style={{ background: "#080B10", cursor: tool === "wire" ? "crosshair" : tool === "delete" ? "not-allowed" : isPn ? "grabbing" : "default", position: "relative", zIndex: 1 }} onMouseDown={onCanvasDown} onMouseMove={onCanvasMove} onMouseUp={onCanvasUp} onWheel={onWheel}>
          <defs><pattern id="grid" width={G * zoom} height={G * zoom} patternUnits="userSpaceOnUse" patternTransform={`translate(${pan.x % (G * zoom)},${pan.y % (G * zoom)})`}><circle cx={G * zoom / 2} cy={G * zoom / 2} r={zoom > .4 ? .8 : 0} fill="#161D28" /></pattern><filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter><linearGradient id="wg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#0EA5E9" /><stop offset="100%" stopColor="#A855F7" /></linearGradient></defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* Pin indicators in wire mode */}
            {tool === "wire" && comps.map(c => pinPos(c).map((p, i) => <g key={`p-${c.id}-${i}`}><circle cx={p.x} cy={p.y} r={7} fill="#0EA5E915" stroke="#0EA5E9" strokeWidth="1" opacity=".5" /><circle cx={p.x} cy={p.y} r={2.5} fill="#0EA5E9" opacity=".7" /></g>))}
            {snapVis && <g><circle cx={snapVis.x} cy={snapVis.y} r={10} fill="none" stroke="#22C55E" strokeWidth="2" opacity=".7"><animate attributeName="r" values="8;14;8" dur="1s" repeatCount="indefinite" /><animate attributeName="opacity" values=".7;.1;.7" dur="1s" repeatCount="indefinite" /></circle><circle cx={snapVis.x} cy={snapVis.y} r={4} fill="#22C55E" opacity=".5" /></g>}

            {/* Wires */}
            {wires.map((w, i) => <g key={`w${i}`} onClick={e => { e.stopPropagation(); if (tool === "delete") { save(); Snd.del(); setW(p => p.filter((_, j) => j !== i)); return; } Snd.click(); setSelW(i); setSel(null); }}><line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={selW === i ? "#F59E0B" : sim ? "url(#wg)" : "#38BDF8"} strokeWidth={selW === i ? 3.5 : 2.5} strokeLinecap="round" style={{ filter: sim ? "url(#glow)" : "none" }} /><line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="transparent" strokeWidth={14} style={{ cursor: "pointer" }} /><circle cx={w.x1} cy={w.y1} r={3.5} fill={sim ? "#7DD3FC" : "#38BDF8"} stroke="#080B10" strokeWidth="1" /><circle cx={w.x2} cy={w.y2} r={3.5} fill={sim ? "#7DD3FC" : "#38BDF8"} stroke="#080B10" strokeWidth="1" />{sim && <circle cx={(w.x1 + w.x2) / 2} cy={(w.y1 + w.y2) / 2} r={2} fill="#F59E0B" opacity={.5 + .5 * Math.sin(tick * .3)} />}</g>)}

            {wSt && wPv && <g><line x1={wSt.x} y1={wSt.y} x2={wPv.x} y2={wPv.y} stroke={wPv.snapped ? "#22C55E" : "#0EA5E9"} strokeWidth={2.5} strokeDasharray="6,4" opacity={.7} /><circle cx={wSt.x} cy={wSt.y} r={4} fill="#0EA5E9" /></g>}

            {/* Components */}
            {comps.map(comp => {
              const sd = simR[comp.id], isSel = sel === comp.id;
              return <g key={comp.id} transform={`translate(${comp.x},${comp.y})`} onMouseDown={e => onCompDown(e, comp)} style={{ cursor: tool === "delete" ? "not-allowed" : tool === "wire" ? "crosshair" : "grab" }}>
                {isSel && <rect x="-52" y="-44" width="104" height="88" rx="10" fill="none" stroke="#0EA5E9" strokeWidth="1.5" strokeDasharray="5,4" opacity=".7"><animate attributeName="stroke-dashoffset" values="0;18" dur="1s" repeatCount="indefinite" /></rect>}
                <g transform={`rotate(${comp.rotation || 0})`}>
                  <CompSVG type={comp.type} color={comp.color} ledColor={comp.ledColor} sim={sim} sd={sd} />
                  {pinPos({ ...comp, x: 0, y: 0, rotation: 0 }).map((pp, i) => <circle key={i} cx={pp.x} cy={pp.y} r={4} fill="#080B10" stroke={comp.color} strokeWidth="1.5" />)}
                </g>
                <text x="0" y="-30" textAnchor="middle" fill="#CBD5E1" fontSize="10" fontWeight="700">{comp.label}</text>
                {comp.unit && <text x="0" y="-20" textAnchor="middle" fill={comp.color} fontSize="9" fontWeight="600">{fmt(comp.value, comp.unit)}</text>}

                {/* Flow status badge */}
                {sim && sd && <g>
                  <rect x="-40" y="28" width="80" height={sd.whyNotFlowing && !sd.flowing ? "30" : "18"} rx="4" fill="#080B10E8" stroke={sd.flowing ? "#22C55E30" : "#EF444430"} strokeWidth=".8" />
                  <circle cx="-32" cy="37" r="3" fill={sd.flowing ? "#22C55E" : "#EF4444"} opacity=".9"><animate attributeName="opacity" values=".9;.4;.9" dur="1s" repeatCount="indefinite" /></circle>
                  <text x="0" y="40" textAnchor="middle" fill={sd.flowing ? "#22C55E" : "#EF4444"} fontSize="8" fontWeight="700">{sd.reading || (sd.flowing ? `${sd.voltage?.toFixed(2)}V` : "No flow")}</text>
                  {sd.whyNotFlowing && !sd.flowing && <text x="0" y="52" textAnchor="middle" fill="#F59E0B" fontSize="6.5" fontWeight="600">⚠ {sd.whyNotFlowing}</text>}
                </g>}
              </g>;
            })}
          </g>
        </svg>

        <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", gap: 4, alignItems: "center", zIndex: 2 }}><button onClick={() => setZoom(z => Math.min(4, z * 1.2))} style={zB}>+</button><span style={{ fontSize: 10, color: "#475569", minWidth: 44, textAlign: "center" }}>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(z => Math.max(.15, z * .8))} style={zB}>−</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={zB}>⊞</button></div>
        <div style={{ position: "absolute", bottom: 12, right: showP ? 276 : 12, display: "flex", gap: 14, fontSize: 10, color: "#475569", zIndex: 2 }}><span>{comps.length} comp</span><span>{wires.length} wire</span>{sim && <span style={{ color: "#10B981", fontWeight: 800, animation: "pl 1s infinite" }}>● LIVE</span>}</div>
        {sim && oscD?.waveform && <div style={{ position: "absolute", top: 12, right: showP ? 276 : 12, zIndex: 2 }}><OscPanel data={oscD} /></div>}
      </div>

      {/* RIGHT SIDEBAR — PROPERTIES */}
      {showP && <div style={{ width: 268, borderLeft: "1px solid #1E293B", background: "#0F1520", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #1E293B" }}><span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: "#475569" }}>PROPERTIES</span><button onClick={() => setShowP(false)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14 }}>✕</button></div>

        {selD ? <div style={{ padding: 12, flex: 1, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 50, height: 50, borderRadius: 10, background: `${selD.color}10`, border: `1px solid ${selD.color}25`, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="40" height="40" viewBox="-50 -32 100 64"><CompSVG type={selD.type} color={selD.color} ledColor={selD.ledColor} /></svg></div>
            <div><div style={{ fontWeight: 800, fontSize: 15 }}>{selD.label}</div><div style={{ fontSize: 10, color: "#475569" }}>{selD.type.replace(/_/g, " ")}</div>{selD.desc && <div style={{ fontSize: 9, color: selD.color }}>{selD.desc}</div>}</div>
          </div>

          {/* EDITABLE VALUE + UNIT */}
          {selD.unit && <div style={{ marginBottom: 14, padding: 12, background: "#0B0E1480", borderRadius: 10, border: `1px solid ${selD.color}25` }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: selD.color, letterSpacing: 1.5, marginBottom: 6 }}>⚡ VALUE & UNIT</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" value={selD.value} onChange={e => setC(p => p.map(c => c.id === sel ? { ...c, value: parseFloat(e.target.value) || 0 } : c))} style={{ flex: 1, padding: "8px 10px", background: "#080B10", border: `1px solid ${selD.color}30`, borderRadius: 6, color: "#F1F5F9", fontSize: 14, fontWeight: 700, fontFamily: "inherit", outline: "none" }} />
              <input value={selD.unit} onChange={e => setC(p => p.map(c => c.id === sel ? { ...c, unit: e.target.value } : c))} style={{ width: 44, padding: "8px 6px", background: "#080B10", border: `1px solid ${selD.color}30`, borderRadius: 6, color: selD.color, fontSize: 13, fontWeight: 800, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
            </div>
            <div style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>Display: {fmt(selD.value, selD.unit)}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>{presets(selD.unit).map(p => <button key={p.v} onClick={() => setC(prev => prev.map(c => c.id === sel ? { ...c, value: p.v } : c))} style={{ padding: "3px 7px", background: "#0B0E14", border: `1px solid ${selD.color}18`, borderRadius: 4, color: selD.color, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} onMouseEnter={e => e.currentTarget.style.background = `${selD.color}12`} onMouseLeave={e => e.currentTarget.style.background = "#0B0E14"}>{p.l}</button>)}</div>
          </div>}

          {/* Multimeter mode selector */}
          {selD.type === "multimeter" && <div style={{ marginBottom: 12, padding: 10, background: "#0B0E14", borderRadius: 8, border: "1px solid #1E293B" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#FCD34D", letterSpacing: 1.5, marginBottom: 6 }}>MODE</div>
            <div style={{ display: "flex", gap: 4 }}>{["V", "A", "Ω", "Hz"].map(m => <button key={m} onClick={() => setC(p => p.map(c => c.id === sel ? { ...c, meterMode: m } : c))} style={{ flex: 1, padding: "6px 0", background: selD.meterMode === m ? "#FCD34D20" : "#0B0E14", border: `1px solid ${selD.meterMode === m ? "#FCD34D" : "#1E293B"}`, borderRadius: 6, color: selD.meterMode === m ? "#FCD34D" : "#64748B", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{m}</button>)}</div>
          </div>}

          <PF l="Label" v={selD.label} o={v => setC(p => p.map(c => c.id === sel ? { ...c, label: v } : c))} />
          <PF l="Rotation°" v={selD.rotation || 0} t="number" o={v => setC(p => p.map(c => c.id === sel ? { ...c, rotation: parseInt(v) || 0 } : c))} />

          {["switch_spst", "push_btn"].includes(selD.type) && <button onClick={() => { Snd.sw(); setC(p => p.map(c => c.id === sel ? { ...c, switchState: !c.switchState } : c)); }} style={{ width: "100%", padding: "8px 0", background: selD.switchState ? "#10B98120" : "#1E293B", border: `1px solid ${selD.switchState ? "#10B981" : "#334155"}`, borderRadius: 8, color: selD.switchState ? "#10B981" : "#94A3B8", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11, marginBottom: 10 }}>{selD.switchState ? "🟢 ON" : "🔴 OFF"}</button>}

          {/* LIVE SIM DATA with flow status */}
          {sim && simR[sel] && <div style={{ marginTop: 10, padding: 10, background: "#080B10", borderRadius: 10, border: `1px solid ${simR[sel].flowing ? "#22C55E20" : "#EF444420"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: "#0EA5E9" }}>📊 LIVE DATA</span>
              <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: simR[sel].flowing ? "#10B98120" : "#EF444420", color: simR[sel].flowing ? "#10B981" : "#EF4444" }}>{simR[sel].flowing ? "● FLOWING" : "○ NO FLOW"}</span>
            </div>
            {simR[sel].voltage !== undefined && <SR l="Voltage" v={`${simR[sel].voltage.toFixed(3)} V`} />}
            {simR[sel].current !== undefined && <SR l="Current" v={`${(simR[sel].current * 1000).toFixed(3)} mA`} />}
            {simR[sel].power > 0 && <SR l="Power" v={`${(simR[sel].power * 1000).toFixed(3)} mW`} />}
            {simR[sel].reading && <SR l="Reading" v={simR[sel].reading} />}
            {!simR[sel].flowing && simR[sel].whyNotFlowing && <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "#F59E0B10", borderLeft: "3px solid #F59E0B" }}>
              <div style={{ fontSize: 9, color: "#F59E0B", fontWeight: 700 }}>⚠ WHY NOT FLOWING:</div>
              <div style={{ fontSize: 10, color: "#E2E8F0", marginTop: 2 }}>{simR[sel].whyNotFlowing}</div>
            </div>}
          </div>}

          <button onClick={() => { save(); Snd.del(); setC(p => p.filter(c => c.id !== sel)); setSel(null); }} style={{ width: "100%", marginTop: 12, padding: "8px 0", background: "#EF444410", border: "1px solid #EF444430", borderRadius: 8, color: "#EF4444", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11 }}>🗑 Delete</button>
        </div> : <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div style={{ textAlign: "center", color: "#334155" }}><div style={{ fontSize: 36, opacity: .2, marginBottom: 8 }}>⊡</div><div style={{ fontSize: 11 }}>Select a component</div></div></div>}

        <div style={{ padding: 10, borderTop: "1px solid #1E293B", textAlign: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, background: "linear-gradient(135deg,#0EA5E9,#A855F7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>IEM SALT LAKE</div>
          <div style={{ fontSize: 8, color: "#334155", marginTop: 2 }}>Kolkata • v{PluginRegistry.version} • Plugin-Ready</div>
        </div>
      </div>}
    </div>

    {showC && <div style={{ height: 120, borderTop: "1px solid #1E293B", background: "#0B0E14", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 12px", borderBottom: "1px solid #1E293B" }}><span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: "#475569" }}>CONSOLE</span><button onClick={() => setShowC(false)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14 }}>✕</button></div>
      <div style={{ flex: 1, overflowY: "auto", padding: "3px 12px", fontSize: 10 }}>{cLog.map((e, i) => <div key={i} style={{ padding: "1px 0", color: e.t === "err" ? "#EF4444" : e.t === "ok" ? "#10B981" : e.t === "sys" ? "#0EA5E9" : "#475569" }}><span style={{ color: "#334155", marginRight: 8 }}>[{e.time}]</span>{e.m}</div>)}</div>
    </div>}
  </div>;
}

const PF = ({ l, v, o, t = "text" }) => <div style={{ marginBottom: 6 }}><div style={{ fontSize: 9, fontWeight: 700, color: "#475569", letterSpacing: 1, marginBottom: 2 }}>{l}</div><input type={t} value={v} onChange={e => o(e.target.value)} style={{ width: "100%", padding: "5px 8px", background: "#080B10", border: "1px solid #1E293B", borderRadius: 6, color: "#E2E8F0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} /></div>;
const SR = ({ l, v }) => <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11 }}><span style={{ color: "#475569" }}>{l}</span><span style={{ color: "#E2E8F0", fontWeight: 700 }}>{v}</span></div>;
const tB = { padding: "6px 10px", background: "#0B0E14", border: "1px solid #1E293B", borderRadius: 8, cursor: "pointer", color: "#64748B", fontSize: 14, fontFamily: "inherit" };
const zB = { width: 28, height: 28, background: "#111720", border: "1px solid #1E293B", borderRadius: 6, cursor: "pointer", color: "#64748B", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" };
