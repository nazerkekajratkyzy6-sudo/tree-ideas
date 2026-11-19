import { routeConfig } from '../server/core.js';
import { handler } from '../server/vercel.js';

export default handler((ctx) => routeConfig(ctx));
