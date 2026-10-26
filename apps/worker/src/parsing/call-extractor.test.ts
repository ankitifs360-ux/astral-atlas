import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import TypeScript from 'tree-sitter-typescript';
import { describe, expect, it } from 'vitest';

import { extractCalls } from './call-extractor.js';

import type { SupportedLanguage } from './types.js';

function parseCalls(source: string, language: SupportedLanguage) {
  const parser = new Parser();

  switch (language) {
    case 'javascript': {
      parser.setLanguage(JavaScript);

      break;
    }

    case 'typescript': {
      parser.setLanguage(TypeScript.typescript);

      break;
    }

    case 'tsx': {
      parser.setLanguage(TypeScript.tsx);

      break;
    }

    case 'python': {
      parser.setLanguage(Python);

      break;
    }
  }

  const tree = parser.parse(source);

  return extractCalls(tree.rootNode, source, language);
}

describe('call extraction', () => {
  it('extracts JavaScript and TypeScript identifier calls', () => {
    const calls = parseCalls(
      `
        function createUser() {
          validateUser();

          saveUser();
        }
      `,
      'typescript',
    );

    expect(calls.map((call) => call.callee)).toEqual(['validateUser', 'saveUser']);
  });

  it('extracts JavaScript and TypeScript member calls', () => {
    const calls = parseCalls(
      `
        function run() {
          userService.save();

          console.log('saved');

          this.validate();
        }
      `,
      'typescript',
    );

    expect(calls.map((call) => call.callee)).toEqual([
      'userService.save',
      'console.log',
      'this.validate',
    ]);
  });

  it('extracts nested resolvable calls', () => {
    const calls = parseCalls(
      `
        function run() {
          outer(
            inner()
          );
        }
      `,
      'javascript',
    );

    expect(calls.map((call) => call.callee)).toEqual(['outer', 'inner']);
  });

  it('does not treat require or dynamic import as normal calls', () => {
    const calls = parseCalls(
      `
        async function load() {
          const config =
            require('./config.js');

          const feature =
            await import('./feature.js');

          start();
        }
      `,
      'typescript',
    );

    expect(calls.map((call) => call.callee)).toEqual(['start']);
  });

  it('ignores highly dynamic JavaScript call targets', () => {
    const calls = parseCalls(
      `
        function run() {
          (factory())();

          execute();
        }
      `,
      'javascript',
    );

    expect(calls.map((call) => call.callee)).toEqual(['factory', 'execute']);
  });

  it('extracts Python identifier calls', () => {
    const calls = parseCalls(
      `
def create_user():
    validate_user()
    save_user()
      `,
      'python',
    );

    expect(calls.map((call) => call.callee)).toEqual(['validate_user', 'save_user']);
  });

  it('extracts Python attribute calls', () => {
    const calls = parseCalls(
      `
def run():
    service.save()
    self.validate()
      `,
      'python',
    );

    expect(calls.map((call) => call.callee)).toEqual(['service.save', 'self.validate']);
  });

  it('records the source range of the complete call expression', () => {
    const calls = parseCalls(`saveUser(user);`, 'typescript');

    expect(calls).toHaveLength(1);

    expect(calls[0]?.range).toEqual({
      start: {
        row: 0,
        column: 0,
      },

      end: {
        row: 0,
        column: 14,
      },
    });
  });
});
