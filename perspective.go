package main

import (
	"path/filepath"

	"arlecchino/internal/indexer"
	"arlecchino/internal/indexer/core"
)

func (a *App) GetRelatedFiles(filePath string) ([]indexer.FileRelation, error) {
	if a.coreEngine == nil {
		return nil, nil
	}

	forward, err := a.coreEngine.QueryEdges(core.EdgeQuery{FilePath: filePath, Limit: 100})
	if err != nil {
		return nil, err
	}

	toSymbols := make([]string, 0, len(forward))
	for _, e := range forward {
		toSymbols = append(toSymbols, e.ToSymbol)
	}

	resolved, _ := a.coreEngine.ResolveImportFiles(toSymbols)

	basename := filepath.Base(filePath)
	reverse, err := a.coreEngine.FindDependants(basename, 100)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(forward)+len(reverse))
	relations := make([]indexer.FileRelation, 0, len(forward)+len(reverse))

	for _, e := range forward {
		targetPath := e.ToSymbol
		if resolved != nil {
			if p, ok := resolved[e.ToSymbol]; ok {
				targetPath = p
			}
		}

		key := targetPath + string(e.Kind)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		relations = append(relations, indexer.FileRelation{
			Path:        targetPath,
			Type:        edgeKindToRelation(e.Kind),
			LineNumber:  e.Line,
			Description: string(e.Kind) + ": " + filepath.Base(targetPath),
		})
	}

	for _, e := range reverse {
		if e.FilePath == filePath || e.FromSymbol == filePath {
			continue
		}
		sourcePath := e.FilePath
		if sourcePath == "" {
			sourcePath = e.FromSymbol
		}
		key := sourcePath + string(e.Kind)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		relations = append(relations, indexer.FileRelation{
			Path:        sourcePath,
			Type:        edgeKindToRelation(e.Kind),
			LineNumber:  e.Line,
			Description: "referenced by: " + filepath.Base(sourcePath),
		})
	}

	return relations, nil
}

func (a *App) GetDependencyGraph(filePath string, depth int) (*indexer.DependencyGraph, error) {
	if a.coreEngine == nil {
		return &indexer.DependencyGraph{}, nil
	}
	if depth < 1 {
		depth = 1
	}
	if depth > 3 {
		depth = 3
	}

	const maxNodesPerDepth = 50
	const maxEdgesTotal = 200

	nodeSet := make(map[string]struct{}, 64)
	edgeBuf := make([]indexer.DependencyEdge, 0, maxEdgesTotal)
	nodeSet[filePath] = struct{}{}

	frontier := []string{filePath}

	for d := range depth {
		if len(frontier) == 0 {
			break
		}

		nextFrontier := make([]string, 0, maxNodesPerDepth)
		for _, fp := range frontier {
			edges, err := a.coreEngine.QueryEdges(core.EdgeQuery{FilePath: fp, Limit: maxNodesPerDepth})
			if err != nil {
				continue
			}

			toSymbols := make([]string, 0, len(edges))
			for _, e := range edges {
				toSymbols = append(toSymbols, e.ToSymbol)
			}

			resolved, _ := a.coreEngine.ResolveImportFiles(toSymbols)

			for _, e := range edges {
				if len(edgeBuf) >= maxEdgesTotal {
					break
				}

				targetPath := e.ToSymbol
				if resolved != nil {
					if p, ok := resolved[e.ToSymbol]; ok {
						targetPath = p
					}
				}

				if targetPath == "" || targetPath == fp {
					continue
				}

				if !filepath.IsAbs(targetPath) {
					continue
				}

				edgeBuf = append(edgeBuf, indexer.DependencyEdge{
					Source: fp,
					Target: targetPath,
					Kind:   string(e.Kind),
					Line:   e.Line,
				})

				if _, exists := nodeSet[targetPath]; !exists {
					nodeSet[targetPath] = struct{}{}
					if d < depth-1 && len(nextFrontier) < maxNodesPerDepth {
						nextFrontier = append(nextFrontier, targetPath)
					}
				}
			}
		}
		frontier = nextFrontier
	}

	allPaths := make([]string, 0, len(nodeSet))
	for nodePath := range nodeSet {
		allPaths = append(allPaths, nodePath)
	}

	symbolsByFile, _ := a.coreEngine.QuerySymbolsByFiles(allPaths)

	nodes := make([]indexer.DependencyNode, 0, len(nodeSet))
	for _, nodePath := range allPaths {
		syms := symbolsByFile[nodePath]
		nodeSymbols := make([]indexer.NodeSymbol, 0, len(syms))
		for _, s := range syms {
			nodeSymbols = append(nodeSymbols, indexer.NodeSymbol{
				Name: s.Name,
				Kind: string(s.Kind),
				Line: s.Line,
			})
		}
		nodes = append(nodes, indexer.DependencyNode{
			Path:    nodePath,
			Symbols: nodeSymbols,
		})
	}

	return &indexer.DependencyGraph{
		Nodes: nodes,
		Edges: edgeBuf,
	}, nil
}

func edgeKindToRelation(kind core.EdgeKind) indexer.RelationType {
	switch kind {
	case core.EdgeKindImports:
		return "import"
	case core.EdgeKindExtends:
		return "extends"
	case core.EdgeKindImplements:
		return "implements"
	case core.EdgeKindUses:
		return indexer.RelationTypeModel
	case core.EdgeKindRoutes:
		return indexer.RelationTypeRoute
	case core.EdgeKindRenders:
		return indexer.RelationTypeView
	case core.EdgeKindReferences:
		return "reference"
	default:
		return "reference"
	}
}
