// Що це: будує Graphviz dot для карти модулів (docs/graphs/modules.svg) з JSON dependency-cruiser.
// Чому не вбудований reporter archi: він малює КОЖНУ стрілку, а стрілки у config/logging/errors є з усіх
// модулів і перетворюють картину на клубок. Тут ці три модулі стоять окремо у пунктирній рамці без стрілок,
// файли згорнуті до каталогів модулів, а вузли розкладені рядами згори вниз: запуск, корінь, теми, інфраструктура.
// Хто викликає: npm run graph (stdin = depcruise --output-type json, stdout = dot).
import { readFileSync } from 'node:fs';

// Модулі, якими користуються всі. Їх малюємо окремою рамкою, стрілки до них не малюються.
const SHARED = ['config', 'logging', 'errors'];
// Ряди згори вниз. Що не потрапило в жоден список, іде у ряд тем.
const ROW_ENTRY = ['main.ts', 'worker.ts', 'data-source.ts'];
const ROW_ROOT = ['app.module.ts', 'worker.module.ts', 'app-setup.ts', 'entities.ts', 'tracing.ts'];
const ROW_INFRA = ['auth', 'users', 'database', 'migrations', 'redis', 'common'];
// Файли кореня, які підключають УСІ теми: замість віяла з 10+ стрілок малюємо одну стрілку до рамки "Теми".
const IMPORTS_ALL_FEATURES = ['app.module.ts', 'entities.ts'];

const input = JSON.parse(readFileSync(0, 'utf8'));

// src/modules/posts/post.entity.ts -> posts; src/migrations/index.ts -> migrations; src/common/queues.ts -> common; src/main.ts -> main.ts
function moduleOf(path) {
  const inModules = path.match(/^src\/modules\/([^/]+)\//);
  if (inModules) return inModules[1];
  if (/^src\/migrations\//.test(path)) return 'migrations';
  if (/^src\/common\//.test(path)) return 'common';
  const topLevel = path.match(/^src\/([^/]+\.ts)$/);
  if (topLevel) return topLevel[1];
  return null;
}

const rowOf = (name) => {
  if (SHARED.includes(name)) return 'shared';
  if (ROW_ENTRY.includes(name)) return 'entry';
  if (ROW_ROOT.includes(name)) return 'root';
  if (ROW_INFRA.includes(name)) return 'infra';
  return 'feature';
};

const nodes = new Set();
const edges = new Set();
const foldedIntoCluster = new Set();
for (const module of input.modules) {
  const from = moduleOf(module.source);
  if (!from) continue;
  nodes.add(from);
  for (const dependency of module.dependencies) {
    const to = moduleOf(dependency.resolved);
    if (!to || to === from) continue;
    nodes.add(to);
    if (SHARED.includes(to)) continue;
    if (IMPORTS_ALL_FEATURES.includes(from) && rowOf(to) === 'feature') {
      foldedIntoCluster.add(from);
      continue;
    }
    edges.add(`${from}\u0000${to}`);
  }
}

// Пара A -> B і B -> A це цикл між модулями: малюємо одну двосторонню стрілку іншим кольором.
const mutual = new Set();
const single = [];
for (const key of edges) {
  const [from, to] = key.split('\u0000');
  if (edges.has(`${to}\u0000${from}`)) {
    if (from < to) mutual.add(key);
  } else {
    single.push([from, to]);
  }
}

const FILL = { entry: '#fff3c4', root: '#e8e8e8', feature: '#ffffff', infra: '#d9f0e3', shared: '#f4f4f4' };
const id = (name) => `"${name}"`;
const inRow = (row) => [...nodes].filter((n) => rowOf(n) === row).sort();

const lines = [];
lines.push('digraph modules {');
lines.push('  graph [rankdir=TB, splines=true, nodesep=0.3, ranksep=0.8, fontname="Helvetica", fontsize=11, newrank=true, compound=true, concentrate=true, pad=0.2];');
lines.push('  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=12, margin="0.18,0.08", color="#555555"];');
lines.push('  edge [color="#555555", arrowsize=0.7, penwidth=1.1];');

for (const row of ['entry', 'root', 'infra']) {
  const names = inRow(row);
  for (const name of names) lines.push(`  ${id(name)} [fillcolor="${FILL[row]}"];`);
  lines.push(`  { rank=same; ${names.map(id).join('; ')}; }`);
}

const features = inRow('feature');
lines.push('  subgraph cluster_features {');
lines.push('    label="Теми"; style="rounded"; color="#bbbbbb"; fontcolor="#555555"; fontsize=11;');
for (const name of features) lines.push(`    ${id(name)} [fillcolor="${FILL.feature}"];`);
// Два ряди тем, щоб картинка не була надто широкою: вище ті теми, які жодна інша тема не імпортує
// (їх підключає лише корінь), нижче ті, що потрібні іншим темам (auth і users ще нижче, у ряді інфраструктури).
const importedByFeature = new Set();
for (const key of edges) {
  const [from, to] = key.split('\u0000');
  if (rowOf(from) === 'feature' && rowOf(to) === 'feature') importedByFeature.add(to);
}
const featuresTop = features.filter((n) => !importedByFeature.has(n));
const featuresBottom = features.filter((n) => importedByFeature.has(n));
if (featuresTop.length > 0) lines.push(`    { rank=same; ${featuresTop.map(id).join('; ')}; }`);
if (featuresBottom.length > 0) lines.push(`    { rank=same; ${featuresBottom.map(id).join('; ')}; }`);
lines.push('  }');

// Пунктирна рамка внизу: спільні модулі без стрілок.
const shared = inRow('shared');
lines.push('  subgraph cluster_shared {');
lines.push('    label="Спільне для всіх,\\nстрілки не малюються"; style="dashed,rounded"; color="#888888"; fontcolor="#555555"; fontsize=11;');
for (const name of shared) lines.push(`    ${id(name)} [fillcolor="${FILL.shared}"];`);
lines.push(`    { rank=same; ${shared.map(id).join('; ')}; }`);
lines.push('  }');
// Невидима стрілка ставить рамку під рядом інфраструктури.
const anchor = inRow('infra')[0];
if (anchor && shared.length > 0) lines.push(`  ${id(anchor)} -> ${id(shared[0])} [style=invis];`);

// Одна стрілка "підключає всі теми" у рамку.
const clusterTarget = featuresTop[Math.floor(featuresTop.length / 2)] ?? features[0];
for (const from of [...foldedIntoCluster].sort()) {
  lines.push(`  ${id(from)} -> ${id(clusterTarget)} [lhead=cluster_features, penwidth=1.6];`);
}

for (const [from, to] of single.sort()) {
  // Стрілки з тем у ряд інфраструктури (auth, users, database, redis) блідіші: їх багато і вони очікувані.
  const faint = rowOf(to) === 'infra' && rowOf(from) === 'feature';
  lines.push(`  ${id(from)} -> ${id(to)}${faint ? ' [color="#9a9a9a"]' : ''};`);
}
for (const key of [...mutual].sort()) {
  const [from, to] = key.split('\u0000');
  lines.push(`  ${id(from)} -> ${id(to)} [dir=both, color="#d9480f", penwidth=1.6];`);
}

lines.push('}');
process.stdout.write(lines.join('\n') + '\n');

const edgeCount = single.length + mutual.size + foldedIntoCluster.size;
process.stderr.write(`graph-modules: ${nodes.size} вузлів, ${edgeCount} стрілок (з них ${mutual.size} двосторонніх, ${foldedIntoCluster.size} у рамку "Теми")\n`);
