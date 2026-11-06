const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const context = vm.createContext({console, Date, JSON, Set, Map});
const sourceCode = fs.readFileSync('live_enternewpart_candidate.js', 'utf8').replace(
  /function enp_soDefaultInventoryLocationId_\(\) \{[\s\S]*?\n\}/,
  'function enp_soDefaultInventoryLocationId_() { return 60; }'
);
vm.runInContext(sourceCode, context);
const engine = context.hub_row2LegacyEngine_();
const test = (description) => {
  const line = {description, price: 1086, qty: 1};
  const replacement = {newItemId: 123, desiredItemName: 'Forgeworks Face', desiredItemNumber: '50-4094', desiredPrice: 1086};
  const item = {name: 'Forgeworks Face', itemType: {id: 1}, defaultInventoryLocation: {id: 60}};
  engine.enp_applyReplacementToLine_(line, replacement, item);
  return line;
};
const source = 'Item Number: 50-4094\nItem Name: Forgeworks Face\nPrice: $1086\n**Please confirm**';
const result = test(source);
assert(result.description.includes(source));
assert(result.description.startsWith('Forgeworks Face (50-4094)'));
assert.equal(result.qty, 1);
assert.equal(result.price, 1086);
assert.equal(result.item.id, 123);
assert.equal(test('').description, 'Forgeworks Face (50-4094)');
assert.equal(test('Forgeworks Face (50-4094)').description, 'Forgeworks Face (50-4094)');
console.log('Description preservation: 3 cases passed; item ID, quantity and price retained.');
