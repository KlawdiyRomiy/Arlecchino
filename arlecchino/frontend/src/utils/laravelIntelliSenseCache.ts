import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface LaravelIntelliSenseDB extends DBSchema {
  models: {
    key: string;
    value: ModelInfo;
  };
  routes: {
    key: string;
    value: RouteInfo;
  };
  views: {
    key: string;
    value: ViewInfo;
  };
  config: {
    key: string;
    value: ConfigKey;
  };
  metadata: {
    key: string;
    value: {
      lastIndexed: number;
      projectPath: string;
    };
  };
}

export interface ModelInfo {
  name: string;
  table: string;
  fields: ModelField[];
  fillable: string[];
  hidden: string[];
  casts: Record<string, string>;
  relationships: ModelRelationship[];
  filePath: string;
}

export interface ModelField {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
}

export interface ModelRelationship {
  name: string;
  type: string;
  model: string;
  method: string;
}

export interface RouteInfo {
  name: string;
  method: string;
  uri: string;
  action: string;
  controller: string;
  middleware: string[];
  filePath: string;
  lineNumber: number;
}

export interface ViewInfo {
  name: string;
  path: string;
  relPath: string;
  isLayout: boolean;
}

export interface ConfigKey {
  key: string;
  value?: string;
  file: string;
  description?: string;
}

export class LaravelIntelliSenseCache {
  private db: IDBPDatabase<LaravelIntelliSenseDB> | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      this.db = await openDB<LaravelIntelliSenseDB>('laravel-intellisense', 1, {
        upgrade(db) {
          db.createObjectStore('models', { keyPath: 'name' });
          db.createObjectStore('routes', { keyPath: 'name' });
          db.createObjectStore('views', { keyPath: 'name' });
          db.createObjectStore('config', { keyPath: 'key' });
          db.createObjectStore('metadata');
        },
      });
    })();

    return this.initPromise;
  }

  async setModels(models: Record<string, ModelInfo>): Promise<void> {
    await this.init();
    if (!this.db) return;

    const tx = this.db.transaction('models', 'readwrite');
    await tx.store.clear();

    for (const model of Object.values(models)) {
      await tx.store.put(model);
    }

    await tx.done;
    await this.updateMetadata();
  }

  async getModels(): Promise<Record<string, ModelInfo>> {
    await this.init();
    if (!this.db) return {};

    const all = await this.db.getAll('models');
    const result: Record<string, ModelInfo> = {};

    for (const model of all) {
      result[model.name] = model;
    }

    return result;
  }

  async getModel(name: string): Promise<ModelInfo | undefined> {
    await this.init();
    if (!this.db) return undefined;
    return this.db.get('models', name);
  }

  async setRoutes(routes: RouteInfo[]): Promise<void> {
    await this.init();
    if (!this.db) return;

    const tx = this.db.transaction('routes', 'readwrite');
    await tx.store.clear();

    for (const route of routes) {
      if (route.name) {
        await tx.store.put(route);
      }
    }

    await tx.done;
    await this.updateMetadata();
  }

  async getRoutes(): Promise<RouteInfo[]> {
    await this.init();
    if (!this.db) return [];
    return this.db.getAll('routes');
  }

  async setViews(views: ViewInfo[]): Promise<void> {
    await this.init();
    if (!this.db) return;

    const tx = this.db.transaction('views', 'readwrite');
    await tx.store.clear();

    for (const view of views) {
      await tx.store.put(view);
    }

    await tx.done;
    await this.updateMetadata();
  }

  async getViews(): Promise<ViewInfo[]> {
    await this.init();
    if (!this.db) return [];
    return this.db.getAll('views');
  }

  async setConfig(keys: ConfigKey[]): Promise<void> {
    await this.init();
    if (!this.db) return;

    const tx = this.db.transaction('config', 'readwrite');
    await tx.store.clear();

    for (const key of keys) {
      await tx.store.put(key);
    }

    await tx.done;
    await this.updateMetadata();
  }

  async getConfig(): Promise<ConfigKey[]> {
    await this.init();
    if (!this.db) return [];
    return this.db.getAll('config');
  }

  async getConfigByPrefix(prefix: string): Promise<ConfigKey[]> {
    await this.init();
    if (!this.db) return [];

    const all = await this.db.getAll('config');
    return all.filter(k => k.key.startsWith(prefix));
  }

  async updateMetadata(): Promise<void> {
    await this.init();
    if (!this.db) return;

    await this.db.put('metadata', {
      lastIndexed: Date.now(),
      projectPath: '',
    }, 'lastIndexed');
  }

  async getLastIndexed(): Promise<number | null> {
    await this.init();
    if (!this.db) return null;

    const meta = await this.db.get('metadata', 'lastIndexed');
    return meta?.lastIndexed || null;
  }

  async clear(): Promise<void> {
    await this.init();
    if (!this.db) return;

    await Promise.all([
      this.db.clear('models'),
      this.db.clear('routes'),
      this.db.clear('views'),
      this.db.clear('config'),
      this.db.clear('metadata'),
    ]);
  }
}

export const intelliSenseCache = new LaravelIntelliSenseCache();
