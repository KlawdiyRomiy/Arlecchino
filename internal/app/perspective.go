package app

import (
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf16"

	"arlecchino/internal/indexer"
	"arlecchino/internal/indexer/core"
)

type RelatedFileAtPositionResult struct {
	Path        string `json:"path"`
	Line        int    `json:"line"`
	Char        int    `json:"char"`
	Relation    string `json:"relation"`
	DisplayPath string `json:"displayPath"`
}

func (a *App) ResolveRelatedFilesAtPosition(filePath, content string, line, character int, word string) ([]RelatedFileAtPositionResult, error) {
	lineText, ok := sourceLineAt(content, line)
	if !ok || character < 0 {
		return nil, nil
	}
	byteOffset, ok := utf16CharacterToByteOffset(lineText, character)
	if !ok {
		return nil, nil
	}

	engine := a.activeCoreEngineForPath(filePath)
	if engine == nil {
		return nil, nil
	}
	resolver, err := engine.NewDependencyTargetResolver()
	if err != nil {
		return nil, err
	}
	edges, err := engine.QueryEdges(core.EdgeQuery{FilePath: filePath, Line: line})
	if err != nil {
		return nil, err
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].ToSymbol != edges[j].ToSymbol {
			return edges[i].ToSymbol < edges[j].ToSymbol
		}
		return edges[i].Kind < edges[j].Kind
	})

	resolved, err := resolver.ResolveEdges(filePath, edges)
	if err != nil {
		return nil, err
	}
	projectPath := a.GetCurrentProjectPath()
	seen := make(map[string]struct{}, len(resolved))
	results := make([]RelatedFileAtPositionResult, 0, len(resolved))
	for _, candidate := range resolved {
		targetPath := candidate.TargetPath
		if targetPath == "" || filepath.Clean(targetPath) == filepath.Clean(filePath) {
			continue
		}
		if !relatedEdgeMatchesPosition(candidate.Edge, targetPath, lineText, byteOffset, word) {
			continue
		}
		cleanTarget := filepath.Clean(targetPath)
		if _, duplicate := seen[cleanTarget]; duplicate {
			continue
		}
		seen[cleanTarget] = struct{}{}
		results = append(results, RelatedFileAtPositionResult{
			Path:        targetPath,
			Line:        1,
			Char:        0,
			Relation:    string(edgeKindToRelation(candidate.Edge.Kind)),
			DisplayPath: getDisplayPath(targetPath, projectPath),
		})
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].DisplayPath != results[j].DisplayPath {
			return results[i].DisplayPath < results[j].DisplayPath
		}
		return results[i].Relation < results[j].Relation
	})
	return results, nil
}

func sourceLineAt(content string, line int) (string, bool) {
	if line < 1 {
		return "", false
	}
	start := 0
	for current := 1; current < line; current++ {
		next := strings.IndexByte(content[start:], '\n')
		if next < 0 {
			return "", false
		}
		start += next + 1
	}
	end := strings.IndexByte(content[start:], '\n')
	if end < 0 {
		end = len(content)
	} else {
		end += start
	}
	return strings.TrimSuffix(content[start:end], "\r"), true
}

func utf16CharacterToByteOffset(value string, character int) (int, bool) {
	if character < 0 {
		return 0, false
	}
	units := 0
	for byteOffset, r := range value {
		if units == character {
			return byteOffset, true
		}
		width := utf16.RuneLen(r)
		if width < 1 || units+width > character {
			return 0, false
		}
		units += width
	}
	if units == character {
		return len(value), true
	}
	return 0, false
}

func relatedEdgeMatchesPosition(edge core.Edge, targetPath, lineText string, byteOffset int, word string) bool {
	tokenPresent := false
	for _, token := range relatedEdgeTokens(edge.ToSymbol) {
		for searchFrom := 0; searchFrom <= len(lineText)-len(token); {
			relative := strings.Index(lineText[searchFrom:], token)
			if relative < 0 {
				break
			}
			tokenPresent = true
			start := searchFrom + relative
			end := start + len(token)
			if byteOffset >= start && byteOffset < end {
				return true
			}
			searchFrom = end
		}
	}
	return tokenPresent && relatedWordMatchesTarget(word, edge.ToSymbol, targetPath)
}

func relatedEdgeTokens(target string) []string {
	target = strings.Trim(strings.TrimSpace(target), "\"'`")
	if target == "" {
		return nil
	}
	tokens := []string{target}
	lower := strings.ToLower(target)
	for _, prefix := range []string{"component:", "function ", "const "} {
		if strings.HasPrefix(lower, prefix) {
			trimmed := strings.TrimSpace(target[len(prefix):])
			if trimmed != "" {
				tokens = append(tokens, trimmed)
			}
			break
		}
	}
	if trimmed := strings.TrimPrefix(target, `\`); trimmed != target && trimmed != "" {
		tokens = append(tokens, trimmed)
	}
	return tokens
}

func relatedWordMatchesTarget(word, target, targetPath string) bool {
	word = strings.Trim(strings.TrimSpace(word), "\"'`<>()[]{}")
	if word == "" {
		return false
	}
	matches := func(value string) bool {
		for _, segment := range strings.FieldsFunc(value, func(r rune) bool {
			switch r {
			case '/', '\\', '.', ':':
				return true
			default:
				return false
			}
		}) {
			if strings.EqualFold(word, segment) {
				return true
			}
		}
		return false
	}
	if matches(strings.TrimPrefix(target, "component:")) {
		return true
	}
	base := filepath.Base(targetPath)
	return strings.EqualFold(word, base) || strings.EqualFold(word, strings.TrimSuffix(base, filepath.Ext(base)))
}

func (a *App) GetRelatedFiles(filePath string) ([]indexer.FileRelation, error) {
	engine := a.activeCoreEngineForPath(filePath)
	if engine == nil {
		return nil, nil
	}
	resolver, err := engine.NewDependencyTargetResolver()
	if err != nil {
		return nil, err
	}

	forward, err := engine.QueryEdges(core.EdgeQuery{FilePath: filePath, Limit: 100})
	if err != nil {
		return nil, err
	}

	resolvedForward, _ := resolver.ResolveEdges(filePath, forward)

	basename := filepath.Base(filePath)
	reverse, err := engine.FindDependants(basename, 100)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(forward)+len(reverse))
	relations := make([]indexer.FileRelation, 0, len(forward)+len(reverse))

	for _, resolved := range resolvedForward {
		e := resolved.Edge
		targetPath := resolved.TargetPath
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
		resolvedReverse, _ := resolver.ResolveEdges(sourcePath, []core.Edge{e})
		if len(resolvedReverse) == 0 || filepath.Clean(resolvedReverse[0].TargetPath) != filepath.Clean(filePath) {
			continue
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
	engine := a.activeCoreEngineForPath(filePath)
	if engine == nil {
		return &indexer.DependencyGraph{}, nil
	}
	resolver, err := engine.NewDependencyTargetResolver()
	if err != nil {
		return nil, err
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
	edgeSet := make(map[string]struct{}, maxEdgesTotal)
	nodeSet[filePath] = struct{}{}

	frontier := []string{filePath}

	for d := range depth {
		if len(frontier) == 0 {
			break
		}

		nextFrontier := make([]string, 0, maxNodesPerDepth)
		for _, fp := range frontier {
			edges, err := engine.QueryEdges(core.EdgeQuery{FilePath: fp, Limit: maxNodesPerDepth})
			if err != nil {
				continue
			}
			sort.Slice(edges, func(i, j int) bool {
				if edges[i].Line != edges[j].Line {
					return edges[i].Line < edges[j].Line
				}
				if edges[i].ToSymbol != edges[j].ToSymbol {
					return edges[i].ToSymbol < edges[j].ToSymbol
				}
				return edges[i].Kind < edges[j].Kind
			})

			resolvedEdges, _ := resolver.ResolveEdges(fp, edges)

			for _, resolved := range resolvedEdges {
				if len(edgeBuf) >= maxEdgesTotal {
					break
				}
				e := resolved.Edge
				targetPath := resolved.TargetPath

				if targetPath == "" || targetPath == fp {
					continue
				}

				if !filepath.IsAbs(targetPath) {
					continue
				}
				edgeKey := fp + "\x00" + targetPath + "\x00" + string(e.Kind)
				if _, exists := edgeSet[edgeKey]; exists {
					continue
				}
				edgeSet[edgeKey] = struct{}{}

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
	sort.Strings(allPaths)

	symbolsByFile, _ := engine.QuerySymbolsByFiles(allPaths)

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
