export function printLocalServiceTable(title, services) {
  let serviceWidth = 'Service'.length;
  let urlWidth = 'URL'.length;
  for (const service of services) {
    serviceWidth = Math.max(serviceWidth, service.name.length);
    urlWidth = Math.max(urlWidth, service.url.length);
  }
  const statusWidth = 'Status'.length;
  const border =
    `+${'-'.repeat(serviceWidth + 2)}` +
    `+${'-'.repeat(urlWidth + 2)}` +
    `+${'-'.repeat(statusWidth + 2)}+`;

  console.log(`\n${colorize(title, '1;36')}`);
  console.log(border);
  console.log(
    `| ${'Service'.padEnd(serviceWidth)} | ${'URL'.padEnd(urlWidth)} | ${'Status'.padEnd(statusWidth)} |`,
  );
  console.log(border);
  for (const service of services) {
    const status = colorize('READY'.padEnd(statusWidth), '1;32');
    console.log(
      `| ${service.name.padEnd(serviceWidth)} | ${service.url.padEnd(urlWidth)} | ${status} |`,
    );
  }
  console.log(border);
}

function colorize(value, style) {
  if (
    !process.stdout.isTTY ||
    process.env.NO_COLOR !== undefined ||
    process.env.FORCE_COLOR === '0'
  ) {
    return value;
  }
  return `\u001b[${style}m${value}\u001b[0m`;
}
