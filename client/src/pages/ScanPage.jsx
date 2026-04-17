import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ScanPage.module.css';

// ── Upload / Drop Zone ───────────────────────────────────────
function UploadZone({ onFile }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [preview,  setPreview]  = useState(null);
  const [fileName, setFileName] = useState('');

  const handleFile = useCallback((file) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setFileName(file.name);
    onFile(file);
  }, [onFile]);

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f);
  };
  const clear = () => { setPreview(null); setFileName(''); onFile(null); };

  if (preview) {
    return (
      <div className={styles.previewCard}>
        <img src={preview} alt="Preview" className={styles.previewImg} />
        <button className={styles.previewCloseBtn} onClick={clear}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div className={styles.previewGrid} />
        <div className={styles.previewBar} />
      </div>
    );
  }

  return (
    <>
      <div
        className={`${styles.dropZone} ${dragging ? styles.dragOver : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        {/* Corner brackets */}
        <span className={`${styles.zc} ${styles.zcTL}`}/>
        <span className={`${styles.zc} ${styles.zcTR}`}/>
        <span className={`${styles.zc} ${styles.zcBL}`}/>
        <span className={`${styles.zc} ${styles.zcBR}`}/>

        {/* Pulsing ring + icon */}
        <div className={styles.iconRing}>
          <div className={styles.iconPulse} />
          <div className={styles.iconPulse2} />
          <div className={styles.iconWrap}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
        </div>

        <div className={styles.dropText}>
          <p className={styles.dropTitle}>Drop rack image here</p>
          <p className={styles.dropSub}>tap to browse · JPG, PNG, HEIC, MP4</p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*,video/*" style={{display:'none'}}
        onChange={(e) => handleFile(e.target.files[0])} />
    </>
  );
}

// ── Camera Capture ───────────────────────────────────────────
function CameraCapture({ onCapture }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [ready,    setReady]    = useState(false);
  const [captured, setCaptured] = useState(null);
  const [error,    setError]    = useState(null);
  const [flash,    setFlash]    = useState(false);
  const [scanning, setScanning] = useState(false);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); };
      }
    } catch { setError('Camera access denied. Allow camera permission or use Upload.'); }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; setReady(false);
  }, []);

  useEffect(() => { startCamera(); return () => stopCamera(); }, [startCamera, stopCamera]);

  const capture = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setFlash(true); setScanning(true);
    setTimeout(() => setFlash(false), 160);
    setTimeout(() => setScanning(false), 900);
    canvas.toBlob((blob) => {
      const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCaptured(URL.createObjectURL(blob));
      stopCamera(); onCapture(file);
    }, 'image/jpeg', 0.92);
  };

  if (error) return (
    <div className={styles.camError}>
      <div className={styles.camErrorIcon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34"/>
        </svg>
      </div>
      <p className={styles.camErrorText}>{error}</p>
    </div>
  );

  if (captured) return (
    <div className={styles.previewCard}>
      <img src={captured} alt="Captured" className={styles.previewImg} />
      <button className={styles.previewCloseBtn} onClick={() => { setCaptured(null); onCapture(null); startCamera(); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div className={styles.previewGrid} />
    </div>
  );

  return (
    <div className={styles.camWrap}>
      <div className={`${styles.flashLayer} ${flash ? styles.flashOn : ''}`} />
      {scanning && <div className={styles.scanBar} />}
      <video ref={videoRef} className={styles.camVideo} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{display:'none'}} />
      <div className={styles.hud}>
        <span className={`${styles.hc} ${styles.hcTL}`}/><span className={`${styles.hc} ${styles.hcTR}`}/>
        <span className={`${styles.hc} ${styles.hcBL}`}/><span className={`${styles.hc} ${styles.hcBR}`}/>
        <div className={styles.hudGrid} />
        <div className={styles.hudTop}>
          <span className={styles.hudBadge}>
            <span className="dot dot-cyan" style={{width:5,height:5}}/> RACK SCAN
          </span>
        </div>
        <div className={styles.hudBottom}>
          <p className={styles.hudHint}>Align full rack within frame</p>
          <button className={styles.shutterBtn} onClick={capture} disabled={!ready}>
            <span className={styles.shutterRing}/>
            <span className={`${styles.shutterCore} ${!ready ? styles.shutterDisabled : ''}`}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cinematic Loading Overlay ────────────────────────────────
function AnalyzingOverlay({ progress, step }) {
  const STEPS = ['Preprocessing image', 'Detecting rack boundaries', 'Identifying components', 'Mapping ports', 'Locating target'];
  const active = Math.min(Math.floor((progress / 100) * STEPS.length), STEPS.length - 1);

  return (
    <div className={styles.overlay}>
      <div className={styles.overlayInner}>
        <div className={styles.ovRadar}>
          <div className={styles.ovSweep}/>
          <div className={styles.ovCenter}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
        </div>
        <p className={styles.ovTitle}>Analyzing rack…</p>
        <p className={styles.ovStep}>{step}</p>
        <div className={styles.ovTrack}>
          <div className={styles.ovFill} style={{width:`${progress}%`}}/>
          <div className={styles.ovGlow} style={{left:`${progress}%`}}/>
        </div>
        <span className={styles.ovPct}>{progress}%</span>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function ScanPage() {
  const navigate = useNavigate();
  const [tab,      setTab]      = useState('upload');
  const [file,     setFile]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [step,     setStep]     = useState('');
  const [error,    setError]    = useState(null);

  const STEPS = ['Preprocessing image…','Detecting rack boundaries…','Identifying components…','Mapping ports and cables…','Locating incident target…'];

  const analyze = async () => {
    if (!file) return;
    setLoading(true); setError(null); setProgress(0); setStep(STEPS[0]);
    let si = 0;
    const ticker = setInterval(() => {
      setProgress(p => Math.min(p + 9, 88));
      si = Math.min(si + 1, STEPS.length - 1);
      setStep(STEPS[si]);
    }, 300);
    try {
      const body = new FormData();
      body.append('image', file);
      const res  = await fetch('/api/analyze', { method: 'POST', body });
      if (!res.ok) throw new Error('Analysis failed. Try again.');
      const data = await res.json();
      clearInterval(ticker);
      setProgress(100); setStep('Target located!');
      setTimeout(() => navigate('/results', { state: { result: data } }), 600);
    } catch (err) {
      clearInterval(ticker); setLoading(false); setProgress(0); setError(err.message);
    }
  };

  return (
    <div className={`page ${styles.scan}`}>
      <div className={styles.amb}/>

      {/* Header */}
      <header className={styles.header}>
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('/')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <span className={styles.headerTitle}>Scan your Rack</span>
        <div style={{width:40}}/>
      </header>

      <div className={`pc ${styles.scanContent}`}>
        <div className={styles.scanIntro}>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {[
            { id:'upload', label:'Upload', icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> },
            { id:'camera', label:'Camera', icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg> },
          ].map(t => (
            <button key={t.id} className={`${styles.tab} ${tab===t.id ? styles.tabOn : ''}`}
              onClick={() => { setTab(t.id); setFile(null); setError(null); }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Media box */}
        <div className={styles.mediaBox}>
          {tab === 'upload' ? <UploadZone onFile={setFile}/> : <CameraCapture onCapture={setFile}/>}
        </div>

        {error && (
          <div className={styles.errBox}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {/* CTA — no magnifying glass, no chips */}
        <button className={`btn btn-primary btn-lg btn-full ${styles.cta}`}
          disabled={!file} style={{opacity: file ? 1 : 0.4}} onClick={analyze}>
          Analyze Rack
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>

      {loading && <AnalyzingOverlay progress={progress} step={step}/>}
    </div>
  );
}
