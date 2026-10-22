import { describe, expect, it } from 'vitest';

import { parseSource } from './parser.js';

describe('import extraction', () => {
  it('extracts standard ESM imports', () => {
    const result = parseSource({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: `
              import express from 'express';

              import {
                UserService,
              } from './user-service.js';

              import './setup.js';
            `,
    });

    expect(result.imports.map((item) => item.source)).toEqual([
      'express',
      './user-service.js',
      './setup.js',
    ]);
  });

  it('extracts JavaScript and TypeScript re-export dependencies', () => {
    const result = parseSource({
      filePath: 'src/index.ts',

      language: 'typescript',

      source: `
              export {
                UserService,
              } from './user-service.js';

              export * from './types.js';
            `,
    });

    expect(result.imports.map((item) => item.source)).toEqual(['./user-service.js', './types.js']);
  });

  it('extracts CommonJS require dependencies', () => {
    const result = parseSource({
      filePath: 'src/config.js',

      language: 'javascript',

      source: `
              const express =
                require('express');

              const config =
                require('./config.js');
            `,
    });

    expect(result.imports.map((item) => item.source)).toEqual(['express', './config.js']);
  });

  it('extracts dynamic import dependencies with static string paths', () => {
    const result = parseSource({
      filePath: 'src/loader.ts',

      language: 'typescript',

      source: `
              async function load() {
                const feature =
                  await import(
                    './feature.js'
                  );

                return feature;
              }
            `,
    });

    expect(result.imports.map((item) => item.source)).toEqual(['./feature.js']);
  });

  it('extracts dynamic imports that use static template strings', () => {
    const result = parseSource({
      filePath: 'src/loader.ts',

      language: 'typescript',

      source: `
              async function load() {
                return import(
                  \`./feature.js\`
                );
              }
            `,
    });

    expect(result.imports.map((item) => item.source)).toEqual(['./feature.js']);
  });

  it('ignores require calls with runtime-computed paths', () => {
    const result = parseSource({
      filePath: 'src/loader.js',

      language: 'javascript',

      source: `
              const moduleName =
                './feature.js';

              const feature =
                require(
                  moduleName
                );
            `,
    });

    expect(result.imports).toEqual([]);
  });

  it('ignores dynamic imports with interpolated template paths', () => {
    const result = parseSource({
      filePath: 'src/loader.ts',

      language: 'typescript',

      source: `
              async function load(
                name: string,
              ) {
                return import(
                  \`./plugins/\${name}.js\`
                );
              }
            `,
    });

    expect(result.imports).toEqual([]);
  });

  it('does not confuse ordinary function calls with dependencies', () => {
    const result = parseSource({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: `
              load('./feature.js');

              fetch('./api');

              createModule(
                './module.js'
              );
            `,
    });

    expect(result.imports).toEqual([]);
  });

  it('extracts Python imports and from-import dependencies', () => {
    const result = parseSource({
      filePath: 'src/service.py',

      language: 'python',

      source: `
import os
import database.client

from services.user import UserService
            `,
    });

    expect(result.imports.map((item) => item.source)).toEqual([
      'os',
      'database.client',
      'services.user',
    ]);
  });
});
