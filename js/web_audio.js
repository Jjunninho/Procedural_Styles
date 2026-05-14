// ────────────────────────────────────────────────────────────────
//  WEB AUDIO SYNTH — LOOKAHEAD SCHEDULER v4 (Genome Edition)
//  Novidades:
//    · canal 'counter' (contraponto) no mixer e no scheduler
//    · ∞ Loop Infinito Evolutivo — _appendInfiniteBlock()
//    · startInfiniteMode(cfg, genome, memory) chamado pela UI
// ────────────────────────────────────────────────────────────────
import { KICK, SNARE, generateBlock, genCounterpoint } from './theory.js';

export let audioCtx         = null;
export let scheduledNodes   = [];
export let playStartTime    = 0;
export let totalDuration    = 0;
export let isPlaying        = false;
export let isPaused         = false;
export let animFrame        = null;
export let currentSong      = null;
export let currentBpm       = 90;
export let currentMidiNotas = [];

export let masterGain    = null;
export let trackGains    = { melody:null, bass:null, arp:null, drums:null, counter:null };
export let reverbNode    = null;
export let reverbEnabled = false;

// ── Variáveis do ∞ Loop Infinito Evolutivo ────────────────────
let infiniteMode        = false;
let infiniteCfg         = null;
let infiniteGenome      = null;
let infiniteMemory      = null;
let infiniteBlockOffset = 0;

/**
 * startInfiniteMode — ativa geração contínua evolutiva.
 * Chamar da UI após generate() se o botão ∞ LOOP estiver ativo.
 */
export function startInfiniteMode(cfg, genome, memory){
  infiniteMode        = true;
  infiniteCfg         = cfg;
  infiniteGenome      = genome;
  infiniteMemory      = memory;
  infiniteBlockOffset = (cfg.bars||8) * 4;
  console.log('[audio] ∞ Loop ativo | genome geração:', genome.generation);
}

/** _appendInfiniteBlock — gera e anexa próximo bloco sem parar o player */
function _appendInfiniteBlock(){
  if(!infiniteCfg || !infiniteGenome) return;

  infiniteBlockOffset += (infiniteCfg.bars||8) * 4;

  const result = generateBlock(
    infiniteCfg, infiniteGenome, infiniteMemory, infiniteBlockOffset
  );
  infiniteGenome = result.genome;
  infiniteMemory = result.memory;
  const block    = result.song;

  // Anexa notas em tempo real para todos os canais
  for(const t of ['melody','bass','arp','drums']){
    if(!currentSong[t]) currentSong[t] = [];
    if(block[t]) currentSong[t].push(...block[t]);
  }
  // Contraponto do novo bloco
  const newCounter = genCounterpoint(block.melody, infiniteCfg);
  if(!currentSong.counter) currentSong.counter = [];
  currentSong.counter.push(...newCounter);

  // Atualiza totalDuration para o scheduler não parar
  const bps = currentBpm/60;
  const allBeats = Math.max(...currentSong.melody.map(n => n.startBeat+n.duration));
  totalDuration  = allBeats / bps;

  console.log(`[audio] ∞ bloco +${infiniteCfg.bars}c | genome gen:${infiniteGenome.generation}`);
}

// ─────────────────────────────────────────────────────────────
let schedulerTimer    = null;
const lookahead       = 25;
const scheduleAhead   = 0.5;
let nextNoteIndices   = { melody:0, bass:0, arp:0, drums:0, counter:0 };
export let globalStartBeat  = 0;
export let playAbsStartTime = 0;

export function updateAudioState(song, bpm, midiNotas){
  currentSong       = song;
  currentBpm        = bpm;
  currentMidiNotas  = midiNotas;
  const bars        = (song._cfg?.bars) || 8;
  totalDuration     = (bars*4) / (bpm/60);
}

export function getAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  return audioCtx;
}

function midiToFreq(midi){ return 440*Math.pow(2,(midi-69)/12); }

// ── playNote ────────────────────────────────────────────────────
function playNote(ctx, pitch, startSec, durSec, velocity, isDrum, trackName){
  const gain = ctx.createGain();

  if(trackGains?.[trackName]) gain.connect(trackGains[trackName]);
  else                        gain.connect(ctx.destination);

  const vol = (velocity/127)*0.18;

  if(isDrum){
    const buf = ctx.createBuffer(1, ctx.sampleRate*0.15, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/2000);
    const src    = ctx.createBufferSource();
    src.buffer   = buf;
    const filter = ctx.createBiquadFilter();
    filter.type  = pitch===KICK ? 'lowpass' : pitch===SNARE ? 'bandpass' : 'highpass';
    filter.frequency.value = pitch===KICK ? 120 : pitch===SNARE ? 1800 : 8000;
    src.connect(filter); filter.connect(gain);
    gain.gain.setValueAtTime(vol*(pitch===KICK?2.5:pitch===SNARE?1.8:0.6), startSec);
    gain.gain.exponentialRampToValueAtTime(0.001, startSec+0.12);
    src.start(startSec); src.stop(startSec+0.15);
    scheduledNodes.push({ node:src, gain, endTime:startSec+0.15 });
    return;
  }

  const osc = ctx.createOscillator();
  osc.frequency.value = midiToFreq(pitch);

  // Canal counter usa onda senoidal suavizada (segundo plano)
  if(trackName==='counter'){
    osc.type = 'sine';
    osc.connect(gain);
    gain.gain.setValueAtTime(0, startSec);
    gain.gain.linearRampToValueAtTime(vol*0.5, startSec+0.02);
    gain.gain.setValueAtTime(vol*0.35, startSec+Math.min(0.06,durSec*0.3));
    gain.gain.linearRampToValueAtTime(0, startSec+durSec);
    osc.start(startSec); osc.stop(startSec+durSec+0.01);
    scheduledNodes.push({ node:osc, gain, endTime:startSec+durSec+0.01 });
    return;
  }

  if(pitch<48){
    osc.type='sawtooth';
  } else if(pitch<60){
    osc.type='triangle';
  } else {
    osc.type='square';
    const lp = ctx.createBiquadFilter();
    lp.type  = 'lowpass';
    lp.frequency.value = 1200+(pitch-60)*40;
    osc.connect(lp); lp.connect(gain);
    gain.gain.setValueAtTime(0, startSec);
    gain.gain.linearRampToValueAtTime(vol, startSec+0.01);
    gain.gain.setValueAtTime(vol*0.7, startSec+Math.min(0.05,durSec*0.3));
    gain.gain.linearRampToValueAtTime(0, startSec+durSec);
    osc.start(startSec); osc.stop(startSec+durSec+0.01);
    scheduledNodes.push({ node:osc, gain, endTime:startSec+durSec+0.01 });
    return;
  }

  osc.connect(gain);
  gain.gain.setValueAtTime(0, startSec);
  gain.gain.linearRampToValueAtTime(vol, startSec+0.01);
  gain.gain.setValueAtTime(vol*0.7, startSec+Math.min(0.05,durSec*0.3));
  gain.gain.linearRampToValueAtTime(0, startSec+durSec);
  osc.start(startSec); osc.stop(startSec+durSec+0.01);
  scheduledNodes.push({ node:osc, gain, endTime:startSec+durSec+0.01 });
}

function cleanFinishedNodes(){
  const now = getAudio().currentTime;
  scheduledNodes = scheduledNodes.filter(item => {
    if(now > item.endTime+0.1){
      try{ item.node.disconnect(); item.gain.disconnect(); }catch(e){}
      return false;
    }
    return true;
  });
}

// ── scheduler ───────────────────────────────────────────────────
function scheduler(){
  if(!isPlaying || isPaused) return;

  const ctx           = getAudio();
  const currentTime   = ctx.currentTime;
  const scheduleUntil = currentTime + scheduleAhead;
  const bps           = currentBpm/60;

  const trackNames = ['melody','bass','arp','drums','counter'];

  for(const tname of trackNames){
    const notes = currentSong[tname] || [];
    let idx     = nextNoteIndices[tname] || 0;

    while(idx < notes.length){
      const note           = notes[idx];
      const noteBeatOffset = note.startBeat - globalStartBeat;
      if(noteBeatOffset < 0){ idx++; continue; }

      const noteAbsTime = playAbsStartTime + (noteBeatOffset/bps);
      if(noteAbsTime < scheduleUntil){
        const durSec = note.duration/bps;
        playNote(ctx, note.pitch, noteAbsTime, durSec, note.velocity, note.isDrum, tname);
        idx++;
      } else break;
    }
    nextNoteIndices[tname] = idx;
  }

  cleanFinishedNodes();

  // ── Detecção de fim: em modo infinito, gera próximo bloco ──
  const bars       = (currentSong._cfg?.bars) || 8;
  const totalBeats = currentSong.melody?.length
    ? Math.max(...currentSong.melody.map(n=>n.startBeat+n.duration))
    : bars*4;
  const endTimeAbs = playAbsStartTime + ((totalBeats - globalStartBeat)/bps);
  const remainingSec = endTimeAbs - currentTime;

  if(infiniteMode && remainingSec < scheduleAhead*2){
    _appendInfiniteBlock();
  } else if(!infiniteMode && currentTime >= endTimeAbs){
    stopAll();
    return;
  }

  schedulerTimer = setTimeout(scheduler, lookahead);
}

export function playAllFrom(startBeat){
  stopAll();
  const ctx = getAudio();
  if(ctx.state==='suspended') ctx.resume();

  isPlaying       = true;
  isPaused        = false;
  globalStartBeat = startBeat;
  nextNoteIndices = { melody:0, bass:0, arp:0, drums:0, counter:0 };
  infiniteMode    = false;   // reset; UI re-ativa se necessário

  playAbsStartTime = ctx.currentTime + 0.1;
  scheduler();
}

export function stopAll(){
  clearTimeout(schedulerTimer);
  infiniteMode = false;

  for(const item of scheduledNodes){
    try{ item.node.stop(); }catch(e){}
    try{ item.node.disconnect(); item.gain.disconnect(); }catch(e){}
  }
  scheduledNodes = [];
  isPlaying = false;
  isPaused  = false;

  const btn = document.getElementById('btn-play');
  if(btn){ btn.textContent='▶ PLAY'; btn.className='neon-btn play-btn'; }
}

export function togglePlay(){
  if(!currentSong) return;
  const ctx = getAudio();
  const btn = document.getElementById('btn-play');

  if(isPlaying){
    if(!isPaused){
      ctx.suspend();
      isPaused = true;
      btn.textContent='▶ PLAY';
      btn.classList.remove('playing');
    } else {
      ctx.resume();
      isPaused=false;
      btn.textContent='■ PAUSE';
      btn.classList.add('playing');
      scheduler();
    }
    return;
  }

  playAllFrom(0);
  btn.textContent='■ PAUSE';
  btn.className='neon-btn play-btn playing';
}

// ── Audio Graph ─────────────────────────────────────────────────
function initAudioNodes(){
  const ctx = getAudio();
  masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  const convolver = ctx.createConvolver();
  const impLen    = 2;
  const impulse   = ctx.createBuffer(2, ctx.sampleRate*impLen, ctx.sampleRate);
  for(let ch=0; ch<2; ch++){
    const ch_ = impulse.getChannelData(ch);
    for(let i=0; i<ch_.length; i++)
      ch_[i] = (Math.random()*2-1)*Math.exp(-i/(ctx.sampleRate*0.1));
  }
  convolver.buffer = impulse;
  reverbNode = convolver;
}

export function setupTracks(){
  const ctx = getAudio();
  if(!masterGain) initAudioNodes();
  for(const t of ['melody','bass','arp','drums','counter']){
    const g = ctx.createGain();
    // counter um pouco mais baixo por padrão
    if(t==='counter') g.gain.value = 0.65;
    g.connect(masterGain);
    trackGains[t] = g;
  }
}

export function setTrackVolume(track, value){
  if(trackGains[track])
    trackGains[track].gain.setValueAtTime(value/127, getAudio().currentTime);
}

export function setTrackMute(track, mute){
  if(trackGains[track])
    trackGains[track].gain.setValueAtTime(mute?0:1, getAudio().currentTime);
}

let soloActive = null;
export function setTrackSolo(track, solo){
  const ctx = getAudio();
  if(solo){
    soloActive = track;
    for(const t of Object.keys(trackGains))
      trackGains[t].gain.setValueAtTime(t===track?1:0, ctx.currentTime);
  } else {
    soloActive = null;
    for(const t of Object.keys(trackGains))
      trackGains[t].gain.setValueAtTime(t==='counter'?0.65:1, ctx.currentTime);
  }
}

export function toggleReverb(enable){
  const ctx = getAudio();
  if(!reverbNode) initAudioNodes();
  reverbEnabled = enable;
  for(const t of Object.keys(trackGains)){
    trackGains[t].disconnect();
    if(enable){ trackGains[t].connect(reverbNode); reverbNode.connect(masterGain); }
    else       { trackGains[t].connect(masterGain); }
  }
}
