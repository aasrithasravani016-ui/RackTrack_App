const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3001;

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH  = path.join(PROJECT_ROOT, 'config.json');
const uploadsDir   = path.join(__dirname, 'uploads');
const outputsDir   = path.join(PROJECT_ROOT, 'outputs');

[uploadsDir, outputsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

app.use(cors({ origin: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use('/outputs', express.static(outputsDir));

const clientDist = path.join(PROJECT_ROOT, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// ── File upload ───────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `tmp_${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|mp4|mov|webm/.test(
      path.extname(file.originalname).toLowerCase()
    );
    cb(ok ? null : new Error('Invalid file type'), ok);
  },
});

// ── Rack ID ───────────────────────────────────────────────────
// Derived from SHA-256 of file contents → stable for the same physical rack image
function computeRackId(filePath) {
  const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
  return `RK-${hash.slice(0, 8).toUpperCase()}`;
}

// ── Python runner ─────────────────────────────────────────────
function runPython(args) {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || 'python3';
    const proc = spawn(pythonPath, args, { cwd: PROJECT_ROOT });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        console.error('[pipeline stderr]', stderr);
        reject(new Error(stderr || `Pipeline exited with code ${code}`));
      } else {
        console.log('[pipeline]', stdout.slice(-400));
        resolve(stdout);
      }
    });
    proc.on('error', err => reject(new Error(`Failed to start Python: ${err.message}`)));
  });
}

// ── Helpers ───────────────────────────────────────────────────
function readMeta(rackId) {
  const p = path.join(outputsDir, rackId, 'scan_meta.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function writeMeta(rackId, meta) {
  const dir = path.join(outputsDir, rackId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scan_meta.json'), JSON.stringify(meta, null, 2));
}

async function ensurePortCounts(rackId) {
  const rackDir = path.join(outputsDir, rackId);
  const meta = readMeta(rackId);
  if (!meta?.imagePath) return;

  const jsonPath = path.join(rackDir, 'device_unit_map.json');
  if (!fs.existsSync(jsonPath)) return;

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(data.devices)) return;
  if (data.devices.every(dev => typeof dev.port_count === 'number')) return;

  await runPython([
    '-m', 'pipeline.runner',
    '--image',      meta.imagePath,
    '--config',     CONFIG_PATH,
    '--output_dir', rackDir,
    '--detect_only',
  ]);
}

function buildResponse(rackId, cached) {
  const jsonPath = path.join(outputsDir, rackId, 'device_unit_map.json');
  const data     = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const meta     = readMeta(rackId);
  const deviceOnlyFile = path.join(outputsDir, rackId, '2_devices_only.png');
  const imageFile = fs.existsSync(deviceOnlyFile)
    ? '2_devices_only.png'
    : '3_units_and_devices.png';
  const devices = (data.devices || []).map(dev => ({
    ...dev,
    port_count: typeof dev.port_count === 'number' ? dev.port_count : null,
    ports: dev.ports || [],
    console_ports: dev.console_ports || [],
    sfp_ports: dev.sfp_ports || [],
    connected_ports: dev.connected_ports || [],
  }));

  // Detect original image extension
  const rackDir = path.join(outputsDir, rackId);
  let originalExt = 'png';
  for (const ext of ['jpg', 'jpeg', 'png']) {
    if (fs.existsSync(path.join(rackDir, `original_image.${ext}`))) {
      originalExt = ext;
      break;
    }
  }

  return {
    rackId,
    scanId:          rackId,               // kept for backwards compat
    timestamp:       meta?.timestamp || new Date().toISOString(),
    cached,
    imageUrl:        `/outputs/${rackId}/${imageFile}`,
    originalExt,
    devices,
    units_detected:  data.units_detected || [],
  };
}

// ── Routes ────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', service: 'RackTrack API' });
});

/**
 * POST /api/analyze
 * 1. Hash the uploaded image → RK-XXXXXXXX
 * 2. If outputs/RK-XXXXXXXX/device_unit_map.json exists → return cached result
 * 3. Otherwise run pipeline --detect_only, save outputs, return fresh result
 */
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const tmpPath = req.file.path;

  try {
    const rackId    = computeRackId(tmpPath);
    const rackDir   = path.join(outputsDir, rackId);
    const jsonPath  = path.join(rackDir, 'device_unit_map.json');

    // ── Cache hit ──────────────────────────────────────────
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(tmpPath); // discard duplicate upload
      console.log(`[cache hit] ${rackId}`);
      await ensurePortCounts(rackId);
      return res.json(buildResponse(rackId, true));
    }

    // ── Cache miss — run pipeline ──────────────────────────
    fs.mkdirSync(rackDir, { recursive: true });

    // Persist image inside the rack folder so /api/select always finds it
    const ext          = path.extname(req.file.originalname) || '.jpg';
    const imagePath    = path.join(rackDir, `original_image${ext}`);
    fs.copyFileSync(tmpPath, imagePath);
    fs.unlinkSync(tmpPath); // remove from uploads/

    const meta = {
      rackId,
      imageHash:  crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex'),
      imagePath,
      timestamp:  new Date().toISOString(),
    };
    writeMeta(rackId, meta);

    await runPython([
      '-m', 'pipeline.runner',
      '--image',      imagePath,
      '--config',     CONFIG_PATH,
      '--output_dir', rackDir,
      '--detect_only',
    ]);

    console.log(`[new scan] ${rackId}`);
    res.json(buildResponse(rackId, false));

  } catch (err) {
    // Clean up tmp if still around
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    console.error(err.message);
    res.status(500).json({ error: 'Pipeline failed', details: err.message });
  }
});

/**
 * POST /api/select
 * Runs full pipeline with --device_index and --port on the cached rack image.
 * Reads imagePath from scan_meta.json — no in-memory state required.
 */
app.post('/api/select', async (req, res) => {
  const { scanId, device_index, port } = req.body;
  const rackId = scanId;

  if (!rackId || device_index == null || port == null) {
    return res.status(400).json({ error: 'scanId, device_index, and port are required' });
  }

  const meta = readMeta(rackId);
  if (!meta) {
    return res.status(404).json({ error: `Rack ${rackId} not found. Please re-upload the image.` });
  }

  if (!fs.existsSync(meta.imagePath)) {
    return res.status(404).json({ error: 'Original image missing from rack folder. Please re-upload.' });
  }

  const rackDir = path.join(outputsDir, rackId);

  try {
    await runPython([
      '-m', 'pipeline.runner',
      '--image',        meta.imagePath,
      '--config',       CONFIG_PATH,
      '--output_dir',   rackDir,
      '--device_index', String(device_index),
      '--port',         String(port),
    ]);

    const infoPath = path.join(rackDir, 'selected_port_info.json');
    const fullData = fs.existsSync(infoPath)
      ? JSON.parse(fs.readFileSync(infoPath, 'utf8'))
      : {};
    const portInfo = fullData.port_info || {};

    res.json({
      resultImageUrl: `/outputs/${rackId}/5_selected_device_with_port.png`,
      rackImageUrl: `/outputs/${rackId}/6_full_rack_selected_port.png`,
      portInfo,
      portClassification: fullData.port_classification || null,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Pipeline failed', details: err.message });
  }
});

/**
 * GET /api/racks
 * List all stored rack IDs with their metadata (useful for debugging / future history).
 */
app.get('/api/racks', (req, res) => {
  try {
    const racks = fs.readdirSync(outputsDir)
      .filter(name => name.startsWith('RK-'))
      .map(name => {
        const meta = readMeta(name);
        return meta ? { rackId: name, timestamp: meta.timestamp } : { rackId: name };
      })
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    res.json({ racks });
  } catch (err) {
    res.json({ racks: [] });
  }
});

app.get(/^\/(?!api|uploads|outputs).*/, (req, res, next) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  next();
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`RackTrack API  http://localhost:${PORT}`);
  console.log(`Outputs dir    ${outputsDir}`);
});
