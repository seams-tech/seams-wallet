import type { Server } from 'node:http';
import type { Source } from './report';

export function startCalibrationServer(input: {
  port: number;
  source: Source;
}): Promise<{
  server: Server;
  url: string;
  state: { requests: string[]; posts: number };
}>;
