export const DEFAULT_REDIS_HOST = '127.0.0.1';

export const DEFAULT_REDIS_PORT = 6379;

export const DEFAULT_REDIS_DATABASE = 0;

export interface RedisConnectionConfig {
  host: string;

  port: number;

  database: number;

  username?: string;

  password?: string;

  useTls: boolean;
}
