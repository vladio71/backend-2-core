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
      // Ідея: нижній шар не знає про верхній. config, logging, errors, database, redis це фундамент, яким
      // користуються всі теми (posts, jobs, auth, ...). Якщо фундамент імпортує щось із теми, стрілка йде
      // вгору і будь-яка тема починає тягнути за собою весь застосунок. Список сутностей тому живе у src/entities.ts,
      // а не у database.
      name: 'infra-does-not-know-features',
      severity: 'error',
      comment: 'Інфраструктурний модуль (config, logging, errors, database, redis) імпортує feature-модуль. Залежність має йти згори вниз: передай потрібне параметром або з кореня (src/entities.ts).',
      from: { path: '^src/modules/(database|redis|config|logging|errors)/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/(database|redis|config|logging|errors)/' },
    },
    {
      // Та сама ідея на рівні каталогів модулів: між двома модулями стрілка йде лише в один бік.
      // no-circular вище ловить цикли між файлами, а цей між каталогами (posts/* <-> queries/*), які файл за файлом
      // можуть бути ациклічними, але модулі все одно залежать один від одного.
      name: 'no-module-cycles',
      severity: 'error',
      comment: 'Цикл між модулями (каталогами src/modules/*). Винеси спільне у третій модуль або передай залежність через DI-токен, щоб стрілка йшла в один бік.',
      scope: 'folder',
      from: { path: '^src/modules/[^/]+$' },
      to: { path: '^src/modules/[^/]+$', circular: true },
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
