const deepmerge = require('deepmerge') as typeof import('deepmerge');

describe('deepmerge prototype-poisoning regression', () => {
  test('rejects __proto__ from a null-prototype target', () => {
    const source = JSON.parse('{"__proto__":{"isAdmin":true}}');
    const result = deepmerge(Object.create(null), source);

    expect(result.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  test('rejects nested __proto__ when the target contains a null placeholder', () => {
    const source = JSON.parse('{"session":{"__proto__":{"isAdmin":true}}}');
    const result = deepmerge({ session: null }, source);

    expect(result.session.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(result.session)).toBe(Object.prototype);
  });

  test('does not copy an own __proto__ key from the target', () => {
    const target = JSON.parse('{"__proto__":{"isAdmin":true}}');
    const result = deepmerge(target, {});

    expect(result.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  test('rejects __proto__ while cloning objects inside arrays', () => {
    const source = JSON.parse('{"items":[{"__proto__":{"isAdmin":true}}]}');
    const result = deepmerge({}, source);

    expect(result.items[0].isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(result.items[0])).toBe(Object.prototype);
  });
});
