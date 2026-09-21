import { describe, expect, it } from 'vitest';

import { exportName, serialize, type ExportInput } from './export';

const input: ExportInput = {
  columns: [{ name: 'host' }, { name: 'signals' }, { name: 'n' }],
  rows: [
    ['voapi.8x8.com', ['canary_reflected', 'post_differs'], 3],
    ['a,b "quoted"', null, 0],
  ],
};

describe('serializing a result', () => {
  it('quotes per RFC 4180 and renders null as empty, not as the word', () => {
    const csv = serialize(input, 'csv');
    expect(csv).toContain('host,signals,n\r\n');
    // A null cell is EMPTY. `null` as text would come back as the four-character string on re-import.
    expect(csv).toContain('"a,b ""quoted""",,0');
  });

  /**
   * A CELL BEGINNING `=`, `+`, `-` OR `@` IS A FORMULA to Excel and Sheets, and this data comes off
   * HTTP responses on hosts we do not control — so it is exactly the text an attacker picks. The
   * value must survive unchanged for a reader; it must not execute for one.
   */
  it('defuses spreadsheet formula injection without altering the value', () => {
    const csv = serialize(
      { columns: [{ name: 'v' }], rows: [['=cmd|calc!A1'], ['+1'], ['@SUM(1)'], ['-2']] },
      'csv'
    );
    for (const dangerous of ['=cmd', '+1', '@SUM', '-2']) {
      expect(csv).toContain(dangerous); // the text is still there
    }
    expect(csv).not.toMatch(/^=cmd/m); // but never first on the line
  });

  it('keys JSON by column name so a reader does not count commas', () => {
    expect(JSON.parse(serialize(input, 'json'))[0]).toEqual({
      host: 'voapi.8x8.com',
      signals: ['canary_reflected', 'post_differs'],
      n: 3,
    });
  });

  it('writes JSONL as one object per line', () => {
    const lines = serialize(input, 'jsonl').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toMatchObject({ host: 'a,b "quoted"', signals: null });
  });

  it('separates TSV with tabs', () => {
    expect(serialize(input, 'tsv').split('\r\n')[0]).toBe('host\tsignals\tn');
  });
});

describe('the filename', () => {
  const now = new Date(2026, 8, 18); // month is 0-based: September

  it('carries the dataset and the day', () => {
    expect(exportName('observations', 'csv', { now })).toBe('observations-2026-09-18.csv');
  });

  /**
   * A FILE THAT HOLDS A CAPPED RESULT MUST SAY SO IN ITS NAME. The banner warning about truncation
   * lives on a page the reader closes; the file outlives it, gets attached to a report, and is
   * counted. `observations.csv` holding 200 of 12,330 rows with nothing to say so is the
   * silent-truncation failure, written to disk.
   */
  it('marks a capped export in the name itself', () => {
    expect(exportName('observations', 'csv', { truncated: true, now })).toBe(
      'observations-2026-09-18-capped.csv'
    );
  });

  it('never produces a path or a shell surprise from a dataset name', () => {
    expect(exportName('../../etc/passwd', 'json', { now })).toBe('etc-passwd-2026-09-18.json');
    expect(exportName('', 'csv', { now })).toBe('dataset-2026-09-18.csv');
  });
});
