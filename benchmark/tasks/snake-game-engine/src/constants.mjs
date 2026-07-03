export const directionDeltaByName = Object.freeze({
  up: Object.freeze({ deltaX: 0, deltaY: -1 }),
  down: Object.freeze({ deltaX: 0, deltaY: 1 }),
  left: Object.freeze({ deltaX: -1, deltaY: 0 }),
  right: Object.freeze({ deltaX: 1, deltaY: 0 })
});

export const oppositeDirectionByName = Object.freeze({
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left'
});

export function isDirectionName(directionName) {
  return directionName === 'up' || directionName === 'down' || directionName === 'left' || directionName === 'right';
}
