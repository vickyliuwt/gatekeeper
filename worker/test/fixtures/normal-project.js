import { formatDate } from '../utils/date.js';
import config from '../../config/index.js';
import { Logger } from '../lib/logger.js';

const TEMPLATE_DIR = './templates/../shared';

export function describe(nodes) {
  return nodes.includes('root');
}

export function renderList(items) {
  const modes = ['compact', 'full'];
  return items.map(i => formatDate(i.createdAt));
}