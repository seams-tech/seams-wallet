#!/usr/bin/env node
import { composeVoiceIdWalletAssets } from './hosting.mjs';

const [walletPublicDirectory, outputDirectory, ...extra] = process.argv.slice(2);
if (!walletPublicDirectory || !outputDirectory || extra.length) {
  throw new Error('Usage: seams-voiceid-host <wallet-public-directory> <new-output-directory>');
}
console.log(await composeVoiceIdWalletAssets({ walletPublicDirectory, outputDirectory }));
