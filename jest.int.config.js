/** Інтеграційні тести: репозиторії і SQL проти справжнього PostgreSQL (DATABASE_URL_TEST). */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/int/**/*.int-spec.ts'],
  testTimeout: 60000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
};
