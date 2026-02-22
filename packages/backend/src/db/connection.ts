import path from 'node:path';
import { env } from '../config/env.js';
import { JsonStore } from './json-store.js';

export const store = new JsonStore(path.resolve(env.DATA_DIR));
