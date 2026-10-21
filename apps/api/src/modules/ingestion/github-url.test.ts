import { describe, expect, it } from 'vitest';

import { AppError } from '../../errors.js';
import { parseGitHubRepositoryUrl } from './github-url.js';

describe('parseGitHubRepositoryUrl', () => {
  it('parses a normal GitHub repository URL', () => {
    const result = parseGitHubRepositoryUrl('https://github.com/facebook/react');

    expect(result).toEqual({
      owner: 'facebook',
      repo: 'react',
      canonicalUrl: 'https://github.com/facebook/react',
      sourceKey: 'github:facebook/react',
    });
  });

  it('removes a trailing .git suffix', () => {
    const result = parseGitHubRepositoryUrl('https://github.com/facebook/react.git');

    expect(result).toEqual({
      owner: 'facebook',
      repo: 'react',
      canonicalUrl: 'https://github.com/facebook/react',
      sourceKey: 'github:facebook/react',
    });
  });

  it('trims surrounding whitespace', () => {
    const result = parseGitHubRepositoryUrl('  https://github.com/facebook/react  ');

    expect(result.owner).toBe('facebook');
    expect(result.repo).toBe('react');
  });

  it('normalizes sourceKey casing', () => {
    const result = parseGitHubRepositoryUrl('https://github.com/Facebook/React');

    expect(result.sourceKey).toBe('github:facebook/react');
  });

  it('rejects non-HTTPS URLs', () => {
    expect(() => parseGitHubRepositoryUrl('http://github.com/facebook/react')).toThrow(AppError);
  });

  it('rejects non-GitHub hosts', () => {
    expect(() => parseGitHubRepositoryUrl('https://example.com/facebook/react')).toThrow(
      'Only github.com repository URLs are allowed.',
    );
  });

  it('rejects repository subpaths', () => {
    expect(() => parseGitHubRepositoryUrl('https://github.com/facebook/react/tree/main')).toThrow(
      'GitHub URL must point directly to a repository',
    );
  });

  it('rejects credentials in the URL', () => {
    expect(() =>
      parseGitHubRepositoryUrl('https://user:password@github.com/facebook/react'),
    ).toThrow('GitHub repository URL must not contain credentials.');
  });

  it('rejects custom ports', () => {
    expect(() => parseGitHubRepositoryUrl('https://github.com:8080/facebook/react')).toThrow(
      'GitHub repository URL must not contain a custom port.',
    );
  });

  it('rejects query parameters', () => {
    expect(() => parseGitHubRepositoryUrl('https://github.com/facebook/react?ref=main')).toThrow(
      'GitHub repository URL must not contain query parameters.',
    );
  });

  it('rejects URL fragments', () => {
    expect(() => parseGitHubRepositoryUrl('https://github.com/facebook/react#readme')).toThrow(
      'GitHub repository URL must not contain a fragment.',
    );
  });

  it('rejects an empty string', () => {
    expect(() => parseGitHubRepositoryUrl('')).toThrow('GitHub repository URL cannot be empty.');
  });
});
