import { useState } from "react";
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

const detectFileType = (path: string, backendType?: string): string => {
  if (backendType && backendType !== "reference") {
    return backendType.charAt(0).toUpperCase() + backendType.slice(1);
  }

  const lower = path.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));

  if (lower.includes("/controllers/") || lower.endsWith("controller.php"))
    return "Controllers";
  if (lower.includes("/models/") || lower.endsWith("model.php"))
    return "Models";
  if (lower.includes("/views/") || lower.endsWith(".blade.php")) return "Views";
  if (
    lower.includes("/routes/") ||
    lower.includes("web.php") ||
    lower.includes("api.php")
  )
    return "Routes";

  if (lower.includes("/components/") || lower.endsWith(".vue"))
    return "Components";
  if (lower.includes("/hooks/") || lower.startsWith("use")) return "Hooks";
  if (lower.includes("/stores/") || lower.includes("store.")) return "Stores";

  if (ext === ".go" && lower.includes("_test.go")) return "Tests";
  if (ext === ".test.ts" || ext === ".test.tsx" || ext === ".spec.ts")
    return "Tests";

  if (
    lower.includes("/middleware/") ||
    lower.includes("/handlers/") ||
    lower.includes("/services/")
  )
    return "Services";
  if (lower.includes("/migrations/") || lower.includes("/migrate/"))
    return "Migrations";

  if ([".json", ".yaml", ".yml", ".toml", ".ini", ".env"].includes(ext))
    return "Config";
  if ([".css", ".scss", ".less", ".pcss"].includes(ext)) return "Styles";
  if ([".png", ".jpg", ".svg", ".ico", ".webp", ".gif"].includes(ext))
    return "Assets";
  if ([".md", ".txt", ".rst", ".adoc"].includes(ext)) return "Docs";

  return "Reference";
};

const groupRelations = (
  backendRelations: indexer.FileRelation[],
): RelationGroup[] => {
  const groups: Record<string, RelatedFile[]> = {};

  for (const rel of backendRelations) {
    const groupKey = detectFileType(rel.path, rel.type);
    (groups[groupKey] ??= []).push({
      id: `${groupKey}-${rel.path}-${rel.lineNumber}`,
      name: rel.path.split("/").pop() || rel.path,
      path: rel.path,
      type: groupKey.toLowerCase(),
      line: rel.lineNumber,
      details: rel.description,
    });
  }

  return Object.entries(groups).map(([type, items]) => ({ type, items }));
};

export const useFileRelations = (filePath: string) => {
  const [relations, setRelations] = useState<RelationGroup[]>([]);
  const [prevPath, setPrevPath] = useState("");

  if (filePath !== prevPath) {
    setPrevPath(filePath);
    if (filePath) {
      AppFunctions.GetRelatedFiles(filePath)
        .then((result) =>
          setRelations(result?.length ? groupRelations(result) : []),
        )
        .catch(() => setRelations([]));
    } else {
      setRelations([]);
    }
  }

  return relations;
};
