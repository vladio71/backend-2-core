/**
 * Конфіг dependency-cruiser: правила для `npm run deps:check` і налаштування графів для `npm run graph`.
 * Документація: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Циклічні імпорти (A -> B -> A). У Nest це ламає DI і робить порядок завантаження файлів непередбачуваним.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-src-to-test',
      severity: 'error',
      comment: 'Код застосунку не має залежати від тестів: test/ не потрапляє у dist і у production.',
      from: { path: '^src/modules/' },
      to: { path: '^test/' },
    },
  ],
  options: {
    // Куди не ходити: сторонні пакети лише як вузли на краю, без їхніх внутрішніх залежностей.
    doNotFollow: { path: 'node_modules' },
    // Що взагалі не брати в граф.
    exclude: { path: '(^|/)(node_modules|dist|coverage)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Враховувати імпорти типів (import type): для графа модулів це теж зв'язок.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'], mainFields: ['main', 'types'] },
    reporterOptions: {
      // `archi`: граф модулів. Усе, що всередині одного каталогу з списку нижче, згортається в один вузол.
      archi: {
        collapsePattern: '^src/(modules/[^/]+|migrations)/|^node_modules/(@[^/]+/+)?[^/]+',
        theme: { graph: { rankdir: 'LR', splines: 'true' } },
      },
      // `dot`: повний граф файлів, кластери за каталогами.
      dot: {
        collapsePattern: 'node_modules/(@[^/]+/+)?[^/]+',
        theme: { graph: { rankdir: 'LR', splines: 'true' } },
      },
    },
  },
};
