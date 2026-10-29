/** e2e-тести: піднімаємо весь застосунок і ходимо по HTTP через supertest. Потрібні Postgres і Redis. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  testTimeout: 90000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
};
