import { describe, expect, it } from 'vitest';

import { parseSource } from './parser.js';

describe('class extraction', () => {
  it('extracts normal class declarations', () => {
    const result = parseSource({
      filePath: 'src/service.ts',

      language: 'typescript',

      source: `
              class UserService {}

              abstract class Repository {}
            `,
    });

    expect(
      result.classes.map((item) => ({
        name: item.name,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'UserService',
        isExported: false,
      },
      {
        name: 'Repository',
        isExported: false,
      },
    ]);
  });

  it('marks directly exported class declarations as exported', () => {
    const result = parseSource({
      filePath: 'src/service.ts',

      language: 'typescript',

      source: `
              export class UserService {}

              export default class AppService {}
            `,
    });

    expect(
      result.classes.map((item) => ({
        name: item.name,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'UserService',
        isExported: true,
      },
      {
        name: 'AppService',
        isExported: true,
      },
    ]);
  });

  it('marks exported variable-assigned class expressions as exported', () => {
    const result = parseSource({
      filePath: 'src/service.ts',

      language: 'typescript',

      source: `
              export const UserService =
                class {
                  run() {}
                };
            `,
    });

    expect(result.classes).toHaveLength(1);

    expect(result.classes[0]).toMatchObject({
      name: 'UserService',

      isExported: true,
    });
  });

  it('does not mark nested classes inside exported functions as exported', () => {
    const result = parseSource({
      filePath: 'src/service.ts',

      language: 'typescript',

      source: `
              export function createService() {
                class UserService {}

                return UserService;
              }
            `,
    });

    expect(result.classes).toHaveLength(1);

    expect(result.classes[0]).toMatchObject({
      name: 'UserService',

      isExported: false,
    });
  });

  it('infers a class expression name from a variable', () => {
    const result = parseSource({
      filePath: 'src/service.ts',

      language: 'typescript',

      source: `
              const UserService =
                class {
                  run() {}
                };
            `,
    });

    expect(result.classes).toHaveLength(1);

    expect(result.classes[0]).toMatchObject({
      name: 'UserService',

      isExported: false,
    });
  });

  it('infers a class expression name from direct assignment', () => {
    const result = parseSource({
      filePath: 'src/service.js',

      language: 'javascript',

      source: `
              let UserService;

              UserService =
                class {
                  run() {}
                };
            `,
    });

    expect(result.classes).toHaveLength(1);

    expect(result.classes[0]).toMatchObject({
      name: 'UserService',

      isExported: false,
    });
  });

  it('infers class names from object property keys', () => {
    const result = parseSource({
      filePath: 'src/services.ts',

      language: 'typescript',

      source: `
              const services = {
                UserService:
                  class {},

                'AdminService':
                  class {},
              };
            `,
    });

    expect(
      result.classes.map((item) => ({
        name: item.name,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'UserService',
        isExported: false,
      },

      {
        name: 'AdminService',
        isExported: false,
      },
    ]);
  });

  it('keeps genuinely anonymous class expressions unnamed', () => {
    const result = parseSource({
      filePath: 'src/factory.ts',

      language: 'typescript',

      source: `
              function createService() {
                return class {
                  run() {}
                };
              }
            `,
    });

    expect(result.classes).toHaveLength(1);

    expect(result.classes[0]).toMatchObject({
      name: null,

      isExported: false,
    });
  });

  it('continues extracting Python class names normally', () => {
    const result = parseSource({
      filePath: 'src/service.py',

      language: 'python',

      source: `
class UserService:
    pass

class AdminService:
    pass
            `,
    });

    expect(
      result.classes.map((item) => ({
        name: item.name,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'UserService',
        isExported: false,
      },

      {
        name: 'AdminService',
        isExported: false,
      },
    ]);
  });
});
