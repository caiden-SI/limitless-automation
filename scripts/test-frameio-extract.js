#!/usr/bin/env node
// Unit tests for frameio.extractAssetIdFromUrl().

const { extractAssetIdFromUrl } = require('../lib/frameio');

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = '11111111-2222-3333-4444-555555555555';
const UUID_A_UPPER = UUID_A.toUpperCase();

const cases = [
  // Direct /player/ URLs
  [`https://app.frame.io/player/${UUID_A}`, UUID_A, 'player path'],
  [`https://app.frame.io/player/${UUID_A}?version=${UUID_B}`, UUID_A, 'player with ?version=— return asset, not version'],
  [`https://next.frame.io/player/${UUID_A}`, UUID_A, 'next.frame.io player path'],
  [`https://app.frame.io/player/${UUID_A_UPPER}`, UUID_A, 'uppercase UUID lowercased'],

  // /projects/.../view/ and /files/ — asset is the last UUID
  [`https://app.frame.io/projects/${UUID_B}/view/${UUID_A}`, UUID_A, 'projects/view — asset is second UUID'],
  [`https://app.frame.io/projects/${UUID_B}/files/${UUID_A}`, UUID_A, 'projects/files — asset is second UUID'],

  // /reviews/ — asset comes after the review id
  [`https://app.frame.io/reviews/${UUID_B}/${UUID_A}`, UUID_A, 'reviews path — asset is last UUID'],

  // Opaque — explicit null
  [`https://f.io/xY9Kp`, null, 'f.io short URL — opaque'],
  [`https://app.frame.io/presentations/${UUID_A}`, null, 'presentations — UUID is presentation id, not asset'],
  [`https://app.frame.io/share/${UUID_A}`, null, 'share — same as presentations'],

  // Invalid / edge cases
  [null, null, 'null input'],
  [undefined, null, 'undefined input'],
  ['', null, 'empty string'],
  [42, null, 'non-string input'],
  ['not a url', null, 'garbage non-URL'],
  [`https://app.frame.io/`, null, 'no UUID anywhere'],
  [`just the uuid: ${UUID_A}`, UUID_A, 'bare UUID in text — fallback match'],
];

let passed = 0;
let failed = 0;

for (const [input, expected, label] of cases) {
  const actual = extractAssetIdFromUrl(input);
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      input:    ${JSON.stringify(input)}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n${passed}/${cases.length} cases passed`);
process.exit(failed === 0 ? 0 : 1);
