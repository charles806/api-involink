// Shared fluent Supabase mock for route tests. The same instance is handed to
// Node's require shim (see tests/shim.cjs) and to the test file, so tests can
// queue results and inspect the generated query chains.

const __ctx = {
  results: [],
  index: 0,
  history: [],
};

function build() {
  const chain = {
    from(table) { this.table = table; this.calls = [['from', table]]; return this; },
    select(...a) { this.calls.push(['select', ...a]); return this; },
    insert(...a) { this.calls.push(['insert', ...a]); return this; },
    update(...a) { this.calls.push(['update', ...a]); return this; },
    delete(...a) { this.calls.push(['delete', ...a]); return this; },
    eq(...a) { this.calls.push(['eq', ...a]); return this; },
    or(...a) { this.calls.push(['or', ...a]); return this; },
    in(...a) { this.calls.push(['in', ...a]); return this; },
    gte(...a) { this.calls.push(['gte', ...a]); return this; },
    lte(...a) { this.calls.push(['lte', ...a]); return this; },
    order(...a) { this.calls.push(['order', ...a]); return this; },
    limit(...a) { this.calls.push(['limit', ...a]); return this; },
    single() { this.calls.push(['single']); return this; },
    then(resolve, reject) {
      __ctx.history.push(this.calls || []);
      const next = __ctx.results[__ctx.index++];
      const result = next === undefined ? { data: null, error: null } : next;
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return { from: (table) => Object.assign(Object.create(chain), { table, calls: [['from', table]] }) };
}

export const supabaseAdmin = build();
export const supabase = build();

export function setResults(...results) {
  __ctx.results = results;
  __ctx.index = 0;
  __ctx.history = [];
}

export function getHistory() {
  return __ctx.history;
}

export function lastQuery() {
  return __ctx.history[__ctx.history.length - 1] || [];
}

export function queriesOnTable(table) {
  return __ctx.history.filter((calls) => calls[0] && calls[0][1] === table);
}