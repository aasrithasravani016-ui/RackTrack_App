import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import styles from './ResultsPage.module.css';

// ── Naming convention ─────────────────────────────────────────
const CLASS_CODE = {
  'Switch': 'SW', 'Patch Panel': 'PP', 'Firewall': 'FW', 'Router': 'RO',
  'Server': 'SVR', 'Load Balancer': 'LB', 'Modem': 'MO',
  'Controller': 'CTRL', 'Recorder': 'REC', 'Amplifier': 'AMP', 'Gateway': 'GT',
  'PDU': 'PDU', 'PSU': 'PSU', 'UPS': 'UPS', 'Empty': 'EMP', 'Closed Unit': 'CL',
};
const TYPE_COLOR = {
  'Switch': '#22d3ee', 'Patch Panel': '#60a5fa', 'Server': '#a78bfa',
  'Gateway': '#fb923c', 'Firewall': '#f87171', 'PDU': '#fbbf24',
  'PSU': '#f472b6', 'UPS': '#34d399', 'Router': '#818cf8',
  'Load Balancer': '#c084fc', 'Modem': '#94a3b8',
  'Controller': '#67e8f9', 'Recorder': '#86efac', 'Amplifier': '#fda4af',
  'Closed Unit': '#f43f5e', 'Empty': 'rgba(6,182,212,0.3)',
};
const DEFAULT_COLOR = '#22d3ee';

function getColor(name) { return TYPE_COLOR[name] || DEFAULT_COLOR; }

function parseUnitNumber(label) {
  const match = String(label || '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function formatUnitsRange(units = []) {
  const numbers = [...new Set((units || [])
    .map(parseUnitNumber)
    .filter((n) => n !== null))].sort((a, b) => a - b);
  if (!numbers.length) return '';

  const ranges = [];
  let start = numbers[0];
  let prev = numbers[0];

  for (let i = 1; i < numbers.length; i += 1) {
    const current = numbers[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push([start, prev]);
    start = current;
    prev = current;
  }
  ranges.push([start, prev]);

  return ranges.map(([s, e]) =>
    s === e
      ? `U${String(s).padStart(2, '0')}`
      : `U${String(s).padStart(2, '0')}-U${String(e).padStart(2, '0')}`
  ).join(' ');
}

function buildDeviceLabels(devices, unitsDetected = []) {
  const counts = {};
  return devices.map(dev => {
    const code = CLASS_CODE[dev.class_name] || dev.class_name.replace(/\s+/g, '').slice(0, 4).toUpperCase();
    counts[code] = (counts[code] || 0) + 1;
    const seq  = String(counts[code]).padStart(2, '0');
    const labelUnits = dev.units?.length ? dev.units : unitsDetected.length ? [unitsDetected[0]] : [];
    const formatted = formatUnitsRange(labelUnits) || 'U01';
    const primaryLabel = formatted.split(' ')[0];
    return `${primaryLabel}-${code}${seq}`;
  });
}

function buildPortLabel(deviceLabel, className, portNum) {
  const p = String(portNum).padStart(2, '0');
  switch (className) {
    case 'Switch':      return `${deviceLabel}-IF-Gi1/0/${portNum}`;
    case 'Patch Panel': return `${deviceLabel}-FP-${p}`;
    case 'PDU':         return `${deviceLabel}-OUT-${p}`;
    case 'Server': case 'PSU': case 'UPS': return `${deviceLabel}-PWR-${p}`;
    case 'Gateway': case 'Router': case 'Firewall': return `${deviceLabel}-IF-${p}`;
    default:            return `${deviceLabel}-P${p}`;
  }
}

const CABLE_COLOR_MAP = {
  black: '#1a1a2e', blue: '#3b82f6', brown: '#92400e', green: '#22c55e',
  grey: '#9ca3af', gray: '#9ca3af', orange: '#f97316', pink: '#ec4899',
  red: '#ef4444', white: '#e8e8e8', yellow: '#eab308', violet: '#8b5cf6',
  aqua: '#06b6d4',
};
function cableColorCSS(name) {
  if (!name) return '#60a5fa';
  return CABLE_COLOR_MAP[name.toLowerCase()] || '#60a5fa';
}

function parseCableType(label) {
  if (!label) return { raw: '', display: '', colorName: '' };
  const raw = String(label).trim();
  const normalized = raw.replace(/_/g, ' ').replace(/RJ[ _]?45/i, 'RJ-45');
  const parts = normalized.split(/\s+/);
  const colors = ['aqua','black','blue','brown','green','grey','gray','orange','pink','red','white','yellow','violet'];
  const found = parts.find(part => colors.includes(part.toLowerCase()));
  const colorName = found ? found[0].toUpperCase() + found.slice(1).toLowerCase() : '';
  const displayParts = found ? parts.filter(part => part.toLowerCase() !== found.toLowerCase()) : parts;
  const display = displayParts.join(' ');
  return { raw, display, colorName };
}

// ── Device picker dropdown ────────────────────────────────────
const HIDDEN_DEVICE_TYPES = new Set(['Empty', 'Closed Unit']);

function DevicePicker({ devices, labels, selectedIdx, onSelect }) {
  const [open, setOpen] = useState(false);
  const sel   = selectedIdx ? devices[selectedIdx - 1] : null;
  const selLbl = selectedIdx ? labels[selectedIdx - 1] : null;
  const selColor = sel ? getColor(sel.class_name) : DEFAULT_COLOR;

  return (
    <div className={styles.picker}>
      <button
        className={`${styles.pickerTrigger} ${open ? styles.pickerOpen : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <div className={styles.pickerTriggerLeft}>
          {sel ? (
            <>
              <span className={styles.pickerSelCode} style={{ color: selColor, textShadow: `0 0 14px ${selColor}60` }}>
                {selLbl}
              </span>
              <span className={styles.pickerSelType}>{sel.class_name}</span>
              {(sel.port_count > 0 || sel.console_ports?.length > 0 || sel.sfp_ports?.length > 0) && (
                <span className={styles.pickerSelPorts}>
                  {sel.port_count > 0 && <span style={{ color: '#34d399' }}>{sel.port_count}p</span>}
                  {sel.console_ports?.length > 0 && <span style={{ color: '#22d3ee' }}>{sel.console_ports.length}c</span>}
                  {sel.sfp_ports?.length > 0 && <span style={{ color: '#fbbf24' }}>{sel.sfp_ports.length}s</span>}
                </span>
              )}
            </>
          ) : (
            <span className={styles.pickerPrompt}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Select device…
            </span>
          )}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`${styles.pickerArrow} ${open ? styles.pickerArrowOpen : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <>
          <div className={styles.sheetBackdrop} onClick={() => setOpen(false)} />
          <div className={styles.bottomSheet}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetHeader}>
              <h3 className={styles.sheetTitle}>Select Device</h3>
              <span className={styles.sheetCount}>{devices.filter(d => !HIDDEN_DEVICE_TYPES.has(d.class_name) && d.port_count > 0).length} devices</span>
            </div>
            <div className={styles.sheetScroll}>
              {devices.map((dev, i) => {
                if (HIDDEN_DEVICE_TYPES.has(dev.class_name) || !dev.port_count) return null;
                const c   = getColor(dev.class_name);
                const lbl = labels[i];
                const active = selectedIdx === i + 1;
                return (
                  <button key={i}
                    className={`${styles.sheetOption} ${active ? styles.sheetOptionActive : ''}`}
                    onClick={() => { onSelect(i + 1); setOpen(false); }}
                  >
                    <span className={styles.sheetOptBar} style={{ background: c }} />
                    <div className={styles.sheetOptInfo}>
                      <span className={styles.sheetOptCode} style={{ color: active ? c : undefined }}>{lbl}</span>
                      <span className={styles.sheetOptType}>{dev.class_name}</span>
                    </div>
                    <span className={styles.pickerOptPortsWrap}>
                      {dev.port_count > 0 && <span className={styles.pickerOptPorts}>{dev.port_count}p</span>}
                      {dev.console_ports?.length > 0 && <span className={styles.pickerOptPortsC}>{dev.console_ports.length}c</span>}
                      {dev.sfp_ports?.length > 0 && <span className={styles.pickerOptPortsS}>{dev.sfp_ports.length}s</span>}
                    </span>
                    {active && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── All components ───────────────────────────────────────────
function AllDevicesView({ devices, labels, rackId, scanId, originalExt, onBack }) {
  const visible = devices
    .map((dev, i) => ({ dev, label: labels[i], idx: i }))
    .filter(({ dev }) => !HIDDEN_DEVICE_TYPES.has(dev.class_name));

  const [selectedCard, setSelectedCard] = useState(null);
  const [imgNat, setImgNat] = useState(null);
  const heroSrc = `/outputs/${scanId}/original_image.${originalExt || 'png'}`;

  return (
    <div className={`page page-full ${styles.allPage}`}>
      <div className={styles.amb} />
      <header className={styles.header} style={{ position: 'sticky', top: 0 }}>
        <button className="btn btn-ghost btn-icon" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className={styles.headerCenter}>
          <h2 className={styles.headerTitle}>All Components</h2>
          <span className={styles.headerMono}>{rackId ? `${rackId} · ` : ''}{visible.length} devices</span>
        </div>
        <div style={{ width: 40 }} />
      </header>

      <div className={styles.allWrap}>
        {/* Show rack image with selected device highlighted */}
        {selectedCard !== null && (
          <div className={styles.resultHero}>
            <img src={heroSrc} alt="Rack" className={styles.heroImg}
              onLoad={e => setImgNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />
            {imgNat && (() => {
              const dev = devices[selectedCard];
              if (!dev?.box) return null;
              const [bx1, by1, bx2, by2] = dev.box;
              const w = bx2 - bx1, h = by2 - by1;
              return (
                <svg className={styles.devOverlay} viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <filter id="neonAll">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <rect x={bx1} y={by1} width={w} height={h} rx="6"
                    fill="none" stroke={getColor(dev.class_name)} strokeWidth="3" filter="url(#neonAll)"
                    className={styles.devNeonBorder} />
                </svg>
              );
            })()}
          </div>
        )}

        {visible.length === 0 ? (
          <div className={styles.empty}>
            <p>No components detected.</p>
            <button className="btn btn-primary" onClick={onBack}>Back to scan results</button>
          </div>
        ) : (
          <div className={styles.allCards}>
            {visible.map(({ dev, label, idx }, i) => {
              const c = getColor(dev.class_name);
              const units = formatUnitsRange(dev.units)?.toUpperCase() || '—';
              const active = selectedCard === idx;
              return (
                <div key={i} className={styles.allCard}
                  style={active ? { borderColor: c, background: `${c}11` } : undefined}
                  onClick={() => setSelectedCard(active ? null : idx)}>
                  <div className={styles.allCardBar} style={{ background: c }} />
                  <div className={styles.allCardBody}>
                    <div className={styles.allCardTop}>
                      <span className={styles.allCardLabel} style={{ color: c }}>{label}</span>
                      <span className={styles.allCardType}>{dev.class_name}</span>
                    </div>
                    <div className={styles.allCardBottom}>
                      <span className={styles.allCardUnit}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/>
                        </svg>
                        {units}
                      </span>
                      <span className={styles.allCardPorts}>
                        {dev.port_count > 0 && <span className={styles.portPill}>{dev.port_count}p</span>}
                        {dev.console_ports?.length > 0 && <span className={styles.portPillC}>{dev.console_ports.length}c</span>}
                        {dev.sfp_ports?.length > 0 && <span className={styles.portPillS}>{dev.sfp_ports.length}s</span>}
                        {!dev.port_count && !dev.console_ports?.length && !dev.sfp_ports?.length && (
                          <span className={styles.noPorts}>—</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function ResultsPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const result = state?.result;

  const [selectedIdx, setSelectedIdx] = useState(null);
  const [portNum,     setPortNum]     = useState('');
  const [phase,       setPhase]       = useState('detect');
  const [resultImg,   setResultImg]   = useState(null);
  const [portInfo,    setPortInfo]    = useState(null);
  const [zoom,        setZoom]        = useState(1);
  const [offset,      setOffset]      = useState({ x: 0, y: 0 });
  const [imgNat,      setImgNat]      = useState(null);
  const [dragStart,   setDragStart]   = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [portClass, setPortClass] = useState(null); // eslint-disable-line no-unused-vars
  const [error,       setError]       = useState(null);
  const [nextPort,  setNextPort]  = useState('');
  const [rackImg,   setRackImg]   = useState(null);
  const [portView,  setPortView]  = useState('rack'); // 'rack' → 'device' → 'zoom' → 'rack'

  const { scanId, rackId, cached, devices = [], units_detected = [], originalExt } = result || {};
  const heroImgSrc = resultImg || `/outputs/${scanId}/original_image.${originalExt || 'png'}`;
  const labels = useMemo(() => buildDeviceLabels(devices, units_detected), [devices, units_detected]);

  const clampZoom = (value) => Math.min(2.5, Math.max(0.8, value));
  const zoomIn = () => setZoom((prev) => clampZoom(prev + 0.15));
  const zoomOut = () => setZoom((prev) => clampZoom(prev - 0.15));
  const resetZoom = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };
  const handleWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.15 : -0.15;
    setZoom((prev) => clampZoom(prev + delta));
  };
  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    setDragStart({ x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event) => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    setDragStart({ x: event.clientX, y: event.clientY });
  };
  const handlePointerUp = (event) => {
    if (!dragStart) return;
    setDragStart(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handlePointerCancel = (event) => {
    if (!dragStart) return;
    setDragStart(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handlePointerLeave = () => {
    if (!dragStart) return;
    setDragStart(null);
  };
  const cursorStyle = zoom > 1 ? (dragStart ? 'grabbing' : 'grab') : 'zoom-in';
  const imageTransform = `translate(${offset.x / zoom}px, ${offset.y / zoom}px) scale(${zoom})`;

  useEffect(() => {
    if (!result) return;
    const existing = JSON.parse(localStorage.getItem('rackTrackHistory') || '[]');
    const history  = Array.isArray(existing) ? existing : [];
    if (!history.some(h => h.scanId === result.scanId)) {
      history.unshift({
        scanId: result.scanId, timestamp: result.timestamp, severity: 'info',
        incidentLabel: labels[0] || 'Rack scan',
        componentLabel: `${devices.length} devices`,
        scanSummary: `${formatUnitsRange(units_detected) || `${units_detected.length} units`} scanned`,
        imageUrl: result.imageUrl, fullResult: result,
      });
      localStorage.setItem('rackTrackHistory', JSON.stringify(history.slice(0, 12)));
    }
  }, [result]);

  if (!result) {
    return (
      <div className={`page page-full ${styles.results}`}>
        <div className={styles.empty}>
          <p>No scan result.</p>
          <button className="btn btn-primary" onClick={() => navigate('/scan')}>Start a Scan</button>
        </div>
      </div>
    );
  }

  if (phase === 'all') {
    return <AllDevicesView devices={devices} labels={labels} rackId={rackId} scanId={scanId} originalExt={originalExt} onBack={() => setPhase('detect')} />;
  }

  const selectedDevice = selectedIdx ? devices[selectedIdx - 1] : null;
  const selectedLabel  = selectedIdx ? labels[selectedIdx - 1]  : null;
  const selColor       = selectedDevice ? getColor(selectedDevice.class_name) : DEFAULT_COLOR;
  const cableInfo      = parseCableType(portInfo?.cable_type);

  const findPort = async () => {
    if (!selectedDevice || !portNum) return;
    const p = parseInt(portNum, 10);
    if (isNaN(p) || p < 1 || (selectedDevice.port_count > 0 && p > selectedDevice.port_count)) {
      setError(selectedDevice.port_count > 0
        ? `Port must be between 1 and ${selectedDevice.port_count}`
        : 'Invalid port number');
      return;
    }
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, device_index: selectedIdx, port: parseInt(portNum, 10) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Port detection failed');
      setResultImg(data.resultImageUrl);
      setRackImg(data.rackImageUrl || null);
      setPortView('rack');
      setPortInfo(data.portInfo || null);
      setPortClass(data.portClassification || null);
      setPhase('port');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const portLabel = selectedLabel && portNum
    ? buildPortLabel(selectedLabel, selectedDevice?.class_name, portNum)
    : null;

  // step state: 0=idle, 1=device selected, 2=port filled
  const step = !selectedDevice ? 0 : !portNum ? 1 : 2;

  // ── Port result ──────────────────────────────────────────
  // ── Find another port on the same device ──
  const findAnotherPort = async () => {
    if (!selectedDevice || !nextPort) return;
    const p = parseInt(nextPort, 10);
    if (isNaN(p) || p < 1 || (selectedDevice.port_count > 0 && p > selectedDevice.port_count)) {
      setError(selectedDevice.port_count > 0
        ? `Port must be between 1 and ${selectedDevice.port_count}`
        : 'Invalid port number');
      return;
    }
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, device_index: selectedIdx, port: parseInt(nextPort, 10) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Port detection failed');
      setResultImg(data.resultImageUrl + '?t=' + Date.now());
      setRackImg((data.rackImageUrl || '') + '?t=' + Date.now());
      setPortView('rack');
      setPortInfo(data.portInfo || null);
      setPortClass(data.portClassification || null);
      setPortNum(nextPort);
      setNextPort('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (phase === 'port') {
    const rc = selectedDevice ? getColor(selectedDevice.class_name) : DEFAULT_COLOR;
    const resultLabel = buildPortLabel(selectedLabel, selectedDevice?.class_name, portNum);
    const isConn = portInfo?.status === 'connected';
    const connectorVal = portInfo?.cable_connector || cableInfo?.display;
    const colorVal = portInfo?.cable_color || cableInfo?.colorName;
    return (
      <div className={`page page-full ${styles.results}`}>
        <div className={styles.portAmb} style={{ '--ac': rc }} />

        <header className={styles.header}>
          <div style={{ width: 40 }} />
          <div className={styles.headerCenter}>
            <h2 className={styles.headerTitle}>Port Located</h2>
            <div className={styles.headerMetaRow}>
              {rackId && <span className={styles.headerMono}>{rackId}</span>}
              <span className={styles.cacheBadge} style={{ color: '#34d399' }}>● Identified</span>
            </div>
          </div>
          <div style={{ width: 40 }} />
        </header>

        {/* Full-screen port result layout */}
        <div className={styles.portBody}>

          {/* Port image — tap to cycle: rack → device → zoomed port → rack */}
          {(() => {
            const cycleView = () => {
              if (portView === 'rack') setPortView('device');
              else if (portView === 'device') setPortView('zoom');
              else setPortView('rack');
            };
            const isRack = portView === 'rack' && rackImg;
            const isZoom = portView === 'zoom';
            const imgSrc = isRack ? rackImg : resultImg;
            const wrapClass = isRack ? styles.portImgRack : isZoom ? styles.portImgZoom : styles.portImgDev;
            const hint = isRack ? 'Tap for device view' : isZoom ? 'Tap for rack view' : 'Tap to zoom port';

            let zoomStyle = {};
            if (isZoom && portInfo?.location && selectedDevice?.box) {
              const [px1, py1, px2, py2] = portInfo.location;
              const [dx1, dy1, dx2, dy2] = selectedDevice.box;
              const devW = dx2 - dx1;
              const devH = dy2 - dy1;
              const portW = px2 - px1;
              const portH = py2 - py1;
              const pctX = Math.max(10, Math.min(90, (((px1 + px2) / 2 - dx1) / devW) * 100));
              const rawY = (((py1 + py2) / 2 - dy1) / devH) * 100;
              const pctY = Math.max(25, Math.min(75, rawY));
              const scale = Math.min(devW / (portW * 2.2), devH / (portH * 2.2), 6);
              zoomStyle = { transform: `scale(${scale}) translateY(8%)`, transformOrigin: `${pctX}% ${pctY}%` };
            }

            return (
              <div className={`${styles.portImgWrap} ${wrapClass}`} onClick={cycleView}>
                <img src={imgSrc} alt="Port located"
                  className={styles.portImg}
                  style={zoomStyle}
                  draggable="false" />
                <span className={styles.portImgHint}>{hint}</span>
              </div>
            );
          })()}

          {/* Port label */}
          <div className={styles.pLabelText}>{resultLabel}</div>

          {/* Details — creative chip/card layout */}
          <div className={styles.pDetails}>
            {/* Top row: device + position + port as stat cards */}
            <div className={styles.pStatRow}>
              <div className={styles.pStat}>
                <span className={styles.pStatVal} style={{ color: rc }}>{selectedDevice?.class_name}</span>
                <span className={styles.pStatKey}>Device</span>
              </div>
              <div className={styles.pStatDivider} />
              <div className={styles.pStat}>
                <span className={styles.pStatVal}>{formatUnitsRange(selectedDevice?.units).toUpperCase() || '—'}</span>
                <span className={styles.pStatKey}>Position</span>
              </div>
            </div>
            <div className={styles.pStatRow}>
              <div className={styles.pStat}>
                <span className={styles.pStatVal}>Ethernet Port : {portNum}</span>
              </div>
            </div>

            {/* Connection card */}
            <div className={`${styles.pConnCard} ${isConn ? styles.pConnOn : styles.pConnOff}`}
              style={isConn && colorVal ? { '--cable-c': cableColorCSS(colorVal) } : {}}>
              {/* Status bar at top */}
              <div className={styles.pConnStatus}>
                <span className={styles.pConnDot} />
                <span className={styles.pConnLabel}>
                  {isConn ? 'Connected' : portInfo?.status === 'empty' ? 'Empty' : portInfo?.status || '—'}
                </span>
              </div>

              {isConn && (connectorVal || colorVal) && (
                <div className={styles.pConnDetails}>
                  {connectorVal && (
                    <div className={styles.pConnItem}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 3v7a6 6 0 0012 0V3"/><line x1="4" y1="3" x2="20" y2="3"/>
                      </svg>
                      <div className={styles.pConnItemText}>
                        <span className={styles.pConnItemVal}>{connectorVal}</span>
                        <span className={styles.pConnItemKey}>Connector</span>
                      </div>
                    </div>
                  )}
                  {colorVal && (
                    <div className={styles.pConnItem}>
                      <span className={styles.pConnColorDot} style={{ background: cableColorCSS(colorVal), boxShadow: `0 0 12px ${cableColorCSS(colorVal)}` }} />
                      <div className={styles.pConnItemText}>
                        <span className={styles.pConnItemVal}>{colorVal}</span>
                        <span className={styles.pConnItemKey}>Cable Color</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {false && (
                <div className={styles.pConnDetails}></div>
              )}
            </div>
          </div>

          {/* Find another port */}
          <div className={styles.pNextRow}>
            <input className={`input ${styles.pNextInput}`} type="number" min="1"
              style={{ '--focus-color': rc }}
              placeholder={selectedDevice?.port_count > 0 ? `Port 1–${selectedDevice.port_count}` : 'Port #'}
              value={nextPort}
              onChange={e => { setNextPort(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && nextPort && findAnotherPort()} />
            <button className={`btn btn-primary ${styles.pNextBtn}`}
              style={nextPort ? { '--btn-glow': rc } : {}}
              disabled={!nextPort || loading} onClick={findAnotherPort}>
              {loading ? <span className={styles.btnSpinner} /> : 'Find →'}
            </button>
          </div>

          {error && (
            <div className={styles.errBox}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          {/* Actions */}
          <div className={styles.pActions}>
            <button className={styles.pActionBtn} onClick={() => { setPhase('detect'); setPortNum(''); setNextPort(''); setPortInfo(null); setPortClass(null); setResultImg(null); setRackImg(null); setPortView('rack'); setError(null); resetZoom(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="4" rx="1"/><rect x="2" y="10" width="20" height="4" rx="1"/><rect x="2" y="17" width="20" height="4" rx="1"/></svg>
              Change Device
            </button>
            <button className={styles.pActionBtn} onClick={() => navigate('/scan')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
              New Scan
            </button>
          </div>
        </div>

        {loading && (
          <div className={styles.loadOverlay}>
            <div className={styles.loadRing} style={{ '--c': rc }}><div className={styles.loadRingInner} /></div>
            <p className={styles.loadTitle}>Identifying</p>
            <p className={styles.loadSub}>{buildPortLabel(selectedLabel, selectedDevice?.class_name, nextPort || portNum)}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Detect view ──────────────────────────────────────────
  return (
    <div className={`page page-full ${styles.results}`}>
      <div className={styles.amb} />

      <header className={styles.header}>
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('/scan')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className={styles.headerCenter}>
          <h2 className={styles.headerTitle}>Scan Results</h2>
          <div className={styles.headerMetaRow}>
            <span className={styles.headerMono}>
              {rackId || scanId}
            </span>
            <span className={`${styles.cacheBadge} ${cached ? styles.cacheBadgeCached : styles.cacheBadgeLive}`}>
              {cached ? '● CACHED' : '● LIVE'}
            </span>
          </div>
        </div>
        <div style={{ width: 40 }} />
      </header>

      {/* ── Hero image ── */}
      <div className={styles.heroWrap}>
        <div className={styles.zoomViewport}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
        >
          <div className={styles.heroImgWrap} style={{ transform: imageTransform, cursor: cursorStyle }}>
            <img src={heroImgSrc} alt="Rack scan" className={styles.heroImg}
              onLoad={e => setImgNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              draggable="false"
            />
            {selectedDevice && imgNat && (
              <svg className={styles.devOverlay} viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMidYMid meet">
                <defs>
                  <filter id="neon">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                {(() => {
                  const [bx1, by1, bx2, by2] = selectedDevice.box;
                  const w = bx2 - bx1, h = by2 - by1;
                  const c = 40;
                  return (
                    <g>
                      {/* Bright red neon border */}
                      <rect x={bx1} y={by1} width={w} height={h} rx="6"
                        fill="none" stroke="#ef4444" strokeWidth="3" filter="url(#neon)"
                        className={styles.devNeonBorder} />
                      {/* Red corner brackets */}
                      <g filter="url(#neon)" className={styles.devNeonCorners}>
                        <path d={`M${bx1},${by1+c} L${bx1},${by1} L${bx1+c},${by1}`} fill="none" stroke="#ff6b6b" strokeWidth="5" strokeLinecap="round" />
                        <path d={`M${bx2-c},${by1} L${bx2},${by1} L${bx2},${by1+c}`} fill="none" stroke="#ff6b6b" strokeWidth="5" strokeLinecap="round" />
                        <path d={`M${bx1},${by2-c} L${bx1},${by2} L${bx1+c},${by2}`} fill="none" stroke="#ff6b6b" strokeWidth="5" strokeLinecap="round" />
                        <path d={`M${bx2-c},${by2} L${bx2},${by2} L${bx2},${by2-c}`} fill="none" stroke="#ff6b6b" strokeWidth="5" strokeLinecap="round" />
                      </g>
                    </g>
                  );
                })()}
              </svg>
            )}
          </div>
        </div>
        <div className={styles.zoomControls}>
          <button type="button" className={styles.zoomButton} onClick={zoomOut} aria-label="Zoom out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <button type="button" className={styles.zoomButton} onClick={zoomIn} aria-label="Zoom in">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
        </div>
        {/* scan line animation */}
        <div className={styles.scanLine} />
        {/* corner HUD */}
        <span className={`${styles.hc} ${styles.hcTL}`} />
        <span className={`${styles.hc} ${styles.hcTR}`} />
        <span className={`${styles.hc} ${styles.hcBL}`} />
        <span className={`${styles.hc} ${styles.hcBR}`} />
        {/* bottom fade */}
        <div className={styles.heroFade} />
        {/* info badge */}
        <div className={styles.heroBadge}>
          <span className={styles.heroBadgeDot} />
          <span className={styles.heroBadgeTxt}>ANALYZED</span>
        </div>
      </div>

      {/* ── Action sheet ── */}
      <div className={styles.sheet}>

        {/* Step progress */}
        <div className={styles.stepBar}>
          {['Select device', 'Select port', 'Find port'].map((label, i) => (
            <div key={i} className={`${styles.stepItem} ${step === i ? styles.stepItemActive : step > i ? styles.stepItemDone : ''}`}>
              <div className={`${styles.stepDot} ${step > i ? styles.stepDotDone : step === i ? styles.stepDotActive : ''}`}>
                {step > i
                  ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <span>{i + 1}</span>
                }
              </div>
              <span className={styles.stepLabel}>{label}</span>
            </div>
          ))}
        </div>

        {/* Device picker */}
        <DevicePicker
          devices={devices}
          labels={labels}
          selectedIdx={selectedIdx}
          onSelect={idx => { setSelectedIdx(prev => prev === idx ? null : idx); setPortNum(''); setPortInfo(null); setError(null); }}
        />

        {selectedDevice && (
          <div className={styles.portCard} style={{ '--accent': selColor }}>
            <div className={styles.portCardTop}>
              <div>
                <p className={styles.portCardTitle}>Port number</p>
                <p className={styles.portCardSub}>
                  {selectedDevice.port_count > 0
                    ? `${selectedDevice.port_count} Ethernet ports`
                    : 'Enter port number to locate'}
                </p>
              </div>
            </div>
            <div className={styles.portInputRow}>
              <input
                className={`input ${styles.portInput}`}
                type="number" min="1"
                style={{ '--focus-color': selColor }}
                placeholder={selectedDevice.port_count > 0 ? `1 – ${selectedDevice.port_count}` : '#'}
                value={portNum}
                onChange={e => { setPortNum(e.target.value); setPortInfo(null); setError(null); }}
                onKeyDown={e => e.key === 'Enter' && portNum && findPort()}
                autoFocus
              />
              <button
                className={`btn btn-primary ${styles.findBtn}`}
                style={portNum ? { '--btn-glow': selColor } : {}}
                disabled={!portNum || loading}
                onClick={findPort}
              >
                {loading ? <span className={styles.btnSpinner} /> : 'Find Port →'}
              </button>
            </div>
            {portLabel && (
              <div className={styles.labelPreview}>
                <span className={styles.labelPreviewKey}>label</span>
                <span className={styles.labelPreviewVal} style={{ color: selColor }}>{portLabel}</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className={styles.errBox}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {/* View all */}
        <button className={styles.viewAllBtn} onClick={() => setPhase('all')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          View all devices
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className={styles.loadOverlay}>
          <div className={styles.loadRing} style={{ '--c': selColor }}>
            <div className={styles.loadRingInner} />
          </div>
          <p className={styles.loadTitle}>Identifying</p>
          <p className={styles.loadSub}>{buildPortLabel(selectedLabel, selectedDevice?.class_name, portNum)}</p>
        </div>
      )}
    </div>
  );
}
