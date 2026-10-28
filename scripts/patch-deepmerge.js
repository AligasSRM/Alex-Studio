#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let entryPath;
try {
  entryPath = require.resolve('deepmerge');
} catch (error) {
  if (error && error.code === 'MODULE_NOT_FOUND') {
    process.stdout.write('deepmerge is not installed (likely a production-only install); skipping dev-only patch.\n');
    process.exit(0);
  }
  throw error;
}

function findPackageRoot(startPath, expectedName) {
  let current = path.dirname(startPath);
  while (true) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) {
      const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (metadata.name === expectedName) return { root: current, metadata };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Could not locate package.json for ' + expectedName + ' from ' + startPath);
}

const foundPackage = findPackageRoot(entryPath, 'deepmerge');
if (foundPackage.metadata.version !== '4.3.1') {
  throw new Error(
    'Expected deepmerge 4.3.1 for the reviewed security patch; found ' +
    foundPackage.metadata.version +
    '. Review the upstream fix before changing this guard.'
  );
}

const source = fs.readFileSync(entryPath, 'utf8');
const targetGuard = 'if (propertyIsForbidden(key)) {';
const sourceGuard = 'if (propertyIsForbidden(key) || propertyIsUnsafe(target, key)) {';

if (source.includes('function propertyIsForbidden(key)')) {
  if (source.includes(targetGuard) && source.includes(sourceGuard)) {
    process.stdout.write('deepmerge security patch already applied.\n');
    process.exit(0);
  }
  throw new Error('deepmerge has a partial or unexpected security patch; refusing to continue.');
}

const helperAnchor = 'function mergeObject(target, source, options) {';
const targetAnchor = 'getKeys(target).forEach(function(key) {\n\t\t\tdestination[key] =';
const sourceAnchor = 'getKeys(source).forEach(function(key) {\n\t\tif (propertyIsUnsafe(target, key)) {';

if (
  source.split(helperAnchor).length !== 2 ||
  source.split(targetAnchor).length !== 2 ||
  source.split(sourceAnchor).length !== 2
) {
  throw new Error('deepmerge source does not match the reviewed 4.3.1 patch anchors; refusing to modify it.');
}

let patched = source.replace(
  helperAnchor,
  "function propertyIsForbidden(key) {\n\treturn key === '__proto__'\n}\n\n" + helperAnchor
);
patched = patched.replace(
  targetAnchor,
  'getKeys(target).forEach(function(key) {\n\t\t\tif (propertyIsForbidden(key)) {\n\t\t\t\treturn\n\t\t\t}\n\t\t\tdestination[key] ='
);
patched = patched.replace(
  sourceAnchor,
  'getKeys(source).forEach(function(key) {\n\t\tif (propertyIsForbidden(key) || propertyIsUnsafe(target, key)) {'
);

fs.writeFileSync(entryPath, patched);
process.stdout.write('Applied reviewed __proto__ guard to deepmerge 4.3.1.\n');
