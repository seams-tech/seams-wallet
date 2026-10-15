import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = process.argv[2];
if (!file) throw new Error('Expected a compiled WASM file');
const input = readFileSync(file);
if (!WebAssembly.validate(input)) throw new Error('Invalid input WASM');
const sections = [input.subarray(0, 8)];
const functions = {};
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
    if (name === 'name') readFunctionNames(input, nameLength.next + nameLength.value, end);
    remove = name === 'name' || name.startsWith('.debug_');
  }
  if (!remove) sections.push(input.subarray(start, end));
  position = end;
}
const output = Buffer.concat(sections);
if (!WebAssembly.validate(output)) throw new Error('Invalid stripped WASM');
writeFileSync(file, output);
// Keep symbols beside the build for local CPU profiles. They are not imported by the Worker.
writeFileSync(
  `${file}.names.json`,
  JSON.stringify({
    wasmSha256: createHash('sha256').update(output).digest('hex'),
    functions,
  }),
);
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

function readFunctionNames(bytes, start, end) {
  let cursor = start;
  while (cursor < end) {
    const type = bytes[cursor++];
    const size = readUnsigned(bytes, cursor);
    const next = size.next + size.value;
    if (type === 1) {
      const count = readUnsigned(bytes, size.next);
      cursor = count.next;
      for (let index = 0; index < count.value; index++) {
        const id = readUnsigned(bytes, cursor);
        const length = readUnsigned(bytes, id.next);
        functions[id.value] = bytes.toString('utf8', length.next, length.next + length.value);
        cursor = length.next + length.value;
      }
    }
    cursor = next;
  }
}
