import type { indexer } from "../../wailsjs/go/models";

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

const DIRECT_GROUP = "Direct relations";
const TRANSITIVE_GROUP = "Transitive relations";

const getFileName = (path: string) => path.split("/").pop() || path;

const normalizeKind = (kind?: string) => {
  const normalized = kind?.replace(/[_-]+/g, " ").trim().toLowerCase();
  return normalized || "dependency";
};

const compareEdges = (
  left: indexer.DependencyEdge,
  right: indexer.DependencyEdge,
) => {
  const leftKey = `${left.target}\u0000${left.kind}\u0000${left.line}`;
  const rightKey = `${right.target}\u0000${right.kind}\u0000${right.line}`;
  return leftKey.localeCompare(rightKey);
};

const detectFileCategory = (path: string): string => {
  const rawFileName = getFileName(path);
  const lower = path.toLowerCase();
  const fileName = getFileName(lower);
  const dotIndex = lower.lastIndexOf(".");
  const ext = dotIndex >= 0 ? lower.slice(dotIndex) : "";

  if (
    lower.includes("/controllers/") ||
    /controller\.[a-z0-9]+$/i.test(rawFileName)
  )
    return "Controllers";
  if (
    lower.includes("/routes/") ||
    lower.includes("/router/") ||
    ["routes.ts", "routes.js", "router.ts", "router.js", "urls.py"].includes(
      fileName,
    )
  )
    return "Routes";
  if (
    lower.includes("/models/") ||
    lower.includes("/entities/") ||
    lower.includes("/schemas/") ||
    fileName.includes(".model.") ||
    fileName.includes(".entity.")
  )
    return "Models";
  if (
    lower.includes("/components/") ||
    lower.includes("/ui/") ||
    [".vue", ".svelte"].includes(ext)
  )
    return "Components";
  if (
    lower.includes("/views/") ||
    lower.includes("/templates/") ||
    lower.includes("/pages/") ||
    lower.endsWith(".blade.php") ||
    [".html", ".htm", ".tsx", ".jsx"].includes(ext)
  )
    return "Views";

  if (ext === ".go" && lower.endsWith("_test.go")) return "Tests";
  if (
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.tsx") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".spec.tsx")
  )
    return "Tests";

  if (
    lower.includes("/middleware/") ||
    lower.includes("/handlers/") ||
    lower.includes("/services/") ||
    lower.includes("/usecases/")
  )
    return "Services";
  if (
    lower.includes("/hooks/") ||
    ([".ts", ".tsx", ".js", ".jsx"].includes(ext) &&
      /^use(?:[A-Z0-9]|[-_.])/.test(rawFileName))
  )
    return "Hooks";
  if (
    lower.includes("/stores/") ||
    lower.includes("/state/") ||
    fileName.includes("store.")
  )
    return "Stores";
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

const categoryToItemType = (category: string): string => {
  switch (category) {
    case "Routes":
      return "route";
    case "Models":
      return "model";
    case "Views":
      return "view";
    case "Components":
      return "component";
    case "Controllers":
      return "controller";
    case "Hooks":
      return "hook";
    case "Stores":
      return "store";
    case "Services":
      return "service";
    case "Tests":
      return "test";
    case "Migrations":
      return "migration";
    case "Config":
      return "config";
    case "Styles":
      return "style";
    case "Assets":
      return "asset";
    case "Docs":
      return "doc";
    case "Reference":
      return "reference";
    default:
      return "other";
  }
};

interface NodeMeta {
  depth: number;
  edge: indexer.DependencyEdge | null;
}

export const extractDependencyGraphPaths = (
  graph: indexer.DependencyGraph | null | undefined,
  rootPath: string,
): Set<string> =>
  new Set(
    (graph?.nodes ?? [])
      .map((node) => node.path)
      .filter((path) => Boolean(path) && path !== rootPath),
  );

export const extractRelationPaths = (groups: RelationGroup[]): Set<string> =>
  new Set(groups.flatMap((group) => group.items.map((item) => item.path)));

export const dependencyGraphToRelationGroups = (
  graph: indexer.DependencyGraph | null | undefined,
  rootPath: string,
): RelationGroup[] => {
  if (!graph?.nodes?.length || !rootPath) {
    return [];
  }

  const nodeSet = new Set(graph.nodes.map((node) => node.path).filter(Boolean));
  const outgoing = new Map<string, indexer.DependencyEdge[]>();
  for (const edge of graph.edges ?? []) {
    if (!edge.source || !edge.target || edge.source === edge.target) {
      continue;
    }

    const bucket = outgoing.get(edge.source);
    if (bucket) {
      bucket.push(edge);
      continue;
    }

    outgoing.set(edge.source, [edge]);
  }

  for (const edges of outgoing.values()) {
    edges.sort(compareEdges);
  }

  const metaByPath = new Map<string, NodeMeta>([
    [rootPath, { depth: 0, edge: null }],
  ]);
  const queue = [rootPath];
  for (let index = 0; index < queue.length; index += 1) {
    const currentPath = queue[index];
    const currentMeta = metaByPath.get(currentPath);
    if (!currentMeta) {
      continue;
    }

    for (const edge of outgoing.get(currentPath) ?? []) {
      if (!nodeSet.has(edge.target) || metaByPath.has(edge.target)) {
        continue;
      }

      metaByPath.set(edge.target, {
        depth: currentMeta.depth + 1,
        edge,
      });
      queue.push(edge.target);
    }
  }

  const grouped = new Map<string, RelatedFile[]>();
  const orderedNodes = [...graph.nodes]
    .filter((node) => node.path && node.path !== rootPath)
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const node of orderedNodes) {
    const meta = metaByPath.get(node.path);
    if (!meta) {
      continue;
    }

    const groupType = meta.depth <= 1 ? DIRECT_GROUP : TRANSITIVE_GROUP;
    const category = detectFileCategory(node.path);
    const relationKind = normalizeKind(meta.edge?.kind);
    const via =
      meta.depth > 1 && meta.edge?.source ? getFileName(meta.edge.source) : "";
    const details = via ? `${relationKind} via ${via}` : relationKind;
    const items = grouped.get(groupType) ?? [];

    items.push({
      id: `${groupType}:${node.path}`,
      name: getFileName(node.path),
      path: node.path,
      type: categoryToItemType(category),
      line: meta.edge?.line && meta.edge.line > 0 ? meta.edge.line : undefined,
      details,
    });
    grouped.set(groupType, items);
  }

  return [DIRECT_GROUP, TRANSITIVE_GROUP]
    .map((type) => {
      const items = grouped.get(type) ?? [];
      items.sort((left, right) => left.name.localeCompare(right.name));
      return items.length ? { type, items } : null;
    })
    .filter((group): group is RelationGroup => group !== null);
};

export const matchesRelationFilter = (item: RelatedFile, filter: string) => {
  const query = filter.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [item.name, item.path, item.type, item.details].some((value) =>
    value?.toLowerCase().includes(query),
  );
};
