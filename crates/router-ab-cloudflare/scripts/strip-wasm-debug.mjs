import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Expected a compiled WASM file');
const input = readFileSync(file);
if (!WebAssembly.validate(input)) throw new Error('Invalid input WASM');
const sections = [input.subarray(0, 8)];
let position = 8;
while (position < input.length) {
  const start = position;
  const sectionId = input[position++];
  const size = readUnsigned(input, position);
  position = size.next;
  const end = position + size.value;
  let remove = false;
  if (sectionId === 0) {
    const nameLength = readUnsigned(input, position);
    const name = input.toString('utf8', nameLength.next, nameLength.next + nameLength.value);
    remove = name === 'name' || name.startsWith('.debug_');
  }
  if (!remove) sections.push(input.subarray(start, end));
  position = end;
}
const output = Buffer.concat(sections);
if (!WebAssembly.validate(output)) throw new Error('Invalid stripped WASM');
writeFileSync(file, output);
console.log(`Removed ${input.length - output.length} debug bytes from ${file}`);

function readUnsigned(bytes, start) {
  let value = 0;
  let shift = 0;
  let next = start;
  for (;;) {
    const byte = bytes[next++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next };
    shift += 7;
  }
}
