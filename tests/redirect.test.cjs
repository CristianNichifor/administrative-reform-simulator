const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const html = readFileSync(join(__dirname, '../redirect/index.html'), 'utf8');
const target = "https://projects.cristian-nichifor.com/romania-reforms/administrative-reform/";

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

test('README sends readers to the hub, not the old Pages URL', () => {
  const readme = readFileSync(join(__dirname, '../README.md'), 'utf8');
  assert.ok(readme.includes('(' + target + ')'), 'README links the live application on the hub');
  assert.ok(readme.includes('(https://projects.cristian-nichifor.com/)'), 'README links the hub');
  assert.doesNotMatch(readme, /Live:\s*<?https:\/\/cristiannichifor\.github\.io/, 'old Pages URL is not presented as live');
});
