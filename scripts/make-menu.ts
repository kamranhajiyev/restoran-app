/**
 * Turns a menu typed as plain text into the Excel file the admin import reads.
 *
 * Usage:
 *   npm run menu -- /path/to/menu.txt
 *
 * Output: /path/to/menu.xlsx, checked with the import's own reader before it is
 * called good. The text format is described at the top of lib/menu-text.ts.
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseMenuFile } from '@/lib/excel';
import { menuTextToRows, menuTextWorkbook } from '@/lib/menu-text';

async function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(input)) {
    console.error('Usage: npm run menu -- <menu.txt>');
    process.exit(1);
  }

  const result = menuTextToRows(fs.readFileSync(input, 'utf-8'));
  if (result.errors.length || !result.rows.length) {
    console.error(result.errors.join('\n') || 'No dishes found in the text.');
    process.exit(1);
  }

  const buf: Buffer = XLSX.write(menuTextWorkbook(result), { type: 'buffer', bookType: 'xlsx' });

  // The same reader the admin page uses: what it reports here is what the owner would see.
  const preview = await parseMenuFile(new File([new Uint8Array(buf)], 'menu.xlsx'), [], []);
  if (preview.errors.length) {
    console.error(preview.errors.join('\n'));
    process.exit(1);
  }

  const output = input.replace(/\.[^./\\]+$/, '') + '.xlsx';
  fs.writeFileSync(output, buf);
  console.log(`${preview.newItems.length} dishes in ${preview.newCategories.length} categories → ${output}`);
}

main();
