const counters = new Map();

function increment(key, value = 1) {
  const current = counters.get(key) || 0;
  counters.set(key, current + value);
}

function getAll() {
  return Object.fromEntries(counters.entries());
}

export const metrics = {
  increment,
  getAll
};
