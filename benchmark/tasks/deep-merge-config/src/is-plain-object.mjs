export function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const prototypeValue = Object.getPrototypeOf(value);
  return prototypeValue === Object.prototype || prototypeValue === null;
}
