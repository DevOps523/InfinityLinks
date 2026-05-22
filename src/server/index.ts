import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);

createApp().listen(config.port, config.host, () => {
  console.log(`InfinityLinks admin running at http://${config.host}:${config.port}`);
});
