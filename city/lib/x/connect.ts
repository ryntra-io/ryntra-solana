import { createXClient } from './client.ts';
import { readXConfig, type XConfig } from './config.ts';
import { createXSender, type XPublisher } from './sender.ts';

/**
 * The sender as the deployed server has it, from the environment the owner sets (`config.ts`). Without
 * `RYNTRA_X_SENDER=on` and all four keys it is not connected and builds no client. Server only.
 */

let config: XConfig | null = null;
let sender: XPublisher | null = null;

export function xConfig(): XConfig {
  config ??= readXConfig(process.env);
  return config;
}

export function xSender(): XPublisher {
  if (sender) return sender;
  const c = xConfig();
  sender = createXSender(c, c.connected && c.keys ? createXClient({ keys: c.keys }) : null);
  return sender;
}
