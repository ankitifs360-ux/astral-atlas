import { describe, expect, it } from 'vitest';

import { calculateCyclomaticComplexity } from './cyclomatic-complexity.js';

describe('calculateCyclomaticComplexity', () => {
  it('returns one for a simple file with no functions or decisions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
const value = 42;
              `,
      }),
    ).toBe(1);
  });

  it('counts each function as a base execution path', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function first() {
  return 1;
}

function second() {
  return 2;
}
              `,
      }),
    ).toBe(2);
  });

  it('counts an if statement as one decision', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function check(
  value: number,
) {
  if (value > 0) {
    return true;
  }

  return false;
}
              `,
      }),
    ).toBe(2);
  });

  it('counts else-if as another if decision', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function classify(
  value: number,
) {
  if (value > 0) {
    return 'positive';
  } else if (value < 0) {
    return 'negative';
  }

  return 'zero';
}
              `,
      }),
    ).toBe(3);
  });

  it('counts loops as decisions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'javascript',

        source: `
function run(items) {
  for (const item of items) {
    while (item.pending) {
      item.process();
    }
  }
}
              `,
      }),
    ).toBe(3);
  });

  it('counts ternary expressions as decisions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function label(
  active: boolean,
) {
  return active
    ? 'yes'
    : 'no';
}
              `,
      }),
    ).toBe(2);
  });

  it('counts logical short-circuit operators', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function canAccess(
  active: boolean,
  admin: boolean,
  owner: boolean,
) {
  if (
    active &&
    (
      admin ||
      owner
    )
  ) {
    return true;
  }

  return false;
}
              `,
      }),
    ).toBe(4);
  });

  it('counts nullish coalescing as a decision', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function getName(
  name?: string,
) {
  return name ?? 'unknown';
}
              `,
      }),
    ).toBe(2);
  });

  it('counts catch clauses as decisions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'javascript',

        source: `
function load() {
  try {
    return read();
  } catch (error) {
    return null;
  }
}
              `,
      }),
    ).toBe(2);
  });

  it('counts switch cases as decisions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function convert(
  value: number,
) {
  switch (value) {
    case 1:
      return 'one';

    case 2:
      return 'two';

    default:
      return 'other';
  }
}
              `,
      }),
    ).toBe(3);
  });

  it('supports arrow functions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
const validate = (
  value: number,
) => {
  if (value > 10) {
    return true;
  }

  return false;
};
              `,
      }),
    ).toBe(2);
  });

  it('supports TypeScript methods', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
class Service {
  run(
    enabled: boolean,
  ) {
    if (enabled) {
      return 1;
    }

    return 0;
  }
}
              `,
      }),
    ).toBe(2);
  });

  it('supports TSX source', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'tsx',

        source: `
function Component({
  active,
}: {
  active: boolean;
}) {
  return (
    <div>
      {
        active
          ? 'active'
          : 'inactive'
      }
    </div>
  );
}
              `,
      }),
    ).toBe(2);
  });

  it('supports Python if statements', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'python',

        source: `
def check(value):
    if value > 0:
        return True

    return False
              `,
      }),
    ).toBe(2);
  });

  it('supports Python loops', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'python',

        source: `
def process(items):
    for item in items:
        while item.pending:
            item.process()
              `,
      }),
    ).toBe(3);
  });

  it('counts Python boolean operators', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'python',

        source: `
def allowed(
    active,
    admin,
    owner,
):
    if active and (admin or owner):
        return True

    return False
              `,
      }),
    ).toBe(4);
  });

  it('counts Python conditional expressions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'python',

        source: `
def label(active):
    return "yes" if active else "no"
              `,
      }),
    ).toBe(2);
  });

  it('counts Python except clauses', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'python',

        source: `
def load():
    try:
        return read()
    except ValueError:
        return None
              `,
      }),
    ).toBe(2);
  });

  it('aggregates decisions across multiple functions', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'typescript',

        source: `
function first(
  value: number,
) {
  if (value > 0) {
    return true;
  }

  return false;
}

function second(
  items: string[],
) {
  for (const item of items) {
    console.log(item);
  }
}
              `,
      }),
    ).toBe(4);
  });

  it('counts decisions at file scope', () => {
    expect(
      calculateCyclomaticComplexity({
        language: 'javascript',

        source: `
if (process.env.NODE_ENV === 'production') {
  start();
}
              `,
      }),
    ).toBe(2);
  });
});
