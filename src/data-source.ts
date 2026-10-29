// Що це: DataSource для CLI TypeORM (npm run migration:run / revert / generate).
// Чому: CLI не знає про Nest, йому потрібен звичайний експортований DataSource.
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig } from './modules/config/config.module';
import { buildDataSourceOptions } from './modules/database/data-source-options';

export default new DataSource(buildDataSourceOptions(loadConfig()));
