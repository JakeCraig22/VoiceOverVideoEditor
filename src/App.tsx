import { useEffect, useRef, useState } from 'react';
import { useRecording } from './useRecording';
import { clamp, timecode, type LocalVideo, type VideoTrim } from './domain/project';

export default function App() {
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<LocalVideo | null>(null);
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState<VideoTrim>({ start: 0, end: 0 });
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const reference = media ? `${media.name}:${media.size}:${media.lastModified}` : '';
  const recording = useRecording(video, reference, trim, setError);
  const ready = duration > 0 && !loading;
  const gap = Math.min(0.1, duration);

  useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const update = () => {
      const element = video.current;
      if (element) {
        if (element.currentTime >= trim.end) { element.pause(); element.currentTime = trim.end; }
        setPosition(element.currentTime);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, trim.end]);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setError('This video is taking a long time to open. Try another file if it does not load.'), 15000);
    return () => clearTimeout(timer);
  }, [loading]);

  function importFile(file?: File) {
    if (!file) return;
    if (!file.size || (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|ogv|ogg|mkv|avi)$/i.test(file.name))) {
      setError('Choose a non-empty video file, such as MP4 or WebM.'); return;
    }
    recording.stop(); recording.silence();
    video.current?.pause();
    setError(''); setDuration(0); setPosition(0); setTrim({ start: 0, end: 0 }); setPlaying(false); setLoading(true);
    setMedia({ name: file.name, size: file.size, lastModified: file.lastModified, url: URL.createObjectURL(file) });
  }
  function seek(time: number) {
    if (!video.current || !ready) return;
    recording.stop('Take recorded before seeking.'); recording.silence();
    const next = clamp(time, trim.start, trim.end);
    video.current.currentTime = next; setPosition(next);
  }
  function changeTrim(edge: 'start' | 'end', value: number) {
    if (!ready || recording.busy || !Number.isFinite(value)) return;
    const next = edge === 'start'
      ? { ...trim, start: clamp(value, 0, trim.end - gap) }
      : { ...trim, end: clamp(value, trim.start + gap, duration) };
    video.current?.pause(); setTrim(next);
    const nextPosition = clamp(position, next.start, next.end);
    if (video.current) video.current.currentTime = nextPosition;
    setPosition(nextPosition);
  }
  async function togglePlayback() {
    const element = video.current;
    if (!element || !ready) return;
    if (!element.paused) { element.pause(); return; }
    if (element.currentTime >= trim.end - 0.02 || element.currentTime < trim.start) seek(trim.start);
    try { await element.play(); } catch { setError('Playback could not start. Try Play again, or choose a video supported by this browser.'); }
  }
  const pct = (time: number) => duration ? `${time / duration * 100}%` : '0%';

  return <div className="app">
    <header><span className="brand">Voice Room</span><button className="primary" disabled={recording.busy} onClick={() => picker.current?.click()}>{media ? 'Replace video' : 'Import video'}</button></header>
    <main>
      <input ref={picker} aria-label="Import reference video" type="file" accept="video/*,.mkv,.avi" hidden onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }}/>
      {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <div className="workspace">
        <section className="preview panel" aria-label="Video preview">
          <div className="panel-heading"><h2>Reference preview</h2><span className="small">{ready ? 'LOCAL FILE' : ''}</span></div>
          <div className="screen">
            {media ? <video key={media.url} ref={video} src={media.url} playsInline preload="metadata" muted={muted}
              onLoadedMetadata={e => {
                const d = e.currentTarget.duration;
                if (!Number.isFinite(d) || d <= 0) { setLoading(false); setError('This video has no usable duration. Choose another file.'); return; }
                setDuration(d); setTrim({ start: 0, end: d }); setLoading(false); setError('');
              }}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
              onTimeUpdate={e => { const el = e.currentTarget; if (ready && el.currentTime >= trim.end) { el.pause(); if (el.currentTime > trim.end) el.currentTime = trim.end; } setPosition(el.currentTime); }}
              onSeeking={e => { if (ready && (e.currentTarget.currentTime < trim.start || e.currentTarget.currentTime > trim.end)) e.currentTarget.currentTime = clamp(e.currentTarget.currentTime, trim.start, trim.end); }}
              onError={() => { setLoading(false); setDuration(0); setPlaying(false); setError('This browser could not read the video. Try an MP4 with H.264 video or a supported WebM file.'); }}/>
              : <div className="empty"><button onClick={() => picker.current?.click()}>Choose reference video</button></div>}
            {loading && <div className="loading" role="status">Opening video…</div>}
          </div>
          <div className="transport"><div className="transport-buttons"><button disabled={!ready} onClick={() => seek(trim.start)} aria-label="Go to trim start">↤</button><button className="play" disabled={!ready} onClick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button><button disabled={!ready} onClick={() => seek(position + 5)} aria-label="Forward 5 seconds">+5s</button></div><div className="clock"><strong>{timecode(ready ? position - trim.start : 0)}</strong><span> / {timecode(trim.end - trim.start)}</span><small>PROJECT TIME</small></div><button disabled={!ready} aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? 'Unmute' : 'Mute'}</button></div>
          <div className="record-controls">
            <button className={recording.status === 'recording' ? 'record active' : 'record'} disabled={!ready || recording.status === 'saving'} onClick={() => recording.busy ? recording.stop() : recording.record()}>{recording.status === 'recording' ? '■ Stop recording' : recording.status === 'saving' ? 'Processing take…' : recording.busy ? 'Cancel' : '● Record'}</button>
            <span role="status" className={recording.status === 'recording' ? 'recording-status' : ''}>{recording.status === 'recording' ? `Recording · ${timecode(position)}` : recording.status === 'requesting' ? 'Waiting for microphone permission…' : recording.status === 'armed' ? 'Starting video…' : recording.notice}</span>
          </div>
          <div className="takes"><h2>Takes</h2>{recording.takes.length === 0 && <p>No takes</p>}{recording.takes.map(take => {
            const matching = take.reference === reference;
            const outside = take.start >= trim.end || take.start + take.duration <= trim.start;
            return <div className={recording.selected === take.id ? 'take selected' : 'take'} key={take.id}><div><strong>{take.name}</strong><small>{timecode(take.start)} · {timecode(take.duration)}{!matching ? ' · Reselect original video' : outside ? ' · Outside trim' : ''}</small></div><button disabled={recording.busy || !matching || outside || !ready} onClick={() => recording.playTake(take)} aria-label={`Play ${take.name}`}>Play take</button></div>;
          })}</div>
        </section>
        <aside className="panel details"><div className="panel-heading"><h2>Scene settings</h2></div><div className="details-body"><p className="eyebrow">REFERENCE VIDEO</p><h3 className="filename">{media?.name || 'No video selected'}</h3><p className="file-info">{media ? `${(media.size / 1024 / 1024).toFixed(1)} MB · ${ready ? timecode(duration) : 'Not ready'}` : 'Your video stays on this device.'}</p><hr/><h3>Video trim</h3><fieldset disabled={!ready || recording.busy}><legend className="sr-only">Video trim</legend>{(['start', 'end'] as const).map(edge => <div className="trim-field" key={edge}><label htmlFor={`${edge}-number`}>{edge === 'start' ? 'Start' : 'End'} <span>seconds</span></label><input id={`${edge}-number`} type="number" step="0.1" min={edge === 'start' ? 0 : trim.start + gap} max={edge === 'start' ? Math.max(0, trim.end - gap) : duration} value={Number(trim[edge].toFixed(3))} onChange={e => { if (e.target.value !== '') changeTrim(edge, Number(e.target.value)); }}/><button onClick={() => changeTrim(edge, position)}>Set to playhead</button></div>)}<button className="reset" onClick={() => { video.current?.pause(); setTrim({ start: 0, end: duration }); }}>Reset trim</button></fieldset><div className="duration"><span>Scene duration</span><strong data-testid="scene-duration">{timecode(trim.end - trim.start)}</strong></div></div></aside>
        <section className="panel timeline-panel" aria-label="Video timeline"><div className="panel-heading"><h2>Timeline <span className="timeline-tag">REFERENCE</span></h2><span className="small">SOURCE TIME</span></div><div className="timeline-body"><div className="ruler">{Array.from({ length: 5 }, (_, i) => <span key={i}>{timecode(duration * i / 4)}</span>)}</div><div className={`track ${ready ? '' : 'inactive'}`}><div className="selection" style={{ left: pct(trim.start), width: pct(trim.end - trim.start) }}><span className="marker start">IN</span><span className="track-title">{media?.name || 'Import a video to see its timeline'}</span><span className="marker end">OUT</span></div><div className="playhead" style={{ left: pct(position) }}/><input aria-label="Seek video" type="range" disabled={!ready} min="0" max={duration || 1} step="0.01" value={position} onChange={e => seek(Number(e.target.value))}/></div><div className="slider-row"><label htmlFor="trim-start">IN <strong>{timecode(trim.start)}</strong></label><input id="trim-start" aria-label="Trim start marker" type="range" disabled={!ready} min="0" max={duration || 1} step="0.01" value={trim.start} onChange={e => changeTrim('start', Number(e.target.value))}/></div><div className="slider-row"><label htmlFor="trim-end">OUT <strong>{timecode(trim.end)}</strong></label><input id="trim-end" aria-label="Trim end marker" type="range" disabled={!ready} min="0" max={duration || 1} step="0.01" value={trim.end} onChange={e => changeTrim('end', Number(e.target.value))}/></div></div></section>
      </div><footer>Not saved. Refreshing closes the video and deletes takes.</footer>
    </main>
  </div>;
}
