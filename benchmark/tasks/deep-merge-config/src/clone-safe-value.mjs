import { isPlainObject } from './is-plain-object.mjs';

export function cloneSafeValue(value) {
  throw new Error('TODO');
}

export function isUnsafeKey(keyName) {
  return keyName === '__proto__' || keyName === 'prototype' || keyName === 'constructor';
}
