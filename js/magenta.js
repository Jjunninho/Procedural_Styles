// ================================================================
//  magenta.js — Integração Magenta.js (MusicRNN + MusicVAE)
//  Script clássico (não ES module).
//  Estado compartilhado acessado via window.__mgBridge (neon_ui.js).
// ================================================================

function bridge() { return window.__mgBridge; }

let mgRNN          = null;
let mgVAE          = null;
let mgSong         = null;
let mgMode         = 'melody';
let mgLoopTimer    = null;
let mgCurrentModel = 'basic_rnn';

const MELODY_CHECKPOINTS = {
  basic_rnn:            'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/basic_rnn',
  melody_rnn:           'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn',
  chord_pitches_improv: 'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/chord_pitches_improv',
};
const MELODY_LABELS = {
  basic_rnn:            'BASIC (rápido, ~30s)',
  melody_rnn:           'MELODY (equilibrado, ~1min)',
  chord_pitches_improv: 'IMPROV (qualidade máx, ~3min)',
};
const DRUMS_CHECKPOINT = 'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/drums_2bar_lokl_small';

// ── Lê compassos do input da UI
function getMgBars(fallback) {
  const el = document.getElementById('mgBars');
  if (!el) return fallback;
  const v = parseInt(el.value);
  return (!isNaN(v) && v > 0) ? v : fallback;
}

function updateModelSelVisibility() {
  const wrap = document.getElementById('mgModelWrap');
  if (wrap) wrap.style.display = mgMode === 'melody' ? '' : 'none';
}

// ── Mode toggle
document.querySelectorAll('.mg-opt').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.mg-opt').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    mgMode = el.dataset.mg;
    updateModelSelVisibility();
    mgStatus(`Modo: ${mgMode === 'melody' ? 'MELODIA' : 'BATERIA'}. Carregue o modelo.`, '');
    document.getElementById('mgLoadBtn').disabled    = false;
    document.getElementById('mgLoadBtn').textContent = '⚡ CARREGAR IA';
    document.getElementById('mgGenBtn').disabled     = true;
    document.getElementById('mgImproveBtn').disabled = true;
  });
});

// ── Troca de modelo
document.getElementById('mgModelSel').addEventListener('change', e => {
  mgCurrentModel = e.target.value;
  if (mgRNN) { try { mgRNN.dispose(); } catch (err) {} mgRNN = null; }
  document.getElementById('mgLoadBtn').disabled    = false;
  document.getElementById('mgLoadBtn').textContent = '⚡ CARREGAR IA';
  document.getElementById('mgGenBtn').disabled     = true;
  document.getElementById('mgImproveBtn').disabled = true;
  mgStatus(`Modelo: ${MELODY_LABELS[mgCurrentModel]}. Clique em CARREGAR IA.`, '');
});

document.getElementById('mgTemp').addEventListener('input', e => {
  document.getElementById('mgTempVal').textContent = parseFloat(e.target.value).toFixed(2);
});

// ── Sincroniza mgBars com preset ao focar
document.getElementById('mgBars')?.addEventListener('focus', () => {
  const b = bridge();
  if (b?.currentPreset?.bars) {
    const el = document.getElementById('mgBars');
    if (el && el.value === '8') el.value = b.currentPreset.bars;
  }
});

// ────────────────────────────────────────────────
//  HELPERS DE UI
// ────────────────────────────────────────────────
function mgStatus(msg, cls = '') {
  const el = document.getElementById('mgStatus');
  el.textContent = '▸ ' + msg;
  el.className   = 'mg-status' + (cls ? ' ' + cls : '');
}

function mgProgress(pct) {
  const bar  = document.getElementById('mgBar');
  const fill = document.getElementById('mgBarFill');
  if (pct === null) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  fill.style.width  = pct + '%';
}

function mgEnablePostGen() {
  mgProgress(null);
  document.getElementById('mgPlayBtn').disabled = false;
  document.getElementById('mgMidiBtn').disabled = false;
  document.getElementById('mgStopBtn').disabled = true;
}

// ────────────────────────────────────────────────
//  CARREGAR IA
// ────────────────────────────────────────────────
document.getElementById('mgLoadBtn').addEventListener('click', async () => {
  if (typeof mm === 'undefined') {
    mgStatus('❌ Magenta não carregou. Verifique o console.', 'err');
    return;
  }
  const btn = document.getElementById('mgLoadBtn');
  btn.disabled = true;
  mgProgress(10);

  try {
    if (mgMode === 'melody') {
      const modelKey   = mgCurrentModel || 'basic_rnn';
      const checkpoint = MELODY_CHECKPOINTS[modelKey];
      mgStatus(`Baixando ${MELODY_LABELS[modelKey]}... (pode demorar na 1ª vez)`, 'loading');
      if (mgRNN) { try { mgRNN.dispose(); } catch (e) {} mgRNN = null; }
      mgRNN = new mm.MusicRNN(checkpoint);
      mgProgress(30);
      await mgRNN.initialize();
    } else {
      mgStatus('Baixando MusicVAE (bateria)...', 'loading');
      if (mgVAE) { try { mgVAE.dispose(); } catch (e) {} mgVAE = null; }
      mgVAE = new mm.MusicVAE(DRUMS_CHECKPOINT);
      mgProgress(30);
      await mgVAE.initialize();
    }

    mgProgress(100);
    setTimeout(() => mgProgress(null), 500);

    const loadedLabel = mgMode === 'melody' ? MELODY_LABELS[mgCurrentModel] : 'DRUMS VAE';
    mgStatus(`✅ ${loadedLabel} pronto! Gere uma música e clique em GERAR COM IA.`, 'ok');
    btn.textContent = '✅ IA PRONTA';
    document.getElementById('mgGenBtn').disabled     = false;
    document.getElementById('mgImproveBtn').disabled = false;  // ← habilita Melhorar

  } catch (err) {
    mgStatus('❌ Erro ao carregar: ' + err.message, 'err');
    mgProgress(null);
    btn.disabled = false;
  }
});

// ────────────────────────────────────────────────
//  GERAÇÃO EM LOTES
// ────────────────────────────────────────────────
async function generateRNNChunked(inputSequence, totalSteps, temperature, chordProgression) {
  let ctx       = mm.sequences.clone(inputSequence);
  let stepsLeft = totalSteps;
  const CHUNK   = 32;

  mgProgress(0);

  while (stepsLeft > 0) {
    const chunk = Math.min(CHUNK, stepsLeft);
    const cont  = chordProgression
      ? await mgRNN.continueSequence(ctx, chunk, temperature, chordProgression)
      : await mgRNN.continueSequence(ctx, chunk, temperature);

    ctx = mm.sequences.concatenate([ctx, cont]);
    stepsLeft -= chunk;

    const pct = Math.round((1 - stepsLeft / totalSteps) * 100);
    mgProgress(pct);
    mgStatus(`Gerando IA: ${pct}%...`, 'warning');

    await new Promise(r => setTimeout(r, 10));
  }

  return ctx;
}

// ────────────────────────────────────────────────
//  CONVERSORES NOTAS ↔ NoteSequence
// ────────────────────────────────────────────────
function toMelodySeq(notes, bars, bpm) {
  const SPQ   = 4;
  const total = bars * 4 * SPQ;
  return {
    totalQuantizedSteps: total,
    quantizationInfo:    { stepsPerQuarter: SPQ },
    tempos:              [{ time: 0, qpm: bpm }],
    notes: notes
      .filter(n => n.pitch >= 48 && n.pitch <= 83)
      .map(n => ({
        pitch:              n.pitch,
        quantizedStartStep: Math.round(n.startBeat * SPQ),
        quantizedEndStep:   Math.min(Math.round((n.startBeat + n.duration) * SPQ), total),
        velocity:           n.velocity || 80
      }))
      .filter(n => n.quantizedStartStep < n.quantizedEndStep && n.quantizedStartStep < total)
  };
}

function fromMelodySeq(seq, offsetBeats = 0) {
  const SPQ = 4;
  return (seq.notes || [])
    .map(n => ({
      pitch:     n.pitch,
      startBeat: n.quantizedStartStep / SPQ + offsetBeats,
      duration:  Math.max(0.1, (n.quantizedEndStep - n.quantizedStartStep) / SPQ),
      velocity:  n.velocity || 80,
      isDrum:    false
    }))
    .filter(n => n.pitch >= 0);
}

function fromDrumSeq(seq) {
  const SPQ      = 4;
  const DRUM_MAP = { 0:36, 1:38, 2:42, 3:46, 4:41, 5:43, 6:45, 7:49, 8:51 };
  return (seq.notes || []).map(n => ({
    pitch:     DRUM_MAP[n.pitch % 9] || 36,
    startBeat: n.quantizedStartStep / SPQ,
    duration:  0.1,
    velocity:  n.velocity || 80,
    isDrum:    true
  }));
}

function loopTrack(notes, srcBeats, destOffset, destBeats) {
  if (!notes.length || srcBeats <= 0) return [];
  const result = [];
  for (let b = 0; b < destBeats; b += srcBeats) {
    const chunkLen = Math.min(srcBeats, destBeats - b);
    notes.forEach(n => {
      if (n.startBeat < chunkLen) {
        result.push({
          ...n,
          startBeat: destOffset + b + n.startBeat,
          duration:  Math.min(n.duration, chunkLen - n.startBeat)
        });
      }
    });
  }
  return result;
}

function buildChordProgression(preset, SCALES) {
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const ivs = SCALES[preset.scale]?.i;
  if (!ivs) return null;
  return Array.from({ length: preset.bars }, (_, bar) => {
    const deg       = preset.prog[bar % preset.prog.length];
    const rootMidi  = (preset.key % 12 + ivs[deg]) % 12;
    const rootName  = NOTE_NAMES[rootMidi];
    const thirdDeg  = (deg + 2) % ivs.length;
    const thirdMidi = (preset.key % 12 + ivs[thirdDeg]) % 12;
    const diff      = (thirdMidi - rootMidi + 12) % 12;
    return diff === 3 ? rootName + 'm' : rootName;
  });
}

// ────────────────────────────────────────────────
//  1 + 2. GERAR COM IA  (continuação + injeção no motor)
// ────────────────────────────────────────────────
document.getElementById('mgGenBtn').addEventListener('click', async () => {
  const b = bridge();
  if (!b) { mgStatus('❌ Bridge não encontrado. Recarregue a página.', 'err'); return; }

  const currentSong   = b.currentSong;
  const currentPreset = b.currentPreset;
  const SCALES        = b.SCALES;

  if (!currentSong) { mgStatus('❌ Gere uma música primeiro!', 'err'); return; }

  const genBtn    = document.getElementById('mgGenBtn');
  genBtn.disabled = true;
  mgProgress(5);

  const temp       = parseFloat(document.getElementById('mgTemp').value);
  const mgBars     = getMgBars(currentPreset.bars);   // ← lê o input da UI
  const totalBeats = currentPreset.bars * 4;
  const steps      = mgBars * 16;

  try {
    if (mgMode === 'melody') {
      if (!mgRNN) { mgStatus('❌ Carregue o modelo MELODIA primeiro!', 'err'); genBtn.disabled=false; mgProgress(null); return; }

      const melNotes = currentSong.melody;
      if (!melNotes.length) { mgStatus('❌ Nenhuma nota de melodia.', 'err'); genBtn.disabled=false; mgProgress(null); return; }

      mgStatus('🤖 MusicRNN gerando continuação...', 'loading');

      const seedSeq = toMelodySeq(melNotes, currentPreset.bars, currentPreset.bpm);

      let chords = null;
      if (mgCurrentModel === 'chord_pitches_improv') {
        chords = buildChordProgression(currentPreset, SCALES);
        if (!chords) { mgStatus('❌ Escala não encontrada para chord_pitches_improv.', 'err'); genBtn.disabled=false; mgProgress(null); return; }
        console.log('[Magenta GERAR] Acordes:', chords);
      }

      const continuation = await generateRNNChunked(seedSeq, steps, temp, chords);
      mgProgress(85);

      const aiNotes  = fromMelodySeq(continuation, totalBeats);
      const aiBars   = Math.max(totalBeats, aiNotes.reduce((m,n) => Math.max(m, n.startBeat+n.duration-totalBeats), 0));
      const bassLoop = loopTrack(currentSong.bass,  totalBeats, totalBeats, aiBars);
      const arpLoop  = loopTrack(currentSong.arp,   totalBeats, totalBeats, aiBars);
      const drumLoop = loopTrack(currentSong.drums, totalBeats, totalBeats, aiBars);

      mgSong = {
        melody: [...melNotes,          ...aiNotes],
        bass:   [...currentSong.bass,  ...bassLoop],
        arp:    [...currentSong.arp,   ...arpLoop],
        drums:  [...currentSong.drums, ...drumLoop],
        _cfg:   { ...currentPreset, bars: currentPreset.bars + mgBars }
      };

      b.injectSong(mgSong);   // ← INJEÇÃO NO MOTOR PRINCIPAL
      mgStatus(`✅ ${aiNotes.length} notas geradas · música injetada no motor!`, 'ok');

    } else {
      if (!mgVAE) { mgStatus('❌ Carregue o modelo BATERIA primeiro!', 'err'); genBtn.disabled=false; mgProgress(null); return; }

      mgStatus('🤖 MusicVAE gerando bateria...', 'loading');
      const [sample] = await mgVAE.sample(1, temp);
      mgProgress(85);

      const baseDrums = fromDrumSeq(sample);
      const aiDrums   = [];
      for (let bar = 0; bar < currentPreset.bars; bar += 2)
        baseDrums.forEach(n => aiDrums.push({ ...n, startBeat: n.startBeat + bar * 4 }));

      mgSong = {
        melody: currentSong.melody,
        bass:   currentSong.bass,
        arp:    currentSong.arp,
        drums:  aiDrums,
        _cfg:   { ...currentPreset }
      };

      b.injectSong(mgSong);   // ← INJEÇÃO NO MOTOR PRINCIPAL
      mgStatus(`✅ MusicVAE: ${aiDrums.length} eventos injetados no motor!`, 'ok');
    }

    mgEnablePostGen();

  } catch (err) {
    mgStatus('❌ Erro: ' + err.message, 'err');
    mgProgress(null);
  }
  genBtn.disabled = false;
});

// ────────────────────────────────────────────────
//  3. MELHORAR COM IA
//     Usa a 1ª metade da melodia como semente,
//     gera uma variação do mesmo comprimento,
//     substitui só a melodia (bass/arp/drums intactos),
//     e injeta de volta no motor principal.
// ────────────────────────────────────────────────
document.getElementById('mgImproveBtn').addEventListener('click', async () => {
  const b = bridge();
  if (!b) { mgStatus('❌ Bridge não encontrado.', 'err'); return; }

  const currentSong   = b.currentSong;
  const currentPreset = b.currentPreset;
  const SCALES        = b.SCALES;

  if (!currentSong) { mgStatus('❌ Gere uma música primeiro!', 'err'); return; }
  if (!mgRNN)       { mgStatus('❌ Carregue o modelo MELODIA primeiro!', 'err'); return; }

  const melNotes = currentSong.melody;
  if (!melNotes.length) { mgStatus('❌ Nenhuma nota de melodia para melhorar.', 'err'); return; }

  const impBtn    = document.getElementById('mgImproveBtn');
  impBtn.disabled = true;
  mgProgress(5);

  const temp    = parseFloat(document.getElementById('mgTemp').value);
  const srcBars = currentPreset.bars;
  const steps   = srcBars * 16;   // mesmo comprimento → variação, não continuação

  try {
    mgStatus('✨ Criando variação orgânica da melodia...', 'loading');

    // Usa a 1ª metade como semente para a IA "reimaginar" a música inteira
    const halfBars  = Math.max(1, Math.floor(srcBars / 2));
    const halfBeats = halfBars * 4;
    const seedNotes = melNotes.filter(n => n.startBeat < halfBeats);
    const finalSeed = seedNotes.length ? seedNotes : melNotes;

    const seedSeq = toMelodySeq(finalSeed, halfBars, currentPreset.bpm);

    let chords = null;
    if (mgCurrentModel === 'chord_pitches_improv') {
      chords = buildChordProgression(currentPreset, SCALES);
      console.log('[Magenta MELHORAR] Acordes:', chords);
    }

    const improved   = await generateRNNChunked(seedSeq, steps, temp, chords);
    mgProgress(85);

    const newMelody = fromMelodySeq(improved);

    mgSong = {
      melody: newMelody,
      bass:   currentSong.bass,   // preservados
      arp:    currentSong.arp,
      drums:  currentSong.drums,
      _cfg:   { ...currentPreset }
    };

    b.injectSong(mgSong);   // ← INJEÇÃO NO MOTOR PRINCIPAL
    mgStatus(`✅ Melodia melhorada: ${newMelody.length} notas · baixo/arpejo/bateria preservados.`, 'ok');
    mgEnablePostGen();

  } catch (err) {
    mgStatus('❌ Erro ao melhorar: ' + err.message, 'err');
    mgProgress(null);
  }
  impBtn.disabled = false;
});

// ────────────────────────────────────────────────
//  STOP / PLAY / MIDI IA
// ────────────────────────────────────────────────
document.getElementById('mgStopBtn').addEventListener('click', () => {
  if (typeof window.stopAll === 'function') window.stopAll();
  clearTimeout(mgLoopTimer);
  document.getElementById('mgPlayBtn').disabled = false;
  document.getElementById('mgStopBtn').disabled = true;
  mgStatus('■ Parado.', '');
});

document.getElementById('mgPlayBtn').addEventListener('click', () => {
  if (!mgSong) return;
  const b = bridge();
  if (!b) { mgStatus('❌ Bridge não encontrado.', 'err'); return; }
  if (typeof window.stopAll === 'function') window.stopAll();
  b.playMgSong(mgSong);
  document.getElementById('mgPlayBtn').disabled = true;
  document.getElementById('mgStopBtn').disabled = false;
  mgStatus('▶ Tocando...', 'ok');
});

document.getElementById('mgMidiBtn').addEventListener('click', () => {
  if (!mgSong) return;
  const b = bridge();
  if (b) b.exportMidi(mgSong, '_IA');
  else mgStatus('❌ Bridge não encontrado.', 'err');
});

// ────────────────────────────────────────────────
//  DIAGNÓSTICO / INIT
// ────────────────────────────────────────────────
function onMagentaReady() {
  updateModelSelVisibility();
  if (typeof mm !== 'undefined' && mm.MusicRNN) {
    document.getElementById('mg-badge').textContent = 'ONLINE';
    mgStatus('✅ Magenta pronto! Escolha o modelo e clique em CARREGAR IA.', 'ok');
  } else {
    mgStatus('❌ Magenta carregou mas mm.MusicRNN não encontrado.', 'err');
  }
}

function onMagentaFailed() {
  updateModelSelVisibility();
  mgStatus('❌ Falha ao carregar Magenta. Verifique o console.', 'err');
}

window.addEventListener('magenta-ready',  onMagentaReady);
window.addEventListener('magenta-failed', onMagentaFailed);

window.addEventListener('load', () => {
  updateModelSelVisibility();
  if (typeof mm !== 'undefined' && mm.MusicRNN) onMagentaReady();
  if (!bridge()) console.warn('[Magenta] __mgBridge ainda não disponível.');
});
