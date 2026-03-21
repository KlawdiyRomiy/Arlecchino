import { useState, useEffect } from "react";
import * as AppFunctions from "../../wailsjs/go/main/App";
import { indexer } from "../../wailsjs/go/models";

export interface RelatedFile {
  id: string;
  name: string;
  path: string;
  type: string;
  line?: number;
  details?: string;
}

export interface RelationGroup {
  type: string;
  items: RelatedFile[];
}

export const useFileRelations = (filePath: string, fileContent: string) => {
  const [relations, setRelations] = useState<RelationGroup[]>([]);

  useEffect(() => {
    if (!filePath) {
      setRelations([]);
      return;
    }

    const fetchRelations = async () => {
      try {
        console.warn("Perspective: Fetching relations for", filePath);
        const backendRelations = await AppFunctions.GetRelatedFiles(filePath);

        if (!backendRelations || backendRelations.length === 0) {
          console.warn(
            "Perspective: No relations returned from backend for",
            filePath,
          );
          setRelations([]);
          return;
        }

        const groups: Record<string, RelatedFile[]> = {};

        const detectFileType = (path: string, backendType?: string): string => {
          if (backendType && backendType !== "reference") {
            return backendType.charAt(0).toUpperCase() + backendType.slice(1);
          }

          const lowerPath = path.toLowerCase();

          if (
            lowerPath.includes("/controllers/") ||
            lowerPath.endsWith("controller.php")
          ) {
            return "Controllers";
          }
          if (
            lowerPath.includes("/models/") ||
            lowerPath.endsWith("model.php")
          ) {
            return "Models";
          }
          if (
            lowerPath.includes("/views/") ||
            lowerPath.endsWith(".blade.php")
          ) {
            return "Views";
          }
          if (
            lowerPath.includes("/routes/") ||
            lowerPath.includes("routes.php") ||
            lowerPath.includes("web.php") ||
            lowerPath.includes("api.php")
          ) {
            return "Routes";
          }
          if (lowerPath.endsWith(".json")) {
            return "Config";
          }
          if (
            lowerPath.endsWith(".php") &&
            (lowerPath.includes("/app/") || lowerPath.includes("/src/"))
          ) {
            return "Classes";
          }

          return "Reference";
        };

        backendRelations.forEach((rel: indexer.FileRelation) => {
          const groupKey = detectFileType(rel.path, rel.type);

          if (!groups[groupKey]) groups[groupKey] = [];

          groups[groupKey].push({
            id: `${groupKey}-${rel.path}-${rel.lineNumber}`,
            name: rel.path.split("/").pop() || rel.path,
            path: rel.path,
            type: groupKey.toLowerCase(),
            line: rel.lineNumber,
            details: rel.description,
          });
        });

        const result: RelationGroup[] = Object.entries(groups).map(
          ([type, items]) => ({
            type,
            items,
          }),
        );

        console.log("Perspective: Found relations", result);
        setRelations(result);
      } catch (error) {
        console.error("Perspective: Failed to get relations", error);
        setRelations([]);
      }
    };

    const timer = setTimeout(fetchRelations, 100);
    return () => clearTimeout(timer);
  }, [filePath]);

  return relations;
};
