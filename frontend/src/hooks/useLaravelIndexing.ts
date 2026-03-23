import { useEffect, useCallback, useRef } from "react";
import {
  IndexLaravelModels,
  IndexLaravelRoutes,
  IndexLaravelViews,
  IndexLaravelConfig,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { intelliSenseCache } from "../utils/laravelIntelliSenseCache";

export function useLaravelIndexing(projectPath: string | null) {
  const isIndexingRef = useRef(false);
  const lastProjectRef = useRef<string | null>(null);

  const indexAll = useCallback(async () => {
    if (!projectPath || isIndexingRef.current) return;
    if (lastProjectRef.current === projectPath) return;
    
    isIndexingRef.current = true;
    lastProjectRef.current = projectPath;

    try {
      const modelsData = await IndexLaravelModels().catch((err) => {
        console.error("Models indexing failed:", err);
        return "";
      });

      if (modelsData && modelsData.trim()) {
        try {
          const models = JSON.parse(modelsData);
          await intelliSenseCache.setModels(models);
        } catch (e) {
          console.error("Failed to parse models JSON:", e);
        }
      }

      const routesData = await IndexLaravelRoutes().catch((err) => {
        console.error("Routes indexing failed:", err);
        return "";
      });

      if (routesData && routesData.trim()) {
        const routes = JSON.parse(routesData);
        await intelliSenseCache.setRoutes(routes);
      }

      const viewsData = await IndexLaravelViews().catch((err) => {
        console.error("Views indexing failed:", err);
        return "";
      });

      if (viewsData && viewsData.trim()) {
        const views = JSON.parse(viewsData);
        await intelliSenseCache.setViews(views);
      }

      const configData = await IndexLaravelConfig().catch((err) => {
        console.error("Config indexing failed:", err);
        return "";
      });

      if (configData && configData.trim()) {
        const config = JSON.parse(configData);
        await intelliSenseCache.setConfig(config);
      }
    } catch (error) {
      console.error("Laravel indexing failed:", error);
    } finally {
      isIndexingRef.current = false;
    }
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;

    const unsubscribe = EventsOn("indexing:completed", (data: { type: string; count: number }) => {
      console.log("Indexing completed:", data.type, "items:", data.count);
    });

    indexAll();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [projectPath, indexAll]);

  return { indexAll };
}
