import { GENRES, NOTE_NAMES, randomByGenre, generate, randomPreset, SCALES,
         generateBlock, genCounterpoint, PRESETS, STYLE_PROFILES } from './theory.js';
import { LEARNED_PRESETS } from './midi_dataset.learned_presets.js';
import {
  updateAudioState, togglePlay, stopAll, getAudio,
  currentSong, currentBpm, isPlaying, isPaused,
  playAbsStartTime, globalStartBeat,
  setupTracks, setTrackMute, setTrackSolo, toggleReverb,
  masterGain, audioCtx, scheduledNodes, playAllFrom,
  startInfiniteMode,
} from './web_audio.js';

// ── Mescla os presets aprendidos (MIDI dataset) nos presets base ──
Object.assign(PRESETS, LEARNED_PRESETS);

// ── STATE ──────────────────────────────────────────────────
let loopEnabled    = false;
let loopInfinite   = false;
let activeGenreKey = null;
let currentPreset  = null;

// ── Radar live state ───────────────────────────────────────
let radarPreset    = null;
let radarColor     = '#00f3ff';
let radarSmooth    = [0, 0, 0, 0, 0, 0]; // smoothed axis values

// ── TRACK CONFIG ───────────────────────────────────────────
const TRACKS = [
  { key:'melody',  name:'MELODY',  color:'#00f3ff' },
  { key:'bass',    name:'BASS',    color:'#f472b6' },
  { key:'arp',     name:'ARP',     color:'#39ff14' },
  { key:'drums',   name:'DRUMS',   color:'#facc15' },
  { key:'counter', name:'COUNTER', color:'#ff88ff' },
];

// ── DOM READY ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderGenreGrid();
  renderLearnedGrid();
  buildMixer();
  attachControls();
  requestAnimationFrame(renderLoop);
});

// ════════════════════════════════════════════════════════════
//  GENRE GRID
// ════════════════════════════════════════════════════════════
function renderGenreGrid() {
  const grid = document.getElementById('genre-grid');
  grid.innerHTML = '';

  for (const [key, data] of Object.entries(GENRES)) {
    const parts    = data.label.split(' ');
    const emoji    = parts[0];
    const textName = parts.slice(1).join(' ');
    const color    = data.color || '#00f3ff';

    const card = document.createElement('div');
    card.className = 'genre-card';
    card.id = `genre-${key}`;
    card.style.color = color;
    card.innerHTML = `
      <div class="genre-icon">${emoji}</div>
      <div class="genre-name">${textName.toUpperCase()}</div>
    `;
    card.onclick = () => generateFromGenre(key, textName, color);
    grid.appendChild(card);
  }
}

// ════════════════════════════════════════════════════════════
//  LEARNED PRESETS GRID
// ════════════════════════════════════════════════════════════
function renderLearnedGrid() {
  const grid = document.getElementById('learned-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Paleta de cores por estilo
  const styleColors = {
    chillwave: '#00f3ff',
    dreampop:  '#c77dff',
    japanese:  '#ff6b9d',
    default:   '#ffe066',
  };

  for (const [key, preset] of Object.entries(LEARNED_PRESETS)) {
    const color  = styleColors[preset.style] || styleColors.default;
    const bpmStr = `${preset.bpm} BPM`;
    const swing  = preset.styleOverride?.swing?.toFixed(2) || '—';
    const arp    = preset.styleOverride?.arpDensity?.toFixed(2) || '—';

    const card = document.createElement('div');
    card.className = 'genre-card learned-card';
    card.id = `learned-${key}`;
    card.style.color = color;
    card.style.borderColor = color + '55';
    card.innerHTML = `
      <div class="genre-icon">${preset.label.split(' ')[0]}</div>
      <div class="genre-name">${preset.style.toUpperCase()}</div>
      <div class="learned-meta" style="color:${color}99">
        ${bpmStr} · SW ${swing} · ARP ${arp}
      </div>
    `;
    card.onclick = () => applyLearnedPreset(key, preset, color);
    grid.appendChild(card);
  }
}

function applyLearnedPreset(key, preset, color) {
  setStatus(`// CARREGANDO: ${preset.label}...`, '');

  // Atualiza radar live
  radarPreset = preset;
  radarColor  = color;
  radarSmooth = [0, 0, 0, 0, 0, 0]; // reset smooth para animar entrada
  const nameEl = document.getElementById('radar-preset-name');
  if (nameEl) nameEl.style.color = color,
              nameEl.textContent = preset.label.replace(/^🤖\s*/,'');

  document.querySelectorAll('.genre-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`learned-${key}`)?.classList.add('active');

  setTimeout(() => {
    try {
      currentPreset = preset;
      const song    = generate(preset);
      song._color   = color;
      if (song._cfg) song._cfg.bpm = preset.bpm;

      updateAudioState(song, preset.bpm, []);
      updateInfoDisplay(preset, song, preset.label);
      setStatus(buildStatusMsg(preset, song), 'success');

      stopAll();
      togglePlay();

      if (loopInfinite && song._genome) {
        startInfiniteMode(song._cfg || preset, song._genome, song._memory);
      } else if (loopEnabled) {
        scheduleLoop();
      }
    } catch (e) {
      setStatus(`// ERRO: ${e.message}`, 'error');
      console.error(e);
    }
  }, 30);
}

// ════════════════════════════════════════════════════════════
//  MIXER BUILD
// ════════════════════════════════════════════════════════════
function buildMixer() {
  const mixer = document.getElementById('track-mixer');
  mixer.innerHTML = '';

  // ── Channels wrapper ────────────────────────────────────
  const chWrap = document.createElement('div');
  chWrap.className = 'mixer-channels';

  for (const t of TRACKS) {
    const ch = document.createElement('div');
    ch.className = 'track-ch';
    ch.dataset.track = t.key;
    ch.innerHTML = `
      <div class="color-dot" style="color:${t.color};background:${t.color}"></div>
      <span class="name">${t.name}</span>
      <input type="range" class="track-fader"
             min="0" max="100" value="100"
             data-track="${t.key}" title="Volume ${t.name}">
      <div class="track-btns">
        <button class="mute-btn" data-track="${t.key}" title="Mute">M</button>
        <button class="solo-btn" data-track="${t.key}" title="Solo">S</button>
      </div>
    `;
    chWrap.appendChild(ch);
  }
  mixer.appendChild(chWrap);

  // ── Live Radar panel ────────────────────────────────────
  const radarWrap = document.createElement('div');
  radarWrap.className = 'mixer-radar-wrap';
  radarWrap.innerHTML = `
    <canvas id="radar-live" width="128" height="128"></canvas>
    <div class="mixer-radar-label" id="radar-preset-name">— SEM PRESET —</div>
  `;
  mixer.appendChild(radarWrap);

  // Events
  mixer.querySelectorAll('.track-fader').forEach(fader => {
    fader.addEventListener('input', e => {
      const { track } = e.target.dataset;
      setTrackFaderVolume(track, e.target.value / 100);
    });
  });

  mixer.querySelectorAll('.mute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const isMuted = btn.classList.toggle('muted');
      const track   = btn.dataset.track;
      setTrackMute(track, isMuted);
      const fader = mixer.querySelector(`.track-fader[data-track="${track}"]`);
      if (fader) fader.style.opacity = isMuted ? '0.3' : '1';
    });
  });

  mixer.querySelectorAll('.solo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('soloed');
      mixer.querySelectorAll('.solo-btn').forEach(b => b.classList.remove('soloed'));
      if (!wasActive) {
        btn.classList.add('soloed');
        setTrackSolo(btn.dataset.track, true);
      } else {
        setTrackSolo(null, false);
      }
    });
  });
}


function generateFromGenre(genreKey, genreLabel, accentColor) {
  setStatus(`// GERANDO: ${genreLabel.toUpperCase()}...`, '');
  activeGenreKey = genreKey;

  // Highlight card
  document.querySelectorAll('.genre-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`genre-${genreKey}`)?.classList.add('active');

  setTimeout(() => {
    try {
      const preset = randomByGenre(genreKey);
      currentPreset = preset;
      const song = generate(preset);
      song._color = accentColor;
      if (song._cfg) song._cfg.bpm = preset.bpm;

      // ── Atualiza radar com perfil do estilo sorteado ──
      const styleProfile = STYLE_PROFILES[preset.style];
      if (styleProfile) {
        radarPreset = { ...preset, styleOverride: styleProfile };
      } else {
        radarPreset = preset;
      }
      radarColor  = accentColor;
      radarSmooth = [0, 0, 0, 0, 0, 0];
      const nameEl = document.getElementById('radar-preset-name');
      if (nameEl) {
        nameEl.style.color = accentColor;
        nameEl.textContent = (preset.style || genreLabel).toUpperCase();
      }

      updateAudioState(song, preset.bpm, []);
      updateInfoDisplay(preset, song, genreLabel);
      setStatus(buildStatusMsg(preset, song), 'success');

      stopAll();
      togglePlay();

      // Ativa loop infinito evolutivo se botão ligado
      if(loopInfinite && song._genome){
        startInfiniteMode(song._cfg || preset, song._genome, song._memory);
      } else if (loopEnabled) {
        scheduleLoop();
      }

    } catch (e) {
      setStatus(`// ERRO: ${e.message}`, 'error');
      console.error(e);
    }
  }, 30);
}

function generateRandom() {
  const preset = randomPreset();
  currentPreset = preset;
  const song    = generate(preset);
  song._color   = '#00f3ff';

  document.querySelectorAll('.genre-card').forEach(c => c.classList.remove('active'));
  activeGenreKey = null;

  updateAudioState(song, preset.bpm, []);

  updateInfoDisplay(preset, song, 'RANDOM');
  setStatus(buildStatusMsg(preset, song), 'success');

  stopAll();
  togglePlay();

  if(loopInfinite && song._genome){
    startInfiniteMode(song._cfg || preset, song._genome, song._memory);
  }
}

function updateInfoDisplay(preset, song, genreLabel) {
  const keyNote = NOTE_NAMES[preset.key % 12] || '?';
  const scaleLabel = preset.scale?.toUpperCase() || '?';

  set('disp-genre', genreLabel.toUpperCase());
  set('disp-bpm', preset.bpm);
  set('disp-key', keyNote);
  set('disp-scale', scaleLabel.length > 8 ? scaleLabel.slice(0, 8) : scaleLabel);
  // Indica se o estilo vem da biblioteca (aprendido) ou do perfil hardcoded
  const styleLabel = preset.styleOverride
    ? (preset.style || '').toUpperCase().slice(0, 8) + '*'
    : (preset.style || '').toUpperCase().slice(0, 10);
  set('disp-style', styleLabel);
  set('disp-bars', `${preset.bars || 8}`);
  set('disp-swing', preset.styleOverride
    ? preset.styleOverride.swing.toFixed(2)
    : (preset.style ? '···' : '---'));

  // BPM slider sync
  const bpmSlider = document.getElementById('bpm-slider');
  if (bpmSlider) {
    bpmSlider.value = preset.bpm;
    set('bpm-value', preset.bpm);
  }

  // Chord pills (show progression indices)
  const progDisplay = document.getElementById('prog-display');
  if (progDisplay && preset.prog) {
    const romanNumerals = ['I','II','III','IV','V','VI','VII'];
    progDisplay.innerHTML = preset.prog.map((deg, i) =>
      `<span class="chord-pill" data-idx="${i}">${romanNumerals[deg] || deg}</span>`
    ).join('');
  }
}

// ════════════════════════════════════════════════════════════
//  BUILD STATUS MSG — mostra DNA do genome na barra de status
// ════════════════════════════════════════════════════════════
function buildStatusMsg(preset, song){
  const gen  = song?._genome?.generation ?? 0;
  const mut  = song?._genome ? (song._genome.mutationRate*100).toFixed(0)+'%' : '—';
  const bpm  = preset.bpm || '?';
  const tag  = loopInfinite ? ' · ∞ EVOLVING' : '';
  return `// ${bpm} BPM · GEN:${gen} · MUT:${mut}${tag}`;
}

// ════════════════════════════════════════════════════════════
//  TOGGLE INFINITE — ∞ Loop Evolutivo
// ════════════════════════════════════════════════════════════
function toggleInfinite(){
  loopInfinite = !loopInfinite;
  const btn = document.getElementById('btn-infinite');
  if(btn) btn.classList.toggle('loop-active', loopInfinite);
  // Se já está tocando, ativa imediatamente
  if(loopInfinite && currentSong?._genome && isPlaying){
    startInfiniteMode(
      currentSong._cfg || currentPreset,
      currentSong._genome,
      currentSong._memory
    );
  }
}
window.toggleInfinite = toggleInfinite;
function attachControls() {
  // Random button
  document.getElementById('btn-random')?.addEventListener('click', generateRandom);

  // BPM slider
  document.getElementById('bpm-slider')?.addEventListener('input', e => {
    const bpm = parseInt(e.target.value);
    set('bpm-value', bpm);
    set('disp-bpm', bpm);
    // Rebuild with new bpm if song exists
    if (currentPreset) {
      const wasPlaying = isPlaying;
      stopAll();
      currentPreset.bpm = bpm;
      const song = generate(currentPreset);
      if (currentSong) song._color = currentSong._color;
      updateAudioState(song, bpm, []);
      if (wasPlaying) togglePlay();
    }
  });

  // Master volume
  document.getElementById('master-volume')?.addEventListener('input', e => {
    const val = e.target.value / 100;
    if (masterGain) masterGain.gain.setValueAtTime(val, audioCtx?.currentTime || 0);
  });

  // Reverb
  document.getElementById('btn-reverb')?.addEventListener('click', e => {
    const active = e.currentTarget.classList.toggle('active');
    toggleReverb(active);
  });

  // Loop simples
  document.getElementById('btn-loop')?.addEventListener('click', e => {
    loopEnabled = e.currentTarget.classList.toggle('loop-active');
  });

  // ∞ Loop Infinito Evolutivo
  document.getElementById('btn-infinite')?.addEventListener('click', toggleInfinite);

  // MIDI export
  document.getElementById('btn-midi')?.addEventListener('click', exportMIDI);

  // Expose globals
  window.togglePlay = togglePlay;
  window.stopAll    = stopAll;
}

// ════════════════════════════════════════════════════════════
//  TRACK FADER (direct gain, separate from mute)
// ════════════════════════════════════════════════════════════
function setTrackFaderVolume(track, value) {
  // Import trackGains
  import('./web_audio.js').then(m => {
    if (m.trackGains && m.trackGains[track]) {
      m.trackGains[track].gain.setValueAtTime(value, m.audioCtx?.currentTime || 0);
    }
  });
}

// ════════════════════════════════════════════════════════════
//  LOOP SCHEDULING
// ════════════════════════════════════════════════════════════
function scheduleLoop() {
  if (!loopEnabled) return;
  // Check periodically if song ended, then restart
  const checkInterval = setInterval(() => {
    if (!isPlaying && loopEnabled && currentSong) {
      clearInterval(checkInterval);
      togglePlay();
      setTimeout(scheduleLoop, 100);
    } else if (!loopEnabled) {
      clearInterval(checkInterval);
    }
  }, 500);
}

// ════════════════════════════════════════════════════════════
//  RENDER LOOP
// ════════════════════════════════════════════════════════════
function renderLoop() {
  drawCanvas();
  animateWaveform();
  updateBeatCounter();
  updateFooter();
  updateChordHighlight();
  drawRadarLive();
  requestAnimationFrame(renderLoop);
}

// ── RADAR LIVE ────────────────────────────────────────────
function drawRadarLive() {
  const canvas = document.getElementById('radar-live');
  if (!canvas) return;
  const ctx2 = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx2.clearRect(0, 0, W, H);

  const cx = W/2, cy = H/2, r = W*0.37;
  const N  = 6;
  const LABELS = ['RHYTHM','LEAP','ARP','SWING','OCTAVE','ENTROPY'];
  const color  = radarColor;

  // ── Compute target values ─────────────────────────────
  let targets = [0, 0, 0, 0, 0, 0];
  const so = radarPreset?.styleOverride;

  if (so) {
    targets[0] = Math.min(so.rhythmDensity / 1.0, 1);
    targets[1] = Math.min(so.leapChance    / 1.0, 1);
    targets[2] = Math.min(so.arpDensity    / 2.0, 1);
    targets[3] = Math.min(so.swing         / 0.5, 1);
    targets[4] = Math.min(so.octaveSpread  / 3.0, 1);
    targets[5] = Math.min((so.rhythmicEntropy||0), 1);
  }

  // ── Real-time beat pulse ──────────────────────────────
  if (isPlaying && !isPaused && radarPreset) {
    const bps  = currentBpm / 60;
    const beat = (getAudio().currentTime - playAbsStartTime) * bps;
    const phi  = beat % 1; // 0..1 within beat
    // Rhythm pulses on every beat
    const beatPulse = phi < 0.15 ? (1 - phi/0.15) * 0.35 : 0;
    targets[0] = Math.min(targets[0] + beatPulse, 1);
    // Arp pulses on 8th notes
    const arpPhi = (beat * 2) % 1;
    const arpPulse = arpPhi < 0.1 ? (1 - arpPhi/0.1) * 0.25 * targets[2] : 0;
    targets[2] = Math.min(targets[2] + arpPulse, 1);
    // Entropy: jitter when playing
    targets[5] = Math.min(targets[5] + (Math.random() * 0.12 * (so?.rhythmicEntropy||0.1)), 1);
  }

  // ── Smooth (lerp) towards targets ────────────────────
  const speed = isPlaying ? 0.12 : 0.05;
  for (let i = 0; i < N; i++) {
    radarSmooth[i] += (targets[i] - radarSmooth[i]) * speed;
  }

  // ── Draw grid rings ───────────────────────────────────
  function pt(i, rad) {
    const a = (Math.PI * 2 * i / N) - Math.PI / 2;
    return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad };
  }

  for (let ring = 1; ring <= 4; ring++) {
    ctx2.beginPath();
    for (let i = 0; i < N; i++) {
      const p = pt(i, r * ring / 4);
      i === 0 ? ctx2.moveTo(p.x, p.y) : ctx2.lineTo(p.x, p.y);
    }
    ctx2.closePath();
    ctx2.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx2.lineWidth = 0.8;
    ctx2.stroke();
  }

  // ── Draw axes ─────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const end = pt(i, r);
    ctx2.beginPath();
    ctx2.moveTo(cx, cy);
    ctx2.lineTo(end.x, end.y);
    ctx2.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx2.lineWidth = 0.8;
    ctx2.stroke();
  }

  // ── Draw data polygon ─────────────────────────────────
  const pts = radarSmooth.map((v, i) => pt(i, Math.max(r * v, 2)));

  // Fill
  ctx2.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx2.moveTo(p.x, p.y) : ctx2.lineTo(p.x, p.y));
  ctx2.closePath();
  ctx2.fillStyle = color + '28';
  ctx2.fill();

  // Stroke glow
  ctx2.shadowColor = color;
  ctx2.shadowBlur  = isPlaying ? 6 : 2;
  ctx2.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx2.moveTo(p.x, p.y) : ctx2.lineTo(p.x, p.y));
  ctx2.closePath();
  ctx2.strokeStyle = color;
  ctx2.lineWidth   = 1.5;
  ctx2.stroke();
  ctx2.shadowBlur = 0;

  // Dots
  pts.forEach(p => {
    ctx2.beginPath();
    ctx2.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx2.fillStyle = color;
    ctx2.shadowColor = color;
    ctx2.shadowBlur = 4;
    ctx2.fill();
    ctx2.shadowBlur = 0;
  });

  // ── Labels ────────────────────────────────────────────
  ctx2.font = '6px monospace';
  ctx2.fillStyle = 'rgba(255,255,255,0.5)';
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  for (let i = 0; i < N; i++) {
    const lbl = pt(i, r + 12);
    ctx2.fillText(LABELS[i], lbl.x, lbl.y);
  }

  // ── Center dot (beat flash) ───────────────────────────
  if (isPlaying && !isPaused) {
    const bps = currentBpm / 60;
    const phi = ((getAudio().currentTime - playAbsStartTime) * bps) % 1;
    const flash = phi < 0.1 ? (1 - phi/0.1) : 0;
    if (flash > 0) {
      ctx2.beginPath();
      ctx2.arc(cx, cy, 3 * flash, 0, Math.PI * 2);
      ctx2.fillStyle = color;
      ctx2.shadowColor = color;
      ctx2.shadowBlur = 8 * flash;
      ctx2.fill();
      ctx2.shadowBlur = 0;
    }
  }
}

// ── CANVAS PIANO ROLL ──────────────────────────────────────
function drawCanvas() {
  const canvas = document.getElementById('neon-canvas');
  if (!canvas || !currentSong) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.offsetWidth;
  const H   = canvas.parentElement.offsetHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const song = currentSong;
  const bpm  = currentBpm;
  const bars = (song._cfg?.bars) || 8;
  const totalBeats = bars * 4;

  // Grid lines
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#00f3ff';
  ctx.lineWidth = 1;
  for (let b = 0; b <= totalBeats; b++) {
    const x = (b / totalBeats) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Notes
  const allNotes = [];
  const COLORS = {
    melody:  { fill: song._color || '#00f3ff', glow: song._color || '#00f3ff' },
    bass:    { fill: '#f472b6', glow: '#f472b6' },
    arp:     { fill: '#39ff14', glow: '#39ff14' },
    drums:   { fill: '#facc15', glow: '#facc15' },
    counter: { fill: '#ff88ff', glow: '#ff88ff' },
  };

  if (song.counter) song.counter.forEach(n => allNotes.push({...n, track:'counter'}));
  if (song.melody)  song.melody.forEach(n  => allNotes.push({...n, track:'melody'}));
  if (song.bass)    song.bass.forEach(n    => allNotes.push({...n, track:'bass'}));
  if (song.arp)     song.arp.forEach(n     => allNotes.push({...n, track:'arp'}));
  if (song.drums)   song.drums.forEach(n   => { if (n.isDrum) allNotes.push({...n, track:'drums'}); });

  if (!allNotes.length) return;

  const pitches = allNotes.map(n => n.pitch);
  const minP = Math.max(0,   Math.min(...pitches) - 2);
  const maxP = Math.min(127, Math.max(...pitches) + 2);
  const range = maxP - minP + 1;

  for (const n of allNotes) {
    const { fill, glow } = COLORS[n.track] || COLORS.melody;
    const x = (n.startBeat / totalBeats) * W;
    const w = Math.max(2, (n.duration / totalBeats) * W - 1);
    const y = H - ((n.pitch - minP + 1) / range) * H;
    const h = Math.max(2, H / range - 1);

    ctx.globalAlpha = n.track === 'arp' ? 0.55 : n.track === 'counter' ? 0.45 : 0.85;
    ctx.fillStyle   = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur  = 6;

    if (w > 4) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  // Playhead
  ctx.shadowBlur = 0;
  let currentBeat = 0;
  if (isPlaying && !isPaused) {
    const audioTime = getAudio().currentTime;
    const bps = bpm / 60;
    currentBeat = globalStartBeat + (audioTime - playAbsStartTime) * bps;
  }

  if (currentBeat > 0 && currentBeat <= totalBeats) {
    const px = (currentBeat / totalBeats) * W;
    ctx.globalAlpha  = 1;
    ctx.shadowColor  = '#ffffff';
    ctx.shadowBlur   = 12;
    ctx.fillStyle    = '#ffffff';
    ctx.fillRect(px - 1, 0, 2, H);
  }
}

// ── WAVEFORM ANIMATION ────────────────────────────────────
function animateWaveform() {
  const bars = document.querySelectorAll('#waveform-bars .bar');
  if (isPlaying && !isPaused) {
    bars.forEach(bar => {
      const h = 4 + Math.random() * 18;
      bar.style.height = h + 'px';
    });
  } else {
    bars.forEach(bar => { bar.style.height = '4px'; });
  }
}

// ── BEAT COUNTER ──────────────────────────────────────────
function updateBeatCounter() {
  const el = document.getElementById('beat-counter');
  if (!el) return;
  if (isPlaying && !isPaused) {
    const bps = currentBpm / 60;
    const beat = globalStartBeat + (getAudio().currentTime - playAbsStartTime) * bps;
    el.textContent = `BEAT ${Math.max(0, beat).toFixed(1)}`;
  } else {
    el.textContent = isPaused ? 'PAUSED' : 'STOPPED';
  }
}

// ── FOOTER STATS ──────────────────────────────────────────
function updateFooter() {
  const nc = document.getElementById('node-count');
  const cs = document.getElementById('ctx-state');
  if (nc) nc.textContent = `NODES: ${scheduledNodes?.length ?? 0}`;
  if (cs && audioCtx) cs.textContent = `CTX: ${audioCtx.state.toUpperCase()}`;
}

// ── CHORD HIGHLIGHT ───────────────────────────────────────
function updateChordHighlight() {
  if (!isPlaying || !currentSong || !currentPreset?.prog) return;
  const bps     = currentBpm / 60;
  const beat    = globalStartBeat + (getAudio().currentTime - playAbsStartTime) * bps;
  const bars    = (currentSong._cfg?.bars) || 8;
  const beatsPerChord = (bars * 4) / currentPreset.prog.length;
  const activeIdx = Math.floor(beat / beatsPerChord) % currentPreset.prog.length;

  document.querySelectorAll('.chord-pill').forEach((pill, i) => {
    pill.classList.toggle('active', i === activeIdx);
  });
}

// ════════════════════════════════════════════════════════════
//  MIDI EXPORT (basic)
// ════════════════════════════════════════════════════════════
function exportMIDI() {
  if (!currentSong) return alert('Gere uma música primeiro!');

  try {
    // Duração em segundos definida pelo usuário
    const durSecs  = parseFloat(document.getElementById('midi-duration')?.value) || 30;
    const maxBeats = durSecs * (currentBpm / 60);

    setStatus(`// GERANDO FAIXA DE ${durSecs}s...`, 'loading');

    // Cria uma cópia isolada para estender
    let exportSong = {
      melody:  [...(currentSong.melody || [])],
      bass:    [...(currentSong.bass || [])],
      arp:     [...(currentSong.arp || [])],
      drums:   [...(currentSong.drums || [])],
      counter: [...(currentSong.counter || [])],
      _cfg:    { ...(currentSong._cfg || currentPreset) }
    };

    const originalLengthBeats = (exportSong._cfg.bars || 8) * 4;
    let curLength = originalLengthBeats;

    let simGenome = currentSong._genome ? JSON.parse(JSON.stringify(currentSong._genome)) : null;
    let simMemory = currentSong._memory ? JSON.parse(JSON.stringify(currentSong._memory)) : null;
    let simOffset = originalLengthBeats;

    // Gera novos blocos musicais até preencher os segundos pedidos
    while (curLength < maxBeats) {
      if (simGenome) {
        const res = generateBlock(exportSong._cfg, simGenome, simMemory, simOffset);
        simGenome = res.genome;
        simMemory = res.memory;

        exportSong.melody.push(...res.song.melody);
        exportSong.bass.push(...res.song.bass);
        exportSong.arp.push(...res.song.arp);
        if (res.song.drums) exportSong.drums.push(...res.song.drums);

        const newCounter = genCounterpoint(res.song.melody, exportSong._cfg);
        exportSong.counter.push(...newCounter);

        simOffset += (exportSong._cfg.bars || 8) * 4;
        curLength = simOffset;
      } else {
        // Fallback mecânico
        ['melody', 'bass', 'arp', 'drums', 'counter'].forEach(track => {
          const originalNotes = currentSong[track] || [];
          const loopedNotes = originalNotes.map(n => ({
            ...n,
            startBeat: n.startBeat + curLength
          }));
          exportSong[track].push(...loopedNotes);
        });
        curLength += originalLengthBeats;
      }
    }

    // 1. ATUALIZA A MÚSICA PARA A UI: Configura os novos compassos e metadados
    exportSong._cfg.bars = curLength / 4;
    exportSong._genome = simGenome;
    exportSong._memory = simMemory;
    exportSong._color = currentSong._color; // Mantém a cor original no canvas

    // 2. Exporta o arquivo MIDI
    const midi = buildMIDI(exportSong, currentBpm, maxBeats);
    const blob = new Blob([midi], { type: 'audio/midi' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `procedural_${Math.round(durSecs)}s.mid`;
    a.click();
    URL.revokeObjectURL(url);
    
    // 3. ATUALIZA A TELA E O PLAYER: Injeta a música gigante no motor
    const wasPlaying = isPlaying;
    stopAll(); // Para o áudio atual para não encavalar
    updateAudioState(exportSong, currentBpm, []); // Atualiza a UI!
    
    if (wasPlaying) togglePlay(); // Volta a tocar automaticamente do início se já estava tocando

    setStatus(`// MIDI EXPORTADO E UI ATUALIZADA · ${durSecs}s`, 'success');
  } catch (e) {
    setStatus(`// ERRO MIDI: ${e.message}`, 'error');
    console.error(e);
  }
}

function buildMIDI(song, bpm, maxBeats = Infinity) {
  const ticksPerBeat = 480;
  const usPerBeat    = Math.round(60_000_000 / bpm);

  // Filtra notas pelo limite de beats (= duração em segundos)
  function filterNotes(notes) {
    return (notes || []).filter(n => n.startBeat < maxBeats);
  }

  const header = [
    0x4D,0x54,0x68,0x64, // MThd
    0,0,0,6,             // chunk length
    0,1,                 // format 1
    0,6,                 // 6 tracks (1 tempo + melody/bass/arp/drums/counter)
    (ticksPerBeat>>8)&0xFF, ticksPerBeat&0xFF,
  ];

  function varLen(n) {
    if (n < 0x80) return [n];
    if (n < 0x4000) return [0x80|(n>>7), n&0x7F];
    return [0x80|((n>>14)&0x7F), 0x80|((n>>7)&0x7F), n&0x7F];
  }

  function makeTempoTrack() {
    const events = [
      ...varLen(0), 0xFF,0x51,0x03,
      (usPerBeat>>16)&0xFF,(usPerBeat>>8)&0xFF,usPerBeat&0xFF,
      ...varLen(0), 0xFF,0x2F,0x00,
    ];
    return makeTrackChunk(events);
  }

  function makeNoteTrack(notes, channel=0) {
    // Sort notes by startBeat
    const sorted = [...notes].sort((a,b) => a.startBeat - b.startBeat);
    const events = [];
    let currentTick = 0;

    for (const n of sorted) {
      const onTick  = Math.round(n.startBeat * ticksPerBeat);
      const offTick = Math.round((n.startBeat + n.duration) * ticksPerBeat);
      const vel     = Math.min(127, Math.max(1, n.velocity || 80));
      const pitch   = Math.min(127, Math.max(0, n.pitch || 60));

      events.push({ tick: onTick,  data: [0x90|channel, pitch, vel] });
      events.push({ tick: offTick, data: [0x80|channel, pitch, 0]   });
    }

    events.sort((a,b) => a.tick - b.tick);

    const raw = [];
    for (const ev of events) {
      const delta = ev.tick - currentTick;
      currentTick = ev.tick;
      raw.push(...varLen(delta), ...ev.data);
    }
    raw.push(...varLen(0), 0xFF,0x2F,0x00);
    return makeTrackChunk(raw);
  }

  function makeTrackChunk(data) {
    const len = data.length;
    return [
      0x4D,0x54,0x72,0x6B, // MTrk
      (len>>24)&0xFF,(len>>16)&0xFF,(len>>8)&0xFF,len&0xFF,
      ...data,
    ];
  }

  const allBytes = [
    ...header,
    ...makeTempoTrack(),
    ...makeNoteTrack(filterNotes(song.melody),  0),
    ...makeNoteTrack(filterNotes(song.bass),    1),
    ...makeNoteTrack(filterNotes(song.arp),     2),
    ...makeNoteTrack(filterNotes(song.counter), 3),
    ...makeNoteTrack(filterNotes((song.drums||[]).filter(n=>n.isDrum)), 9),
  ];

  return new Uint8Array(allBytes);
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setStatus(msg, type='') {
  const el = document.getElementById('status-line');
  if (!el) return;
  el.textContent = msg;
  el.className   = `status-line${type ? ' '+type : ''}`;
}

// ── INIT ──────────────────────────────────────────────────
setupTracks();

// ════════════════════════════════════════════════════════════
//  PLAY MÚSICA DA IA (chamado por magenta.js via bridge)
// ════════════════════════════════════════════════════════════
function playMgSong(mgSong) {
  if (!mgSong) return;
  stopAll();
  updateAudioState(mgSong, currentBpm || 120, []);
  playAllFrom(0);
}

// ── Injeta a música da IA como currentSong oficial do motor
//    Atualiza UI de status, BPM display e chord pills
function injectSong(song) {
  if (!song) return;
  stopAll();
  updateAudioState(song, currentBpm || 120, []);

  // Atualiza status bar do header
  const statusEl = document.getElementById('status-line');
  if (statusEl) {
    statusEl.textContent = `// IA INJETADA · ${currentBpm} BPM`;
    statusEl.className = 'status-line success';
  }

  // Recalcula compass count a partir das notas
  const allNotes = [...(song.melody||[]), ...(song.bass||[]), ...(song.arp||[]), ...(song.drums||[])];
  const maxBeat  = allNotes.reduce((m, n) => Math.max(m, n.startBeat + n.duration), 0);
  const newBars  = Math.ceil(maxBeat / 4);
  if (song._cfg) song._cfg.bars = newBars;

  // Habilita os botões principais
  const btnPlay = document.getElementById('btn-play');
  if (btnPlay) {
    btnPlay.textContent = '▶ PLAY';
    btnPlay.className   = 'neon-btn play-btn';
  }
}

function exportMidiForMg(song, suffix = '') {
  if (!song) return;
  try {
    const midi = buildMIDI(song, currentBpm || 120);
    const blob = new Blob([midi], { type: 'audio/midi' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `procedural_song${suffix}.mid`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('[MIDI export]', e);
  }
}

// ════════════════════════════════════════════════════════════
//  BRIDGE PARA magenta.js
// ════════════════════════════════════════════════════════════
function exposeBridge() {
  window.__mgBridge = {
    get currentSong()   { return currentSong;   },
    get currentBpm()    { return currentBpm;    },
    get currentPreset() { return currentPreset; },
    SCALES,
    stopAll,
    playMgSong,
    injectSong,
    exportMidi: exportMidiForMg,
  };
}

exposeBridge();
