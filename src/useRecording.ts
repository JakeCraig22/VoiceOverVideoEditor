import { useEffect, useRef, useState, type RefObject } from 'react';
import type { VideoTrim } from './domain/project';

export interface Take { id: string; name: string; reference: string; start: number; duration: number; blob: Blob; buffer: AudioBuffer }
type Status = 'idle' | 'requesting' | 'armed' | 'recording' | 'saving';
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

export function useRecording(video: RefObject<HTMLVideoElement | null>, reference: string, trim: VideoTrim, report: (message: string) => void) {
  const [status, setStatus] = useState<Status>('idle');
  const state = useRef<Status>('idle');
  const [takes, setTakes] = useState<Take[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const audioClock = useRef({ context: 0, offset: 0 });
  const token = useRef(0);
  const mounted = useRef(true);
  const lastTime = useRef(0);
  const stopTime = useRef(0);
  const startTime = useRef(0);
  const sequence = useRef(0);
  const changeStatus = (next: Status) => { state.current = next; if (mounted.current) setStatus(next); };
  function silence() { source.current?.stop(); source.current = null; }
  function release() { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; }
  function stop(reason = 'Take recorded.') {
    if (state.current === 'requesting' || state.current === 'armed') {
      token.current++; release(); recorder.current = null; changeStatus('idle'); setNotice('Recording cancelled.'); return;
    }
    if (state.current !== 'recording') return;
    stopTime.current = lastTime.current;
    changeStatus('saving'); setNotice(reason);
    if (recorder.current?.state !== 'inactive') recorder.current?.stop();
    release(); video.current?.pause();
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; token.current++; if (recorder.current?.state === 'recording') recorder.current.stop(); release(); silence(); void context.current?.close(); context.current = null; };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let frame = 0;
    function interrupted() { stop('Recording interrupted. Captured audio kept.'); silence(); }
    function pause() { if (state.current === 'recording') stop('Take recorded.'); silence(); }
    function seeking() { stop('Take recorded before seeking.'); silence(); }
    function hidden() { if (document.hidden) { interrupted(); element!.pause(); } }
    function sync() {
      if (!element) return;
      if (!element.seeking) lastTime.current = Math.min(element.currentTime, trim.end);
      if (state.current === 'recording' && element.currentTime >= trim.end) stop();
      const take = takes.find(t => t.id === selected && t.reference === reference);
      const offset = take ? element.currentTime - take.start : -1;
      if (take && context.current && !element.paused && !element.seeking && element.readyState >= 3 && offset >= 0 && offset < take.duration && element.currentTime < trim.end) {
        if (source.current && Math.abs(audioClock.current.offset + context.current.currentTime - audioClock.current.context - offset) > 0.08) silence();
        if (!source.current) {
          const node = context.current.createBufferSource(); node.buffer = take.buffer; node.connect(context.current.destination);
          node.start(0, offset, Math.min(take.duration - offset, trim.end - element.currentTime));
          source.current = node;
          audioClock.current = { context: context.current.currentTime, offset };
          node.onended = () => { if (source.current === node) source.current = null; };
        }
      } else silence();
      frame = requestAnimationFrame(sync);
    }
    element.addEventListener('pause', pause); element.addEventListener('seeking', seeking);
    element.addEventListener('waiting', interrupted); element.addEventListener('ended', pause);
    element.addEventListener('error', interrupted); document.addEventListener('visibilitychange', hidden);
    frame = requestAnimationFrame(sync);
    return () => { cancelAnimationFrame(frame); silence(); element.removeEventListener('pause', pause); element.removeEventListener('seeking', seeking); element.removeEventListener('waiting', interrupted); element.removeEventListener('ended', pause); element.removeEventListener('error', interrupted); document.removeEventListener('visibilitychange', hidden); };
  }, [reference, trim, selected, takes]);

  async function record() {
    if (state.current !== 'idle' || !video.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { report('Microphone access requires HTTPS or localhost in a supported browser.'); return; }
    if (typeof MediaRecorder === 'undefined') { report('This browser does not support microphone recording. Try a current browser.'); return; }
    const element = video.current;
    if (element.currentTime >= trim.end - 0.05) { report('Move the playhead before the trim end to record.'); return; }
    element.pause(); silence(); setSelected(null); report(''); setNotice('');
    changeStatus('requesting'); const request = ++token.current;
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== token.current || !mounted.current) { input.getTracks().forEach(t => t.stop()); return; }
      stream.current = input;
      let capture: MediaRecorder | undefined;
      for (const mimeType of formats.filter(format => MediaRecorder.isTypeSupported(format))) {
        try { capture = new MediaRecorder(input, { mimeType }); break; } catch { /* Try next supported encoder. */ }
      }
      capture ??= new MediaRecorder(input);
      const active = capture; recorder.current = active;
      const chunks: Blob[] = [];
      active.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      active.onerror = () => { report('Recording failed. Any usable audio will be kept.'); stop('Recording interrupted.'); };
      input.getAudioTracks().forEach(track => { track.onended = () => stop('Microphone disconnected. Captured audio kept.'); track.onmute = () => stop('Microphone interrupted. Captured audio kept.'); });
      active.onstop = async () => {
        release();
        if (!mounted.current) return;
        changeStatus('saving');
        try {
          const blob = new Blob(chunks, { type: active.mimeType || chunks[0]?.type });
          if (!blob.size) throw new Error('empty');
          const buffer = await context.current!.decodeAudioData(await blob.arrayBuffer());
          const length = Math.min(buffer.duration, Math.max(0, stopTime.current - startTime.current));
          if (length < 0.05) throw new Error('short');
          const take: Take = { id: crypto.randomUUID(), name: `Take ${++sequence.current}`, reference, start: startTime.current, duration: length, blob, buffer };
          if (mounted.current) { setTakes(previous => [...previous, take]); setSelected(take.id); }
        } catch { if (mounted.current) report('The take was too short or could not be decoded. Please record it again.'); }
        finally { recorder.current = null; if (mounted.current) changeStatus('idle'); }
      };
      changeStatus('armed');
      await element.play();
      if (request !== token.current) { element.pause(); return; }
      startTime.current = element.currentTime; lastTime.current = element.currentTime;
      active.start(250); changeStatus('recording');
    } catch (error) {
      if (request !== token.current) return;
      release(); element.pause(); changeStatus('idle');
      const name = error instanceof DOMException ? error.name : '';
      report(name === 'NotAllowedError' ? 'Microphone permission denied or playback blocked. Allow microphone access in this site’s browser settings, then try again.' : name === 'NotFoundError' ? 'No microphone found. Connect one and try again.' : name === 'NotReadableError' ? 'The microphone is unavailable. Close other apps using it and try again.' : 'Could not start recording. Check your microphone and browser, then try again.');
    }
  }

  async function playTake(take: Take) {
    const element = video.current;
    if (!element || state.current !== 'idle') return;
    element.pause(); silence(); setSelected(take.id); report('');
    try {
      context.current ??= new AudioContext(); await context.current.resume();
      element.currentTime = Math.max(trim.start, take.start);
      await element.play();
    } catch { report('Could not play this take. Try again.'); }
  }
  return { status, takes, selected, notice, record, stop, playTake, silence, busy: status !== 'idle' };
}
