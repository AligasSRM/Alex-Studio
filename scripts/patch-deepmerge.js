#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const entryPath = require.resolve('deepmerge');
const packagePath = path.join(path.dirname(entryPath), 'package.json');
const installedPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

if (installedPackage.version !== '4.3.1') {
  throw new Error(
    `Expected deepmerge 4.3.1 for the reviewed security patch; found ${installedPackage.version}. Review the upstream fix before changing this guard.`
  );
}

const source = fs.readFileSync(entryPath, 'utf8');
const targetGuard = "if (propertyIsForbidden(key)) {";
const sourceGuard = "if (propertyIsForbidden(key) || propertyIsUnsafe(target, key)) {";

if (source.includes('function propertyIsForbidden(key)')) {
  if (source.includes(targetGuard) && source.includes(sourceGuard)) {
    process.stdout.write('deepmerge security patch already applied.\\n');
    process.exit(0);
  }
  throw new Error('deepmerge has a partial or unexpected security patch; refusing to continue.');
}

const helperAnchor = 'function mergeObject(target, source, options) {';
const targetAnchor = 'getKeys(target).forEach(function(key) {\\n\\t\\t\\tdestination[key] =';
const sourceAnchor = 'getKeys(source).forEach(function(key) {\\n\\t\\tif (propertyIsUnsafe(target, key)) {';

if (
  source.split(helperAnchor).length !== 2 ||
  source.split(targetAnchor).length !== 2 ||
  source.split(sourceAnchor).length !== 2
) {
  throw new Error('deepmerge source does not match the reviewed 4.3.1 patch anchors; refusing to modify it.');
}

let patched = source.replace(
  helperAnchor,
  "function propertyIsForbidden(key) {\\n\\treturn key === '__proto__'\\n}\\n\\n" + helperAnchor
);
patched = patched.replace(
  targetAnchor,
  'getKeys(target).forEach(function(key) {\\n\\t\\t\\tif (propertyIsForbidden(key)) {\\n\\t\\t\\t\\treturn\\n\\t\\t\\t}\\n\\t\\t\\tdestination[key] ='
);
patched = patched.replace(
  sourceAnchor,
  'getKeys(source).forEach(function(key) {\\n\\t\\tif (propertyIsForbidden(key) || propertyIsUnsafe(target, key)) {'
);

fs.writeFileSync(entryPath, patched);
process.stdout.write('Applied reviewed __proto__ guard to deepmerge 4.3.1.\\n');
