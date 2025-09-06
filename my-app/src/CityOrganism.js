import React, { useEffect, useRef, useState, useMemo } from "react";

// City as a Living Organism — growth & decay
// Single-file React component. Uses a grid-based dynamical system with
// density (d), infrastructure (inf), resources (res), and signal/attractor (sig).
// The city "grows" where resources + signal are strong and "decays" when
// they wane. Includes diffusion, seasonal cycles, and boom/bust pulses.

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function randf(a=0, b=1){ return a + Math.random() * (b - a); }

// Simple hash-based noise (deterministic-ish per key) so we don't import libs
function hashNoise(x, y, seed=1337){
  // bit-mix
  let n = Math.sin((x*374761393 + y*668265263 + seed*9301) * 0.000001) * 43758.5453;
  return n - Math.floor(n);
}

// HSL -> RGB helper for canvas colors
function hslToRgb(h, s, l) {
  // h: [0,360], s/l: [0,1]
  h = h % 360; if (h < 0) h += 360;
  const c = (1 - Math.abs(2*l - 1)) * s;
  const hp = h/60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r=0, g=0, b=0;
  if (0 <= hp && hp < 1) { r=c; g=x; b=0; }
  else if (1 <= hp && hp < 2) { r=x; g=c; b=0; }
  else if (2 <= hp && hp < 3) { r=0; g=c; b=x; }
  else if (3 <= hp && hp < 4) { r=0; g=x; b=c; }
  else if (4 <= hp && hp < 5) { r=x; g=0; b=c; }
  else if (5 <= hp && hp < 6) { r=c; g=0; b=x; }
  const m = l - c/2; r+=m; g+=m; b+=m;
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

export default function CityOrganism(){
  // You can tweak the base grid size. It will scale to fit the canvas.
  const BASE_W = 160; // columns
  const BASE_H = 100; // rows

  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [running, setRunning] = useState(true);
  const [seedKey, setSeedKey] = useState(1);

  // Controls
  const [growthRate, setGrowthRate] = useState(0.12); // city reproduction rate
  const [decayRate, setDecayRate] = useState(0.045); // abandonment/decay rate
  const [diffusion, setDiffusion] = useState(0.18); // diffusion for fields
  const [regenRate, setRegenRate] = useState(0.05); // resource regeneration
  const [consumption, setConsumption] = useState(0.08); // resource usage by density
  const [seasonAmp, setSeasonAmp] = useState(0.35); // seasonal pulse amplitude
  const [drawRoads, setDrawRoads] = useState(true);

  // internal pulses
  const boomPulseRef = useRef(0);
  const bustPulseRef = useRef(0);

  // grid state (typed arrays for speed)
  const grid = useMemo(() => {
    const N = BASE_W * BASE_H;
    return {
      d: new Float32Array(N), d2: new Float32Array(N), // density
      inf: new Float32Array(N), inf2: new Float32Array(N), // infrastructure
      res: new Float32Array(N), res2: new Float32Array(N), // resources
      sig: new Float32Array(N), sig2: new Float32Array(N), // attractor/signal
    };
    // eslint-disable-next-line
  }, [BASE_W, BASE_H]);

  const dims = { W: BASE_W, H: BASE_H, N: BASE_W*BASE_H };

  // index helpers
  const idx = (x, y) => x + y * dims.W;
  const wrapX = (x) => (x + dims.W) % dims.W;
  const wrapY = (y) => (y + dims.H) % dims.H;

  const laplace4 = (field, x, y, k=1) => {
    // 4-neighbour Laplacian with wrap
    const c = field[idx(x,y)];
    const n = field[idx(x, wrapY(y-1))];
    const s = field[idx(x, wrapY(y+1))];
    const w = field[idx(wrapX(x-1), y)];
    const e = field[idx(wrapX(x+1), y)];
    return (n + s + w + e - 4*c) * k;
  };

  // Seed initial conditions
  const seed = () => {
    const { d, inf, res, sig } = grid;
    d.fill(0); inf.fill(0); res.fill(0); sig.fill(0);

    // Terrain-ish: long-wave resource base ("river/sea/wind" of nutrients)
    for(let y=0; y<dims.H; y++){
      for(let x=0; x<dims.W; x++){
        const n1 = hashNoise(x*0.7, y*0.7, seedKey*17);
        const n2 = hashNoise(x*3.3, y*3.3, seedKey*137);
        const base = 0.35 + 0.35*n1 + 0.15*n2; // [~0.2..0.85]
        res[idx(x,y)] = clamp01(base);
      }
    }

    // Drop a few proto-cores
    const cores = 6 + Math.floor(randf(0,5));
    for(let i=0;i<cores;i++){
      const cx = Math.floor(randf(0, dims.W));
      const cy = Math.floor(randf(0, dims.H));
      const r = Math.floor(randf(3, 9));
      for(let y=-r; y<=r; y++){
        for(let x=-r; x<=r; x++){
          const xx = wrapX(cx + x), yy = wrapY(cy + y);
          const dist = Math.hypot(x,y);
          if (dist <= r) {
            const t = 1 - dist/r;
            grid.d[idx(xx,yy)] = Math.max(grid.d[idx(xx,yy)], 0.55 * t + 0.1);
            grid.inf[idx(xx,yy)] = Math.max(grid.inf[idx(xx,yy)], 0.4 * t);
            grid.sig[idx(xx,yy)] = Math.max(grid.sig[idx(xx,yy)], 0.6 * t + 0.2);
          }
        }
      }
    }
  };

  // Simulation step
  const tRef = useRef(0);
  const step = () => {
    const { d, d2, inf, inf2, res, res2, sig, sig2 } = grid;
    const t = tRef.current;
    const season = 0.5 + seasonAmp * 0.5 * Math.sin(t * 0.0025); // slow seasonal wave [0..1]

    const diff = diffusion * 0.2; // scale to stable range

    const boom = boomPulseRef.current; // decays every frame below
    const bust = bustPulseRef.current;

    for(let y=0;y<dims.H;y++){
      for(let x=0;x<dims.W;x++){
        const i = idx(x,y);

        // Diffusion of fields
        const Ld   = laplace4(d,   x,y, 1);
        const Linf = laplace4(inf, x,y, 1);
        const Lres = laplace4(res, x,y, 1);
        const Lsig = laplace4(sig, x,y, 1);

        // Resource dynamics
        // regen boosted by season + boom; consumed by density
        const regen = regenRate * (0.4 + 0.6*season + 0.8*boom);
        const cons  = consumption * (0.6 + 0.7*inf[i]); // better infra -> more throughput/consumption
        let resNext = res[i]
          + diff * Lres
          + regen * (1 - res[i])
          - cons * d[i]
          - 0.08 * bust * (0.3 + d[i]); // bust drains resources more where dense
        res2[i] = clamp01(resNext);

        // Attractor/signal dynamics (tends toward infrastructure, diffuses, slowly fades)
        let sigNext = sig[i]
          + diff * 1.25 * Lsig
          + 0.08 * (inf[i] - sig[i])
          - 0.01 * sig[i];
        // random micro-perturbations create organic branching
        sigNext += (hashNoise(x*2.7, y*2.7, 999 + t*0.001) - 0.5) * 0.003;
        sig2[i] = clamp01(sigNext);

        // Infrastructure dynamics (built by density, maintained with resources, wears down)
        let infNext = inf[i]
          + diff * 0.6 * Linf
          + 0.12 * (d[i] - inf[i]) * (0.5 + 0.6*res[i])
          - 0.015 * (1 - res[i])
          - 0.02 * bust;
        // weather/entropy wear
        infNext -= 0.01 * (hashNoise(x, y, 321 + t) - 0.5);
        inf2[i] = clamp01(infNext);

        // Density dynamics (growth w/ logistic + attractor + resources; decay if starved/congested)
        const attractiveness = 0.35 + 0.65*(0.6*sig[i] + 0.4*inf[i]);
        const available = res[i];
        const congestion = Math.max(0, d[i] - 0.65) * 0.6; // push-back when too dense

        let growth = growthRate * d[i] * (1 - d[i]) * attractiveness * (0.3 + 0.7*available) * (1 + 0.8*boom);
        let decay  = decayRate  * (0.35 + 0.65*(1 - available)) * (0.5 + congestion) * (1 + 0.8*bust);

        // drift between clusters to form tendrils
        growth += diff * 0.28 * Ld;

        let dNext = d[i] + growth - decay;
        // strong abandonment if infrastructure is very low but density is high (urban ruin)
        if (inf[i] < 0.12 && d[i] > 0.6) dNext -= 0.03 + 0.05*(0.12 - inf[i]);

        d2[i] = clamp01(dNext);
      }
    }

    // swap buffers
    grid.d.set(d2); grid.inf.set(inf2); grid.res.set(res2); grid.sig.set(sig2);

    // decay pulses
    boomPulseRef.current = Math.max(0, boom * 0.97 - 0.0005);
    bustPulseRef.current = Math.max(0, bust * 0.97 - 0.0004);

    tRef.current++;
  };

  // Drawing
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const DPR = window.devicePixelRatio || 1;

    // Size canvas to container
    const rect = canvas.parentElement.getBoundingClientRect();
    const pad = 8; // inner padding
    const w = Math.max(320, rect.width - pad*2);
    const h = Math.max(240, rect.height - pad*2);
    canvas.width = w * DPR; canvas.height = h * DPR;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Background
    ctx.fillStyle = "#0b0d10"; // deep ink
    ctx.fillRect(0,0,w,h);

    // Determine cell size preserving aspect
    const cellW = Math.floor(w / dims.W);
    const cellH = Math.floor(h / dims.H);
    const cs = Math.max(2, Math.min(cellW, cellH));
    const offX = Math.floor((w - cs*dims.W)/2);
    const offY = Math.floor((h - cs*dims.H)/2);

    // Render cells
    const { d, inf, res } = grid;

    // We draw density as color hue from cool (low) to warm (high),
    // brightness modulated by resources, and slight saturation from infra.
    for(let y=0;y<dims.H;y++){
      for(let x=0;x<dims.W;x++){
        const i = idx(x,y);
        const dens = d[i];
        const infra = inf[i];
        const rsrc = res[i];

        const hue = 200 - 170*dens;         // 200 (teal) -> 30 (amber)
        const sat = 0.25 + 0.55 * (0.2 + 0.8*infra);
        const lig = 0.06 + 0.70 * (0.1 + 0.9*rsrc) * (0.3 + 0.7*dens);
        const [R,G,B] = hslToRgb(hue, sat, lig);
        ctx.fillStyle = `rgb(${R},${G},${B})`;
        ctx.fillRect(offX + x*cs, offY + y*cs, cs, cs);
      }
    }

    // Optional: draw "roads" as faint connective tissue where infrastructure is high
    if (drawRoads) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = Math.max(1, Math.floor(cs*0.15));
      for(let y=0;y<dims.H;y++){
        for(let x=0;x<dims.W;x++){
          const i = idx(x,y);
          if (inf[i] > 0.62) {
            // Find neighbor with max infra among E,S
            let bestDir = null; let bestVal = -1;
            const dirs = [ [1,0], [0,1], [-1,0], [0,-1] ];
            for(const [dx,dy] of dirs){
              const j = idx(wrapX(x+dx), wrapY(y+dy));
              if (inf[j] > bestVal){ bestVal = inf[j]; bestDir = [dx,dy]; }
            }
            if (bestDir){
              const [dx,dy] = bestDir;
              const x1 = offX + x*cs + cs*0.5;
              const y1 = offY + y*cs + cs*0.5;
              const x2 = offX + (wrapX(x+dx))*cs + cs*0.5;
              const y2 = offY + (wrapY(y+dy))*cs + cs*0.5;
              // road color based on infra (cool gray)
              const v = Math.floor(90 + 120*Math.min(1, (inf[i]+bestVal)*0.5));
              ctx.strokeStyle = `rgb(${v},${v},${v})`;
              ctx.beginPath();
              ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
            }
          }
        }
      }
      ctx.restore();
    }

    // Subtle frame
    ctx.strokeStyle = "#1b1f24";
    ctx.lineWidth = 2;
    ctx.strokeRect(offX-1, offY-1, cs*dims.W+2, cs*dims.H+2);
  };

  // Animation loop
  const loop = () => {
    if (running) {
      // Multiple sub-steps per frame for smoother sim at large cells
      for(let k=0;k<2;k++) step();
      draw();
    }
    rafRef.current = requestAnimationFrame(loop);
  };

  // Lifecycle
  useEffect(() => {
    seed();
    draw();
    rafRef.current = requestAnimationFrame(loop);
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line
  }, [seedKey, running, growthRate, decayRate, diffusion, regenRate, consumption, seasonAmp, drawRoads]);

  // One-shot pulses
  const triggerBoom = () => { boomPulseRef.current = Math.min(1, boomPulseRef.current + 0.9); };
  const triggerBust = () => { bustPulseRef.current = Math.min(1, bustPulseRef.current + 0.9); };

  const onReset = () => { setSeedKey(k => k + 1); };

  return (
    <div className="w-full h-[85vh] min-h-[560px] bg-[#0a0c0f] text-white flex flex-col">
      <div className="px-4 py-3 flex items-center justify-between border-b border-[#1b1f24]">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">City as Organism</h1>
          <span className="text-sm text-zinc-400">growth ⇄ decay • diffusion • pulses</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setRunning(v=>!v)} className="px-3 py-1.5 rounded-2xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm">
            {running? "Pause" : "Play"}
          </button>
          <button onClick={triggerBoom} className="px-3 py-1.5 rounded-2xl bg-emerald-800/60 hover:bg-emerald-700/70 border border-emerald-600 text-sm">Boom</button>
          <button onClick={triggerBust} className="px-3 py-1.5 rounded-2xl bg-rose-800/60 hover:bg-rose-700/70 border border-rose-600 text-sm">Bust</button>
          <button onClick={onReset} className="px-3 py-1.5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-sm">Reset</button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-0">
        <div className="col-span-9 relative">
          <canvas ref={canvasRef} className="w-full h-full block"/>
          <div className="absolute left-3 bottom-3 text-xs text-zinc-400 bg-black/30 rounded-xl px-2 py-1">
            
            <span>seasonal: {seasonAmp.toFixed(2)} • diffusion: {diffusion.toFixed(2)} • growth: {growthRate.toFixed(2)} • decay: {decayRate.toFixed(2)}</span>
          </div>
        </div>
        <div className="col-span-3 border-l border-[#1b1f24] p-3 space-y-4 bg-[#0a0c0f]">
          <Section title="Dynamics">
            <Slider label={`Growth ${growthRate.toFixed(2)}`} value={growthRate} min={0.02} max={0.3} step={0.005} onChange={setGrowthRate} />
            <Slider label={`Decay ${decayRate.toFixed(2)}`} value={decayRate} min={0.0} max={0.2} step={0.005} onChange={setDecayRate} />
            <Slider label={`Diffusion ${diffusion.toFixed(2)}`} value={diffusion} min={0.0} max={0.5} step={0.01} onChange={setDiffusion} />
          </Section>
          <Section title="Resources">
            <Slider label={`Regen ${regenRate.toFixed(2)}`} value={regenRate} min={0.0} max={0.2} step={0.005} onChange={setRegenRate} />
            <Slider label={`Consumption ${consumption.toFixed(2)}`} value={consumption} min={0.0} max={0.25} step={0.005} onChange={setConsumption} />
            <Slider label={`Seasonal amplitude ${seasonAmp.toFixed(2)}`} value={seasonAmp} min={0.0} max={1.0} step={0.05} onChange={setSeasonAmp} />
          </Section>
          <Section title="Display">
            <Toggle label="Draw roads (infra links)" checked={drawRoads} onChange={setDrawRoads} />
          </Section>
          <Section title="Scenarios">
            <p className="text-xs text-zinc-400 leading-relaxed">
              • <span className="text-emerald-300">Boom</span> injects resources & demand → rapid growth.<br/>
              • <span className="text-rose-300">Bust</span> drains resources & maintenance → abandonment/ruin.<br/>
              Use sliders to explore hysteresis between growth & decay.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({title, children}){
  return (
    <div className="bg-[#0d1014] border border-[#1b1f24] rounded-2xl p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-400 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Slider({label, value, onChange, min=0, max=1, step=0.01}){
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-zinc-300 mb-1"><span>{label}</span></div>
      <input
        className="w-full accent-zinc-300"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e)=>onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function Toggle({label, checked, onChange}){
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer">
      <input type="checkbox" className="accent-zinc-300" checked={checked} onChange={(e)=>onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
