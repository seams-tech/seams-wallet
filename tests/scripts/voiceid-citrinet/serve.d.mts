import type { Server } from 'node:http';

export function startComparisonServer(options: {
  port: number;
  source: 'human_microphone' | 'synthetic_fixture';
}): Promise<{ server: Server; url: string }>;
