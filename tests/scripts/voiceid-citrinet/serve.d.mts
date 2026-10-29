import type { Server } from 'node:http';

export function startComparisonServer(options: {
  port: number;
  source: 'human_microphone' | 'synthetic_fixture';
  directory: string;
}): Promise<{ server: Server; url: string }>;
