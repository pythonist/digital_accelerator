import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const entry = path.join(srcRoot, 'main.jsx');

const aliases = {
  '@context': path.join(srcRoot, 'context'),
  '@services': path.join(srcRoot, 'services'),
  '@screens': path.join(srcRoot, 'screens'),
  '@tools': path.join(srcRoot, 'tools'),
  '@components': path.join(srcRoot, 'components'),
  '@investigation': path.join(srcRoot, 'tools', 'investigation'),
  '@investigation-layout': path.join(srcRoot, 'tools', 'investigation', 'layout'),
  '@calibration': path.join(srcRoot, 'tools', 'calibration'),
  '@mule': path.join(srcRoot, 'tools', 'mule_detection'),
  '@assets': path.join(srcRoot, 'assets'),
  '@btsy': path.join(srcRoot, 'tools', 'btsy'),
};

const exts = ['.js', '.jsx', '.ts', '.tsx'];

function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        stack.push(p);
      } else {
        out.push(p);
      }
    }
  }
  return out;
}

function isCodeFile(p) {
  return exts.includes(path.extname(p));
}

function tryResolveFile(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) return basePath;
  for (const ext of exts) {
    const p = basePath + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
    for (const ext of exts) {
      const idx = path.join(basePath, 'index' + ext);
      if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
    }
  }
  return null;
}

function resolveImport(fromFile, spec) {
  if (!spec || typeof spec !== 'string') return null;
  if (spec.startsWith('http://') || spec.startsWith('https://')) return null;
  if (
    spec.startsWith('react') ||
    spec.startsWith('@mui') ||
    spec.startsWith('lodash') ||
    spec.startsWith('axios') ||
    spec.startsWith('recharts') ||
    spec.startsWith('lucide-react') ||
    spec.startsWith('framer-motion')
  ) return null;

  if (spec.startsWith('.')) {
    const base = path.resolve(path.dirname(fromFile), spec);
    return tryResolveFile(base);
  }

  if (spec.startsWith('@/')) {
    const base = path.join(srcRoot, spec.slice(2));
    return tryResolveFile(base);
  }

  for (const [alias, target] of Object.entries(aliases)) {
    if (spec === alias) return tryResolveFile(target);
    if (spec.startsWith(alias + '/')) {
      const base = path.join(target, spec.slice(alias.length + 1));
      return tryResolveFile(base);
    }
  }

  if (spec.startsWith('/src/')) {
    const base = path.join(projectRoot, spec.replace(/^\//, ''));
    return tryResolveFile(base);
  }

  return null;
}

function extractImports(code) {
  const specs = new Set();
  const patterns = [
    /import\s+[^'"\n]+?from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+[^'"\n]+?from\s+['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code))) {
      specs.add(m[1]);
    }
  }
  return Array.from(specs);
}

const all = listFiles(srcRoot).filter(isCodeFile);
const allSet = new Set(all.map((p) => path.normalize(p)));

const visited = new Set();
const q = [entry];
while (q.length) {
  const f = path.normalize(q.pop());
  if (!allSet.has(f)) continue;
  if (visited.has(f)) continue;
  visited.add(f);
  let code;
  try {
    code = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const spec of extractImports(code)) {
    const resolved = resolveImport(f, spec);
    if (resolved) q.push(resolved);
  }
}

const unused = all
  .filter((f) => !visited.has(path.normalize(f)))
  .map((f) => path.relative(srcRoot, f))
  .sort();

process.stdout.write(
  JSON.stringify(
    {
      entry: path.relative(projectRoot, entry),
      total_src_code_files: all.length,
      reachable_from_entry: visited.size,
      unused_candidates: unused.length,
      unused,
    },
    null,
    2,
  ),
);

