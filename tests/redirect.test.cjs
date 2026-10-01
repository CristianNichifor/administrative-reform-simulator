const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const html = readFileSync(join(__dirname, '../redirect/index.html'), 'utf8');
const target = "https://cristiannichifor.github.io/romania-reforms/administrativ/";

test('redirect preserves query and scenario hash exactly', () => {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, 'expected one redirect script');
  for (const [search, hash] of [['', ''], ['?lang=ro&x=%2F', '#scenario=%7B%22x%22%3A1%7D']]) {
    const destinations = [];
    vm.runInNewContext(scripts[0][1], { location: { search, hash, replace: url => destinations.push(url) } }, { timeout: 1000 });
    assert.deepEqual(destinations, [target + search + hash]);
  }
});

test('canonical, noscript and visible fallback agree', () => {
  assert.ok(html.includes('rel="canonical" href="' + target + '"'));
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/i);
  assert.ok(fallback, 'no-JavaScript fallback is required');
  assert.ok(fallback[1].includes('0; url=' + target));
  assert.ok(html.includes('<a href="' + target + '"'));
});
