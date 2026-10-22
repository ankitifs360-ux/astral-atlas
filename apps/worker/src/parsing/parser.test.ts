import { describe, expect, it } from 'vitest';

import { parseSource } from './parser.js';

describe('parseSource', () => {
  it('parses JavaScript imports, functions, and classes', () => {
    const result = parseSource({
      filePath: 'src/index.js',

      language: 'javascript',

      source: `
            import express from 'express';

            class AppService {
              start() {
                return express();
              }
            }

            async function loadUsers() {
              return [];
            }

            const handler =
              async () => {};
          `,
    });

    expect(result.hasSyntaxErrors).toBe(false);

    expect(result.imports.map((item) => item.source)).toEqual(['express']);

    expect(
      result.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'start',

        async: false,
      },

      {
        name: 'loadUsers',

        async: true,
      },

      {
        name: 'handler',

        async: true,
      },
    ]);

    expect(result.classes.map((item) => item.name)).toEqual(['AppService']);
  });

  it('extracts TypeScript classes and methods', () => {
    const result = parseSource({
      filePath: 'src/user.ts',

      language: 'typescript',

      source: `
            import type {
              User,
            } from './types.js';

            abstract class Repository {
              abstract find(
                id: string,
              ): Promise<User>;
            }

            class UserService {
              async findUser(
                id: string,
              ): Promise<User> {
                return {
                  id,
                  name: 'Ankit',
                };
              }

              deleteUser(
                id: string,
              ): void {
                console.log(id);
              }
            }
          `,
    });

    expect(result.hasSyntaxErrors).toBe(false);

    expect(result.imports.map((item) => item.source)).toEqual(['./types.js']);

    expect(result.classes.map((item) => item.name)).toEqual(['Repository', 'UserService']);

    expect(
      result.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'findUser',

        async: true,
      },

      {
        name: 'deleteUser',

        async: false,
      },
    ]);
  });

  it('extracts classes from TSX', () => {
    const result = parseSource({
      filePath: 'src/App.tsx',

      language: 'tsx',

      source: `
            import React from 'react';

            class ErrorBoundary extends React.Component {
              render() {
                return (
                  <main>
                    Error
                  </main>
                );
              }
            }

            export function App() {
              return (
                <ErrorBoundary />
              );
            }
          `,
    });

    expect(result.hasSyntaxErrors).toBe(false);

    expect(result.classes.map((item) => item.name)).toEqual(['ErrorBoundary']);

    expect(result.functions.map((item) => item.name)).toEqual(['render', 'App']);
  });

  it('extracts Python classes and methods', () => {
    const result = parseSource({
      filePath: 'src/main.py',

      language: 'python',

      source: `
import os

class UserService:
    async def fetch_user(self, user_id):
        return user_id

    def delete_user(self, user_id):
        return None

def greet(name):
    return f"Hello {name}"
          `,
    });

    expect(result.hasSyntaxErrors).toBe(false);

    expect(result.imports.map((item) => item.source)).toEqual(['os']);

    expect(result.classes.map((item) => item.name)).toEqual(['UserService']);

    expect(
      result.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'fetch_user',

        async: true,
      },

      {
        name: 'delete_user',

        async: false,
      },

      {
        name: 'greet',

        async: false,
      },
    ]);
  });

  it('extracts nested classes', () => {
    const result = parseSource({
      filePath: 'src/nested.py',

      language: 'python',

      source: `
class Outer:
    class Inner:
        pass
          `,
    });

    expect(result.classes.map((item) => item.name)).toEqual(['Outer', 'Inner']);
  });

  it('extracts anonymous JavaScript class expressions', () => {
    const result = parseSource({
      filePath: 'src/service.js',

      language: 'javascript',

      source: `
            const Service =
              class {
                run() {}
              };
          `,
    });

    expect(result.classes.map((item) => item.name)).toEqual(['Service']);

    expect(result.functions.map((item) => item.name)).toEqual(['run']);
  });

  it('stores source ranges for classes', () => {
    const result = parseSource({
      filePath: 'src/example.ts',

      language: 'typescript',

      source: `
class ExampleService {
  start() {}
}
          `,
    });

    expect(result.classes).toHaveLength(1);

    expect(result.classes[0]?.range).toEqual({
      start: expect.objectContaining({
        row: expect.any(Number),

        column: expect.any(Number),
      }),

      end: expect.objectContaining({
        row: expect.any(Number),

        column: expect.any(Number),
      }),
    });
  });

  it('parses Python from imports', () => {
    const result = parseSource({
      filePath: 'src/service.py',

      language: 'python',

      source: `
from services.user import User
from database.client import database

def get_user(user_id):
    return database.find(user_id)
          `,
    });

    expect(result.imports.map((item) => item.source)).toEqual(['services.user', 'database.client']);

    expect(result.functions.map((item) => item.name)).toEqual(['get_user']);

    expect(result.classes).toEqual([]);
  });

  it('detects JavaScript syntax errors', () => {
    const result = parseSource({
      filePath: 'src/broken.js',

      language: 'javascript',

      source: `
            function broken( {
              return 42;
            }
          `,
    });

    expect(result.hasSyntaxErrors).toBe(true);
  });

  it('detects TypeScript syntax errors', () => {
    const result = parseSource({
      filePath: 'src/broken.ts',

      language: 'typescript',

      source: `
            interface User {
              id:
            }

            function getUser(
              id: string
            {
              return id;
            }
          `,
    });

    expect(result.hasSyntaxErrors).toBe(true);
  });

  it('detects Python syntax errors', () => {
    const result = parseSource({
      filePath: 'src/broken.py',

      language: 'python',

      source: `
def broken(
    return 42
          `,
    });

    expect(result.hasSyntaxErrors).toBe(true);
  });
});
