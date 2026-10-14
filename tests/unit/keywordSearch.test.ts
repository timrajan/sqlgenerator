import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { excerpt, queryTerms, rank, scoreFields, splitMarkdownSections, tokenize } from '../../src/services/keywordSearch.js';
import { advisoryLint } from '../../src/services/sqlAdvisory.js';

describe('tokenize', () => {
  it('splits identifiers into whole token and parts, drops stopwords', () => {
    assert.deepEqual(tokenize('the APP.CUSTOMER_MASTER'), ['app', 'customer_master', 'customer', 'master']);
  });
  it('keeps numbers including leading zeros', () => {
    assert.deepEqual(queryTerms('postcode 0800 and 3000'), ['0800', '3000', 'postcode']);
  });
});

describe('scoreFields', () => {
  it('weights fields and rewards covering more terms', () => {
    const terms = queryTerms('customer postcode');
    const both = scoreFields(terms, [{ text: 'customer postcode', weight: 1 }]);
    const one = scoreFields(terms, [{ text: 'customer customer customer', weight: 1 }]);
    const heavy = scoreFields(terms, [{ text: 'customer postcode', weight: 3 }]);
    assert.ok(both.score > one.score);
    assert.ok(heavy.score > both.score);
    assert.deepEqual(one.matched, ['customer']);
  });
  it('scores zero with no overlap', () => {
    assert.equal(scoreFields(['zzz'], [{ text: 'customer', weight: 5 }]).score, 0);
  });
});

describe('rank', () => {
  it('breaks ties by key for determinism', () => {
    const items = [{ k: 'b', s: 1 }, { k: 'a', s: 1 }, { k: 'c', s: 2 }];
    assert.deepEqual(rank(items, (i) => i.s, (i) => i.k).map((i) => i.k), ['c', 'a', 'b']);
  });
});

describe('excerpt and sections', () => {
  it('centres an excerpt near the first match and bounds its size', () => {
    const text = `${'x '.repeat(500)}postcode here ${'y '.repeat(500)}`;
    const e = excerpt(text, ['postcode'], 100);
    assert.ok(e.includes('postcode'));
    assert.ok(e.length <= 102);
  });
  it('splits Markdown on headings', () => {
    const s = splitMarkdownSections('# A\none\n## B\ntwo');
    assert.deepEqual(s.map((x) => x.heading), ['A', 'B']);
  });
});

describe('advisoryLint (advisory only)', () => {
  it('is always labelled advisory', () => {
    assert.match(advisoryLint('SELECT 1 FROM SYSIBM.SYSDUMMY1').label, /advisory-only/);
  });
  it('flags write keywords and multiple statements, ignoring literals and comments', () => {
    assert.ok(advisoryLint('DELETE FROM APP.X').warnings.length >= 2);
    assert.ok(advisoryLint('SELECT 1 FROM T; DROP TABLE T').warnings.some((w) => /more than one/.test(w)));
    assert.deepEqual(advisoryLint("SELECT 'DELETE' AS X FROM T -- update\n").warnings, []);
  });
});
